/**
 * services/entitlement.ts — 会员权益与免费额度判定
 *
 * 只负责「能不能用、还剩几次」，不碰 IAP 的购买流程（那是 services/iap.ts 的事）。
 * 免费额度与 subscription.tsx 的对比表必须保持一致，改这里记得同步改表。
 *
 * 当前规则（口径 v104，最终确认）：
 *   每日 AI 生成故事   免费 1 次 / 月付会员（$4.99）2 次 / 年付会员（$49.99）3 次，本地 0 点重置
 *   旅行打卡           免费累计 3 次 / 会员无限
 *   声音克隆           会员无限；免费用户登录后仅 1 次体验
 *   离线故事池         5 篇经典系统音，所有用户无限免费听（不扣次数、不走云端）
 *
 * ⚠️ 月付 $4.99 的算力成本覆盖不了「每天 3 次」TTS，故月付与年付严格区分上限，
 *   绝不允许把月付也设成 3 次，否则重度月付用户会直接亏本。
 *
 * ★ 扣减时机（v103 产品红线，改动前务必看 scripts/verify-quota-scope.mjs）：
 *   只有「真调云端 AI 并拿到成稿」才 +1，且记账只发生在 services/ai.ts 的云端成功分支。
 *   收听/重播/书架/经典库/我的故事/本地录音回放/命中缓存/兜底降级 —— 一律不扣、
 *   也不允许任何 UI 直接调用 recordStoryGenerated。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ts } from './i18n';
import { getProgress, getFreeCloneUsed } from './storage';
import { isPremium, type Plan } from './iap';
import { logGeneration, type StoryLengthBucket } from './generationLog';
import { peekUsage, consumeQuota, readMirror } from './serverQuota';
import { isAuthConfigured } from './supabase';

// ---------------------------------------------------------------------------
// 免费额度（改这里会自动同步到 UI 文案）
// ---------------------------------------------------------------------------

/** 免费用户每天可生成的 AI 故事数（本地日期 0 点自动重置） */
export const FREE_DAILY_STORY_LIMIT = 1;
/** 月付会员（$4.99）每天最多生成 2 次 —— 成本红线，绝不能给 3 次 */
export const MONTHLY_DAILY_STORY_LIMIT = 2;
/** 年付会员（$49.99）每天最多生成 3 次，主推档位 */
export const YEARLY_DAILY_STORY_LIMIT = 3;
// 旅行打卡改用 AI 现场生成后，故事不再有「只有 15 篇」的上限，只受次数约束。
// 测试期一并放开（999 ≈ 不限），上架前按商业化口径收紧（如免费 3 次）。
export const FREE_TOTAL_CHECKIN_LIMIT = 999;

/** 当前方案对应的每日 AI 生成上限（免费 1 / 月付 2 / 年付 3） */
export function dailyStoryLimit(plan: Plan): number {
  switch (plan) {
    case 'yearly': return YEARLY_DAILY_STORY_LIMIT;
    case 'monthly': return MONTHLY_DAILY_STORY_LIMIT;
    default: return FREE_DAILY_STORY_LIMIT;
  }
}

const USAGE_KEY = 'rms_daily_usage';

interface DailyUsage {
  /** 本地日期键 YYYY-MM-DD */
  date: string;
  /** 当天已生成的 AI 故事数 */
  storyCount: number;
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface EntitlementSnapshot {
  premium: boolean;
  plan: Plan;
  /** 今天已生成的故事数 */
  storiesUsedToday: number;
  /** 今天还能生成几个（会员也有上限，不再是 null / 无限） */
  storiesRemaining: number;
  /** 累计打卡次数 */
  checkInsUsed: number;
  /** 还能打卡几次；会员为 null 表示不限 */
  checkInsRemaining: number | null;
}

/**
 * 门禁判定结果。allowed=false 时带可直接弹窗的文案。
 * reason 让 UI 区分「免费额度用完（可引导升级）」与「会员今日 3 次用完（不能再卖会员）」。
 */
export type GateResult =
  | { allowed: true }
  | {
      allowed: false;
      title: string;
      message: string;
      reason: 'free' | 'premium' | 'login';
    };

// ---------------------------------------------------------------------------
// 用量记录
//   v107：改为「服务端优先」，本地只做离线镜像与显示缓存。
//   服务端不可用（未登录 / 离线）时不再无条件按本地日期清零 ——
//   见 readUsage() 里的「防调时间」规则。
// ---------------------------------------------------------------------------

/** 本地日期键，仅用于离线兜底与显示（真实判定走服务端日期） */
function todayKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function readLocalUsage(): Promise<DailyUsage | null> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyUsage;
    if (parsed && typeof parsed.date === 'string' && typeof parsed.storyCount === 'number') {
      return parsed;
    }
  } catch (err) {
    console.warn('[Entitlement] readLocalUsage failed:', err);
  }
  return null;
}

async function writeUsage(usage: DailyUsage): Promise<void> {
  try {
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch (err) {
    console.warn('[Entitlement] writeUsage failed:', err);
  }
}

/**
 * 今天的已用量。
 * ---------------------------------------------------------------------------
 * 优先级：
 *   ① 登录且联网 → 直接问服务端（日期用服务器时间算，客户端改系统时间完全无效）；
 *   ② 服务端不可用 → 用本地记录，但**不允许**凭「手机日期变了」就白拿新额度：
 *      · 手机日期 > 服务端最后确认日 → 沿镜像里那一天的用量（不重置）
 *      · 手机日期 < 服务端最后确认日（往回拨） → 同样按镜像走
 *      · 同一天 → 取本地与服务端镜像的较大值（离线期间用掉的也得算）
 *   只要用户曾经联网登录过，调时间这条路就彻底堵死。
 */
async function readUsage(): Promise<DailyUsage> {
  const server = await peekUsage('story');
  if (server) return { date: server.day, storyCount: server.used };

  const today = todayKey();
  const local = await readLocalUsage();
  const mirror = await readMirror();

  if (mirror && mirror.day) {
    const mirrorUsed = mirror.used.story ?? 0;
    if (today !== mirror.day) {
      // 无论是往前调还是往后拨，没有服务端确认就不发新额度
      return { date: mirror.day, storyCount: mirrorUsed };
    }
    if (local && local.date === today) {
      return { date: today, storyCount: Math.max(mirrorUsed, local.storyCount) };
    }
    return { date: today, storyCount: mirrorUsed };
  }

  // 从未连过服务端（未登录 / 本地模式）：沿用旧的本地日历逻辑
  if (local && local.date === today) return local;
  return { date: today, storyCount: 0 };
}

export interface RecordStoryOptions {
  /** short | long（medium/long 归 long） */
  storyLength?: StoryLengthBucket;
  /** 入口标识：create / travel ... */
  source?: string;
}

/**
 * 成功「发起一次真实生成」后调用：计入当日额度 + 后台写一条埋点。
 * ⚠️ 命中本地缓存直接播旧故事的路径绝不能调这里，否则会白扣一次额度。
 *
 * v107：优先在服务端原子 +1（跨设备一致、不可篡改）；服务端不可用时才落本地。
 */
export async function recordStoryGenerated(opts: RecordStoryOptions = {}): Promise<void> {
  let plan: Plan = 'free';
  try {
    const snap = await getSnapshot();
    plan = snap.plan;
    const limit = dailyStoryLimit(plan);

    // 先问服务端：原子消耗一次（并发点击也不会超发）
    const server = await consumeQuota('story', limit);
    if (server) {
      if (!server.allowed) {
        // 极窄竞态：预检通过后，另一台设备先把额度用掉了。故事已经生成，不回滚，只记一笔。
        console.warn('[Entitlement] server quota exhausted on record (race)');
      }
      await writeUsage({ date: server.day, storyCount: server.used });
    } else {
      // 服务端不可用：本地记账（readUsage 已含防调时间规则）
      const usage = await readUsage();
      usage.storyCount += 1;
      await writeUsage(usage);
    }
  } catch (err) {
    console.warn('[Entitlement] recordStoryGenerated failed:', err);
  }

  // 纯后台埋点：失败/未建表/未登录都不影响主流程，也不在 UI 显示
  try {
    void logGeneration({
      storyLength: opts.storyLength ?? 'short',
      source: opts.source ?? 'create',
      plan,
    });
  } catch (err) {
    console.warn('[Entitlement] generation log skipped:', err);
  }
}

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

export async function getSnapshot(): Promise<EntitlementSnapshot> {
  let premium = false;
  let plan: Plan = 'free';

  try {
    premium = await isPremium();
    if (premium) {
      const { loadEntitlement } = await import('./iap');
      const ent = await loadEntitlement();
      if (ent) plan = ent.plan;
    }
  } catch (err) {
    console.warn('[Entitlement] isPremium failed:', err);
  }

  const usage = await readUsage();

  let checkInsUsed = 0;
  try {
    const progress = await getProgress();
    checkInsUsed = progress?.checkIns?.length ?? 0;
  } catch (err) {
    console.warn('[Entitlement] getProgress failed:', err);
  }

  return {
    premium,
    plan,
    storiesUsedToday: usage.storyCount,
    storiesRemaining: Math.max(0, dailyStoryLimit(plan) - usage.storyCount),
    checkInsUsed,
    checkInsRemaining: premium
      ? null
      : Math.max(0, FREE_TOTAL_CHECKIN_LIMIT - checkInsUsed),
  };
}

// ---------------------------------------------------------------------------
// 门禁
// ---------------------------------------------------------------------------

/**
 * 生成故事前的门禁（每日额度）。
 * 免费 1 次 / 会员 3 次，按本地日期 0 点重置；会员用完也不放行。
 * 这是「拦截请求」的关键点：调用方必须在发出任何 LLM 请求之前先问它。
 */
export async function checkStoryGate(): Promise<GateResult> {
  /**
   * v107 防白嫖：AI 生成必须登录。
   * 额度的真实判定在服务端（daily_usage，日期用服务器时间算），未登录就没有可信身份，
   * 只能退回本地计数 —— 那等于「卸载重装就重置」。所以这里先要账号。
   * 若 Supabase 根本没配置（本地开发包），不做这道要求，避免把功能彻底卡死。
   */
  if (isAuthConfigured) {
    try {
      const { getSession } = await import('./auth');
      const session = await getSession();
      if (!session) {
        return {
          allowed: false,
          title: ts('gate.loginTitle'),
          message: ts('gate.loginMsg'),
          reason: 'login',
        };
      }
    } catch {
      /* 登录模块异常时放行，交给后面的额度判断，不把孩子卡死在门口 */
    }
  }

  const snap = await getSnapshot();
  if (snap.storiesRemaining > 0) return { allowed: true };

  if (snap.premium) {
    return {
      allowed: false,
      title: ts('gate.premiumDailyTitle'),
      message: ts('gate.premiumDailyMsg'),
      reason: 'premium',
    };
  }
  return {
    allowed: false,
    title: ts('gate.dailyTitle'),
    message: ts('gate.dailyMsg').replace('{n}', String(FREE_DAILY_STORY_LIMIT)),
    reason: 'free',
  };
}

/**
 * 声音克隆门禁。
 * ---------------------------------------------------------------------------
 * 规则（v104 最终口径）：
 *   · 必须先登录（克隆声线绑定账号；未登录既无法保存/恢复，也违背「付费绑定账号」原则）。
 *   · 会员（月付 / 年付）无限次克隆。
 *   · 免费用户登录后仅 1 次克隆体验；已用过则拦截。
 */
export async function checkVoiceCloneGate(): Promise<GateResult> {
  // 必须先登录：动态 import 避免与 auth 形成静态依赖环
  try {
    const { getSession } = await import('./auth');
    const session = await getSession();
    if (!session) {
      return {
        allowed: false,
        title: ts('gate.cloneLoginTitle'),
        message: ts('gate.cloneLoginMsg'),
        reason: 'free',
      };
    }
  } catch {
    // 登录模块不可用时退回会员判断，避免把功能彻底卡死
  }

  const snap = await getSnapshot();
  if (snap.premium) return { allowed: true };

  const used = await getFreeCloneUsed();
  if (used) {
    return {
      allowed: false,
      title: ts('gate.cloneUsedTitle'),
      message: ts('gate.cloneUsedMsg'),
      reason: 'free',
    };
  }
  return { allowed: true };
}

/** 旅行打卡门禁（累计额度） */
export async function checkCheckInGate(): Promise<GateResult> {
  const snap = await getSnapshot();
  if (snap.premium) return { allowed: true };

  if (snap.checkInsRemaining !== null && snap.checkInsRemaining <= 0) {
    return {
      allowed: false,
      title: ts('gate.checkinTitle'),
      message: ts('gate.checkinMsg').replace('{n}', String(FREE_TOTAL_CHECKIN_LIMIT)),
      reason: 'free',
    };
  }
  return { allowed: true };
}

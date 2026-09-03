/**
 * services/entitlement.ts — 会员权益与免费额度判定
 *
 * 只负责「能不能用、还剩几次」，不碰 IAP 的购买流程（那是 services/iap.ts 的事）。
 * 免费额度与 subscription.tsx 的对比表必须保持一致，改这里记得同步改表。
 *
 * 当前规则：
 *   每日生成故事   免费 1 次 / 会员无限
 *   旅行打卡       免费累计 3 次 / 会员无限
 *   声音克隆       仅会员
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getProgress } from './storage';
import { isPremium, type Plan } from './iap';

// ---------------------------------------------------------------------------
// 免费额度（改这里会自动同步到 UI 文案）
// ---------------------------------------------------------------------------

export const FREE_DAILY_STORY_LIMIT = 1;
export const FREE_TOTAL_CHECKIN_LIMIT = 3;

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
  /** 今天还能生成几个；会员为 null 表示不限 */
  storiesRemaining: number | null;
  /** 累计打卡次数 */
  checkInsUsed: number;
  /** 还能打卡几次；会员为 null 表示不限 */
  checkInsRemaining: number | null;
}

/** 门禁判定结果。allowed=false 时带可直接弹窗的中文文案 */
export type GateResult =
  | { allowed: true }
  | { allowed: false; title: string; message: string };

// ---------------------------------------------------------------------------
// 用量记录（按本地日期，跨天自动重置）
// ---------------------------------------------------------------------------

/** 本地日期键，避免 toISOString 的 UTC 偏移导致跨天判断提前/滞后 */
function todayKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function readUsage(): Promise<DailyUsage> {
  const today = todayKey();
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DailyUsage;
      // 跨天则清零，不保留昨天的计数
      if (parsed && parsed.date === today && typeof parsed.storyCount === 'number') {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[Entitlement] readUsage failed:', err);
  }
  return { date: today, storyCount: 0 };
}

async function writeUsage(usage: DailyUsage): Promise<void> {
  try {
    await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch (err) {
    console.warn('[Entitlement] writeUsage failed:', err);
  }
}

/** 成功生成一个故事后调用，计入当日额度 */
export async function recordStoryGenerated(): Promise<void> {
  const usage = await readUsage();
  usage.storyCount += 1;
  await writeUsage(usage);
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
    storiesRemaining: premium
      ? null
      : Math.max(0, FREE_DAILY_STORY_LIMIT - usage.storyCount),
    checkInsUsed,
    checkInsRemaining: premium
      ? null
      : Math.max(0, FREE_TOTAL_CHECKIN_LIMIT - checkInsUsed),
  };
}

// ---------------------------------------------------------------------------
// 门禁
// ---------------------------------------------------------------------------

/** 生成故事前的门禁（每日额度） */
export async function checkStoryGate(): Promise<GateResult> {
  const snap = await getSnapshot();
  if (snap.premium) return { allowed: true };

  if (snap.storiesRemaining !== null && snap.storiesRemaining <= 0) {
    return {
      allowed: false,
      title: '今日额度已用完',
      message: `免费版每天可以生成 ${FREE_DAILY_STORY_LIMIT} 个故事，明天再来吧。升级会员即可无限生成。`,
    };
  }
  return { allowed: true };
}

/** 声音克隆门禁（仅会员） */
export async function checkVoiceCloneGate(): Promise<GateResult> {
  const snap = await getSnapshot();
  if (snap.premium) return { allowed: true };

  return {
    allowed: false,
    title: '会员专属功能',
    message: '声音克隆可以录制家人的声音来讲故事，升级会员即可使用。',
  };
}

/** 旅行打卡门禁（累计额度） */
export async function checkCheckInGate(): Promise<GateResult> {
  const snap = await getSnapshot();
  if (snap.premium) return { allowed: true };

  if (snap.checkInsRemaining !== null && snap.checkInsRemaining <= 0) {
    return {
      allowed: false,
      title: '打卡次数已用完',
      message: `免费版可以打卡 ${FREE_TOTAL_CHECKIN_LIMIT} 个景点，升级会员即可无限打卡。`,
    };
  }
  return { allowed: true };
}

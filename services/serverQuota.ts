/**
 * services/serverQuota.ts — 服务端额度与免费权益（防改时间 / 防重装重置）
 *
 * 为什么需要它：
 *   上线前的额度是「本地 AsyncStorage + 手机本地日期」：
 *     · 把手机日期调快一天 → 额度立刻重置，可以无限白嫖 AI 生成；
 *     · 卸载重装 → 「1 次免费克隆」又回来了。
 *   两者都是会被真实用户发现的漏洞，所以额度与免费权益必须落到 Supabase：
 *     daily_usage / user_rights 两张表 RLS 全关（客户端直接读写一律拒绝），
 *     只开 SECURITY DEFINER 的 RPC，函数内部用 auth.uid() 认人、用**服务器时间**算日期。
 *
 * 离线时怎么办：
 *   所有函数都返回 `null` 表示「服务端不可用」，调用方（entitlement / storage）
 *   退回本地记录。但本地会记住「最后一次服务端确认过的日期」：
 *   只要手机日期跑到了那个日期之后、而服务端又没确认，就**不重置额度**
 *   —— 这正是「调快时间白嫖」的堵口。
 *   注：AI 生成本身必须联网，所以离线时这条降级不会伤害正常用户。
 *
 * 部署前提：执行 supabase/migrations/20261106_server_quota_rights.sql
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

/** 用途：AI 故事 / 问答 / 打卡 */
export type QuotaKind = 'story' | 'qa' | 'checkin';

/** 服务端确认过的用量镜像：离线时靠它判断「能不能重置」 */
const MIRROR_KEY = 'rms_server_usage_mirror';

export interface UsageRow {
  /** 服务端按用户时区算出来的日期 YYYY-MM-DD */
  day: string;
  used: number;
}

interface Mirror {
  /** 最后一次服务端确认的日期 */
  day: string;
  /** 该日期的各用途用量 */
  used: Partial<Record<QuotaKind, number>>;
}

function client() {
  return supabase;
}

/**
 * 带超时的 RPC：Supabase 的 fetch 默认没有超时，跨洋链路一卡就是几十秒，
 * 会把「打开创作页」直接拖死。这里统一 5 秒超时，超时就当作「服务端不可用」，
 * 调用方自动退回本地记录，绝不让配额查询卡住界面。
 */
async function rpcWithTimeout(
  sb: NonNullable<ReturnType<typeof client>>,
  name: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: { message?: string } | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch {
      /* 忽略 */
    }
  }, 5000);
  try {
    const { data, error } = await sb.rpc(name as never, args as never).abortSignal(ctrl.signal);
    return { data, error };
  } catch (err) {
    return { data: null, error: { message: String(err) } };
  } finally {
    clearTimeout(timer);
  }
}

/** 用户时区偏移（分钟，东八区 = +480）。钳在 ±14 小时内，客户端改时区也只能挪动一次日界。 */
export function tzMinutes(): number {
  try {
    const off = -new Date().getTimezoneOffset();
    return Math.max(-840, Math.min(840, Math.round(off)));
  } catch {
    return 0;
  }
}

async function hasSession(): Promise<boolean> {
  const sb = client();
  if (!sb) return false;
  try {
    const { data } = await sb.auth.getSession();
    return !!data?.session?.user?.id;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 本地镜像
// ---------------------------------------------------------------------------

export async function readMirror(): Promise<Mirror | null> {
  try {
    const raw = await AsyncStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Mirror;
    if (!parsed || typeof parsed.day !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeMirror(day: string, kind: QuotaKind, used: number): Promise<void> {
  try {
    const prev = (await readMirror()) ?? { day, used: {} };
    // 只保留「同一天」的记录；日期变了就整份换掉
    const next: Mirror = prev.day === day ? { day, used: { ...prev.used, [kind]: used } } : { day, used: { [kind]: used } };
    await AsyncStorage.setItem(MIRROR_KEY, JSON.stringify(next));
  } catch {
    /* 镜像只是降级用的，写失败不影响主流程 */
  }
}

// ---------------------------------------------------------------------------
// 额度
// ---------------------------------------------------------------------------

/**
 * 读今天的用量（不消耗）。
 * @returns null = 服务端不可用 / 未登录（调用方退回本地）
 */
export async function peekUsage(kind: QuotaKind): Promise<UsageRow | null> {
  const sb = client();
  if (!sb) return null;
  if (!(await hasSession())) return null;
  try {
    const { data, error } = await rpcWithTimeout(sb, 'peek_daily_usage', {
      p_kind: kind,
      p_tz_minutes: tzMinutes(),
    });
    if (error) {
      console.warn('[ServerQuota] peek failed:', error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const day = String(row.day ?? '');
    const used = Number(row.used ?? 0);
    if (!day) return null;
    await writeMirror(day, kind, used);
    return { day, used: Number.isFinite(used) ? used : 0 };
  } catch (err) {
    console.warn('[ServerQuota] peek exception:', err);
    return null;
  }
}

/**
 * 原子消耗一次。
 * @returns null = 服务端不可用（调用方自行本地 +1）；
 *          { allowed:false } = 服务端判定已达上限（并发下被别的设备抢先用掉）
 */
export async function consumeQuota(
  kind: QuotaKind,
  limit: number,
): Promise<{ allowed: boolean; used: number; day: string } | null> {
  const sb = client();
  if (!sb) return null;
  if (!(await hasSession())) return null;
  try {
    const { data, error } = await rpcWithTimeout(sb, 'consume_daily_quota', {
      p_kind: kind,
      p_limit: limit,
      p_tz_minutes: tzMinutes(),
    });
    if (error) {
      console.warn('[ServerQuota] consume failed:', error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const day = String(row.day ?? '');
    const used = Number(row.used ?? 0);
    const allowed = !!row.allowed;
    if (day) await writeMirror(day, kind, used);
    return { allowed, used, day };
  } catch (err) {
    console.warn('[ServerQuota] consume exception:', err);
    return null;
  }
}

/** 退还一次（生成失败 / 超时放弃时用）。成功后同步更新镜像。 */
export async function refundQuota(kind: QuotaKind): Promise<number | null> {
  const sb = client();
  if (!sb) return null;
  if (!(await hasSession())) return null;
  try {
    const { data, error } = await rpcWithTimeout(sb, 'refund_daily_quota', {
      p_kind: kind,
      p_tz_minutes: tzMinutes(),
    });
    if (error) {
      console.warn('[ServerQuota] refund failed:', error.message);
      return null;
    }
    const used = Number(Array.isArray(data) ? data[0] : data);
    const mirror = await readMirror();
    if (mirror && Number.isFinite(used)) await writeMirror(mirror.day, kind, used);
    return Number.isFinite(used) ? used : null;
  } catch (err) {
    console.warn('[ServerQuota] refund exception:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 免费权益（1 次克隆 + 1 篇指定故事）
// ---------------------------------------------------------------------------

export interface ServerRights {
  freeCloneUsed: boolean;
  freeCloneStoryId: string;
  freeCloneTarget: string;
}

/** 读服务端权益；null = 服务端不可用 */
/** 30 秒内存缓存：权益很少变，但页面里会被多处并发读取，避免每次都打一次 RPC */
let rightsCache: { at: number; value: ServerRights } | null = null;
const RIGHTS_TTL_MS = 30_000;

function invalidateRightsCache(): void {
  rightsCache = null;
}

export async function getServerRights(): Promise<ServerRights | null> {
  const sb = client();
  if (!sb) return null;
  if (rightsCache && Date.now() - rightsCache.at < RIGHTS_TTL_MS) return rightsCache.value;
  if (!(await hasSession())) return null;
  try {
    const { data, error } = await rpcWithTimeout(sb, 'get_my_rights', undefined);
    if (error) {
      console.warn('[ServerQuota] rights failed:', error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const value: ServerRights = {
      freeCloneUsed: !!row.free_clone_used,
      freeCloneStoryId: String(row.free_clone_story_id ?? ''),
      freeCloneTarget: String(row.free_clone_target ?? ''),
    };
    rightsCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.warn('[ServerQuota] rights exception:', err);
    return null;
  }
}

/**
 * 原子占用那一次免费克隆。
 * @returns true 占用成功；false 服务端说已经用过；null 服务端不可用
 */
export async function claimFreeCloneOnServer(target: string): Promise<boolean | null> {
  const sb = client();
  if (!sb) return null;
  if (!(await hasSession())) return null;
  try {
    const { data, error } = await rpcWithTimeout(sb, 'claim_free_clone', { p_target: target });
    if (error) {
      console.warn('[ServerQuota] claim failed:', error.message);
      return null;
    }
    invalidateRightsCache();
    return !!data;
  } catch (err) {
    console.warn('[ServerQuota] claim exception:', err);
    return null;
  }
}

/** 记录免费用户被指定到的那一篇故事 */
export async function setFreeCloneStoryOnServer(storyId: string): Promise<boolean> {
  const sb = client();
  if (!sb) return false;
  if (!(await hasSession())) return false;
  try {
    const { error } = await rpcWithTimeout(sb, 'set_free_clone_story', { p_story_id: storyId });
    if (error) {
      console.warn('[ServerQuota] set story failed:', error.message);
      return false;
    }
    invalidateRightsCache();
    return true;
  } catch (err) {
    console.warn('[ServerQuota] set story exception:', err);
    return false;
  }
}

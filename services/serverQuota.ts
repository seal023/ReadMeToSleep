/**
 * services/serverQuota.ts — 服务端额度/权益（去 Supabase 化后为「本地兼容层」）
 *
 * 2026-11-17 去 Supabase：删掉全部 sb.rpc / hasSession / supabase 引用。
 * 保留本文件与所有导出签名，让调用方（entitlement.ts / storage.ts）零改动——
 * 所有函数统一返回 null / false，语义即「服务端不可用，请在本地记账」。
 * 这正是 Supabase 域名失效这段时间 App 实际一直在走的路径，已被真机验证可用。
 *
 * 调用方的本地降级逻辑（deserves 保留在各自文件里）：
 *   · entitlement.ts  readUsage()      —— peekUsage 为 null 时按本地日期读用量
 *   · entitlement.ts  recordStoryGenerated() —— consumeQuota 为 null 时本地 +1
 *   · storage.ts      getFreeCloneUsed 等 —— getServerRights 为 null 时用 AsyncStorage
 *
 * ⚠️ readMirror() 刻意恒返回 null：
 *    旧逻辑会在「手机日期 ≠ 服务端最后确认日」时拒绝重置额度（防改时间白嫖）。
 *    那里面的 mirror 曾是服务端写入的；如今再无服务端确认，若继续读旧 mirror，
 *    日期一旦变化就永远返回「旧那天的用量」——额度永久锁死、用户再也拿不到每日次数。
 *    去后端后按清单接受「改系统时间可刷额度」的代价，因此彻底停用 mirror，
 *    让 entitlement 直接走本地日历重置。普通用户无感。
 */

/** 用途：AI 故事 / 问答 / 打卡 */
export type QuotaKind = 'story' | 'qa' | 'checkin';

export interface UsageRow {
  /** 本地日期 YYYY-MM-DD */
  day: string;
  used: number;
}

export interface ServerRights {
  freeCloneUsed: boolean;
  freeCloneStoryId: string;
  freeCloneTarget: string;
}

/** 用量镜像（保留类型形状供 entitlement.ts 使用；去后端后 readMirror 恒返回 null） */
export interface Mirror {
  day: string;
  used: Partial<Record<QuotaKind, number>>;
}

/** 用户时区偏移（分钟，东八区 = +480）。保留给将来可能的本地日期计算。 */
export function tzMinutes(): number {
  try {
    const off = -new Date().getTimezoneOffset();
    return Math.max(-840, Math.min(840, Math.round(off)));
  } catch {
    return 0;
  }
}

/**
 * 服务端确认过的用量镜像。去后端后恒为 null（见文件头说明，避免额度锁死）。
 */
export async function readMirror(): Promise<Mirror | null> {
  return null;
}

/** 读今天的用量：恒返回 null，调用方走本地记账。 */
export async function peekUsage(_kind: QuotaKind): Promise<UsageRow | null> {
  return null;
}

/** 原子消耗一次：恒返回 null，调用方本地 +1。 */
export async function consumeQuota(
  _kind: QuotaKind,
  _limit: number,
): Promise<{ allowed: boolean; used: number; day: string } | null> {
  return null;
}

/** 退还一次：恒返回 null。 */
export async function refundQuota(_kind: QuotaKind): Promise<number | null> {
  return null;
}

/** 读免费权益：恒返回 null，调用方用本地 AsyncStorage。 */
export async function getServerRights(): Promise<ServerRights | null> {
  return null;
}

/** 原子占用免费克隆：恒返回 null，调用方只写本地。 */
export async function claimFreeCloneOnServer(_target: string): Promise<boolean | null> {
  return null;
}

/** 记录免费克隆专属故事：恒返回 false（无服务端可写）。 */
export async function setFreeCloneStoryOnServer(_storyId: string): Promise<boolean> {
  return false;
}

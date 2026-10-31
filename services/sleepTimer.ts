import { fadeOutAndStop } from './clonedVoicePlayback';

/**
 * 睡眠定时管理器（单例）
 * ---------------------------------------------------------------------------
 * 用途：防止小朋友睡着后故事还在不停播放。
 *
 * 工作方式：
 *   - 家长在「睡眠定时」里设定分钟数（0 = 关闭）；
 *   - 孩子每次点「播放」时启动一个倒计时会话（读取最新设置）；
 *   - 倒计时到点：先温和淡出克隆/本地声（系统音直接停），停止一切播放，
 *     再回调 onExpire，由故事页切到「晚安」锁屏；
 *   - 故事自然讲完（handleStoryEnded）或手动停止/退出页面 → 取消会话。
 *
 * 设计为「单例 + 回调」，避免把倒计时状态散落到各个页面。
 */

interface SleepSession {
  expiresAt: number;
  lockEnabled: boolean;
  onExpire: () => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

let session: SleepSession | null = null;

/** 是否正在睡眠定时会话中 */
export function isSleepSessionActive(): boolean {
  return session !== null;
}

/** 剩余毫秒数（未激活返回 0） */
export function getSleepRemainingMs(): number {
  if (!session) return 0;
  return Math.max(0, session.expiresAt - Date.now());
}

/** 启动一个睡眠定时会话；若已有会话则先取消再重建（连续播放不重置已设上限） */
export function startSleepSession(opts: {
  minutes: number;
  lockEnabled: boolean;
  onExpire: () => void;
}): void {
  cancelSleepSession();
  if (!opts.minutes || opts.minutes <= 0) return;
  const expiresAt = Date.now() + opts.minutes * 60_000;
  const timeoutId = setTimeout(() => {
    void expire();
  }, opts.minutes * 60_000);
  session = {
    expiresAt,
    lockEnabled: opts.lockEnabled,
    onExpire: opts.onExpire,
    timeoutId,
  };
}

/** 取消当前睡眠定时会话（自然结束 / 手动停止 / 退出页面时调用） */
export function cancelSleepSession(): void {
  if (session) {
    clearTimeout(session.timeoutId);
    session = null;
  }
}

/** 当前会话是否「到点锁定」 */
export function getCurrentLockEnabled(): boolean {
  return session?.lockEnabled ?? false;
}

/** 到点：温和淡出并停止所有播放，再触发回调 */
async function expire(): Promise<void> {
  const s = session;
  if (!s) return;
  session = null;
  try {
    await fadeOutAndStop(8);
  } catch {
    /* 兜底：fadeOutAndStop 内部已确保停止 */
  }
  s.onExpire();
}

/**
 * 家长门会话守卫（Parent Gate）
 * ---------------------------------------------------------------------------
 * Kids Category / App Store 1.3 & 5.1.4：进入家长区（订阅、设置、声音克隆、
 * 敏感词、账号……）必须先过 4 位 PIN 门，孩子不能一步直达。
 *
 * 设计要点：
 *  · "已验证"状态只放内存、不落盘：App 每次冷启动都要重新输 PIN，避免孩子
 *    翻文件系统/偏好设置绕过；PIN 本身仍由 storage 持久化（家长自己设的）。
 *  · 切到后台延迟上锁：家长验证完把手机递给孩子，孩子切出去再回来仍需重新
 *    验证；用 15s 延迟是为了避免锁屏/系统瞬时切换把家长自己锁在外面。
 *  · 记住被拦截的目标路由：孩子误点会员卡 → 弹 PIN → 家长输对后直接跳回
 *    原本想去的页面，体验连贯。
 *
 * 该模块被 app/(parent)/_layout.tsx（统一守卫）与 app/(parent)/index.tsx
 * （验证成功后 markVerified）共同使用。
 */

let verified = false;

/** 被守卫拦截时暂存的原始目标路由（验证成功后跳回，取一次即清空） */
let pendingTarget: string | null = null;

/** 切后台多久后自动上锁 */
const BACKGROUND_LOCK_DELAY_MS = 15_000;
let backgroundLockTimer: ReturnType<typeof setTimeout> | null = null;

/** PIN 验证 / 首次设置成功后调用：解锁家长区 */
export function markParentVerified(): void {
  verified = true;
  cancelBackgroundLock();
}

/** 当前家长区是否已通过 PIN 验证 */
export function isParentVerified(): boolean {
  return verified;
}

/** 主动上锁（退出家长模式时调用） */
export function lockParent(): void {
  verified = false;
}

/** App 进入后台：延迟上锁 */
export function scheduleBackgroundLock(): void {
  cancelBackgroundLock();
  backgroundLockTimer = setTimeout(() => {
    verified = false;
    backgroundLockTimer = null;
  }, BACKGROUND_LOCK_DELAY_MS);
}

/** App 回到前台：撤销尚未触发的延迟上锁 */
export function cancelBackgroundLock(): void {
  if (backgroundLockTimer) {
    clearTimeout(backgroundLockTimer);
    backgroundLockTimer = null;
  }
}

/** 记住被拦截的目标路由 */
export function setPendingParentTarget(target: string | null): void {
  pendingTarget = target;
}

/** 取出并清空被拦截的目标路由 */
export function takePendingParentTarget(): string | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

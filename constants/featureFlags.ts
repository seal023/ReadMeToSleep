/**
 * constants/featureFlags.ts — 全局功能开关
 *
 * 这里只放「临时关闭某个入口、但保留完整实现」的开关。
 * 开关为 false 时，UI 入口隐藏，底层代码（services/、hooks/、深链路由）一律不动，
 * 改回 true 就能原样恢复，不需要回忆当初删了什么。
 */

/**
 * 邮件登录（邮箱验证码 / 魔法链接）
 *
 * 当前为 false —— 入口从界面隐藏，但功能完整保留：
 *  - services/auth.ts 的 sendCode / verifyCode 未改动
 *  - hooks/useAuth.tsx 的深链监听器仍在运行
 *  - app/auth-callback.tsx 仍能承接 readmetosleep://auth-callback 深链
 *  也就是说，已经发出的旧邮件链接点进来依然能登录成功，只是用户不能在 App 内
 *  主动发起「发送验证码」。
 *
 * 关闭原因（2026-11-01）：
 *  Supabase 免费版内置邮件服务限流约 2 封/小时，且只投递给 Supabase 组织成员邮箱，
 *  真实用户收不到信；同时免费版邮件模板被锁定，无法插入 {{ .Token }} 发 6 位验证码。
 *  等接入 SMTP2GO（自定义 SMTP）后，把这里改成 true 即可恢复，无需改其它文件。
 */
export const EMAIL_LOGIN_ENABLED: boolean = false;

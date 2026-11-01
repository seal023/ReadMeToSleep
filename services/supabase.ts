/**
 * services/supabase.ts — 账号后端客户端（Supabase）
 *
 * 为什么需要后端：
 *   邮件验证码登录必须由服务器签发/校验验证码，客户端做不到；
 *   而「Apple 登录」与「邮件登录」又要落进同一个用户体系（同一个人要有同一个 Pro 权益），
 *   所以两者统一走 Supabase Auth：Apple 用 identityToken 换 session，邮件走 OTP。
 *   会话持久化在 AsyncStorage，重开 App 不需要重新登录。
 *
 * ⚠️ 关键坑（务必保持字面量写法）：
 *   Expo/Metro 只重写「以 process.env 为对象的成员表达式」，即只认
 *   `process.env.EXPO_PUBLIC_XXX` 这种字面量。
 *   写成 `(globalThis as any)?.process?.env?.EXPO_PUBLIC_XXX` 或动态 key
 *   会被内联成 undefined，运行期永远拿不到值（本项目已踩过一次，AI Key 全空）。
 *
 * 未配置时的行为：isAuthConfigured === false，supabase === null。
 *   此时 App 仍然完全可用（本地模式），只是登录入口会提示"账号服务尚未配置"。
 *   这样即使构建机漏配环境变量，也不会白屏或崩溃。
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 内置兜底值。
 *
 * 为什么允许把这两个值写进代码：
 *   Supabase 的 publishable / anon key **在设计上就是嵌在客户端里的公开密钥**
 *   （官方名称即 publishable，用于匿名身份访问受 RLS 保护的数据；
 *   真正的权限由 Row Level Security 与 Auth 决定，它本身读不到别人的数据）。
 *   而且它本来就会被打进 JS bundle —— 写在这里不增加任何额外暴露面。
 *
 * 为什么需要兜底：
 *   构建 62 就是因为 Xcode Cloud 工作流漏注入这两个变量，整个包的登录与购买
 *   直接不可用，而这种故障只有在真机上才看得见。有了兜底，环境变量配错也不会
 *   再把登录打死；有环境变量时仍以环境变量为准（方便将来换项目）。
 *
 * ⚠️ 将来若要更换 Supabase 项目，改这里 + Xcode Cloud 环境变量两处即可。
 */
const FALLBACK_SUPABASE_URL = 'https://mgdtkvkhtdusdnfkdrdg.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'sb_publishable_yYa6v-Bw7IEHqTNRhuyZlQ_zFh4H6j2';

// —— 必须是字面量，不要抽成动态取值（见文件头说明）——
// 用 || 而非 ??：构建机漏配时 .env 里会是空串（''），?? 不会兜底，|| 会。
// 另外 Xcode Cloud 后台粘贴的值常带首尾引号或空格，这里一并剥掉，
// 否则 createClient 会拿到 'https://..."' 这种坏值，报错还很难看懂。
const clean = (v: string) => v.trim().replace(/^["']+|["']+$/g, '').trim();
const SUPABASE_URL = clean(process.env.EXPO_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL);
const SUPABASE_ANON_KEY = clean(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY
);

/** 账号服务是否已配置（构建时是否注入了 URL + anon key） */
export const isAuthConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = isAuthConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // 会话持久化：写入 AsyncStorage，杀进程重开仍是登录态
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // RN 没有浏览器地址栏，必须关掉（否则会尝试从 location 解析 token 报错）
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * 读取一个「用户可见」的账号标识。
 * Apple 登录只有首次授权才返回邮箱，后续可能为空，所以统一回落到 uid 前 8 位。
 */
export function accountLabel(email?: string | null, uid?: string | null): string {
  if (email && email.length > 0) return email;
  if (uid && uid.length >= 8) return `Apple 账号 · ${uid.slice(0, 8)}`;
  return '已登录';
}

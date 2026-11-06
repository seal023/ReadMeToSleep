/**
 * services/cloudFetch.ts — 云服务请求出口（可在「直连」与「代理」之间切换）
 *
 * 为什么需要它（防白嫖的最后一块）：
 *   Expo 的 EXPO_PUBLIC_* 会被 Metro **静态内联**进 JS bundle，
 *   也就是说 `EXPO_PUBLIC_AI_API_KEY` 会以明文字符串躺在 IPA 里，
 *   任何人解包就能拿到你的百炼 Key，绕开 App 直接刷你的账单。
 *   唯一根治办法：Key 不下发到客户端，App 只拿用户的 Supabase JWT 去调一层代理，
 *   由代理（Supabase Edge Function）校验身份后再用服务端密钥转发。
 *
 * 开关：
 *   配置 `EXPO_PUBLIC_AI_PROXY_URL`（如 https://<ref>.functions.supabase.co/bailian-proxy）
 *   → 所有云请求自动改走代理，并携带 `Authorization: Bearer <supabase access_token>`。
 *   未配置 → 维持原有直连行为（本版默认）。部署好代理并在构建机加上这个变量后，
 *   就可以把 EXPO_PUBLIC_AI_API_KEY 从构建环境里删掉，Key 从此不进包。
 *
 * 代理侧代码：supabase/functions/bailian-proxy/index.ts（附部署说明）
 */

import { getSession } from './auth';
import { supabase } from './supabase';

/** 代理地址（未配置 = 直连） */
export const PROXY_URL = (process.env.EXPO_PUBLIC_AI_PROXY_URL || '').trim().replace(/\/+$/, '');

/** 是否已经切到代理模式 */
export const USE_AI_PROXY = !!PROXY_URL;

/** 把上游地址包成代理地址 */
export function proxyUrl(upstream: string): string {
  if (!USE_AI_PROXY) return upstream;
  return `${PROXY_URL}?u=${encodeURIComponent(upstream)}`;
}

/**
 * 代理模式下的鉴权头（取当前 Supabase 会话的 access_token）。
 * 未登录时抛错，由调用方降级到本地能力（绝不带着空 token 去打代理）。
 */
export async function proxyAuthHeaders(): Promise<Record<string, string>> {
  if (!USE_AI_PROXY) return {};
  const session = await getSession();
  const token = session?.access_token;
  if (!token) throw new Error('AI_PROXY_NOT_AUTHENTICATED');
  return { Authorization: `Bearer ${token}` };
}

/**
 * 与原生 fetch 同签名：代理开启时改写地址并注入 JWT，其余（body / content-type /
 * multipart 边界）原样透传 —— 这样语音克隆的录音上传也能走同一条通道。
 */
export async function cloudFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!USE_AI_PROXY) return fetch(input, init);
  const auth = await proxyAuthHeaders();
  const headers = new Headers(init.headers as HeadersInit);
  headers.set('Authorization', auth.Authorization);
  return fetch(proxyUrl(input), { ...init, headers });
}

/** supabase 是否可用（仅用于诊断显示） */
export function isProxyBacked(): boolean {
  return USE_AI_PROXY && !!supabase;
}

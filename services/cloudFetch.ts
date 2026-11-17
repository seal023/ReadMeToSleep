/**
 * services/cloudFetch.ts — 云服务请求出口（去 Supabase 化后恒为直连 fetch）
 *
 * 原本可切换「代理模式」：配 EXPO_PUBLIC_AI_PROXY_URL 后把 AI 请求改走 Supabase
 * Edge Function、并携带 Supabase JWT（目的是把 Key 藏到服务端）。但该开关从未启用，
 * 本版默认一直直连。去 Supabase 后代理失去鉴权来源，故彻底移除代理逻辑，
 * cloudFetch 退化为原生 fetch 的别名。
 *
 * 保留全部导出签名（USE_AI_PROXY / proxyUrl / proxyAuthHeaders / cloudFetch /
 * isProxyBacked），让 ai.ts、voiceClone.ts 的调用点零改动：
 *   · USE_AI_PROXY 恒 false → ai.ts 永远走「直连 + API Key」分支（现状）
 *   · proxyUrl 原样返回入参
 *   · proxyAuthHeaders 返回空对象
 *
 * ⚠️ AI Key 仍以 EXPO_PUBLIC_* 明文打进包——这是现状，去 Supabase 不使其变差。
 *    将来要藏 Key 需另起 Cloudflare Worker 之类代理，与本版本无关。
 */

/** 代理已移除：恒为 false */
export const USE_AI_PROXY = false;

/** 保留导出兼容（可能用于诊断显示），恒为空 */
export const PROXY_URL = '';

/** 原样返回上游地址，不做任何改写 */
export function proxyUrl(upstream: string): string {
  return upstream;
}

/** 代理已移除：无鉴权头 */
export async function proxyAuthHeaders(): Promise<Record<string, string>> {
  return {};
}

/** 与原生 fetch 同签名：去后端后就是 fetch 本身 */
export async function cloudFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, init);
}

/** 保留导出兼容，恒为 false */
export function isProxyBacked(): boolean {
  return false;
}

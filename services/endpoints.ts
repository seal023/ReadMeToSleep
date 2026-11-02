/**
 * 端点规范化（单一真源）
 * ---------------------------------------------------------------------------
 * 背景：百炼给到的 Base URL 有两种写法，用户在控制台里复制到的往往是「完整串」：
 *
 *   ① 只到主机：  https://ws-xxxx.ap-southeast-1.maas.aliyuncs.com
 *   ② 带版本路径：https://ws-xxxx.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
 *
 * 但代码内部是「主机 + 固定路径」自己拼的（chat 拼 /compatible-mode/v1/chat/completions，
 * 声音复刻拼 /api/v1/services/audio/tts/customization）。一旦用户按 ② 的形式填进
 * Xcode Cloud，就会拼出
 *   .../compatible-mode/v1/compatible-mode/v1/chat/completions
 *   .../compatible-mode/v1/api/v1/services/audio/tts/customization
 * → 404 / 鉴权怪错，且 AI 会静默降级成内置故事、克隆会静默失败，极难排查。
 *
 * 所以这里统一「只取协议 + 主机」（origin），把用户填的路径部分一律丢掉，
 * 各调用点再拼自己的固定路径。这样 ① ② 两种写法都能工作，且不会重复拼接。
 *
 * 额外兜底：手输时容易漏 https://、粘连空格、写成 http://（iOS ATS 会拦截）、
 * 末尾多斜杠，全部在这里一次修掉。
 */

const DEFAULT_ORIGIN = 'https://ws-6f52kltpls7886bp.ap-southeast-1.maas.aliyuncs.com';

/**
 * 把任意形态的 Base URL 归一成 `https://host`（不含路径、不含尾斜杠）。
 * 输入非法/为空时返回调用方给的 fallback（默认内置 workspace 主机）。
 */
export function endpointOrigin(raw?: string, fallback?: string): string {
  const fb = (fallback ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
  if (!raw || !raw.trim()) return fb;

  // 去掉所有空白（含从控制台复制时掺进来的换行/全角空格）与包裹的引号
  let s = raw.replace(/[\s\u3000]/g, '').replace(/^["']+|["']+$/g, '');

  // 缺协议时补 https（http:// 后面统一升级，iOS ATS 不接受明文）
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  if (/^http:\/\//i.test(s)) s = 'https://' + s.slice('http://'.length);

  // 只保留 scheme + host（丢弃 path / query / hash）
  const m = s.match(/^https:\/\/[^/?#]+/i);
  if (!m) return fb;
  return m[0];
}

/** OpenAI 兼容 chat 端点：{origin}/compatible-mode/v1/chat/completions */
export function chatCompletionsUrl(raw?: string): string {
  return `${endpointOrigin(raw)}/compatible-mode/v1/chat/completions`;
}

/** 声音复刻（音色注册）端点：{origin}/api/v1/services/audio/tts/customization */
export function voiceEnrollUrl(raw?: string): string {
  return `${endpointOrigin(raw)}/api/v1/services/audio/tts/customization`;
}

/** 语音合成端点：{origin}/api/v1/services/audio/tts/SpeechSynthesizer */
export function voiceSynthUrl(raw?: string): string {
  return `${endpointOrigin(raw)}/api/v1/services/audio/tts/SpeechSynthesizer`;
}

/** 内置默认主机（未配置 EXPO_PUBLIC_AI_BASE_URL 时使用） */
export const DEFAULT_ENDPOINT_ORIGIN = DEFAULT_ORIGIN;

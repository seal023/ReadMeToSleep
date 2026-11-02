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
 * ★ v80 事故修复：**绝不写死某个业务空间**
 * ---------------------------------------------------------------------------
 * 旧版这里有个 `DEFAULT_ORIGIN = 'https://ws-6f52kltpls7886bp...'` 的兜底。
 * 一旦构建机上 EXPO_PUBLIC_AI_BASE_URL 没取到（空串），App 就静默用「旧空间」
 * 域名 + 「新空间」的 Key 发请求 → 403 Workspace endpoint access denied，
 * 界面只报「AI 请求失败」，看不出是地址错了。
 *
 * 现在改成两重保险：
 *   1. Base URL 缺失时，用 EXPO_PUBLIC_VOICE_WORKSPACE_ID 推导专属域名
 *      （Key 一定绑定在某个业务空间上，而 workspace id 是必填项，比 Base URL 更难漏）；
 *   2. Base URL 里的空间 ID 与 WORKSPACE_ID 不一致时，**以 WORKSPACE_ID 为准重建主机**。
 *      Key 只认它所属空间的域名，这样即使云端填了过期的 Base URL 也能自愈。
 * 两者都没有时返回空串，由调用方明确判定「未配置」，不再静默打到某个真实域名。
 *
 * 额外兜底：手输时容易漏 https://、粘连空格、写成 http://（iOS ATS 会拦截）、
 * 末尾多斜杠，全部在这里一次修掉。
 */

/** 默认地域（新加坡）。Base URL 里只要能解析出地域就沿用它，否则用这个。 */
const DEFAULT_REGION = 'ap-southeast-1';

/**
 * ⚠️ Metro 只对 `process.env.EXPO_PUBLIC_X` 这种字面量做静态内联，
 * 不能包在变量名或可选链里，否则运行期读不到值。
 */
const ENV_BASE_URL = process.env.EXPO_PUBLIC_AI_BASE_URL as string | undefined;
const ENV_WORKSPACE_ID = (process.env.EXPO_PUBLIC_VOICE_WORKSPACE_ID as string | undefined) || '';

/** 去掉所有空白（含控制台复制时掺进来的换行/全角空格）与包裹的引号 */
function clean(raw: string): string {
  return raw.replace(/[\s\u3000]/g, '').replace(/^["'`]+|["'`]+$/g, '');
}

/** 从 host 里取出 `ws-xxxx` 空间 ID；不是业务空间域名则返回空 */
function workspaceIdFromHost(host: string): string {
  const m = host.match(/^(ws-[a-z0-9]+)\./i);
  return m ? m[1].toLowerCase() : '';
}

/** 从 host 里取出地域（如 ap-southeast-1）；取不到返回空 */
function regionFromHost(host: string): string {
  const m = host.match(/^ws-[a-z0-9]+\.([a-z0-9-]+)\.maas\.aliyuncs\.com$/i);
  return m ? m[1].toLowerCase() : '';
}

/** 拼业务空间专属域名 */
function originForWorkspace(wsId: string, region: string): string {
  return `https://${wsId}.${region}.maas.aliyuncs.com`;
}

/**
 * 把任意形态的 Base URL 归一成 `https://host`（不含路径、不含尾斜杠）。
 * 输入非法/为空时按 workspace id 推导；都拿不到则返回空串。
 *
 * @param raw      调用方显式传入的地址（可选，缺省读 EXPO_PUBLIC_AI_BASE_URL）
 * @param fallback 最后一道兜底（仅内部/测试使用，正常路径不需要）
 */
export function endpointOrigin(raw?: string, fallback?: string): string {
  const source = raw && raw.trim() ? raw : ENV_BASE_URL || '';
  const wsEnv = clean(ENV_WORKSPACE_ID).toLowerCase();

  let host = '';
  if (source.trim()) {
    let s = clean(source);
    // 缺协议时补 https（http:// 统一升级，iOS ATS 不接受明文）
    if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
    if (/^http:\/\//i.test(s)) s = 'https://' + s.slice('http://'.length);
    const m = s.match(/^https:\/\/[^/?#]+/i);
    if (m) host = m[0].slice('https://'.length);
  }

  if (host) {
    const wsInHost = workspaceIdFromHost(host);
    // ★ 自愈：Base URL 里的空间 ≠ 配置的空间时，以 WORKSPACE_ID 为准重建。
    //   Key 只认它所属空间的域名，用旧空间域名必然 403 access_denied。
    if (wsEnv && wsInHost && wsInHost !== wsEnv) {
      const region = regionFromHost(host) || DEFAULT_REGION;
      return originForWorkspace(wsEnv, region);
    }
    // 非业务空间域名（如通用 dashscope-intl）原样保留，交由调用方判断
    return `https://${host}`;
  }

  // Base URL 缺失：用 workspace id 推导专属域名（这是最可靠的兜底，不写死任何空间）
  if (wsEnv) return originForWorkspace(wsEnv, DEFAULT_REGION);

  if (fallback) return fallback.replace(/\/+$/, '');
  return '';
}

/** OpenAI 兼容 chat 端点：{origin}/compatible-mode/v1/chat/completions */
export function chatCompletionsUrl(raw?: string): string {
  const origin = endpointOrigin(raw);
  return origin ? `${origin}/compatible-mode/v1/chat/completions` : '';
}

/** 声音复刻（音色注册）端点：{origin}/api/v1/services/audio/tts/customization */
export function voiceEnrollUrl(raw?: string): string {
  const origin = endpointOrigin(raw);
  return origin ? `${origin}/api/v1/services/audio/tts/customization` : '';
}

/** 语音合成端点：{origin}/api/v1/services/audio/tts/SpeechSynthesizer */
export function voiceSynthUrl(raw?: string): string {
  const origin = endpointOrigin(raw);
  return origin ? `${origin}/api/v1/services/audio/tts/SpeechSynthesizer` : '';
}

/** 解析出的主机（供诊断页展示「地址从哪来」） */
export function resolvedOrigin(): string {
  return endpointOrigin();
}

/**
 * 诊断用：说明 origin 是从哪来的，便于真机上一眼看出是"环境变量没生效"
 * 还是"填了旧空间的地址（已被自动纠正）"。
 */
export type OriginSource = 'env' | 'env-corrected' | 'workspace' | 'none';

export function originSource(): OriginSource {
  const raw = (ENV_BASE_URL || '').trim();
  const wsEnv = clean(ENV_WORKSPACE_ID).toLowerCase();

  if (raw) {
    let s = clean(raw);
    if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
    if (/^http:\/\//i.test(s)) s = 'https://' + s.slice('http://'.length);
    const m = s.match(/^https:\/\/[^/?#]+/i);
    const host = m ? m[0].slice('https://'.length) : '';
    const wsHost = workspaceIdFromHost(host);
    if (wsEnv && wsHost && wsHost !== wsEnv) return 'env-corrected';
    return 'env';
  }
  return wsEnv ? 'workspace' : 'none';
}

/** 诊断用：当前配置的业务空间 ID（可能为空） */
export function configuredWorkspaceId(): string {
  return clean(ENV_WORKSPACE_ID);
}

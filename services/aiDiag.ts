/**
 * services/aiDiag.ts — AI 链路自检（真机上唯一能确认「环境变量到底进没进包」的办法）
 *
 * 背景：EXPO_PUBLIC_* 是构建期内联的，打包后无法从外部查看。一旦 Xcode Cloud 里
 * 那把 Key 复制错、带了空格、或 Base URL 与 Key 不属于同一个 workspace，
 * 表现都一样 —— 故事照常出来，但其实是本地兜底，肉眼分辨不出来。
 *
 * 这里直接打真实端点，把「HTTP 状态码 + 错误码」原样带回来：
 *   401 invalid_api_key → Key 本身无效（复制错 / 带空格 / 已删除）
 *   403                 → Key 有效但无权访问该 workspace / 模型
 *   404                 → 地址不对（Base URL 写错或模型路径不存在）
 *   200                 → 链路通
 *
 * 安全：只回传 Key 的长度与前 3 位，绝不回传明文。
 */

import axios from 'axios';
import { AI_CONFIG } from './ai';
import { chatCompletionsUrl } from './endpoints';

export interface AiProbe {
  /** 展示用名称，如「通用国际站」 */
  label: string;
  url: string;
  /** null 表示没拿到响应（DNS / 超时 / 断网） */
  status: number | null;
  code?: string;
  message?: string;
  ms: number;
  ok: boolean;
}

export type AiVerdict = 'ok' | 'invalid_key' | 'missing_key' | 'network' | 'unknown';

/**
 * Key 形态：
 *  - standard   传统百炼 Key，形如 sk- + 32 位（共 35 字符），任何站点都认
 *  - workspace  业务空间专属 Key，形如 sk-ws-… （约 100-130 字符），
 *               ⚠️ 只能配它所属 workspace 的专属域名，打到通用国际站必然 401，
 *               所以对这类 Key 不能拿通用站的结果判它「无效」
 */
export type AiKeyKind = 'standard' | 'workspace' | 'unknown';

export interface AiDiagResult {
  keyPresent: boolean;
  keyLength: number;
  /** 仅 'sk-…' 这种级别的前缀，用于判断是不是贴错了服务 */
  keyPrefix: string;
  keyHasWhitespace: boolean;
  /** 格式是否可识别（standard / workspace 均算可识别） */
  keyStandard: boolean;
  keyKind: AiKeyKind;
  baseUrl: string;
  model: string;
  probes: AiProbe[];
  verdict: AiVerdict;
}

const PROBE_TIMEOUT = 12_000;

function describeStatus(status: number | null, code?: string): string {
  if (status === null) return 'network';
  return code || String(status);
}

function buildBody() {
  return {
    model: AI_CONFIG.model,
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  };
}

async function probeChat(label: string, baseUrl: string, key: string): Promise<AiProbe> {
  const url = chatCompletionsUrl(baseUrl);
  const t0 = Date.now();
  try {
    const res = await axios.post(url, buildBody(), {
      timeout: PROBE_TIMEOUT,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      validateStatus: () => true,
    });
    const ms = Date.now() - t0;
    const ok = res.status >= 200 && res.status < 300;
    const err = (res.data as any)?.error;
    return {
      label,
      url,
      status: res.status,
      code: ok ? undefined : describeStatus(res.status, err?.code),
      message: ok ? undefined : String(err?.message ?? '').slice(0, 200),
      ms,
      ok,
    };
  } catch (e: any) {
    return {
      label,
      url,
      status: null,
      code: 'network',
      message: String(e?.message ?? '').slice(0, 200),
      ms: Date.now() - t0,
      ok: false,
    };
  }
}

/** 跑一次完整自检。永不抛错。 */
export async function runAiDiagnosis(): Promise<AiDiagResult> {
  const rawKey = (AI_CONFIG.apiKey || '').trim();
  const keyPresent = rawKey.length > 0;
  const keyHasWhitespace = keyPresent && rawKey !== AI_CONFIG.apiKey;
  // 两种合法形态：传统 35 位 sk-+32；业务空间专属 sk-ws-…（约 100-130 位）
  const keyKind: AiKeyKind = /^sk-[A-Za-z0-9]{32}$/.test(rawKey)
    ? 'standard'
    : /^sk-ws-[A-Za-z0-9._-]{20,}$/.test(rawKey)
    ? 'workspace'
    : 'unknown';
  const keyStandard = keyKind !== 'unknown';

  const baseUrl = (AI_CONFIG.baseUrl || '').replace(/\/+$/, '');
  const result: AiDiagResult = {
    keyPresent,
    keyLength: rawKey.length,
    keyPrefix: rawKey ? `${rawKey.slice(0, 6)}…` : '',
    keyHasWhitespace,
    keyStandard,
    keyKind,
    baseUrl,
    model: AI_CONFIG.model,
    probes: [],
    verdict: 'unknown',
  };

  if (!keyPresent) {
    result.verdict = 'missing_key';
    return result;
  }

  // 1) 通用国际站：只看 Key 所属账号，不看 workspace —— 用来区分「Key 坏了」还是「地址不匹配」
  //    但 sk-ws- 业务空间专属 Key 打到通用站必然 401，那不代表 Key 无效，
  //    所以这类 Key 不探通用站，只用 workspace 专属域名做权威判定。
  // 2) 项目实际使用的 Base URL：真实链路
  const targets: { label: string; base: string }[] = [];
  if (keyKind !== 'workspace') {
    targets.push({ label: 'intl', base: 'https://dashscope-intl.aliyuncs.com' });
  }
  if (baseUrl) {
    targets.push({ label: 'workspace', base: baseUrl });
  }

  result.probes = await Promise.all(
    targets.map((t) => probeChat(t.label, t.base, rawKey))
  );

  const anyOk = result.probes.some((p) => p.ok);
  const allRejected = result.probes.length > 0 && result.probes.every((p) => p.status === 401);
  const allNetwork = result.probes.every((p) => p.status === null);

  if (anyOk) result.verdict = 'ok';
  else if (allRejected) result.verdict = 'invalid_key';
  else if (allNetwork) result.verdict = 'network';
  else result.verdict = 'unknown';

  return result;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
// ⚠️ SDK 57 起 expo-file-system 顶层 readAsStringAsync 已弃用并在调用时直接抛错，
//    且 /legacy 子路径在该版本并不存在；故改用官方推荐的 /next 的 File.bytes() 读字节，
//    再手写 base64（Hermes 无 btoa）。
import { File } from 'expo-file-system/next';

/**
 * 家长声音克隆服务（需求 4：AI 模仿家长声音陪伴孩子）
 * ---------------------------------------------------------------------------
 * 数据来源：构建期通过 EXPO_PUBLIC_* 注入，密钥绝不写死在源码里。
 *   - EXPO_PUBLIC_VOICE_ENROLL_URL    声音复刻（音色注册）端点
 *   - EXPO_PUBLIC_VOICE_WORKSPACE_ID  百炼 workspace id
 *   - EXPO_PUBLIC_AI_BASE_URL         克隆音色 TTS 合成端点（复用百炼 MaaS 端点）
 *   - EXPO_PUBLIC_AI_API_KEY          鉴权（Bearer）
 *
 * ⚠️ 本文件是「把录音传上去 + 拿音色 id + 用该音色合成语音」的骨架。
 *    阿里云百炼 / 通义听悟声音复刻（CosyVoice）的精确请求/响应结构，
 *    请以你在阿里云控制台实际开通的 API 文档为准（端点、字段会随版本变动）。
 *    未配置任何一项时，所有函数都会安全降级，不会让 App 崩溃。
 *
 * 接入位置：
 *   - 注册：app/(parent)/voice-clone.tsx 的「确认并提交克隆」按钮调用 enrollVoice()
 *   - 合成：services/tts.ts 在「妈妈/爸爸/外婆」被选中且本地存有音色 id 时调用
 *           synthesizeWithClonedVoice()（集成点已预留，待真实端点确认后打通）
 */

// ⚠️ 必须用 process.env.EXPO_PUBLIC_X 字面量，Metro 才能静态内联（见 ai.ts 顶部说明）
const ENROLL_URL = process.env.EXPO_PUBLIC_VOICE_ENROLL_URL as string | undefined;
const WORKSPACE_ID = process.env.EXPO_PUBLIC_VOICE_WORKSPACE_ID as string | undefined;
const TTS_BASE_URL = process.env.EXPO_PUBLIC_AI_BASE_URL as string | undefined;
const AI_API_KEY = process.env.EXPO_PUBLIC_AI_API_KEY as string | undefined;
// 合成端点可单独指定：默认与注册共用同一 workspace（克隆音色就注册在那里，必须同
// workspace 才能找到该音色）。仅在「注册与合成必须分属不同地域 workspace」的特殊场景
// 才设置此变量，且务必指向与注册同一个 workspace，否则会找不到克隆音色而报 Model not exist。
const SYNTH_URL = process.env.EXPO_PUBLIC_VOICE_SYNTH_URL as string | undefined;

// 百炼「声音复刻」与 AI 推理共用专属域名（{workspaceId}.{region}.maas.aliyuncs.com）。
// 声音复刻端点固定路径：/api/v1/services/audio/tts/customization。
// ATS 防护：把任意 http:// 升级为 https://。iOS App Transport Security 会直接拦截
// 非 HTTPS 请求（报 "requires the use of a secure connection"）。阿里云 maas.aliyuncs.com
// 全域名支持 https，故对所有从环境变量解析出的端点与百炼返回的音频下载地址做兜底升级，
// 避免配置里误写 http 或百炼偶发返回 http 音频地址导致试听失败。
function toHttps(url: string): string {
  return url.startsWith('http://') ? 'https://' + url.slice('http://'.length) : url;
}

// 优先使用显式配置的 EXPO_PUBLIC_VOICE_ENROLL_URL（需为完整端点）；
// 否则基于 EXPO_PUBLIC_AI_BASE_URL 自动拼接（推荐，避免用户填错路径）。
function resolveEnrollEndpoint(): string | undefined {
  if (ENROLL_URL && /services\/audio\/tts\/customization|api\/v1\/services\/audio/i.test(ENROLL_URL)) {
    return toHttps(ENROLL_URL);
  }
  if (TTS_BASE_URL) {
    return toHttps(`${TTS_BASE_URL.replace(/\/+$/, '')}/api/v1/services/audio/tts/customization`);
  }
  return ENROLL_URL ? toHttps(ENROLL_URL) : undefined;
}

// 合成端点：优先用显式指定的 SYNTH_URL（可指向不同地域 workspace），否则取
// ENROLL_URL / AI_BASE_URL 的「协议+主机」拼官方合成路径。不复用字符串后缀替换
// （容易因配置里多一个斜杠/query 而静默失败、合成打到错误端点）。
function resolveSynthEndpoint(): string | undefined {
  const src = SYNTH_URL || ENROLL_URL || TTS_BASE_URL;
  if (!src) return undefined;
  // 用户已给完整合成端点则直接使用
  if (/SpeechSynthesizer/i.test(src)) return toHttps(src);
  const m = src.match(/^https?:\/\/[^/]+/i);
  const host = m ? m[0] : src.replace(/\/+$/, '');
  return toHttps(`${host}/api/v1/services/audio/tts/SpeechSynthesizer`);
}

// 复刻模型：注册（create_voice 的 target_model）使用的模型。可通过
// EXPO_PUBLIC_VOICE_TARGET_MODEL 覆盖；默认 qwen-audio-3.0-tts-flash。
// ⚠️ 克隆音色会「绑定」在该 target_model 上，后续合成必须使用同一模型，否则 Model not exist。
const CLONE_MODEL =
  (process.env.EXPO_PUBLIC_VOICE_TARGET_MODEL as string | undefined) || 'qwen-audio-3.0-tts-flash';
// 合成模型：克隆音色只能用于与之「绑定」的目标模型合成，故合成 model 必须与
// 复刻 target_model（CLONE_MODEL）完全一致，不允许通过独立变量改成不同值，
// 否则必然报 Model not exist。直接复用 CLONE_MODEL（不再读 EXPO_PUBLIC_VOICE_SYNTH_MODEL，
// 那个变量曾导致「复刻用 qwen、合成用 cosyvoice-v2」的不匹配）。
const SYNTH_MODEL = CLONE_MODEL;
// 百炼必填：音色名前缀，仅字母数字、≤10 字符
const CLONE_PREFIX = 'rms';


// 预设：'mom' | 'dad' | 'grandma'；自定义克隆对象以 'custom:<名称>' 形式存储
export type CloneTarget = string;

const STORAGE_KEY = (target: CloneTarget) => `rms_voice_clone_${target}`;

export interface VoiceCloneResult {
  ok: boolean;
  voiceId?: string;
  message: string;
}

/** 是否已配置声音克隆所需的端点与 workspace（缺一项即视为未配置） */
export function isVoiceCloneConfigured(): boolean {
  return Boolean(resolveEnrollEndpoint() && AI_API_KEY);
}

/** 读取本地缓存的克隆音色 id（null = 尚未克隆） */
export async function getClonedVoiceId(target: CloneTarget): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY(target));
  } catch {
    return null;
  }
}

/** 缓存克隆得到的音色 id，供 TTS 复用 */
export async function saveClonedVoiceId(target: CloneTarget, voiceId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY(target), voiceId);
  } catch {
    /* 存储异常不应阻断流程 */
  }
}

/** 枚举所有已克隆的音色 key（含自定义 custom:*），用于设置页动态展示 */
export async function getClonedTargets(): Promise<string[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys
      .filter((k) => typeof k === 'string' && (k as string).startsWith('rms_voice_clone_'))
      .map((k) => (k as string).replace('rms_voice_clone_', ''));
  } catch {
    return [];
  }
}

/** 根据文件后缀推断 MIME，用于拼 Base64 Data URI */
function mimeFromUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/wav';
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Uint8Array → base64（Hermes 无 btoa，手写；与 clonedVoicePlayback 同源算法） */
function uint8ToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : NaN;
    const c = i + 2 < bytes.length ? bytes[i + 2] : NaN;
    const e1 = a >> 2;
    const e2 = ((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4);
    const e3 = isNaN(b) ? 64 : ((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6);
    const e4 = isNaN(c) ? 64 : c & 63;
    output +=
      BASE64_CHARS[e1] +
      BASE64_CHARS[e2] +
      (e3 === 64 ? '=' : BASE64_CHARS[e3]) +
      (e4 === 64 ? '=' : BASE64_CHARS[e4]);
  }
  return output;
}

/**
 * 上传家长录音，注册克隆音色。
 * @param audioUri 录音文件本地路径（expo-audio 录制产物，通常为 .m4a）
 * @param target   克隆对象（妈妈 / 爸爸 / 外婆）
 *
 * 传输方式：官方 HTTP API 接收「公网 URL 或 Base64 Data URI」，不接受 FormData
 * 文件流，因此这里把本地录音读成 Base64 后以 JSON 提交。
 * 字段名以官方文档为准——若服务端要求其它键名（如 audio / audio_data），
 * 改下面 body 里的 `file` 这一项即可。
 */
export async function enrollVoice(audioUri: string, target: CloneTarget): Promise<VoiceCloneResult> {
  const endpoint = resolveEnrollEndpoint();
  if (!endpoint || !AI_API_KEY) {
    return {
      ok: false,
      message: '声音克隆尚未配置（请在 Xcode Cloud 配置 VOICE_ENROLL_URL 或 AI_BASE_URL / AI_API_KEY）',
    };
  }
  try {
    // 客户端前置校验：录音文件为空或过小（如未真正录到声、或极短），
    // 此时提交到百炼会被判定为静音（silent audio error），提前拦截给出明确指引。
    // 以 expo-file-system/next 的 File.bytes() 读取到的真实字节数为权威，FileSystem.getInfoAsync
    // 仅作交叉校验；任一处能确认文件存在且足够大即通过。
    let audioBytes: Uint8Array = new Uint8Array(0);
    try {
      audioBytes = await new File(audioUri).bytes();
    } catch (readErr: any) {
      console.warn('[voice-clone] File.bytes() failed:', readErr?.message ?? readErr);
    }
    const info = await FileSystem.getInfoAsync(audioUri).catch(() => null);
    const infoSize = (info && 'size' in info ? (info as any).size : 0) ?? 0;
    const infoExists = !!(info && (info as any).exists);
    // 取两种来源中的较大值，避免单一路径误判
    const size = Math.max(audioBytes.length, infoSize);
    if ((!infoExists && audioBytes.length === 0) || size < 4096) {
      return {
        ok: false,
        message:
          '录音文件为空或过小，无法克隆（实测大小约 ' +
          size +
          ' 字节）。请重新录制：在安静环境、距离麦克风约 10cm，清晰朗读引导段落至少 5 秒，再提交。',
      };
    }

    // 读取本地录音 → Base64 Data URI（百炼声音复刻接口接收公网 URL 或 Base64 Data URI）
    const base64 = uint8ToBase64(audioBytes);
    const dataUri = `data:${mimeFromUri(audioUri)};base64,${base64}`;

    // 百炼声音复刻创建音色：请求体必须用 input 包裹，action=create_voice 为必填；
    // prefix 为必填（音色名前缀，仅字母数字、≤10 字符）；音频字段名为 audio（非 file）。
    const createBody = {
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: CLONE_MODEL,
        prefix: CLONE_PREFIX,
        audio: dataUri,
      },
    };

    const createRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify(createBody),
    });
    const createData = await createRes.json().catch(() => ({} as any));
    if (!createRes.ok) {
      let msg =
        createData?.message ||
        createData?.output?.message ||
        JSON.stringify(createData).slice(0, 200);
      // 百炼「静音」类错误：音频被识别为无声。给出可操作的重录指引，而非裸报错。
      if (/silent|静音|empty audio|no audio/i.test(msg)) {
        msg =
          '音频被识别为静音。请重新录制：在安静环境、距离麦克风约 10cm，清晰朗读引导段落至少 10 秒（百炼声音复刻需足够时长的清晰人声）。';
      }
      return { ok: false, message: `创建音色失败（HTTP ${createRes.status}）：${msg}` };
    }

    const voiceId = createData?.output?.voice_id || createData?.voice_id;
    if (!voiceId) {
      return { ok: false, message: '创建音色成功但未返回 voice_id' };
    }

    // 百炼音色创建是异步的：提交后需轮询 query_voice 直到 status === 'OK' 才能用于合成
    let status = '';
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const queryRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
        body: JSON.stringify({
          model: 'voice-enrollment',
          input: { action: 'query_voice', voice_id: voiceId },
        }),
      });
      const qd = await queryRes.json().catch(() => ({} as any));
      status = qd?.output?.status || '';
      if (status === 'OK') break;
    }

    await saveClonedVoiceId(target, String(voiceId));
    if (status !== 'OK') {
      return {
        ok: true,
        voiceId: String(voiceId),
        message: '音色已提交，正在训练（约几分钟），稍后即可在「妈妈/爸爸/外婆」中使用',
      };
    }
    return { ok: true, voiceId: String(voiceId), message: '音色克隆成功！' };
  } catch (err: any) {
    return { ok: false, message: err?.message || '注册过程出错' };
  }
}

/**
 * 用克隆音色合成语音（TTS）。
 * 百炼 MaaS CosyVoice 非实时合成：POST SpeechSynthesizer，响应 output.audio.url 为
 * 音频「下载地址」，需二次 GET 取二进制（官方文档确认此结构）。
 * @returns { audio, error }：audio 为二进制（调用方落盘播放），error 为失败原因（透出给 UI）
 */
export interface SynthResult {
  audio: ArrayBuffer | null;
  error?: string;
}

/** base64 → Uint8Array（Hermes 无 atob，手写；与 uint8ToBase64 互为逆运算） */
function base64ToUint8(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  const outLen =
    (len * 3) / 4 - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
  const out = new Uint8Array(outLen < 0 ? 0 : outLen);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = BASE64_CHARS.indexOf(clean[i]);
    const e2 = BASE64_CHARS.indexOf(clean[i + 1]);
    const e3 = BASE64_CHARS.indexOf(clean[i + 2]);
    const e4 = BASE64_CHARS.indexOf(clean[i + 3]);
    out[p++] = (e1 << 2) | (e2 >> 4);
    if (e3 !== 64 && p < out.length) out[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (e4 !== 64 && p < out.length) out[p++] = ((e3 & 3) << 6) | e4;
  }
  return out;
}

export async function synthesizeWithClonedVoice(
  text: string,
  target: CloneTarget
): Promise<SynthResult> {
  const voiceId = await getClonedVoiceId(target);
  const synthEndpoint = resolveSynthEndpoint();
  if (!voiceId) return { audio: null, error: '尚未克隆该音色（voiceId 为空）' };
  if (!synthEndpoint) return { audio: null, error: '合成端点未配置（VOICE_ENROLL_URL / AI_BASE_URL 缺失）' };
  if (!AI_API_KEY) return { audio: null, error: '缺少 AI_API_KEY，无法鉴权合成' };

  try {
    // 百炼 MaaS 官方示例：鉴权仅靠 URL 子域名里的 workspace + Bearer Key，
    // 不依赖 X-Workspace-Id；仅当显式配置了才带上，避免发送空 header 引发异常。
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
    };
    if (WORKSPACE_ID) headers['X-Workspace-Id'] = WORKSPACE_ID;

    const res = await fetch(synthEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: SYNTH_MODEL,
        input: {
          text,
          voice: voiceId,
          format: 'mp3',
          sample_rate: 24000,
        },
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      // 404 / Model not exist：克隆音色绑定在注册时的 target_model 上，合成必须用同一模型，
      // 且合成端点须与注册同一 workspace。详见下方 hint。
      const hint =
        res.status === 404
          ? `。克隆音色绑定在注册时的 target_model（${CLONE_MODEL}）上，合成必须用同一模型。` +
            `请确认：(1) EXPO_PUBLIC_VOICE_TARGET_MODEL 与合成 model 一致；` +
            `(2) EXPO_PUBLIC_VOICE_SYNTH_URL（若设置）指向与注册同一 workspace，` +
            `否则该 workspace 找不到该音色/模型而报 Model not exist。`
          : '';
      return {
        audio: null,
        error: `合成请求失败（HTTP ${res.status}）：${bodyText.slice(0, 200)}${hint}`,
      };
    }
    const data = (await res.json().catch(() => null)) as any;
    // 非流式：音频以下载地址返回（output.audio.url）；个别配置也可能直接给 base64，一并兼容
    let audioUrl: string | undefined = data?.output?.audio?.url;
    if (!audioUrl && typeof data?.output?.audio === 'string') {
      audioUrl = data.output.audio;
    }
    if (!audioUrl) {
      return {
        audio: null,
        error: `合成成功但响应缺少音频地址：${JSON.stringify(data).slice(0, 300)}`,
      };
    }
    // base64 直返：直接解码（极少情况）
    if (audioUrl.startsWith('data:')) {
      const b64 = audioUrl.slice(audioUrl.indexOf(',') + 1);
      return { audio: base64ToUint8(b64).buffer as ArrayBuffer, error: undefined };
    }
    // ★ ATS 修复（方案A）：百炼返回的音频下载地址偶发为 http://，iOS
    //   App Transport Security 会直接拦截（"requires the use of a secure connection"）。
    //   阿里云 DNS 域名均支持 https，这里强制升级为 https 再下载，无需改原生配置。
    audioUrl = toHttps(audioUrl);
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      return { audio: null, error: `下载合成音频失败（HTTP ${audioRes.status}）：${audioUrl.slice(0, 160)}` };
    }
    return { audio: await audioRes.arrayBuffer(), error: undefined };
  } catch (err: any) {
    // 诊断信息带上实际使用的 voiceId，便于核对与百炼后台已训练音色是否一致
    return {
      audio: null,
      error: `合成异常（voiceId=${voiceId}）：${err?.message || String(err)}`,
    };
  }
}

/**
 * 语音转文字（孩子提问环节）：百炼 qwen3-asr-flash，支持 base64 Data URL 直传，
 * 走 OpenAI 兼容的 chat/completions 通道（与故事生成共用同一 MaaS 域名）。
 * 返回识别文本；失败/未配置返回 null，调用方据此回退到手动输入。
 */
export async function transcribeAudio(audioUri: string): Promise<string | null> {
  if (!AI_API_KEY || !TTS_BASE_URL) return null;
  try {
    const bytes = await new File(audioUri).bytes();
    const b64 = uint8ToBase64(bytes);
    const mime = mimeFromUri(audioUri);
    const dataUri = `data:${mime};base64,${b64}`;
    const res = await fetch(`${TTS_BASE_URL.replace(/\/+$/, '')}/compatible-mode/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: 'qwen3-asr-flash',
        messages: [
          {
            role: 'user',
            content: [{ type: 'input_audio', input_audio: { data: dataUri } }],
          },
        ],
        stream: false,
        asr_options: { enable_itn: false },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({} as any));
    const text = data?.choices?.[0]?.message?.content;
    return text ? String(text).trim() : null;
  } catch {
    return null;
  }
}

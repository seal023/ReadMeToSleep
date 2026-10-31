import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import {
  synthesizeWithClonedVoice,
  getClonedVoiceId,
  type CloneTarget,
} from './voiceClone';

/**
 * 真克隆声播放层
 * ---------------------------------------------------------------------------
 * 把 voiceClone.ts 里「只返回 ArrayBuffer、却没人调用」的 synthesizeWithClonedVoice()
 * 接到真实播放上：合成 → 落盘 mp3 → expo-audio 播放。
 *
 * 设计原则：永远不崩。任何一步（合成失败 / 写文件失败 / expo-audio 不可用）都返回
 * false，由上层 playStory() 降级到系统音（expo-speech pitch/rate 微调）。
 *
 * ⚠️ expo-audio 的播放 API 在本地因 node_modules 未完整安装无法类型校验，
 *    故此处对 createAudioPlayer / player.play 的全部调用都包在 try/catch 中；
 *    真机/Xcode Cloud 构建（npm install 装全依赖）时生效。
 */

let currentPlayer: {
  play: () => void;
  pause: () => void;
  remove: () => void;
  seekTo: (millis: number) => void;
  setVolume?: (volume: number) => void;
} | null = null;

/** 最近一次克隆声播放/合成失败的具体原因，供 UI 透出诊断（如试听失败弹窗） */
let lastCloneError = '';
export function getLastCloneError(): string {
  return lastCloneError;
}

/** 该亲属是否已克隆出音色 */
export async function hasClonedVoice(target: CloneTarget): Promise<boolean> {
  const id = await getClonedVoiceId(target);
  return Boolean(id);
}

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** ArrayBuffer → base64（RN/Hermes 无 btoa，手写） */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < len; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, len));
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
  }
  let output = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : NaN;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : NaN;
    const e1 = a >> 2;
    const e2 = ((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4);
    const e3 = isNaN(b) ? 64 : ((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6);
    const e4 = isNaN(c) ? 64 : c & 63;
    output +=
      BASE64[e1] +
      BASE64[e2] +
      (e3 === 64 ? '=' : BASE64[e3]) +
      (e4 === 64 ? '=' : BASE64[e4]);
  }
  return output;
}

/** 简单 hash，作为缓存文件名，避免同一故事反复合成 */
function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * 用克隆音色播放一段文本（真声）。返回是否成功发起播放。
 * 失败/未配置/未克隆一律返回 false，调用方据此降级系统音。
 */
export async function playClonedAudio(
  text: string,
  target: CloneTarget,
  onDone?: () => void,
): Promise<boolean> {
  // 先停掉上一段，避免叠加
  stopClonedAudio();
  lastCloneError = '';

  try {
    const { audio, error } = await synthesizeWithClonedVoice(text, target);
    if (error) {
      lastCloneError = error;
      console.warn('[clonedPlayback] synth failed:', error);
      return false;
    }
    if (!audio) {
      lastCloneError = '合成返回空音频';
      return false;
    }

    if (!FileSystem.cacheDirectory) {
      lastCloneError = '设备缓存目录不可用，无法落盘音频';
      return false;
    }
    const safeTarget = encodeURIComponent(target);
    const filePath =
      FileSystem.cacheDirectory + `rms_clone_${safeTarget}_${hashText(text)}.mp3`;

    const b64 = arrayBufferToBase64(audio);
    await FileSystem.writeAsStringAsync(filePath, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // 播放前必须配置音频会话，否则 iOS（尤其静音模式）下克隆声/本地录音会静音
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, staysActiveInBackground: false });
    } catch {
      /* 忽略会话配置异常，继续尝试播放 */
    }

    const player = createAudioPlayer({ uri: filePath }) as unknown as {
      play: () => void;
      pause: () => void;
      remove: () => void;
      seekTo: (millis: number) => void;
      setVolume?: (volume: number) => void;
      onEnded?: (cb: () => void) => void;
    };
    currentPlayer = player;
    player.play();
    // expo-audio 的 onEnded 在不同版本可能是「注册方法」或「可赋值属性」，两者都尝试
    if (typeof player.onEnded === 'function') {
      try {
        player.onEnded(() => onDone?.());
      } catch {
        /* 忽略差异 */
      }
    } else {
      try {
        (player as unknown as { onEnded?: () => void }).onEnded = () => onDone?.();
      } catch {
        /* 忽略差异 */
      }
    }
    return true;
  } catch (err) {
    lastCloneError = String((err as any)?.message || err);
    console.warn('[clonedPlayback] play failed, fallback to system voice:', err);
    return false;
  }
}

/**
 * 克隆声播放进度跳转（进度条拖动）。positionSeconds 为跳转目标位置（秒）。
 * 仅对 expo-audio 播放器有效；系统音（TTS）不支持 seek，调用方需自行判断。
 */
export function seekClonedAudio(positionSeconds: number): void {
  try {
    if (currentPlayer && typeof currentPlayer.seekTo === 'function') {
      // expo-audio 的 seekTo 接收毫秒，需把秒换算成毫秒
      currentPlayer.seekTo(Math.max(0, positionSeconds) * 1000);
    }
  } catch {
    /* 忽略 seek 异常 */
  }
}

/** 停止当前克隆声播放 */
export function stopClonedAudio(): void {
  try {
    if (currentPlayer) {
      currentPlayer.pause();
      currentPlayer.remove();
    }
  } catch {
    /* 忽略停止异常 */
  }
  currentPlayer = null;
}

/**
 * 温和淡出后停止：用于睡眠定时到点。
 * - 克隆声 / 本地录音（expo-audio）支持 setVolume，逐级降到 0 再停，避免突兀；
 * - 系统音（expo-speech）无法中途调音量，这里直接停（sleepTimer 在调用本函数前
 *   已对系统音无淡出需求，停即停）。
 */
export async function fadeOutAndStop(fadeSeconds = 8): Promise<void> {
  if (currentPlayer && typeof currentPlayer.setVolume === 'function') {
    try {
      const steps = 10;
      const stepMs = (fadeSeconds * 1000) / steps;
      for (let i = 1; i <= steps; i++) {
        currentPlayer.setVolume(Math.max(0, 1 - i / steps));
        await new Promise((r) => setTimeout(r, stepMs));
      }
    } catch {
      /* 忽略淡出异常 */
    }
  }
  // 无论克隆/本地/系统音，最后统一确保全部停止
  stopClonedAudio();
  try {
    const { stopSpeech } = await import('./tts');
    await stopSpeech();
  } catch {
    /* 忽略 */
  }
}

/**
 * 播放本地音频文件（如孩子/家长录制的故事），直接 createAudioPlayer 播放，
 * 不走 TTS / 克隆合成。用于「我的录音」中保留录音的回放。
 * 复用全局 currentPlayer 槽位，故 stopClonedAudio() / 进度拖动 seekClonedAudio() 同样适用。
 */
export async function playLocalFile(uri: string, onDone?: () => void): Promise<boolean> {
  stopClonedAudio();
  try {
    // 播放前配置音频会话，避免 iOS 静音（与 playClonedAudio 一致）
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, staysActiveInBackground: false });
    } catch {
      /* 忽略 */
    }
    const player = createAudioPlayer({ uri }) as unknown as {
      play: () => void;
      pause: () => void;
      remove: () => void;
      seekTo: (millis: number) => void;
      setVolume?: (volume: number) => void;
      onEnded?: (cb: () => void) => void;
    };
    currentPlayer = player;
    player.play();
    if (typeof player.onEnded === 'function') {
      try {
        player.onEnded(() => onDone?.());
      } catch {
        /* 忽略差异 */
      }
    } else {
      try {
        (player as unknown as { onEnded?: () => void }).onEnded = () => onDone?.();
      } catch {
        /* 忽略差异 */
      }
    }
    return true;
  } catch (err) {
    console.warn('[clonedPlayback] playLocalFile failed:', err);
    return false;
  }
}

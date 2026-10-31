import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
// SDK 57 起顶层 expo-file-system 的 cacheDirectory / writeAsStringAsync / EncodingType
// 已失效（cacheDirectory 返回 undefined、write 抛错），必须改用 next 的 File + Paths。
import { File, Paths } from 'expo-file-system/next';
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

type AudioPlayerLike = {
  play: () => void;
  pause: () => void;
  remove: () => void;
  seekTo: (millis: number) => void;
  setVolume?: (volume: number) => void;
  currentTime?: number;
  duration?: number;
  onEnded?: ((cb: () => void) => void) | (() => void);
};

let currentPlayer: AudioPlayerLike | null = null;

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

/** 简单 hash，作为缓存文件名，避免同一故事反复合成 */
function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

// —— 统一「播完」检测 ——
// expo-audio 的 onEnded 在真机（v54 实测）并不触发，导致故事播完后界面一直不跳转。
// 这里用 250ms 轮询 currentTime/duration 做可靠兜底：位置接近时长即认定为播完，
// 同时保留 onEnded 事件注册以兼容支持它的版本；两条路径共用 endFired 去重，保证只回调一次。
let endWatchTimer: ReturnType<typeof setInterval> | null = null;
let endFired = false;
let endOnce: (() => void) | null = null;

function resetEndWatch(): void {
  if (endWatchTimer) {
    clearInterval(endWatchTimer);
    endWatchTimer = null;
  }
  endFired = false;
  endOnce = null;
}

/** 为当前 player 装上「播完只回调一次」的检测，onDone 为空则不做任何事 */
function armEndWatch(onDone?: () => void): void {
  resetEndWatch();
  if (!onDone) return;
  endOnce = () => {
    if (endFired) return;
    endFired = true;
    if (endWatchTimer) {
      clearInterval(endWatchTimer);
      endWatchTimer = null;
    }
    try {
      onDone();
    } catch {
      /* 忽略回调异常 */
    }
  };
  endWatchTimer = setInterval(() => {
    if (endFired || !currentPlayer) return;
    const dur = getClonedDuration();
    const pos = getClonedPosition();
    // duration 未加载完成（0）时不做判断，避免刚起播就误判结束
    if (dur > 0.4 && pos >= dur - 0.35) endOnce?.();
  }, 250);
}

// —— 合成缓存 ——
// 同一段文本（同音色）只合成一次并落盘；playClonedAudio 与预热共用，
// 既让「再次播放」瞬时开始，也避免预热与播放并发重复调用接口。
const inflight = new Map<string, Promise<{ ok: boolean; error?: string }>>();

function cacheFileName(text: string, target: CloneTarget): string {
  return `rms_clone_${encodeURIComponent(target)}_${hashText(text)}.mp3`;
}

function writeBytesToCache(fileName: string, audio: ArrayBuffer): void {
  const file = new File(Paths.cache, fileName);
  if (!file.exists) {
    try {
      file.create();
    } catch {
      /* 并发创建 / 已存在，忽略；write 仍会覆盖 */
    }
  }
  file.write(new Uint8Array(audio));
}

/** 确保某段文本的克隆音频已落盘（命中缓存直接返回；并发调用只合成一次） */
async function ensureSynthFile(
  text: string,
  target: CloneTarget,
  fileName: string,
): Promise<{ ok: boolean; error?: string }> {
  const cached = new File(Paths.cache, fileName);
  if (cached.exists) return { ok: true };
  const running = inflight.get(fileName);
  if (running) return running;
  const task = (async () => {
    const { audio, error } = await synthesizeWithClonedVoice(text, target);
    if (error) return { ok: false, error };
    if (!audio) return { ok: false, error: '合成返回空音频' };
    writeBytesToCache(fileName, audio);
    return { ok: true };
  })();
  inflight.set(fileName, task);
  try {
    return await task;
  } finally {
    inflight.delete(fileName);
  }
}

/**
 * 预热：在用户点播放之前就把整段故事的克隆音频合成好、落到缓存。
 * 用于故事页打开时后台预热，点播放即可几乎瞬时出声。
 * 任何失败都静默忽略（正常播放时会再走一次合成并透出错误）。
 */
export async function prewarmClonedAudio(text: string, target: CloneTarget): Promise<void> {
  try {
    if (!text || text.trim().length < 2) return;
    const fileName = cacheFileName(text, target);
    if (new File(Paths.cache, fileName).exists) return;
    await ensureSynthFile(text, target, fileName);
  } catch {
    /* 预热失败不影响正常播放 */
  }
}

/** 起播一个已落盘的音频文件，并装上播完检测 */
async function startPlayback(uri: string, onDone?: () => void): Promise<boolean> {
  try {
    // 播放前必须配置音频会话，否则 iOS（尤其静音模式）下克隆声/本地录音会静音
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        staysActiveInBackground: false,
      });
    } catch {
      /* 忽略会话配置异常，继续尝试播放 */
    }

    const player = createAudioPlayer({ uri }) as unknown as AudioPlayerLike;
    currentPlayer = player;
    armEndWatch(onDone);
    player.play();

    // 事件式兜底（若该版本支持 onEnded）；与轮询共用 endOnce，保证只触发一次
    if (typeof player.onEnded === 'function') {
      try {
        (player.onEnded as (cb: () => void) => void)(() => endOnce?.());
      } catch {
        /* 忽略差异 */
      }
    } else {
      try {
        (player as { onEnded?: () => void }).onEnded = () => endOnce?.();
      } catch {
        /* 忽略差异 */
      }
    }
    return true;
  } catch (err) {
    lastCloneError = String((err as any)?.message || err);
    console.warn('[clonedPlayback] startPlayback failed:', err);
    return false;
  }
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
    const fileName = cacheFileName(text, target);
    const res = await ensureSynthFile(text, target, fileName);
    if (!res.ok) {
      lastCloneError = res.error || '合成失败';
      console.warn('[clonedPlayback] synth failed:', lastCloneError);
      return false;
    }
    const file = new File(Paths.cache, fileName);
    return await startPlayback(file.uri, onDone);
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
  resetEndWatch();
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
 * 当前克隆声 / 本地音的播放位置（秒）。仅对 expo-audio 播放器有效；
 * 系统音（TTS）不支持，返回 0 —— 调用方据此决定是否显示真实进度 / 允许拖动快进。
 */
export function getClonedPosition(): number {
  try {
    const p = currentPlayer as unknown as { currentTime?: number } | null;
    return p && typeof p.currentTime === 'number' ? p.currentTime : 0;
  } catch {
    return 0;
  }
}

/** 当前克隆声 / 本地音的总时长（秒）；未加载完成返回 0 */
export function getClonedDuration(): number {
  try {
    const p = currentPlayer as unknown as { duration?: number } | null;
    return p && typeof p.duration === 'number' ? p.duration : 0;
  } catch {
    return 0;
  }
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
  return startPlayback(uri, onDone);
}

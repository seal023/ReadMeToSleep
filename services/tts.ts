import * as Speech from 'expo-speech';
import { setAudioModeAsync } from 'expo-audio';

export interface Voice {
  id: string;
  name: string;
}

export const VOICES: Voice[] = [
  { id: 'system', name: '系统默认' },
  { id: 'mom', name: '妈妈' },
  { id: 'dad', name: '爸爸' },
  { id: 'grandma', name: '外婆' },
];

const VOICE_PARAMS: Record<string, { rate: number; pitch: number }> = {
  system: { rate: 0.9, pitch: 1.0 },
  mom: { rate: 0.85, pitch: 1.15 },
  dad: { rate: 0.8, pitch: 0.85 },
  grandma: { rate: 0.75, pitch: 0.9 },
};

/**
 * 把音频会话切到 playback 模式（允许在静音键开启时出声）。
 * expo-speech 底层是 AVSpeechSynthesizer，默认会被 iOS 静音/响铃开关静音，
 * 不先设置这一步，用户开静音时点播放会"没有语音"。
 *
 * ⚠️ 每次说话前都要重设，不能只做一次（2026-11-01 修复）
 *   原先用 audioModeReady 标记「设过一次就不再设」，但 iOS 会在以下时机
 *   自行把 AVAudioSession 置回未激活 / 换掉类别：
 *     · 锁屏或切到后台（App 失去前台音频权）
 *     · 录音（allowsRecording:true）结束后没切回来
 *     · 来电、蓝牙耳机插拔等路由变化
 *   一旦会话被系统收回，之后再 speak 就是「静默失败」——表现正是用户反馈的
 *   「听故事一半锁屏，回来以后很多提示音都没了」。这里改为每次都重设，
 *   一次原生调用只有几毫秒，比"没声音"划算得多。
 */
let lastModeAt = 0;

export async function ensureAudioMode(): Promise<void> {
  // 1.5 秒内重复说话不重复设置（避免一句话里多次调用），但绝不"一辈子只设一次"
  if (Date.now() - lastModeAt < 1500) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
    lastModeAt = Date.now();
  } catch (err) {
    lastModeAt = 0;
    console.warn('[tts] setAudioModeAsync failed:', err);
  }
}

/** 供 App 回到前台时调用：清掉时间戳，强制下一次说话重设会话 */
export function invalidateAudioMode(): void {
  lastModeAt = 0;
}

/** 仅在真正的 Web 环境（存在 speechSynthesis）走浏览器 TTS，RN 一律走 expo-speech */
function isWebSpeech(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && !!window.speechSynthesis;
}

export async function textToSpeech(
  text: string,
  voiceId?: string,
  language: 'zh' | 'en' = 'zh',
  onDone?: () => void,
  /** 真正开始出声时回调（用于让界面文字与语音同时出现，避免"字先出、声后到"的时差） */
  onStart?: () => void,
): Promise<string> {
  const params = VOICE_PARAMS[voiceId || 'system'] || VOICE_PARAMS.system;
  const lang = language === 'en' ? 'en-US' : 'zh-CN';

  await ensureAudioMode();

  if (isWebSpeech()) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = params.rate;
      utterance.pitch = params.pitch;
      utterance.onstart = () => onStart?.();
      utterance.onend = () => onDone?.();

      const voices = window.speechSynthesis.getVoices();
      const matched = voices.find(v => v.lang.startsWith(language === 'en' ? 'en' : 'zh'));
      if (matched) {
        utterance.voice = matched;
      }

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[tts] web speech failed:', err);
    }
  } else {
    try {
      await Speech.stop();
      await Speech.speak(text, {
        language: lang,
        rate: params.rate,
        pitch: params.pitch,
        onStart: () => onStart?.(),
        onDone: () => onDone?.(),
      });
    } catch (err) {
      console.warn('[tts] expo-speech failed:', err);
    }
  }
  return '';
}

export async function stopSpeech(): Promise<void> {
  if (isWebSpeech()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* noop */
    }
  } else {
    try {
      await Speech.stop();
    } catch {
      /* noop */
    }
  }
}

export async function isSpeakingAsync(): Promise<boolean> {
  if (isWebSpeech()) {
    try {
      return window.speechSynthesis.speaking;
    } catch {
      return false;
    }
  }
  try {
    return await Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}

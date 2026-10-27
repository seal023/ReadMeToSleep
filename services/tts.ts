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

let audioModeReady = false;

/**
 * 把音频会话切到 playback 模式（允许在静音键开启时出声）。
 * expo-speech 底层是 AVSpeechSynthesizer，默认会被 iOS 静音/响铃开关静音，
 * 不先设置这一步，用户开静音时点播放会"没有语音"。
 */
export async function ensureAudioMode(): Promise<void> {
  if (audioModeReady) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
    audioModeReady = true;
  } catch (err) {
    console.warn('[tts] setAudioModeAsync failed:', err);
  }
}

/** 仅在真正的 Web 环境（存在 speechSynthesis）走浏览器 TTS，RN 一律走 expo-speech */
function isWebSpeech(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && !!window.speechSynthesis;
}

export async function textToSpeech(
  text: string,
  voiceId?: string,
  language: 'zh' | 'en' = 'zh'
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

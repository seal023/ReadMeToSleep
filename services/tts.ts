import * as Speech from 'expo-speech';

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

export async function textToSpeech(text: string, voiceId?: string): Promise<string> {
  const params = VOICE_PARAMS[voiceId || 'system'] || VOICE_PARAMS.system;
  
  if (typeof window !== 'undefined') {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = params.rate;
    utterance.pitch = params.pitch;
    
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.startsWith('zh'));
    if (zhVoice) {
      utterance.voice = zhVoice;
    }
    
    window.speechSynthesis.speak(utterance);
  } else {
    await Speech.stop();
    await Speech.speak(text, {
      language: 'zh-CN',
      rate: params.rate,
      pitch: params.pitch,
    });
  }
  return '';
}

export async function stopSpeech(): Promise<void> {
  if (typeof window !== 'undefined') {
    window.speechSynthesis.cancel();
  } else {
    await Speech.stop();
  }
}

export async function isSpeakingAsync(): Promise<boolean> {
  if (typeof window !== 'undefined') {
    return window.speechSynthesis.speaking;
  }
  return Speech.isSpeakingAsync();
}
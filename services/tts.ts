import * as Speech from 'expo-speech';

export const VOICES: Record<string, string> = {
  system: 'system',
  mom: 'mom',
  dad: 'dad',
  grandma: 'grandma',
  custom1: 'custom1',
  custom2: 'custom2',
};

export async function textToSpeech(text: string, voiceId?: string): Promise<string> {
  await Speech.speak(text, {
    language: 'zh-CN',
    rate: 0.9,
    pitch: 1.0,
  });
  return '';
}

export async function stopSpeech(): Promise<void> {
  await Speech.stop();
}

export async function isSpeakingAsync(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}

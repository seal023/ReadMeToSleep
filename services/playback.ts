import { textToSpeech, stopSpeech } from './tts';
import {
  playClonedAudio,
  stopClonedAudio,
  hasClonedVoice,
} from './clonedVoicePlayback';
import type { CloneTarget } from './voiceClone';

/**
 * 统一故事播放入口（P0：让真克隆声真正发声）
 * ---------------------------------------------------------------------------
 * 优先级：
 *   1) 若所选声音是某位亲属（妈妈/爸爸/外婆）且已克隆 → 用其真克隆声播放；
 *   2) 否则降级到系统音（expo-speech，pitch/rate 微调）。
 * 调用方无需关心背后是哪条链路。
 */

const TARGET_BY_VOICE: Record<string, CloneTarget | undefined> = {
  mom: 'mom',
  dad: 'dad',
  grandma: 'grandma',
};

/**
 * 播放故事。返回是否使用了真克隆声（便于 UI 提示）。
 * 注意：本函数「发起即返回」，进度条由调用方按字数估算驱动（见 [id].tsx）。
 */
export async function playStory(
  text: string,
  voiceId: string,
  language: 'zh' | 'en' = 'zh',
): Promise<boolean> {
  const target = TARGET_BY_VOICE[voiceId];
  if (target && (await hasClonedVoice(target))) {
    const ok = await playClonedAudio(text, target);
    if (ok) return true;
  }
  // 降级：系统音（含 mom/dad/grandma 的 pitch/rate 微调）
  textToSpeech(text, voiceId, language);
  return false;
}

/** 停止一切播放（克隆声 + 系统音） */
export function stopStory(): void {
  stopClonedAudio();
  stopSpeech();
}

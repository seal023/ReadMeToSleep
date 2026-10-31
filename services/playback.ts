import { textToSpeech, stopSpeech } from './tts';
import {
  playClonedAudio,
  stopClonedAudio,
  hasClonedVoice,
} from './clonedVoicePlayback';
import { getVoiceSetting } from './storage';
import type { CloneTarget } from './voiceClone';

/**
 * 统一故事播放入口（P0：让真克隆声真正发声）
 * ---------------------------------------------------------------------------
 * 优先级：
 *   1) 若所选声音是某位亲属（妈妈/爸爸/外婆）且已克隆 → 用其真克隆声播放；
 *   2) 否则降级到系统音（expo-speech，pitch/rate 微调）。
 * 调用方无需关心背后是哪条链路。
 */

/**
 * 播放故事。返回是否使用了真克隆声（便于 UI 提示）。
 * 注意：本函数「发起即返回」，进度条由调用方按字数估算驱动（见 [id].tsx）。
 * voiceId 为 'system' 时用系统音；其它值（mom/dad/grandma/自定义 custom:*）
 * 若已克隆则优先用其真克隆声，否则降级系统音。
 */
export async function playStory(
  text: string,
  voiceId: string,
  language: 'zh' | 'en' = 'zh',
  onDone?: () => void,
): Promise<boolean> {
  if (voiceId && voiceId !== 'system') {
    const target = voiceId as CloneTarget;
    if (await hasClonedVoice(target)) {
      const ok = await playClonedAudio(text, target, onDone);
      if (ok) return true;
    }
  }
  // 降级：系统音（含 mom/dad/grandma 的 pitch/rate 微调）
  textToSpeech(text, voiceId, language, onDone);
  return false;
}

/** 停止一切播放（克隆声 + 系统音） */
export function stopStory(): void {
  stopClonedAudio();
  stopSpeech();
}

/**
 * 用「当前最好的声音」说一句话（克隆声优先，失败/未克隆降级系统音）。
 * 用于把克隆声贯穿全 App（每日问候、问答提示/反馈、AI 回答等），
 * 而不是只有听故事时才用克隆声。
 *
 * 不阻塞调用方：内部等待合成完成后才开始播，但调用处一般无需 await。
 * 同一时刻只会有最后一句在播（playClonedAudio 会先停掉上一段）。
 */
export async function speakWithBestVoice(
  text: string,
  language: 'zh' | 'en' = 'zh',
  voiceId?: string,
): Promise<boolean> {
  const content = (text || '').trim();
  if (!content) return false;
  let voice = voiceId;
  if (!voice) {
    try {
      voice = await getVoiceSetting();
    } catch {
      voice = undefined;
    }
  }
  if (voice && voice !== 'system') {
    try {
      if (await hasClonedVoice(voice)) {
        const ok = await playClonedAudio(content, voice as CloneTarget);
        if (ok) return true;
      }
    } catch {
      /* 克隆声失败，继续降级系统音 */
    }
  }
  textToSpeech(content, voice || 'system', language);
  return false;
}

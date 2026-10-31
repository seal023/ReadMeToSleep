import { textToSpeech, stopSpeech } from './tts';
import {
  playClonedAudio,
  stopClonedAudio,
  hasClonedVoice,
} from './clonedVoicePlayback';
import { getVoiceSetting } from './storage';
import { pickPhrase, type PhraseCategory } from './phraseBank';
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
 * 用于把克隆声贯穿全 App（每日问候、问答提示/反馈、AI 回答等）。
 *
 * 行为：
 * - 任何一次调用都会先打断上一段（克隆声 + 系统音），保证「动作/界面切换时旧声立刻停、
 *   新声立刻响」，解决多个提示音叠加/串台的问题；
 * - 并发安全：克隆声合成期间若来了更新的请求，旧的那次合成完会放弃播放，不覆盖新声；
 * - 无论长短提示，都优先用克隆声，且「同一文本 + 同一音色只合成一次」并落盘缓存：
 *   命中缓存后下次播放零延迟、零重复 token（秒出）；仅首次使用会现合成一次；
 *   克隆成功后已静默预热高频短句，使常见提示（你好/再见/答对/晚安…）几乎总是命中缓存；
 * - 未克隆 / 克隆合成失败时降级到系统音（expo-speech），保证一定有声音。
 *
 * @param opts.urgent    （已废弃）曾用于强制系统音；现所有提示统一走克隆声优先逻辑，
 *                       该字段保留仅为兼容旧调用点，不再影响行为。
 * @param opts.interrupt false=不打断上一段（极少用）；默认 true
 * @param opts.voiceId   指定声线；缺省则读全局声音设置
 */
let speakSeq = 0;
export interface SpeakOptions {
  urgent?: boolean;
  interrupt?: boolean;
  voiceId?: string;
  /** 真正开始出声时回调（用于让界面文字与语音同时出现，避免"字先出、声后到"的时差） */
  onStart?: () => void;
}
export async function speakWithBestVoice(
  text: string,
  language: 'zh' | 'en' = 'zh',
  opts: SpeakOptions = {},
): Promise<boolean> {
  const content = (text || '').trim();
  if (!content) return false;

  const mySeq = ++speakSeq;
  if (opts.interrupt !== false) stopStory(); // 立即打断旧的（克隆 + 系统）

  let voice = opts.voiceId;
  if (!voice) {
    try {
      voice = await getVoiceSetting();
    } catch {
      voice = undefined;
    }
  }

  // 统一走克隆声：命中本地缓存则秒出、零 token；未命中则首次现合成一次并落盘缓存。
  // 克隆声不可用时（未克隆 / 合成失败）自然落到下方系统音降级。
  if (voice && voice !== 'system') {
    try {
      if (await hasClonedVoice(voice)) {
        const ok = await playClonedAudio(
          content,
          voice as CloneTarget,
          undefined,
          () => mySeq === speakSeq,
          () => opts.onStart?.(),
        );
        if (ok) return true;
        // 关键修复（#4/#5）：若本请求已被更新的旁白请求取代（abortCheck 失败），
        // 则本句必须「静默放弃」——由取代它的新请求负责出声。
        // 否则旧的这请求会落到下面的 textToSpeech 用系统女声补一句，
        // 与正在响的克隆声叠加成「双声 / 几个声音同时出来」（首题长延迟、好几个语音挨个或同时出）。
        if (mySeq !== speakSeq) return false;
      }
    } catch {
      /* 克隆声失败，继续降级系统音 */
    }
  }
  textToSpeech(content, voice || 'system', language, undefined, () => opts.onStart?.());
  return false;
}

/**
 * 从「俏皮短句」词库随机取一句，用最好的声音播报（克隆声优先、缓存秒出）。
 * 用于让反馈/引导更有烟火气：每次提示语都不一样（答对啦 / 太厉害了 / 你真行…），
 * 而不是固定重复同一句。取词与预热同源（pickPhrase），保证命中本地缓存、零重复 token。
 *
 * @param cat 词库分类（thinking / correct / wrong / voiceHeard …）
 */
export async function speakPhrase(
  cat: PhraseCategory,
  language: 'zh' | 'en' = 'zh',
  opts: SpeakOptions = {},
): Promise<boolean> {
  const text = pickPhrase(cat, language);
  if (!text) return false;
  return speakWithBestVoice(text, language, opts);
}

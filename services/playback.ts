import { textToSpeech, stopSpeech } from './tts';
import {
  playClonedAudio,
  stopClonedAudio,
  hasClonedVoice,
  prewarmClonedAudio,
  type ChunkPlace,
} from './clonedVoicePlayback';
import { getPromptVoiceSetting } from './storage';
import { DEFAULT_VOICE, normalizeVoiceId } from './voiceCatalog';
import { pickPhrase, type PhraseCategory } from './phraseBank';
import type { CloneTarget } from './voiceClone';

/**
 * 统一播放入口（v81 重构：提示音与故事朗读彻底分开）
 * ---------------------------------------------------------------------------
 * 语义从此变得「选项即结果」，不再有隐藏的声线映射：
 *   'system'      → 手机自带离线语音（expo-speech）
 *   'preset:xxx'  → 云端内置样本音色（中英文一致，无机器味）
 *   'mom'/'dad'…  → 家长克隆的真人音色
 *
 * 云端合成失败 / 未克隆时，按「换内置样本 → 落系统语音」两级兜底，
 * 保证任何情况下都有声音（离线也能讲）。
 */

/** 某个声线在云端不可用时的兜底链（供预热与播放共用） */
function voiceCandidates(voiceId: string | undefined): string[] {
  const id = normalizeVoiceId(voiceId);
  if (id === 'system') return []; // 系统语音不需要云端，直接本地合成
  const list = [id];
  if (id !== DEFAULT_VOICE) list.push(DEFAULT_VOICE); // 兜底换回默认样本音色
  return list;
}

/** 该声线需要预先合成的目标（供调用方预热，点播放即秒出） */
export function presetTargetFor(voiceId: string | undefined): string | undefined {
  const id = normalizeVoiceId(voiceId);
  return id === 'system' ? DEFAULT_VOICE : id;
}

/**
 * 播放故事。返回是否用上了「云端音频」（true 时调用方可用真实播放位置驱动进度条）。
 * 注意：本函数「发起即返回」，进度条由调用方按字数估算驱动（见 [id].tsx）。
 */
/** 最近一次 playStory 实际用上的声线（降级后用的一定是兜底声线，不是用户选的那个） */
let lastPlayedVoice = '';
export function getLastPlayedVoice(): string {
  return lastPlayedVoice;
}

/**
 * 「故事正在播」标志（2026-11-04，v93 #1）
 * ---------------------------------------------------------------------------
 * 回前台时 `GreetingOnOpen` 会播每日问候，而 `speakWithBestVoice` 默认先 `stopStory()`。
 * 于是「上划退出 → 回来」的场景里，问候语会把刚重建的分片播放器连同 chunkState 一起清掉，
 * 故事表现为「点了播放一直缓冲 / 没声音」。这里让问候先问一句「故事是不是在播 / 是不是
 * 正在等续播」，是就让路，不打断孩子的故事。
 */
let storyPlaying = false;
let storyResumePending = false;

export function setStoryPlaying(v: boolean): void {
  storyPlaying = v;
}
export function isStoryPlaying(): boolean {
  return storyPlaying;
}
/** 进后台时置 true、续播真正发起后清 false：这期间问候语必须让路 */
export function setStoryResumePending(v: boolean): void {
  storyResumePending = v;
}
export function isStoryResumePending(): boolean {
  return storyResumePending;
}

export async function playStory(
  text: string,
  voiceId: string,
  language: 'zh' | 'en' = 'zh',
  onDone?: () => void,
  /**
   * startAt：从第几秒开始讲（换声 / 断点续播）。
   * 长故事走分片时，它会直接定位到对应那一篇起播，不再「从开头播一瞬再跳」。
   * startChunk：更精确的「片索引 + 片内秒」断点，优先于 startAt（v93 #1）。
   */
  opts?: { startAt?: number; startChunk?: ChunkPlace },
): Promise<boolean> {
  const startAt = opts?.startAt && opts.startAt > 1 ? opts.startAt : undefined;
  const startChunk = opts?.startChunk;
  for (const target of voiceCandidates(voiceId)) {
    const ok = await playClonedAudio(
      text,
      target as CloneTarget,
      onDone,
      undefined,
      undefined,
      startAt || startChunk ? { startAt, startChunk } : undefined,
      language,
    );
    if (ok) {
      lastPlayedVoice = target; // 记录真实生效的声线（供界面判断"点了没反应"）
      storyPlaying = true;
      return true;
    }
  }
  // 云端全不可用（离线 / 未授权 / 未克隆）：用手机自带语音讲，保证一定有声音
  lastPlayedVoice = 'system';
  storyPlaying = true;
  textToSpeech(text, 'system', language, onDone);
  return false;
}

/** 停止一切播放（云端音频 + 系统音） */
export function stopStory(): void {
  storyPlaying = false;
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
/**
 * 说一句「提示语」（提问、鼓励、状态播报、AI 回答等）。
 * 用「提示音声线」发音——v81 起它与故事朗读声线是两个独立设置，
 * 默认都是内置大姐姐（中英文一致），家长可在家长端分别更改。
 *
 * 行为：
 * - 任何一次调用都会先打断上一段（云端音频 + 系统音），保证「动作/界面切换时旧声立刻停、
 *   新声立刻响」，解决多个提示音叠加/串台的问题；
 * - 并发安全：云端合成期间若来了更新的请求，旧的那次合成完会放弃播放，不覆盖新声；
 * - 同一文本 + 同一音色只合成一次并落盘缓存：命中后秒出、零重复 token；
 * - 云端不可用（离线 / 未授权 / 未克隆）时逐级降级，最终一定落到手机自带语音，保证有声音。
 *
 * @param opts.urgent    （已废弃）保留仅为兼容旧调用点，不再影响行为。
 * @param opts.interrupt false=不打断上一段（极少用）；默认 true
 * @param opts.voiceId   指定声线；缺省则读「提示音声线」设置
 */
let speakSeq = 0;
export interface SpeakOptions {
  urgent?: boolean;
  interrupt?: boolean;
  voiceId?: string;
  /** 真正开始出声时回调（用于让界面文字与语音同时出现，避免"字先出、声后到"的时差） */
  onStart?: () => void;
  /** 本句播放结束时回调（克隆声 onEnded / 系统音 onDone 触发），用于"播完再进入下一环节" */
  onDone?: () => void;
  /**
   * 只用「已落盘的」克隆音频：缓存没命中就立刻用系统音说，不在现场发起网络合成。
   * 用于锁屏/切后台的告别语等「必须马上出声」的场景（后台网络会被 iOS 降速，等它就会慢十几秒）。
   */
  cacheOnly?: boolean;
  /** 快速起播：跳过音频会话配置的等待，进一步压缩起播延迟（配合 cacheOnly 使用） */
  fast?: boolean;
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
      // v81：提示音读「提示音声线」，与故事朗读声线彻底分开。
      // 之前这里读的是故事声线，于是「家长把故事换成妈妈的声音」会连带把
      // 所有提示音也换成克隆声，中英文界面表现还不一致。
      voice = await getPromptVoiceSetting();
    } catch {
      voice = undefined;
    }
  }
  const target = normalizeVoiceId(voice);

  // 快通道（锁屏告别等）：只认本地已缓存的音频，不做任何存储查询 / 网络合成。
  // 未命中就当场用系统音（本地合成，几乎瞬时），保证「再见了 xxx」不再等十几秒。
  if (opts.cacheOnly) {
    if (target !== 'system') {
      try {
        const ok = await playClonedAudio(
          content,
          target as CloneTarget,
          () => opts.onDone?.(),
          () => mySeq === speakSeq,
          () => opts.onStart?.(),
          { cacheOnly: true, fast: opts.fast !== false },
          language,
        );
        if (ok) return true;
      } catch {
        /* 继续降级系统音 */
      }
    }
    // 同样要校验：这期间可能已经有更新的请求（比如锁屏告别）抢走了播报权
    if (mySeq !== speakSeq) return false;
    textToSpeech(content, 'system', language, () => opts.onDone?.(), () => opts.onStart?.());
    return false;
  }

  // 云端音频（内置样本 / 克隆声）：命中本地缓存则秒出、零 token；未命中则现合成一次并落盘。
  // 选中「手机系统语音」时直接跳过这一步，走本地离线合成。
  for (const cand of voiceCandidates(target)) {
    try {
      // 内置样本音色不需要克隆，直接可用；只有「亲人克隆声」才要确认真的克隆过。
      // （之前这里统一用 hasClonedVoice 判断，preset 会被判成"没克隆"而直接被跳过。）
      const ready = cand.startsWith('preset:') || (await hasClonedVoice(cand));
      if (ready) {
        const ok = await playClonedAudio(
          content,
          cand as CloneTarget,
          () => opts.onDone?.(),
          () => mySeq === speakSeq,
          () => opts.onStart?.(),
          { fast: opts.fast },
          language,
        );
        if (ok) return true;
        // 关键修复（#4/#5）：若本请求已被更新的旁白请求取代（abortCheck 失败），
        // 则本句必须「静默放弃」——由取代它的新请求负责出声。
        // 否则旧的这请求会落到下面的 textToSpeech 用系统女声补一句，
        // 与正在响的克隆声叠加成「双声 / 几个声音同时出来」（首题长延迟、好几个语音挨个或同时出）。
        if (mySeq !== speakSeq) return false;
      }
    } catch {
      /* 该候选不可用，继续下一个 */
    }
  }
  // ★ 只有「最新一次」请求才有资格落回系统音。
  //
  // 这里原先没有这道校验，是「锁屏时听到『晚上好』和『再见』同时响」的根因：
  //   speak('hello') 进来时 mySeq=1，随后 await getVoiceSetting / hasClonedVoice
  //   （甚至还要等一次网络合成）；用户此时锁屏，speak('bye') 把 speakSeq 推到 2
  //   并把「再见了」播了出来；等 hello 那条 async 链路继续跑到这里，
  //   它并不知道自己已经被取代，于是又用系统音补喊了一句「晚上好」——两句话叠在一起。
  // 加这道守卫后，被取代的请求到此为止，静默退出。
  if (mySeq !== speakSeq) return false;
  textToSpeech(content, 'system', language, () => opts.onDone?.(), () => opts.onStart?.());
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

/**
 * 预热一句「提示语」（用提示音声线）——点下去就出声，不再等合成。
 * ---------------------------------------------------------------------------
 * v91 #4：配色页点选后语音要等十几秒才响。短句也是现场合成的，
 * 只要没命中磁盘缓存就要走一次网络。进页面时先把要说的几句合成好落盘，
 * 真正点击时直接命中缓存（零延迟、零 token）。
 */
export async function prewarmSpeech(text: string, language: 'zh' | 'en' = 'zh'): Promise<void> {
  const content = (text || '').trim();
  if (!content) return;
  let voice: string | undefined;
  try {
    voice = await getPromptVoiceSetting();
  } catch {
    voice = undefined;
  }
  const target = normalizeVoiceId(voice);
  if (target === 'system') return; // 系统音是本地合成，不需要预热
  const t2 = presetTargetFor(target);
  if (!t2) return;
  try {
    await prewarmClonedAudio(content, t2, language);
  } catch {
    /* 预热失败不影响正常播放 */
  }
}

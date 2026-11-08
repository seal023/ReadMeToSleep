import {
  playClonedAudio,
  stopClonedAudio,
  hasClonedVoice,
  prewarmClonedAudio,
  hasAllChunksCached,
  getSynthCacheStats,
  type ChunkPlace,
} from './clonedVoicePlayback';
import { getPromptVoiceSetting } from './storage';
import { DEFAULT_VOICE, normalizeVoiceId } from './voiceCatalog';
import { pickPhrase, type PhraseCategory } from './phraseBank';
import type { CloneTarget } from './voiceClone';

/**
 * 统一播放入口（v110：彻底废弃系统机器音）
 * ---------------------------------------------------------------------------
 * 语义仍然是「选项即结果」，但**没有任何机器音兜底**：
 *   'preset:xxx'  → 云端内置样本音色（中英文一致，无机器味）
 *   'mom'/'dad'…  → 家长克隆的真人音色
 *   免费 5 篇     → 由 story 页直接读随包 MP3（本文件都不进来）
 *
 * 云端合成失败 / 未克隆时，只在样本音色之间降级（换回默认大姐姐）；
 * 全部失败就明确返回 false + 标记 unavailable，由调用方报错重试。
 * ⚠️ 绝不再调用 expo-speech：那是「开局机器音 + 大姐姐音双声叠加」的温床，
 *    儿童场景也不需要机械嗓音。
 */

/** 某个声线在云端不可用时的兜底链（供预热与播放共用） */
function voiceCandidates(voiceId: string | undefined): string[] {
  const id = normalizeVoiceId(voiceId);
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
 * v109 音频仲裁 · 全局「同一时间只允许一个音频实例」的代号
 * ---------------------------------------------------------------------------
 * build 107 反馈 #2「开局机器音 + 大姐姐音同时响」的根因：
 *   · speakWithBestVoice 的并发保护只看 speakSeq，而 stopStory() 不动 speakSeq；
 *   · 于是一个**正在云端合成**（几秒后才出声）的提示音请求，在故事起播调
 *     stopStory() 之后依然会按原计划播出来，与故事的 expo-speech 叠成双声。
 *   · playStory 与 speakWithBestVoice 分属两条链路，彼此也不知道对方在播。
 *
 * 这里引入跨链路的 epoch：stopStory()（任何停止 / 新起播前都会调）让代号 +1，
 * 所有在途请求在每个 await 边界复核「自己还是不是最新的一代」，不是就静默放弃，
 * 绝不允许旧实例在触发播放后才被"补停"。
 */
let audioEpoch = 0;
/** 让所有在途播放/合成请求作废（一般不要直接调，用 stopStory()） */
export function bumpAudioEpoch(): void {
  audioEpoch += 1;
}
export function getAudioEpoch(): number {
  return audioEpoch;
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
   * 长故事走分片时，它会直接定位到对应那一篇起播，不再「从开头讲一瞬再跳」。
   * startChunk：更精确的「片索引 + 片内秒」断点，优先于 startAt（v93 #1）。
   * isStillWanted：v97 —— 每一段 await 前后都会问一次「这次播放还要不要」。
   *   离开故事页 / 换了声线 / 已停止时返回 false，引擎会在**真正出声前**放弃，
   *   避免「人已经不在这个页面了，声音却突然响起来」（反馈 #1：选完声音没点播放，
   *   几秒后自己念起旧声线）。
   */
  opts?: {
    startAt?: number;
    startChunk?: ChunkPlace;
    isStillWanted?: () => boolean;
  },
): Promise<boolean> {
  const startAt = opts?.startAt && opts.startAt > 1 ? opts.startAt : undefined;
  const startChunk = opts?.startChunk;
  const stillWanted = opts?.isStillWanted;

  // v109：本轮播放所属代号。任何 stopStory() / 新的 speak 请求都会让在途边界复核失败。
  const myEpoch = audioEpoch;
  const wanted = () => myEpoch === audioEpoch && (stillWanted ? stillWanted() : true);

  // 起播前把旧的播放器彻底销毁（stop & release）。
  // 只停「已经在响」的不够：旧 player 若没被 remove，新 player 建起来就是两个实例并存。
  // v110：系统机器音已整体移除，这里不再需要停 expo-speech；
  // 仍在云端合成中的旧请求由 audioEpoch 在 await 边界静默作废。
  stopClonedAudio();

  /**
   * v102 成本核验：整篇（含每一片）都已落盘时，本次播放的每一片都会命中本地文件，
   * 绝不会调用云端 TTS。打一条日志方便在 TestFlight 里确认「再次播放零扣费」。
   */
  const primary = presetTargetFor(voiceId);
  if (primary && hasAllChunksCached(text, primary as CloneTarget, language)) {
    const s = getSynthCacheStats();
    console.log(
      `[TTSCache] 全分片命中本地缓存，本次播放 0 次云端合成（累计命中 ${s.cacheHits} / 云端 ${s.networkCalls}）`,
    );
  }

  for (const target of voiceCandidates(voiceId)) {
    if (!wanted()) {
      lastPlayedVoice = 'aborted';
      return false;
    }
    const ok = await playClonedAudio(
      text,
      target as CloneTarget,
      onDone,
      // abortCheck：引擎在每个合成/起播边界都会调它，false 即彻底放弃（不再出声）
      wanted,
      undefined,
      startAt || startChunk
        ? { startAt, startChunk, markNaturalEnd: true }
        : { markNaturalEnd: true },
      language,
    );
    if (ok) {
      lastPlayedVoice = target; // 记录真实生效的声线（供界面判断"点了没反应"）
      storyPlaying = true;
      return true;
    }
  }
  // v110：云端全部不可用（离线 / 未授权 / 未克隆）时**绝不回退系统机器音**。
  // 明确标记 unavailable，由 story 页弹错误并停止播放态（不让估算进度条空转几十秒）。
  // 「已被更新的播放取代」的请求则静默放弃，不报错、不发声。
  if (!wanted()) {
    lastPlayedVoice = 'aborted';
    return false;
  }
  lastPlayedVoice = 'unavailable';
  storyPlaying = false;
  console.warn('[playback] 云端音频不可用：已按产品决策不回退系统机器音');
  return false;
}

/** 停止一切播放，并作废所有还在合成/起播中的在途请求（v110：已无系统音这一路） */
export function stopStory(): void {
  // 必须先推进代号：stopClonedAudio() 内部若是 async，
  // 在途请求可能在它返回前就醒来，晚了就拦不住了。
  audioEpoch += 1;
  storyPlaying = false;
  // 彻底销毁旧播放器实例（hardStopPlayer 内部 pause + remove 各自 try）
  stopClonedAudio();
}

/**
 * 彻底取消「说话」——包括**还没出声的那一句**（v107）。
 * ---------------------------------------------------------------------------
 * `stopStory()` 只能停掉「已经在响」的音频：而 AI 回答这类长句往往是
 * 先云端合成几秒、再落盘播放——用户点了 Finish 界面切走了，几秒后声音才响起来。
 * 这里把 speakSeq 推进一格，让所有还在合成中的 speakWithBestVoice 请求作废，
 * 合成完也不会出声。
 *
 * ⚠️ 不要把它塞进 stopStory()：speakWithBestVoice 自己是「先取号再 stopStory()」，
 * 若 stopStory 也推进序号，新请求会把自己作废掉。
 */
export function cancelSpeaking(): void {
  speakSeq += 1;
  stopStory();
}

/**
 * 用「当前最好的声音」说一句话（内置样本 / 克隆声，v110 起无机器音兜底）。
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
 * - 云端不可用（离线 / 未授权 / 未克隆）时静默收尾：绝不回退手机自带机器音（双声根因），
 *   但 onStart/onDone 仍会触发，界面流程不会卡死。
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
   * 只用「已落盘的」克隆音频：不在现场发起网络合成。
   * v110：缓存没命中就静默收尾（不再用系统机器音补一句），
   * 用于锁屏/切后台的告别语等「必须马上结束」的场景。
   */
  cacheOnly?: boolean;
  /** 快速起播：跳过音频会话配置的等待，进一步压缩起播延迟（配合 cacheOnly 使用） */
  fast?: boolean;
}

/**
 * v110 机器音兜底移除后的「静默收尾」。
 * 不发出任何声音，但仍触发 onStart / onDone，让那些「播完这句再做下一步」的
 * 交互（问答、告别、鼓励）不会因为无声而卡死。绝不调用 expo-speech。
 */
function silentSettle(opts: SpeakOptions): void {
  setTimeout(() => {
    opts.onStart?.();
    opts.onDone?.();
  }, 0);
}

export async function speakWithBestVoice(
  text: string,
  language: 'zh' | 'en' = 'zh',
  opts: SpeakOptions = {},
): Promise<boolean> {
  const content = (text || '').trim();
  if (!content) return false;

  const mySeq = ++speakSeq;
  if (opts.interrupt !== false) stopStory(); // 立即打断旧的（克隆 + 系统），并推进 audioEpoch
  // 必须在 stopStory() **之后**取号：否则自己刚推进的 epoch 会把自己作废。
  const myEpoch = audioEpoch;
  // 跨链路仲裁：故事起播 / 任何 stopStory() 都会让本句的合成在途请求失效
  const stillCurrent = () => mySeq === speakSeq && myEpoch === audioEpoch;

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
  // v110：未命中就静默收尾，不再用系统机器音补一句（保证即刻结束、且不会双声）。
  if (opts.cacheOnly) {
    if (target !== 'system') {
      try {
        const ok = await playClonedAudio(
          content,
          target as CloneTarget,
          () => opts.onDone?.(),
          stillCurrent,
          () => opts.onStart?.(),
          { cacheOnly: true, fast: opts.fast !== false },
          language,
        );
        if (ok) return true;
      } catch {
        /* 该候选不可用，继续静默收尾 */
      }
    }
    // 同样要校验：这期间可能已经有更新的请求（比如锁屏告别）抢走了播报权
    if (!stillCurrent()) return false;
    // v110：缓存未命中 → 静默收尾，绝不用系统机器音补一句（双声叠加的旧根因）
    silentSettle(opts);
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
          stillCurrent,
          () => opts.onStart?.(),
          { fast: opts.fast },
          language,
        );
        if (ok) return true;
        // 关键修复（#4/#5）：若本请求已被更新的旁白请求取代（abortCheck 失败），
        // 则本句必须「静默放弃」——由取代它的新请求负责出声。
        // 否则旧的这请求会继续走完流程、再补发一次声音，与正在响的克隆声
        // 叠加成「双声 / 几个声音同时出来」（首题长延迟、好几个语音挨个或同时出）。
        if (!stillCurrent()) return false;
      }
    } catch {
      /* 该候选不可用，继续下一个 */
    }
  }
  // ★ 只有「最新一次」请求才有资格收尾。
  //
  // 这里原先没有这道校验，是「锁屏时听到『晚上好』和『再见』同时响」的根因：
  //   speak('hello') 进来时 mySeq=1，随后 await getVoiceSetting / hasClonedVoice
  //   （甚至还要等一次网络合成）；用户此时锁屏，speak('bye') 把 speakSeq 推到 2
  //   并把「再见了」播了出来；等 hello 那条 async 链路继续跑到这里，
  //   它并不知道自己已经被取代，于是又用系统音补喊了一句「晚上好」——两句话叠在一起。
  // 加这道守卫后，被取代的请求到此为止，静默退出。
  if (!stillCurrent()) return false;
  // v110：云端候选全部不可用时静默收尾，绝不回退 expo-speech 机器音。
  // onStart/onDone 仍会触发，保证界面流程不卡死。
  console.warn('[playback] 提示音云端不可用：静默收尾（不回退机器音）');
  silentSettle(opts);
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
  // v110：normalizeVoiceId 会把历史遗留的 'system' 迁移成默认大姐姐，
  // 这里保留防御判断，避免任何老设置值触发已删除的机器音链路。
  if (target === 'system') return;
  const t2 = presetTargetFor(target);
  if (!t2) return;
  try {
    await prewarmClonedAudio(content, t2, language);
  } catch {
    /* 预热失败不影响正常播放 */
  }
}

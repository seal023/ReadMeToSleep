import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { ts } from './i18n';
// SDK 57 起顶层 expo-file-system 的旧 API（cacheDirectory / writeAsStringAsync）已移除，
// 新 API 的 File / Paths / Directory 直接从包根导入即可（`/next` 子路径已不在 exports 映射里）。
import { Directory, File, Paths } from 'expo-file-system';
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

/**
 * 分片流式播放状态（v90 反馈 #1/#3）
 * ---------------------------------------------------------------------------
 * 长故事（数千字）原来整段合成一个巨大 mp3 → 首次要等整段合成完才播、暂停后
 * 重播又重新 load 巨大文件。改为「分片 TTS + 边播边合成」：长文本切成若干片，
 * 每片独立合成小 mp3，合成第 1 片就播，边播边预取后续片，片间无缝衔接；
 * 暂停 = pause 当前片（不销毁），恢复 = resume（不重新合成/load）。
 * 短文本仍走原整段逻辑。currentPlayer 仍指向「当前在播的那一片」的 player，
 * 片切换时更新，从而复用 armEndWatch 的轮询检测。
 */
const CHUNK_THRESHOLD_CHARS = 480; // 文本超过此字符数即走分片（中文约 480 字 / 英文约 320 词）
const CHUNK_TARGET_CHARS = 280; // 每片目标长度（中文）；英文按约 3 倍字符折算
/** 克隆音色单次合成明显更慢，片长压到 120 字，换声后第一次出声快得多（v91 #1） */
const CHUNK_TARGET_CHARS_CLONE = 120;
const CHUNK_PRELOAD = 2; // 当前片播放时，后台预取接下来的片数

interface ChunkState {
  active: boolean;
  chunks: string[];
  target: CloneTarget;
  language: 'zh' | 'en';
  onDone?: () => void;
  abortCheck?: () => boolean;
  onStart?: () => void;
  fast?: boolean;
  durations: number[]; // 每片真实时长（秒），播放后逐片填入
  synthDone: boolean[];
  synthRunning: Set<number>;
  current: number; // 当前播放片索引（-1=尚未起播）
  paused: boolean;
  pendingAdvance: boolean; // 当前片已播完，但下一片尚未合成好，等待中
  started: boolean;
  onStartFired: boolean; // 整体 onStart 是否已触发（仅第一片出声时触发一次）
  /** 起播要落在这一片的第几秒（换声 / 断点续播时直接从这里开始，不从故事开头播） */
  startIdx: number;
  startOffset: number;
}
let chunkState: ChunkState | null = null;

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
/**
 * 音频会话被系统打断（来电 / 切后台）期间，屏蔽一切「播完」判定。
 * 打断时 iOS 会让 expo-audio 在原生层暂停 / 自动续播一个孤儿播放器，期间 player.playing
 * 会变成 false 且位置停在中途 —— 若不屏蔽，下面的「停滞判定」会误以为故事讲完了，
 * 把孩子直接推到提问环节（v86 反馈 #1）。由 [id].tsx 在 AppState 变化时置位 / 复位。
 */
let interrupted = false;
export function setPlaybackInterrupted(v: boolean): void {
  interrupted = v;
}
export function isPlaybackInterrupted(): boolean {
  return interrupted;
}
/**
 * 手动暂停标志（v90 #2）：pauseClonedAudio 只 pause 当前 player 不销毁，
 * 若不在「播完」检测里屏蔽，停滞检测器会把"暂停"误判成"故事讲完"把孩子推到提问环节。
 * 由 pauseClonedAudio / resumeClonedAudio 置位 / 复位；stopClonedAudio 整体停止时清掉。
 */
let userPaused = false;

/** onEnded 事件的守门人（只有真到末尾才放行），见 armEndWatch 内注释 */
let acceptEnd: (() => void) | null = null;
// 出现过的最大时长：长音频起播/缓冲抖动时 duration 可能瞬间回退，
// 用它识别「duration 异常回退」从而避免误判结束（Issue 8）。
let maxDur = 0;
/**
 * v80 #4：故事播完后没进「奖杯 / 提问」环节。
 * ---------------------------------------------------------------------------
 * 原因：AVPlayer 播完的瞬间 currentTime 可能直接归零或跳变，于是
 *   `pos >= dur - 0.6` 这条判据永远命不中 → 界面卡在播放页不动，
 *   只能等调用方那个「估算时长 + 45s」的安全定时器，孩子早就走神了。
 * 加两重独立兜底：
 *   ① 硬定时器：时长已知后按「剩余时长 + 2s」挂一次性 timeout，与位置轮询无关；
 *   ② 播放器自报停止：player.playing 变 false 且已经播过一段 → 连续 2s 视为播完。
 */
let hardEndTimer: ReturnType<typeof setTimeout> | null = null;
/** 硬定时器当前被安排在什么时刻（ms 时间戳）：dur/pos 变化超过 3s 就重挂，见下方注释 */
let hardEndArmAt = 0;
let stallTicks = 0;
/**
 * v81 #1：「点播放直接进入提问环节」的根因就在这里。
 * ---------------------------------------------------------------------------
 * 上一版加的「播放器自报已停止」判据（!playing && pos > 2，连续 2s → 判播完）
 * 在两种完全正常的场景下都会误命中：
 *   · 断点续播 seek 到 45s 后，AVPlayer 会短暂 playing=false（缓冲/跳转中），
 *     而 pos 已经在 45 秒，远超 pos>2 —— 2 秒后就直接判「故事讲完了」；
 *   · 起播瞬间 player.playing 仍为 false（还没真正开始），currtime 又已被 seek 过。
 * 于是第一遍点播放、屏幕立刻变成「故事讲完啦」，而第二遍因为走缓存起播快、
 * 位置没被 seek，就"看起来正常"。
 *
 * 修正：判停必须同时满足
 *   ① 本次播放**确实出过声**（sawPlaying：player.playing 变为 true 过）；
 *   ② 位置**真的推进过**（maxPos 明显大于起播位置）；
 *   ③ 当前不在末尾附近（末尾由位置判据 ① 负责）。
 * 三者缺一，宁可交给「硬定时器」兜底，也绝不提前结束故事。
 */
let sawPlaying = false;
let maxPos = 0;
let startPos = 0;
/** 上一拍的位置：用于识别「用户往回拖了」，据此重挂硬定时器 */
let lastPos = 0;

function clearHardEnd(): void {
  if (hardEndTimer) {
    clearTimeout(hardEndTimer);
    hardEndTimer = null;
  }
  hardEndArmAt = 0;
  stallTicks = 0;
  sawPlaying = false;
  maxPos = 0;
  startPos = 0;
  lastPos = 0;
}

function resetEndWatch(): void {
  if (endWatchTimer) {
    clearInterval(endWatchTimer);
    endWatchTimer = null;
  }
  clearHardEnd();
  endFired = false;
  endOnce = null;
  acceptEnd = null;
  maxDur = 0;
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
    clearHardEnd();
    try {
      onDone();
    } catch {
      /* 忽略回调异常 */
    }
  };
  /**
   * 事件式 onEnded 的守门人（v82 反馈 #3 根因修复）
   * ---------------------------------------------------------------------------
   * expo-audio 的 `player.onEnded` 会在**不止一种**情况下触发：
   *   · 真的播到结尾（我们要的）；
   *   · seek 到断点后缓冲、音频还没 ready；
   *   · 切后台 / 锁屏时音频会话被系统收回。
   * 后两种都是「假播完」。之前这里直接把 endOnce 挂给 onEnded，于是一次假信号就：
   *   ① 立刻把界面推到「故事讲完啦」；
   *   ② 顺带把 endFired 置位、停掉轮询，导致**真的播完时再也不结束**。
   * 现在只接受「位置确实在末尾」的信号，其余忽略且不置 endFired，
   * 让轮询（①位置到末尾 / ②硬定时器 / ③停滞判定）继续兜底。
   */
  const acceptEndSignal = () => {
    if (endFired) return;
    const dur = getClonedDurationRaw();
    const pos = getClonedPositionRaw();
    if (dur > 0.4 && pos >= dur - 1.5) endOnce?.();
  };
  acceptEnd = acceptEndSignal;
  endWatchTimer = setInterval(() => {
    if (endFired || !currentPlayer) return;
    // 打断期间（来电 / 切后台）屏蔽一切「播完」判定，避免孤儿播放器的暂停被误判为结束
    if (interrupted) {
      stallTicks = 0;
      return;
    }
    // 手动暂停期间同样屏蔽：pauseClonedAudio 只 pause 不销毁 player，否则停滞检测会
    // 把"暂停"误判成"故事讲完"（v90 #2）
    if (userPaused) {
      stallTicks = 0;
      return;
    }
    const dur = getClonedDuration();
    const pos = getClonedPosition();
    // duration 未加载完成（0）时不做判断，避免刚起播就误判结束
    if (dur <= 0.4) return;
    // 长音频（尤其 AI 创作故事）起播/缓冲抖动时 duration 会瞬间回退，
    // 若直接拿「当前很小的 dur」去比 pos 就会误判「已播完」→ 故事没讲完就跳结束。
    // 故跟踪出现过的最大时长，仅当「当前 dur 没有异常回退」且「位置接近真实时长」才判结束。
    if (dur > maxDur) maxDur = dur;
    // —— 分片流式模式：仅「当前片到末尾」判结束（切下一片 / 故事结束），
    //    禁用「中途停顿判停」，避免网络卡顿被误判成片播完而跳片；暂停时亦不判。
    if (chunkState && chunkState.active) {
      // ⚠️ 必须用「当前片」的原始位置/时长，不能用累计值：
      //    累计 pos 永远小于累计总时长（除最后一片），用累计值判「到末尾」会导致
      //    片与片之间永远不切换 —— 只有整段最后一片播完才结束。
      const rdur = getClonedDurationRaw();
      const rpos = getClonedPositionRaw();
      const p = currentPlayer as unknown as { playing?: boolean } | null;
      if (p && typeof p.playing === 'boolean' && p.playing) sawPlaying = true;
      if (!chunkState.paused && rdur > 0.4 && rpos >= rdur - 0.6) endOnce?.();
      return;
    }
    // 记录起播位置与推进情况（断点续播时起播位置就是 seek 到的秒数）
    if (startPos === 0 && pos > 0) startPos = pos;
    if (pos > maxPos) maxPos = pos;
    // 往回拖（±15s 后退 / 拖进度条）：原来的硬定时器已经不对了，清掉让它按新位置重挂，
    // 否则「往回拖一段接着听」会在原来那个时间点被强行掐断。
    if (pos < lastPos - 2) {
      if (hardEndTimer) {
        clearTimeout(hardEndTimer);
        hardEndTimer = null;
      }
      stallTicks = 0;
    }
    lastPos = pos;
    // ① 位置到末尾（原有判据）
    if (dur >= maxDur - 0.6 && pos >= dur - 0.6) {
      endOnce?.();
      return;
    }
    // ② 硬定时器：时长已知后，按「剩余时长 + 2s」挂一次性 timeout。
    //    与 currentTime 是否归零无关，是"音频确实播完了"最可靠的兜底。
    //
    // ⚠️ 2026-11-03 修复（v84 反馈 #5「打卡成功在故事没讲完就跳出来」）：
    //    原来只在**第一拍**挂一次，之后再也不重算。长音频（AI 创作 / 旅行打卡 5–10 分钟）
    //    起播时 AVPlayer 报的 duration 往往只是已加载的那一小段（远小于真实时长），
    //    于是定时器按那个小数挂上去 → 故事才讲到一半就被判「播完」→ 直接弹打卡成功。
    //    现在每一拍都用最新的 dur/pos 重算目标时刻，偏差超过 3s 就重挂；
    //    duration 长出来后目标时刻自然跟着往后推，正常播放时两者几乎不变（不会抖）。
    const wantArmAt = Date.now() + Math.max(0, dur - pos) * 1000 + 2000;
    if (!hardEndTimer) {
      hardEndArmAt = wantArmAt;
      hardEndTimer = setTimeout(() => {
        endOnce?.();
      }, Math.max(2000, wantArmAt - Date.now()));
    } else if (Math.abs(wantArmAt - hardEndArmAt) > 3000) {
      clearTimeout(hardEndTimer);
      hardEndArmAt = wantArmAt;
      hardEndTimer = setTimeout(() => {
        endOnce?.();
      }, Math.max(2000, wantArmAt - Date.now()));
    }
    // ③ 播放器自报已停止
    //    v81 修正：必须「真的出过声」+「位置真的往前走过」才允许判停，
    //    否则 seek 后的缓冲停顿会被当成播完（见上方 sawPlaying 注释）。
    const p = currentPlayer as unknown as { playing?: boolean } | null;
    if (p && typeof p.playing === 'boolean') {
      if (p.playing) sawPlaying = true;
      const advanced = maxPos > startPos + 1.5;
      // 末尾附近交给判据 ①，这里只管「中途停住」；且停顿点要明显离结尾还有距离
      const midStream = pos < dur - 3;
      if (!p.playing && sawPlaying && advanced && midStream) {
        stallTicks += 1;
        if (stallTicks >= 12) endOnce?.(); // 连续 3 秒停在非开头位置 → 认为已播完
      } else {
        stallTicks = 0;
      }
    }
  }, 250);
}

// —— 合成缓存 ——
// 同一段文本（同音色）只合成一次并落盘；playClonedAudio 与预热共用，
// 既让「再次播放」瞬时开始，也避免预热与播放并发重复调用接口。
const inflight = new Map<string, Promise<{ ok: boolean; error?: string }>>();

/**
 * 音频缓存目录（v62 反馈 #1）
 * ---------------------------------------------------------------------------
 * 原先存在 Paths.cache（iOS 的 Library/Caches），那是「系统可随时回收」的目录：
 * 存储紧张时 iOS 会整目录清掉，而我们感知不到 —— 表现就是「昨天听过的故事
 * 今天又要重新连服务器合成、等半天」。
 * 改到 Paths.document（Library/Documents），只有用户卸载 App 才会消失。
 *
 * 代价：升级到本版本后，之前存在 cache 里的音频不会被沿用，
 * 每篇故事会重新合成一次，之后一直命中本地、不再联网。
 */
const AUDIO_DIR_NAME = 'rms_audio';

function audioDir(): Directory {
  const dir = new Directory(Paths.document, AUDIO_DIR_NAME);
  try {
    if (!dir.exists) dir.create({ intermediates: true });
  } catch {
    /* 并发创建 / 已存在，忽略 */
  }
  return dir;
}

/** 取缓存文件（统一走 document 目录，见 audioDir 说明） */
function cacheFile(fileName: string): File {
  return new File(audioDir(), fileName);
}

function cacheFileName(text: string, target: CloneTarget): string {
  return `rms_clone_${encodeURIComponent(target)}_${hashText(text)}.mp3`;
}

function writeBytesToCache(fileName: string, audio: ArrayBuffer): void {
  const file = cacheFile(fileName);
  if (!file.exists) {
    try {
      file.create();
    } catch {
      /* 并发创建 / 已存在，忽略；write 仍会覆盖 */
    }
  }
  file.write(new Uint8Array(audio));
}

/**
 * 该句在本地是否已有音频（内置安装 / 历史缓存命中）。
 * 用于「内置装完之后只补真正缺的那几条」，避免再发上百次联网合成。
 */
export function hasCachedAudio(text: string, target: CloneTarget): boolean {
  try {
    return cacheFile(cacheFileName(text, target)).exists;
  } catch {
    return false;
  }
}

/**
 * 把「随包内置」的提示音 mp3 落到本地缓存，文件名与联网合成完全一致。
 * ---------------------------------------------------------------------------
 * 这样播放链路一行都不用改：`ensureSynthFile` 的 `cached.exists` 直接命中，
 * 不发网络、不耗 token，安装后点下去就出声（v93「先生成 mp3 直接装进去」）。
 *
 * @param srcUri 内置资源解析出来的本地路径（Asset.localUri / uri）
 * @returns 目标缓存文件是否已就位
 */
export async function seedBundledAudio(
  text: string,
  target: CloneTarget,
  srcUri: string,
): Promise<boolean> {
  try {
    const dest = cacheFile(cacheFileName(text, target));
    if (dest.exists) return true;
    const bytes = await new File(srcUri).bytes();
    if (!bytes || bytes.length < 500) return false;
    if (!dest.exists) {
      try {
        dest.create();
      } catch {
        /* 并发创建忽略 */
      }
    }
    dest.write(bytes);
    return dest.exists;
  } catch {
    return false;
  }
}

/** 确保某段文本的克隆音频已落盘（命中缓存直接返回；并发调用只合成一次） */
async function ensureSynthFile(
  text: string,
  target: CloneTarget,
  fileName: string,
): Promise<{ ok: boolean; error?: string }> {
  const cached = cacheFile(fileName);
  if (cached.exists) return { ok: true };
  const running = inflight.get(fileName);
  if (running) return running;
  const task = (async () => {
    const { audio, error } = await synthesizeWithClonedVoice(text, target);
    if (error) return { ok: false, error };
    if (!audio) return { ok: false, error: ts('vc.diag.emptyAudio') };
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
 *
 * opts.maxChunks：只预热前 N 片。用于「顺手备一下兜底声线」——
 * 万一主声线合成失败要降级，第一段也能立刻出声（v91 #1）。
 */
export async function prewarmClonedAudio(
  text: string,
  target: CloneTarget,
  language: 'zh' | 'en' = 'zh',
  opts?: { maxChunks?: number },
): Promise<void> {
  try {
    if (!text || text.trim().length < 2) return;
    // 长文本按分片预热：避免一次性合成整段大文件（v90 #1/#3 同源）。
    // 进故事页即预热各片，点播放时多半已落盘 → 几乎瞬时出声。
    if (text.length > CHUNK_THRESHOLD_CHARS) {
      const all = splitIntoChunks(text, language, target);
      const chunks = opts?.maxChunks ? all.slice(0, Math.max(1, opts.maxChunks)) : all;
      const CONCURRENCY = 3;
      let cursor = 0;
      const worker = async () => {
        while (cursor < chunks.length) {
          const c = chunks[cursor++];
          try {
            await ensureSynthFile(c, target, cacheFileName(c, target));
          } catch {
            /* 单条失败不影响其它 */
          }
        }
      };
      const workers: Promise<void>[] = [];
      for (let i = 0; i < Math.min(CONCURRENCY, chunks.length); i++) workers.push(worker());
      await Promise.all(workers);
      return;
    }
    const fileName = cacheFileName(text, target);
    if (cacheFile(fileName).exists) return;
    await ensureSynthFile(text, target, fileName);
  } catch {
    /* 预热失败不影响正常播放 */
  }
}

/**
 * 批量预热一批高频固定短句（顺序执行）。逐条复用 ensureSynthFile 的「命中缓存即跳过 /
 * 并发只合成一次」逻辑，故同一文本 + 同一音色绝不会重复合成；单条失败静默忽略。
 * 用于克隆成功后 / App 启动时，把问候、鼓励、晚安等常用提示音预合成到本地，
 * 之后每次播这些短句都走本地缓存（秒出、零 token）。
 */
export async function prewarmPhraseBatch(target: CloneTarget, phrases: string[]): Promise<void> {
  // 小并发（3 路）：逐条串行时几十条要跑一两分钟，排在前面的告别/问候迟迟落不了盘，
  // 用户一锁屏就得现合成（后台更慢）。3 路足以在十几秒内把高频短句全部落盘，
  // 又不至于把接口打到限流（同文本仍只会合成一次，见 ensureSynthFile 的 inflight 去重）。
  const CONCURRENCY = 3;
  let cursor = 0;
  const worker = async () => {
    while (cursor < phrases.length) {
      const p = phrases[cursor++];
      try {
        await prewarmClonedAudio(p, target);
      } catch {
        /* 单条失败不影响其它 */
      }
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, phrases.length); i++) workers.push(worker());
  await Promise.all(workers);
}

/**
 * 清空某亲属 / 自定义对象的全部克隆音频缓存文件。
 * 文件名形如 `rms_clone_<encodedTarget>_<hash>.mp3`，按 target 前缀批量删除。
 * 用途：用户「重新克隆」同一对象（mom/dad/…）时，旧音色的音频还躺在缓存里，
 * 若不清理，ensureSynthFile 会因命中旧缓存而跳过重新合成，导致新音色不生效。
 * 重新克隆后调用本函数清掉旧缓存，下次播放这些短句会用新音色重新合成一次。
 */
export function clearClonedCacheForTarget(target: CloneTarget): void {
  try {
    const prefix = `rms_clone_${encodeURIComponent(target)}_`;
    const entries = audioDir().list();
    for (const entry of entries) {
      if (entry instanceof File && entry.name.startsWith(prefix)) {
        try {
          entry.delete();
        } catch {
          /* 删除失败忽略 */
        }
      }
    }
  } catch {
    /* 缓存目录不存在等异常，忽略 */
  }
}

/** 起播一个已落盘的音频文件，并装上播完检测 */
async function startPlayback(
  uri: string,
  onDone?: () => void,
  /** 真正开始出声时回调（供界面把文字与语音同步呈现） */
  onStart?: () => void,
  /** 快速模式：不等待音频会话配置完成就起播（切后台/锁屏后必须立刻出声的场景） */
  fast = false,
): Promise<boolean> {
  try {
    // 播放前必须配置音频会话，否则 iOS（尤其静音模式）下克隆声/本地录音会静音。
    // fast：不 await（切后台时这一步可能被系统拖慢，等它就会「过了好久才响」），
    // 因为此时会话通常已由前面的播放/问候配置好，直接起播更快。
    const modeTask = setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      shouldPlayInBackground: false,
    }).catch(() => {
      /* 忽略会话配置异常，继续尝试播放 */
    });
    if (!fast) {
      await modeTask;
    }

    // 防御（v90 #3）：任何路径遗留的旧 player 必须先彻底停掉再建新的。
    // 之前的实现直接覆盖 currentPlayer 引用，一旦某个旧 player 没被回收，
    // 它就会继续出声 —— 表现正是「选了内置大姐姐，耳朵里还是上一个克隆声」。
    if (currentPlayer) {
      try {
        currentPlayer.pause();
        currentPlayer.remove();
      } catch {
        /* 忽略回收异常 */
      }
      currentPlayer = null;
    }

    const player = createAudioPlayer({ uri }) as unknown as AudioPlayerLike;
    currentPlayer = player;
    armEndWatch(onDone);
    player.play();
    // 起播成功即回调，让调用方的文字可以与声音同时出现
    try {
      onStart?.();
    } catch {
      /* 忽略回调异常 */
    }

    // 事件式兜底（若该版本支持 onEnded）。
    // ⚠️ 走 acceptEnd 守门，不能直挂 endOnce：onEnded 会在 seek/缓冲/音频会话被收回时
    // 假触发，直挂会导致「一声没出就判播完」，且把 endFired 置位后真播完反而不结束。
    if (typeof player.onEnded === 'function') {
      try {
        (player.onEnded as (cb: () => void) => void)(() => acceptEnd?.());
      } catch {
        /* 忽略差异 */
      }
    } else {
      try {
        (player as { onEnded?: () => void }).onEnded = () => acceptEnd?.();
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
  /** 合成完成后、真正起播前的「还轮不轮到我」检查；返回 false 则放弃本次播放，避免旧调用慢半拍覆盖新调用 */
  abortCheck?: () => boolean,
  /** 真正出声时回调（让界面文字与语音同步出现） */
  onStart?: () => void,
  /**
   * cacheOnly：只播「已经落盘的」克隆音频，缓存没命中立刻返回 false（调用方马上降级系统音），
   *   绝不在这一步发起网络合成 —— 用于锁屏告别这类「必须立刻出声」的场景。
   *   （未命中时会静默补一次后台合成，供下次秒出。）
   * fast：不等待音频会话配置就起播，进一步压缩切后台时的起播延迟。
   */
  opts?: {
    cacheOnly?: boolean;
    fast?: boolean;
    /**
     * 起始秒数：分片模式下直接定位到这一片起播。
     * 换声 / 断点续播必须用它——否则会先从头播一小段再跳，孩子听到的是"倒回去了"，
     * 而且要多合成一次第 1 片，白等一轮（v91 #1）。
     */
    startAt?: number;
  },
  /** 文本语种：仅长文本分片切句时需要（中文按字符、英文按词估算长度） */
  language: 'zh' | 'en' = 'zh',
): Promise<boolean> {
  // 先停掉上一段，避免叠加
  stopClonedAudio();
  lastCloneError = '';

  try {
    // cacheOnly：只播已落盘音频，绝不现场合成（锁屏告别等必须立刻出声）。
    // 长文本同样跳过分片，直接走整段已缓存文件。
    if (opts?.cacheOnly) {
      const fileName = cacheFileName(text, target);
      if (!cacheFile(fileName).exists) {
        // 后台补合成（不 await，失败也无害），本次立刻交回调用方去用系统音
        void prewarmClonedAudio(text, target, language);
        return false;
      }
      const file = cacheFile(fileName);
      return await startPlayback(file.uri, onDone, onStart, opts?.fast);
    }
    // 长文本（如 15-20 分钟故事）走分片流式：先合成第 1 片就播、边播边合成后续，
    // 解决「整段合成完才出声 / 暂停后整段重缓冲」的问题（v90 #1/#2/#3）。
    if (text.length > CHUNK_THRESHOLD_CHARS) {
      const chunks = splitIntoChunks(text, language, target);
      if (chunks.length > 1) {
        // 起始片：先按「估算时长」把各片长度填好，再据此定位。
        // 好处：① 换声/续播直接从该片开始，不必先合成第 1 片；② 累计位置从此可信。
        const durations: number[] = new Array(chunks.length).fill(0);
        for (let i = 0; i < chunks.length; i++) {
          durations[i] = estimateChunkDuration(chunks[i], language);
        }
        let startIdx = 0;
        let startOffset = 0;
        const want = opts?.startAt ?? 0;
        if (want > 1) {
          let acc = 0;
          for (let i = 0; i < chunks.length; i++) {
            if (acc + durations[i] > want) {
              startIdx = i;
              startOffset = Math.max(0, want - acc);
              break;
            }
            acc += durations[i];
            startIdx = i;
          }
        }
        chunkState = {
          active: true,
          chunks,
          target,
          language,
          onDone,
          abortCheck,
          onStart,
          fast: opts?.fast,
          durations,
          synthDone: new Array(chunks.length).fill(false),
          synthRunning: new Set<number>(),
          current: -1,
          paused: false,
          pendingAdvance: false,
          started: false,
          onStartFired: false,
          startIdx,
          startOffset,
        };
        // 起播定位到的那一片（合成完即播，无需等整段）
        return await playChunkIndex(startIdx);
      }
      // 切不出多片（极少）：退回整段逻辑
    }
    const fileName = cacheFileName(text, target);
    const res = await ensureSynthFile(text, target, fileName);
    // 合成期间可能已有更新的旁白请求进来，若已被取代则放弃，不覆盖新声
    if (abortCheck && !abortCheck()) return false;
    if (!res.ok) {
      lastCloneError = res.error || ts('vc.diag.synthFail');
      console.warn('[clonedPlayback] synth failed:', lastCloneError);
      return false;
    }
    const file = cacheFile(fileName);
    if (abortCheck && !abortCheck()) return false;
    return await startPlayback(file.uri, onDone, onStart, opts?.fast);
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
/** 当前片跳转（毫秒），不含跨片逻辑 —— 供分片 seek 内部使用 */
export function seekClonedAudioRaw(positionSeconds: number): void {
  try {
    if (currentPlayer && typeof currentPlayer.seekTo === 'function') {
      // expo-audio 的 seekTo 接收毫秒，需把秒换算成毫秒
      currentPlayer.seekTo(Math.max(0, positionSeconds) * 1000);
    }
  } catch {
    /* 忽略 seek 异常 */
  }
}

/** 跳转（秒）：分片模式跨片定位，否则当前片 seek */
export function seekClonedAudio(positionSeconds: number): void {
  if (chunkState && chunkState.active) {
    seekChunk(positionSeconds);
    return;
  }
  seekClonedAudioRaw(positionSeconds);
}

/**
 * 重新激活音频会话（v62 反馈 #2）。
 * 锁屏 / 切后台回来后，iOS 可能已经停用了本 App 的音频会话：此时再建 player
 * 并 play() 不会抛错，但也完全不出声 —— 表现出来就是「看着在播，点暂停、点停止都没用」。
 * 回到前台时先重设一次会话，随后的播放才有声。
 */
export async function reassertAudioSession(): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      shouldPlayInBackground: false,
    });
  } catch {
    /* 忽略 */
  }
}

/** 停止当前克隆声播放 */
export function stopClonedAudio(): void {
  resetEndWatch();
  userPaused = false; // 整体停止：暂停态失效
  // 清分片状态（分片播放被整体停止时）
  if (chunkState) {
    chunkState.active = false;
    chunkState = null;
  }
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
 * 分片流式引擎（v90 反馈 #1/#2/#3）
 * ---------------------------------------------------------------------------
 * 仅长文本（> CHUNK_THRESHOLD_CHARS）走分片；短文本/提示音/本地录音仍走整段逻辑。
 * currentPlayer 始终指向「当前在播的那一片」的 player，片间切换先停旧片再建新片，
 * 复用 armEndWatch 的轮询做「当前片到末尾」检测；整段结束只在最后一片播完时触发 onDone。
 */

/** 只停当前 player（不清除 chunkState），用于分片间切换 / 暂停 */
function stopCurrentPlayerOnly(): void {
  try {
    if (currentPlayer) {
      currentPlayer.pause();
      currentPlayer.remove();
    }
  } catch {
    /* 忽略 */
  }
  currentPlayer = null;
}

/**
 * 把长文本切成若干「片」：尽量在句子/段落边界切，避免把一句话拦腰截断。
 * 中文按字符数、英文按词估算长度。返回至少 1 片。
 */
/**
 * 每片目标长度（字符）。克隆声（真人复刻模型）单次合成明显比内置音色慢，
 * 所以片要更短：首片等待时间 ≈ 片长成正比，120 字能把「换克隆声后第一次出声」
 * 从十几秒压到几秒（v91 #1：切到妈妈的声音后一直缓冲）。
 * 注意：同一声线的预热与播放必须用同一套切法，否则缓存永远命中不了。
 */
function chunkTargetChars(target: CloneTarget, language: 'zh' | 'en'): number {
  const base = target.startsWith('preset:') ? CHUNK_TARGET_CHARS : CHUNK_TARGET_CHARS_CLONE;
  return language === 'zh' ? base : base * 3;
}

function splitIntoChunks(
  text: string,
  language: 'zh' | 'en',
  target?: CloneTarget,
): string[] {
  const raw = (text || '').trim();
  if (!raw) return [];
  const targetChars = target
    ? chunkTargetChars(target, language)
    : language === 'zh'
    ? CHUNK_TARGET_CHARS
    : CHUNK_TARGET_CHARS * 3;
  if (raw.length <= targetChars) return [raw];
  const delims = language === 'zh' ? '。！？；…\n' : '.!?;\n';
  const chunks: string[] = [];
  let start = 0;
  const n = raw.length;
  while (start < n) {
    let end = Math.min(start + targetChars, n);
    if (end < n) {
      // 往回找最近的断句符（最多回找 targetChars 的一半）
      const lo = Math.max(start, end - Math.floor(targetChars / 2));
      let found = -1;
      for (let j = end - 1; j >= lo; j--) {
        if (delims.includes(raw[j])) {
          found = j + 1;
          break;
        }
      }
      if (found > start) {
        end = found;
      } else {
        // 往前找断句符
        const hi = Math.min(n, end + Math.floor(targetChars / 2));
        let found2 = -1;
        for (let j = end; j < hi; j++) {
          if (delims.includes(raw[j])) {
            found2 = j + 1;
            break;
          }
        }
        if (found2 > start) end = found2;
      }
    }
    const piece = raw.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);
    start = end;
  }
  return chunks.length ? chunks : [raw];
}

/** 分片模式：累计播放位置（秒）= 已播完各片时长之和 + 当前片位置 */
function getChunkPosition(): number {
  const cs = chunkState;
  if (!cs) return 0;
  let pos = 0;
  for (let i = 0; i < cs.current; i++) pos += cs.durations[i] || 0;
  if (cs.current >= 0 && cs.current < cs.chunks.length) pos += getClonedPositionRaw();
  return pos;
}

/** 按文本长度估算单片时长（秒），作为未播放片的兜底，使进度条稳定不跳变 */
function estimateChunkDuration(text: string, language: 'zh' | 'en'): number {
  if (language === 'zh') return Math.max(text.length * 0.21, 1);
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(words * 0.45, 1);
}

/** 分片模式：总时长（秒）= 各片时长之和（已播片用真实值，未播片用估算，进度条稳定） */
function getChunkDuration(): number {
  const cs = chunkState;
  if (!cs) return 0;
  let total = 0;
  for (let i = 0; i < cs.chunks.length; i++) {
    const d = cs.durations[i] || 0;
    total += d > 0 ? d : estimateChunkDuration(cs.chunks[i], cs.language);
  }
  return total;
}

/** 分片模式：跨片跳转（秒） */
function seekChunk(sec: number): void {
  const cs = chunkState;
  if (!cs) {
    seekClonedAudioRaw(sec);
    return;
  }
  const target = Math.max(0, sec);
  // 定位目标秒数落在哪一片
  let acc = 0;
  let idx = 0;
  for (let i = 0; i < cs.chunks.length; i++) {
    const d = cs.durations[i] || 0;
    if (acc + d > target) {
      idx = i;
      break;
    }
    acc += d;
    idx = i;
  }
  const fileName = cacheFileName(cs.chunks[idx], cs.target);
  const offset = Math.max(0, target - acc);
  // 落在「当前正在播的那一片」里：直接 seek 当前播放器，不重建、不重新 load
  // （暂停 → 再播放的秒续就走这条路，真正做到零缓冲）
  if (idx === cs.current && currentPlayer) {
    seekClonedAudioRaw(offset);
    return;
  }
  if (cacheFile(fileName).exists) {
    cs.current = idx;
    stopCurrentPlayerOnly();
    void startPlayback(cacheFile(fileName).uri, () => handleChunkEnded(idx), undefined, true);
    seekClonedAudioRaw(offset);
    // 新建的 player 立刻 seek 会被忽略，稍后再补一次（目标时间落在该片内部）
    setTimeout(() => {
      if (!chunkState || !chunkState.active || chunkState.current !== idx) return;
      if (getClonedPositionRaw() < offset - 1) seekClonedAudioRaw(offset);
    }, 500);
  } else {
    // 该片尚未合成：从这一片重新开始分片流程（之前进度作废，自然续播到末尾）
    cs.current = idx - 1;
    void playChunkIndex(idx);
  }
}

/** 起播指定片（合成→播放）。返回是否成功起播（首片失败=整体失败） */
async function playChunkIndex(i: number): Promise<boolean> {
  const cs = chunkState;
  if (!cs || !cs.active) return false;
  if (i < 0 || i >= cs.chunks.length) return false;
  if (cs.abortCheck && !cs.abortCheck()) {
    cs.active = false;
    chunkState = null;
    return false;
  }
  const fileName = cacheFileName(cs.chunks[i], cs.target);
  const res = await ensureSynthFile(cs.chunks[i], cs.target, fileName);
  if (!cs || !cs.active) return false;
  if (cs.abortCheck && !cs.abortCheck()) {
    cs.active = false;
    chunkState = null;
    return false;
  }
  if (!res.ok) {
    lastCloneError = res.error || ts('vc.diag.synthFail');
    console.warn('[clonedPlayback] chunk synth failed:', lastCloneError);
    if (i === 0) {
      cs.active = false;
      chunkState = null;
      return false;
    }
    // 非首片失败：标记跳过，尝试下一片继续（绝不让一片失败卡死整段）
    cs.synthDone[i] = false;
    if (i < cs.chunks.length - 1) {
      void playChunkIndex(i + 1);
      return true;
    }
    if (cs.onDone) cs.onDone();
    cs.active = false;
    chunkState = null;
    return false;
  }
  cs.synthDone[i] = true;
  cs.current = i;
  cs.paused = false;
  cs.started = true;
  stopCurrentPlayerOnly();
  const firstChunk = !cs.onStartFired;
  if (firstChunk) cs.onStartFired = true;
  // 片间切换用 fast（音频会话第 1 片就已配置好，再 await 一次只会让片与片之间多出空档）
  const ok = await startPlayback(
    cacheFile(fileName).uri,
    () => handleChunkEnded(i),
    firstChunk ? cs.onStart : undefined,
    firstChunk ? cs.fast : true,
  );
  if (!ok) {
    if (i === 0) {
      cs.active = false;
      chunkState = null;
      return false;
    }
    if (i < cs.chunks.length - 1) {
      void playChunkIndex(i + 1);
      return true;
    }
    if (cs.onDone) cs.onDone();
    cs.active = false;
    chunkState = null;
    return false;
  }
  // 起始片：跳到该片内部的指定位置（换声 / 断点续播用，避免从这一片开头重播）
  if (i === cs.startIdx && cs.startOffset > 1) {
    const off = cs.startOffset;
    cs.startOffset = 0;
    seekClonedAudioRaw(off);
    setTimeout(() => {
      if (!chunkState || !chunkState.active || chunkState.current !== i) return;
      if (getClonedPositionRaw() < off - 1) seekClonedAudioRaw(off);
    }, 450);
  }
  // 预取后续 CHUNK_PRELOAD 片（后台并发合成，边播边缓冲）
  for (let k = 1; k <= CHUNK_PRELOAD; k++) {
    const j = i + k;
    if (j < cs.chunks.length) void prewarmChunk(j);
  }
  return true;
}

/** 当前片正常播完：推进到下一片；最后一片则整段结束 */
function handleChunkEnded(i: number): void {
  const cs = chunkState;
  if (!cs || !cs.active) return;
  if (i >= 0 && i < cs.durations.length) {
    const d = getClonedDurationRaw() || 0;
    if (d > 0) cs.durations[i] = d;
  }
  if (cs.paused) return; // 暂停态下的结束信号忽略（恢复后由 tryAdvance 接管）
  tryAdvance();
}

/** 尝试从当前片的下一部推进；未就绪则预取并挂起 pendingAdvance */
function tryAdvance(): void {
  const cs = chunkState;
  if (!cs || !cs.active) return;
  if (cs.paused) {
    cs.pendingAdvance = true;
    return;
  }
  let next = cs.current + 1;
  while (next < cs.chunks.length) {
    const fileName = cacheFileName(cs.chunks[next], cs.target);
    if (cacheFile(fileName).exists) {
      cs.pendingAdvance = false;
      void playChunkIndex(next);
      return;
    }
    if (cs.synthDone[next] === false) {
      next++;
      continue;
    } // 跳过已失败片
    // 未就绪且未判失败：触发预取并等待
    cs.pendingAdvance = true;
    void prewarmChunk(next);
    return;
  }
  // 没有下一片（都跳完 / 已是最后）→ 整段结束
  cs.pendingAdvance = false;
  if (cs.onDone) cs.onDone();
  cs.active = false;
  chunkState = null;
}

/** 预取某片（命中缓存/正在合成则跳过）。合成完成后若正等它，立即推进 */
async function prewarmChunk(j: number): Promise<void> {
  const cs = chunkState;
  if (!cs || !cs.active) return;
  if (cs.synthDone[j] || cs.synthRunning.has(j)) return;
  cs.synthRunning.add(j);
  const fileName = cacheFileName(cs.chunks[j], cs.target);
  const res = await ensureSynthFile(cs.chunks[j], cs.target, fileName);
  if (!cs || !cs.active) {
    cs?.synthRunning.delete(j);
    return;
  }
  cs.synthRunning.delete(j);
  cs.synthDone[j] = res.ok;
  if (!res.ok) {
    // 预取失败：若正在等这一片，则跳过它继续推进
    if (cs.pendingAdvance && cs.current + 1 === j) {
      cs.pendingAdvance = false;
      tryAdvance();
    }
    return;
  }
  if (cs.pendingAdvance && cs.current + 1 === j) {
    cs.pendingAdvance = false;
    void playChunkIndex(j);
  }
}

/**
 * 暂停当前克隆声/本地录音播放（分片模式只 pause 当前片，不销毁、不重新合成/load）。
 * 用于「暂停 → 再播放」时复用同一路播放，避免整段重缓冲（v90 #2）。
 * 系统音（TTS）无法暂停，调用方需自行判断（isClonedAudioPlaying）。
 */
export function pauseClonedAudio(): void {
  userPaused = true; // 屏蔽「播完」检测，避免停滞判定把暂停误判成结束
  if (chunkState && chunkState.active) {
    if (currentPlayer && typeof currentPlayer.pause === 'function') {
      try {
        currentPlayer.pause();
      } catch {
        /* ignore */
      }
    }
    chunkState.paused = true;
    return;
  }
  if (currentPlayer && typeof currentPlayer.pause === 'function') {
    try {
      currentPlayer.pause();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 恢复播放（与 pauseClonedAudio 配对）。分片模式恢复当前片；若暂停期间当前片已播完
 * （pendingAdvance）则尝试推进到下一片。
 */
export function resumeClonedAudio(): void {
  userPaused = false; // 恢复「播完」检测
  if (chunkState && chunkState.active) {
    if (currentPlayer && typeof currentPlayer.play === 'function') {
      try {
        currentPlayer.play();
      } catch {
        /* ignore */
      }
    }
    const wasPending = chunkState.paused;
    chunkState.paused = false;
    if (wasPending && chunkState.pendingAdvance) tryAdvance();
    return;
  }
  if (currentPlayer && typeof currentPlayer.play === 'function') {
    try {
      currentPlayer.play();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 当前克隆声 / 本地音的播放位置（秒）。仅对 expo-audio 播放器有效；
 * 系统音（TTS）不支持，返回 0 —— 调用方据此决定是否显示真实进度 / 允许拖动快进。
 */
/** 当前片的播放位置（秒），不含分片累计 —— 供分片累计与 armEndWatch 内部使用 */
export function getClonedPositionRaw(): number {
  try {
    const p = currentPlayer as unknown as { currentTime?: number } | null;
    return p && typeof p.currentTime === 'number' ? p.currentTime : 0;
  } catch {
    return 0;
  }
}

/** 播放位置（秒）：分片模式返回累计值，否则返回当前片位置 */
export function getClonedPosition(): number {
  if (chunkState && chunkState.active) return getChunkPosition();
  return getClonedPositionRaw();
}

/** 当前片的总时长（秒），不含分片累计 —— 供分片累计与 armEndWatch 内部使用 */
export function getClonedDurationRaw(): number {
  try {
    const p = currentPlayer as unknown as { duration?: number } | null;
    return p && typeof p.duration === 'number' ? p.duration : 0;
  } catch {
    return 0;
  }
}

/** 总时长（秒）：分片模式返回累计值，否则返回当前片时长 */
export function getClonedDuration(): number {
  if (chunkState && chunkState.active) return getChunkDuration();
  return getClonedDurationRaw();
}

/**
 * 本次播放是否**真的出过声**（播放器 playing 曾经变为 true）。
 *
 * 给上层过滤「还没响就报播完」的假结束信号用（v82 反馈 #3）：
 * 云端合成一次要好几秒，音频刚加载 / 刚被 seek 时常常立刻回调 ended，
 * 若上层只看「从点播放到现在过了多少秒」，就会把「还在准备」误判成「已经播完」，
 * 界面直接被推到「故事讲完啦」→ 提问环节。
 */
export function didPlayThisSession(): boolean {
  return sawPlaying;
}

/** 本次播放到达过的最大位置（秒）；没真正出声时通常接近 0 */
export function getMaxPlayedPosition(): number {
  return maxPos;
}

/**
 * 当前是否**真的还在响**（播放器自报 playing=true）。
 * 给「播完再做下一步」的调用方做复核用（v84 反馈 #5：旅行打卡成功页在故事没讲完时
 * 就弹了出来 —— 上层可以在回调后用它确认音频真的停了，再写打卡记录）。
 */
export function isClonedAudioPlaying(): boolean {
  try {
    const p = currentPlayer as unknown as { playing?: boolean } | null;
    return Boolean(p && p.playing);
  } catch {
    return false;
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
 * 解析「本地录音文件」的真实路径（2026-11-01 修复：家长端录音放不出声）
 * ---------------------------------------------------------------------------
 * 孩子/家长录完的故事，保存的是**绝对路径**：
 *   file:///var/mobile/Containers/Data/Application/<UUID>/Documents/recordings/rec_x.m4a
 *
 * 问题在于 <UUID> 这个沙盒容器目录名，iOS 每次「覆盖安装 / TestFlight 升级」都会换一个。
 * 于是升级一次之后，AsyncStorage 里那条老路径就指向一个不存在的目录，
 * createAudioPlayer 不报错、但永远不出声 —— 表现正是「故事文字还在，录音就是播不了」。
 *
 * 这里做两级解析：
 *   1) 原路径直接存在 → 用它（同一版本内录的）。
 *   2) 不存在 → 取出文件名，去**当前**沙盒的 Documents/recordings 里找同名文件。
 *
 * 返回 null 表示文件真的没了（用户删过 / 换过手机），调用方应给出明确提示。
 */
const RECORDINGS_DIR = 'recordings';

export function resolveLocalAudioUri(uri: string): string | null {
  if (!uri) return null;
  // 1) 原样可用
  try {
    if (new File(uri).exists) return uri;
  } catch {
    /* 继续走第 2 步 */
  }
  // 2) 容器 UUID 变了：按文件名在当前沙盒里重新定位
  try {
    const name = uri.split('/').pop()?.split('?')[0];
    if (name) {
      const f = new File(new Directory(Paths.document, RECORDINGS_DIR), name);
      if (f.exists) return f.uri;
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

/**
 * 播放本地音频文件（如孩子/家长录制的故事），直接 createAudioPlayer 播放，
 * 不走 TTS / 克隆合成。用于「我的录音」中保留录音的回放。
 * 复用全局 currentPlayer 槽位，故 stopClonedAudio() / 进度拖动 seekClonedAudio() 同样适用。
 *
 * ⚠️ 先过 resolveLocalAudioUri：iOS 升级后沙盒路径会变，直接用存下来的绝对路径会静默失败。
 */
export async function playLocalFile(uri: string, onDone?: () => void): Promise<boolean> {
  const resolved = resolveLocalAudioUri(uri);
  if (!resolved) {
    lastCloneError = ts('vc.diag.fileGone');
    return false;
  }
  stopClonedAudio();
  return startPlayback(resolved, onDone);
}

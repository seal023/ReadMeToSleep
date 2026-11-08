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
  /** 已经重试过的片（网络抖动重试一次，仍失败才跳过） */
  retried: Set<number>;
  current: number; // 当前播放片索引（-1=尚未起播）
  paused: boolean;
  pendingAdvance: boolean; // 当前片已播完，但下一片尚未合成好，等待中
  /** 开始等下一片的时刻：等太久（合成挂住）就跳过，绝不让孩子对着缓冲界面干等 */
  pendingSince: number;
  /** 当前片真正起播的时刻：用于挡住「同一片被重复请求起播」（否则第一句会念两遍） */
  playStartedAt: number;
  started: boolean;
  onStartFired: boolean; // 整体 onStart 是否已触发（仅第一片出声时触发一次）
  /** 起播要落在这一片的第几秒（换声 / 断点续播时直接从这里开始，不从故事开头播） */
  startIdx: number;
  startOffset: number;
}
let chunkState: ChunkState | null = null;

/**
 * 分片播放的「精确断点」：片索引 + 片内秒数 + 片总数。
 * ---------------------------------------------------------------------------
 * 为什么不能只存秒数（v93 反馈 #1）：恢复会话时各片时长是先按字数**估算**的，
 * 与真实 TTS 时长能差 20%~40%，片数一多（15–20 分钟故事约 80–150 片）误差累积到几分钟，
 * 于是「听到一半」被定位到末尾几片 → 起播没几句就播完 → 直接跳提问环节。
 * 而同样的文本 + 同样语言，`splitIntoChunks` 的切分结果是**确定**的，
 * 所以片索引天然对齐，与估算无关；只有片内秒数需要估，误差不超过一片。
 */
export type ChunkPlace = { index: number; offset: number; total: number };

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

/**
 * 朗读前的「相邻重复句」去重（v95 反馈 #1：第一句话被读了两遍）
 * ---------------------------------------------------------------------------
 * AI 生成的长文本偶尔会复读：同一句话连着出现两次（开头最常见）。
 * 这里只在**相邻两句去掉首尾空白后完全相同、且长度 ≥ 8 字**时才删掉后一句，
 * 正常的重复用词（「走啊走啊」这类短句）不会被误删。
 * 必须在切缓存文件名**之前**处理，否则预热与播放算出的文件名会不一致、永远命中不了。
 */
function dedupeAdjacentSentences(text: string): string {
  const raw = text || '';
  if (raw.length < 20) return raw;
  // 中文 ≥5 字、英文 ≥8 字符的相邻重复句才删（「走啊走啊」这类短句重复是正常修辞，不动）
  const zh = /([^。！？；…\n]{5,}[。！？；…])\s*\1/g;
  const en = /([^.!?;\n]{8,}[.!?;])\s*\1/gi;
  let out = raw;
  for (let k = 0; k < 3; k++) {
    const before = out;
    out = out.replace(zh, '$1').replace(en, '$1');
    if (out === before) break;
  }
  return out;
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
/**
 * v95 反馈 #3（嫦娥奔月听完不跳提问）：整段是否**自然播完**。
 * 分片模式下「末片播完」是唯一可信的结束信号，但上层还要用
 * 「位置推进过」等启发式再验一遍；而分片模式里 maxPos 会被每片的
 * clearHardEnd() 清零，导致「推进过」永远为假 → 上层把真实的播完信号丢掉，
 * 界面停在播放页（声音停了、不跳提问、不出奖励动画）。
 * 现在引擎在整段自然结束时打这个标记，上层可直接采信，不再靠猜。
 */
let naturalEnded = false;

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
function armEndWatch(onDone?: () => void, markNaturalEnd = false): void {
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
    /**
     * v97 反馈 #4：单段音频（短故事 / 本地录音）走到这里是**整段自然播完**，
     * 必须打上「自然结束」标记 —— 上层收到结束回调时用它一票通过，
     * 不再用「位置是否到末尾」那套估算去猜（时长单位一旦有偏差就永远猜不中，
     * 表现就是声音停了、界面还停在播放页）。分片模式由 tryAdvance 在末片设置。
     */
    if (markNaturalEnd && !(chunkState && chunkState.active)) naturalEnded = true;
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
    // 上界保护同轮询：位置读数离谱（毫秒/旧值）时不当成「播完」（v98）
    if (dur > 0.4 && pos <= dur * 1.5 + 2 && pos >= dur - 1.5) endOnce?.();
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
      /**
       * v95：分片模式下也必须维护 maxPos（用累计位置）。
       * 这里原来直接 return，maxPos 永远为 0；上层的「位置推进过」判据于是恒假，
       * 末片播完引发的真实结束信号会被当成假信号丢掉。
       */
      const cum = getChunkPosition();
      if (cum > maxPos) maxPos = cum;
      /**
       * v98：位置读数「明显超出时长」时不判片尾。
       * -------------------------------------------------------------------
       * 部分机型/系统在重建播放器、seek、切后台回来时，会短暂把 currentTime
       * 报成毫秒或上一次的值（例如 2000 而该片只有 22 秒）。原来的判据只有
       * `rpos >= rdur - 0.6`，遇到这种离谱读数就会立刻判「本片播完」→ 一片接一片
       * 地空推进，几秒之内走到末片 → 整段判播完，界面直接跳结束页。
       * 加一道上界（1.5 倍 + 2 秒）把这类坏读数挡在外面。
       */
      const posSane = rpos <= rdur * 1.5 + 2;
      if (!chunkState.paused && rdur > 0.4 && posSane && rpos >= rdur - 0.6) endOnce?.();
      /**
       * v95 修复：等下一片等太久 → 跳过它继续。
       * ---------------------------------------------------------------------
       * 现实中会出现「第 N 片合成请求挂住 / 一直等不到结果」的情况，此前没有任何超时，
       * 整段故事就永远停在「正在准备声音」，暂停、停止重播都一样（重播又从这一片开始等）。
       * 现在等满 20 秒就把这一片标记为失败并跳过去 —— 最多少听一小段，但故事能继续。
       */
      const csx = chunkState;
      if (
        csx &&
        !csx.paused &&
        csx.pendingAdvance &&
        csx.pendingSince > 0 &&
        Date.now() - csx.pendingSince > 20000
      ) {
        const skip = csx.current + 1;
        if (skip < csx.chunks.length) {
          console.warn('[clonedPlayback] 等待第', skip, '片超时，跳过继续');
          csx.synthDone[skip] = false;
          csx.pendingAdvance = false;
          csx.pendingSince = 0;
          tryAdvance();
        }
      }
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
    //    同样加上界：读数离谱（毫秒 / 重建播放器时的旧值）时不判播完（v98）
    if (dur >= maxDur - 0.6 && pos <= dur * 1.5 + 2 && pos >= dur - 0.6) {
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
 * v102 成本核验用：运行期统计「缓存命中 / 真正打了几次云端合成」。
 * 用法：连续播放同一故事两次，若第二遍 networkCalls 不再增长，
 * 就证明「再次播放 / 重新收听」100% 走本地缓存、没有二次扣费。
 */
export interface SynthCacheStats {
  cacheHits: number;
  cacheMisses: number;
  /** 真正调用 synthesizeWithClonedVoice 的次数（= 可能产生费用的次数） */
  networkCalls: number;
  /** 并发请求被 inflight 合并掉的次数 */
  inflightReuses: number;
  /** 失败冷却期内被拦下的重复请求 */
  cooldownSkips: number;
  /** 成功落盘的音频文件数 */
  writes: number;
}
const synthStats: SynthCacheStats = {
  cacheHits: 0,
  cacheMisses: 0,
  networkCalls: 0,
  inflightReuses: 0,
  cooldownSkips: 0,
  writes: 0,
};
export function getSynthCacheStats(): SynthCacheStats {
  return { ...synthStats };
}
export function resetSynthCacheStats(): void {
  synthStats.cacheHits = 0;
  synthStats.cacheMisses = 0;
  synthStats.networkCalls = 0;
  synthStats.inflightReuses = 0;
  synthStats.cooldownSkips = 0;
  synthStats.writes = 0;
}

/**
 * 合成失败后的短冷却：网络抖动 / 音色还没训练好时，
 * 旧逻辑每点一次播放都会重新打一次云端（长故事是几十片），失败也照样计费。
 * 30 秒内同一片不再重试，成功即解除。
 */
const FAILED_COOLDOWN_MS = 30_000;
const failedCooldown = new Map<string, number>();

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

/**
 * 缓存文件是否「真的可用」。
 * 只看 exists 会把「写盘被打断留下的 0 字节文件」当成命中：既不响，
 * 又让人误以为已经缓存、不用再合成。这里顺手删掉空文件让它重新合成一次。
 */
function isUsableCacheFile(file: File): boolean {
  try {
    if (!file.exists) return false;
  } catch {
    return false;
  }
  try {
    const size = file.size;
    if (typeof size === 'number' && size < 512) {
      try {
        file.delete();
      } catch {
        /* 删不掉就交给 write 覆盖 */
      }
      return false;
    }
  } catch {
    // size 读不到就只信 exists。绝不能因为「诊断属性不可用」把已有缓存判成未命中：
    // 那样每一次重播都会重新合成，反而会重复扣费。
  }
  return true;
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
    return isUsableCacheFile(cacheFile(cacheFileName(text, target)));
  } catch {
    return false;
  }
}

/**
 * 整篇故事（含所有分片）是否都已落盘。
 * 切分逻辑与播放侧、预热侧完全共用 splitIntoChunks + cacheFileName，
 * 所以「全命中」= 再次播放时每一片都会走 ensureSynthFile 的命中分支，零云端请求。
 */
export function hasAllChunksCached(
  text: string,
  target: CloneTarget,
  language: 'zh' | 'en' = 'zh',
  maxChunks?: number,
): boolean {
  try {
    const body = dedupeAdjacentSentences(text);
    if (!body) return false;
    if (body.length <= CHUNK_THRESHOLD_CHARS) {
      return isUsableCacheFile(cacheFile(cacheFileName(body, target)));
    }
    const chunks = splitIntoChunks(body, language, target);
    const list = maxChunks ? chunks.slice(0, Math.max(1, maxChunks)) : chunks;
    return list.length > 0 && list.every((c) => isUsableCacheFile(cacheFile(cacheFileName(c, target))));
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
  opts?: { overwrite?: boolean },
): Promise<boolean> {
  try {
    const dest = cacheFile(cacheFileName(text, target));
    if (dest.exists) {
      // 默认「命中即跳过」（运行时补装只补缺失）；overwrite=true 用于随包内置资源
      // 的版本升级：内置音频是开发期定稿版本，必须覆盖历史联网合成留下的旧文件，
      // 否则覆盖安装（不删 App）后仍会听到上一版的声线 / 旧 WAV 内容伪装成 .mp3。
      if (!opts?.overwrite) return true;
      try {
        dest.delete();
      } catch {
        /* 删不掉就退回覆盖写 */
      }
    }
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
  if (isUsableCacheFile(cached)) {
    synthStats.cacheHits++;
    return { ok: true };
  }
  // 刚失败过的同一片：冷却期内不再打云端（长故事一次就是几十片，失败也计费）
  const until = failedCooldown.get(fileName) ?? 0;
  if (Date.now() < until) {
    synthStats.cooldownSkips++;
    return { ok: false, error: '上一次合成失败，稍后再试（已跳过云端请求）' };
  }
  const running = inflight.get(fileName);
  if (running) {
    synthStats.inflightReuses++;
    return running;
  }
  synthStats.cacheMisses++;
  const task = (async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      // 唯一会真正产生云端 TTS 费用的地方
      synthStats.networkCalls++;
      /**
       * 整体兜底超时 30 秒：网络层的各个超时加起来可能更长，而「同一片」的合成 Promise
       * 会被 inflight 复用 —— 一旦它永远不结束，暂停再播放也会重新拿到同一个挂住的 Promise，
       * 这正是「停止后重播还是卡在同一处」的原因。所以这里再设一道闸。
       */
      const raced = await Promise.race([
        (async (): Promise<{ ok: boolean; error?: string }> => {
          const { audio, error } = await synthesizeWithClonedVoice(text, target);
          if (error) return { ok: false, error };
          if (!audio) return { ok: false, error: ts('vc.diag.emptyAudio') };
          writeBytesToCache(fileName, audio);
          return { ok: true };
        })(),
        new Promise<{ ok: boolean; error?: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, error: '合成超时（30 秒），已跳过这一段' }), 30000),
        ),
      ]);
      if (raced.ok) {
        failedCooldown.delete(fileName);
        synthStats.writes++;
      } else {
        failedCooldown.set(fileName, Date.now() + FAILED_COOLDOWN_MS);
      }
      return raced;
    } catch (err) {
      /**
       * v95 修复：这里以前没有 try。合成成功但**写盘失败**（磁盘满 / 文件句柄异常）时
       * 整个 Promise 会 reject，而调用方（prewarmChunk / playChunkIndex）没有兜底 →
       * 该片永远停留在「正在合成」状态，父层的等待永远不会被唤醒：
       * 表现就是「读到第二段就一直缓冲，暂停/停止重播都卡在同一处」。
       * 现在任何异常都收敛成 { ok:false }，上层一定会走「跳过/重试/降级」分支。
       */
      failedCooldown.set(fileName, Date.now() + FAILED_COOLDOWN_MS);
      return { ok: false, error: `音频写盘失败：${(err as any)?.message || String(err)}` };
    } finally {
      // 无论成功/失败/超时都要摘掉 inflight，否则下一次请求会继续复用这个结果
      inflight.delete(fileName);
    }
  })();
  inflight.set(fileName, task);
  return task;
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
    // v102：整篇（或本次要预热的前 N 片）已全部落盘就立刻返回，
    // 连一遍文件遍历都不做 —— 再次打开故事页不会再有任何云端请求的机会。
    if (hasAllChunksCached(text, target, language, opts?.maxChunks)) return;
    // 与播放侧保持一致的去重，否则预热出的缓存文件名和播放算的对不上
    const body = dedupeAdjacentSentences(text);
    // 长文本按分片预热：避免一次性合成整段大文件（v90 #1/#3 同源）。
    // 进故事页即预热各片，点播放时多半已落盘 → 几乎瞬时出声。
    if (body.length > CHUNK_THRESHOLD_CHARS) {
      const all = splitIntoChunks(body, language, target);
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
    const fileName = cacheFileName(body, target);
    if (isUsableCacheFile(cacheFile(fileName))) return;
    await ensureSynthFile(body, target, fileName);
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
  /** 整段自然播完时是否打「自然结束」标记（只有故事正文需要，提示音不需要） */
  markNaturalEnd = false,
  /**
   * v109：随包预装 MP3 的 assetId（来自 require()）。
   * 给了就走 { assetId } 本地资源，完全不碰文件 URI / 网络；不给则按 uri 播放落盘文件。
   */
  bundledAssetId?: number,
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
      /**
       * v94 反馈 #1：换声时「一直缓冲、就是不出声」。
       * `setAudioModeAsync` 在刚拆掉一路播放器 / 系统刚收回过音频会话时，偶发卡住不返回，
       * 而它后面就是建播放器 + play()，于是卡在这里 = 界面上永远在缓冲。
       * 给它 700ms 预算：还没配好就先起播（会话多半已经可用），绝不为此无限等。
       */
      await Promise.race([modeTask, new Promise((resolve) => setTimeout(resolve, 700))]);
    }

    // 防御（v90 #3）：任何路径遗留的旧 player 必须先彻底停掉再建新的。
    // 之前的实现直接覆盖 currentPlayer 引用，一旦某个旧 player 没被回收，
    // 它就会继续出声 —— 表现正是「选了内置大姐姐，耳朵里还是上一个克隆声」。
    //
    // v94 反馈 #1：pause 和 remove **必须各自 try**。原来写在一个 try 里，
    // pause 一抛（player 已被系统回收时很常见），remove 就被跳过，
    // 旧音色的音频继续从头念 —— 于是「界面显示温柔女声，耳朵里是大哥哥」。
    if (currentPlayer) {
      const stale = currentPlayer;
      currentPlayer = null;
      hardStopPlayer(stale);
    }

    const source =
      bundledAssetId !== undefined ? { assetId: bundledAssetId } : { uri };
    const player = createAudioPlayer(source) as unknown as AudioPlayerLike;
    currentPlayer = player;
    armEndWatch(onDone, markNaturalEnd);
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
    /**
     * 精确断点（优先于 startAt）：片索引 + 片内秒数。
     * 由调用方从本地存储恢复（App 被杀 / 上划退出后重新打开时用），
     * 只在片总数与本次切分结果一致时才采信，否则退回 startAt 的估算定位。
     */
    startChunk?: ChunkPlace;
    /**
     * 整段自然播完时打「自然结束」标记（v97）。
     * 只有故事正文需要：让故事页在收到结束回调时一票通过，
     * 不再用「位置是否到末尾」估算去猜；提示音（问候 / 反馈语）不设。
     */
    markNaturalEnd?: boolean;
  },
  /** 文本语种：仅长文本分片切句时需要（中文按字符、英文按词估算长度） */
  language: 'zh' | 'en' = 'zh',
): Promise<boolean> {
  // 先停掉上一段，避免叠加
  stopClonedAudio();
  lastCloneError = '';
  // 朗读前把「相邻重复句」去掉（v95 #1：第一句被念两遍），并与预热共用同一份文本
  const body = dedupeAdjacentSentences(text);

  try {
    // cacheOnly：只播已落盘音频，绝不现场合成（锁屏告别等必须立刻出声）。
    // 长文本同样跳过分片，直接走整段已缓存文件。
    if (opts?.cacheOnly) {
      /**
       * v102 费用漏洞修复：原实现在「长文本」时去找一个**整段**文件名，
       * 但长文本从来是按分片落盘的，那个文件永远不存在 → 每次都触发
       * `prewarmClonedAudio` 在后台把整篇几十片重新合成一遍。
       * 这既违反 cacheOnly「绝不现场合成」的语义，也会在锁屏等场景偷偷计费。
       *
       * 现在：长文本看「分片是否齐全」——齐全就走下面正常的分片播放
       * （每片 ensureSynthFile 都命中本地文件，零网络）；缺一片就直接交回系统音，
       * 绝不在 cacheOnly 路径上发任何合成请求。
       */
      const chunks = body.length > CHUNK_THRESHOLD_CHARS
        ? splitIntoChunks(body, language, target)
        : [];
      if (chunks.length > 1) {
        if (!hasAllChunksCached(body, target, language)) return false;
        // 全部分片已就位：不 return，落到下面的分片播放逻辑
      } else {
        const fileName = cacheFileName(body, target);
        const file = cacheFile(fileName);
        if (!isUsableCacheFile(file)) return false;
        return await startPlayback(file.uri, onDone, onStart, opts?.fast, opts?.markNaturalEnd);
      }
    }
    // 长文本（如 15-20 分钟故事）走分片流式：先合成第 1 片就播、边播边合成后续，
    // 解决「整段合成完才出声 / 暂停后整段重缓冲」的问题（v90 #1/#2/#3）。
    if (body.length > CHUNK_THRESHOLD_CHARS) {
      const chunks = splitIntoChunks(body, language, target);
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
        const place = opts?.startChunk;
        // ① 优先用「片索引断点」：与估算无关，最准（见 ChunkPlace 注释）
        if (
          place &&
          place.total === chunks.length &&
          place.index >= 0 &&
          place.index < chunks.length &&
          !(place.index === 0 && place.offset <= 1)
        ) {
          startIdx = place.index;
          const cap = durations[startIdx] || 0;
          startOffset = Math.max(0, cap > 0 ? Math.min(place.offset, cap) : place.offset);
        } else if (want > 1) {
          // ② 没有片断点（旧版本存的记录 / 首次升级）才退回按秒估算定位
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
          /**
           * ③ 估算总时长明显短于断点秒数时，说明估算偏小、断点其实已接近或超过结尾：
           * 此时若仍定位到末片，起播一两句就会触发「播完」→ 直接跳提问（v93 反馈 #1）。
           * 宁可从头再讲一遍，也不要把孩子莫名推进问答环节。
           */
          const estTotal = durations.reduce((a, b) => a + b, 0);
          if (estTotal > 0 && want >= estTotal * 0.95) {
            startIdx = 0;
            startOffset = 0;
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
          // 续播 / 换声（带断点）时音频会话必然已经配置过 → 直接 fast 起播，
          // 不在 setAudioModeAsync 上多等（v94 #1「换声后一直缓冲」的另一半）
          fast: opts?.fast ?? (want > 1 || !!place),
          durations,
          synthDone: new Array(chunks.length).fill(false),
          synthRunning: new Set<number>(),
          retried: new Set<number>(),
          current: -1,
          paused: false,
          pendingAdvance: false,
          pendingSince: 0,
          playStartedAt: 0,
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
    const fileName = cacheFileName(body, target);
    const res = await ensureSynthFile(body, target, fileName);
    // 合成期间可能已有更新的旁白请求进来，若已被取代则放弃，不覆盖新声
    if (abortCheck && !abortCheck()) return false;
    if (!res.ok) {
      lastCloneError = res.error || ts('vc.diag.synthFail');
      console.warn('[clonedPlayback] synth failed:', lastCloneError);
      return false;
    }
    const file = cacheFile(fileName);
    if (abortCheck && !abortCheck()) return false;
    return await startPlayback(file.uri, onDone, onStart, opts?.fast, opts?.markNaturalEnd);
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
  naturalEnded = false; // 主动停止 ≠ 自然播完
  userPaused = false; // 整体停止：暂停态失效
  // 清分片状态（分片播放被整体停止时）
  if (chunkState) {
    chunkState.active = false;
    chunkState = null;
  }
  hardStopPlayer(currentPlayer);
  currentPlayer = null;
}

/**
 * 开启一次「全新的」播放会话（v105 反馈 #4）
 * ---------------------------------------------------------------------------
 * 上划退出 / 锁屏后，上一次会话在原生层留下了几样**挂在模块上**的状态：
 *   · `naturalEnded`（上一轮真的播完过 → 新会话的第一次结束信号会被一票放行）
 *   · `userPaused` / `interrupted`（暂停 / 打断屏蔽位没清 → 检测器行为错乱）
 *   · `endWatch` 的定时器与 `endFired` 去重位
 * 这些都不会随 React 状态复位。孩子回到界面点播放时，残留的「已播完」标记
 * 会让一次假 ended 立刻通过校验，界面直接被推进提问环节 —— 正是本次反馈的现象。
 * 所以每次真正起播前，把这一整套会话状态清零，从「没播过、没暂停、没结束」开始。
 */
/**
 * 开启一次「全新的」播放会话（v105 反馈 #4 / v102 修复）
 * ---------------------------------------------------------------------------
 * 上划退出 / 锁屏 / 切故事后，上一次会话在原生层留下了几样**挂在模块上**的状态：
 *   · `naturalEnded`（上一轮真的播完过 → 新会话的第一次结束信号会被一票放行）
 *   · `userPaused` / `interrupted`（暂停 / 打断屏蔽位没清 → 检测器行为错乱）
 *   · `sawPlaying` / `maxPos` / `startPos`（「出过声 / 推进过」判据的读数被上一轮污染）
 *   · `endWatch` 的定时器与 `endFired` 去重位
 * 这些都不会随 React 状态复位。孩子回到界面点播放时，残留的「已播完」标记
 * 会让一次假 ended 立刻通过校验，界面直接被推进提问环节 —— 正是本次反馈的现象。
 *
 * 所以每次真正起播前，把这一整套会话状态清零，从「没播过、没暂停、没结束、没收过声」开始。
 * 同时**彻底销毁**上一路播放器（currentPlayer / chunkState），绝不允许多个播放器并存。
 */
export function beginPlaybackSession(): void {
  interrupted = false;
  userPaused = false;
  naturalEnded = false;
  sawPlaying = false;
  maxPos = 0;
  startPos = 0;
  lastPos = 0;
  stallTicks = 0;
  hardEndArmAt = 0;
  // 先彻底停掉并销毁上一路播放器（currentPlayer / chunkState / 全部 endWatch 状态），
  // 避免「旧 player 没被回收 → 继续出声」或「分片状态残留 → 新故事从旧断点错乱起播」。
  stopClonedAudio();
  resetEndWatch();
  if (chunkState) chunkState.paused = false;
}

/**
 * 强制把播放引擎整个炸回「空状态」：销毁播放器、清空分片、清零所有会话标志与定时器。
 * 供上层在「进入故事详情 / 切换故事 / 离开页面」时调用，作为「绝不留孤儿播放器」的兜底。
 * 与 beginPlaybackSession 的区别：它还会把关心的 flags 一次性显式归零，
 * 不依赖 resetEndWatch 的内部实现，更直观、更不易被后续重构遗漏。
 */
export function forceResetPlayback(): void {
  stopClonedAudio();
  endFired = false;
  interrupted = false;
  userPaused = false;
  naturalEnded = false;
  sawPlaying = false;
  maxPos = 0;
  startPos = 0;
  lastPos = 0;
  stallTicks = 0;
  hardEndArmAt = 0;
  maxDur = 0;
}

/**
 * 分片流式引擎（v90 反馈 #1/#2/#3）
 * ---------------------------------------------------------------------------
 * 仅长文本（> CHUNK_THRESHOLD_CHARS）走分片；短文本/提示音/本地录音仍走整段逻辑。
 * currentPlayer 始终指向「当前在播的那一片」的 player，片间切换先停旧片再建新片，
 * 复用 armEndWatch 的轮询做「当前片到末尾」检测；整段结束只在最后一片播完时触发 onDone。
 */

/**
 * 彻底停掉一个播放器：`pause` 与 `remove` **各自 try**。
 * ---------------------------------------------------------------------------
 * 原来两者写在一个 try 里，pause 一抛（player 已被系统回收时很常见）就跳过 remove，
 * 旧播放器继续出声 —— v94 反馈 #1「界面显示温柔女声，耳朵里是大哥哥」正是这个。
 */
function hardStopPlayer(p: AudioPlayerLike | null): void {
  if (!p) return;
  try {
    p.pause();
  } catch {
    /* 忽略 */
  }
  try {
    p.remove();
  } catch {
    /* 忽略 */
  }
}

/** 只停当前 player（不清除 chunkState），用于分片间切换 / 暂停 */
function stopCurrentPlayerOnly(): void {
  hardStopPlayer(currentPlayer);
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
  if (isUsableCacheFile(cacheFile(fileName))) {
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
  /**
   * v95 修复：同一片在极短时间内被重复请求起播 → 直接忽略。
   * 「片尾结束」有三个来源（轮询到末尾 / 事件式 onEnded / 硬定时器），个别版本会连发两次；
   * 两次都推进时，第二次会把同一片重新 play 一遍 —— 听起来正是「第一句话又读了一遍」。
   */
  if (cs.current === i && cs.playStartedAt && Date.now() - cs.playStartedAt < 1500) {
    return true;
  }
  if (cs.abortCheck && !cs.abortCheck()) {
    cs.active = false;
    chunkState = null;
    return false;
  }
  const fileName = cacheFileName(cs.chunks[i], cs.target);
  let res: { ok: boolean; error?: string };
  try {
    res = await ensureSynthFile(cs.chunks[i], cs.target, fileName);
  } catch (err) {
    // 兜底：ensureSynthFile 已内部收敛异常，这里再包一层，确保绝不会「静默挂住」
    res = { ok: false, error: `合成异常：${(err as any)?.message || String(err)}` };
  }
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
    /**
     * 非首片失败：先原地重试一次（网络抖动/限流很常见，重试多半就好了），
     * 仍失败再标记跳过、继续下一片 —— 绝不让一片失败卡死整段。
     */
    if (!cs.retried.has(i)) {
      cs.retried.add(i);
      cs.synthDone[i] = false;
      setTimeout(() => {
        if (chunkState !== cs || !cs.active) return;
        void playChunkIndex(i);
      }, 900);
      return false;
    }
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
  cs.playStartedAt = Date.now();
  cs.paused = false;
  cs.started = true;
  // 新的一片已经开播：把「等下一片」的等待态清掉，避免预取完成时又推进一次、把这一片打断
  cs.pendingAdvance = false;
  cs.pendingSince = 0;
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
    if (!cs.pendingSince) cs.pendingSince = Date.now();
    return;
  }
  let next = cs.current + 1;
  while (next < cs.chunks.length) {
    const fileName = cacheFileName(cs.chunks[next], cs.target);
    if (isUsableCacheFile(cacheFile(fileName))) {
      cs.pendingAdvance = false;
      cs.pendingSince = 0;
      void playChunkIndex(next);
      return;
    }
    if (cs.synthDone[next] === false) {
      next++;
      continue;
    } // 跳过已失败片
    // 未就绪且未判失败：触发预取并等待
    cs.pendingAdvance = true;
    if (!cs.pendingSince) cs.pendingSince = Date.now();
    void prewarmChunk(next);
    return;
  }
  // 没有下一片（都跳完 / 已是最后）→ 整段结束
  cs.pendingAdvance = false;
  cs.pendingSince = 0;
  // 必须在 onDone 之前打标记：上层回调里会立刻读它来决定「这是真播完」
  naturalEnded = true;
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
  let res: { ok: boolean; error?: string };
  try {
    res = await ensureSynthFile(cs.chunks[j], cs.target, fileName);
  } catch (err) {
    res = { ok: false, error: `合成异常：${(err as any)?.message || String(err)}` };
  } finally {
    /**
     * v95 修复：一定要把本片从「正在合成」里摘掉。
     * 原来这段没有 finally，一旦 await 抛错，synthRunning 会永久留着这个下标，
     * 之后 tryAdvance / 重试看到「正在合成」就什么都不做 —— 整段故事永远停在等待中，
     * 界面表现就是「读到第二段一直缓冲」。
     */
    cs.synthRunning.delete(j);
  }
  if (!cs || !cs.active) return;
  cs.synthDone[j] = res.ok;
  if (!res.ok) {
    // 预取失败：若正在等这一片，则跳过它继续推进
    if (cs.pendingAdvance && cs.current + 1 === j) {
      cs.pendingAdvance = false;
      cs.pendingSince = 0;
      tryAdvance();
    }
    return;
  }
  if (cs.pendingAdvance && cs.current + 1 === j) {
    cs.pendingAdvance = false;
    cs.pendingSince = 0;
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
/**
 * 秒制归一（v97 反馈 #3/#4 根因）
 * ---------------------------------------------------------------------------
 * expo-audio 的 `player.duration` 在部分机型/系统版本上返回的是**毫秒**
 * （例如 44686 实际表示 44.686 秒），而 `currentTime` 是秒。
 * 两者混用会连锁出两个现象：
 *   ① 界面上「还剩 744:46」——把 44686 当成了秒；
 *   ② 播完判定 `pos >= dur - 1.5` 永远不成立 —— 声音停了，界面却停在播放页，
 *      既不进「讲完啦」也不进提问环节。
 * 这里统一折算：超过 1 小时（3600 秒）的值一律按毫秒处理。
 * 我们最长的故事也只有 25 分钟（1500 秒），不会误伤。
 */
function toSec(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v > 3600 ? v / 1000 : v;
}

/** 当前片的播放位置（秒），不含分片累计 —— 供分片累计与 armEndWatch 内部使用 */
export function getClonedPositionRaw(): number {
  try {
    const p = currentPlayer as unknown as { currentTime?: number } | null;
    return p && typeof p.currentTime === 'number' ? toSec(p.currentTime) : 0;
  } catch {
    return 0;
  }
}

/** 播放位置（秒）：分片模式返回累计值，否则返回当前片位置 */
export function getClonedPosition(): number {
  if (chunkState && chunkState.active) return getChunkPosition();
  return getClonedPositionRaw();
}

/**
 * 当前分片断点（片索引 + 片内秒）。整段播放 / 未起播时返回 null。
 * 调用方（故事页）把它落盘，下次打开 App 时据此「原处续播」。
 */
export function getChunkPlace(): ChunkPlace | null {
  const cs = chunkState;
  if (!cs || !cs.active || cs.current < 0) return null;
  return {
    index: cs.current,
    offset: Math.max(0, getClonedPositionRaw()),
    total: cs.chunks.length,
  };
}

/** 当前片的总时长（秒），不含分片累计 —— 供分片累计与 armEndWatch 内部使用 */
export function getClonedDurationRaw(): number {
  try {
    const p = currentPlayer as unknown as { duration?: number } | null;
    return p && typeof p.duration === 'number' ? toSec(p.duration) : 0;
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

/**
 * 整段是否刚「自然播完」（分片模式末片播完 / 单段音频到末尾）。
 * 上层收到结束回调时用它一票通过：这是引擎自己打的标记，不需要再用
 * 「位置是否推进过」之类的启发式去猜（分片模式下那些值会被逐片重置）。
 */
export function didFinishNaturally(): boolean {
  return naturalEnded;
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
 * 是否还有一路「能原地续播」的播放器（v106 build 100）。
 * ---------------------------------------------------------------------------
 * iOS 在 App 进入后台一段时间后会把 AVPlayer 彻底回收：此时对象还在，
 * `play()` 不抛错、`playing` 甚至仍报 true，但**一点声音都没有**。
 * 上层若盲目走「pause → resume 秒续」，就会卡在「波形在跳、没有声音」的死状态。
 *
 * 判定条件（三条同时满足才认为可原地续）：
 *   ① 播放器对象还在；
 *   ② 读得到有效时长（被回收的播放器时长会归 0 / NaN）；
 *   ③ 分片模式下当前片没有「已播完待推进」标记（那种情况 play() 也推不动下一片）。
 * 不满足时，调用方必须退回「拆掉重建成一路全新播放（从断点起）」。
 */
export function hasLivePlayer(): boolean {
  try {
    if (!currentPlayer) return false;
    if (chunkState && chunkState.active && chunkState.pendingAdvance) return false;
    const p = currentPlayer as unknown as { duration?: number };
    const dur = toSec(typeof p.duration === 'number' ? p.duration : 0);
    return dur > 0.5;
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

/**
 * 播放「随 App 打包」的离线 MP3（5 篇出海免费故事专用）。
 * ---------------------------------------------------------------------------
 * 与 playLocalFile 的区别：来源是 Metro 打进包的 assetId，不是沙盒文件路径，
 * 因此不依赖文件系统、不需要任何网络请求、断网也能播。
 * markNaturalEnd=true：整段播完时引擎打「自然结束」标记，上层据以进入
 * 「讲完啦」页并触发礼花（free 版过去走 expo-speech，结束信号曾被守卫误杀）。
 */
export async function playBundledAudio(
  assetId: number,
  onDone?: () => void,
): Promise<boolean> {
  stopClonedAudio();
  return startPlayback('', onDone, undefined, false, true, assetId);
}

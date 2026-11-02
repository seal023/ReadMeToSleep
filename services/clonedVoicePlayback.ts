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
    const dur = getClonedDuration();
    const pos = getClonedPosition();
    if (dur > 0.4 && pos >= dur - 1.5) endOnce?.();
  };
  acceptEnd = acceptEndSignal;
  endWatchTimer = setInterval(() => {
    if (endFired || !currentPlayer) return;
    const dur = getClonedDuration();
    const pos = getClonedPosition();
    // duration 未加载完成（0）时不做判断，避免刚起播就误判结束
    if (dur <= 0.4) return;
    // 长音频（尤其 AI 创作故事）起播/缓冲抖动时 duration 会瞬间回退，
    // 若直接拿「当前很小的 dur」去比 pos 就会误判「已播完」→ 故事没讲完就跳结束。
    // 故跟踪出现过的最大时长，仅当「当前 dur 没有异常回退」且「位置接近真实时长」才判结束。
    if (dur > maxDur) maxDur = dur;
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
    if (!hardEndTimer) {
      const remainMs = Math.max(0, dur - pos) * 1000;
      hardEndTimer = setTimeout(() => {
        endOnce?.();
      }, remainMs + 2000);
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
 */
export async function prewarmClonedAudio(text: string, target: CloneTarget): Promise<void> {
  try {
    if (!text || text.trim().length < 2) return;
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
  opts?: { cacheOnly?: boolean; fast?: boolean },
): Promise<boolean> {
  // 先停掉上一段，避免叠加
  stopClonedAudio();
  lastCloneError = '';

  try {
    const fileName = cacheFileName(text, target);
    if (opts?.cacheOnly && !cacheFile(fileName).exists) {
      // 后台补合成（不 await，失败也无害），本次立刻交回调用方去用系统音
      void prewarmClonedAudio(text, target);
      return false;
    }
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
export function seekClonedAudio(positionSeconds: number): void {
  try {
    if (currentPlayer && typeof currentPlayer.seekTo === 'function') {
      // expo-audio 的 seekTo 接收毫秒，需把秒换算成毫秒
      currentPlayer.seekTo(Math.max(0, positionSeconds) * 1000);
    }
  } catch {
    /* 忽略 seek 异常 */
  }
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
 * 当前克隆声 / 本地音的播放位置（秒）。仅对 expo-audio 播放器有效；
 * 系统音（TTS）不支持，返回 0 —— 调用方据此决定是否显示真实进度 / 允许拖动快进。
 */
export function getClonedPosition(): number {
  try {
    const p = currentPlayer as unknown as { currentTime?: number } | null;
    return p && typeof p.currentTime === 'number' ? p.currentTime : 0;
  } catch {
    return 0;
  }
}

/** 当前克隆声 / 本地音的总时长（秒）；未加载完成返回 0 */
export function getClonedDuration(): number {
  try {
    const p = currentPlayer as unknown as { duration?: number } | null;
    return p && typeof p.duration === 'number' ? p.duration : 0;
  } catch {
    return 0;
  }
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

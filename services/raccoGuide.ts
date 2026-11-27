/**
 * 小浣熊向导语音 · 播放层
 * ---------------------------------------------------------------------------
 * 播放 raccoGuideAudio.ts 里的预装 MP3（离线、零费用、不扣 AI 次数）。
 *
 * 设计要点（务必保持）：
 *  1. **独立 player**：用自己持有的 expo-audio player，绝不调用 stopClonedAudio()
 *     或 playBundledAudio()——那会掐断正在播的故事。
 *  2. **打断保护**：故事正在播（isStoryPlaying）时一律不插话；g* 睡眠句更是
 *     只在播放页/睡眠页由页面显式调用，绝不自动抢播。
 *  3. **永不崩**：expo-audio 在本地 node_modules 未装全时无法类型校验，
 *     所有调用包 try/catch，失败静默返回 false，不影响页面交互。
 *  4. 同一时刻只有一句向导语在播：新的一句会先停掉上一句再播。
 *  5. build127 声画同步：通过 onStart 回调把"真正出声"的时刻回传给界面，
 *     界面等这个回调才显示气泡和动画（之前画面先出、声音迟到，脱节）。
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { getRuntimeLanguage } from './i18n';
import { isStoryPlaying, speakWithBestVoice } from './playback';
import { getRaccoGuideAssetId } from './raccoGuideAudio';
import { getRaccoGuideLine } from './raccoGuideLines';
import { getGuideVoice } from './storage';

type StatusLike = {
  isPlaying?: boolean;
  didJustFinish?: boolean;
  currentTime?: number;
  duration?: number;
};

type PlayerLike = {
  play: () => void;
  pause: () => void;
  remove: () => void;
  duration?: number;
  addListener?: (event: string, cb: (s: StatusLike) => void) => { remove: () => void };
};

let guidePlayer: PlayerLike | null = null;
let guideStatusSub: { remove: () => void } | null = null;
let modeConfigured = false;

/** expo-audio 的 duration 在部分机型返回毫秒，统一折算成秒（与 clonedVoicePlayback 一致） */
function toSec(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v > 3600 ? v / 1000 : v;
}

/** 停掉当前 player 并移除状态监听（换新句 / 卸载时调用） */
function clearGuidePlayer(): void {
  if (guideStatusSub) {
    try { guideStatusSub.remove(); } catch { /* noop */ }
    guideStatusSub = null;
  }
  if (guidePlayer) {
    try { guidePlayer.pause(); guidePlayer.remove(); } catch { /* noop */ }
    guidePlayer = null;
  }
}

async function ensureMode(): Promise<void> {
  if (modeConfigured) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      shouldPlayInBackground: false,
    });
    modeConfigured = true;
  } catch {
    // 忽略：静音模式/模拟器下可能失败，不影响播安静声音
  }
}

/** 发音起播回调：durationSec 为本句真实时长（秒，拿不到时为 undefined） */
export type GuideSpeakOpts = {
  force?: boolean;
  onStart?: (durationSec?: number) => void;
};

/**
 * 播放一句向导语。
 * @param key  raccoGuideAudio 里的 key（a1..g5）
 * @param opts.force  即使故事在播也强播（仅用于 CTA/完成等非睡眠反馈；默认 false）
 * @param opts.onStart 真正出声时回调（供界面显示气泡/动画、按真实时长收起）
 * @returns 是否真正起播
 */
export async function playRaccoGuide(key: string, opts: GuideSpeakOpts = {}): Promise<boolean> {
  // 睡眠/引导句绝不在故事播放时插话（铁律：不能把孩子吵醒）
  if (!opts.force && isStoryPlaying()) return false;

  const lang = getRuntimeLanguage();
  const assetId = getRaccoGuideAssetId(key, lang);
  if (assetId == null) return false;

  try {
    await ensureMode();
    // 停掉上一句（复用单例，避免同时两句叠加）
    clearGuidePlayer();

    // SDK 57 expo-audio：本地资源用 { assetId }（与项目 startPlayback 一致）
    const player = createAudioPlayer({ assetId }) as unknown as PlayerLike;
    guidePlayer = player;

    let started = false;
    const fireStart = () => {
      if (started) return;
      started = true;
      opts.onStart?.(toSec(Number(player.duration ?? 0)) || undefined);
    };

    // 以 player 的 isPlaying / currentTime 为准判定"真正出声"，
    // 而不是 play() 调用时刻——后者只是开始加载，实际出声要晚几百毫秒。
    if (typeof player.addListener === 'function') {
      try {
        guideStatusSub = player.addListener('playbackStatusUpdate', (s: StatusLike) => {
          if (!started && (s.isPlaying === true || (s.currentTime ?? 0) > 0)) fireStart();
        });
      } catch {
        guideStatusSub = null;
      }
    }

    player.play();
    // 兜底：个别机型 playbackStatusUpdate 来得晚或不触发，260ms 后放行画面，
    // 至少保证画面与声音几乎同时，而不是等更久才出气泡。
    setTimeout(() => { if (!started) fireStart(); }, 260);
    return true;
  } catch {
    clearGuidePlayer();
    return false;
  }
}

/**
 * 统一的向导语发音入口：按家长在设置里选的「向导语音角色」决定用谁的声音。
 *  - racco（默认）：播打包的小浣熊卡通声 mp3，离线、零费用。
 *  - preset：走提示音声线（默认大姐姐，家长也可换成克隆亲人）念同一句文案。
 * 故事正在播时仍不让路插话；发音失败都静默，不影响气泡与动画。
 */
export async function speakGuideLine(key: string, opts: GuideSpeakOpts = {}): Promise<boolean> {
  if (!opts.force && isStoryPlaying()) return false;
  let role;
  try {
    role = await getGuideVoice();
  } catch {
    role = 'racco';
  }
  if (role === 'preset') {
    const text = getRaccoGuideLine(key);
    if (!text) return false;
    // 读提示音声线设置；onStart 由 playback 在真正出声时回调，透传给界面做声画同步
    return speakWithBestVoice(text, getRuntimeLanguage(), {
      fast: true,
      onStart: () => opts.onStart?.(),
    });
  }
  return playRaccoGuide(key, opts);
}

/** 停止当前向导语（页面卸载、进入睡眠锁屏时调用） */
export function stopRaccoGuide(): void {
  clearGuidePlayer();
}

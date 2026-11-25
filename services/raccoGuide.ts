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
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { getRuntimeLanguage } from './i18n';
import { isStoryPlaying } from './playback';
import { getRaccoGuideAssetId } from './raccoGuideAudio';

type PlayerLike = {
  play: () => void;
  pause: () => void;
  remove: () => void;
};

let guidePlayer: PlayerLike | null = null;
let modeConfigured = false;

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

/**
 * 播放一句向导语。
 * @param key  raccoGuideAudio 里的 key（a1..g5）
 * @param opts.force  即使故事在播也强播（仅用于 CTA/完成等非睡眠反馈；默认 false）
 * @returns 是否真正起播
 */
export async function playRaccoGuide(
  key: string,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  // 睡眠/引导句绝不在故事播放时插话（铁律：不能把孩子吵醒）
  if (!opts.force && isStoryPlaying()) return false;

  const lang = getRuntimeLanguage();
  const assetId = getRaccoGuideAssetId(key, lang);
  if (assetId == null) return false;

  try {
    await ensureMode();
    // 停掉上一句（复用单例，避免同时两句叠加）
    if (guidePlayer) {
      try { guidePlayer.pause(); guidePlayer.remove(); } catch { /* noop */ }
      guidePlayer = null;
    }

    // SDK 57 expo-audio：本地资源用 { assetId }（与项目 startPlayback 一致）
    const player = createAudioPlayer({ assetId }) as unknown as PlayerLike;
    guidePlayer = player;
    player.play();
    return true;
  } catch {
    guidePlayer = null;
    return false;
  }
}

/** 停止当前向导语（页面卸载、进入睡眠锁屏时调用） */
export function stopRaccoGuide(): void {
  if (!guidePlayer) return;
  try { guidePlayer.pause(); guidePlayer.remove(); } catch { /* noop */ }
  guidePlayer = null;
}

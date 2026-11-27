/**
 * 系统提示音 · 统一发音层（build127「全用小浣熊卡通声」）
 * ---------------------------------------------------------------------------
 * 所有"系统提示音"（问答反馈、问候、告别、主题反馈、设置页点浣熊、推荐介绍）
 * 都走这里，按家长设置的「向导语音角色」分流：
 *  - racco（默认）：播 raccoSystemAudio 里预录的小浣熊卡通声 mp3（离线、零费用）。
 *  - preset：走提示音声线（大姐姐/克隆亲人）。
 *
 * 动态文本（含昵称的问候、带故事名的推荐、AI 自由回答）无法预录任意值：
 * 传 key 时命中预录表 → 播浣熊声；未命中 / 无 key → 回退提示音声线，保证一定有声音。
 *
 * 故事正在播时不插话（铁律，与 raccoGuide 一致），除非 force。
 * 独立 player，绝不掐断故事音频。
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { getRuntimeLanguage } from './i18n';
import { isStoryPlaying, speakWithBestVoice, type SpeakOptions } from './playback';
import { getSystemVoiceAssetId } from './raccoSystemAudio';
import { getGuideVoice } from './storage';

type PlayerLike = { play: () => void; pause: () => void; remove: () => void };

let sysPlayer: PlayerLike | null = null;
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
  } catch { /* 静音模式/模拟器下忽略 */ }
}

function stopCurrent(): void {
  if (sysPlayer) {
    try { sysPlayer.pause(); sysPlayer.remove(); } catch { /* noop */ }
    sysPlayer = null;
  }
}

export interface SystemVoiceOpts {
  /** 预录表的 key（如 correct_1 / hello_morning）；命中则 racco 模式播浣熊声 */
  key?: string;
  /** 回退到提示音声线时要念的文本（动态文本必传） */
  text: string;
  force?: boolean;
  /** 回退到提示音声线时的额外选项（voiceId/cacheOnly/onStart 等） */
  speakOpts?: SpeakOptions;
}

/**
 * 播一句系统提示音。返回是否真正出声。
 * @param opts.onStart 由 speakOpts.onStart 透传——真正出声时回调，供界面做声画同步
 */
export async function speakSystemVoice(
  lang: 'zh' | 'en',
  opts: SystemVoiceOpts,
): Promise<boolean> {
  const { key, text, force, speakOpts } = opts;
  if (!text) return false;
  if (!force && isStoryPlaying()) return false;

  let role: string;
  try { role = await getGuideVoice(); } catch { role = 'racco'; }

  // preset：直接走提示音声线（大姐姐/克隆亲人），支持 onStart/onDone/voiceId
  if (role === 'preset') {
    return speakWithBestVoice(text, lang, speakOpts);
  }

  // racco：命中预录表则播小浣熊声
  const assetId = key ? getSystemVoiceAssetId(key, lang) : null;
  if (assetId != null) {
    try {
      await ensureMode();
      stopCurrent();
      const player = createAudioPlayer({ assetId }) as unknown as PlayerLike;
      sysPlayer = player;
      player.play();
      // 本地 mp3 起播快，onStart 稍作延迟触发，让界面气泡与声音几乎同时出现
      if (speakOpts?.onStart) setTimeout(() => speakOpts.onStart?.(), 60);
      return true;
    } catch {
      stopCurrent();
      // 落回提示音声线兜底
      return speakWithBestVoice(text, lang, speakOpts);
    }
  }

  // racco 模式下未命中预录表（动态文本/AI 回答）→ 提示音声线兜底，保证有声音
  return speakWithBestVoice(text, lang, speakOpts);
}

/** 停止当前系统提示音（页面卸载用；不碰故事/向导 player） */
export function stopSystemVoice(): void {
  stopCurrent();
}

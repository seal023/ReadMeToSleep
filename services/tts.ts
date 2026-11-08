import { setAudioModeAsync } from 'expo-audio';

/**
 * 音频会话管理（v110：系统机器音已彻底废弃）
 * ---------------------------------------------------------------------------
 * ⚠️ 本文件**不再包含任何 expo-speech / AVSpeechSynthesizer 调用**。
 *
 * 产品决策（build 110）：儿童场景不接受机器音。5 篇免费故事已随包预装
 * Cherry（大姐姐）高质量 MP3，其余故事与提示音一律走云端音色 / 克隆声 +
 * 本地磁盘缓存。此前 PlayStory / speakWithBestVoice 末尾的「系统音兜底」
 * 正是「开局机器音 + 大姐姐音双声叠加」的温床，已全部删除：
 *   · 音频不可用时明确报错或静默收尾，绝不回退手机自带语音；
 *   · 云端合成期间由 playback.ts 的 audioEpoch 统一仲裁，同一时刻
 *     只允许一个音频实例存在。
 *
 * 这里只保留「让 iOS 在静音键开启时也能出声」的会话配置，expo-audio 播放
 * 与提示音都依赖它。
 */

export interface Voice {
  id: string;
  name: string;
}

/** 兼容旧引用的展示用列表（已不含「手机系统语音」选项） */
export const VOICES: Voice[] = [
  { id: 'preset:cherry', name: '大姐姐' },
];

/**
 * 把音频会话切到 playback 模式（允许在静音键开启时出声）。
 *
 * ⚠️ 每次说话前都要重设，不能只做一次（2026-11-01 修复）：
 *   锁屏 / 切后台 / 录音结束 / 来电 / 蓝牙切换都会让 iOS 自行收回或改掉
 *   AVAudioSession 类别，一旦会话被收回，之后再播就是「静默失败」。
 *   这里每次都重设，一次原生调用只有几毫秒，比「没声音」划算得多。
 */
let lastModeAt = 0;

export async function ensureAudioMode(): Promise<void> {
  // 1.5 秒内重复说话不重复设置（避免一句话里多次调用），但绝不「一辈子只设一次」
  if (Date.now() - lastModeAt < 1500) return;
  try {
    /**
     * v81 #3：必须显式 allowsRecording: false。
     * 提问环节为了录音会把会话切成 playAndRecord，录音停止后若只设置
     * playsInSilentMode，会话仍停在 playAndRecord —— 此时播放会走「听筒」
     * 而不是扬声器，听感就是「AI 回答没有语音 / 声音小得像没响」。
     */
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    lastModeAt = Date.now();
  } catch (err) {
    lastModeAt = 0;
    console.warn('[audio] setAudioModeAsync failed:', err);
  }
}

/** 供 App 回到前台时调用：清掉时间戳，强制下一次说话重设会话 */
export function invalidateAudioMode(): void {
  lastModeAt = 0;
}

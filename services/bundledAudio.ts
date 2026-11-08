/**
 * 5 篇出海免费故事的「预装音频」资源表
 * ---------------------------------------------------------------------------
 * 这 10 个 MP3 由 data/classic-stories/build_free_audio.mjs 用云端
 * qwen3-tts-flash + Cherry（大姐姐）音色合成，随 App 一起打进包里。
 *
 * 运行时用 expo-audio 的 `assetId` 直接播放本地资源：
 *   · 零网络请求（不发起任何 TTS / AI 调用）
 *   · 不扣 AI 次数
 *   · 断网 / 飞行模式照样能听
 *   · 音色固定为预装的大姐姐，免费用户不能换
 *
 * ⚠️ require() 必须是**字面量**：Metro 的静态资源打包只认编译期常量，
 *    动态拼接路径或变量索引会让资源进不了包（运行期 assetId 为 0）。
 */
import { FREE_OFFLINE_POOL_IDS } from './storage';

const BUNDLED: Record<string, { zh: number; en: number }> = {
  'classic-001': {
    zh: require('../assets/audio/free/classic-001-zh.mp3') as number,
    en: require('../assets/audio/free/classic-001-en.mp3') as number,
  },
  'classic-002': {
    zh: require('../assets/audio/free/classic-002-zh.mp3') as number,
    en: require('../assets/audio/free/classic-002-en.mp3') as number,
  },
  'classic-003': {
    zh: require('../assets/audio/free/classic-003-zh.mp3') as number,
    en: require('../assets/audio/free/classic-003-en.mp3') as number,
  },
  'classic-004': {
    zh: require('../assets/audio/free/classic-004-zh.mp3') as number,
    en: require('../assets/audio/free/classic-004-en.mp3') as number,
  },
  'classic-007': {
    zh: require('../assets/audio/free/classic-007-zh.mp3') as number,
    en: require('../assets/audio/free/classic-007-en.mp3') as number,
  },
};

/** 该故事是否有随包的中英双语 MP3（且属于 5 篇免费高亮池） */
export function isBundledFreeStory(storyId: string): boolean {
  return FREE_OFFLINE_POOL_IDS.includes(storyId) && !!BUNDLED[storyId];
}

/** 取某篇故事在指定界面语言下的本地音频 assetId */
export function getBundledAudioAssetId(
  storyId: string,
  language: 'zh' | 'en',
): number | undefined {
  const entry = BUNDLED[storyId];
  if (!entry) return undefined;
  return entry[language] || entry.zh;
}

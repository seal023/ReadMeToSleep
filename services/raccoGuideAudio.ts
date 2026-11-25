/**
 * 小浣熊向导语音 · 预装音频资源表
 * ---------------------------------------------------------------------------
 * 40 句引导语 × 中英双语 = 80 个 MP3，由 gen_all.py 用 edge-tts
 * 中文 YunxiaNeural(Cartoon/Cute) +40Hz / 英文 AnaNeural(Cartoon/Cute) +40Hz 合成。
 * 播放/睡眠场景(g1-g5)用 -12% 慢速 +30Hz 轻声版。随 App 打包，离线零费用。
 *
 * ⚠️ require() 必须是字面量：Metro 静态打包只认编译期常量。
 */

type Lang = 'zh' | 'en';

const GUIDE: Record<string, { zh: number; en: number }> = {
  a1: {
    zh: require('../assets/audio/racco/racco_a1_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_a1_en.mp3') as number,
  },
  a2: {
    zh: require('../assets/audio/racco/racco_a2_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_a2_en.mp3') as number,
  },
  a3: {
    zh: require('../assets/audio/racco/racco_a3_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_a3_en.mp3') as number,
  },
  a4: {
    zh: require('../assets/audio/racco/racco_a4_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_a4_en.mp3') as number,
  },
  a5: {
    zh: require('../assets/audio/racco/racco_a5_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_a5_en.mp3') as number,
  },
  a6: {
    zh: require('../assets/audio/racco/racco_a6_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_a6_en.mp3') as number,
  },
  a7: {
    zh: require('../assets/audio/racco/racco_a7_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_a7_en.mp3') as number,
  },
  a8: {
    zh: require('../assets/audio/racco/racco_a8_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_a8_en.mp3') as number,
  },
  b1: {
    zh: require('../assets/audio/racco/racco_b1_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_b1_en.mp3') as number,
  },
  b2: {
    zh: require('../assets/audio/racco/racco_b2_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_b2_en.mp3') as number,
  },
  b3: {
    zh: require('../assets/audio/racco/racco_b3_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_b3_en.mp3') as number,
  },
  b4: {
    zh: require('../assets/audio/racco/racco_b4_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_b4_en.mp3') as number,
  },
  b5: {
    zh: require('../assets/audio/racco/racco_b5_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_b5_en.mp3') as number,
  },
  b6: {
    zh: require('../assets/audio/racco/racco_b6_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_b6_en.mp3') as number,
  },
  c1: {
    zh: require('../assets/audio/racco/racco_c1_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_c1_en.mp3') as number,
  },
  c2: {
    zh: require('../assets/audio/racco/racco_c2_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_c2_en.mp3') as number,
  },
  c3: {
    zh: require('../assets/audio/racco/racco_c3_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_c3_en.mp3') as number,
  },
  c4: {
    zh: require('../assets/audio/racco/racco_c4_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_c4_en.mp3') as number,
  },
  c5: {
    zh: require('../assets/audio/racco/racco_c5_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_c5_en.mp3') as number,
  },
  c6: {
    zh: require('../assets/audio/racco/racco_c6_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_c6_en.mp3') as number,
  },
  c7: {
    zh: require('../assets/audio/racco/racco_c7_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_c7_en.mp3') as number,
  },
  d1: {
    zh: require('../assets/audio/racco/racco_d1_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_d1_en.mp3') as number,
  },
  d2: {
    zh: require('../assets/audio/racco/racco_d2_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_d2_en.mp3') as number,
  },
  d3: {
    zh: require('../assets/audio/racco/racco_d3_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_d3_en.mp3') as number,
  },
  d4: {
    zh: require('../assets/audio/racco/racco_d4_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_d4_en.mp3') as number,
  },
  d5: {
    zh: require('../assets/audio/racco/racco_d5_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_d5_en.mp3') as number,
  },
  e1: {
    zh: require('../assets/audio/racco/racco_e1_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_e1_en.mp3') as number,
  },
  e2: {
    zh: require('../assets/audio/racco/racco_e2_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_e2_en.mp3') as number,
  },
  e3: {
    zh: require('../assets/audio/racco/racco_e3_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_e3_en.mp3') as number,
  },
  e4: {
    zh: require('../assets/audio/racco/racco_e4_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_e4_en.mp3') as number,
  },
  e5: {
    zh: require('../assets/audio/racco/racco_e5_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_e5_en.mp3') as number,
  },
  f1: {
    zh: require('../assets/audio/racco/racco_f1_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_f1_en.mp3') as number,
  },
  f2: {
    zh: require('../assets/audio/racco/racco_f2_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_f2_en.mp3') as number,
  },
  f3: {
    zh: require('../assets/audio/racco/racco_f3_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_f3_en.mp3') as number,
  },
  f4: {
    zh: require('../assets/audio/racco/racco_f4_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_f4_en.mp3') as number,
  },
  g1: {
    zh: require('../assets/audio/racco/racco_g1_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_g1_en.mp3') as number,
  },
  g2: {
    zh: require('../assets/audio/racco/racco_g2_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_g2_en.mp3') as number,
  },
  g3: {
    zh: require('../assets/audio/racco/racco_g3_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_g3_en.mp3') as number,
  },
  g4: {
    zh: require('../assets/audio/racco/racco_g4_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_g4_en.mp3') as number,
  },
  g5: {
    zh: require('../assets/audio/racco/racco_g5_zh.mp3') as number,
    en: require('../assets/audio/racco/racco_g5_en.mp3') as number,
  },
};

/** 取某句引导语在指定语言的本地音频 assetId */
export function getRaccoGuideAssetId(key: string, lang: Lang): number | undefined {
  const entry = GUIDE[key];
  if (!entry) return undefined;
  return entry[lang] || entry.zh;
}

/** 该 key 是否有预装音频 */
export function hasRaccoGuide(key: string): boolean {
  return !!GUIDE[key];
}
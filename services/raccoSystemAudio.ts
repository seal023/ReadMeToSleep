/**
 * 系统提示音 · 小浣熊声资源表（build127「全用小浣熊卡通声」）
 * ---------------------------------------------------------------------------
 * 108 个固定系统提示音（问答短句/问候/告别/设置/主题/推荐）× 中英双语，
 * 由 gen_system.py 用 edge-tts YunxiaNeural+40Hz / AnaNeural+40Hz 预录，
 * 与 40 句向导语同一音色。Metro 要求 require 字面量，故逐条列出。
 *
 * 动态文本（带昵称的问候、带故事名的推荐、AI 自由回答）无法预录任意值，
 * 运行时按 key 查表；查不到时由 raccoSystemVoice 回退到提示音声线。
 */
export const SYSTEM_VOICE: Record<string, { zh: number; en: number }> = {
  bye_day: { zh: require('../assets/audio/racco/sys_bye_day_zh.mp3') as number, en: require('../assets/audio/racco/sys_bye_day_en.mp3') as number },
  bye_night: { zh: require('../assets/audio/racco/sys_bye_night_zh.mp3') as number, en: require('../assets/audio/racco/sys_bye_night_en.mp3') as number },
  correct_1: { zh: require('../assets/audio/racco/sys_correct_1_zh.mp3') as number, en: require('../assets/audio/racco/sys_correct_1_en.mp3') as number },
  correct_2: { zh: require('../assets/audio/racco/sys_correct_2_zh.mp3') as number, en: require('../assets/audio/racco/sys_correct_2_en.mp3') as number },
  correct_3: { zh: require('../assets/audio/racco/sys_correct_3_zh.mp3') as number, en: require('../assets/audio/racco/sys_correct_3_en.mp3') as number },
  correct_4: { zh: require('../assets/audio/racco/sys_correct_4_zh.mp3') as number, en: require('../assets/audio/racco/sys_correct_4_en.mp3') as number },
  correct_5: { zh: require('../assets/audio/racco/sys_correct_5_zh.mp3') as number, en: require('../assets/audio/racco/sys_correct_5_en.mp3') as number },
  correct_6: { zh: require('../assets/audio/racco/sys_correct_6_zh.mp3') as number, en: require('../assets/audio/racco/sys_correct_6_en.mp3') as number },
  done_1: { zh: require('../assets/audio/racco/sys_done_1_zh.mp3') as number, en: require('../assets/audio/racco/sys_done_1_en.mp3') as number },
  done_2: { zh: require('../assets/audio/racco/sys_done_2_zh.mp3') as number, en: require('../assets/audio/racco/sys_done_2_en.mp3') as number },
  done_3: { zh: require('../assets/audio/racco/sys_done_3_zh.mp3') as number, en: require('../assets/audio/racco/sys_done_3_en.mp3') as number },
  done_4: { zh: require('../assets/audio/racco/sys_done_4_zh.mp3') as number, en: require('../assets/audio/racco/sys_done_4_en.mp3') as number },
  done_5: { zh: require('../assets/audio/racco/sys_done_5_zh.mp3') as number, en: require('../assets/audio/racco/sys_done_5_en.mp3') as number },
  guide_1: { zh: require('../assets/audio/racco/sys_guide_1_zh.mp3') as number, en: require('../assets/audio/racco/sys_guide_1_en.mp3') as number },
  guide_2: { zh: require('../assets/audio/racco/sys_guide_2_zh.mp3') as number, en: require('../assets/audio/racco/sys_guide_2_en.mp3') as number },
  guide_3: { zh: require('../assets/audio/racco/sys_guide_3_zh.mp3') as number, en: require('../assets/audio/racco/sys_guide_3_en.mp3') as number },
  guide_4: { zh: require('../assets/audio/racco/sys_guide_4_zh.mp3') as number, en: require('../assets/audio/racco/sys_guide_4_en.mp3') as number },
  guide_5: { zh: require('../assets/audio/racco/sys_guide_5_zh.mp3') as number, en: require('../assets/audio/racco/sys_guide_5_en.mp3') as number },
  heard_1: { zh: require('../assets/audio/racco/sys_heard_1_zh.mp3') as number, en: require('../assets/audio/racco/sys_heard_1_en.mp3') as number },
  heard_2: { zh: require('../assets/audio/racco/sys_heard_2_zh.mp3') as number, en: require('../assets/audio/racco/sys_heard_2_en.mp3') as number },
  heard_3: { zh: require('../assets/audio/racco/sys_heard_3_zh.mp3') as number, en: require('../assets/audio/racco/sys_heard_3_en.mp3') as number },
  heard_4: { zh: require('../assets/audio/racco/sys_heard_4_zh.mp3') as number, en: require('../assets/audio/racco/sys_heard_4_en.mp3') as number },
  heard_5: { zh: require('../assets/audio/racco/sys_heard_5_zh.mp3') as number, en: require('../assets/audio/racco/sys_heard_5_en.mp3') as number },
  hello_afternoon: { zh: require('../assets/audio/racco/sys_hello_afternoon_zh.mp3') as number, en: require('../assets/audio/racco/sys_hello_afternoon_en.mp3') as number },
  hello_evening: { zh: require('../assets/audio/racco/sys_hello_evening_zh.mp3') as number, en: require('../assets/audio/racco/sys_hello_evening_en.mp3') as number },
  hello_morning: { zh: require('../assets/audio/racco/sys_hello_morning_zh.mp3') as number, en: require('../assets/audio/racco/sys_hello_morning_en.mp3') as number },
  hello_noon: { zh: require('../assets/audio/racco/sys_hello_noon_zh.mp3') as number, en: require('../assets/audio/racco/sys_hello_noon_en.mp3') as number },
  rec_voice: { zh: require('../assets/audio/racco/sys_rec_voice_zh.mp3') as number, en: require('../assets/audio/racco/sys_rec_voice_en.mp3') as number },
  round1_1: { zh: require('../assets/audio/racco/sys_round1_1_zh.mp3') as number, en: require('../assets/audio/racco/sys_round1_1_en.mp3') as number },
  round1_2: { zh: require('../assets/audio/racco/sys_round1_2_zh.mp3') as number, en: require('../assets/audio/racco/sys_round1_2_en.mp3') as number },
  round1_3: { zh: require('../assets/audio/racco/sys_round1_3_zh.mp3') as number, en: require('../assets/audio/racco/sys_round1_3_en.mp3') as number },
  round2_1: { zh: require('../assets/audio/racco/sys_round2_1_zh.mp3') as number, en: require('../assets/audio/racco/sys_round2_1_en.mp3') as number },
  round2_2: { zh: require('../assets/audio/racco/sys_round2_2_zh.mp3') as number, en: require('../assets/audio/racco/sys_round2_2_en.mp3') as number },
  round2_3: { zh: require('../assets/audio/racco/sys_round2_3_zh.mp3') as number, en: require('../assets/audio/racco/sys_round2_3_en.mp3') as number },
  settings_reply1: { zh: require('../assets/audio/racco/sys_settings_reply1_zh.mp3') as number, en: require('../assets/audio/racco/sys_settings_reply1_en.mp3') as number },
  settings_reply2: { zh: require('../assets/audio/racco/sys_settings_reply2_zh.mp3') as number, en: require('../assets/audio/racco/sys_settings_reply2_en.mp3') as number },
  theme_picked: { zh: require('../assets/audio/racco/sys_theme_picked_zh.mp3') as number, en: require('../assets/audio/racco/sys_theme_picked_en.mp3') as number },
  thinking_1: { zh: require('../assets/audio/racco/sys_thinking_1_zh.mp3') as number, en: require('../assets/audio/racco/sys_thinking_1_en.mp3') as number },
  thinking_2: { zh: require('../assets/audio/racco/sys_thinking_2_zh.mp3') as number, en: require('../assets/audio/racco/sys_thinking_2_en.mp3') as number },
  thinking_3: { zh: require('../assets/audio/racco/sys_thinking_3_zh.mp3') as number, en: require('../assets/audio/racco/sys_thinking_3_en.mp3') as number },
  thinking_4: { zh: require('../assets/audio/racco/sys_thinking_4_zh.mp3') as number, en: require('../assets/audio/racco/sys_thinking_4_en.mp3') as number },
  thinking_5: { zh: require('../assets/audio/racco/sys_thinking_5_zh.mp3') as number, en: require('../assets/audio/racco/sys_thinking_5_en.mp3') as number },
  thinking_6: { zh: require('../assets/audio/racco/sys_thinking_6_zh.mp3') as number, en: require('../assets/audio/racco/sys_thinking_6_en.mp3') as number },
  tooShort_1: { zh: require('../assets/audio/racco/sys_tooShort_1_zh.mp3') as number, en: require('../assets/audio/racco/sys_tooShort_1_en.mp3') as number },
  tooShort_2: { zh: require('../assets/audio/racco/sys_tooShort_2_zh.mp3') as number, en: require('../assets/audio/racco/sys_tooShort_2_en.mp3') as number },
  tooShort_3: { zh: require('../assets/audio/racco/sys_tooShort_3_zh.mp3') as number, en: require('../assets/audio/racco/sys_tooShort_3_en.mp3') as number },
  tooShort_4: { zh: require('../assets/audio/racco/sys_tooShort_4_zh.mp3') as number, en: require('../assets/audio/racco/sys_tooShort_4_en.mp3') as number },
  tooShort_5: { zh: require('../assets/audio/racco/sys_tooShort_5_zh.mp3') as number, en: require('../assets/audio/racco/sys_tooShort_5_en.mp3') as number },
  wrong_1: { zh: require('../assets/audio/racco/sys_wrong_1_zh.mp3') as number, en: require('../assets/audio/racco/sys_wrong_1_en.mp3') as number },
  wrong_2: { zh: require('../assets/audio/racco/sys_wrong_2_zh.mp3') as number, en: require('../assets/audio/racco/sys_wrong_2_en.mp3') as number },
  wrong_3: { zh: require('../assets/audio/racco/sys_wrong_3_zh.mp3') as number, en: require('../assets/audio/racco/sys_wrong_3_en.mp3') as number },
  wrong_4: { zh: require('../assets/audio/racco/sys_wrong_4_zh.mp3') as number, en: require('../assets/audio/racco/sys_wrong_4_en.mp3') as number },
  wrong_5: { zh: require('../assets/audio/racco/sys_wrong_5_zh.mp3') as number, en: require('../assets/audio/racco/sys_wrong_5_en.mp3') as number },
  wrong_6: { zh: require('../assets/audio/racco/sys_wrong_6_zh.mp3') as number, en: require('../assets/audio/racco/sys_wrong_6_en.mp3') as number },
};

export function getSystemVoiceAssetId(key: string, lang: 'zh' | 'en'): number | null {
  const entry = SYSTEM_VOICE[key];
  return entry ? entry[lang] ?? null : null;
}

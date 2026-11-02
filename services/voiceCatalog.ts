import { hasClonedVoice } from './clonedVoicePlayback';
import type { CloneTarget } from './voiceClone';

/**
 * 全 App 统一的「可选声音」清单
 * ---------------------------------------------------------------------------
 * v81 反馈 #2：之前提示音与故事朗读共用一份设置，导致中英文表现不一致——
 * 中文提示音走的是旧克隆缓存（听着是妈妈），英文提示音现合成失败落回 iOS
 * 系统女声（听着是机器），而故事朗读又是另一个内置女声。三套声音混在一起，
 * 用户完全无法预期「现在是谁在说话」。
 *
 * 现在把「声音」拆成两个独立设置（见 storage.ts 的 PROMPT_VOICE / STORY_VOICE）：
 *   · 提示音：播报提问、鼓励、状态变化等短句。
 *   · 故事朗读：念故事正文。
 * 两者都从本文件取选项，保证任何界面语言下「同一个 id = 同一个声音」。
 *
 * 选项分三类：
 *   preset:xxx —— 云端内置样本音色（跨中英文一致、不像机器）
 *   system     —— 手机自带离线语音（无网也能响，但机械感重，作为兜底/可选）
 *   mom/dad/... —— 家长自己克隆的真人音色（克隆成功后才出现在列表里）
 */

export type VoiceKind = 'preset' | 'system' | 'clone';

export interface VoiceOption {
  /** 存进设置的值，如 'preset:cherry' / 'system' / 'mom' */
  id: string;
  kind: VoiceKind;
  nameZh: string;
  nameEn: string;
  /** 界面上的小图标 */
  emoji: string;
}

/** 内置样本音色（百炼预置，中英文都可用） */
export const PRESET_VOICE_OPTIONS: VoiceOption[] = [
  { id: 'preset:cherry', kind: 'preset', nameZh: '大姐姐（默认）', nameEn: 'Big sister (default)', emoji: '🌸' },
  { id: 'preset:serena', kind: 'preset', nameZh: '温柔女声', nameEn: 'Gentle voice', emoji: '🌷' },
  { id: 'preset:ethan', kind: 'preset', nameZh: '大哥哥', nameEn: 'Big brother', emoji: '🌿' },
  { id: 'preset:nini', kind: 'preset', nameZh: '邻家姐姐', nameEn: 'Friendly sister', emoji: '🌻' },
];

/** 手机自带语音：离线可用，机械感较重，作为可选/兜底 */
export const SYSTEM_VOICE_OPTION: VoiceOption = {
  id: 'system',
  kind: 'system',
  nameZh: '手机系统语音（离线）',
  nameEn: 'Phone voice (offline)',
  emoji: '📱',
};

/** 默认声音：内置大姐姐，中英文一致、没有机器味 */
export const DEFAULT_VOICE = 'preset:cherry';

/** 未配置 / 配置非法时的兜底：一定是可用的一条 */
export function normalizeVoiceId(id: string | undefined | null): string {
  const v = (id || '').trim();
  if (!v) return DEFAULT_VOICE;
  if (v === 'system') return 'system';
  if (v.startsWith('preset:')) return v;
  return v; // 克隆音色（mom/dad/grandma/custom:xxx）原样返回
}

/** 取某个声音在指定语言下的显示名（找不到时回落为 id 本身） */
export function voiceDisplayName(id: string, language: 'zh' | 'en'): string {
  if (language === 'en') {
    if (id === SYSTEM_VOICE_OPTION.id) return SYSTEM_VOICE_OPTION.nameEn;
    const preset = PRESET_VOICE_OPTIONS.find((o) => o.id === id);
    if (preset) return preset.nameEn;
  } else {
    if (id === SYSTEM_VOICE_OPTION.id) return SYSTEM_VOICE_OPTION.nameZh;
    const preset = PRESET_VOICE_OPTIONS.find((o) => o.id === id);
    if (preset) return preset.nameZh;
  }
  if (id.startsWith('custom:')) return id.slice('custom:'.length);
  const cloneNames: Record<string, [string, string]> = {
    mom: ['妈妈的声音', "Mom's voice"],
    dad: ['爸爸的声音', "Dad's voice"],
    grandma: ['外婆的声音', "Grandma's voice"],
  };
  const hit = cloneNames[id];
  if (hit) return language === 'en' ? hit[1] : hit[0];
  return id;
}

/**
 * 该声音是不是「已经能出声的克隆音色」。
 * 预置音色与系统语音恒为 true（它们不需要克隆）。
 */
export async function isVoiceReady(id: string): Promise<boolean> {
  if (id === 'system' || id.startsWith('preset:')) return true;
  try {
    return await hasClonedVoice(id as CloneTarget);
  } catch {
    return false;
  }
}

/**
 * 家长端「声音设置」用的完整清单：内置样本 + 手机系统语音 + 本机已克隆的亲人。
 * 只有真正克隆成功的亲人音色才会出现，避免选了却不出声。
 */
export async function listAvailableVoices(): Promise<VoiceOption[]> {
  const cloned: VoiceOption[] = [];
  const cloneMeta: { id: CloneTarget; zh: string; en: string; emoji: string }[] = [
    { id: 'mom', zh: '妈妈的声音', en: "Mom's voice", emoji: '👩' },
    { id: 'dad', zh: '爸爸的声音', en: "Dad's voice", emoji: '👨' },
    { id: 'grandma', zh: '外婆的声音', en: "Grandma's voice", emoji: '👵' },
  ];
  for (const meta of cloneMeta) {
    if (await isVoiceReady(meta.id)) {
      cloned.push({ id: meta.id, kind: 'clone', nameZh: meta.zh, nameEn: meta.en, emoji: meta.emoji });
    }
  }
  return [...PRESET_VOICE_OPTIONS, SYSTEM_VOICE_OPTION, ...cloned];
}

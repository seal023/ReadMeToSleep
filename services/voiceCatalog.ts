import { hasClonedVoice, clearClonedCacheForTarget } from './clonedVoicePlayback';
import {
  getClonedTargets,
  getClonedVoiceId,
  renameClonedTargetStorage,
  removeClonedTargetStorage,
  type CloneTarget,
} from './voiceClone';
import {
  getVoiceSetting, saveVoiceSetting,
  getPromptVoiceSetting, savePromptVoiceSetting,
} from './storage';

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

/** 三个「固定亲属」克隆对象的展示信息；自定义对象（custom:<名称>）走名称本身 */
const CLONE_META: Record<string, { zh: string; en: string; emoji: string }> = {
  mom: { zh: '妈妈的声音', en: "Mom's voice", emoji: '👩' },
  dad: { zh: '爸爸的声音', en: "Dad's voice", emoji: '👨' },
  grandma: { zh: '外婆的声音', en: "Grandma's voice", emoji: '👵' },
};

/** 固定亲属在清单里的排列顺序 */
const CLONE_META_ORDER = ['mom', 'dad', 'grandma'];

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
  const hit = CLONE_META[id];
  if (hit) return language === 'en' ? hit.en : hit.zh;
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
 *
 * v84 修正：原先这里只写死 mom/dad/grandma 三个，而克隆页其实还支持
 * 「自定义」对象（存成 `custom:<名称>`）。结果用自定义名字克隆出来的声音
 * 永远不会出现在声音设置里，用户会以为克隆没保存。
 * 改为枚举本机所有 `rms_voice_clone_*` key（getClonedTargets），逐个确认
 * 确实拿到 voice_id 后再加入清单，自定义名字也随之自动出现。
 */
export async function listAvailableVoices(): Promise<VoiceOption[]> {
  let targets: string[] = [];
  try {
    targets = await getClonedTargets();
  } catch {
    targets = [];
  }

  const available = new Set<string>();
  for (const t of targets) {
    if (await isVoiceReady(t)) available.add(t);
  }

  // 固定顺序：妈妈 → 爸爸 → 外婆 → 其余自定义按名字排序，避免每次进页面顺序乱跳
  const ordered = [
    ...CLONE_META_ORDER.filter((k) => available.has(k)),
    ...[...available].filter((k) => !CLONE_META_ORDER.includes(k)).sort(),
  ];

  const cloned: VoiceOption[] = ordered.map((id) => {
    const meta = CLONE_META[id];
    if (meta) {
      return { id, kind: 'clone', nameZh: meta.zh, nameEn: meta.en, emoji: meta.emoji };
    }
    const label = id.startsWith('custom:') ? id.slice('custom:'.length) : id;
    return { id, kind: 'clone', nameZh: label, nameEn: label, emoji: '🧑' };
  });

  return [...PRESET_VOICE_OPTIONS, SYSTEM_VOICE_OPTION, ...cloned];
}

/* -------------------------------------------------------------------------- */
/*  已克隆声音的管理：改称呼 / 删除                                             */
/* -------------------------------------------------------------------------- */

/** 自定义称呼的最大字数（与克隆页输入框上限一致，避免一边能输一边截断） */
export const MAX_CLONE_NAME_LEN = 8;

export type RenameResult =
  | { ok: true; newId: string; changed: boolean }
  | { ok: false; reason: 'empty' | 'tooLong' | 'duplicate' | 'notFound' };

/**
 * 给已克隆的声音改称呼。
 * ---------------------------------------------------------------------------
 * 音色本身（voice_id）不动，只把本地记录搬到一个新 key 下——
 * 因为含义上「这个声音是谁」由 key 表达（mom/dad/custom:<名字>），
 * 改 key 之后全 App 的显示名、播放选音都会自动跟着变，无需额外同步。
 * 注意：固定亲属（妈妈/爸爸）改名后会变成 `custom:<新称呼>`，
 * 不再占用「妈妈/爸爸」那个一键入口——这正是「改错名字后纠正」的预期行为。
 *
 * 若原先「故事朗读 / 提示音」用的就是这个声音，一并迁移到新 id，避免改完名失效。
 */
export async function renameClonedVoice(oldId: string, rawName: string): Promise<RenameResult> {
  const name = (rawName || '').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, reason: 'empty' };
  if ([...name].length > MAX_CLONE_NAME_LEN) return { ok: false, reason: 'tooLong' };

  const newId = `custom:${name}`;
  if (newId === oldId) return { ok: true, newId, changed: false };

  // 原对象必须真的克隆过
  let voiceId: string | null = null;
  try {
    voiceId = await getClonedVoiceId(oldId);
  } catch {
    voiceId = null;
  }
  if (!voiceId) return { ok: false, reason: 'notFound' };

  // 目标称呼重名：先看是否已有同名克隆（否则会把别人的音色覆盖掉）
  try {
    if (await getClonedVoiceId(newId)) return { ok: false, reason: 'duplicate' };
  } catch {
    /* 读取失败按不重名处理，下面写入时还有一次机会 */
  }

  const moved = await renameClonedTargetStorage(oldId, newId);
  if (!moved) return { ok: false, reason: 'notFound' };

  // 清掉旧 key 下的合成缓存（文件名带 target 前缀），新称呼会重新合成一次，
  // 否则旧缓存命中后可能出现「名字换了、声音还是老的」的错觉。
  try {
    clearClonedCacheForTarget(oldId as CloneTarget);
  } catch {
    /* 缓存清理失败不影响改名结果 */
  }

  // 迁移两处声音设置
  try {
    if ((await getVoiceSetting()) === oldId) await saveVoiceSetting(newId);
  } catch {
    /* 忽略 */
  }
  try {
    if ((await getPromptVoiceSetting()) === oldId) await savePromptVoiceSetting(newId);
  } catch {
    /* 忽略 */
  }

  return { ok: true, newId, changed: true };
}

/**
 * 删除一个已克隆的声音（仅本机记录 + 缓存，云端音色不动）。
 * 若当前「故事朗读 / 提示音」正在用它，回落到默认内置大姐姐，
 * 避免设置里留着一个已经不存在的 id（表现为「静音」或「声音突然变了」）。
 */
export async function deleteClonedVoice(id: string): Promise<void> {
  await removeClonedTargetStorage(id);
  try {
    clearClonedCacheForTarget(id as CloneTarget);
  } catch {
    /* 缓存清理失败忽略 */
  }
  try {
    if ((await getVoiceSetting()) === id) await saveVoiceSetting(DEFAULT_VOICE);
  } catch {
    /* 忽略 */
  }
  try {
    if ((await getPromptVoiceSetting()) === id) await savePromptVoiceSetting(DEFAULT_VOICE);
  } catch {
    /* 忽略 */
  }
}

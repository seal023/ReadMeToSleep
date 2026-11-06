import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getServerRights,
  claimFreeCloneOnServer,
  setFreeCloneStoryOnServer,
} from './serverQuota';
import { Story, Progress, SensitiveWords, Language } from '../types';
// 经典故事正文：100 篇公共版权故事，按 25 篇一册分卷存放
import classic1 from '../data/classic-stories/zh/1-25.json';
import classic2 from '../data/classic-stories/zh/26-50.json';
import classic3 from '../data/classic-stories/zh/51-75.json';
import classic4 from '../data/classic-stories/zh/76-100.json';
// 英文正文（双语化）：与 zh/ 同结构，按 id 合并；暂无英文的册为空数组
import en1 from '../data/classic-stories/en/1-25.json';
import en2 from '../data/classic-stories/en/26-50.json';
import en3 from '../data/classic-stories/en/51-75.json';
import en4 from '../data/classic-stories/en/76-100.json';
// 长篇原创故事（无版权）：分卷离线随包分发，结构含 content(中文) + contentEn(英文) + title.{zh,en}
import long510 from '../data/classic-stories/long/5-10.json';
import long1520 from '../data/classic-stories/long/15-20.json';

interface ClassicStoryRaw {
  id: string;
  title: string;
  content: string;
  /** 原版完整内容（公共版权原版长故事），暂留空、UI 不展示，上线后再视情况填充 */
  contentFull?: string;
  tags: string[];
  duration: number;
  source: string;
}

/** 100 篇经典故事正文（离线，随包体分发） */
const CLASSIC_STORIES_DATA: ClassicStoryRaw[] = [
  ...(classic1 as ClassicStoryRaw[]),
  ...(classic2 as ClassicStoryRaw[]),
  ...(classic3 as ClassicStoryRaw[]),
  ...(classic4 as ClassicStoryRaw[]),
];

/** 英文正文合集（按 id 合并进经典故事），无英文的册为空数组 */
const EN_STORIES_DATA: Array<{ id: string; title?: { zh: string; en: string }; content?: string }> = [
  ...(en1 as Array<{ id: string; title?: { zh: string; en: string }; content?: string }>),
  ...(en2 as Array<{ id: string; title?: { zh: string; en: string }; content?: string }>),
  ...(en3 as Array<{ id: string; title?: { zh: string; en: string }; content?: string }>),
  ...(en4 as Array<{ id: string; title?: { zh: string; en: string }; content?: string }>),
];

/** 长篇原创故事（无版权）：合并两卷，全部具备中英双语正文 */
interface LongStoryRaw {
  id: string;
  title: { zh: string; en: string };
  content: string;
  contentEn: string;
  tags: string[];
  duration: number;
  source: string;
  lengthMin: string;
}
const LONG_STORIES_DATA: LongStoryRaw[] = [
  ...(long510 as LongStoryRaw[]),
  ...(long1520 as LongStoryRaw[]),
];
const EN_MAP: Record<string, { id: string; title?: { zh: string; en: string }; content?: string }> = {};
for (const e of EN_STORIES_DATA) EN_MAP[e.id] = e;

/** 已具备英文正文的经典故事 id（library 英文模式过滤用） */
export const CLASSIC_EN_IDS: Set<string> = new Set(
  EN_STORIES_DATA.filter((s) => s.content && s.content.trim().length > 0).map((s) => s.id),
);

const KEYS = {
  STORIES: 'rms_stories',
  PROGRESS: 'rms_progress',
  SENSITIVE_WORDS: 'rms_sensitive_words',
  PARENT_PIN: 'rms_parent_pin',
  VOICE: 'rms_voice',
  /** 提示音声线（与故事声线独立，v81 新增） */
  PROMPT_VOICE: 'rms_prompt_voice',
  PARENT_COMMENTS: 'rms_parent_comments',
  VOICE_GUIDANCE: 'rms_voice_guidance',
  CHILD_NAME: 'rms_child_name',
  CHILD_QA: 'rms_child_qa',
  CHILD_QUIZ: 'rms_child_quiz',
  SLEEP_TIMER_MINUTES: 'rms_sleep_timer_minutes',
  SLEEP_LOCK_ENABLED: 'rms_sleep_lock_enabled',
  STORY_POSITIONS: 'rms_story_positions',
  /** 账号显示名（用户自己改的称呼；系统给的 Apple 名/邮箱才是唯一账号标识） */
  ACCOUNT_NICKNAME: 'rms_account_nickname',
  /** v82 一次性迁移标记：见 migrateVoiceDefaultsOnce */
  VOICE_DEFAULTS_V82: 'rms_voice_defaults_v82',
  /** v92 一次性迁移标记：提示音声线统一回默认大姐姐，见 migratePromptVoiceOnce */
  PROMPT_VOICE_V92: 'rms_prompt_voice_v92',
  /** 免费用户是否已用过「1 次克隆体验」（仅免费用户计，会员不受限） */
  FREE_CLONE_USED: 'rms_free_clone_used',
  /** 免费用户用克隆声选中的那「唯一 1 篇」短故事 id（克隆声仅对它生效） */
  FREE_CLONE_STORY_ID: 'rms_free_clone_story_id',
  /** 免费用户克隆所用的对象（mom/dad/custom:xxx），用于故事页默认克隆声 */
  FREE_CLONE_TARGET: 'rms_free_clone_target',
};

/**
 * 免费离线故事池：5 篇以英文为主的经典，所有用户（含免费）无限次免费收听、
 * 走系统默认音色、绝不走云端 TTS、绝不扣次数。
 * 免费用户故事库里「这 5 篇之外」的经典/长篇一律加锁，点击即弹诙谐付费窗。
 * ⚠️ 这 5 篇的挑选由产品决定，改这里即可（必须都是 data/classic-stories 里存在的 id）。
 */
export const FREE_OFFLINE_POOL_IDS: string[] = [
  'classic-001', // 龟兔赛跑 / The Tortoise and the Hare
  'classic-002',
  'classic-003',
  'classic-004',
  'classic-007',
];

/**
 * 故事时长统一折算成「秒」（v98 反馈 #1）
 * ---------------------------------------------------------------------------
 * 项目里历史上存在两套单位，导致同一个数值在界面上有两种解释：
 *   · 经典 / 长篇故事（data/classic-stories/*.json）：duration 是**秒**，如 646；
 *   · AI 创作故事（services/ai.ts 的 estimateDuration）：duration 是**分钟**，如 3。
 * 于是《小马的清晨山路》（AI 创作、3 分钟）在播放页显示成「故事约 0:03」，
 * 一点播放又按真实音频算出「还剩 2:17」——上下两处自相矛盾。
 *
 * 这里统一折成秒：≤30 一律按分钟理解（App 里没有 30 秒以内的故事），其余按秒。
 * 新写入的故事也走同一折算，历史数据在读取时自动纠正，不需要单独迁移。
 */
export function storyDurationSec(duration?: number | null, type?: Story['type']): number {
  const d = Number(duration) || 0;
  if (d <= 0) return 0;
  // 录音故事（record.tsx）的 duration 本来就是秒：20 秒的录音不能被当成 20 分钟
  if (type === 'recorded') return Math.round(d);
  return d <= 30 ? Math.round(d * 60) : Math.round(d);
}

/** 读取时统一 duration 单位，避免各处自己判断 */
function normalizeStoryDuration(story: Story): Story {
  return { ...story, duration: storyDurationSec(story.duration, story.type) };
}

export interface ParentComment {
  text: string;
  updatedAt: string;
}

/** 孩子在「你的问题时间」向 AI 提的问题（供家长后台查看） */
export interface ChildQA {
  id: string;
  storyId: string;
  storyTitle: string;
  question: string;
  answer: string;
  at: string;
}

/** 第 1 轮选择题的作答记录（含是否正确，供家长后台查看） */
export interface ChildQuiz {
  id: string;
  storyId: string;
  storyTitle: string;
  question: string;
  chosen: string;
  correctText: string;
  isCorrect: boolean;
  at: string;
}

const DEFAULT_PROGRESS: Progress = {
  listenedStories: [],
  listenLog: [],
  checkIns: [],
  badges: [],
  streakDays: 0,
  lastListenDate: '',
};

const DEFAULT_SENSITIVE_WORDS: SensitiveWords = {
  words: [],
  phrases: [],
};

export async function saveStory(story: Story): Promise<void> {
  const stories = await getStories();
  // 写入前统一成「秒」，避免 AI 创作故事（estimateDuration 按分钟）混进同一个数组
  const normalized = normalizeStoryDuration(story);
  const idx = stories.findIndex(s => s.id === normalized.id);
  if (idx >= 0) {
    stories[idx] = normalized;
  } else {
    stories.push(normalized);
  }
  await AsyncStorage.setItem(KEYS.STORIES, JSON.stringify(stories));
}

export async function getStories(): Promise<Story[]> {
  const raw = await AsyncStorage.getItem(KEYS.STORIES);
  if (!raw) return [];
  const list = JSON.parse(raw) as Story[];
  // 历史记录里 duration 可能是分钟（AI 创作故事），读取时统一折算成秒（见 storyDurationSec）
  return Array.isArray(list) ? list.map(normalizeStoryDuration) : [];
}

export async function getStory(id: string): Promise<Story | null> {
  const stories = await getStories();
  const found = stories.find(s => s.id === id);
  if (found) return found;

  const classicStory = CLASSIC_STORIES_DATA.find(s => s.id === id);
  if (classicStory) {
    const en = EN_MAP[classicStory.id];
    const hasEn = !!(en && en.content && en.content.trim().length > 0);
    return {
      id: classicStory.id,
      title: classicStory.title,
      titleEn: en?.title?.en ?? classicStory.title,
      content: classicStory.content,
      contentEn: hasEn ? en!.content : undefined,
      language: 'zh' as const,
      languages: hasEn ? (['zh', 'en'] as Language[]) : (['zh'] as Language[]),
      type: 'classic' as const,
      tags: classicStory.tags || [],
      duration: classicStory.duration || 0,
      createdAt: new Date().toISOString(),
    };
  }

  // 长篇原创故事（无版权）：id 形如 long-510-001 / long-1520-001，全部具备中英双语正文
  const longStory = LONG_STORIES_DATA.find(s => s.id === id);
  if (longStory) {
    return {
      id: longStory.id,
      title: longStory.title.zh,
      titleEn: longStory.title.en,
      content: longStory.content,
      contentEn: longStory.contentEn,
      language: 'zh' as const,
      languages: ['zh', 'en'] as Language[],
      type: 'classic' as const,
      tags: longStory.tags || [],
      duration: longStory.duration || 0,
      createdAt: new Date().toISOString(),
    };
  }
  return null;
}

export async function deleteStory(id: string): Promise<void> {
  const stories = await getStories();
  const filtered = stories.filter(s => s.id !== id);
  await AsyncStorage.setItem(KEYS.STORIES, JSON.stringify(filtered));
}

export async function saveProgress(progress: Progress): Promise<void> {
  await AsyncStorage.setItem(KEYS.PROGRESS, JSON.stringify(progress));
}

export async function getProgress(): Promise<Progress> {
  const raw = await AsyncStorage.getItem(KEYS.PROGRESS);
  if (!raw) return { ...DEFAULT_PROGRESS };
  try {
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PROGRESS,
      ...parsed,
      listenedStories: parsed.listenedStories || [],
      listenLog: parsed.listenLog || [],
      checkIns: parsed.checkIns || [],
      badges: parsed.badges || [],
    };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
}

export async function saveSensitiveWords(words: SensitiveWords): Promise<void> {
  await AsyncStorage.setItem(KEYS.SENSITIVE_WORDS, JSON.stringify(words));
}

export async function getSensitiveWords(): Promise<SensitiveWords> {
  const raw = await AsyncStorage.getItem(KEYS.SENSITIVE_WORDS);
  if (!raw) return { ...DEFAULT_SENSITIVE_WORDS };
  try {
    const parsed = JSON.parse(raw);
    return { words: parsed.words || [], phrases: parsed.phrases || [] };
  } catch {
    return { ...DEFAULT_SENSITIVE_WORDS };
  }
}

// ---- 家长密码（独立存储，避免与敏感词互相覆盖） ----
export async function saveParentPin(pin: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.PARENT_PIN, JSON.stringify({ pin, hasSetup: true }));
}

/**
 * 读取家长密码；兼容旧版本（pin 曾误存于 SENSITIVE_WORDS 中）做一次迁移。
 * 返回 null 表示尚未设置密码。
 */
export async function getParentPin(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(KEYS.PARENT_PIN);
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o.pin === 'string' && o.pin.length > 0) return o.pin;
    } catch {
      /* ignore */
    }
  }
  // 迁移：从旧 SENSITIVE_WORDS 中取出 pin
  try {
    const sw = await AsyncStorage.getItem(KEYS.SENSITIVE_WORDS);
    if (sw) {
      const o = JSON.parse(sw);
      if (o && typeof o.pin === 'string' && o.pin.length > 0) {
        await saveParentPin(o.pin);
        // 清掉旧对象中的 pin/hasSetup，避免与新存储混淆
        await saveSensitiveWords({ words: o.words || [], phrases: o.phrases || [] });
        return o.pin;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function isParentSetup(): Promise<boolean> {
  const pin = await getParentPin();
  return !!pin;
}

export async function saveVoiceSetting(voiceId: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.VOICE, voiceId);
}

/**
 * 故事朗读声线
 * ---------------------------------------------------------------------------
 * v81：提示音与故事朗读拆成两个独立设置（见下方 PROMPT_VOICE）。
 * 默认值从 'system' 改为内置大姐姐 'preset:cherry'——
 * iOS 中文离线语音只有「婷婷」一个，机械感重；内置音色中英文都能用、听感自然。
 * 家长端可随时改回手机系统语音或换成自己克隆的声音。
 */
export const DEFAULT_STORY_VOICE = 'preset:cherry';
export const DEFAULT_PROMPT_VOICE = 'preset:cherry';

export async function getVoiceSetting(): Promise<string> {
  const val = await AsyncStorage.getItem(KEYS.VOICE);
  // 老版本可能存过空串，统一兜到默认声音，避免上层拿到空值后静默降级
  return val && val.trim() ? val : DEFAULT_STORY_VOICE;
}

/** 提示音声线（提问、鼓励、状态播报等短句）：与故事声线互相独立 */
export async function savePromptVoiceSetting(voiceId: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.PROMPT_VOICE, voiceId);
}

export async function getPromptVoiceSetting(): Promise<string> {
  const val = await AsyncStorage.getItem(KEYS.PROMPT_VOICE);
  return val && val.trim() ? val : DEFAULT_PROMPT_VOICE;
}

/**
 * v82 一次性迁移：把「旧版本自动写入」的克隆声线清回默认
 * ---------------------------------------------------------------------------
 * 背景：v81 之前，只要克隆成功就会自动 `saveVoiceSetting(亲属key)`，把**故事朗读声**
 * 直接写成 'mom' / 'dad' / 'grandma'。家长并没有主动选过，但值被持久化了。
 * 于是老设备升到 v82 后，会出现「说是默认大姐姐，实际念故事还是妈妈的声音」，
 * 极易被误判为「声音体系没统一」。
 *
 * 规则（只在升级后第一次启动跑一次，之后用户的一切选择都会被尊重）：
 *   · rms_voice 若是克隆音色（非 preset: / 非 system）→ 删掉，回落默认内置大姐姐。
 *   · 提示音 rms_prompt_voice 是 v81 新增键，本来就没有历史值，不做处理。
 *
 * 注意：本函数只在启动时调用，v82 内用户克隆后自动写入的声线**不会**被它清掉
 * （迁移标记已置位，不会重复执行）。
 */
export async function migrateVoiceDefaultsOnce(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(KEYS.VOICE_DEFAULTS_V82);
    if (done === '1') return;
    const storyVoice = await AsyncStorage.getItem(KEYS.VOICE);
    const v = (storyVoice || '').trim();
    const isClone = !!v && v !== 'system' && !v.startsWith('preset:');
    if (isClone) await AsyncStorage.removeItem(KEYS.VOICE);
    await AsyncStorage.setItem(KEYS.VOICE_DEFAULTS_V82, '1');
  } catch {
    /* 迁移失败不阻塞启动，下次启动会再试 */
  }
}

/**
 * v92 一次性迁移：把「提示音声线」统一回默认内置大姐姐
 * ---------------------------------------------------------------------------
 * 需求（2026-11-04）：「所有的提示音的初始声音，全部默认用大姐姐的声音」。
 *
 * 背景：`rms_prompt_voice` 是 v81 新增键，但 v81 期间「克隆成功即自动写声线」的旧逻辑
 * 也会把它写成 mom/dad 之类的克隆值。老设备上于是出现「提示音突然变成妈妈的声音」，
 * 而家长从没主动选过——和 v82 修故事声线是同一类遗留问题。
 *
 * 规则（只跑一次）：
 *   · 存的是克隆音色（非 preset: / 非 system）→ 改回 DEFAULT_PROMPT_VOICE（大姐姐）。
 *   · 家长明确选过的内置样本音色 / 手机系统语音 → 原样保留，不覆盖用户选择。
 */
export async function migratePromptVoiceOnce(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(KEYS.PROMPT_VOICE_V92);
    if (done === '1') return;
    const cur = ((await AsyncStorage.getItem(KEYS.PROMPT_VOICE)) || '').trim();
    const isClone = !!cur && cur !== 'system' && !cur.startsWith('preset:');
    if (isClone) await AsyncStorage.setItem(KEYS.PROMPT_VOICE, DEFAULT_PROMPT_VOICE);
    await AsyncStorage.setItem(KEYS.PROMPT_VOICE_V92, '1');
  } catch {
    /* 迁移失败不阻塞启动，下次启动会再试 */
  }
}

/**
 * 「语音介绍今日推荐」开关（原「语音引导 / 开机提问」，提问卡片在 v95 已删除，
 * 这个开关保留下来只负责一件事：进入首页时用语音念一遍今天推荐的故事）。默认关闭。
 */
export async function getVoiceGuidance(): Promise<boolean> {
  const val = await AsyncStorage.getItem(KEYS.VOICE_GUIDANCE);
  return val === '1';
}

export async function setVoiceGuidance(on: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.VOICE_GUIDANCE, on ? '1' : '0');
}

/** 宝宝名字：家长自定义，首页问候会用它亲切称呼宝宝；空时回退默认 */
export async function getChildName(): Promise<string> {
  const val = await AsyncStorage.getItem(KEYS.CHILD_NAME);
  return val || '';
}

export async function setChildName(name: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.CHILD_NAME, name.trim());
}

/**
 * 账号显示名（用户在「我的账号」里自己改的称呼）。
 *
 * 说明：真正用来识别账号的是系统给的那一个（Apple 返回的姓名或邮箱前缀，
 * 见 useAuth.displayName），这里只是「我想被怎么叫」的本地偏好，
 * 所以存本地即可，不写进云端 metadata —— 换设备重新登录会回到系统名。
 */
export async function getAccountNickname(): Promise<string> {
  const val = await AsyncStorage.getItem(KEYS.ACCOUNT_NICKNAME);
  return val || '';
}

export async function setAccountNickname(name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed) await AsyncStorage.setItem(KEYS.ACCOUNT_NICKNAME, trimmed);
  else await AsyncStorage.removeItem(KEYS.ACCOUNT_NICKNAME);
}

/** 家长给孩子写的悄悄话（按故事 id 存） */
export async function saveParentComment(storyId: string, text: string): Promise<void> {
  const raw = await AsyncStorage.getItem(KEYS.PARENT_COMMENTS);
  const map: Record<string, ParentComment> = raw ? JSON.parse(raw) : {};
  map[storyId] = { text, updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(KEYS.PARENT_COMMENTS, JSON.stringify(map));
}

export async function getParentComment(storyId: string): Promise<ParentComment | null> {
  const raw = await AsyncStorage.getItem(KEYS.PARENT_COMMENTS);
  if (!raw) return null;
  const map: Record<string, ParentComment> = JSON.parse(raw);
  return map[storyId] ?? null;
}

// ---- 孩子提问（家长后台可见） ----
export async function getChildQAs(): Promise<ChildQA[]> {
  const raw = await AsyncStorage.getItem(KEYS.CHILD_QA);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveChildQA(qa: ChildQA): Promise<void> {
  const list = await getChildQAs();
  const next = [qa, ...list.filter((x) => x.id !== qa.id)].slice(0, 200);
  await AsyncStorage.setItem(KEYS.CHILD_QA, JSON.stringify(next));
}

// ---- 孩子选择题作答（家长后台可见） ----
export async function getChildQuizzes(): Promise<ChildQuiz[]> {
  const raw = await AsyncStorage.getItem(KEYS.CHILD_QUIZ);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveChildQuiz(q: ChildQuiz): Promise<void> {
  const list = await getChildQuizzes();
  const next = [q, ...list.filter((x) => x.id !== q.id)].slice(0, 200);
  await AsyncStorage.setItem(KEYS.CHILD_QUIZ, JSON.stringify(next));
}

// ---- 睡眠定时（家长端设置，防止孩子睡着后故事仍不停播放） ----
/** 睡眠定时分钟数：0 表示关闭（一直播放），默认 0 */
export async function getSleepTimerMinutes(): Promise<number> {
  const raw = await AsyncStorage.getItem(KEYS.SLEEP_TIMER_MINUTES);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

export async function setSleepTimerMinutes(min: number): Promise<void> {
  await AsyncStorage.setItem(KEYS.SLEEP_TIMER_MINUTES, String(min));
}

/** 到点后是否锁定屏幕（需家长密码才能继续播放），默认开启 */
export async function getSleepLockEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(KEYS.SLEEP_LOCK_ENABLED);
  if (raw === null) return true;
  return raw === '1' || raw === 'true';
}

export async function setSleepLockEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.SLEEP_LOCK_ENABLED, enabled ? '1' : '0');
}

// ---- 故事播放断点（v62 反馈 #2：锁屏/退出后回到播放页可接着听） ----
/**
 * 分片断点（v93 #1）：除了秒数，再记「第几片 + 片内第几秒」。
 * 秒数断点只能靠时长估算反推片位置，误差会随片数累积；片索引则与切分结果天然对齐。
 */
export type StoryPlace = { index: number; offset: number; total: number };
type StoryPositionMap = Record<string, { pos: number; at: number; chunk?: StoryPlace }>;

async function readPositions(): Promise<StoryPositionMap> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.STORY_POSITIONS);
    if (!raw) return {};
    const obj = JSON.parse(raw) as StoryPositionMap;
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

/**
 * 记录某篇故事听到第几秒；少于 3 秒视为「还没听进去」，直接清掉。
 * place 传 undefined = 保留原有分片断点；传 null = 清掉分片断点。
 */
export async function saveStoryPosition(
  storyId: string,
  posSeconds: number,
  place?: StoryPlace | null,
): Promise<void> {
  try {
    const map = await readPositions();
    if (!Number.isFinite(posSeconds) || posSeconds < 3) {
      delete map[storyId];
    } else {
      const prev = map[storyId];
      const chunk = place === undefined ? prev?.chunk : place ?? undefined;
      map[storyId] = {
        pos: Math.floor(posSeconds),
        at: Date.now(),
        ...(chunk ? { chunk } : {}),
      };
    }
    // 只留最近 60 篇，避免这份记录无限膨胀
    const kept = Object.entries(map)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 60);
    await AsyncStorage.setItem(KEYS.STORY_POSITIONS, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* 断点丢失不影响正常播放 */
  }
}

/** 读取某篇故事的断点秒数（没有则返回 0） */
export async function getStoryPosition(storyId: string): Promise<number> {
  const map = await readPositions();
  const v = map[storyId];
  return v && Number.isFinite(v.pos) && v.pos > 0 ? v.pos : 0;
}

/** 读取某篇故事的分片断点（片索引 + 片内秒；没有则返回 null） */
export async function getStoryPlace(storyId: string): Promise<StoryPlace | null> {
  const map = await readPositions();
  const c = map[storyId]?.chunk;
  if (!c || !Number.isFinite(c.index) || !Number.isFinite(c.total) || c.total <= 0) return null;
  return { index: c.index, offset: Number.isFinite(c.offset) ? c.offset : 0, total: c.total };
}

/** 清除断点（从头播放 / 听完时调用） */
export async function clearStoryPosition(storyId: string): Promise<void> {
  try {
    const map = await readPositions();
    if (!(storyId in map)) return;
    delete map[storyId];
    await AsyncStorage.setItem(KEYS.STORY_POSITIONS, JSON.stringify(map));
  } catch {
    /* 忽略 */
  }
}

// ---- 免费用户「1 次克隆体验」状态（会员不走这里，会员克隆不受限） ----
/**
 * v107 防白嫖：这组状态改为「服务端为准、本地做缓存」。
 * 原先只写 AsyncStorage —— 卸载重装 / 换机就把「1 次免费克隆」重置了。
 * 现在优先读 Supabase 的 user_rights（按 user_id 存），读不到（离线 / 未登录）才用本地。
 * ⚠️ 服务端说「已用过」优先于本地「没用过」：两个方向取「更严格」的那个。
 */
export async function getFreeCloneUsed(): Promise<boolean> {
  const local = await (async () => {
    try {
      return (await AsyncStorage.getItem(KEYS.FREE_CLONE_USED)) === '1';
    } catch {
      return false;
    }
  })();
  try {
    const rights = await getServerRights();
    if (rights) {
      // 服务端是权威：如果服务端说用过，把本地也补上（换机后本地是空的）
      if (rights.freeCloneUsed && !local) {
        try {
          await AsyncStorage.setItem(KEYS.FREE_CLONE_USED, '1');
        } catch {
          /* 忽略 */
        }
      }
      if (rights.freeCloneTarget) {
        try {
          const t = await AsyncStorage.getItem(KEYS.FREE_CLONE_TARGET);
          if (!t) await AsyncStorage.setItem(KEYS.FREE_CLONE_TARGET, rights.freeCloneTarget);
        } catch {
          /* 忽略 */
        }
      }
      if (rights.freeCloneStoryId) {
        try {
          const id = await AsyncStorage.getItem(KEYS.FREE_CLONE_STORY_ID);
          if (!id) await AsyncStorage.setItem(KEYS.FREE_CLONE_STORY_ID, rights.freeCloneStoryId);
        } catch {
          /* 忽略 */
        }
      }
      return rights.freeCloneUsed || local;
    }
  } catch {
    /* 服务端不可用：退回本地 */
  }
  return local;
}

/**
 * 标记「免费克隆已用掉」。
 * 优先在服务端原子占用那一次机会（并发 / 多设备都不会超发），失败才只写本地。
 */
export async function setFreeCloneUsed(used: boolean, target?: string): Promise<void> {
  try {
    if (used) {
      const claimed = await claimFreeCloneOnServer(target ?? '');
      if (claimed === false) {
        // 服务端说这次机会已经被用掉了（别的设备先用了）——本地也标记，别让界面误以为还能用
        await AsyncStorage.setItem(KEYS.FREE_CLONE_USED, '1');
        return;
      }
      await AsyncStorage.setItem(KEYS.FREE_CLONE_USED, '1');
    } else {
      await AsyncStorage.removeItem(KEYS.FREE_CLONE_USED);
    }
  } catch {
    /* 忽略 */
  }
}

/** 免费用户克隆声专属的「唯一 1 篇」短故事 id（为空 = 还没选） */
export async function getFreeCloneStoryId(): Promise<string> {
  try {
    const rights = await getServerRights();
    if (rights?.freeCloneStoryId) {
      try {
        await AsyncStorage.setItem(KEYS.FREE_CLONE_STORY_ID, rights.freeCloneStoryId);
      } catch {
        /* 忽略 */
      }
      return rights.freeCloneStoryId;
    }
  } catch {
    /* 服务端不可用：退回本地 */
  }
  try {
    return (await AsyncStorage.getItem(KEYS.FREE_CLONE_STORY_ID)) || '';
  } catch {
    return '';
  }
}

export async function setFreeCloneStoryId(id: string): Promise<void> {
  try {
    if (id) {
      await AsyncStorage.setItem(KEYS.FREE_CLONE_STORY_ID, id);
      await setFreeCloneStoryOnServer(id);
    } else {
      await AsyncStorage.removeItem(KEYS.FREE_CLONE_STORY_ID);
    }
  } catch {
    /* 忽略 */
  }
}

/** 免费用户克隆所用的对象（mom/dad/custom:xxx），故事页据此默认克隆声 */
export async function getFreeCloneTarget(): Promise<string> {
  try {
    const rights = await getServerRights();
    if (rights?.freeCloneTarget) {
      try {
        await AsyncStorage.setItem(KEYS.FREE_CLONE_TARGET, rights.freeCloneTarget);
      } catch {
        /* 忽略 */
      }
      return rights.freeCloneTarget;
    }
  } catch {
    /* 服务端不可用：退回本地 */
  }
  try {
    return (await AsyncStorage.getItem(KEYS.FREE_CLONE_TARGET)) || '';
  } catch {
    return '';
  }
}

export async function setFreeCloneTarget(target: string): Promise<void> {
  try {
    if (target) await AsyncStorage.setItem(KEYS.FREE_CLONE_TARGET, target);
    else await AsyncStorage.removeItem(KEYS.FREE_CLONE_TARGET);
  } catch {
    /* 忽略 */
  }
}

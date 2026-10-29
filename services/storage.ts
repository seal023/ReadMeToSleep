import AsyncStorage from '@react-native-async-storage/async-storage';
import { Story, Progress, SensitiveWords } from '../types';
// 经典故事正文：100 篇公共版权故事，按 25 篇一册分卷存放
import classic1 from '../data/classic-stories/zh/1-25.json';
import classic2 from '../data/classic-stories/zh/26-50.json';
import classic3 from '../data/classic-stories/zh/51-75.json';
import classic4 from '../data/classic-stories/zh/76-100.json';

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

const KEYS = {
  STORIES: 'rms_stories',
  PROGRESS: 'rms_progress',
  SENSITIVE_WORDS: 'rms_sensitive_words',
  PARENT_PIN: 'rms_parent_pin',
  VOICE: 'rms_voice',
  PARENT_COMMENTS: 'rms_parent_comments',
  VOICE_GUIDANCE: 'rms_voice_guidance',
  CHILD_NAME: 'rms_child_name',
  CHILD_QA: 'rms_child_qa',
};

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
  const idx = stories.findIndex(s => s.id === story.id);
  if (idx >= 0) {
    stories[idx] = story;
  } else {
    stories.push(story);
  }
  await AsyncStorage.setItem(KEYS.STORIES, JSON.stringify(stories));
}

export async function getStories(): Promise<Story[]> {
  const raw = await AsyncStorage.getItem(KEYS.STORIES);
  return raw ? JSON.parse(raw) : [];
}

export async function getStory(id: string): Promise<Story | null> {
  const stories = await getStories();
  const found = stories.find(s => s.id === id);
  if (found) return found;

  const classicStory = CLASSIC_STORIES_DATA.find(s => s.id === id);
  if (classicStory) {
    return {
      id: classicStory.id,
      title: classicStory.title,
      content: classicStory.content,
      language: 'zh' as const,
      type: 'classic' as const,
      tags: classicStory.tags || [],
      duration: classicStory.duration || 0,
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

export async function getVoiceSetting(): Promise<string> {
  const val = await AsyncStorage.getItem(KEYS.VOICE);
  return val || 'system';
}

/** 语音引导（开机提问）开关：默认关闭 */
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

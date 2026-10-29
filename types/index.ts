export type RaccoState = 'idle' | 'talking' | 'listening' | 'thinking' | 'happy' | 'sleeping';

export const ChildTitle = [
  'Little Star',
  'Champion',
  'Adventurer',
  'Dreamer',
  'Storyteller',
  'Sweetie'
] as const;

export type ChildTitleType = typeof ChildTitle[number];

export type Language = 'zh' | 'en';
export type TabName = 'home' | 'create' | 'library' | 'my-stories' | 'settings';

export interface Story {
  id: string;
  title: string;
  content: string;
  /** 英文正文：经典故事双语化后填充，AI 生成故事为空 */
  contentEn?: string;
  /** 英文标题：与 contentEn 配套，英文界面下使用 */
  titleEn?: string;
  /** 该故事实际可用的语言（经典故事有英文后同时含 zh/en） */
  languages?: Language[];
  language: Language;
  type: 'classic' | 'ai_generated' | 'travel';
  tags: string[];
  duration: number;
  voiceId?: string;
  location?: string;
  createdAt: string;
  isPlayed?: boolean;
  isLiked?: boolean;
  audioUri?: string;
}

export interface ListenLogEntry {
  id: string;
  title: string;
  at: string; // ISO 时间戳，用于今日/历史列表与按月聚合
}

export interface Progress {
  listenedStories: string[];
  listenLog: ListenLogEntry[];
  checkIns: { location: string; date: string; storyId: string }[];
  badges: string[];
  streakDays: number;
  lastListenDate: string;
}

export interface SensitiveWords {
  words: string[];
  phrases: string[];
}

export interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

export type LocaleDict = Record<string, string>;

export interface GenerateStoryParams {
  theme: string;
  protagonist: string;
  details: string;
  language: Language;
  sensitiveWords?: string[];
}

export interface StoryGenerateResult {
  title: string;
  content: string;
  duration: number;
  /** true = 本次结果来自本地兜底故事库（AI 不可用），UI 可据此提示 */
  fallback?: boolean;
}
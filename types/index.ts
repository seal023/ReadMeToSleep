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

export interface Progress {
  listenedStories: string[];
  checkIns: { location: string; date: string; storyId: string }[];
  badges: string[];
  streakDays: number;
  lastListenDate: string;
}

export interface SensitiveWords {
  words: string[];
  phrases: string[];
  hasSetup?: boolean;
  pin?: string;
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
}
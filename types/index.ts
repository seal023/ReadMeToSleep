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
  type: 'classic' | 'ai_generated' | 'travel' | 'recorded';
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
  /** 语言是否已从存储/系统完成初始化；UI 应在 hydrated 后才做语言相关的一次性动作（如开机问候） */
  hydrated: boolean;
}

/**
 * 语言包结构：多数文案是扁平点号 key（如 "app.name"），
 * 少数按模块嵌套（如 sleep.locked.title / privacy.* / record.*）。
 * 故允许任意层级的嵌套对象，t() 会先按扁平 key 直取、再按点号逐层下钻。
 */
export type LocaleValue = string | { [key: string]: LocaleValue };
export type LocaleDict = Record<string, LocaleValue>;

/** 故事时长分级：short 3-4 分钟 / medium 10-15 分钟 / long 20-30 分钟 */
export type StoryLength = 'short' | 'medium' | 'long';

export interface GenerateStoryParams {
  theme: string;
  protagonist: string;
  details: string;
  language: Language;
  /** 时长分级，默认 short */
  length?: StoryLength;
  sensitiveWords?: string[];
  /**
   * 入口标识，仅用于埋点（create / travel …），不参与额度判断。
   */
  source?: string;
  /**
   * 是否把这次「真实云端生成」计入当日生成额度，默认 true。
   * ⚠️ 只有自带独立额度体系的功能才允许传 false（目前仅旅行打卡，它走打卡次数）。
   */
  countQuota?: boolean;
  /**
   * 调用方是否已经「不要这个结果了」（v105）。
   * -----------------------------------------------------------------------
   * 弱网/跨洋链路下，UI 侧 60 秒硬超时先返回、底层请求却在 65 秒才成功，
   * 于是「界面已经提示超时，额度却被扣掉一次」——用户视角是「超时还扣次数」。
   * UI 在超时那一刻把标志置 true，服务层记账前问一次，就能保证：
   * 界面判定失败的那一次，永远不扣当日次数。
   */
  isCancelled?: () => boolean;
}

export interface StoryGenerateResult {
  title: string;
  content: string;
  duration: number;
  /** true = 本次结果来自本地兜底故事库（AI 不可用），UI 可据此提示 */
  fallback?: boolean;
  /**
   * 本次结果的真实来源。**扣当日额度的唯一依据是 origin === 'cloud'**：
   *   cloud    真正调用了云端 AI（消耗 token）→ 唯一应扣次数的情形
   *   cache    命中本地故事缓存 → 不扣次数、不联网
   *   fallback 本地兜底故事库（无网 / 额度已满 / Key 未配置）→ 不扣次数
   */
  origin?: 'cloud' | 'cache' | 'fallback';
  /** fallback 的原因：quota=当日额度已满，error=请求失败/无网/未配置 */
  fallbackReason?: 'quota' | 'error';
}
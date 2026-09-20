/**
 * 奖励机制 —— 等级 / 勋章规则（需求 5）
 *
 * 设计原则（面向 3-8 岁孩子）：
 *  1. 奖励要「够得着」：前几天就能连续升级，避免长时间没反馈。
 *  2. 全部用图标 + 短名字表达，不依赖识字。
 *  3. 等级由已听完的故事数推导，不额外存冗余字段，
 *     避免 AsyncStorage 里的数据与推算结果不一致。
 */

export interface LevelRule {
  level: number;
  /** 等级名（中文） */
  name: string;
  nameEn: string;
  emoji: string;
  /** 升到本级所需累计听完的故事数 */
  need: number;
}

/** 等级阶梯：前几级门槛很低，让孩子很快获得第一次升级的正反馈 */
export const LEVELS: LevelRule[] = [
  { level: 1, name: '故事小种子', nameEn: 'Little Seed', emoji: '🌱', need: 0 },
  { level: 2, name: '好奇小芽', nameEn: 'Curious Sprout', emoji: '🌿', need: 3 },
  { level: 3, name: '勇敢小树', nameEn: 'Brave Tree', emoji: '🌳', need: 8 },
  { level: 4, name: '智慧小鸟', nameEn: 'Wise Bird', emoji: '🐦', need: 15 },
  { level: 5, name: '星空旅人', nameEn: 'Star Traveler', emoji: '✨', need: 25 },
  { level: 6, name: '故事大王', nameEn: 'Story King', emoji: '👑', need: 40 },
  { level: 7, name: '月亮守护者', nameEn: 'Moon Guardian', emoji: '🌙', need: 60 },
];

export interface BadgeRule {
  id: string;
  emoji: string;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  /** 达成判定 */
  test: (s: RewardInput) => boolean;
}

export interface RewardInput {
  listenedCount: number;
  streakDays: number;
  checkInCount: number;
}

/** 勋章。id 会存进 Progress.badges，勿随意改名，否则老用户已获得的会失效 */
export const BADGES: BadgeRule[] = [
  {
    id: 'first_story',
    emoji: '🎉',
    name: '第一个故事',
    nameEn: 'First Story',
    desc: '听完第一个故事',
    descEn: 'Finish your first story',
    test: (s) => s.listenedCount >= 1,
  },
  {
    id: 'story_10',
    emoji: '📚',
    name: '小小书虫',
    nameEn: 'Bookworm',
    desc: '累计听完 10 个故事',
    descEn: 'Finish 10 stories',
    test: (s) => s.listenedCount >= 10,
  },
  {
    id: 'story_30',
    emoji: '🏆',
    name: '故事达人',
    nameEn: 'Story Master',
    desc: '累计听完 30 个故事',
    descEn: 'Finish 30 stories',
    test: (s) => s.listenedCount >= 30,
  },
  {
    id: 'streak_3',
    emoji: '🔥',
    name: '连续三天',
    nameEn: '3-Day Streak',
    desc: '连续 3 天听故事',
    descEn: 'Listen 3 days in a row',
    test: (s) => s.streakDays >= 3,
  },
  {
    id: 'streak_7',
    emoji: '⭐',
    name: '一周不断',
    nameEn: '7-Day Streak',
    desc: '连续 7 天听故事',
    descEn: 'Listen 7 days in a row',
    test: (s) => s.streakDays >= 7,
  },
  {
    id: 'travel_3',
    emoji: '🗺️',
    name: '小小旅行家',
    nameEn: 'Little Traveler',
    desc: '在 3 个地方打过卡',
    descEn: 'Check in at 3 places',
    test: (s) => s.checkInCount >= 3,
  },
];

/** 根据已听完故事数算出当前等级 */
export function getLevel(listenedCount: number): LevelRule {
  let current = LEVELS[0];
  for (const lv of LEVELS) {
    if (listenedCount >= lv.need) current = lv;
    else break;
  }
  return current;
}

/** 下一个等级；已满级返回 null */
export function getNextLevel(listenedCount: number): LevelRule | null {
  return LEVELS.find((lv) => lv.need > listenedCount) ?? null;
}

/** 距离下一级的进度，0-1。已满级返回 1 */
export function getLevelProgress(listenedCount: number): number {
  const cur = getLevel(listenedCount);
  const next = getNextLevel(listenedCount);
  if (!next) return 1;
  const span = next.need - cur.need;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (listenedCount - cur.need) / span));
}

/**
 * 计算应当新解锁的勋章（排除已获得的）。
 * story/[id].tsx 听完故事、travel-checkin 打卡成功后各调一次。
 */
export function getNewBadges(input: RewardInput, owned: string[]): BadgeRule[] {
  return BADGES.filter((b) => !owned.includes(b.id) && b.test(input));
}

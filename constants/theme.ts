/**
 * 卡通主题系统（需求 二、UI 设计风格）
 *
 * 设计目标：可爱、卡通、温暖，像儿童绘本
 *  - 配色：暖色调为主（橙 / 粉 / 淡紫 / 天蓝），柔和渐变背景
 *  - 字体：圆体 / 手写风格，大字号，方便孩子阅读
 *  - 按钮：大圆角 + 弹性按压动画（见 components/ui/CartoonButton）
 *  - 元素：星星 / 月亮 / 云朵等卡通装饰（见 components/ui/SkyDecor）
 *  - 插图：每个故事配卡通封面（渐变 + emoji，见 COVER_PRESETS）
 *
 * 统一从这里取值，避免各页面颜色/圆角不一致。
 */

import { Platform, ViewStyle } from 'react-native';

// ── 配色（暖色调、柔和不刺眼）────────────────────────────
export const COLORS = {
  // 主色系
  orange: '#FF9A56',
  orangeLight: '#FFC79A',
  pink: '#FF8FA8',
  pinkLight: '#FFC2CE',
  purple: '#B794F4',
  purpleLight: '#DDCBFF',
  skyBlue: '#7FC8F8',
  skyBlueLight: '#BFEBFF',
  mint: '#7BD8BE',
  mintLight: '#C2F1E4',
  yellow: '#FFCB5C',
  yellowLight: '#FFE7AC',

  // 背景 / 卡片
  cream: '#FFF6EC',
  card: '#FFFFFF',
  cardSoft: '#FFF9F2',

  // 文字
  text: '#6B4F3F', // 暖棕，比纯黑柔和
  textSub: '#9C8579',
  textLight: '#B9A79C',
  white: '#FFFFFF',

  // 功能色
  divider: '#F0E4D8',
  shadow: '#8A6A55',
} as const;

// ── 柔和渐变预设（背景 / 封面通用）────────────────────────
export type GradientStops = readonly string[];

export const GRADIENTS = {
  /** 白天：奶油 → 粉 → 天蓝（默认主背景） */
  day: ['#FFF6EC', '#FFE8EE', '#DDEEFF'],
  /** 黄昏：暖橙 → 粉 → 淡紫 */
  sunset: ['#FFE9C7', '#FFD3E0', '#DCC6FF'],
  /** 糖果：粉 → 淡紫 */
  candy: ['#FFD9E8', '#E8D5FF', '#D6E4FF'],
  /** 夜空：深紫蓝 → 紫（睡前氛围） */
  night: ['#3B3163', '#574A87', '#7A6AA8'],
  /** 晴空：浅蓝 → 白 */
  sky: ['#DCEEFF', '#EFF7FF', '#FFF6EC'],
  /** 草地：薄荷 → 奶油 */
  meadow: ['#DFF5EC', '#F2FBFF', '#FFF6EC'],
} satisfies Record<string, GradientStops>;

// ── 故事封面预设（渐变 + 卡通 emoji 插画）─────────────────
export interface CoverPreset {
  gradient: GradientStops;
  emoji: string;
}

export const COVER_PRESETS: CoverPreset[] = [
  { gradient: ['#FFD9A0', '#FFB877'], emoji: '🦊' }, // 狐狸 - 橙
  { gradient: ['#FFC2CE', '#FF9FB2'], emoji: '🐰' }, // 兔子 - 粉
  { gradient: ['#DDCBFF', '#B794F4'], emoji: '🐻' }, // 小熊 - 紫
  { gradient: ['#BFEBFF', '#7FC8F8'], emoji: '🐳' }, // 鲸鱼 - 蓝
  { gradient: ['#C2F1E4', '#7BD8BE'], emoji: '🐸' }, // 青蛙 - 薄荷
  { gradient: ['#FFE7AC', '#FFCB5C'], emoji: '🦁' }, // 狮子 - 黄
  { gradient: ['#FFD8E4', '#C9B6FF'], emoji: '🦄' }, // 独角兽
  { gradient: ['#D7F0FF', '#A8D8FF'], emoji: '🐧' }, // 企鹅
];

/** 依据 id / 标题稳定地挑选一个封面预设（同一故事每次一致） */
export function pickCover(seed: string): CoverPreset {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return COVER_PRESETS[h % COVER_PRESETS.length];
}

// ── 圆角（圆润、柔和）───────────────────────────────────
export const RADIUS = {
  sm: 12,
  md: 18,
  lg: 26,
  xl: 34,
  pill: 999,
} as const;

// ── 字体（圆体 / 手写风格 + 大字号）───────────────────────
// 注：中文字形会回退到系统字体（PingFang），圆体主要作用于拉丁字符与数字；
//     若后续要中文也变圆体，需内嵌一份圆体字体文件（体积较大），此处先留位。
export const FONT = {
  rounded: Platform.OS === 'ios' ? 'Chalkboard SE' : 'sans-serif-rounded',
  hand: Platform.OS === 'ios' ? 'American Typewriter' : 'casual',
  system: Platform.OS === 'ios' ? 'System' : 'sans-serif',
} as const;

/** 大字号，方便孩子阅读 */
export const FONT_SIZE = {
  hero: 30,
  title: 24,
  section: 20,
  body: 17,
  button: 18,
  caption: 14,
  tiny: 12,
} as const;

// ── 间距 ───────────────────────────────────────────────
export const SPACING = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
} as const;

// ── 柔和阴影（暖色投影，不用死黑）─────────────────────────
// 注意：不要加 as const，否则 shadowOffset 变成 readonly，无法赋给 ViewStyle
export const SHADOW: Record<'soft' | 'card' | 'button', ViewStyle> = {
  soft: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  card: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 6,
  },
  button: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 5,
  },
};

/** 卡通装饰元素（星星 / 月亮 / 云朵） */
export const DECOR = {
  stars: ['⭐', '✨', '🌟'],
  moon: '🌙',
  clouds: ['☁️', '🌤️'],
  animals: ['🦊', '🐰', '🐻', '🦁', '🐼', '🦉'],
} as const;

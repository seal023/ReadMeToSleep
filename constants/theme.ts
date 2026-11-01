/**
 * 卡通主题系统（需求 二、UI 设计风格）
 *
 * 设计目标：可爱、卡通、温暖，像儿童绘本
 *  - 配色：马卡龙糖果色 + 暖白背景（色盘定义在 constants/Colors.ts）
 *  - 字体：站酷快乐体（中文字形圆润），大字号，留白充足
 *  - 按钮：胶囊大圆角 + 弹簧回弹 + 震动反馈（components/ui/CartoonButton）
 *  - 元素：星星 / 月亮 / 云朵等卡通装饰（components/ui/SkyDecor）
 *  - 插图：每个故事配卡通封面（渐变 + emoji，见 COVER_PRESETS）
 *
 * ⚠️ 色值不要在这里重定义：统一从 ./Colors 取，改色只改一个文件。
 */

import { Platform, ViewStyle } from 'react-native';
import { COLORS, CANDY, CANDY_GRADIENTS } from './Colors';

// 转出去，历史代码里的 `import { COLORS } from '@/constants/theme'` 继续有效
export { COLORS, CANDY };

// ── 柔和渐变预设（背景 / 封面通用）────────────────────────
export type GradientStops = readonly string[];

export const GRADIENTS = {
  /** 白天：奶油 → 淡粉 → 蜜桃（默认主背景，替代死白） */
  day: CANDY_GRADIENTS.cream,
  /** 黄昏：蜜桃 → 草莓 → 葡萄 */
  sunset: ['#FFF0E2', '#FFE0EC', '#E8DCFB'],
  /** 糖果：草莓 → 葡萄 */
  candy: CANDY_GRADIENTS.berry,
  /** 夜空：柔化后的紫蓝（睡前氛围，仍需暗底以保护夜视） */
  night: ['#4A4166', '#5E548A', '#7C6EA8'],
  /** 晴空：淡蓝 → 暖白 */
  sky: CANDY_GRADIENTS.sky,
  /** 草地：薄荷 → 暖白 */
  meadow: CANDY_GRADIENTS.mint,
  /** 葡萄糖果 */
  grape: CANDY_GRADIENTS.grape,
  /** 蜜桃气泡 */
  peach: CANDY_GRADIENTS.peach,
} satisfies Record<string, GradientStops>;

// ── 故事封面预设（渐变 + 卡通 emoji 插画）─────────────────
export interface CoverPreset {
  gradient: GradientStops;
  emoji: string;
}

export const COVER_PRESETS: CoverPreset[] = [
  { gradient: ['#FFD9C2', '#F7A072'], emoji: '🦊' }, // 狐狸 - 蜜桃
  { gradient: ['#FFD6E4', '#EE7EA4'], emoji: '🐰' }, // 兔子 - 草莓
  { gradient: ['#E2D8FB', '#9B7EDE'], emoji: '🐻' }, // 小熊 - 葡萄
  { gradient: ['#D3EAFB', '#7FBEEB'], emoji: '🐳' }, // 鲸鱼 - 天空
  { gradient: ['#D2F2E6', '#5FC3A4'], emoji: '🐸' }, // 青蛙 - 薄荷
  { gradient: ['#FFEFC2', '#FFD166'], emoji: '🦁' }, // 狮子 - 柠檬
  { gradient: ['#FFDCE9', '#C9B6F5'], emoji: '🦄' }, // 独角兽
  { gradient: ['#E4F1FD', '#A8D8FF'], emoji: '🐧' }, // 企鹅
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

// ── 圆角（全部放大，拒绝直角）─────────────────────────────
export const RADIUS = {
  /** 小标签 / 角标 */
  xs: 14,
  sm: 18,
  /** 输入框、小卡片 */
  md: 24,
  /** 主卡片 */
  lg: 28,
  /** 大面板 */
  xl: 36,
  /** 胶囊 */
  pill: 999,
} as const;

// ── 字体 ───────────────────────────────────────────────
// rounded = 站酷快乐体，由 app/_layout.tsx 用 useFonts 动态加载。
// 若字体尚未加载完成，React Native 会自动回落到系统字体，不会白屏。
export const FONT = {
  rounded: 'ZCOOLKuaiLe_400Regular',
  /** 系统圆体，用于需要更中性的正文（站酷快乐体偏展示体，长段落用系统更易读） */
  body: Platform.OS === 'ios' ? 'PingFang SC' : 'sans-serif',
  system: Platform.OS === 'ios' ? 'System' : 'sans-serif',
} as const;

/** 字号整体上调，方便孩子看清 */
export const FONT_SIZE = {
  hero: 32,
  title: 26,
  section: 22,
  body: 18,
  button: 19,
  caption: 15,
  tiny: 13,
} as const;

// ── 间距（留白更足）─────────────────────────────────────
export const SPACING = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
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
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
  },
  button: {
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
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

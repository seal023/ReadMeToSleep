/**
 * constants/clayStyle.ts — Claymorphism（3D 粘土质感）样式工具
 * ===========================================================================
 * 目标：让 App 里的「控件」和小浣熊、粘土图标处在同一个世界里。
 * 全 App 儿童端统一用这套样式，父母端保持原样（用户明确要求）。
 *
 * 粘土质感的四个要素（缺一不可，否则就会显得"平"）：
 *   1. 厚圆角          —— RADIUS（24~36），拒绝小圆角
 *   2. 顶部内高光      —— inset 白色，模拟软陶受光的亮边
 *   3. 底部内阴影      —— inset 暖色，模拟背光的厚度
 *   4. 柔和外投影      —— 暖色大扩散，像一块软陶"浮"在背景上
 *
 * 为什么用 boxShadow 字符串而不是 shadowColor/elevation：
 *   RN 0.76+（本项目 SDK 57 / RN 0.86）支持 CSS boxShadow，且支持 inset，
 *   只有它能做"内高光"这一层——elevation 做不到。同时保留 elevation 作为
 *   Android 兜底（Android 对 inset boxShadow 支持有限，会退化成普通投影，可接受）。
 *
 * 投影颜色跟随当前主题 COLORS.shadow（启动时读取，切主题下次启动生效），
 * 这样糖果/森林/星空/樱花四套皮肤下粘土阴影都是协调的暖色，不会发死黑。
 */

import type { ViewStyle } from 'react-native';
import { COLORS } from './Colors';
import { RADIUS } from './theme';

/** #RRGGBB → "r, g, b"，用于拼 rgba() boxShadow */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (Number.isNaN(n)) return '138, 106, 85'; // 兜底：糖果系 shadow
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

const SR = hexToRgb(COLORS.shadow);

/**
 * 粘土 boxShadow 预设。全部为「内高光 + 内阴影 + 外投影」组合。
 * 需要按下态时用 pressed（内凹），松手回到 surface。
 */
export const CLAY_SHADOW = {
  /** 通用凸起块：卡片、输入框、Tab */
  surface: `inset 0 2px 3px rgba(255,255,255,0.95), inset 0 -3px 6px rgba(${SR},0.10), 0 6px 14px rgba(${SR},0.16)`,
  /** 小控件：胶囊、标签、小按钮 */
  small: `inset 0 1px 2px rgba(255,255,255,0.9), inset 0 -2px 4px rgba(${SR},0.08), 0 3px 7px rgba(${SR},0.13)`,
  /** 大面板：筛选弹层顶部 */
  large: `inset 0 3px 4px rgba(255,255,255,0.8), 0 -10px 26px rgba(${SR},0.20)`,
  /** 按下态：内凹（配合 activeOpacity 使用） */
  pressed: `inset 0 3px 7px rgba(${SR},0.20), 0 1px 2px rgba(${SR},0.08)`,
  /** 高亮/选中态：暖色外发光 + 保留凸起 */
  active: `inset 0 2px 3px rgba(255,255,255,0.9), inset 0 -2px 5px rgba(${SR},0.10), 0 4px 12px rgba(${SR},0.26)`,
  /**
   * The "content area" of a frame/window: a recessed glass surface.
   * Dark inner shadow at the top + light inner highlight at the bottom, mimicking looking through a thick clay frame.
   */
  inset: `inset 0 4px 9px rgba(${SR},0.20), inset 0 -2px 3px rgba(255,255,255,0.9)`,
} as const;

/** 卡片 / 面板的粘土底（暖白 + 大圆角 + 立体投影） */
export const clayCard: ViewStyle = {
  backgroundColor: COLORS.cardSoft,
  borderRadius: RADIUS.lg,
  boxShadow: CLAY_SHADOW.surface,
  elevation: 5,
};

/** 输入框的粘土底 */
export const clayInput: ViewStyle = {
  backgroundColor: COLORS.cardSoft,
  borderRadius: RADIUS.md,
  boxShadow: CLAY_SHADOW.surface,
  elevation: 4,
};

/** 胶囊 / 分类标签的粘土底（未选中） */
export const clayChip: ViewStyle = {
  backgroundColor: COLORS.cardSoft,
  borderRadius: RADIUS.pill,
  boxShadow: CLAY_SHADOW.small,
  elevation: 3,
};

/** 胶囊选中态：主色填充 + 暖色发光 */
export const clayChipActive: ViewStyle = {
  backgroundColor: COLORS.orange,
  borderRadius: RADIUS.pill,
  boxShadow: CLAY_SHADOW.active,
  elevation: 4,
};

/** 小标签（时长 / 分类文字底）的粘土底 */
export const clayBadge: ViewStyle = {
  backgroundColor: COLORS.orangeLight,
  borderRadius: RADIUS.xs,
  boxShadow: CLAY_SHADOW.small,
};

/**
 * 需要"和某个具体底色配套的粘土块"时用这个工厂函数。
 * 例：选中态想用 accentSoft 底，就 claySurface(COLORS.pinkLight, 'small')。
 */
export function claySurface(bg: string, shadow: keyof typeof CLAY_SHADOW = 'surface'): ViewStyle {
  return {
    backgroundColor: bg,
    boxShadow: CLAY_SHADOW[shadow],
    elevation: shadow === 'large' ? 6 : shadow === 'small' ? 3 : 5,
  };
}

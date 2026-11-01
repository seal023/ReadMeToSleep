/**
 * constants/Colors.ts — 全 App 唯一的糖果色盘（马卡龙配色）
 *
 * 设计原则（2026-11 视觉升级）：
 *  1. 暖白打底：不用死白 #FFFFFF，用奶油白 #FDF9F3，眼睛更舒服，也更像绘本纸。
 *  2. 马卡龙糖果色：低饱和、高亮度、彼此之间和谐，避免刺眼的正红正紫。
 *  3. 文字不用纯黑：统一深咖啡 #3D3229，比 #000 柔和，长文阅读不扎眼。
 *  4. 全部大圆角：见 constants/theme.ts 的 RADIUS。
 *
 * ⚠️ 用法约定：
 *  - 业务代码请尽量只从 COLORS 取语义色（text / card / cream …），
 *    这样将来整体换肤只改这一个文件。
 *  - CANDY 是「裸色板」，用于需要强调的局部（勋章、标签、插画底色）。
 *  - 不要再在页面里硬编码 #xxxxxx 颜色（历史遗留的会逐步清掉）。
 */

// ── 裸色板：马卡龙糖果色 ────────────────────────────────
export const CANDY = {
  /** 蜜桃橙 —— 主行动色 */
  peach: '#F7A072',
  peachSoft: '#FFD9C2',
  /** 草莓粉 —— 强调 / 收藏 */
  berry: '#EE7EA4',
  berrySoft: '#FFD6E4',
  /** 葡萄紫 —— 次行动色（原 #6c5ce7 系） */
  grape: '#9B7EDE',
  grapeSoft: '#E2D8FB',
  /** 天空蓝 —— 信息 / 旅行 */
  sky: '#7FBEEB',
  skySoft: '#D3EAFB',
  /** 薄荷绿 —— 成功 / 已完成 */
  mint: '#5FC3A4',
  mintSoft: '#D2F2E6',
  /** 柠檬黄 —— 提示 / 星星 */
  lemon: '#FFD166',
  lemonSoft: '#FFEFC2',
  /** 珊瑚 —— 危险 / 删除 */
  coral: '#F2827F',
  coralSoft: '#FFDCDA',
} as const;

// ── 语义色：业务代码主要用这组 ──────────────────────────
export const COLORS = {
  // 主色系（保留旧键名，避免大量页面改动）
  orange: CANDY.peach,
  orangeLight: CANDY.peachSoft,
  pink: CANDY.berry,
  pinkLight: CANDY.berrySoft,
  purple: CANDY.grape,
  purpleLight: CANDY.grapeSoft,
  skyBlue: CANDY.sky,
  skyBlueLight: CANDY.skySoft,
  mint: CANDY.mint,
  mintLight: CANDY.mintSoft,
  yellow: CANDY.lemon,
  yellowLight: CANDY.lemonSoft,

  // 背景 / 卡片：暖白而非死白
  cream: '#FDF9F3',
  card: '#FFFFFF',
  cardSoft: '#FFFCF7',

  // 文字：深咖啡，而非纯黑
  text: '#3D3229',
  textSub: '#7A6A5D',
  textLight: '#A8988A',
  white: '#FFFFFF',

  // 功能色
  divider: '#F2E8DC',
  shadow: '#8A6A55',
  danger: CANDY.coral,
  success: CANDY.mint,
} as const;

/** 背景渐变（暖调，替代大面积纯色） */
export const CANDY_GRADIENTS = {
  /** 奶油白 → 淡粉（默认主背景） */
  cream: ['#FDF9F3', '#FFF1F4', '#FDEFE3'],
  /** 草莓奶昔 */
  berry: ['#FFF1F5', '#FFE3EC', '#FFD9C9'],
  /** 蜜桃气泡 */
  peach: ['#FFF4EC', '#FFE6D5', '#FFD9C2'],
  /** 薄荷苏打 */
  mint: ['#F2FBF6', '#DDF4EA', '#FDEFE3'],
  /** 蓝莓酸奶 */
  sky: ['#EFF7FE', '#DDEEFB', '#FDF9F3'],
  /** 葡萄糖果 */
  grape: ['#F7F2FF', '#E9DFFB', '#FDEFF4'],
} as const;

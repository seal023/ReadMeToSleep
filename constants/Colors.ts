/**
 * constants/Colors.ts — 全 App 唯一的色盘（马卡龙糖果风）+ 4 套全局预设主题
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
 *
 * ── 主题切换（2026-11 新增，2026-11-01 接入设置界面）──────────────
 *  下方 THEMES 里预置 4 套完整色盘：candy（糖果系，默认）/ forest（森林系）
 *  / starry（星空系）/ sakura（樱花系）。
 *
 *  用户在「家长模式 → 🎨 界面配色」里选择，选择结果同步写入
 *  Documents/ui-theme.txt；**App 下次启动时**在模块加载阶段读出来，
 *  于是所有页面的 StyleSheet 一创建就是新配色。
 *
 *  ⚠️ 为什么必须重启才生效（不是偷懒）：
 *     RN 的 StyleSheet.create 在**模块加载时**就把颜色字符串固化成样式对象了，
 *    30 多个页面的样式都是模块级常量。运行中改 COLORS 里的值，
 *    已经创建好的样式对象不会跟着变 —— 想做到「点一下立刻换肤」，
 *    必须把每个页面的 styles 改成随主题重建的动态样式（useStyles 化），
 *    那是 30+ 文件的机械改造，风险远大于收益。所以这里选择
 *    「保存 → 下次启动生效」，并在设置页把这件事明确写给用户。
 */

import { File, Paths } from 'expo-file-system';

// ══════════════════════════════════════════════════════════
// 主题类型
// ══════════════════════════════════════════════════════════

export type ThemeKey = 'candy' | 'forest' | 'starry' | 'sakura';

export interface ThemePalette {
  readonly key: ThemeKey;
  /** 中文名，仅用于调试 / 日志 */
  readonly name: string;

  /** 主行动色（主按钮、进度条、强调数字） */
  readonly primary: string;
  /**
   * 主按钮底色：比 primary 深一档。
   * 浅蜜桃上配白字对比度只有 2.7:1（儿童看不清），
   * 所以主按钮改用 primaryDeep + 深咖字 onPrimary，实测 5:1。
   */
  readonly primaryDeep: string;
  readonly primarySoft: string;

  /** 次行动色（次要按钮、链接） */
  readonly secondary: string;
  readonly secondarySoft: string;

  /** 强调色（收藏、角标、徽章） */
  readonly accent: string;
  readonly accentSoft: string;

  /** 页面底色 / 卡片 */
  readonly bg: string;
  readonly card: string;
  readonly cardSoft: string;
  /** 背景三段渐变 */
  readonly gradient: readonly [string, string, string];

  /** 文字（深咖系，不用纯黑） */
  readonly text: string;
  readonly textSub: string;
  readonly textLight: string;
  /** 主按钮上的文字：浅底配深字，保证对比度 */
  readonly onPrimary: string;

  /** 功能色 */
  readonly sky: string;
  readonly skySoft: string;
  readonly mint: string;
  readonly mintSoft: string;
  readonly lemon: string;
  readonly lemonSoft: string;
  readonly coral: string;
  readonly coralSoft: string;

  /** 分隔线 / 阴影 */
  readonly divider: string;
  readonly shadow: string;
}

// ══════════════════════════════════════════════════════════
// 4 套预设主题
// ══════════════════════════════════════════════════════════

/** ① 糖果系（默认）：蜜桃主色 + 草莓强调 + 暖白/淡粉底 */
const CANDY_THEME: ThemePalette = {
  key: 'candy',
  name: '糖果系',
  primary: '#F7A072',
  primaryDeep: '#EE8B5E',
  primarySoft: '#FFD9C2',
  secondary: '#9B7EDE',
  secondarySoft: '#E2D8FB',
  accent: '#EE7EA4',
  accentSoft: '#FFD6E4',
  bg: '#FDF9F3',
  card: '#FFFFFF',
  cardSoft: '#FFFCF7',
  gradient: ['#FDF9F3', '#FFF1F4', '#FDEFE3'],
  text: '#3D3229',
  textSub: '#7A6A5D',
  textLight: '#A8988A',
  onPrimary: '#3D3229',
  sky: '#7FBEEB',
  skySoft: '#D3EAFB',
  mint: '#5FC3A4',
  mintSoft: '#D2F2E6',
  lemon: '#FFD166',
  lemonSoft: '#FFEFC2',
  coral: '#F2827F',
  coralSoft: '#FFDCDA',
  divider: '#F2E8DC',
  shadow: '#8A6A55',
};

/** ② 森林系：薄荷绿主色 + 柠檬黄辅色 + 极淡草绿底 */
const FOREST_THEME: ThemePalette = {
  key: 'forest',
  name: '森林系',
  primary: '#5FC3A4',
  primaryDeep: '#43A585',
  primarySoft: '#D2F2E6',
  secondary: '#FFD166',
  secondarySoft: '#FFEFC2',
  accent: '#F2827F',
  accentSoft: '#FFDCDA',
  bg: '#F6FBF2',
  card: '#FFFFFF',
  cardSoft: '#FBFEF8',
  gradient: ['#F6FBF2', '#E7F5DF', '#FDFCF3'],
  text: '#2F3A2E',
  textSub: '#6B7A66',
  textLight: '#9BAA95',
  onPrimary: '#1F3B31',
  sky: '#7FBEEB',
  skySoft: '#D3EAFB',
  mint: '#5FC3A4',
  mintSoft: '#D2F2E6',
  lemon: '#FFD166',
  lemonSoft: '#FFEFC2',
  coral: '#F2827F',
  coralSoft: '#FFDCDA',
  divider: '#E4F0DC',
  shadow: '#5E7A55',
};

/** ③ 星空系：天空蓝主色 + 葡萄紫辅色 + 极淡星空蓝底 */
const STARRY_THEME: ThemePalette = {
  key: 'starry',
  name: '星空系',
  primary: '#6FA8E8',
  primaryDeep: '#548FD4',
  primarySoft: '#D3EAFB',
  secondary: '#9B7EDE',
  secondarySoft: '#E2D8FB',
  accent: '#FFD166',
  accentSoft: '#FFEFC2',
  bg: '#F2F7FD',
  card: '#FFFFFF',
  cardSoft: '#F8FBFF',
  gradient: ['#F2F7FD', '#E4EEFB', '#F7F4FF'],
  text: '#2C3444',
  textSub: '#66718A',
  textLight: '#98A2B8',
  onPrimary: '#1E2E45',
  sky: '#7FBEEB',
  skySoft: '#D3EAFB',
  mint: '#5FC3A4',
  mintSoft: '#D2F2E6',
  lemon: '#FFD166',
  lemonSoft: '#FFEFC2',
  coral: '#F2827F',
  coralSoft: '#FFDCDA',
  divider: '#E0EAF7',
  shadow: '#5A6B8C',
};

/** ④ 樱花系：草莓粉主色 + 珊瑚红辅色 + 极淡樱花粉底 */
const SAKURA_THEME: ThemePalette = {
  key: 'sakura',
  name: '樱花系',
  primary: '#EE7EA4',
  primaryDeep: '#DE6690',
  primarySoft: '#FFD6E4',
  secondary: '#F2827F',
  secondarySoft: '#FFDCDA',
  accent: '#FFD166',
  accentSoft: '#FFEFC2',
  bg: '#FFF7F9',
  card: '#FFFFFF',
  cardSoft: '#FFFBFD',
  gradient: ['#FFF7F9', '#FFEAF1', '#FDF5FF'],
  text: '#3F3038',
  textSub: '#7C6A73',
  textLight: '#AC9AA3',
  onPrimary: '#3A2530',
  sky: '#7FBEEB',
  skySoft: '#D3EAFB',
  mint: '#5FC3A4',
  mintSoft: '#D2F2E6',
  lemon: '#FFD166',
  lemonSoft: '#FFEFC2',
  coral: '#F2827F',
  coralSoft: '#FFDCDA',
  divider: '#FBE4EC',
  shadow: '#A06A80',
};

export const THEMES: Record<ThemeKey, ThemePalette> = {
  candy: CANDY_THEME,
  forest: FOREST_THEME,
  starry: STARRY_THEME,
  sakura: SAKURA_THEME,
};

export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];

// ══════════════════════════════════════════════════════════
// 主题持久化（同步读写，必须在模块加载阶段就能拿到值）
// ══════════════════════════════════════════════════════════
/**
 * 为什么用文件而不是 AsyncStorage：
 *   AsyncStorage 只有异步 API，而 ACTIVE_THEME 必须在**本模块加载时**就确定，
 *   否则各页面的 StyleSheet.create 会先按默认色跑完，再读到偏好也来不及了。
 *   expo-file-system 的 File.textSync()/write() 是同步的，正好满足。
 */
const THEME_PREF_FILE = 'ui-theme.txt';

function isThemeKey(v: string): v is ThemeKey {
  return v === 'candy' || v === 'forest' || v === 'starry' || v === 'sakura';
}

/** 读取用户上次选择的主题（读不到 / 异常一律回退糖果系） */
function readSavedThemeKey(): ThemeKey {
  try {
    const f = new File(Paths.document, THEME_PREF_FILE);
    if (!f.exists) return 'candy';
    const raw = (f.textSync() || '').trim();
    return isThemeKey(raw) ? raw : 'candy';
  } catch {
    // 冷启动极早期原生模块不可用、或 Web 环境：静默回退，绝不让 App 起不来
    return 'candy';
  }
}

/**
 * 保存主题选择（同步落盘）。返回是否写成功。
 * ⚠️ 只影响**下次启动**，本次运行中已经创建好的样式不会变（见文件头说明）。
 */
export function saveThemeKey(key: ThemeKey): boolean {
  try {
    const f = new File(Paths.document, THEME_PREF_FILE);
    if (!f.exists) f.create({ intermediates: true, overwrite: true });
    f.write(key);
    return true;
  } catch (err) {
    console.warn('[Colors] 保存主题失败:', err);
    return false;
  }
}

/** 当前**正在运行**的主题：启动时从磁盘读取，运行期不会变 */
export const ACTIVE_THEME: ThemeKey = readSavedThemeKey();

/** 磁盘上已保存的主题（可能与 ACTIVE_THEME 不同 —— 表示"下次启动会切成它"） */
export function getSavedThemeKey(): ThemeKey {
  return readSavedThemeKey();
}

const T: ThemePalette = THEMES[ACTIVE_THEME];

/** 取任意主题色盘（调试 / 节日预览用） */
export function getTheme(key: ThemeKey): ThemePalette {
  return THEMES[key] ?? THEMES.candy;
}

/** 当前生效的主题（业务代码一般用不到，需要读主题名/色板时用） */
export const theme = T;

// ══════════════════════════════════════════════════════════
// 兼容层：保持旧键名，历史页面零改动即可跟随换肤
// ══════════════════════════════════════════════════════════

/** 裸色板（键名沿用糖果系命名，值是「当前主题」的对应色） */
export const CANDY = {
  /** 主行动色 */
  peach: T.primary,
  /** 主按钮底色：比 peach 深一档 */
  peachDeep: T.primaryDeep,
  peachSoft: T.primarySoft,
  /** 强调色（收藏 / 角标） */
  berry: T.accent,
  berrySoft: T.accentSoft,
  /** 次行动色 */
  grape: T.secondary,
  grapeSoft: T.secondarySoft,
  sky: T.sky,
  skySoft: T.skySoft,
  mint: T.mint,
  mintSoft: T.mintSoft,
  lemon: T.lemon,
  lemonSoft: T.lemonSoft,
  coral: T.coral,
  coralSoft: T.coralSoft,
} as const;

/** 语义色：业务代码主要用这组 */
export const COLORS = {
  // 主色系（保留旧键名，避免大量页面改动）
  orange: CANDY.peach,
  /** 主按钮底（浅底 + 深咖字，对比度 5:1，孩子看得清） */
  orangeDeep: CANDY.peachDeep,
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
  cream: T.bg,
  card: T.card,
  cardSoft: T.cardSoft,

  // 文字：深咖啡，而非纯黑
  text: T.text,
  textSub: T.textSub,
  textLight: T.textLight,
  /** 主按钮上的文字色：浅底配深字，保证对比度 */
  onPrimary: T.onPrimary,
  white: '#FFFFFF',

  // 功能色
  divider: T.divider,
  shadow: T.shadow,
  danger: CANDY.coral,
  success: CANDY.mint,
} as const;

/** 背景渐变（暖调，替代大面积纯色；跟随当前主题） */
export const CANDY_GRADIENTS = {
  /** 主背景（默认） */
  cream: T.gradient,
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

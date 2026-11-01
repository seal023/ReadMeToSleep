/**
 * constants/clayIcons.ts — 3D 粘土风素材的唯一映射表
 *
 * 素材：assets/clay/*.png（用户 AI 生成 → 已抠透明底、去水印、裁边、分档缩放）
 *   mascot 640 / item 512 / reward 512 / deco 256
 *
 * 为什么映射表放在 constants 而不是组件里：
 *   ① constants/theme.ts（COVER_PRESETS 故事封面）也要引用图标名，
 *      放进组件层会造成 constants → components 的反向依赖；
 *   ② 想整体换一套贴图（比如以后出 2.0 皮肤）只改这一个文件。
 *
 * 注意：这里只做 require 映射（RN 的 require 在打包期被静态解析，必须写成字面量），
 * 不要改成动态拼接路径。
 */

export const CLAY_ICONS = {
  /* 吉祥物 */
  raccoon: require('../assets/clay/mascot_raccoon.png'),
  fox: require('../assets/clay/mascot_fox.png'),

  /* 功能物件 */
  book: require('../assets/clay/item_book.png'),
  globe: require('../assets/clay/item_globe.png'),
  megaphone: require('../assets/clay/item_megaphone.png'),
  mic: require('../assets/clay/item_mic.png'),
  tent: require('../assets/clay/item_tent.png'),
  trophy: require('../assets/clay/reward_trophy.png'),

  /* 装饰 */
  moon: require('../assets/clay/deco_moon.png'),
  starBig: require('../assets/clay/deco_star_big.png'),
  starSmall: require('../assets/clay/deco_star_small.png'),
  flower1: require('../assets/clay/deco_flower1.png'),
  flower2: require('../assets/clay/deco_flower2.png'),
  flower3: require('../assets/clay/deco_flower3.png'),
  flower4: require('../assets/clay/deco_flower4.png'),
} as const;

export type ClayIconName = keyof typeof CLAY_ICONS;

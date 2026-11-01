/**
 * ClayIcon — 3D 粘土风图标（统一封装）
 *
 * 素材与映射表见 constants/clayIcons.ts（本文件只负责「怎么画」）。
 *
 * 用法：
 *   <ClayIcon name="book" size={28} />
 *   <ClayIcon name="starBig" size={40} style={{ opacity: 0.45 }} />
 *
 * 为什么统一走这个组件：
 *   1. 尺寸用 width/height 直接给，避免 30 多个页面各写一套 Image 样式；
 *   2. 全部 resizeMode="contain"，非正方形素材（喇叭 / 麦克风 / 帐篷）不会变形；
 *   3. 想整体换风格时只改映射表，不用翻页面。
 */

import React from 'react';
import { Image, StyleProp, ImageStyle } from 'react-native';
import { CLAY_ICONS, type ClayIconName } from '../../constants/clayIcons';

export { CLAY_ICONS };
export type { ClayIconName };

interface ClayIconProps {
  name: ClayIconName;
  /** 边长（pt）。非正方形素材按 contain 等比缩放进这个方框 */
  size?: number;
  /** 额外的宽高/旋转/透明度等样式 */
  style?: StyleProp<ImageStyle>;
}

export function ClayIcon({ name, size = 28, style }: ClayIconProps) {
  return (
    <Image
      source={CLAY_ICONS[name]}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      fadeDuration={0}
    />
  );
}

export default ClayIcon;

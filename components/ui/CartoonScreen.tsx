/**
 * CartoonScreen —— 全 App 统一的卡通背景容器（需求二：柔和渐变 + 绘本氛围）
 *
 * 解决之前各页面「平涂 #FFF5E6 + 硬编色」导致的风格不统一：
 *  - SafeAreaView：仅作用于 左右+底部，顶部仍由页面自带 paddingTop 控制，
 *    避免在带刘海设备上与页面 padding 重复。
 *  - GradientBackground：柔和多色渐变 + 可选 SkyDecor（星星/月亮/云朵）。
 *  - 横屏自适应：iPad 横屏（宽 ≥ 768）时内容限宽居中、加大左右留白，
 *    避免超宽屏把卡片拉得太散。
 *
 * 用法：把页面原来的 <View style={styles.container}> / <ScrollView> 外层
 * 换成 <CartoonScreen ...>，并删掉原 container 的 backgroundColor。
 */

import React from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  useWindowDimensions,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { GradientBackground } from './Gradient';
import { COLORS, GRADIENTS } from '../../constants/theme';

type GradientKey = keyof typeof GRADIENTS;

interface CartoonScreenProps {
  children: React.ReactNode;
  /** 渐变预设名，默认 day（奶油→粉→天蓝） */
  gradient?: GradientKey;
  /** 叠加星空装饰（星星/月亮/云朵），儿童向 hero 页建议开启 */
  decor?: boolean;
  decorVariant?: 'day' | 'night';
  /** 横屏时是否限宽居中，默认 true */
  wide?: boolean;
  /** 限宽最大值（横屏），默认 920 */
  maxWidth?: number;
  /** 额外内容样式（如顶部留白、对齐） */
  contentStyle?: StyleProp<ViewStyle>;
}

export function CartoonScreen({
  children,
  gradient = 'day',
  decor = false,
  decorVariant = 'day',
  wide = true,
  maxWidth = 920,
  contentStyle,
}: CartoonScreenProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const content: ViewStyle | ViewStyle[] = [
    styles.flex,
    wide && isWide && styles.wideContent,
    wide && isWide && ({ maxWidth } as ViewStyle),
    contentStyle,
  ].filter(Boolean) as ViewStyle[];

  return (
    <SafeAreaView style={[styles.flex, styles.safe]} edges={['left', 'right', 'bottom']}>
      <GradientBackground
        colors={GRADIENTS[gradient]}
        decor={decor}
        decorVariant={decorVariant}
        style={styles.flex}
      >
        <View style={content}>{children}</View>
      </GradientBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { backgroundColor: COLORS.cream },
  // iPad 横屏：内容限宽居中，避免超宽屏拉伸
  wideContent: {
    alignSelf: 'center',
    width: '100%',
  },
});

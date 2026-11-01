/**
 * 卡通按钮 / 弹性按压容器（需求 二：按钮大圆角，按压时有弹性动画，适合小手点击）
 *
 * ElasticPressable：给任意子元素加「按下缩小、松手回弹」的 Q 弹手感
 * CartoonButton：大圆角 + 大字号 + 暖色 + 阴影的主操作按钮
 */

import React, { useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  Text,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
  PressableProps,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, FONT_SIZE, RADIUS, SHADOW } from '../../constants/theme';

/**
 * 触发一次轻震动。
 * 包一层 try/catch：Web / 无马达设备 / 系统关闭触感反馈时不应影响点击本身。
 */
function tapHaptic(style: 'light' | 'medium' = 'light') {
  if (Platform.OS === 'web') return;
  try {
    void Haptics.impactAsync(
      style === 'medium'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light
    ).catch(() => {});
  } catch {
    /* 无触感能力时静默跳过 */
  }
}

// ── 弹性按压容器 ────────────────────────────────────────
interface ElasticPressableProps extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  /** 支持数组形式（会与缩放动画合并） */
  style?: StyleProp<ViewStyle>;
  /**
   * 作用在「最外层 Pressable 容器」上的样式。
   * ⚠️ style 是加在内层 Animated.View 上的：放在 flexDirection:'row' 的父容器里时，
   * 内层 flex:1 无法撑开外层 Pressable，几个按钮会挤在左侧。
   * 需要横排等分时，必须用 containerStyle={{ flex: 1 }} 撑开外层。
   */
  containerStyle?: StyleProp<ViewStyle>;
  /** 按下时缩放到多少，默认 0.92 */
  pressScale?: number;
  /** 松手回弹的弹性强度，越大越 Q，默认 12 */
  bounciness?: number;
  /** 按下时的震动强度；'none' 关闭 */
  haptic?: 'light' | 'medium' | 'none';
}

export function ElasticPressable({
  children,
  style,
  containerStyle,
  pressScale = 0.92,
  bounciness = 12,
  haptic = 'light',
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: ElasticPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: Parameters<NonNullable<PressableProps['onPressIn']>>[0]) => {
    // 按下：快速收紧（无回弹），让手感"实"
    Animated.spring(scale, {
      toValue: pressScale,
      tension: 420,
      friction: 22,
      useNativeDriver: true,
    }).start();
    if (!disabled && haptic !== 'none') tapHaptic(haptic);
    onPressIn?.(e);
  };

  const handlePressOut = (e: Parameters<NonNullable<PressableProps['onPressOut']>>[0]) => {
    // 松手：低摩擦 → 明显的过冲回弹，就是"Q 弹"
    Animated.spring(scale, {
      toValue: 1,
      tension: 240,
      friction: Math.max(3, 14 - bounciness),
      useNativeDriver: true,
    }).start();
    onPressOut?.(e);
  };

  return (
    <Pressable
      style={containerStyle}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      disabled={disabled}
      {...rest}
    >
      <Animated.View
        style={[style, { transform: [{ scale }] }, disabled && styles.disabled]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

// ── 卡通按钮 ────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'danger';

interface CartoonButtonProps {
  title: string;
  onPress?: () => void;
  /** 按钮上的卡通 emoji，如 🎧 ✏️ */
  emoji?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  /** 占满父容器宽度 */
  full?: boolean;
}

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: COLORS.orange,
  secondary: COLORS.purple,
  soft: COLORS.pinkLight,
  danger: '#FF7A7A',
};

const VARIANT_TEXT: Record<ButtonVariant, string> = {
  primary: COLORS.white,
  secondary: COLORS.white,
  soft: COLORS.text,
  danger: COLORS.white,
};

export function CartoonButton({
  title,
  onPress,
  emoji,
  variant = 'primary',
  disabled,
  style,
  textStyle,
  full,
}: CartoonButtonProps) {
  return (
    <ElasticPressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={[styles.base, { backgroundColor: VARIANT_BG[variant] }, full && styles.full, style]}
      pressScale={0.93}
      bounciness={14}
    >
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text
        style={[
          styles.text,
          { color: VARIANT_TEXT[variant], fontFamily: FONT.rounded },
          textStyle,
        ]}
      >
        {title}
      </Text>
    </ElasticPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    paddingVertical: 18,
    paddingHorizontal: 30,
    minHeight: 64, // 适合小手点击
    ...SHADOW.button,
  },
  full: {
    alignSelf: 'stretch',
  },
  emoji: {
    fontSize: 26,
    marginRight: 12,
  },
  text: {
    fontSize: FONT_SIZE.button,
    // ⚠️ 不要写 fontWeight：站酷快乐体只有一个字重，
    // iOS 上自定义字体叠加 fontWeight 会找不到字体而静默回落系统字体。
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  disabled: {
    opacity: 0.5,
  },
});

// 供需要纯布局（无 Pressable）的场景复用
export const buttonStyles = styles;

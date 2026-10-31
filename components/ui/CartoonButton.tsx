/**
 * 卡通按钮 / 弹性按压容器（需求 二：按钮大圆角，按压时有弹性动画，适合小手点击）
 *
 * ElasticPressable：给任意子元素加「按下缩小、松手回弹」的 Q 弹手感
 * CartoonButton：大圆角 + 大字号 + 暖色 + 阴影的主操作按钮
 */

import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  Text,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
  PressableProps,
} from 'react-native';
import { COLORS, FONT, FONT_SIZE, RADIUS, SHADOW } from '../../constants/theme';

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
  /** 按下时缩放到多少，默认 0.94 */
  pressScale?: number;
  /** 松手回弹的弹性强度，越大越 Q，默认 12 */
  bounciness?: number;
}

export function ElasticPressable({
  children,
  style,
  containerStyle,
  pressScale = 0.94,
  bounciness = 12,
  onPress,
  disabled,
  ...rest
}: ElasticPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: pressScale,
      tension: 300,
      friction: 12,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      tension: 200,
      friction: Math.max(3, 14 - bounciness), // 摩擦越小越弹
      useNativeDriver: true,
    }).start();
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
    paddingVertical: 16,
    paddingHorizontal: 26,
    minHeight: 60, // 适合小手点击
    ...SHADOW.button,
  },
  full: {
    alignSelf: 'stretch',
  },
  emoji: {
    fontSize: 24,
    marginRight: 10,
  },
  text: {
    fontSize: FONT_SIZE.button,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});

// 供需要纯布局（无 Pressable）的场景复用
export const buttonStyles = styles;

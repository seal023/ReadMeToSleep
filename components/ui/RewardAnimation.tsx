/**
 * RewardAnimation —— 升级 / 获得勋章的庆祝动效（需求 2「以动画模式展现」）
 *
 * 用法：由父组件在检测到「升级」或「解锁新勋章」后挂载，
 * 播完自动回调 onDone（一般 2.6s），期间可点击卡片提前关闭。
 *
 * 全部使用 RN 内置 Animated，不引入额外依赖，
 * 避免给 Xcode Cloud 构建增加原生模块风险。
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { COLORS, RADIUS, SPACING, FONT_SIZE, SHADOW } from '@/constants/theme';

const { width: SCREEN_W } = Dimensions.get('window');

export interface RewardAnimationProps {
  /** 勋章 emoji */
  emoji: string;
  /** 主标题，如「升级啦！」 */
  title: string;
  /** 副标题，如等级名 */
  subtitle: string;
  /** 补充文案 */
  desc?: string;
  visible: boolean;
  onDone: () => void;
}

/** 飞行的小星星：每颗有各自的终点与延迟 */
const SPARKS = Array.from({ length: 12 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 12;
  return {
    dx: Math.cos(angle) * (SCREEN_W * 0.28),
    dy: Math.sin(angle) * (SCREEN_W * 0.28),
    delay: (i % 4) * 60,
    size: i % 3 === 0 ? 16 : 11,
    star: i % 2 === 0 ? '⭐' : '✨',
  };
});

export function RewardAnimation({
  emoji,
  title,
  subtitle,
  desc,
  visible,
  onDone,
}: RewardAnimationProps) {
  const badgeScale = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const sparkProgress = useRef(new Animated.Value(0)).current;

  // 撒花：彩色纸屑从顶部随机飘落（对应设计稿 s-reward 的 confetti）
  const CONFETTI_COLORS = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#DDA0DD', '#FF9A56', '#7FC8F8'];
  const confettiItems = useRef(
    Array.from({ length: 24 }, (_, i) => ({
      left: (i * 53) % 100,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: (i * 90) % 900,
      size: 8 + (i % 3) * 2,
      rot: (i % 2 === 0 ? 1 : -1) * (20 + (i % 5) * 10),
      av: new Animated.Value(0),
    })),
  ).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    badgeScale.setValue(0);
    cardOpacity.setValue(0);
    sparkProgress.setValue(0);
    titleOpacity.setValue(0);
    confettiItems.forEach((c) => {
      c.av.setValue(0);
      Animated.timing(c.av, { toValue: 1, duration: 1500, delay: c.delay, useNativeDriver: true }).start();
    });

    Animated.sequence([
      // 卡片淡入
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      // 勋章弹出来
      Animated.spring(badgeScale, {
        toValue: 1,
        speed: 14,
        bounciness: 16,
        useNativeDriver: true,
      }),
      // 星星向四周飞散 + 文字浮现
      Animated.parallel([
        Animated.timing(sparkProgress, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      // 停留一会让人看清
      Animated.delay(1100),
      // 整体淡出
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onDone();
    });
  }, [visible, onDone]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity: cardOpacity }]}>
      {/* 撒花彩纸（背景层，不遮挡文字） */}
      {confettiItems.map((c, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            styles.confetti,
            {
              left: `${c.left}%`,
              width: c.size,
              height: c.size,
              backgroundColor: c.color,
              opacity: c.av.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0.9] }),
              transform: [
                { translateY: c.av.interpolate({ inputRange: [0, 1], outputRange: [0, 620] }) },
                { rotate: `${c.rot}deg` },
              ],
            },
          ]}
        />
      ))}

      <TouchableOpacity activeOpacity={1} onPress={onDone} style={styles.touchArea}>
        <Animated.View style={[styles.card, { opacity: cardOpacity }]}>
          {/* 飞散的小星星 */}
          {SPARKS.map((s, i) => (
            <Animated.Text
              key={i}
              style={[
                styles.spark,
                {
                  fontSize: s.size,
                  transform: [
                    {
                      translateX: sparkProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, s.dx],
                      }),
                    },
                    {
                      translateY: sparkProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, s.dy],
                      }),
                    },
                    {
                      scale: sparkProgress.interpolate({
                        inputRange: [0, 0.4, 1],
                        outputRange: [0.2, 1.2, 0.6],
                      }),
                    },
                  ],
                  opacity: sparkProgress.interpolate({
                    inputRange: [0, 0.3, 1],
                    outputRange: [0, 1, 0],
                  }),
                },
              ]}
            >
              {s.star}
            </Animated.Text>
          ))}

          {/* 勋章主体 */}
          <Animated.View
            style={[
              styles.badgeRing,
              { transform: [{ scale: badgeScale }] },
            ]}
          >
            <Text style={styles.badgeEmoji}>{emoji}</Text>
          </Animated.View>

          <Animated.View style={{ opacity: titleOpacity }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            {desc ? <Text style={styles.desc}>{desc}</Text> : null}
          </Animated.View>
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(60, 45, 35, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  touchArea: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 300,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    ...SHADOW.card,
  },
  badgeRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#FFF6DC',
    borderWidth: 4,
    borderColor: '#FFC94D',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  badgeEmoji: {
    fontSize: 54,
  },
  spark: {
    position: 'absolute',
    top: 70,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZE.section,
    fontWeight: '700',
    color: '#EF8A17',
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  desc: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  confetti: {
    position: 'absolute',
    top: -20,
    borderRadius: 2,
    zIndex: 1,
  },
});

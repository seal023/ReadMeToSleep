/**
 * StoryFinaleCelebration —— 故事讲完那一刻的全屏「礼花庆典」结尾
 * ---------------------------------------------------------------------------
 * 需求：每一个故事听完之后都要有冲击力 —— 礼花绽放 + 满天星星 + 鲜花。
 * 与 RewardAnimation（升级/勋章，答题后才出现）不同：这个动画每次听完必播，
 * 挂在 app/story/[id].tsx 的 completed 阶段，播完自动淡出，露出「讲完啦」页。
 *
 * 全部用 RN 内置 Animated，不引入任何原生依赖（Xcode Cloud 构建零风险）。
 * 文字只是辅助：主体是动画 + 语音（story 页的 speakPhrase('done') 同步响起），
 * 不识字的孩子也能看懂「故事讲完了、在为你庆祝」。
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import Racco from '@/components/common/Racco';
import { FONT_SIZE, FONT } from '@/constants/theme';

const { width: SW, height: SH } = Dimensions.get('window');
/** 礼花炸开的半径：取短边，iPad 横屏也不会飞出屏幕太多 */
const BURST_R = Math.min(SW, SH) * 0.42;

const FIREWORK_COLORS = ['#FF8A65', '#FFE66D', '#F2827F', '#4ECDC4', '#7FC8F8', '#DDA0DD'];
const FLOWER_EMOJI = ['🌸', '🌷', '🌺', '🌼', '💐', '🏵️', '🌻'];
const STAR_EMOJI = ['⭐', '✨', '🌟', '💫', '✦'];

/** 3 波礼花：位置 / 起爆延迟 / 主色，错开形成「此起彼伏」的绽放感 */
const BURSTS = [
  { x: 0.20, y: 0.28, delay: 120, color: '#FF8A65' },
  { x: 0.80, y: 0.24, delay: 620, color: '#7FC8F8' },
  { x: 0.50, y: 0.52, delay: 1180, color: '#FFE66D' },
];

/** 每波 16 条射线，构成一朵礼花 */
const PARTICLES = Array.from({ length: 16 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 16;
  return {
    dx: Math.cos(angle) * BURST_R * (i % 3 === 0 ? 0.78 : 1),
    dy: Math.sin(angle) * BURST_R * (i % 3 === 0 ? 0.78 : 1),
    color: FIREWORK_COLORS[i % FIREWORK_COLORS.length],
    size: i % 4 === 0 ? 13 : 9,
    long: i % 4 === 0,
  };
});

/** 满天星星：确定性位置，避免每次渲染乱跳；4 组闪烁相位错开 */
const SKY_STARS = Array.from({ length: 34 }, (_, i) => ({
  left: (i * 37 + 7) % 97,
  top: (i * 53 + 11) % 90,
  emoji: STAR_EMOJI[i % STAR_EMOJI.length],
  size: 13 + (i % 4) * 4,
  group: i % 4,
}));

/** 鲜花雨：每朵独立的下落循环，延迟 / 时长 / 摆幅都不同，避免整齐划一 */
const FLOWERS = Array.from({ length: 20 }, (_, i) => ({
  av: new Animated.Value(0),
  left: (i * 47 + 13) % 96,
  emoji: FLOWER_EMOJI[i % FLOWER_EMOJI.length],
  size: 23 + (i % 4) * 5,
  delay: (i * 230) % 1900,
  dur: 2600 + (i % 5) * 380,
  sway: (i % 2 === 0 ? 1 : -1) * (16 + (i % 4) * 9),
  rot: (i % 2 === 0 ? 1 : -1) * (110 + (i % 5) * 45),
}));

export interface StoryFinaleCelebrationProps {
  visible: boolean;
  /** 主标题，如「故事讲完啦！」 */
  title: string;
  /** 副标题：一句夸奖 */
  subtitle?: string;
  /** 底部小提示（文字只作辅助，动画本身已表达「庆祝」） */
  tapHint?: string;
  onDone: () => void;
}

type Running = Animated.CompositeAnimation;

export function StoryFinaleCelebration({
  visible,
  title,
  subtitle,
  tapHint,
  onDone,
}: StoryFinaleCelebrationProps) {
  // 用 ref 存最新回调：避免父组件内联箭头函数导致 effect 重跑、动画重播
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneRef = useRef(false);

  // 每波礼花：p 驱动粒子飞散，ring 驱动冲击光环
  const bursts = useRef(
    BURSTS.map(() => ({ p: new Animated.Value(0), ring: new Animated.Value(0) })),
  ).current;
  const twinkles = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  const shoot = useRef(new Animated.Value(0)).current;
  const enterOpacity = useRef(new Animated.Value(0)).current;
  const enterScale = useRef(new Animated.Value(0.6)).current;
  const haloPulse = useRef(new Animated.Value(0)).current;
  const fadeOut = useRef(new Animated.Value(1)).current;

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  };

  useEffect(() => {
    if (!visible) return;

    doneRef.current = false;
    bursts.forEach((b) => {
      b.p.setValue(0);
      b.ring.setValue(0);
    });
    twinkles.forEach((v) => v.setValue(0));
    FLOWERS.forEach((f) => f.av.setValue(0));
    shoot.setValue(0);
    enterOpacity.setValue(0);
    enterScale.setValue(0.6);
    haloPulse.setValue(0);
    fadeOut.setValue(1);

    const running: Running[] = [];
    const play = (a: Running) => {
      a.start();
      running.push(a);
      return a;
    };

    // ① 满天星星：4 组呼吸闪烁
    twinkles.forEach((v, i) => {
      const a = Animated.loop(
        Animated.sequence([
          Animated.delay(i * 270),
          Animated.timing(v, { toValue: 1, duration: 880, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 880, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      play(a);
    });

    // ② 鲜花雨：每朵花独立飘落 + 左右摆动 + 旋转
    FLOWERS.forEach((f) => {
      const a = Animated.loop(
        Animated.sequence([
          Animated.delay(f.delay),
          Animated.timing(f.av, { toValue: 1, duration: f.dur, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(f.av, { toValue: 0, duration: 1, useNativeDriver: true }),
        ]),
      );
      play(a);
    });

    // ③ 流星斜划过
    play(
      Animated.loop(
        Animated.sequence([
          Animated.delay(700),
          Animated.timing(shoot, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.delay(1500),
          Animated.timing(shoot, { toValue: 0, duration: 1, useNativeDriver: true }),
        ]),
      ),
    );

    // ④ 中央光晕呼吸
    play(
      Animated.loop(
        Animated.sequence([
          Animated.timing(haloPulse, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(haloPulse, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    );

    // ⑤ 三波礼花依次炸开
    bursts.forEach((b, i) => {
      const a = Animated.sequence([
        Animated.delay(BURSTS[i].delay),
        Animated.parallel([
          Animated.timing(b.p, { toValue: 1, duration: 1150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(b.ring, { toValue: 1, duration: 720, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]),
      ]);
      play(a);
    });

    // ⑥ 小浣熊 + 文字弹跳进场
    play(
      Animated.parallel([
        Animated.timing(enterOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.spring(enterScale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
      ]),
    );

    // ⑦ 停留约 3.4s 后整体淡出；只有真正播完（非被 stop / 非提前跳过）才回调
    const exitAnim: Running = Animated.sequence([
      Animated.delay(3400),
      Animated.timing(fadeOut, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]);
    exitAnim.start(({ finished }) => {
      if (finished) finish();
    });
    running.push(exitAnim);

    return () => {
      running.forEach((a) => a.stop());
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeOut }]}>
      <TouchableOpacity activeOpacity={1} style={styles.touch} onPress={finish}>
        {/* 夜空底 + 两团柔光，让彩色礼花更跳 */}
        <View pointerEvents="none" style={styles.glowWarm} />
        <View pointerEvents="none" style={styles.glowCool} />

        {/* 满天星星 */}
        {SKY_STARS.map((s, i) => (
          <Animated.Text
            key={`star-${i}`}
            pointerEvents="none"
            style={[
              styles.skyStar,
              {
                left: `${s.left}%`,
                top: `${s.top}%`,
                fontSize: s.size,
                opacity: twinkles[s.group].interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
                transform: [
                  { scale: twinkles[s.group].interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.25] }) },
                ],
              },
            ]}
          >
            {s.emoji}
          </Animated.Text>
        ))}

        {/* 流星 */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shoot,
            {
              opacity: shoot.interpolate({ inputRange: [0, 0.12, 0.55, 1], outputRange: [0, 1, 0, 0] }),
              transform: [
                { translateX: shoot.interpolate({ inputRange: [0, 1], outputRange: [0, SW * 0.42] }) },
                { translateY: shoot.interpolate({ inputRange: [0, 1], outputRange: [0, SW * 0.20] }) },
              ],
            },
          ]}
        >
          <Text style={styles.shootEmoji}>💫</Text>
        </Animated.View>

        {/* 三波礼花：粒子 + 冲击光环 */}
        {BURSTS.map((burst, bi) => {
          const b = bursts[bi];
          return (
            <View
              key={`burst-${bi}`}
              pointerEvents="none"
              style={[styles.burstCenter, { left: `${burst.x * 100}%`, top: `${burst.y * 100}%` }]}
            >
              <Animated.View
                style={[
                  styles.burstRing,
                  {
                    borderColor: burst.color,
                    transform: [{ scale: b.ring.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.6] }) }],
                    opacity: b.ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.85, 0] }),
                  },
                ]}
              />
              {PARTICLES.map((p, pi) => (
                <Animated.View
                  key={`p-${bi}-${pi}`}
                  style={[
                    styles.particle,
                    {
                      width: p.long ? p.size : p.size * 0.7,
                      height: p.size,
                      borderRadius: p.size / 2,
                      backgroundColor: p.color,
                      opacity: b.p.interpolate({ inputRange: [0, 0.1, 0.62, 1], outputRange: [0, 1, 1, 0] }),
                      transform: [
                        {
                          translateX: b.p.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }),
                        },
                        {
                          translateY: b.p.interpolate({
                            inputRange: [0, 0.5, 1],
                            outputRange: [0, p.dy * 0.55, p.dy + 62],
                          }),
                        },
                        {
                          scale: b.p.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.3, 1.3, 0.5] }),
                        },
                      ],
                    },
                  ]}
                />
              ))}
            </View>
          );
        })}

        {/* 鲜花雨 */}
        {FLOWERS.map((f, i) => (
          <Animated.Text
            key={`flower-${i}`}
            pointerEvents="none"
            style={[
              styles.flower,
              {
                left: `${f.left}%`,
                fontSize: f.size,
                opacity: f.av.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { translateY: f.av.interpolate({ inputRange: [0, 1], outputRange: [-60, SH + 80] }) },
                  {
                    translateX: f.av.interpolate({
                      inputRange: [0, 0.25, 0.5, 0.75, 1],
                      outputRange: [0, f.sway, 0, -f.sway, 0],
                    }),
                  },
                  { rotate: f.av.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${f.rot}deg`] }) },
                ],
              },
            ]}
          >
            {f.emoji}
          </Animated.Text>
        ))}

        {/* 中央：小浣熊 + 文字（弹跳进场） */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.center,
            {
              opacity: enterOpacity,
              transform: [{ scale: enterScale }],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.halo,
              {
                opacity: haloPulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] }),
                transform: [{ scale: haloPulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.12] }) }],
              },
            ]}
          />
          <Racco state="happy" size={148} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.flowerRing}>🌸 🌼 🌷 🌺 🌸</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {tapHint ? <Text style={styles.tapHint}>{tapHint}</Text> : null}
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
    backgroundColor: '#2B2450',
    zIndex: 999,
  },
  touch: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  glowWarm: {
    position: 'absolute',
    top: -SW * 0.16,
    left: -SW * 0.10,
    width: SW * 0.75,
    height: SW * 0.75,
    borderRadius: SW * 0.38,
    backgroundColor: '#FF8A65',
    opacity: 0.20,
  },
  glowCool: {
    position: 'absolute',
    bottom: -SW * 0.22,
    right: -SW * 0.12,
    width: SW * 0.85,
    height: SW * 0.85,
    borderRadius: SW * 0.42,
    backgroundColor: '#4ECDC4',
    opacity: 0.14,
  },
  skyStar: {
    position: 'absolute',
    color: '#FFF6DC',
    textShadowColor: '#FFE9A8',
    textShadowRadius: 10,
  },
  shoot: {
    position: 'absolute',
    top: SH * 0.12,
    left: SW * 0.08,
  },
  shootEmoji: {
    fontSize: 34,
  },
  burstCenter: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
  burstRing: {
    position: 'absolute',
    left: -42,
    top: -42,
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
  },
  particle: {
    position: 'absolute',
    left: -5,
    top: -5,
  },
  flower: {
    position: 'absolute',
    top: -40,
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#FFD66B',
    top: '50%',
    marginTop: -190,
  },
  title: {
    fontSize: FONT_SIZE.hero + 6,
    fontWeight: '800',
    fontFamily: FONT.rounded,
    color: '#FFF8EE',
    marginTop: 18,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 8,
  },
  flowerRing: {
    fontSize: 22,
    marginTop: 8,
    letterSpacing: 6,
  },
  subtitle: {
    fontSize: FONT_SIZE.body,
    fontFamily: FONT.body,
    color: '#FFE9D2',
    marginTop: 14,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  tapHint: {
    fontSize: FONT_SIZE.caption,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 26,
  },
});

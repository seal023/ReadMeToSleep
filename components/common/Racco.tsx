import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Image, Easing } from 'react-native';
import { getRaccoAnimFrames, RACCO_ANIM_FPS, type RaccoAnim } from '../../services/raccoAnim';

export type RaccoEnter = 'none' | 'left' | 'bottom' | 'right';
export type RaccoGesture = 'none' | 'wave' | 'nod' | 'clap' | 'point';

interface RaccoProps {
  state?: 'idle' | 'talking' | 'listening' | 'thinking' | 'happy' | 'sleeping';
  size?: number;
  onPress?: () => void;
  showSpeechBubble?: boolean;
  speechText?: string;
  /** 气泡背景色；不传则白色底 + 灰字 */
  bubbleColor?: string;
  /** 自定义图源：不传则用默认小浣熊；家长页可用更可爱的专属版本 */
  source?: any;
  /** 进场动画：从边缘滑入并轻弹一下（B 档"走过来"观感）。默认 none，不影响旧调用 */
  enterFrom?: RaccoEnter;
  /** 一次性手势动画：挥手 / 点头 / 拍手 / 指向。默认 none，不影响旧调用 */
  gesture?: RaccoGesture;
  /** 进场动画延迟（毫秒），用于多元素错峰 */
  enterDelay?: number;
  /** 序列帧动画动作（wave/walk/think/happy/listen/sleep）。传了就循环播放序列帧，不传则用静态图+原 Animated */
  anim?: RaccoAnim;
  /** 序列帧是否正在播放。false 时停在第一帧（配合语音只在说话期间播动画） */
  animPlaying?: boolean;
}

// 默认静态图改用无圆盘的序列帧首帧（wave_01），彻底去掉木质圆盘底座。
// 带底座的 mascot_raccoon.png 只保留给旧 asset 兼容，不再作为吉祥物默认图。
const RACCOON = require('../../assets/racco_anim/wave_01.png');

/** 各 state 的默认循环动作：让没显式传 anim 的页面也能看到会动的小浣熊 */
const STATE_IDLE_ANIM: Record<string, RaccoAnim> = {
  idle: 'wave',
  talking: 'wave',
  listening: 'listen',
  thinking: 'think',
  happy: 'happy',
  sleeping: 'sleep',
};

const Racco: React.FC<RaccoProps> = ({
  state = 'idle',
  size = 120,
  onPress,
  showSpeechBubble = false,
  speechText = '',
  bubbleColor,
  source,
  enterFrom = 'none',
  gesture = 'none',
  enterDelay = 0,
  anim = 'none',
  animPlaying = true,
}) => {
  // 序列帧：显式 anim 用它；anim='none' 时按 state 挑一个默认动作，
  // 让所有没接语音的页面也能看到会动的小浣熊（且默认图无圆盘）。
  // 传了自定义 source（家长页专属静态图）时尊重 source，不走序列帧。
  const frameAnim: RaccoAnim = source
    ? 'none'
    : anim !== 'none'
      ? anim
      : (STATE_IDLE_ANIM[state] ?? 'wave');
  const animFrames = getRaccoAnimFrames(frameAnim);
  // 显式 anim 尊重 animPlaying（语音期间播、结束定格首帧）；anim='none' 的页面始终循环
  const shouldPlay = anim === 'none' ? true : animPlaying;
  const [frameIdx, setFrameIdx] = useState(0);
  useEffect(() => {
    setFrameIdx(0);
    if (!animFrames || !shouldPlay || animFrames.length <= 1) return;
    const id = setInterval(() => {
      setFrameIdx((i) => (i + 1) % animFrames.length);
    }, Math.round(1000 / RACCO_ANIM_FPS));
    return () => clearInterval(id);
  }, [frameAnim, shouldPlay, animFrames]);

  const breathe = useRef(new Animated.Value(1)).current;
  const zzzV = useRef(new Animated.Value(0)).current;
  const starV = useRef(new Animated.Value(0.3)).current;
  const bubbleV = useRef(new Animated.Value(0)).current;

  // 进场：位移 + 淡入 + 轻微过冲回弹
  const enterX = useRef(new Animated.Value(
    enterFrom === 'left' ? -size * 1.4 : enterFrom === 'right' ? size * 1.4 : 0,
  )).current;
  const enterY = useRef(new Animated.Value(enterFrom === 'bottom' ? size * 1.2 : 0)).current;
  const enterOpacity = useRef(new Animated.Value(enterFrom === 'none' ? 1 : 0)).current;

  // 手势：单值驱动，映射到不同 transform
  const gestureV = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state !== 'sleeping') {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, { toValue: 1.03, duration: 1600, useNativeDriver: true }),
          Animated.timing(breathe, { toValue: 0.97, duration: 1600, useNativeDriver: true }),
        ]),
      );
      l.start();
      return () => l.stop();
    }
    breathe.setValue(1);
  }, [state, breathe]);

  useEffect(() => {
    if (state === 'sleeping') {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(zzzV, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(zzzV, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]),
      );
      l.start();
      return () => l.stop();
    }
    zzzV.setValue(0);
  }, [state, zzzV]);

  useEffect(() => {
    if (state === 'happy') {
      const l = Animated.loop(
        Animated.sequence([
          Animated.timing(starV, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(starV, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        ]),
      );
      l.start();
      return () => l.stop();
    }
    starV.setValue(0.3);
  }, [state, starV]);

  // 进场动画（只在挂载时跑一次）
  useEffect(() => {
    if (enterFrom === 'none') return;
    enterX.setValue(enterFrom === 'left' ? -size * 1.4 : enterFrom === 'right' ? size * 1.4 : 0);
    enterY.setValue(enterFrom === 'bottom' ? size * 1.2 : 0);
    enterOpacity.setValue(0);
    const t = Animated.delay(enterDelay);
    Animated.parallel([
      Animated.timing(enterX, {
        toValue: 0, duration: 620, delay: enterDelay,
        easing: Easing.out(Easing.back(1.4)), useNativeDriver: true,
      }),
      Animated.timing(enterY, {
        toValue: 0, duration: 620, delay: enterDelay,
        easing: Easing.out(Easing.back(1.4)), useNativeDriver: true,
      }),
      Animated.timing(enterOpacity, {
        toValue: 1, duration: 420, delay: enterDelay,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
    ]).start();
    return () => t.stop();
  }, [enterFrom, enterDelay, size]);

  // 手势动画：state 或 gesture 变化时跑一轮
  useEffect(() => {
    gestureV.setValue(0);
    if (gesture === 'none') return;
    const rotate = gesture === 'wave' ? [-8, 14, -8, 14, 0]
      : gesture === 'nod' ? [0, -10, 6, -4, 0]
      : gesture === 'clap' ? [0, -6, 0, -6, 0]
      : [0, 5, 0, 5, 0]; // point
    const seq = rotate.map((to, i) =>
      Animated.timing(gestureV, {
        toValue: to, duration: 180, delay: i === 0 ? 320 : 0,
        easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      }),
    );
    Animated.sequence(seq).start();
  }, [gesture, state]);

  // 气泡淡入上浮
  useEffect(() => {
    if (showSpeechBubble && speechText) {
      bubbleV.setValue(0);
      Animated.timing(bubbleV, {
        toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
    } else {
      bubbleV.setValue(0);
    }
  }, [showSpeechBubble, speechText]);

  // 手势映射：挥手=旋转，点头=旋转(X 用 scaleY 近似)，拍手=横向摆动
  const gestureTransform: any[] =
    gesture === 'wave'
      ? [{ rotate: gestureV.interpolate({ inputRange: [-10, 14], outputRange: ['-10deg', '14deg'] }) }]
      : gesture === 'nod'
      ? [{ rotate: gestureV.interpolate({ inputRange: [-10, 6], outputRange: ['-10deg', '6deg'] }) }]
      : [{ translateX: gestureV.interpolate({ inputRange: [-8, 14], outputRange: [-6, 10] }) }];

  const img = (
    <Animated.View
      style={{
        transform: [
          { translateX: enterX },
          { translateY: enterY },
          // 序列帧本身已是完整动作（含挥手）：不再叠加整只身体的旋转/呼吸缩放，
          // 否则看起来像"挥手时身体在抖"。仅静态图模式才用旧的手势/呼吸动画。
          ...(animFrames ? [] : gestureTransform),
          { scale: animFrames ? 1 : breathe },
        ],
        opacity: enterOpacity,
        alignItems: 'center',
      }}
    >
      <Image
        source={animFrames ? animFrames[frameIdx] : (source ?? RACCOON)}
        style={{
          width: size,
          height: size,
          resizeMode: 'contain',
          // 立体阴影：让吉祥物从背景里"浮"出来，更醒目（ASC 截图同步还原此效果）
          shadowColor: '#8A6A55',
          shadowOffset: { width: 0, height: Math.round(size * 0.04) },
          shadowOpacity: 0.28,
          shadowRadius: Math.round(size * 0.06),
        }}
      />

      {/* 睡觉 Zzz */}
      {state === 'sleeping' && (
        <Animated.View
          style={{
            position: 'absolute',
            top: -size * 0.02,
            right: -size * 0.02,
            opacity: zzzV,
            transform: [
              {
                translateY: zzzV.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -size * 0.1],
                }),
              },
            ],
          }}
        >
          <Text style={{ fontSize: size * 0.09, color: '#9B7EDE', fontWeight: 'bold' }}>Z</Text>
          <Text style={{ fontSize: size * 0.07, color: '#9B7EDE', fontWeight: 'bold', marginLeft: size * 0.04 }}>
            z
          </Text>
          <Text style={{ fontSize: size * 0.05, color: '#9B7EDE', fontWeight: 'bold', marginLeft: size * 0.07 }}>
            z
          </Text>
        </Animated.View>
      )}

      {/* 开心星星：换成粘土小星星，和吉祥物同一套材质 */}
      {state === 'happy' && (
        <Animated.View style={{ position: 'absolute', top: size * 0.02, right: -size * 0.04, opacity: starV }}>
          <Image
            source={require('../../assets/clay/deco_star_small.png')}
            style={{ width: size * 0.24, height: size * 0.24, resizeMode: 'contain' }}
          />
        </Animated.View>
      )}

      {/* 思考问号 */}
      {state === 'thinking' && (
        <View style={{ position: 'absolute', top: -size * 0.04, right: -size * 0.02 }}>
          <Text style={{ fontSize: size * 0.13, color: '#FFB300', fontWeight: 'bold' }}>?</Text>
        </View>
      )}
    </Animated.View>
  );

  return (
    <View style={{ alignItems: 'center' }}>
      {showSpeechBubble && speechText ? (
        <Animated.View
          style={[
            styles.bubble,
            bubbleColor && { backgroundColor: bubbleColor },
            {
              opacity: bubbleV,
              transform: [{
                translateY: bubbleV.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
              }],
            },
          ]}
        >
          <Text style={[styles.bubbleText, bubbleColor && { color: '#fff' }]}>{speechText}</Text>
          <View style={[styles.arrow, bubbleColor && { borderTopColor: bubbleColor }]} />
        </Animated.View>
      ) : null}
      {onPress ? <TouchableOpacity onPress={onPress} activeOpacity={0.8}>{img}</TouchableOpacity> : img}
    </View>
  );
};

const styles = StyleSheet.create({
  bubble: {
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
    maxWidth: 240,
    alignItems: 'center',
    marginBottom: 6,
  },
  bubbleText: { color: '#555', textAlign: 'center', fontSize: 14 },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#fff',
    marginTop: 2,
  },
});

export default Racco;

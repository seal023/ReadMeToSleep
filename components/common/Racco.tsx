import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Image } from 'react-native';

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
}

// 卡通小浣熊吉祥物（依据用户参考图生成的无版权 PNG，仿图风格）
const RACCOON = require('../../assets/raccoon.png');

const Racco: React.FC<RaccoProps> = ({
  state = 'idle',
  size = 120,
  onPress,
  showSpeechBubble = false,
  speechText = '',
  bubbleColor,
  source,
}) => {
  const breathe = useRef(new Animated.Value(1)).current;
  const zzzV = useRef(new Animated.Value(0)).current;
  const starV = useRef(new Animated.Value(0.3)).current;

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

  const img = (
    <Animated.View style={{ transform: [{ scale: breathe }], alignItems: 'center' }}>
      <Image source={source ?? RACCOON} style={{ width: size, height: size, resizeMode: 'contain' }} />

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
          <Text style={{ fontSize: size * 0.09, color: '#7B68EE', fontWeight: 'bold' }}>Z</Text>
          <Text style={{ fontSize: size * 0.07, color: '#7B68EE', fontWeight: 'bold', marginLeft: size * 0.04 }}>
            z
          </Text>
          <Text style={{ fontSize: size * 0.05, color: '#7B68EE', fontWeight: 'bold', marginLeft: size * 0.07 }}>
            z
          </Text>
        </Animated.View>
      )}

      {/* 开心星星 */}
      {state === 'happy' && (
        <Animated.View
          style={{ position: 'absolute', top: size * 0.04, right: -size * 0.02, opacity: starV }}
        >
          <Text style={{ fontSize: size * 0.11, color: '#FFD700' }}>✦</Text>
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
        <View style={[styles.bubble, bubbleColor && { backgroundColor: bubbleColor }]}>
          <Text style={[styles.bubbleText, bubbleColor && { color: '#fff' }]}>{speechText}</Text>
          <View style={[styles.arrow, bubbleColor && { borderTopColor: bubbleColor }]} />
        </View>
      ) : null}
      {onPress ? <TouchableOpacity onPress={onPress} activeOpacity={0.8}>{img}</TouchableOpacity> : img}
    </View>
  );
};

const styles = StyleSheet.create({
  bubble: {
    backgroundColor: '#fff',
    borderRadius: 14,
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

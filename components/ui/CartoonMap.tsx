/**
 * CartoonMap —— 儿童向「简易卡通地图」
 *
 * 设计取舍：
 *  - 不引入 react-native-maps / react-native-svg（原生依赖会破坏云端构建，
 *    且真实地图对 3-8 岁孩子过于复杂）。纯 View + 百分比定位实现。
 *  - 中国轮廓只用柔和色块 + 装饰 emoji 示意，不追求地理精度；
 *    城市位置由经纬度线性映射到 0-100% 坐标，相对关系正确即可。
 *  - 图钉带弹性按压动画、已打卡城市变金色星星，符合"看图标就会用"。
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { COLORS, RADIUS, SPACING, FONT_SIZE, SHADOW } from '@/constants/theme';

export interface MapSpot {
  /** 唯一 id，便于记录已打卡 */
  id: string;
  /** 城市名 */
  name: string;
  /** 地标名 */
  place: string;
  /** 图钉 emoji */
  emoji: string;
  /** 横向百分比 0-100（由经度换算） */
  x: number;
  /** 纵向百分比 0-100（由纬度换算） */
  y: number;
  /** 是否已打卡 */
  visited?: boolean;
}

interface CartoonMapProps {
  spots: MapSpot[];
  /** 当前选中的 id */
  selectedId?: string | null;
  onSelect?: (spot: MapSpot) => void;
  /** 地图说明文案 */
  hint?: string;
}

/** 地图上的卡通装饰（示意山水云，不做真实地理） */
const DECORATIONS = [
  { emoji: '⛰️', x: 18, y: 30, size: 26 },
  { emoji: '🌲', x: 30, y: 55, size: 22 },
  { emoji: '☁️', x: 72, y: 18, size: 24 },
  { emoji: '🌊', x: 82, y: 68, size: 22 },
  { emoji: '🌲', x: 58, y: 82, size: 20 },
  { emoji: '⛰️', x: 38, y: 22, size: 22 },
];

function MapPin({
  spot,
  selected,
  onPress,
}: {
  spot: MapSpot;
  selected: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 1.25,
      useNativeDriver: true,
      speed: 20,
      bounciness: 12,
    }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 12,
    }).start();
  };

  // 选中的图钉持续轻微呼吸，吸引孩子注意
  useEffect(() => {
    if (!selected) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.18,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [selected, scale]);

  return (
    <Animated.View
      style={[
        styles.pinWrap,
        { left: `${spot.x}%`, top: `${spot.y}%`, transform: [{ scale }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onPress={onPress}
        style={[
          styles.pin,
          spot.visited && styles.pinVisited,
          selected && styles.pinSelected,
        ]}
      >
        <Text style={styles.pinEmoji}>{spot.visited ? '⭐' : spot.emoji}</Text>
      </TouchableOpacity>
      <Text style={[styles.pinLabel, selected && styles.pinLabelActive]} numberOfLines={1}>
        {spot.name}
      </Text>
    </Animated.View>
  );
}

export function CartoonMap({ spots, selectedId, onSelect, hint }: CartoonMapProps) {
  return (
    <View style={styles.mapCard}>
      <View style={styles.mapSurface}>
        {/* 陆地色块（柔和圆角，示意轮廓） */}
        <View style={styles.landMass} />

        {/* 卡通装饰 */}
        {DECORATIONS.map((d, i) => (
          <Text key={i} style={[styles.decor, { left: `${d.x}%`, top: `${d.y}%`, fontSize: d.size }]}>
            {d.emoji}
          </Text>
        ))}

        {/* 城市图钉 */}
        {spots.map((s) => (
          <MapPin
            key={s.id}
            spot={s}
            selected={selectedId === s.id}
            onPress={() => onSelect?.(s)}
          />
        ))}
      </View>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <Text style={styles.legendDot}>📍</Text>
          <Text style={styles.legendText}>可打卡</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendDot}>⭐</Text>
          <Text style={styles.legendText}>已打卡</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapCard: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    ...SHADOW.soft,
  },
  mapSurface: {
    width: '100%',
    aspectRatio: 16 / 11,
    backgroundColor: '#DCEEFF',
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#BFEBFF',
  },
  landMass: {
    position: 'absolute',
    left: '8%',
    top: '12%',
    width: '84%',
    height: '78%',
    backgroundColor: '#E7F7E4',
    borderRadius: 60,
    borderWidth: 2,
    borderColor: '#C9EAC4',
  },
  decor: {
    position: 'absolute',
    opacity: 0.75,
  },
  pinWrap: {
    position: 'absolute',
    alignItems: 'center',
    marginLeft: -26,
    marginTop: -26,
    width: 52,
  },
  pin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    borderWidth: 2.5,
    borderColor: COLORS.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.soft,
  },
  pinVisited: {
    backgroundColor: '#FFF3D6',
    borderColor: '#FFC94D',
  },
  pinSelected: {
    backgroundColor: COLORS.orangeLight,
    borderColor: '#FF7043',
    borderWidth: 3,
  },
  pinEmoji: {
    fontSize: 19,
  },
  pinLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSub,
    textAlign: 'center',
  },
  pinLabelActive: {
    color: COLORS.text,
  },
  hint: {
    marginTop: SPACING.sm,
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    textAlign: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.sm,
  },
  legendDot: {
    fontSize: 13,
    marginRight: 4,
  },
  legendText: {
    fontSize: 11,
    color: COLORS.textLight,
  },
});

/**
 * CartoonMap —— 儿童向「简易卡通世界地图」
 *
 * 设计取舍：
 *  - 不引入 react-native-maps / react-native-svg（原生依赖会破坏云端构建，
 *    且真实地图对 3-8 岁孩子过于复杂）。纯 View + 百分比定位实现。
 *  - 底图为卡通世界地图图片（等距柱状投影，2:1），海洋浅蓝、陆地薄荷绿，
 *    无国界无文字，适合全球打卡场景。
 *  - 图钉位置由经纬度线性映射到 0-100% 坐标，与世界地图方位一致。
 *  - 图钉带弹性按压动画、已打卡城市变金色星星，符合"看图标就会用"。
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Image } from 'react-native';
import { COLORS, RADIUS, SPACING, FONT_SIZE, SHADOW } from '@/constants/theme';

// 卡通世界地图（等距柱状投影，2:1）。图钉按经纬度百分比叠加，方位与世界地图一致。
const WORLD_MAP = require('../../assets/world-map.png');

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

/** 地图上的卡通图钉 */
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
        {
          left: `${spot.x}%`,
          top: `${spot.y}%`,
          transform: [{ scale }],
          zIndex: selected ? 999 : spot.visited ? 10 : 1,
        },
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
        {/* 卡通世界地图底图（等距柱状投影，2:1） */}
        <Image
          source={WORLD_MAP}
          style={styles.worldMap}
          resizeMode="stretch"
        />

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
    padding: SPACING.sm,
    ...SHADOW.soft,
  },
  mapSurface: {
    width: '100%',
    aspectRatio: 2,
    backgroundColor: '#DCEEFF',
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#BFEBFF',
  },
  worldMap: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    borderRadius: RADIUS.md,
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

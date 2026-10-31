/**
 * 纯 JS 渐变实现（需求 二：背景用柔和的渐变色）
 *
 * 为什么不用 expo-linear-gradient：
 *  本项目 package.json 声明 expo ~52.0.0 却搭配 expo-router ^57.0.4，
 *  依赖树存在 peer 冲突，新增原生模块会导致安装失败 / 构建风险。
 *  这里用「多色带插值」在纯 JS 下还原线性渐变，零依赖、跨端一致。
 *
 * 色带数量默认 56，柔和的粉彩色在 56 段下肉眼已连续，无明显条纹。
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** 在多个色标间按 t∈[0,1] 取样 */
function sampleGradient(stops: readonly string[], t: number): string {
  if (stops.length === 0) return 'transparent';
  if (stops.length === 1) return stops[0];
  const seg = (stops.length - 1) * Math.min(Math.max(t, 0), 1);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  return lerpColor(stops[i], stops[i + 1], seg - i);
}

interface GradientViewProps {
  colors: readonly string[];
  direction?: 'vertical' | 'horizontal';
  bands?: number;
  style?: ViewStyle;
  children?: React.ReactNode;
}

/** 通用渐变容器：铺满自身，children 绘制在渐变之上 */
export function GradientView({
  colors,
  direction = 'vertical',
  bands = 56,
  style,
  children,
}: GradientViewProps) {
  const key = colors.join(',');
  const bandColors = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < bands; i++) arr.push(sampleGradient(colors, (i + 0.5) / bands));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bands]);

  return (
    <View style={[styles.fill, style]}>
      <View
        style={[
          styles.absoluteFill,
          { flexDirection: direction === 'horizontal' ? 'row' : 'column' },
        ]}
      >
        {bandColors.map((c, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: c }} />
        ))}
      </View>
      {children}
    </View>
  );
}

// ── 天空装饰：星星 / 月亮 / 云朵 ──────────────────────────
interface SkyDecorProps {
  variant?: 'day' | 'night';
  /** 关闭可避免遮挡密集内容 */
  enabled?: boolean;
}

/**
 * 装饰散点：位置故意不规则（不像之前那样左右交替排成一列），
 * 字号也大小不一（16–48），并带轻微旋转，看起来像随手撒在天空里。
 * faint = 落在屏幕中央区域，压到很淡，避免挡住页面中的文字与动画。
 */
type DecorSpot = {
  top: `${number}%`;
  left: `${number}%`;
  size: number;
  rot: number;
  faint?: boolean;
};

const DECOR_SPOTS: DecorSpot[] = [
  { top: '3%', left: '8%', size: 24, rot: -12 },
  { top: '7%', left: '63%', size: 42, rot: 7 },
  { top: '14%', left: '30%', size: 16, rot: 16 },
  { top: '19%', left: '89%', size: 28, rot: -8 },
  { top: '27%', left: '1%', size: 38, rot: 11 },
  { top: '33%', left: '78%', size: 18, rot: -15, faint: true },
  { top: '41%', left: '14%', size: 30, rot: 6, faint: true },
  { top: '48%', left: '91%', size: 22, rot: -10 },
  { top: '57%', left: '5%', size: 44, rot: 9 },
  { top: '64%', left: '72%', size: 20, rot: -14, faint: true },
  { top: '72%', left: '24%', size: 26, rot: 13 },
  { top: '80%', left: '86%', size: 32, rot: -7 },
  { top: '88%', left: '52%', size: 18, rot: 10 },
  { top: '93%', left: '12%', size: 36, rot: -11 },
];

const DAY_DECOR = ['☁️', '⭐', '✨', '☁️', '🌤️', '🌟', '✨', '☁️', '🌟', '⭐', '✨', '☁️', '⭐', '✨'];
const NIGHT_DECOR = ['🌙', '⭐', '✨', '🌟', '✨', '⭐', '🌙', '🌟', '✨', '⭐', '🌙', '✨', '⭐', '🌟'];

export function SkyDecor({ variant = 'day', enabled = true }: SkyDecorProps) {
  if (!enabled) return null;
  const icons = variant === 'night' ? NIGHT_DECOR : DAY_DECOR;

  return (
    <View style={styles.absoluteFill} pointerEvents="none">
      {DECOR_SPOTS.map((spot, i) => (
        <View
          key={i}
          style={[
            styles.decorItem,
            { top: spot.top, left: spot.left, opacity: spot.faint ? 0.14 : 0.6 },
          ]}
        >
          <Text
            style={[
              styles.decorEmoji,
              { fontSize: spot.size, transform: [{ rotate: `${spot.rot}deg` }] },
            ]}
          >
            {icons[i % icons.length]}
          </Text>
        </View>
      ))}
    </View>
  );
}

interface GradientBackgroundProps extends GradientViewProps {
  /** 是否叠加星星/月亮/云朵装饰 */
  decor?: boolean;
  decorVariant?: 'day' | 'night';
}

/** 页面级柔和渐变背景（含卡通天空装饰） */
export function GradientBackground({
  colors,
  decor = true,
  decorVariant = 'day',
  style,
  children,
}: GradientBackgroundProps) {
  return (
    <GradientView colors={colors} style={style}>
      {decor && <SkyDecor variant={decorVariant} />}
      <View style={styles.fill}>{children}</View>
    </GradientView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // RN 0.86 起移除了 StyleSheet.absoluteFillObject，改为手写字面量，跨版本安全
  absoluteFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  decorItem: { position: 'absolute' },
  // 字号由每个散点单独决定（16–48），这里只保留兜底值
  decorEmoji: { fontSize: 30 },
});

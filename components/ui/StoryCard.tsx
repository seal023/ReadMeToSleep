/**
 * 故事卡片（需求 二：插图——每个故事配一张卡通封面图）
 *
 * 封面策略：渐变底 + 卡通动物 emoji 插画，按故事 id 稳定选取（同一故事每次一致）。
 * 这样完全离线可用、不依赖网络图床；若后续接入 Unsplash / AI 生成图，
 * 直接传 imageUri 即可替换（组件内已预留分支）。
 */

import React from 'react';
import { View, Text, Image, StyleSheet, ViewStyle } from 'react-native';
import { COLORS, FONT, FONT_SIZE, RADIUS, SHADOW, SPACING, pickCover } from '../../constants/theme';
import { GradientView } from './Gradient';
import { ElasticPressable } from './CartoonButton';

interface StoryCardProps {
  /** 用于稳定选取封面的种子（一般传故事 id） */
  seed: string;
  title: string;
  tags?: string[];
  /** 时长（秒），会自动格式化为「x分钟」 */
  duration?: number;
  onPress?: () => void;
  /** 可选：真实封面图（Unsplash / AI 生成），传入则替代渐变插画 */
  imageUri?: string;
  layout?: 'row' | 'grid';
  style?: ViewStyle;
}

function fmtDuration(sec?: number): string | null {
  if (!sec || sec <= 0) return null;
  return `${Math.max(1, Math.floor(sec / 60))} 分钟`;
}

export function StoryCard({
  seed,
  title,
  tags,
  duration,
  onPress,
  imageUri,
  layout = 'row',
  style,
}: StoryCardProps) {
  const cover = pickCover(seed);
  const dur = fmtDuration(duration);

  const coverNode = (
    <View style={layout === 'row' ? styles.coverRow : styles.coverGrid}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.coverImage} resizeMode="cover" />
      ) : (
        <GradientView colors={cover.gradient} style={styles.coverFill}>
          <View style={styles.coverCenter}>
            <Text style={layout === 'row' ? styles.coverEmoji : styles.coverEmojiGrid}>
              {cover.emoji}
            </Text>
          </View>
        </GradientView>
      )}
    </View>
  );

  const metaNode = (
    <View style={styles.tagRow}>
      {(tags ?? []).slice(0, 3).map((tag) => (
        <Text key={tag} style={styles.tag}>
          {tag}
        </Text>
      ))}
      {dur ? <Text style={styles.duration}>{dur}</Text> : null}
    </View>
  );

  if (layout === 'grid') {
    return (
      <ElasticPressable onPress={onPress} style={[styles.gridCard, style]} pressScale={0.95}>
        {coverNode}
        <View style={styles.gridBody}>
          <Text style={styles.gridTitle} numberOfLines={2}>
            {title}
          </Text>
          {metaNode}
        </View>
      </ElasticPressable>
    );
  }

  return (
    <ElasticPressable onPress={onPress} style={[styles.rowCard, style]} pressScale={0.96}>
      {coverNode}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {metaNode}
      </View>
      <View style={styles.playWrap}>
        <Text style={styles.playIcon}>▶️</Text>
      </View>
    </ElasticPressable>
  );
}

const styles = StyleSheet.create({
  // ── 行布局（故事库列表）────────────────────────────
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 12,
    marginBottom: SPACING.md,
    ...SHADOW.soft,
  },
  coverRow: {
    width: 66,
    height: 66,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    marginRight: 14,
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
    color: COLORS.text,
    fontFamily: FONT.rounded,
  },

  // ── 网格布局（首页推荐 / 横向滑动）──────────────────
  gridCard: {
    width: 168,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    marginRight: SPACING.md,
    ...SHADOW.soft,
  },
  coverGrid: {
    width: '100%',
    height: 112,
  },
  gridBody: { padding: 12 },
  gridTitle: {
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
    color: COLORS.text,
    fontFamily: FONT.rounded,
    marginBottom: 6,
  },

  // ── 封面通用 ───────────────────────────────────
  coverFill: { width: '100%', height: '100%' },
  coverCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverImage: { width: '100%', height: '100%' },
  coverEmoji: { fontSize: 32 },
  coverEmojiGrid: { fontSize: 48 },

  // ── 其它 ─────────────────────────────────────
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  tag: {
    fontSize: FONT_SIZE.tiny,
    color: COLORS.orange,
    backgroundColor: '#FFF1E2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    marginRight: 6,
    marginBottom: 4,
    overflow: 'hidden',
    fontWeight: '600',
  },
  duration: {
    fontSize: FONT_SIZE.tiny,
    color: COLORS.textLight,
    alignSelf: 'center',
  },
  playWrap: { marginLeft: SPACING.sm },
  playIcon: { fontSize: 20 },
});

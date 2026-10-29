/**
 * LevelCard —— 首页/设置页展示的等级进度卡（需求 5）
 *
 * 展示当前等级、通向下一级的进度、已听故事数与连续天数、已获得勋章。
 * 每次页面获得焦点都会重读 Progress，保证听完故事返回首页时数据是新的。
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, DimensionValue } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getProgress } from '../../services/storage';
import { getLevel, getNextLevel, getLevelProgress, BADGES } from '../../constants/rewards';
import type { Progress } from '../../types';
import { useLanguage } from '@/hooks/useLanguage';
import { COLORS, RADIUS, SPACING, FONT_SIZE, SHADOW } from '@/constants/theme';

interface LevelCardProps {
  /** 点击整卡时的回调（可选，用于跳转奖励详情） */
  onPress?: () => void;
}

export function LevelCard({ onPress }: LevelCardProps) {
  const { language: uiLang } = useLanguage();
  const isEn = uiLang === 'en';
  const [progress, setProgress] = useState<Progress | null>(null);

  const load = useCallback(async () => {
    try {
      setProgress(await getProgress());
    } catch {
      setProgress(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // 从故事页返回时刷新（useFocusEffect 的回调必须返回 void，不能直接传 async 函数）
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const listened = progress?.listenedStories.length ?? 0;
  const level = getLevel(listened);
  const next = getNextLevel(listened);
  const ratio = getLevelProgress(listened);
  const streak = progress?.streakDays ?? 0;
  const ownedBadges = BADGES.filter((b) => progress?.badges.includes(b.id));

  // 百分比字符串需显式标注为 DimensionValue，否则 TS 会推断成普通 string 而报错
  const fillWidth: DimensionValue = `${Math.round(ratio * 100)}%`;

  // 等级名与进度文案随界面语言切换（rewards.ts 已备 nameEn）
  const levelName = isEn ? level.nameEn : level.name;
  const statText = isEn
    ? `Heard ${listened} stories${streak > 0 ? ` · ${streak}-day streak 🔥` : ''}`
    : `已听 ${listened} 个故事${streak > 0 ? ` · 连续 ${streak} 天 🔥` : ''}`;
  const progressHint = next
    ? isEn
      ? `Listen to ${Math.max(0, next.need - listened)} more to level up to ${next.nameEn} ${next.emoji}`
      : `再听 ${Math.max(0, next.need - listened)} 个故事升级为「${next.name}」${next.emoji}`
    : isEn
      ? 'You have reached the highest level! 👑'
      : '已是最高等级，你太棒了！👑';

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={onPress ? 0.85 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.topRow}>
        <View style={styles.badgeBox}>
          <Text style={styles.levelEmoji}>{level.emoji}</Text>
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.levelName}>
            Lv.{level.level} · {levelName}
          </Text>
          <Text style={styles.statText}>{statText}</Text>
        </View>
      </View>

      {/* 升级进度条 */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: fillWidth }]} />
      </View>
      <Text style={styles.progressHint}>{progressHint}</Text>

      {/* 已获得勋章 */}
      {ownedBadges.length > 0 && (
        <View style={styles.badgeRow}>
          {ownedBadges.map((b) => (
            <View key={b.id} style={styles.badgeChip}>
              <Text style={styles.badgeChipEmoji}>{b.emoji}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginHorizontal: 24,
    marginBottom: 16,
    ...SHADOW.soft,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  badgeBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFF6DC',
    borderWidth: 2.5,
    borderColor: '#FFC94D',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  levelEmoji: {
    fontSize: 26,
  },
  infoBox: {
    flex: 1,
  },
  levelName: {
    fontSize: FONT_SIZE.body,
    fontWeight: '800',
    color: COLORS.text,
  },
  statText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    marginTop: 2,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F0E4D8',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: COLORS.orange,
  },
  progressHint: {
    fontSize: FONT_SIZE.tiny,
    color: COLORS.textSub,
    marginTop: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACING.sm,
  },
  badgeChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFF9F2',
    borderWidth: 1,
    borderColor: COLORS.divider,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  badgeChipEmoji: {
    fontSize: 17,
  },
});

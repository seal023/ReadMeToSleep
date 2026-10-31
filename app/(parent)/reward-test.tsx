/**
 * 🧪 奖励测试（家长模式内，仅测试用）
 * ---------------------------------------------------------------------------
 * 目的：等级阶梯（3/8/15/25/40/60）与勋章（听 1/10/30、连续 3/7 天、打卡 3 次）
 * 需要「听完很多故事」才能触达，逐条试听成本极高。本页直接改写本机 Progress，
 * 让你把计数推进到目标前一位，再听一条真实故事即可看到升级 / 勋章动画；
 * 同时可一键预览两种庆祝动效，完全不必听故事。
 *
 * ⚠️ 仅测试用，上架前可整体移除本文件 + 家长中心对应入口卡片。
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { RewardAnimation } from '../../components/ui/RewardAnimation';
import { getProgress, saveProgress } from '../../services/storage';
import { BADGES, LEVELS, getLevel, getNextLevel, getNewBadges } from '../../constants/rewards';
import type { Progress } from '../../types';
import { COLORS } from '../../constants/theme';

interface PreviewState {
  visible: boolean;
  emoji: string;
  title: string;
  subtitle: string;
  desc?: string;
}

const EMPTY_PREVIEW: PreviewState = { visible: false, emoji: '', title: '', subtitle: '' };

/** 生成 n 条测试打卡（用可识别的「🧪测试打卡点」命名，方便一眼认出是测试数据） */
function makeTestCheckIns(n: number): Progress['checkIns'] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => ({
    location: `🧪测试打卡点${i + 1}`,
    date: new Date().toISOString(),
    storyId: `test_ci_${i + 1}`,
  }));
}

export default function RewardTestScreen() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);

  const load = useCallback(async () => {
    try {
      setProgress(await getProgress());
    } catch {
      setProgress(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const persist = async (p: Progress) => {
    await saveProgress(p);
    setProgress({ ...p });
  };

  // ---- 已听故事数（等级依据）----
  const setListened = async (n: number) => {
    const p = await getProgress();
    p.listenedStories = Array.from({ length: Math.max(0, n) }, (_, i) => `test_story_${i + 1}`);
    await persist(p);
  };
  const addListened = async (d: number) => {
    const p = await getProgress();
    const target = Math.max(0, p.listenedStories.length + d);
    p.listenedStories = Array.from({ length: target }, (_, i) => `test_story_${i + 1}`);
    await persist(p);
  };

  // ---- 连续天数 ----
  const setStreak = async (n: number) => {
    const p = await getProgress();
    p.streakDays = Math.max(0, n);
    p.lastListenDate = new Date().toISOString().slice(0, 10);
    await persist(p);
  };
  const addStreak = async (d: number) => {
    const p = await getProgress();
    p.streakDays = Math.max(0, (p.streakDays || 0) + d);
    await persist(p);
  };

  // ---- 打卡次数 ----
  const setCheckIns = async (n: number) => {
    const p = await getProgress();
    p.checkIns = makeTestCheckIns(n);
    await persist(p);
  };
  const addCheckIns = async (d: number) => {
    const p = await getProgress();
    p.checkIns = makeTestCheckIns(p.checkIns.length + d);
    await persist(p);
  };

  // ---- 一键解锁全部勋章（故事 / 连续 / 旅行）----
  const unlockAll = async () => {
    const p = await getProgress();
    const fresh = getNewBadges(
      {
        listenedCount: Math.max(p.listenedStories.length, 30),
        streakDays: Math.max(p.streakDays, 7),
        checkInCount: Math.max(p.checkIns.length, 3),
      },
      p.badges,
    );
    p.badges = Array.from(new Set([...p.badges, ...fresh.map((b) => b.id)]));
    await persist(p);
  };

  // ---- 重置奖励进度 ----
  const resetProgress = () => {
    Alert.alert(
      '重置奖励进度？',
      '会清空已听故事、连续天数、打卡与勋章（不可恢复，仅测试用）',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '重置',
          style: 'destructive',
          onPress: async () => {
            await persist({
              listenedStories: [],
              listenLog: [],
              checkIns: [],
              badges: [],
              streakDays: 0,
              lastListenDate: '',
            });
          },
        },
      ]
    );
  };

  // ---- 动效预览（不必听故事）----
  const previewLevelUp = () => {
    const lv = LEVELS[2]; // 勇敢小树
    setPreview({
      visible: true,
      emoji: lv.emoji,
      title: '升级啦！',
      subtitle: `Lv.${lv.level} · ${lv.name}`,
      desc: '继续听故事，解锁更多惊喜',
    });
  };
  const previewBadge = () => {
    const b = BADGES[1]; // 小小书虫
    setPreview({
      visible: true,
      emoji: b.emoji,
      title: '获得新勋章！',
      subtitle: b.name,
      desc: b.desc,
    });
  };

  const listened = progress?.listenedStories.length ?? 0;
  const level = getLevel(listened);
  const next = getNextLevel(listened);
  const streak = progress?.streakDays ?? 0;
  const checkIns = progress?.checkIns.length ?? 0;
  const owned = progress?.badges ?? [];

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>🧪 奖励测试</Text>
        <Text style={styles.subtitle}>
          仅测试用：直接推进计数，不必逐个听完故事。上架前可删掉此页。
        </Text>

        {/* 当前状态 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>当前状态</Text>
          <Text style={styles.stat}>已听故事：{listened} 个</Text>
          <Text style={styles.stat}>
            当前等级：Lv.{level.level} {level.emoji} {level.name}
          </Text>
          <Text style={styles.stat}>
            下一级：{next ? `${next.name}（需 ${next.need} 个）` : '已满级 👑'}
          </Text>
          <Text style={styles.stat}>连续天数：{streak} 天</Text>
          <Text style={styles.stat}>打卡次数：{checkIns} 次</Text>
          <Text style={styles.stat}>已获勋章：{owned.length} 个</Text>
        </View>

        {/* 已听故事数 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>已听故事数（等级依据）</Text>
          <Text style={styles.hint}>
            想测某级升级动画：把数量设到「目标 − 1」，再点进任意故事听完，即可触发升级动画。
          </Text>
          <View style={styles.btnRow}>
            {[0, 2, 7, 14, 24, 39, 59].map((n) => (
              <TouchableOpacity key={n} style={styles.chip} onPress={() => setListened(n)}>
                <Text style={styles.chipText}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.chipPrimary} onPress={() => addListened(1)}>
              <Text style={styles.chipPrimaryText}>+1</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.chipPrimary} onPress={() => addListened(5)}>
              <Text style={styles.chipPrimaryText}>+5</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 连续天数 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>连续天数（🔥 连续 3 / 7 天勋章）</Text>
          <View style={styles.btnRow}>
            {[0, 2, 6].map((n) => (
              <TouchableOpacity key={n} style={styles.chip} onPress={() => setStreak(n)}>
                <Text style={styles.chipText}>{n} 天</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.chipPrimary} onPress={() => addStreak(1)}>
              <Text style={styles.chipPrimaryText}>+1</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 打卡次数 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>打卡次数（🗺️ 旅行勋章 / 打卡奖章）</Text>
          <Text style={styles.hint}>
            生成的打卡会以「🧪测试打卡点」命名，重置可一并清除。
          </Text>
          <View style={styles.btnRow}>
            {[0, 2, 6, 14].map((n) => (
              <TouchableOpacity key={n} style={styles.chip} onPress={() => setCheckIns(n)}>
                <Text style={styles.chipText}>{n} 次</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.chipPrimary} onPress={() => addCheckIns(1)}>
              <Text style={styles.chipPrimaryText}>+1</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 勋章 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>勋章</Text>
          <Text style={styles.hint}>
            一键解锁全部故事 / 连续 / 旅行勋章；可在首页等级卡与「我的故事 · 旅行打卡」勋章墙查看。
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={unlockAll}>
            <Text style={styles.primaryText}>🎖 解锁全部勋章</Text>
          </TouchableOpacity>
        </View>

        {/* 动效预览 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>动效预览（不必听故事）</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.primaryBtn} onPress={previewLevelUp}>
              <Text style={styles.primaryText}>▶ 升级动画</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={previewBadge}>
              <Text style={styles.primaryText}>▶ 勋章动画</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 重置 */}
        <TouchableOpacity style={styles.dangerBtn} onPress={resetProgress}>
          <Text style={styles.dangerText}>🗑 重置奖励进度</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>
          提示：这些数据只影响本机测试进度，卸载重装即完全清空。
        </Text>
      </ScrollView>

      <RewardAnimation
        visible={preview.visible}
        emoji={preview.emoji}
        title={preview.title}
        subtitle={preview.subtitle}
        desc={preview.desc}
        onDone={() => setPreview(EMPTY_PREVIEW)}
      />
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 48 },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    color: COLORS.text,
    marginTop: 8,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12,
    color: '#8D6E63',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
    elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  stat: { fontSize: 13, color: '#5D4037', marginBottom: 4 },
  hint: { fontSize: 12, color: '#8D6E63', lineHeight: 18, marginBottom: 10 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minWidth: 52,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#F0D9B5',
    alignItems: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#5D4037' },
  chipPrimary: {
    minWidth: 52,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#FFE0D6',
    borderWidth: 1,
    borderColor: '#FF8A65',
    alignItems: 'center',
  },
  chipPrimaryText: { fontSize: 13, fontWeight: '700', color: '#FF5722' },
  primaryBtn: {
    backgroundColor: '#FF8A65',
    borderRadius: 18,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  primaryText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  dangerBtn: {
    backgroundColor: '#FFF0ED',
    borderRadius: 18,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFCDD2',
    marginTop: 4,
  },
  dangerText: { fontSize: 14, fontWeight: '700', color: '#D9534F' },
  footer: { fontSize: 11, color: '#B0A395', textAlign: 'center', marginTop: 16, lineHeight: 16 },
});

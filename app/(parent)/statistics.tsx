import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT } from '../../constants/theme';
import { getProgress, getStories, getChildQAs, type ChildQA } from '../../services/storage';
import type { Story } from '../../types';

const RACCO_IDLE_SIZE = 80;

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function localDateStr(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localMonthStr(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthLabel(monthStr: string) {
  return `${parseInt(monthStr.split('-')[1], 10)}月`;
}

interface StatCard {
  icon: string;
  label: string;
  value: number | string;
}

export default function StatisticsPage() {
  const [loaded, setLoaded] = useState(false);
  const [cards, setCards] = useState<StatCard[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [monthlyCounts, setMonthlyCounts] = useState<number[]>([]);
  const [todayList, setTodayList] = useState<{ title: string; time: string }[]>([]);
  const [historyList, setHistoryList] = useState<{ title: string; date: string }[]>([]);
  const [childQAs, setChildQAs] = useState<ChildQA[]>([]);

  useEffect(() => {
    (async () => {
      const p = await getProgress();
      const stories: Story[] = await getStories();
      const log = p.listenLog || [];

      const aiCount = stories.filter((s) => s.type === 'ai_generated').length;
      const recordingCount = stories.filter((s) => (s.type as string) === 'recording' || !!s.audioUri).length;

      setCards([
        { icon: '📖', label: '总听故事数', value: p.listenedStories.length },
        { icon: '🤖', label: 'AI生成故事数', value: aiCount },
        { icon: '✈️', label: '旅行打卡次数', value: p.checkIns.length },
        { icon: '🎙️', label: '孩子录音数', value: recordingCount },
        { icon: '🔥', label: '连续打卡天数', value: p.streakDays },
        { icon: '🏅', label: '已获得勋章数', value: p.badges.length },
      ]);

      // 最近 7 个月
      const now = new Date();
      const ms: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        ms.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
      }
      setMonths(ms);
      setMonthlyCounts(ms.map((m) => log.filter((l) => localMonthStr(l.at) === m).length));

      // 今日收听
      const todayStr = localDateStr(new Date().toISOString());
      setTodayList(
        log
          .filter((l) => localDateStr(l.at) === todayStr)
          .map((l) => ({
            title: l.title || '未命名故事',
            time: new Date(l.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          })),
      );

      // 历史记录（最新在前，最多 50 条）
      setHistoryList(
        log.slice(0, 50).map((l) => ({
          title: l.title || '未命名故事',
          date: new Date(l.at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        })),
      );

      // 孩子提问（最新在前）
      setChildQAs(await getChildQAs());

      setLoaded(true);
    })();
  }, []);

  const maxCount = Math.max(1, ...monthlyCounts);

  return (
    <CartoonScreen gradient="candy" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.raccoTop}>
          <Racco state="idle" size={RACCO_IDLE_SIZE} />
          <Text style={styles.raccoLabel}>让我来看看你的数据！</Text>
        </View>

        {!loaded ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.purple} />
            <Text style={styles.loadingText}>正在读取数据…</Text>
          </View>
        ) : (
          <>
            {/* Stats Grid */}
            <Text style={styles.sectionTitle}>数据统计</Text>
            <View style={styles.grid}>
              {cards.map((card, i) => (
                <View key={i} style={styles.card}>
                  <Text style={styles.cardIcon}>{card.icon}</Text>
                  <Text style={styles.cardValue}>{card.value}</Text>
                  <Text style={styles.cardLabel}>{card.label}</Text>
                </View>
              ))}
            </View>

            {/* Monthly Bar Chart */}
            <Text style={styles.sectionTitle}>每月听故事数</Text>
            <View style={styles.chartContainer}>
              <View style={styles.chartArea}>
                {months.map((m, i) => {
                  const height = (monthlyCounts[i] / maxCount) * 120;
                  return (
                    <View key={i} style={styles.barGroup}>
                      <View style={[styles.bar, { height: Math.max(monthlyCounts[i] > 0 ? 6 : 0, height) }]} />
                      <Text style={styles.barLabel}>{monthLabel(m)}</Text>
                      <Text style={styles.barValue}>{monthlyCounts[i]}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* 今日收听 */}
            <Text style={styles.sectionTitle}>🌞 今日收听</Text>
            <View style={styles.listCard}>
              {todayList.length === 0 ? (
                <Text style={styles.emptyText}>今天还没有听故事哦～</Text>
              ) : (
                todayList.map((it, i) => (
                  <View key={i} style={styles.listRow}>
                    <Text style={styles.listDot}>🎧</Text>
                    <Text style={styles.listTitle} numberOfLines={1}>{it.title}</Text>
                    <Text style={styles.listMeta}>{it.time}</Text>
                  </View>
                ))
              )}
            </View>

            {/* 历史记录 */}
            <Text style={styles.sectionTitle}>📚 历史记录</Text>
            <View style={styles.listCard}>
              {historyList.length === 0 ? (
                <Text style={styles.emptyText}>还没有收听记录</Text>
              ) : (
                historyList.map((it, i) => (
                  <View key={i} style={[styles.listRow, i < historyList.length - 1 && styles.listRowBorder]}>
                    <Text style={styles.listDot}>📖</Text>
                    <Text style={styles.listTitle} numberOfLines={1}>{it.title}</Text>
                    <Text style={styles.listMeta}>{it.date}</Text>
                  </View>
                ))
              )}
            </View>

            {/* 孩子提问（后台可见） */}
            <Text style={styles.sectionTitle}>💬 孩子提问</Text>
            <View style={styles.listCard}>
              {childQAs.length === 0 ? (
                <Text style={styles.emptyText}>孩子还没有提问哦～</Text>
              ) : (
                childQAs.slice(0, 20).map((q, i) => (
                  <View key={q.id} style={[styles.qaRow, i < childQAs.slice(0, 20).length - 1 && styles.listRowBorder]}>
                    <Text style={styles.qaQ}>🧒 {q.question}</Text>
                    <Text style={styles.qaA}>🤖 {q.answer}</Text>
                    <Text style={styles.qaMeta}>{q.storyTitle} · {new Date(q.at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  raccoTop: { alignItems: 'center', marginBottom: 16 },
  raccoLabel: { fontSize: 14, color: COLORS.textSub, marginTop: 4 },
  loadingWrap: { alignItems: 'center', paddingVertical: 60 },
  loadingText: { fontSize: 14, color: COLORS.textSub, marginTop: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: COLORS.purple, marginVertical: 12, fontFamily: FONT.rounded },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 12 },
  card: { width: '48%', backgroundColor: COLORS.card, borderRadius: 18, padding: 16, marginBottom: 12, alignItems: 'center' },
  cardIcon: { fontSize: 28, marginBottom: 4 },
  cardValue: { fontSize: 26, fontWeight: 'bold', color: COLORS.purple },
  cardLabel: { fontSize: 12, color: COLORS.textSub, marginTop: 2 },
  chartContainer: { backgroundColor: COLORS.card, borderRadius: 18, padding: 16, marginBottom: 12 },
  chartArea: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 140 },
  barGroup: { alignItems: 'center', flex: 1 },
  bar: { width: 20, backgroundColor: COLORS.purple, borderRadius: 6, marginBottom: 4 },
  barLabel: { fontSize: 10, color: COLORS.textSub },
  barValue: { fontSize: 10, fontWeight: '600', color: COLORS.purple, marginBottom: 2 },
  listCard: { backgroundColor: COLORS.card, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 4, marginBottom: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  listRowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  listDot: { fontSize: 18, marginRight: 10 },
  listTitle: { flex: 1, fontSize: 15, color: COLORS.text },
  listMeta: { fontSize: 13, color: COLORS.textSub, marginLeft: 8 },
  qaRow: { paddingVertical: 12 },
  qaQ: { fontSize: 15, color: COLORS.text, fontWeight: '600', lineHeight: 22 },
  qaA: { fontSize: 14, color: COLORS.purple, lineHeight: 22, marginTop: 4 },
  qaMeta: { fontSize: 12, color: COLORS.textSub, marginTop: 4 },
  emptyText: { textAlign: 'center', paddingVertical: 24, color: COLORS.textLight, fontSize: 14 },
});

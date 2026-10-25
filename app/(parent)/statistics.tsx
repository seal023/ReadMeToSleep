import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT } from '../../constants/theme';

// Placeholder data source — replace with actual storage calls in production
// const progress = await storage.getProgress();
// const stories   = await storage.getStories();

interface StatCard {
  icon: string;
  label: string;
  value: number | string;
}

const CARDS: StatCard[] = [
  { icon: '📖', label: '总听故事数', value: 128 },
  { icon: '🤖', label: 'AI生成故事数', value: 42 },
  { icon: '✈️', label: '旅行打卡次数', value: 15 },
  { icon: '🎙️', label: '孩子录音数', value: 36 },
  { icon: '🔥', label: '连续打卡天数', value: 7 },
  { icon: '🏅', label: '已获得勋章数', value: 5 },
];

const MONTHLY_DATA = [
  { month: '1月', stories: 8, records: 2 },
  { month: '2月', stories: 12, records: 3 },
  { month: '3月', stories: 15, records: 4 },
  { month: '4月', stories: 18, records: 5 },
  { month: '5月', stories: 22, records: 6 },
  { month: '6月', stories: 28, records: 8 },
  { month: '7月', stories: 25, records: 7 },
];

const MAX_STORIES = Math.max(...MONTHLY_DATA.map((d) => d.stories));

// Racco idle size=80 在顶部
const RACCO_IDLE_SIZE = 80;

export default function StatisticsPage() {
  return (
    <CartoonScreen gradient="candy" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Racco idle at top */}
      <View style={styles.raccoTop}>
        <Racco state="idle" size={RACCO_IDLE_SIZE} />
        <Text style={styles.raccoLabel}>让我来看看你的数据！</Text>
      </View>

      {/* Stats Grid */}
      <Text style={styles.sectionTitle}>数据统计</Text>
      <View style={styles.grid}>
        {CARDS.map((card, i) => (
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
          {MONTHLY_DATA.map((d, i) => {
            const height = (d.stories / MAX_STORIES) * 120;
            return (
              <View key={i} style={styles.barGroup}>
                <View style={[styles.bar, { height }]} />
                <Text style={styles.barLabel}>{d.month}</Text>
                <Text style={styles.barValue}>{d.stories}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Record Counts Horizontal Scroll */}
      <Text style={styles.sectionTitle}>每月打卡记录</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll}>
        {MONTHLY_DATA.map((d, i) => (
          <View key={i} style={styles.hBarCard}>
            <Text style={styles.hBarMonth}>{d.month}</Text>
            <View style={[styles.hBarTrack, { width: 100 }]}>
              <View style={[styles.hBarFill, { width: `${(d.records / 10) * 100}%` }]} />
            </View>
            <Text style={styles.hBarCount}>{d.records} 次</Text>
          </View>
        ))}
      </ScrollView>

      {/* Data Source Note */}
      <Text style={styles.sourceNote}>
        数据来源：storage.getProgress() + storage.getStories()
      </Text>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  raccoTop: { alignItems: 'center', marginBottom: 16 },
  raccoLabel: { fontSize: 14, color: COLORS.textSub, marginTop: 4 },
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
  hScroll: { marginBottom: 12, paddingLeft: 4 },
  hBarCard: { backgroundColor: COLORS.card, borderRadius: 14, padding: 12, marginRight: 12, alignItems: 'center', minWidth: 90 },
  hBarMonth: { fontSize: 12, color: COLORS.text, marginBottom: 6 },
  hBarTrack: { height: 10, backgroundColor: COLORS.purpleLight, borderRadius: 5, overflow: 'hidden' },
  hBarFill: { height: '100%', backgroundColor: COLORS.mint, borderRadius: 5 },
  hBarCount: { fontSize: 11, color: COLORS.mint, marginTop: 4, fontWeight: '600' },
  sourceNote: { fontSize: 11, color: COLORS.textLight, textAlign: 'center', marginTop: 8 },
});

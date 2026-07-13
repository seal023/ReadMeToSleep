import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useWindowDimensions, View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';

interface CardDef {
  icon: string;
  title: string;
  desc: string;
  action: () => void;
}

export default function ParentHub() {
  const router = useRouter();
  const w = useWindowDimensions().width;
  const GAP = 12;
  const PAD = 32;
  const cardWidth = useMemo(() => (w - PAD - GAP) / 2, [w]);

  const CARDS: CardDef[] = useMemo(() => [
    { icon: '🛡️', title: '敏感词管理', desc: '管理睡眠内容的敏感词汇过滤', action: () => router.push('/(parent)/sensitive-words') },
    { icon: '🎤', title: '孩子录音收听', desc: '收听孩子在应用中的语音记录', action: () => router.push('/(parent)/child-recordings') },
    { icon: '🔊', title: '声音克隆', desc: '克隆自定义哄睡声源', action: () => router.push('/(parent)/voice-clone') },
    { icon: '💳', title: '订阅管理', desc: '查看和续费会员订阅', action: () => router.push('/(parent)/subscription') },
    { icon: '📊', title: '使用统计', desc: '查看使用情况与数据统计', action: () => router.push('/(parent)/statistics') },
    { icon: '🚪', title: '退出登录', desc: '退出家长模式', action: () => {
      Alert.alert('确认退出', '确定要退出吗？', [
        { text: '取消' },
        { text: '退出', style: 'destructive', onPress: () => router.back() },
      ]);
    }},
  ], [router]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.racco}>🦝</Text>
      <Text style={styles.header}>家长模式</Text>
      <View style={[styles.grid]}>
        {CARDS.map((card, i) => (
          <TouchableOpacity key={i} style={[styles.card, { width: cardWidth }]} onPress={card.action}>
            <Text style={styles.icon}>{card.icon}</Text>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.desc}>{card.desc}</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5E6' },
  scrollContent: { paddingBottom: 32 },
  racco: { fontSize: 80, textAlign: 'center', paddingTop: 16, marginBottom: 4 },
  header: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', color: '#333', marginBottom: 20 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    minHeight: 120,
    position: 'relative',
  },
  icon: { fontSize: 36, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#222', marginBottom: 4 },
  desc: { fontSize: 13, color: '#888', flex: 1 },
  arrow: { position: 'absolute', bottom: 20, right: 20, fontSize: 24, color: '#ccc' },
});

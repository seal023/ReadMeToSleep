import { useMemo } from 'react';
import { router } from 'expo-router';
import { useWindowDimensions, View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT } from '../../constants/theme';

interface CardDef {
  icon: string;
  title: string;
  desc: string;
  href?: string;
  action?: () => void;
}

// 家长页专属小浣熊：挥手 + 抱月亮 + 腮红，比默认图更可爱（透明背景 PNG）
const PARENT_RACCOON = require('../../assets/raccoon-parent.png');

export default function ParentHub() {
  const w = useWindowDimensions().width;
  const cardWidth = useMemo(() => (w - 64 - 12) / 2, [w]);

  const CARDS: CardDef[] = useMemo(() => [
    { icon: '🛡️', title: '敏感词管理', desc: '管理睡眠内容的敏感词汇过滤', href: '/(parent)/sensitive-words' },
    { icon: '😴', title: '睡眠定时', desc: '到点自动停止播放，防止孩子睡着后还在听', href: '/(parent)/sleep-timer' },
    { icon: '🎤', title: '孩子录音收听', desc: '收听孩子在应用中的语音记录', href: '/(parent)/child-recordings' },
    { icon: '🔊', title: '声音克隆', desc: '克隆自定义哄睡声源', href: '/(parent)/voice-clone' },
    { icon: '💳', title: '订阅管理', desc: '查看和续费会员订阅', href: '/(parent)/subscription' },
    { icon: '📊', title: '使用统计', desc: '查看使用情况与数据统计', href: '/(parent)/statistics' },
    { icon: '💌', title: '给孩子写悄悄话', desc: '给某篇故事写下专属鼓励', href: '/(parent)/parent-comments' },
    { icon: '🚪', title: '退出登录', desc: '退出家长模式', action: () => {
      Alert.alert('确认退出', '确定要退出吗？', [
        { text: '取消' },
        { text: '退出', style: 'destructive', onPress: () => router.back() },
      ]);
    }},
  ], []);

  const handleCardPress = (card: CardDef) => {
    if (card.href) {
      router.push(card.href);
    } else if (card.action) {
      card.action();
    }
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        {/* 封面英雄区：柔和光晕 + 星星点缀 + 更大的小浣熊，比原来单张小图更亲切 */}
        <View style={styles.hero}>
          <View style={styles.heroGlow} pointerEvents="none" />
          <Racco state="idle" size={150} source={PARENT_RACCOON} />
        </View>
        <Text style={styles.header}>家长模式</Text>
        <Text style={styles.headerSub}>在这里管理声音、睡眠时长与孩子的收听记录</Text>
        <View style={styles.grid}>
          {CARDS.map((card, i) => (
            <TouchableOpacity key={i} style={{ ...styles.card, width: cardWidth }} onPress={() => handleCardPress(card)}>
              <Text style={styles.icon}>{card.icon}</Text>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.desc}>{card.desc}</Text>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  raccoWrap: { alignItems: 'center', paddingTop: 16, marginBottom: 4 },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
    paddingBottom: 6,
    position: 'relative',
  },
  heroGlow: {
    position: 'absolute',
    top: 8,
    width: 178,
    height: 178,
    borderRadius: 89,
    backgroundColor: 'rgba(255, 203, 92, 0.34)',
  },
  header: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', color: COLORS.text, marginBottom: 6, fontFamily: FONT.rounded },
  headerSub: {
    fontSize: 13,
    textAlign: 'center',
    color: COLORS.textSub,
    marginBottom: 18,
    paddingHorizontal: 24,
    lineHeight: 19,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 20,
    marginVertical: 6,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
    elevation: 3,
    minHeight: 120,
    position: 'relative',
  },
  icon: { fontSize: 36, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  desc: { fontSize: 13, color: COLORS.textSub, flex: 1 },
  arrow: { position: 'absolute', bottom: 20, right: 20, fontSize: 24, color: COLORS.textLight },
});

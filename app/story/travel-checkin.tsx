import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Animated, Dimensions, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getProgress, saveProgress } from '../../services/storage';
import { checkCheckInGate } from '../../services/entitlement';
import Racco from '../../components/common/Racco';
import { useLanguage } from '../../hooks/useLanguage';
import { useEntitlement } from '../../hooks/useEntitlement';
import type { Language } from '../../types';

const { width } = Dimensions.get('window');

type Step = 'locate' | 'generate' | 'play' | 'success';

const LOCATIONS = [
  { cn: '北京市', place: '故宫', en: 'Beijing · Forbidden City' },
  { cn: '上海市', place: '外滩', en: 'Shanghai · The Bund' },
  { cn: '西安市', place: '兵马俑', en: "Xi'an · Terracotta Warriors" },
  { cn: '成都市', place: '大熊猫基地', en: 'Chengdu · Panda Base' },
  { cn: '杭州市', place: '西湖', en: 'Hangzhou · West Lake' },
  { cn: '桂林市', place: '漓江', en: 'Guilin · Li River' },
  { cn: '拉萨市', place: '布达拉宫', en: 'Lhasa · Potala Palace' },
  { cn: '大理市', place: '洱海', en: 'Dali · Erhai Lake' },
];

const STORIES: Record<string, { title: string; content: string }> = {
  '故宫': {
    title: '红墙里的月亮船',
    content: '深夜，月光洒在故宫的红墙上，一只小狸猫悄悄溜进太和殿。它发现每块地砖下都藏着一段被遗忘的故事……',
  },
  '外滩': {
    title: '黄浦江的星光',
    content: '小男孩站在外滩的栏杆旁，看着江水倒映的霓虹灯。突然一颗星星落进江里，化作一条发光的小鱼……',
  },
  '兵马俑': {
    title: '地下军队的秘密',
    content: '博物馆闭馆后，兵马俑们伸了伸懒腰，开始了他们每晚的巡逻。新来的陶俑编号734号，第一次站岗……',
  },
  '大熊猫基地': {
    title: '滚滚的竹林梦',
    content: '小熊猫竹宝在竹林里做了一个梦——梦见自己长出了翅膀，飞过了整座青城山……',
  },
  '西湖': {
    title: '断桥上的小纸船',
    content: '一只纸船从断桥出发，顺着水流漂过三潭印月，船上坐着一只用荷叶做成斗笠的小青蛙……',
  },
  '漓江': {
    title: '山水画的守护者',
    content: '漓江水中有座小石山，山上住着一只水獭爷爷。他每天都会把路人丢的垃圾叼到岸边，说这是他的职责……',
  },
  '布达拉宫': {
    title: '高原上的风铃',
    content: '布达拉宫的屋顶挂着一串风铃，每当风吹过，它就会唱起古老的藏歌，歌声飘到雪山脚下……',
  },
  '洱海': {
    title: '海底的月亮集市',
    content: '洱海的水底有个集市，每月十五满月时才会开放。小鱼小虾都带着发光的贝壳去赶集……',
  },
};

const BADGE_RULES = [
  { count: 1, emoji: '🚩', label: { zh: '首次打卡', en: 'First Check-in' } },
  { count: 3, emoji: '🏅', label: { zh: '三城达人', en: '3 Cities' } },
  { count: 7, emoji: '🥈', label: { zh: '七城行者', en: '7 Cities' } },
  { count: 15, emoji: '🥇', label: { zh: '十五城传奇', en: '15 Cities Legend' } },
];

const stepConfig: { key: Step; icon: string; label: string }[] = [
  { key: 'locate', icon: '📍', label: '定位' },
  { key: 'generate', icon: '✨', label: '生成' },
  { key: 'play', icon: '📖', label: '播放' },
  { key: 'success', icon: '✅', label: '打卡' },
];

export default function TravelCheckinScreen() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [step, setStep] = useState<Step>('locate');
  const [location, setLocation] = useState('');
  const [story, setStory] = useState<{ title: string; content: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [badge, setBadge] = useState<{ emoji: string; label: string } | null>(null);
  const [confetti, setConfetti] = useState<{ x: number; color: string; delay: number }[]>([]);
  const confettiAnims = useRef<Animated.Value[]>([]);
  const { snapshot, refresh, showPaywall } = useEntitlement();

  // Generate confetti
  useEffect(() => {
    if (step === 'success') {
      const items = Array.from({ length: 20 }, () => ({
        x: Math.random() * width,
        color: ['#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#DDA0DD'][Math.floor(Math.random() * 5)],
        delay: Math.random() * 1000,
      }));
      setConfetti(items);
      confettiAnims.current = items.map(() => new Animated.Value(0));
    }
  }, [step]);

  // Animate confetti
  useEffect(() => {
    if (step !== 'success' || confetti.length === 0) return;
    const animations = confetti.map((_, i) =>
      Animated.timing(confettiAnims.current[i], {
        toValue: 1, duration: 1500, delay: confetti[i].delay,
        useNativeDriver: false,
      })
    );
    Animated.parallel(animations).start();
  }, [step, confetti]);

  // Simulate location
  const handleStart = async () => {
    // 打卡额度门禁（会员不限）。放在流程入口，避免用户走完一圈才发现不能打卡
    const gate = await checkCheckInGate();
    if (!showPaywall(gate)) return;

    const loc = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
    setLocation(language === 'en' ? loc.en : `${loc.cn}·${loc.place}`);
    setStep('generate');
    // Simulate story generation (2s)
    setTimeout(() => {
      setStory(STORIES[loc.place] || { title: '旅途奇遇', content: '一段关于旅行的奇妙故事……' });
      setStep('play');
    }, 2000);
  };

  // Play story (simulate)
  const handlePlay = () => {
    setIsPlaying(true);
    setTimeout(() => {
      setIsPlaying(false);
      handleCheckIn();
    }, 1500);
  };

  // Check-in
  const handleCheckIn = async () => {
    const progress = await getProgress();
    const checkIn = { location, date: new Date().toISOString(), storyId: `travel_${Date.now()}` };
    const newCheckIns = [...progress.checkIns, checkIn];
    const total = newCheckIns.length;

    // Determine new badge
    let newBadge: { emoji: string; label: string } | null = null;
    for (const rule of BADGE_RULES) {
      if (total >= rule.count && !progress.badges.includes(rule.emoji)) {
        newBadge = { emoji: rule.emoji, label: rule.label[language] };
      }
    }

    const newBadges = newBadge ? [...progress.badges, newBadge.emoji] : progress.badges;
    await saveProgress({ ...progress, checkIns: newCheckIns, badges: newBadges });
    await refresh();

    setBadge(newBadge);
    setStep('success');
  };

  // Step indicator
  const stepIdx = stepConfig.findIndex(s => s.key === step);
  const StepIndicator = () => (
    <View style={styles.stepRow}>
      {stepConfig.map((s, i) => (
        <React.Fragment key={s.key}>
          <View style={[
            styles.stepCircle,
            i < stepIdx && styles.stepDone,
            i === stepIdx && styles.stepActive,
          ]}>
            {i < stepIdx ? (
              <Text style={styles.stepDoneIcon}>✓</Text>
            ) : (
              <Text style={[styles.stepIcon, i === stepIdx && styles.stepIconActive]}>{s.icon}</Text>
            )}
          </View>
          <Text style={[styles.stepLabel, i === stepIdx && styles.stepLabelActive]}>{s.label}</Text>
          {i < stepConfig.length - 1 && <View style={styles.stepLine} />}
        </React.Fragment>
      ))}
    </View>
  );

  // Confetti render
  const renderConfetti = () =>
    confetti.map((c, i) => (
      <Animated.View
        key={i}
        style={{
          position: 'absolute', left: c.x, top: -20,
          transform: [
            { translateY: confettiAnims.current[i]?.interpolate({ inputRange: [0, 1], outputRange: [0, 600] }) ?? 0 },
            { translateX: confettiAnims.current[i]?.interpolate({ inputRange: [0, 1], outputRange: [0, (Math.random() - 0.5) * 100] }) ?? 0 },
          ],
          opacity: confettiAnims.current[i] ?? 1,
          width: 10, height: 10, borderRadius: 5, backgroundColor: c.color,
        }}
      />
    ));

  return (
    <View style={styles.container}>
      {/* Background confetti */}
      {step === 'success' && renderConfetti()}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>{language === 'en' ? 'Travel Check-in' : '旅行打卡'}</Text>
        <StepIndicator />

        {/* ── Step: Locate ── */}
        {step === 'locate' && (
          <View style={styles.card}>
            <Text style={styles.cardEmoji}>🌍</Text>
            <Text style={styles.cardTitle}>
              {language === 'en' ? 'Where do you want to check in today?' : '今天想去哪里打卡？'}
            </Text>
            <Text style={styles.cardDesc}>
              {language === 'en' ? 'We\'ll create a story about your location' : '我们会为你生成一个关于那个地方的故事'}
            </Text>
            {snapshot && !snapshot.premium && snapshot.checkInsRemaining !== null && (
              <Text style={styles.quota}>
                {language === 'en'
                  ? `${snapshot.checkInsRemaining} check-ins left · Unlimited with membership`
                  : `还可打卡 ${snapshot.checkInsRemaining} 次 · 会员不限`}
              </Text>
            )}
            <TouchableOpacity style={styles.primaryBtn} onPress={handleStart}>
              <Text style={styles.primaryBtnText}>
                {language === 'en' ? 'Start Check-in' : '开始打卡'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step: Generate ── */}
        {step === 'generate' && (
          <View style={styles.card}>
            <Racco state="thinking" size={100} />
            <Text style={styles.generatingText}>
              {language === 'en'
                ? `Creating a story about ${location}...`
                : `正在为你创作关于${location}的故事...`}
            </Text>
            <ActivityIndicator size="small" color="#FF8A65" style={{ marginTop: 12 }} />
          </View>
        )}

        {/* ── Step: Play ── */}
        {step === 'play' && story && (
          <View style={styles.card}>
            <Text style={styles.storyTitle}>{story.title}</Text>
            <View style={styles.storyBox}>
              <Text style={styles.storyContent}>{story.content}</Text>
            </View>
            <TouchableOpacity
              style={[styles.playBtn, isPlaying && styles.playingBtn]}
              onPress={handlePlay}
              disabled={isPlaying}
            >
              <Text style={styles.playBtnText}>
                {isPlaying
                  ? (language === 'en' ? 'Playing...' : '播放中...')
                  : (language === 'en' ? '▶ Play Story' : '▶ 播放故事')}
              </Text>
            </TouchableOpacity>
            <View style={{ marginTop: 16, alignItems: 'center' }}>
              <Racco state="talking" size={60} />
            </View>
          </View>
        )}

        {/* ── Step: Success ── */}
        {step === 'success' && (
          <View style={styles.card}>
            <Text style={styles.celebrateEmoji}>🎉</Text>
            <Text style={styles.successTitle}>
              {language === 'en' ? 'Check-in Complete!' : '打卡成功！'}
            </Text>
            <Text style={styles.successLocation}>📍 {location}</Text>

            {badge && (
              <View style={styles.badgeWrap}>
                <Text style={styles.badgeEmoji}>{badge.emoji}</Text>
                <Text style={styles.badgeLabel}>
                  {language === 'en' ? 'New Badge Unlocked!' : '获得新勋章！'}
                </Text>
                <Text style={styles.badgeName}>{badge.label}</Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                setStep('locate');
                setLocation('');
                setStory(null);
                setBadge(null);
                setConfetti([]);
                confettiAnims.current = [];
              }}
            >
              <Text style={styles.primaryBtnText}>
                {language === 'en' ? 'Check-in Again' : '再来一次'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Text style={styles.backBtnText}>
                {language === 'en' ? '← Back' : '← 返回'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5E6' },
  scroll: { paddingHorizontal: 20, paddingTop: 48, paddingBottom: 40 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#5D4037', textAlign: 'center', marginBottom: 28 },
  quota: { fontSize: 12, color: '#8D6E63', textAlign: 'center', marginBottom: 12 },

  // Step indicator
  stepRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 32 },
  stepCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#E8DCCF',
    justifyContent: 'center', alignItems: 'center',
  },
  stepDone: { backgroundColor: '#81C784' },
  stepActive: { backgroundColor: '#FF8A65', borderWidth: 2, borderColor: '#FF5722' },
  stepIcon: { fontSize: 18 },
  stepIconActive: { fontSize: 20 },
  stepDoneIcon: { fontSize: 18, color: '#FFF', fontWeight: 'bold' },
  stepLabel: { fontSize: 11, color: '#A0937D', textAlign: 'center', marginTop: 4 },
  stepLabelActive: { color: '#FF5722', fontWeight: 'bold' },
  stepLine: { width: 30, height: 2, backgroundColor: '#E0D5C7', marginHorizontal: 4 },

  // Card
  card: {
    backgroundColor: '#FFF', borderRadius: 24, padding: 24, alignItems: 'center',
    elevation: 2, boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
  },
  cardEmoji: { fontSize: 56, marginBottom: 16 },
  cardTitle: { fontSize: 20, fontWeight: 'bold', color: '#5D4037', textAlign: 'center', marginBottom: 8 },
  cardDesc: { fontSize: 14, color: '#8D6E63', textAlign: 'center', marginBottom: 24 },

  // Generate
  generatingText: { fontSize: 16, color: '#8D6E63', textAlign: 'center', marginTop: 16 },

  // Story
  storyTitle: { fontSize: 22, fontWeight: 'bold', color: '#5D4037', marginBottom: 12, textAlign: 'center' },
  storyBox: {
    backgroundColor: '#FFFDF7', borderRadius: 16, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: '#FFE0B2',
  },
  storyContent: { fontSize: 15, lineHeight: 26, color: '#4E342E' },

  // Buttons
  primaryBtn: {
    backgroundColor: '#FF8A65', borderRadius: 28, paddingVertical: 14, paddingHorizontal: 40,
    elevation: 2, marginTop: 8,
  },
  primaryBtnText: { fontSize: 16, fontWeight: 'bold', color: '#FFF' },
  playBtn: {
    backgroundColor: '#7C4DFF', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 32,
    elevation: 2,
  },
  playingBtn: { backgroundColor: '#651FFF', opacity: 0.8 },
  playBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  backBtn: { marginTop: 12, paddingVertical: 8 },
  backBtnText: { fontSize: 14, color: '#8D6E63' },

  // Success
  celebrateEmoji: { fontSize: 64, marginBottom: 12 },
  successTitle: { fontSize: 24, fontWeight: 'bold', color: '#5D4037', marginBottom: 8 },
  successLocation: { fontSize: 16, color: '#8D6E63', marginBottom: 24 },
  badgeWrap: {
    backgroundColor: '#FFF8E1', borderRadius: 20, paddingVertical: 20, paddingHorizontal: 28,
    alignItems: 'center', borderWidth: 2, borderColor: '#FFD54F', marginBottom: 24,
  },
  badgeEmoji: { fontSize: 48, marginBottom: 8 },
  badgeLabel: { fontSize: 14, color: '#FF8F00', marginBottom: 4 },
  badgeName: { fontSize: 18, fontWeight: 'bold', color: '#5D4037' },
});

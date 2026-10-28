import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Animated, Dimensions, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getProgress, saveProgress } from '../../services/storage';
import { checkCheckInGate } from '../../services/entitlement';
import { textToSpeech } from '../../services/tts';
import Racco from '../../components/common/Racco';
import { CartoonMap, type MapSpot } from '../../components/ui/CartoonMap';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { useLanguage } from '../../hooks/useLanguage';
import { useEntitlement } from '../../hooks/useEntitlement';
import type { Language } from '../../types';

const { width } = Dimensions.get('window');

type Step = 'locate' | 'generate' | 'play' | 'success';

/**
 * 卡通世界地图上的打卡点（面向国内外孩子）。
 * 坐标采用等距柱状投影（equirectangular）：
 *   x = (经度 + 180) / 360 * 100
 *   y = (90 - 纬度) / 180 * 100
 * 仅保证相对方位正确，不追求地理精度（儿童向示意地图）。
 */
const LOCATIONS = [
  // —— 中国 ——
  { cn: '北京', place: '故宫', en: 'Beijing · Forbidden City', emoji: '🏯', x: 82.3, y: 27.8 },
  { cn: '上海', place: '外滩', en: 'Shanghai · The Bund', emoji: '🌃', x: 83.8, y: 32.7 },
  { cn: '西安', place: '兵马俑', en: "Xi'an · Terracotta Warriors", emoji: '🗿', x: 80.3, y: 30.9 },
  { cn: '成都', place: '大熊猫基地', en: 'Chengdu · Panda Base', emoji: '🐼', x: 78.9, y: 33.0 },
  { cn: '杭州', place: '西湖', en: 'Hangzhou · West Lake', emoji: '🛶', x: 83.4, y: 33.2 },
  { cn: '桂林', place: '漓江', en: 'Guilin · Li River', emoji: '⛰️', x: 80.6, y: 35.9 },
  { cn: '拉萨', place: '布达拉宫', en: 'Lhasa · Potala Palace', emoji: '🏔️', x: 75.3, y: 33.5 },
  { cn: '大理', place: '洱海', en: 'Dali · Erhai Lake', emoji: '🌊', x: 77.9, y: 35.8 },
  // —— 世界 ——
  { cn: '巴黎', place: '埃菲尔铁塔', en: 'Paris · Eiffel Tower', emoji: '🗼', x: 50.7, y: 22.9 },
  { cn: '伦敦', place: '大本钟', en: 'London · Big Ben', emoji: '🕰️', x: 50.0, y: 21.4 },
  { cn: '纽约', place: '自由女神', en: 'New York · Statue of Liberty', emoji: '🗽', x: 29.4, y: 27.4 },
  { cn: '东京', place: '东京塔', en: 'Tokyo Tower', emoji: '🗾', x: 88.8, y: 30.2 },
  { cn: '悉尼', place: '歌剧院', en: 'Sydney · Opera House', emoji: '🏝️', x: 92.0, y: 68.8 },
  { cn: '开罗', place: '金字塔', en: 'Cairo · Pyramids', emoji: '🐫', x: 58.6, y: 33.3 },
  { cn: '里约', place: '基督像', en: 'Rio · Christ Statue', emoji: '⛪', x: 38.0, y: 62.8 },
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
  // —— 世界地标故事 ——
  '埃菲尔铁塔': {
    title: '铁塔上的小星星',
    content: '在巴黎的夜空下，埃菲尔铁塔亮起了金色的灯光。一只小狐狸爬到塔顶，发现每盏灯里都住着一颗想家的星星。它轻轻吹了一口气，星星们便排成一条闪亮的小路，一直通到孩子们温暖的小床上。小狐狸说："晚安啦，远方的朋友们。"说完，它蜷起尾巴，在灯光里甜甜地睡着了。',
  },
  '大本钟': {
    title: '大本钟的钟声',
    content: '伦敦的雾里，大本钟叮咚敲响了睡前的时间。一只小熊撑着小红伞，沿着泰晤士河慢慢走。河面上的天鹅告诉它："钟声会把今天的烦恼都带走哦。"小熊仰起头，听着悠扬的钟声，觉得心里暖暖的。它回到小窝，盖上软软的被子，听着雨声，渐渐进入了梦乡。',
  },
  '自由女神': {
    title: '港口的灯塔女孩',
    content: '纽约的港口边，自由女神举着火炬，为夜归的小船指路。一艘小帆船迷了路，火炬的光像温柔的手，牵着它靠向安静的码头。船上的一只小海鸥累了，停在女神的手臂上，听她轻声哼着摇篮曲。海风轻轻摇着小船，小海鸥闭上眼睛，做了一个飞过整片星海的好梦。',
  },
  '东京塔': {
    title: '塔下的纸飞机',
    content: '东京的夜晚，东京塔闪着红白的光。一个小男孩折了一只蓝色的纸飞机，许愿它能飞到月亮上。纸飞机真的飞起来了，掠过霓虹闪烁的街道，落在一朵软软的云上。云朵载着它，慢慢飘向窗台边熟睡的孩子。小男孩翻了个身，梦见自己坐在纸飞机上，正飞向满是星星的远方。',
  },
  '歌剧院': {
    title: '海湾的白帆',
    content: '悉尼的海湾里，歌剧院像一朵朵张开的白帆。一只小考拉趴在桅杆上，跟着海浪的节拍轻轻摇晃。远处的灯塔眨着眼睛说："该睡啦。"小考拉点点头，抱着桅杆，听潮水唱起温柔的催眠曲。海风把咸咸的味道送进梦里，它梦见自己变成了一艘小白船，在月光铺成的小路上轻轻漂。',
  },
  '金字塔': {
    title: '沙漠里的月亮船',
    content: '开罗的沙漠上，金字塔静静守着千年的秘密。一只小骆驼驮着一盏小灯，陪着迷路的小星星回家。沙丘像柔软的枕头，风像轻轻的扇子。小星星趴在小骆驼背上，数着天上的伙伴，眼皮越来越沉。终于，它咕哝了一声"晚安"，在温暖的沙海里睡着了。',
  },
  '基督像': {
    title: '山巅的张开双臂',
    content: '里约的山顶上，基督像张开双臂，像在给整座城市一个温柔的拥抱。一只小鹦鹉停在雕像的肩上，看城市灯火一盏盏熄灭。它轻声说："大家都睡觉咯。"然后钻进羽毛里，随着晚风轻轻晃。远处的海浪拍着沙滩，像一首慢悠悠的歌，把整座山都哄进了梦乡。',
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
  const [selectedLoc, setSelectedLoc] = useState<typeof LOCATIONS[number] | null>(null);
  const [visitedPlaces, setVisitedPlaces] = useState<string[]>([]);
  const [story, setStory] = useState<{ title: string; content: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [badge, setBadge] = useState<{ emoji: string; label: string } | null>(null);
  const [confetti, setConfetti] = useState<{ x: number; color: string; delay: number }[]>([]);
  const confettiAnims = useRef<Animated.Value[]>([]);
  const { snapshot, refresh, showPaywall } = useEntitlement();

  // 读取历史打卡，地图上已去过的地方显示金色星星
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getProgress();
        if (cancelled) return;
        // checkIns 里存的是展示名（如「北京·故宫」），这里统一按城市名匹配
        const places = p.checkIns.map((c) => c.location.split('·')[0].trim());
        setVisitedPlaces(places);
      } catch {
        // 读不到就当没有历史，不影响打卡
      }
    })();
    return () => { cancelled = true; };
  }, [step]);

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

  // 从地图上选好地点后开始打卡
  const handleStart = async () => {
    if (!selectedLoc) return;

    // 打卡额度门禁（会员不限）。放在流程入口，避免用户走完一圈才发现不能打卡
    const gate = await checkCheckInGate();
    if (!showPaywall(gate)) return;

    const loc = selectedLoc;
    setLocation(language === 'en' ? loc.en : `${loc.cn}·${loc.place}`);
    setStep('generate');
    // Simulate story generation (2s)
    setTimeout(() => {
      setStory(STORIES[loc.place] || { title: '旅途奇遇', content: '一段关于旅行的奇妙故事……' });
      setStep('play');
    }, 2000);
  };

  // Play story (real TTS)
  const handlePlay = async () => {
    if (isPlaying || !story) return;
    setIsPlaying(true);
    try {
      await textToSpeech(story.content, undefined, language === 'zh' ? 'zh' : 'en');
    } catch (err) {
      console.warn('[checkin] tts failed:', err);
    }
    setIsPlaying(false);
    handleCheckIn();
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

  // 地图数据：把 LOCATIONS 转成 CartoonMap 需要的格式，并标出已打卡的
  const mapSpots: MapSpot[] = LOCATIONS.map((l) => ({
    id: l.place,
    name: l.cn,
    place: l.place,
    emoji: l.emoji,
    x: l.x,
    y: l.y,
    visited: visitedPlaces.includes(l.cn),
  }));

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
    <CartoonScreen gradient="day" decor wide={false}>
      <View style={styles.container}>
      {/* Background confetti */}
      {step === 'success' && renderConfetti()}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>{language === 'en' ? 'Travel Check-in' : '旅行打卡'}</Text>
        <StepIndicator />

        {/* ── Step: Locate ── */}
        {step === 'locate' && (
          <View style={styles.card}>
            <Text style={styles.cardEmoji}>🗺️</Text>
            <Text style={styles.cardTitle}>
              {language === 'en' ? 'Tap a pin to pick a place' : '点一下地图上的小图钉'}
            </Text>
            <Text style={styles.cardDesc}>
              {language === 'en'
                ? 'We\'ll tell a story about that place'
                : '我们会为那个地方讲一个故事'}
            </Text>

            <CartoonMap
              spots={mapSpots}
              selectedId={selectedLoc ? selectedLoc.place : null}
              onSelect={(spot) =>
                setSelectedLoc(LOCATIONS.find((l) => l.place === spot.id) ?? null)
              }
              hint={
                selectedLoc
                  ? (language === 'en'
                      ? `Selected: ${selectedLoc.en}`
                      : `已选好：${selectedLoc.cn}·${selectedLoc.place}`)
                  : (language === 'en' ? 'No place picked yet' : '还没选地点哦～')
              }
            />

            {snapshot && !snapshot.premium && snapshot.checkInsRemaining !== null && (
              <Text style={styles.quota}>
                {language === 'en'
                  ? `${snapshot.checkInsRemaining} check-ins left · Unlimited with membership`
                  : `还可打卡 ${snapshot.checkInsRemaining} 次 · 会员不限`}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, !selectedLoc && styles.primaryBtnDisabled]}
              onPress={handleStart}
              disabled={!selectedLoc}
            >
              <Text style={styles.primaryBtnText}>
                {selectedLoc
                  ? (language === 'en' ? 'Start Check-in' : `去 ${selectedLoc.cn} 打卡`)
                  : (language === 'en' ? 'Pick a place first' : '先选一个地方吧')}
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
                setSelectedLoc(null);
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
    </CartoonScreen>
  );
}

// ─── Styles ────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
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
  primaryBtnDisabled: { backgroundColor: '#D8CFC5', elevation: 0 },
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

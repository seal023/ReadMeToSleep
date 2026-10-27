import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useLanguage } from '../../hooks/useLanguage';
import Racco from '../../components/common/Racco';
import { LevelCard } from '../../components/ui/LevelCard';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { getVoiceGuidance } from '../../services/storage';
import { textToSpeech } from '../../services/tts';
import type { RaccoState } from '../../types';

const TITLES = ['Little Star', 'Champion', 'Adventurer', 'Dreamer', 'Storyteller', 'Sweetie'] as const;
const RACCO_STATES: RaccoState[] = ['idle', 'talking', 'listening', 'thinking', 'happy', 'sleeping'];

function getGreetingKey(): string {
  const h = new Date().getHours();
  if (h < 12) return 'home.greetingMorning';
  if (h < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

export default function HomeTab() {
  const { t, language } = useLanguage();

  const [raccoState, setRaccoState] = useState<RaccoState>('idle');
  const [title] = useState(() => TITLES[Math.floor(Math.random() * TITLES.length)]);
  const [guideVisible, setGuideVisible] = useState(false);

  const { width: screenW } = useWindowDimensions();
  // iPad 横屏（以及大屏）视为宽屏：内容限宽居中，浣熊不要占满整个高度
  const isWide = screenW >= 768;
  const raccoSize = isWide ? screenW * 0.18 : screenW * 0.4;

  const handleRaccoPress = () => {
    const next = RACCO_STATES[Math.floor(Math.random() * RACCO_STATES.length)];
    setRaccoState(next);
  };

  // 需求 3 占位：开启「语音引导」后，小浣熊用 TTS 语音提问并给予预设快捷操作
  // （真实语音识别待接入 STT 后启用，目前可点选）
  useEffect(() => {
    let mounted = true;
    getVoiceGuidance().then((on) => {
      if (!mounted) return;
      if (on) {
        setGuideVisible(true);
        textToSpeech(t('home.guide.prompt'), 'system', language);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const speakGuide = () => {
    textToSpeech(t('home.guide.prompt'), 'system', language);
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, isWide && styles.contentWide]}
      >
      {/* 问候 + 浣熊：iPad 横屏时左右并排，避免竖向留白过多 */}
      <View style={[styles.topArea, isWide && styles.topAreaWide]}>
        <View style={[styles.greetingSection, isWide && styles.greetingSectionWide]}>
          <Text style={[styles.greetingText, isWide && styles.greetingTextWide]}>
            {t(getGreetingKey())}, {title} ✨
          </Text>
        </View>

        <TouchableOpacity activeOpacity={0.7} onPress={handleRaccoPress} style={styles.raccoWrap}>
          <Racco state={raccoState} size={raccoSize} />
        </TouchableOpacity>
      </View>

      {/* 需求 3 占位：语音引导卡片（开启语音引导时显示） */}
      {guideVisible && (
        <View style={styles.guideCard}>
          <View style={styles.guideTop}>
            <Racco state="listening" size={64} />
            <View style={styles.guideBubble}>
              <Text style={styles.guideText}>🎤 {t('home.guide.text')}</Text>
              <TouchableOpacity onPress={speakGuide} style={styles.guideReplay}>
                <Text style={styles.guideReplayText}>🔁 {t('home.guide.replay')}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.guideActions}>
            <TouchableOpacity style={styles.guideBtn} onPress={() => router.push('/(tabs)/library')}>
              <Text style={styles.guideBtnEmoji}>📚</Text>
              <Text style={styles.guideBtnLabel}>{t('home.guide.listen')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.guideBtn} onPress={() => router.push('/story/travel-checkin')}>
              <Text style={styles.guideBtnEmoji}>✈️</Text>
              <Text style={styles.guideBtnLabel}>{t('home.guide.travel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.guideBtn} onPress={() => setGuideVisible(false)}>
              <Text style={styles.guideBtnEmoji}>😴</Text>
              <Text style={styles.guideBtnLabel}>{t('home.guide.think')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.guideHint}>{t('home.guide.hint')}</Text>
        </View>
      )}

      {/* 需求 5：等级与奖励进度 */}
      <LevelCard />

      <TouchableOpacity
        style={styles.recCard}
        activeOpacity={0.8}
        onPress={() => router.push('/(tabs)/library')}
      >
        <View style={styles.recCover}>
          <Text style={styles.recCoverEmoji}>📖</Text>
        </View>
        <View style={styles.recInfo}>
          <Text style={styles.recTitle}>{t('home.recTitle')}</Text>
          <View style={styles.recTags}>
            <Text style={styles.recTag}>{t('home.recTag1')}</Text>
            <Text style={styles.recTag}>{t('home.recTag2')}</Text>
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionCard1}
          activeOpacity={0.8}
          onPress={() => router.push('/(tabs)/library')}
        >
          <Text style={styles.actionEmoji}>🎧</Text>
          <Text style={styles.actionLabel}>{t('home.quickListen')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard2}
          activeOpacity={0.8}
          onPress={() => router.push('/(tabs)/create')}
        >
          <Text style={styles.actionEmoji}>✏️</Text>
          <Text style={styles.actionLabel}>{t('home.quickCreate')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard3}
          activeOpacity={0.8}
          onPress={() => router.push('/story/travel-checkin')}
        >
          <Text style={styles.actionEmoji}>✈️</Text>
          <Text style={styles.actionLabel}>{t('home.quickTravel')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('home.recentStories')}</Text>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{t('home.noStories')}</Text>
        </View>
      </View>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  // iPad 横屏：内容限宽居中，避免在超宽屏上被拉得太散
  contentWide: {
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
    paddingBottom: 48,
  },

  topArea: {},
  topAreaWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greetingSectionWide: {
    flex: 1,
    paddingTop: 24,
    paddingBottom: 0,
  },
  greetingTextWide: {
    fontSize: 28,
  },

  greetingSection: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
  },
  greetingText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#5D4037',
  },

  raccoWrap: {
    alignItems: 'center',
    marginVertical: 16,
  },

  recCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 24,
    marginBottom: 20,
    padding: 14,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
    elevation: 3,
  },
  recCover: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recCoverEmoji: {
    fontSize: 32,
  },
  recInfo: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  recTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  recTags: {
    flexDirection: 'row',
    gap: 8,
  },
  recTag: {
    fontSize: 12,
    color: '#FF6B6B',
    backgroundColor: '#FFF0F0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },

  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  actionCard1: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#FFB5A0',
  },
  actionCard2: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#FFD3B0',
  },
  actionCard3: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#C8E6C9',
  },
  actionEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5D4037',
    textAlign: 'center',
  },

  section: {
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#5D4037',
    marginBottom: 12,
  },
  emptyState: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 36,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#BDBDBD',
  },

  // 需求 3 占位：语音引导卡片
  guideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 24,
    marginBottom: 20,
    padding: 16,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    elevation: 3,
  },
  guideTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  guideBubble: {
    flex: 1,
    marginLeft: 12,
  },
  guideText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#5D4037',
  },
  guideReplay: {
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: '#FFF1DC',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  guideReplayText: {
    fontSize: 12,
    color: '#8D6E63',
    fontWeight: '600',
  },
  guideActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  guideBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#E8F1FF',
  },
  guideBtnEmoji: {
    fontSize: 26,
    marginBottom: 4,
  },
  guideBtnLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3B6FB0',
  },
  guideHint: {
    fontSize: 11,
    color: '#BDBDBD',
    textAlign: 'center',
    marginTop: 10,
  },
});
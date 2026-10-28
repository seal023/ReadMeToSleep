import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useLanguage } from '../../hooks/useLanguage';
import Racco from '../../components/common/Racco';
import { LevelCard } from '../../components/ui/LevelCard';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { getVoiceGuidance, getChildName } from '../../services/storage';
import { textToSpeech } from '../../services/tts';
import { hasClonedVoice } from '../../services/clonedVoicePlayback';
import type { RaccoState } from '../../types';

/** 首次启动引导是否已展示过 */
const FIRST_RUN_CLONE_KEY = 'rms_firstrun_clone';

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
  const [guideVisible, setGuideVisible] = useState(false);
  const [childName, setChildName] = useState('');
  // P1：首次启动引导——尚未克隆任何亲人声线时，强提示录制（核心卖点前置）
  const [cloneBannerVisible, setCloneBannerVisible] = useState(false);

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

  // 首次启动：未克隆过且未忽略引导 → 展示录制引导横幅
  useEffect(() => {
    let mounted = true;
    (async () => {
      const flagged = await AsyncStorage.getItem(FIRST_RUN_CLONE_KEY);
      if (flagged) return;
      const anyCloned =
        (await hasClonedVoice('mom')) ||
        (await hasClonedVoice('dad')) ||
        (await hasClonedVoice('grandma'));
      if (!mounted) return;
      if (!anyCloned) setCloneBannerVisible(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    getChildName().then(setChildName);
  }, []);

  const greeting = (() => {
    const base = t(getGreetingKey());
    if (childName) return base.replace('{name}', childName);
    return base.replace('，{name}！', '！').replace(', {name}!', '!');
  })();

  const dismissCloneBanner = async () => {
    setCloneBannerVisible(false);
    await AsyncStorage.setItem(FIRST_RUN_CLONE_KEY, '1');
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
            {greeting} ✨
          </Text>
        </View>

        <TouchableOpacity activeOpacity={0.7} onPress={handleRaccoPress} style={styles.raccoWrap}>
          <Racco state={raccoState} size={raccoSize} />
        </TouchableOpacity>
      </View>

      {/* P1：核心卖点前置——亲人声音陪伴英雄区（常驻，放大声音克隆） */}
      <TouchableOpacity
        style={styles.cloneHero}
        activeOpacity={0.9}
        onPress={() => router.push('/(parent)/voice-clone')}
      >
        <View style={styles.cloneHeroTextWrap}>
          <Text style={styles.cloneHeroTitle}>{t('home.cloneHero.title')}</Text>
          <Text style={styles.cloneHeroDesc}>{t('home.cloneHero.desc')}</Text>
          <View style={styles.cloneHeroCta}>
            <Text style={styles.cloneHeroCtaText}>{t('home.cloneHero.cta')}</Text>
          </View>
        </View>
        <Text style={styles.cloneHeroEmoji}>🎙️</Text>
      </TouchableOpacity>

      {/* P1：首次启动引导横幅（未克隆且未忽略时显示） */}
      {cloneBannerVisible && (
        <View style={styles.cloneBanner}>
          <View style={styles.cloneBannerTextWrap}>
            <Text style={styles.cloneBannerTitle}>✨ {t('home.cloneBanner.title')}</Text>
            <Text style={styles.cloneBannerDesc}>{t('home.cloneBanner.desc')}</Text>
          </View>
          <View style={styles.cloneBannerActions}>
            <TouchableOpacity
              style={styles.cloneBannerCta}
              onPress={() => {
                setCloneBannerVisible(false);
                AsyncStorage.setItem(FIRST_RUN_CLONE_KEY, '1');
                router.push('/(parent)/voice-clone');
              }}
            >
              <Text style={styles.cloneBannerCtaText}>{t('home.cloneBanner.cta')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cloneBannerLater} onPress={dismissCloneBanner}>
              <Text style={styles.cloneBannerLaterText}>{t('home.cloneBanner.later')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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

  // P1：亲人声音英雄区（核心卖点前置）
  cloneHero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFE0D6',
    borderRadius: 18,
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 18,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.10)',
    elevation: 3,
  },
  cloneHeroTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  cloneHeroTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#5D4037',
    marginBottom: 6,
  },
  cloneHeroDesc: {
    fontSize: 13,
    color: '#8D6E63',
    lineHeight: 20,
    marginBottom: 12,
  },
  cloneHeroCta: {
    alignSelf: 'flex-start',
    backgroundColor: '#FF8A65',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  cloneHeroCtaText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  cloneHeroEmoji: {
    fontSize: 40,
  },

  // P1：首次启动引导横幅
  cloneBanner: {
    backgroundColor: '#E8F1FF',
    borderRadius: 16,
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 16,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    elevation: 3,
  },
  cloneBannerTextWrap: {
    marginBottom: 12,
  },
  cloneBannerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#3B6FB0',
    marginBottom: 4,
  },
  cloneBannerDesc: {
    fontSize: 13,
    color: '#5B7AA8',
    lineHeight: 20,
  },
  cloneBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cloneBannerCta: {
    backgroundColor: '#7C4DFF',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  cloneBannerCtaText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  cloneBannerLater: {
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  cloneBannerLaterText: {
    fontSize: 13,
    color: '#8FA6C8',
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
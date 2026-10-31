import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Modal,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '../../hooks/useLanguage';
import Racco from '../../components/common/Racco';
import { LevelCard } from '../../components/ui/LevelCard';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { ElasticPressable } from '../../components/ui/CartoonButton';
import { getVoiceGuidance, getChildName, setChildName as saveChildName, getStories, getProgress } from '../../services/storage';
import { speakWithBestVoice, speakPhrase } from '../../services/playback';
import { hasClonedVoice } from '../../services/clonedVoicePlayback';
import type { RaccoState } from '../../types';

/** 首次启动引导是否已展示过 */
const FIRST_RUN_CLONE_KEY = 'rms_firstrun_clone';

const RACCO_STATES: RaccoState[] = ['idle', 'talking', 'listening', 'thinking', 'happy', 'sleeping'];

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getGreetingKey(): string {
  // 按机器本地时钟分四段问候，避免大晚上还显示"早上好"
  const h = new Date().getHours();
  if (h < 11) return 'home.greetingMorning'; // 早上好（11 点前）
  if (h < 13) return 'home.greetingNoon'; // 中午好（11–13 点）
  if (h < 18) return 'home.greetingAfternoon'; // 下午好（13–18 点）
  return 'home.greetingEvening'; // 晚上好（18 点后）
}

export default function HomeTab() {
  const { t, language } = useLanguage();

  const [raccoState, setRaccoState] = useState<RaccoState>('idle');
  const [guideVisible, setGuideVisible] = useState(false);
  const [childName, setChildName] = useState('');
  // 2026-10-29：首启引导——首次启动（尚未设置宝宝昵称）时，第一步就询问"如何称呼宝贝"
  const [onboardVisible, setOnboardVisible] = useState(false);
  const [onboardText, setOnboardText] = useState('');
  // P1：首次启动引导——尚未克隆任何亲人声线时，强提示录制（核心卖点前置）
  const [cloneBannerVisible, setCloneBannerVisible] = useState(false);

  // #6 同步：首页「最近故事」原本恒显示空态，现从真实数据填充（AI 故事 + 旅行打卡）
  type RecentItem = { key: string; title: string; sub: string; kind: 'ai' | 'travel'; route: string };
  const [recent, setRecent] = useState<RecentItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const [all, prog] = await Promise.all([getStories(), getProgress()]);
          if (!alive) return;
          const ai = all
            .filter((s) => s.type === 'ai_generated')
            .map((s) => ({
              key: s.id,
              title: s.title,
              sub: fmtDate(s.createdAt),
              kind: 'ai' as const,
              route: `/story/${s.id}`,
            }));
          const tr = (prog.checkIns ?? []).map((c) => ({
            key: `${c.location}_${c.date}`,
            title: c.location,
            sub: fmtDate(c.date),
            kind: 'travel' as const,
            route: '/story/travel-checkin',
          }));
          const merged = [...ai, ...tr]
            .sort((a, b) => (b.sub || '').localeCompare(a.sub || ''))
            .slice(0, 4);
          setRecent(merged);
        } catch {
          /* 忽略读取异常，保持空态 */
        }
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

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
        speakPhrase('guide', language);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const speakGuide = () => {
    speakPhrase('guide', language);
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

  // 用 useFocusEffect：每次回到首页（从设置页改完名字返回）都重新读取，
  // 否则 tab 不卸载、首次加载的缓存会让问候语里的名字不更新
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getChildName().then((n) => {
        if (alive) setChildName(n);
      });
      return () => {
        alive = false;
      };
    }, [])
  );

  // 首启昵称引导：未设置昵称则在首次启动弹出（隐私同意后首页才挂载，触发安全）
  useEffect(() => {
    let alive = true;
    getChildName().then((n) => {
      if (alive && !n) setOnboardVisible(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const greeting = (() => {
    const base = t(getGreetingKey());
    // 同时兼容 {name} / {title} 两种占位符（历史两套问候键并存，避免名字插不进去）
    const filled = base.replace(/\{name\}|\{title\}/g, childName);
    if (childName) return filled;
    return base
      .replace(/，\{name\}！|，\{title\}！/, '！')
      .replace(/, \{name\}!|, \{title\}!/, '!');
  })();

  const dismissCloneBanner = async () => {
    setCloneBannerVisible(false);
    await AsyncStorage.setItem(FIRST_RUN_CLONE_KEY, '1');
  };

  // 首启昵称引导：保存昵称并关闭引导（昵称用于首页亲切称呼 + 语音问候）
  const finishOnboard = async () => {
    const name = onboardText.trim();
    if (!name) return;
    // 持久化到 AsyncStorage（之前只更新了本地 state，从未落盘，导致设置页读不到、重启后丢失）
    await saveChildName(name);
    setChildName(name);
    setOnboardVisible(false);
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

        <ElasticPressable onPress={handleRaccoPress} style={styles.raccoWrap}>
          <Racco state={raccoState} size={raccoSize} />
        </ElasticPressable>
      </View>

      {/* P1：核心卖点前置——亲人声音陪伴英雄区（常驻，放大声音克隆） */}
      <ElasticPressable
        style={styles.cloneHero}
        onPress={() => router.push('/(parent)/voice-clone')}
        pressScale={0.94}
        bounciness={14}
      >
        <View style={styles.cloneHeroTextWrap}>
          <Text style={styles.cloneHeroTitle}>{t('home.cloneHero.title')}</Text>
          <Text style={styles.cloneHeroDesc}>{t('home.cloneHero.desc')}</Text>
          <View style={styles.cloneHeroCta}>
            <Text style={styles.cloneHeroCtaText}>{t('home.cloneHero.cta')}</Text>
          </View>
        </View>
        <Text style={styles.cloneHeroEmoji}>🎙️</Text>
      </ElasticPressable>

      {/* 会员入口：直达订阅/会员中心，避免"找不到收费板块" */}
      <ElasticPressable
        style={styles.premiumCard}
        onPress={() => router.push('/(parent)/subscription')}
        pressScale={0.94}
        bounciness={14}
      >
        <Text style={styles.premiumEmoji}>💎</Text>
        <View style={styles.premiumTextWrap}>
          <Text style={styles.premiumTitle}>{t('home.premium.title')}</Text>
          <Text style={styles.premiumDesc}>{t('home.premium.desc')}</Text>
        </View>
        <Text style={styles.premiumCta}>{t('home.premium.cta')}</Text>
      </ElasticPressable>

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
            <ElasticPressable containerStyle={styles.guideBtnCell} style={styles.guideBtn} onPress={() => router.push('/(tabs)/library')} pressScale={0.92} bounciness={16}>
              <Text style={styles.guideBtnEmoji}>📚</Text>
              <Text style={styles.guideBtnLabel}>{t('home.guide.listen')}</Text>
            </ElasticPressable>
            <ElasticPressable containerStyle={styles.guideBtnCell} style={styles.guideBtn} onPress={() => router.push('/story/travel-checkin')} pressScale={0.92} bounciness={16}>
              <Text style={styles.guideBtnEmoji}>✈️</Text>
              <Text style={styles.guideBtnLabel}>{t('home.guide.travel')}</Text>
            </ElasticPressable>
            <ElasticPressable containerStyle={styles.guideBtnCell} style={styles.guideBtn} onPress={() => setGuideVisible(false)} pressScale={0.92} bounciness={16}>
              <Text style={styles.guideBtnEmoji}>😴</Text>
              <Text style={styles.guideBtnLabel}>{t('home.guide.think')}</Text>
            </ElasticPressable>
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
        {recent.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('home.noStories')}</Text>
          </View>
        ) : (
          recent.map((r) => (
            <TouchableOpacity key={r.key} style={styles.recentItem} onPress={() => router.push(r.route)}>
              <Text style={styles.recentItemEmoji}>{r.kind === 'ai' ? '✨' : '✈️'}</Text>
              <View style={styles.recentItemInfo}>
                <Text style={styles.recentItemTitle} numberOfLines={1}>{r.title}</Text>
                <Text style={styles.recentItemSub}>{r.sub}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>
      </ScrollView>

      {/* 首启昵称引导：进入 App 的第一步，询问"如何称呼宝贝"（从设置前置到首屏） */}
      <Modal visible={onboardVisible} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.onboardOverlay}>
          <View style={styles.onboardCard}>
            <Text style={styles.onboardEmoji}>🐻</Text>
            <Text style={styles.onboardTitle}>{t('onboard.title')}</Text>
            <TextInput
              style={styles.onboardInput}
              value={onboardText}
              onChangeText={setOnboardText}
              placeholder={t('settings.childName.placeholder')}
              placeholderTextColor="#bca"
              autoFocus
              maxLength={20}
            />
            <TouchableOpacity style={styles.onboardBtn} onPress={finishOnboard}>
              <Text style={styles.onboardBtnText}>{t('onboard.start')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  // 会员入口卡片
  premiumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDE7FF',
    borderRadius: 18,
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 16,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.10)',
    elevation: 3,
  },
  premiumEmoji: { fontSize: 30, marginRight: 12 },
  premiumTextWrap: { flex: 1, marginRight: 8 },
  premiumTitle: { fontSize: 16, fontWeight: 'bold', color: '#4A2B8C', marginBottom: 3 },
  premiumDesc: { fontSize: 12, color: '#7A6AA8', lineHeight: 18 },
  premiumCta: {
    backgroundColor: '#7C4DFF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    overflow: 'hidden',
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

  // #6 首页「最近故事」真实条目
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
    elevation: 2,
  },
  recentItemEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  recentItemInfo: {
    flex: 1,
  },
  recentItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  recentItemSub: {
    fontSize: 12,
    color: '#999',
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
    width: '100%',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#E8F1FF',
  },
  // 外层 Pressable 需要用 flex:1 撑开，否则三个按钮会缩在左侧（内层 flex 影响不到外层）
  guideBtnCell: { flex: 1 },
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

  // 首启昵称引导弹窗样式
  onboardOverlay: {
    flex: 1,
    backgroundColor: 'rgba(60, 45, 35, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  onboardCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFF8F0',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  onboardEmoji: { fontSize: 46, marginBottom: 12 },
  onboardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#5D4037',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 28,
  },
  onboardInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#FFE0B2',
    borderRadius: 16,
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#5D4037',
    textAlign: 'center',
    marginBottom: 20,
  },
  onboardBtn: {
    backgroundColor: '#FF8A65',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  onboardBtnText: { fontSize: 17, fontWeight: '700', color: '#FFF' },
});
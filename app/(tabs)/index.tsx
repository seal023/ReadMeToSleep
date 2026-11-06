import { useState, useEffect, useCallback, useRef } from 'react';
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
import { ClayIcon } from '../../components/ui/ClayIcon';
import { ElasticPressable } from '../../components/ui/CartoonButton';
import { getVoiceGuidance, getChildName, setChildName as saveChildName, getStories, getProgress, getPromptVoiceSetting, CLASSIC_EN_IDS } from '../../services/storage';
import { warmPresetVoiceInBackground } from '../../services/phraseCache';
import { getClonedTargets } from '../../services/voiceClone';
import { useEntitlement } from '../../hooks/useEntitlement';
import { speakWithBestVoice, isStoryPlaying, isStoryResumePending } from '../../services/playback';
import { checkStoryGate, checkCheckInGate } from '../../services/entitlement';
import storiesIndex from '../../data/classic-stories/stories-index.json';
import type { RaccoState } from '../../types';

const RACCO_STATES: RaccoState[] = ['idle', 'talking', 'listening', 'thinking', 'happy', 'sleeping'];

/** 上次推荐过哪篇（跨启动记住，保证「每次都不一样」） */
const REC_LAST_KEY = 'rms_last_rec_story';

/** 故事分类 → 展示用的图标 / i18n key（与故事库页保持一致） */
const REC_TAG_EMOJI: Record<string, string> = {
  童话: '📖',
  成长: '🌱',
  寓言: '🦉',
  动物: '🐾',
  睡前: '🌙',
  自然: '🍃',
};
const REC_TAG_KEY: Record<string, string> = {
  童话: 'cat.fairy',
  成长: 'cat.growth',
  寓言: 'cat.fable',
  动物: 'cat.animal',
  睡前: 'cat.bedtime',
  自然: 'cat.nature',
};

type ClassicIndexItem = {
  id: string;
  title: { zh: string; en: string };
  tags: string[];
  duration: number;
  source: string;
};

/** 今日推荐卡的数据（从 100 篇公版故事里随机抽一篇） */
type RecStory = { id: string; title: string; emoji: string; tag: string; minutes: number };

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
  /**
   * 会员状态（v84 反馈 #6）：已经是会员就不再顶上「升级会员」卡片，
   * 只有未订阅 / 订阅过期时才出现，避免付费用户天天被推销。
   * snapshot 为 null 表示还在读（含 IAP 校验），此期间先不显示，避免闪一下又消失。
   */
  const { snapshot, refresh: refreshEntitlement, showPaywall } = useEntitlement();
  const showPremiumCard = snapshot ? !snapshot.premium : false;

  const [raccoState, setRaccoState] = useState<RaccoState>('idle');
  /**
   * 今日推荐（v95 反馈）
   * -------------------------------------------------------------------------
   * 原来首页有两块内容互相打架：
   *   ①「你想做什么呀？」+ 听故事 / 去打卡 / 我再想想  —— 下面那排大按钮已经一模一样
   *   ②「今日推荐 · 睡前 3 分钟」—— 恒定不变，点进去只是跳故事库，等于没有推荐
   * 现在合成为一块：随机挑一篇真故事，点开直接听，每次进首页都不一样。
   */
  const [rec, setRec] = useState<RecStory | null>(null);
  /** 语音推荐开关（沿用设置页原「语音引导」开关，语义改为「用语音介绍今天的推荐」） */
  const [voiceRecOn, setVoiceRecOn] = useState(false);
  /**
   * t 每次渲染都是新函数（useLanguage 里没 memo），若作为 useFocusEffect 的依赖，
   * 每次渲染都会重跑一遍、把推荐随机换掉。这里用 ref 拿到「最新的 t」，
   * 依赖里只留 language，效果才不会抖。
   */
  const tRef = useRef(t);
  tRef.current = t;
  const [childName, setChildName] = useState('');
  // 2026-10-29：首启引导——首次启动（尚未设置宝宝昵称）时，第一步就询问"如何称呼宝贝"
  const [onboardVisible, setOnboardVisible] = useState(false);
  const [onboardText, setOnboardText] = useState('');
  // 声音克隆是产品灵魂（北极星卖点），首页常驻入口，永远突出、不消失。
  // v79 修复：原先用本地 state 控制显隐，点过「稍后」或进过一次克隆页后本次会话就永久消失，
  // 切语言再回首页更让人以为入口没了。现改为「常驻渲染」，只按是否已克隆切换文案。
  const [hasCloned, setHasCloned] = useState(false);

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

  // 语音推荐开关：沿用设置页原来的「语音引导」开关（那个提问卡片已删除）
  useEffect(() => {
    let mounted = true;
    getVoiceGuidance().then((on) => {
      if (mounted) setVoiceRecOn(on);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // 每次进入首页随机挑一篇（不与上次重复）；英文界面只在有英文正文的故事里挑
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const all = storiesIndex as ClassicIndexItem[];
        const pool = all.filter((s) => language !== 'en' || CLASSIC_EN_IDS.has(s.id));
        if (!pool.length) return;
        let last = '';
        try {
          last = (await AsyncStorage.getItem(REC_LAST_KEY)) || '';
        } catch {
          /* 读不到历史就随便挑 */
        }
        const fresh = pool.filter((s) => s.id !== last);
        const usable = fresh.length ? fresh : pool;
        const pick = usable[Math.floor(Math.random() * usable.length)];
        try {
          await AsyncStorage.setItem(REC_LAST_KEY, pick.id);
        } catch {
          /* 记不住也没关系 */
        }
        if (!alive) return;
        const tagZh = pick.tags?.[0] || '';
        const tagKey = REC_TAG_KEY[tagZh];
        setRec({
          id: pick.id,
          title:
            language === 'en'
              ? pick.title?.en || pick.title?.zh || ''
              : pick.title?.zh || pick.title?.en || '',
          emoji: REC_TAG_EMOJI[tagZh] || '📖',
          tag: tagZh ? (tagKey ? tRef.current(tagKey) : tagZh) : '',
          minutes: Math.max(1, Math.round((pick.duration || 180) / 60)),
        });
      })();
      return () => {
        alive = false;
      };
    }, [language])
  );

  /** 推荐语（手动点 🔊 与自动播报共用同一句，保证命中同一份缓存） */
  const recSpeech = useCallback(() => {
    if (!rec) return '';
    return tRef.current('home.recVoice').replace('{title}', rec.title);
  }, [rec]);

  const speakRec = useCallback(() => {
    const text = recSpeech();
    if (text) void speakWithBestVoice(text, language);
  }, [recSpeech, language]);

  // 开关打开时，冷启动进入首页会把今天的推荐念给孩子听（不识字也能知道推荐了哪篇）。
  // 4.5 秒后才出声，等每日问候先说完；若孩子已经点开故事，则直接跳过，绝不打断。
  // 只在「本次启动的第一次」念，之后回首页换成新一篇也不再念叨，避免每回一次就吵一次。
  const recAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!voiceRecOn || !rec || recAnnouncedRef.current) return;
    const timer = setTimeout(() => {
      recAnnouncedRef.current = true;
      if (isStoryPlaying() || isStoryResumePending()) return;
      const text = tRef.current('home.recVoice').replace('{title}', rec.title);
      void speakWithBestVoice(text, language);
    }, 4500);
    return () => clearTimeout(timer);
  }, [voiceRecOn, rec, language]);

  // 声音克隆是产品灵魂，首页常驻入口（不再因「已克隆 / 点过稍后」而消失）。
  // 仅本次会话内可「稍后再说」临时收起，下次打开首页仍会显示，确保入口永远突出。

  // 用 useFocusEffect：每次回到首页（从设置页改完名字返回）都重新读取，
  // 否则 tab 不卸载、首次加载的缓存会让问候语里的名字不更新
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getChildName().then((n) => {
        if (alive) setChildName(n);
      });
      // 克隆入口文案（v84 反馈 #3：统一说「克隆你的声音」，不再用「已绑定家人的声音」这种容易误解的说法）
      getClonedTargets()
        .then((targets) => {
          if (alive) setHasCloned(Array.isArray(targets) && targets.length > 0);
        })
        .catch(() => {
          if (alive) setHasCloned(false);
        });
      return () => {
        alive = false;
      };
    }, [])
  );

  // 每次回到首页刷新会员状态（刚买完 / 刚过期都能立刻反映到「升级会员」卡片的显隐）
  useFocusEffect(
    useCallback(() => {
      void refreshEntitlement();
    }, [refreshEntitlement])
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

  // 首启昵称引导：保存昵称并关闭引导（昵称用于首页亲切称呼 + 语音问候）
  const finishOnboard = async () => {
    const name = onboardText.trim();
    if (!name) return;
    // 持久化到 AsyncStorage（之前只更新了本地 state，从未落盘，导致设置页读不到、重启后丢失）
    await saveChildName(name);
    setChildName(name);
    setOnboardVisible(false);
    // 带昵称的问候 / 告别是全新文本（内置 mp3 里没有），立刻后台预热一次，
    // 保证下次开机那句「早上好呀，小明！」也是秒出、不联网现合成。
    try {
      const v = await getPromptVoiceSetting();
      if (v && v.startsWith('preset:')) warmPresetVoiceInBackground(v);
    } catch {
      /* 预热失败不影响流程 */
    }
  };

  /**
   * 免费版门禁：AI 生成故事 / 旅行打卡 都是会员专属功能（entitlement.ts 已拦截）。
   * 这里在首页入口处提前拦截，免费用户点击即弹付费窗引导订阅，会员正常进入。
   */
  const openCreate = async () => {
    const gate = await checkStoryGate();
    if (showPaywall(gate)) router.push('/(tabs)/create');
  };
  const openTravel = async () => {
    const gate = await checkCheckInGate();
    if (showPaywall(gate)) router.push('/story/travel-checkin');
  };
  const openRecent = async (r: RecentItem) => {
    if (r.kind === 'ai') {
      const gate = await checkStoryGate();
      if (!showPaywall(gate)) return;
    } else if (r.kind === 'travel') {
      const gate = await checkCheckInGate();
      if (!showPaywall(gate)) return;
    }
    router.push(r.route);
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

      {/* 会员入口：只在未订阅 / 已过期时出现（已是会员就不再推销，v84 反馈 #6） */}
      {showPremiumCard && (
        <ElasticPressable
          style={styles.premiumCard}
          onPress={() => router.push('/(parent)/subscription?plan=yearly')}
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
      )}

      {/* 声音克隆：产品灵魂，常驻渲染、永不消失（v79：去掉可收起的临时状态） */}
      <View style={styles.cloneBanner}>
        <View style={styles.cloneBannerTextWrap}>
          <View style={styles.cloneBannerTitleRow}>
            <ClayIcon name="mic" size={34} />
            <Text style={styles.cloneBannerTitle}>
              {hasCloned ? t('home.cloneBanner.doneTitle') : t('home.cloneBanner.title')}
            </Text>
          </View>
          <Text style={styles.cloneBannerDesc}>
            {hasCloned ? t('home.cloneBanner.doneDesc') : t('home.cloneBanner.desc')}
          </Text>
        </View>
        <View style={styles.cloneBannerActions}>
          <TouchableOpacity
            style={styles.cloneBannerCta}
            onPress={() => router.push('/(parent)/voice-clone')}
          >
            <Text style={styles.cloneBannerCtaText}>
              {hasCloned ? t('home.cloneBanner.manage') : t('home.cloneBanner.cta')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/*
        今日推荐（v95 反馈：与「你想做什么呀」合并）
        -----------------------------------------------------------------------
        以前这里是「你想做什么呀？」+ 听故事 / 去打卡 / 我再想想，
        和下面那排大按钮完全重复；紧接着又是一张恒定不变的「今日推荐」卡片。
        现在只留这一张：每次进首页从 100 篇公版故事里随机挑一篇，点开直接听。
      */}
      {rec && (
        <TouchableOpacity
          style={styles.recCard}
          activeOpacity={0.85}
          onPress={() => router.push(`/story/${rec.id}`)}
        >
          <View style={styles.recCover}>
            <Text style={styles.recCoverEmoji}>{rec.emoji}</Text>
          </View>
          <View style={styles.recInfo}>
            <Text style={styles.recKicker}>✨ {t('home.recTitle')}</Text>
            <Text style={styles.recTitle} numberOfLines={1}>
              {rec.title}
            </Text>
            <Text style={styles.recMeta} numberOfLines={1}>
              {rec.tag ? `${rec.tag} · ` : ''}
              {t('home.recMinutes').replace('{n}', String(rec.minutes))}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.recSpeakBtn}
            onPress={speakRec}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('home.recSpeak')}
          >
            <Text style={styles.recSpeakEmoji}>🔊</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {/* 需求 5：等级与奖励进度 */}
      <LevelCard />

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionCard1}
          activeOpacity={0.8}
          onPress={() => router.push('/(tabs)/library')}
        >
          <ClayIcon name="book" size={38} style={styles.actionArt} />
          <Text style={styles.actionLabel}>{t('home.quickListen')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard2}
          activeOpacity={0.8}
          onPress={openCreate}
        >
          <ClayIcon name="starBig" size={38} style={styles.actionArt} />
          <Text style={styles.actionLabel}>{t('home.quickCreate')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard3}
          activeOpacity={0.8}
          onPress={openTravel}
        >
          <ClayIcon name="tent" size={38} style={styles.actionArt} />
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
            <TouchableOpacity key={r.key} style={styles.recentItem} onPress={() => openRecent(r)}>
              <ClayIcon name={r.kind === 'ai' ? 'starBig' : 'globe'} size={30} />
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
    color: '#3D3229',
  },

  raccoWrap: {
    alignItems: 'center',
    marginVertical: 16,
  },

  // 会员入口卡片
  premiumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDE7FF',
    borderRadius: 24,
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
    backgroundColor: '#9B7EDE',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    overflow: 'hidden',
  },

  // 声音克隆：产品灵魂，首页常驻、永远突出
  cloneBanner: {
    backgroundColor: '#EFE7FF',
    borderRadius: 22,
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 16,
    borderLeftWidth: 5,
    borderLeftColor: '#9B7EDE',
    boxShadow: '0 3px 12px rgba(124, 77, 255, 0.20)',
    elevation: 3,
  },
  cloneBannerTextWrap: {
    marginBottom: 12,
  },
  cloneBannerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#5B2E9C',
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
    backgroundColor: '#9B7EDE',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  cloneBannerCtaText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  cloneBannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },

  // 今日推荐：左侧分类图标 + 标题 + 分类/时长 + 右侧语音按钮
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7EA',
    borderRadius: 22,
    borderLeftWidth: 5,
    borderLeftColor: '#F2A65A',
    marginHorizontal: 24,
    marginBottom: 20,
    padding: 14,
    boxShadow: '0 3px 10px rgba(214, 150, 80, 0.18)',
    elevation: 3,
  },
  recCover: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#FFE9CC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recCoverEmoji: {
    fontSize: 30,
  },
  recInfo: {
    flex: 1,
    marginLeft: 14,
    marginRight: 8,
  },
  recKicker: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C77B33',
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  recTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#3D3229',
    marginBottom: 5,
  },
  recMeta: {
    fontSize: 12,
    color: '#8A7767',
  },
  recSpeakBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFE0B2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recSpeakEmoji: {
    fontSize: 20,
  },

  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  actionCard1: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#FFB5A0',
  },
  actionCard2: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#FFD3B0',
  },
  actionCard3: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#C8E6C9',
  },
  actionEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  /** 粘土贴图：补一点投影 + 底部间距，替代原来的 emoji 字号占位 */
  actionArt: {
    marginBottom: 6,
    shadowColor: '#8A6A55',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 3,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3D3229',
    textAlign: 'center',
  },

  section: {
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#3D3229',
    marginBottom: 12,
  },
  emptyState: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderStyle: 'dashed',
    borderRadius: 22,
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
    borderRadius: 18,
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
    color: '#3D3229',
    marginBottom: 2,
  },
  recentItemSub: {
    fontSize: 12,
    color: '#A8988A',
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
    borderRadius: 26,
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
    color: '#3D3229',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 28,
  },
  onboardInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#FFE0B2',
    borderRadius: 22,
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#3D3229',
    textAlign: 'center',
    marginBottom: 20,
  },
  onboardBtn: {
    // 深一档蜜桃 + 深咖字：对比度 5:1（原来的浅蜜桃配白字只有 2.7:1）
    backgroundColor: '#EE8B5E',
    borderRadius: 26,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  onboardBtnText: { fontSize: 17, fontWeight: '700', color: '#3D3229' },
});
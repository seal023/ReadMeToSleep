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
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useLanguage } from '../../hooks/useLanguage';
import { FONT } from '../../constants/theme';
import { COLORS } from '../../constants/Colors';
import { useRaccoGuide } from '../../hooks/useRaccoGuide';
import Racco from '../../components/common/Racco';
import AppIntroOverlay from '../../components/intro/AppIntroOverlay';
import { SceneRaccoLayer } from '../../components/ui/SceneRaccoLayer';
import { HOME_SCENE, SCENE_SHIFT_Y } from '../../constants/sceneBackgrounds';
import { LevelCard } from '../../components/ui/LevelCard';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { ClayIcon } from '../../components/ui/ClayIcon';
import { ClayFrame } from '../../components/ui/ClayFrame';
import { ElasticPressable } from '../../components/ui/CartoonButton';
import { getVoiceGuidance, getChildName, setChildName as saveChildName, getStories, getStory, getProgress, getPromptVoiceSetting, getVoiceSetting, CLASSIC_EN_IDS, FREE_OFFLINE_POOL_IDS } from '../../services/storage';
import { warmPresetVoiceInBackground } from '../../services/phraseCache';
import { getClonedTargets } from '../../services/voiceClone';
import { useEntitlement } from '../../hooks/useEntitlement';
import { speakWithBestVoice, playStory, stopStory, isStoryPlaying, isStoryResumePending } from '../../services/playback';
import { speakSystemVoice } from '../../services/raccoSystemVoice';
import { isBundledFreeStory, getBundledAudioAssetId } from '../../services/bundledAudio';
import { playBundledAudio } from '../../services/clonedVoicePlayback';
import { checkStoryGate, checkCheckInGate, getSnapshot } from '../../services/entitlement';
import storiesIndex from '../../data/classic-stories/stories-index.json';

/** Cold-start intro flag: reset only on JS reload (cold start), not on foregrounding */
let introPlayedThisLaunch = false;

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

  const { width: screenW, height: screenH } = useWindowDimensions();
  // Scene background only in true landscape: an iPad in portrait is tall, so a cover-scene
  // would crop the baked-in raccoon on the left. Portrait keeps the animated raccoon layout.
  const isWide = screenW >= 768 && screenW > screenH;

  // 小浣熊向导：首页不自动播（避开每日问候），点浣熊才说话 + 气泡 + 动作
  const guide = useRaccoGuide({ enterFrom: 'none', gesture: 'wave' });
  const HOME_GUIDE_KEYS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];

  /**
   * The cold-start intro now plays in a standalone full-screen AppIntroOverlay (no longer stacked on the home screen).
   * Home only decides whether to play; the overlay owns animation, voice, bubble and dismissal.
   * Plays once per cold start; foreground greetings are handled by GreetingOnOpen, not here.
   */
  const [introVisible, setIntroVisible] = useState(false);
  useEffect(() => {
    if (introPlayedThisLaunch) return;
    let alive = true;
    (async () => {
      // No voice before privacy consent (matches the global rule)
      let agreed = '';
      try { agreed = await AsyncStorage.getItem('rms_privacy_consent_v1') || ''; } catch {}
      if (!alive || agreed !== 'agreed') return;
      introPlayedThisLaunch = true; // claim the slot only once we know we will play, so a cancelled double mount cannot block it forever
      setIntroVisible(true);
    })();
    return () => { alive = false; };
  }, []);
  const handleIntroDone = useCallback(() => setIntroVisible(false), []);

  /** Tap the static raccoon in the scene (image hot zone): speak a guide line + bubble, no animation state switch */
  const handleRaccoPress = () => {
    const key = HOME_GUIDE_KEYS[Math.floor(Math.random() * HOME_GUIDE_KEYS.length)];
    guide.say(key);
  };

  // 语音推荐开关：沿用设置页原来的「语音引导」开关（那个提问卡片已删除）。
  // 必须每次聚焦都重读：tabs 是缓存的，用户在设置页打开开关后切回首页，mount 时的
  // useEffect 不会再跑，导致开关状态一直是旧值 → 语音介绍永远不触发（v116 反馈 #4）。
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getVoiceGuidance().then((on) => {
        if (alive) setVoiceRecOn(on);
      });
      return () => {
        alive = false;
      };
    }, [])
  );

  // 每次进入首页随机挑一篇（不与上次重复）；英文界面只在有英文正文的故事里挑。
  // v116+：今日推荐按会员身份分池——免费用户只能从 5 篇免费池挑（保证点开就能免费听，
  // 不会推荐到付费故事被门禁拦）；会员则放开到全部 100 篇经典故事集随机挑。
  // 这里实时读一次会员态（而非用首页缓存的 snapshot）：tabs 是缓存的，购买会员后
  // 回首页 snapshot 可能还是旧的，实时读能保证「刚买完会员就看到全量池推荐」立刻生效。
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const all = storiesIndex as ClassicIndexItem[];
        // 实时读会员态：免费限定 5 篇免费池；会员放开到全部故事集
        let premium = false;
        try {
          premium = (await getSnapshot()).premium === true;
        } catch {
          /* 读不到按免费处理，最保守 */
        }
        const source = premium
          ? all
          : all.filter((s) => FREE_OFFLINE_POOL_IDS.includes(s.id));
        const pool = source.filter((s) => language !== 'en' || CLASSIC_EN_IDS.has(s.id));
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

  /** 喇叭是否在播这篇推荐故事（用于图标在 🔊 / ⏸ 间切换） */
  const [recPlaying, setRecPlaying] = useState(false);

  /**
   * 喇叭：不进故事页、就地播放/停止今日推荐故事（v116 反馈 #5）。
   * 免费池的 5 篇用随包 MP3（零成本、断网可听）；其余故事走云端 TTS 朗读正文。
   * 再点一次即 stopStory() 停止，图标切回 🔊。
   */
  const toggleRecPlay = useCallback(async () => {
    if (!rec) return;
    if (recPlaying) {
      stopStory();
      setRecPlaying(false);
      return;
    }
    const finish = () => setRecPlaying(false);
    try {
      if (isBundledFreeStory(rec.id)) {
        const assetId = getBundledAudioAssetId(rec.id, language);
        if (assetId) {
          setRecPlaying(true);
          await playBundledAudio(assetId, finish);
          return;
        }
      }
      const story = await getStory(rec.id);
      if (!story) return;
      const text = language === 'en' ? (story.contentEn || story.content) : story.content;
      const voiceId = await getVoiceSetting();
      setRecPlaying(true);
      await playStory(text, voiceId, language, finish);
    } catch {
      setRecPlaying(false);
    }
  }, [rec, recPlaying, language]);

  // 离开首页/切走时把喇叭图标复位（声音会被全局的「换界面就闭嘴」停掉）
  useFocusEffect(
    useCallback(() => {
      return () => { setRecPlaying(false); };
    }, [])
  );

  // 开关打开时，进入首页会把今天的推荐念给孩子听（不识字也能知道推荐了哪篇）。
  // 修复要点（v116 反馈 #4）：
  //  1. 按 rec.id 去重，而不是「本次启动只念一次」的一次性布尔——换了一篇新推荐就能再念；
  //  2. 若此刻每日问候/故事正在播，绝不把「已念」标记置真，而是隔几秒重试，
  //     避免「正好撞上问候被跳过，然后这次会话再也不念」的死局；
  //  3. 每次只念一次，重试有上限，绝不无限打扰。
  const recAnnouncedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voiceRecOn || !rec || recAnnouncedIdRef.current === rec.id) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    const speak = () => {
      if (cancelled) return;
      // 每日问候 / 故事还在播：等 2.5 秒重试，最多 3 次（≈7.5 秒），不打断、不遗失
      if (isStoryPlaying() || isStoryResumePending()) {
        if (++tries <= 3) {
          retryTimer = setTimeout(speak, 2500);
        }
        return;
      }
      recAnnouncedIdRef.current = rec.id; // 真正要念了才标记，避免被跳过后永不再念
      const text = tRef.current('home.recVoice').replace('{title}', rec.title);
      // build127：统一走系统提示音入口（racco=预录浣熊声 rec_voice 通用句）
      // preset 模式仍念含故事名的完整句子（text 作兜底）
      void speakSystemVoice(language, { key: 'rec_voice', text });
    };
    const timer = setTimeout(speak, 4500); // 先等每日问候说完
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
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
    <View style={styles.root}>
      <CartoonScreen
        gradient="day"
        decor={false}
        wide={false}
        backgroundSource={isWide ? HOME_SCENE : undefined}
        backgroundResizeMode="contain"
        backgroundShiftY={isWide ? SCENE_SHIFT_Y : undefined}
      >
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, isWide && styles.contentWide]}
      >
      {/* Greeting sits with the card column in landscape; the left side is reserved for the static scene raccoon */}
      <View style={styles.greetingSection}>
        <Text style={[styles.greetingText, isWide && styles.greetingTextWide]}>
          {greeting} ✨
        </Text>
      </View>

      {/* Portrait: top raccoon (in landscape the baked-in scene raccoon takes over) */}
      {!isWide && (
        <ElasticPressable onPress={handleRaccoPress} style={styles.raccoWrap}>
          <Racco
            state={guide.line ? guide.state : 'idle'}
            size={screenW * 0.4}
            showSpeechBubble={!!guide.line}
            speechText={guide.line}
            gesture={guide.gesture}
            anim={guide.anim}
            animPlaying={guide.animPlaying}
          />
        </ElasticPressable>
      )}

      {/* 会员入口：只在未订阅 / 已过期时出现（已是会员就不再推销，v84 反馈 #6） */}
      {showPremiumCard && (
        <ElasticPressable
          style={styles.frameWrap}
          onPress={() => router.push('/(parent)/subscription?plan=yearly')}
          pressScale={0.94}
          bounciness={14}
        >
          <ClayFrame tone="lemon" hanger innerStyle={styles.frameInnerRow}>
            <Text style={styles.premiumEmoji}>💎</Text>
            <View style={styles.premiumTextWrap}>
              <Text style={styles.premiumTitle}>{t('home.premium.title')}</Text>
              <Text style={styles.premiumDesc}>{t('home.premium.desc')}</Text>
            </View>
            <Text style={styles.premiumCta}>{t('home.premium.cta')}</Text>
          </ClayFrame>
        </ElasticPressable>
      )}

      {/* 声音克隆：产品灵魂，常驻渲染、永不消失（v79：去掉可收起的临时状态） */}
      <ClayFrame tone="grape" style={styles.frameWrap} innerStyle={styles.cloneBanner}>
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
      </ClayFrame>

      {/*
        今日推荐（v95 反馈：与「你想做什么呀」合并）
        -----------------------------------------------------------------------
        以前这里是「你想做什么呀？」+ 听故事 / 去打卡 / 我再想想，
        和下面那排大按钮完全重复；紧接着又是一张恒定不变的「今日推荐」卡片。
        现在只留这一张：每次进首页从 100 篇公版故事里随机挑一篇，点开直接听。
      */}
      {rec && (
        <ClayFrame tone="peach" style={styles.frameWrap} innerStyle={styles.recInner}>
          {/* 整卡点击进故事：用 Pressable 铺满整卡，文字/封面区域都可点。
              喇叭独立叠在最上层、只响应自己的点击（v116 反馈 #5）。 */}
          <Pressable
            style={styles.recCardHit}
            onPress={() => router.push(`/story/${rec.id}`)}
            accessibilityRole="button"
            accessibilityLabel={rec.title}
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
          </Pressable>
          <Pressable
            style={styles.recSpeakBtn}
            onPress={toggleRecPlay}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('home.recSpeak')}
          >
            <Text style={styles.recSpeakEmoji}>{recPlaying ? '⏸️' : '🔊'}</Text>
          </Pressable>
        </ClayFrame>
      )}

      {/* 需求 5：等级与奖励进度 */}
      <LevelCard />

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionSlot}
          activeOpacity={0.85}
          onPress={() => router.push('/(tabs)/library')}
        >
          <ClayFrame tone="peach" nails={false} innerStyle={styles.actionInner}>
            <ClayIcon name="book" size={38} style={styles.actionArt} />
            <Text style={styles.actionLabel}>{t('home.quickListen')}</Text>
          </ClayFrame>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionSlot}
          activeOpacity={0.85}
          onPress={openCreate}
        >
          <ClayFrame tone="lemon" nails={false} innerStyle={styles.actionInner}>
            <ClayIcon name="starBig" size={38} style={styles.actionArt} />
            <Text style={styles.actionLabel}>{t('home.quickCreate')}</Text>
          </ClayFrame>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionSlot}
          activeOpacity={0.85}
          onPress={openTravel}
        >
          <ClayFrame tone="mint" nails={false} innerStyle={styles.actionInner}>
            <ClayIcon name="tent" size={38} style={styles.actionArt} />
            <Text style={styles.actionLabel}>{t('home.quickTravel')}</Text>
          </ClayFrame>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('home.recentStories')}</Text>
        {recent.length === 0 ? (
          <ClayFrame tone="cream" nails={false} innerStyle={styles.emptyInner}>
            <Text style={styles.emptyText}>{t('home.noStories')}</Text>
          </ClayFrame>
        ) : (
          recent.map((r) => (
            <TouchableOpacity key={r.key} style={styles.recentSlot} activeOpacity={0.85} onPress={() => openRecent(r)}>
              <ClayFrame tone={r.kind === 'ai' ? 'lemon' : 'sky'} nails={false} innerStyle={styles.recentInner}>
                <ClayIcon name={r.kind === 'ai' ? 'starBig' : 'globe'} size={30} />
                <View style={styles.recentItemInfo}>
                  <Text style={styles.recentItemTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.recentItemSub}>{r.sub}</Text>
                </View>
              </ClayFrame>
            </TouchableOpacity>
          ))
        )}
      </View>
      </ScrollView>

      {/* 首启昵称引导：进入 App 的第一步，询问"如何称呼宝贝"（从设置前置到首屏） */}
      <Modal
        visible={onboardVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <KeyboardAvoidingView
          style={styles.onboardOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.onboardScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.onboardCard}>
              <Text style={styles.onboardEmoji}>🐻</Text>
              <Text style={styles.onboardTitle}>{t('onboard.title')}</Text>
              <TextInput
                style={styles.onboardInput}
                value={onboardText}
                onChangeText={setOnboardText}
                placeholder={t('settings.childName.placeholder')}
                placeholderTextColor={COLORS.textLight}
                autoFocus
                maxLength={20}
              />
              <TouchableOpacity style={styles.onboardBtn} onPress={finishOnboard}>
                <Text style={styles.onboardBtnText}>{t('onboard.start')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      </CartoonScreen>

      {/* Landscape: raccoon hot zone + voice bubble over the scene (baked-in raccoon is static but can speak) */}
      {isWide && <SceneRaccoLayer text={guide.line} onPress={handleRaccoPress} />}

      {/* Standalone full-screen intro: auto-dismisses, never overlaps the static scene */}
      <AppIntroOverlay visible={introVisible} onDone={handleIntroDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  // iPad landscape: card column on the right, the whole left side reveals the static scene (raccoon on the sofa)
  contentWide: {
    width: '52%',
    maxWidth: 560,
    alignSelf: 'flex-end',
    marginRight: 18,
    paddingTop: 10,
    paddingBottom: 36,
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
    fontSize: 24,
    fontFamily: FONT.rounded,
    color: COLORS.text,
  },

  raccoWrap: {
    alignItems: 'center',
    marginVertical: 16,
  },

  // -- Clay frames: shared outer layout for all cards --------------------------------
  /** Frame wrapper layout: side gutters + bottom spacing (replaces each card's own margin) */
  frameWrap: {
    marginHorizontal: 24,
    marginBottom: 16,
  },
  /** Horizontal content layout inside the membership card frame */
  frameInnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingRight: 16,
  },

  // Membership card content (shell handled by ClayFrame)
  premiumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.purpleLight,
    borderRadius: 24,
    marginHorizontal: 24,
    marginBottom: 16,
    padding: 16,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.10)',
    elevation: 3,
  },
  premiumEmoji: { fontSize: 30, marginRight: 12 },
  premiumTextWrap: { flex: 1, marginRight: 8 },
  premiumTitle: { fontSize: 17, fontFamily: FONT.rounded, color: COLORS.text, marginBottom: 3 },
  premiumDesc: { fontSize: 12, color: COLORS.textSub, lineHeight: 18 },
  premiumCta: {
    backgroundColor: COLORS.purple,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: COLORS.white,
    fontSize: 13,
    fontWeight: 'bold',
    overflow: 'hidden',
  },

  // Voice cloning: the core feature, always on home (shell by ClayFrame; this block only sets inner padding)
  cloneBanner: {
    padding: 14,
  },
  cloneBannerTextWrap: {
    marginBottom: 12,
  },
  cloneBannerTitle: {
    fontSize: 18,
    fontFamily: FONT.rounded,
    color: COLORS.text,
    marginBottom: 4,
  },
  cloneBannerDesc: {
    fontSize: 13,
    color: COLORS.textSub,
    lineHeight: 20,
  },
  cloneBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cloneBannerCta: {
    backgroundColor: COLORS.purple,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  cloneBannerCtaText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  cloneBannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },

  // Today's pick: category icon + title + category/duration + speaker button (shell by ClayFrame)
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.orangeLight,
    borderRadius: 22,
    borderLeftWidth: 5,
    borderLeftColor: COLORS.orange,
    marginHorizontal: 24,
    marginBottom: 20,
    padding: 14,
    boxShadow: '0 3px 10px rgba(214, 150, 80, 0.18)',
    elevation: 3,
    position: 'relative',
  },
  /** Pick card content area: fill + padding (the speaker button is absolutely positioned against it) */
  recInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    minHeight: 88,
  },
  /** 整卡可点的透明热区（铺满卡片，喇叭再叠在它上面） */
  recCardHit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 48, // 给右侧喇叭留出独立点击空间，避免抢事件
  },
  recCover: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: COLORS.orangeLight,
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
    color: COLORS.orangeDeep,
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  recTitle: {
    fontSize: 19,
    fontFamily: FONT.rounded,
    color: COLORS.text,
    marginBottom: 5,
  },
  recMeta: {
    fontSize: 12,
    color: COLORS.textSub,
  },
  recSpeakBtn: {
    position: 'absolute',
    right: 14,
    top: 14,
    bottom: 14,
    width: 46,
    borderRadius: 23,
    backgroundColor: COLORS.orangeLight,
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
  /** Tap slots for the three shortcuts (shell by ClayFrame) */
  actionSlot: {
    flex: 1,
  },
  /** Shortcut content area: icon stacked above label */
  actionInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 4,
    minHeight: 104,
  },
  actionEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  /** 粘土贴图：补一点投影 + 底部间距，替代原来的 emoji 字号占位 */
  actionArt: {
    marginBottom: 6,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 3,
  },
  actionLabel: {
    fontSize: 16,
    fontFamily: FONT.rounded,
    color: COLORS.text,
    textAlign: 'center',
  },

  section: {
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: FONT.rounded,
    color: COLORS.text,
    marginBottom: 12,
  },
  emptyState: {
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderStyle: 'dashed',
    borderRadius: 22,
    paddingVertical: 36,
    alignItems: 'center',
  },
  /** Content area of the empty-state frame */
  emptyInner: {
    paddingVertical: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textLight,
  },

  // #6 Real "recent stories" entries on home (shell by ClayFrame)
  recentSlot: {
    marginBottom: 10,
  },
  recentInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
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
    fontSize: 16,
    fontFamily: FONT.rounded,
    color: COLORS.text,
    marginBottom: 2,
  },
  recentItemSub: {
    fontSize: 12,
    color: COLORS.textLight,
  },

  // 首启昵称引导弹窗样式
  onboardOverlay: {
    flex: 1,
    backgroundColor: 'rgba(60, 45, 35, 0.55)',
  },
  // 横屏矮屏/键盘弹起时内容可滚动，避免输入框与「开始」按钮被裁掉
  onboardScroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  onboardCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.cardSoft,
    borderRadius: 26,
    padding: 28,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  onboardEmoji: { fontSize: 46, marginBottom: 12 },
  onboardTitle: {
    fontSize: 23,
    fontFamily: FONT.rounded,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 30,
  },
  onboardInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: COLORS.orangeLight,
    borderRadius: 22,
    backgroundColor: COLORS.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  onboardBtn: {
    // 深一档蜜桃 + 深咖字：对比度 5:1（原来的浅蜜桃配白字只有 2.7:1）
    backgroundColor: COLORS.orangeDeep,
    borderRadius: 26,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  onboardBtnText: { fontSize: 18, fontFamily: FONT.rounded, color: COLORS.onPrimary },
});
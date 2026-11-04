import { useEffect, useState, useRef, useCallback } from 'react';
import { Modal, View, Text, Pressable, Linking, StyleSheet, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LanguageProvider, useLanguage } from '../hooks/useLanguage';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { trySilentRestore } from '../services/iap';
import { useAppStore } from '../store/appStore';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { ZCOOLKuaiLe_400Regular } from '@expo-google-fonts/zcool-kuaile';
import { CartoonButton } from '@/components/ui/CartoonButton';
import { COLORS, RADIUS, SPACING, FONT, FONT_SIZE, SHADOW } from '@/constants/theme';
import {
  getChildName, getPromptVoiceSetting, getVoiceSetting,
  migrateVoiceDefaultsOnce, migratePromptVoiceOnce,
} from '../services/storage';
import { speakWithBestVoice, stopStory, isStoryPlaying, isStoryResumePending } from '../services/playback';
import { invalidateAudioMode } from '../services/tts';
import { reassertAudioSession, isClonedAudioPlaying } from '../services/clonedVoicePlayback';
import { ensurePhraseWarmup, ensurePresetVoicesInstalled, applyName } from '../services/phraseCache';

/**
 * inactive → background 的间隔门槛（毫秒）。
 * 小于它：判为锁屏 / 关机（系统瞬间收走 App）→ 不说再见。
 * 大于它：判为按 Home / 上滑 / 切到别的 App → 说再见。
 * 实测锁屏常 < 60ms，主动返回桌面通常 300ms 以上，取 200ms 落在中间偏保守一侧
 * （宁可漏说一句再见，也不要在孩子睡着时冒出一句告别）。
 * 万一某机型判错，只改这一个数字即可，不用动别处。
 */
const LOCK_GAP_MS = 200;

/** 按机器本地时钟分四段问候，避免大晚上还播报"早上好" */
function getGreetingKey(): string {
  const h = new Date().getHours();
  if (h < 11) return 'home.greetingMorning';
  if (h < 13) return 'home.greetingNoon';
  if (h < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

/**
 * 告别语按时段分两套（2026-11-04，v93 反馈 #2）。
 * 需求：「上划退出 App 时，只需要说再见 xx 就可以，或者根据手机时钟选择用语」。
 * 原先固定一句「再见啦，xx！晚安，做个好梦～」——白天退出也在说晚安，而且话太长。
 * 现在：18 点后到凌晨 6 点说「晚安啦，xx！」，其余时间说「再见啦，xx！」。
 * 两句都进了 phraseCache 的预热清单，切后台时直接命中本地缓存，秒出。
 */
function getFarewellKey(): string {
  const h = new Date().getHours();
  return h >= 18 || h < 6 ? 'home.farewellNight' : 'home.farewellDay';
}

/**
 * 每日语音问候（2026-10-29）：每次打开 App（冷启动 / 从后台回到前台）都用 TTS 播报
 * "xxx，下午好 / 晚上好" 等，依时段 + 界面语言。需在隐私同意后才播报，且 60 秒内不重复。
 */
function GreetingOnOpen() {
  const { t, language, hydrated } = useLanguage();
  const lastSpoke = useRef(0);
  const lastBye = useRef(0);
  /**
   * 「锁屏」与「离开 App」的区分（2026-11-02，v77 反馈 #2）
   *
   * 需求：用户主动退出 App（按 Home / 上滑 / 切到别的 App）时说一句「再见」；
   *      锁屏或关机时**不说**。
   *
   * 难点：iOS 不向 JS 暴露「屏幕是否锁定」，锁屏和按 Home 的 AppState 序列
   *      完全一样（active → inactive → background），仅凭状态无法分辨。
   *
   * 但两者的**耗时**差别很大：按侧边键锁屏时，系统收走 App 是同一瞬间完成的，
   * inactive → background 间隔一般只有几十毫秒；而按 Home / 上滑返回桌面时，
   * 界面要先播完「回家」动画，App 才真正进入后台，通常 200ms 以上。
   * 因此用「inactive 停留时长」作判据：短于 LOCK_GAP_MS 视为锁屏/关机（不说话），
   * 长于它视为用户主动离开（说再见）。
   *
   * 关机（滑关机条）根本不会给 App 出声的机会，天然满足「关机不说」。
   */
  const inactiveAt = useRef(0);

  // 锁屏告别必须「立刻出声」：切后台后再去读 AsyncStorage、或等网络合成音频，会被 iOS 拖到
  // 十几秒后才响（后台网络被降速/挂起）。所以在前台时就把告别所需的一切预热到 ref：
  // 是否已同意隐私、孩子昵称、当前声线、当前语言与文案函数，切后台时全程同步取用、一毫秒不等。
  const agreedRef = useRef(false);
  const privacyReadyRef = useRef(false);
  const nameRef = useRef('');
  const voiceRef = useRef<string | undefined>(undefined);
  const langRef = useRef(language);
  langRef.current = language;
  const tRef = useRef(t);
  tRef.current = t;

  /** 前台时刷新告别所需的全部信息（启动 / 回到前台 / 家长改过昵称或声线后） */
  const refreshFarewellCache = useCallback(async () => {
    try {
      // 先确保「提示音声线」的历史遗留克隆值已纠正（幂等，一次即止）：
      // 否则首启这一句问候可能还按旧的克隆声线念，正是「提示音不该是克隆声」的来源。
      await migratePromptVoiceOnce();
      const agreed = await AsyncStorage.getItem(PRIVACY_CONSENT_KEY);
      agreedRef.current = agreed === 'agreed';
      privacyReadyRef.current = true;
      // v81：问候 / 告别属于「提示音」，读提示音声线（与故事朗读声线独立）
      const [name, voice] = await Promise.all([getChildName(), getPromptVoiceSetting()]);
      nameRef.current = name || '';
      voiceRef.current = voice;
    } catch {
      /* 预取失败保留旧值，不影响下次刷新 */
    }
  }, []);

  /** 同步拼出问候 / 告别文案（与 phraseCache 的预热文本规则逐字一致，保证命中缓存） */
  const buildText = useCallback((kind: 'hello' | 'bye') => {
    const base =
      kind === 'bye' ? tRef.current(getFarewellKey()) : tRef.current(getGreetingKey());
    // 昵称替换规则直接复用 phraseCache 的那一份：两处各写一遍迟早会走偏，缓存就永远不命中
    return applyName(base, nameRef.current);
  }, []);

  const speak = useCallback(async (kind: 'hello' | 'bye') => {
    const now = Date.now();
    if (kind === 'hello') {
      if (now - lastSpoke.current < 60000) return;
      lastSpoke.current = now;
      // 回到前台：顺手刷新告别缓存（昵称 / 声线可能刚在家长端改过）
      await refreshFarewellCache();
      if (!agreedRef.current) return;
      /**
       * 故事优先（v93 反馈 #1）：
       * 回前台时若「故事被打断、正要续播」或「故事正在播」，一律不播每日问候。
       * 因为 speakWithBestVoice 默认先 stopStory()——问候会把刚重建的分片播放器连同
       * chunkState 一起清掉，孩子的感受就是「回到 App 点播放一直缓冲 / 没声音」。
       */
      if (isStoryResumePending() || isStoryPlaying() || isClonedAudioPlaying()) return;
      // 问候用最好的声音（克隆声优先；已预热过的问候句命中缓存、秒出）
      speakWithBestVoice(buildText('hello'), langRef.current, { voiceId: voiceRef.current });
      return;
    }
    // —— 切后台 / 锁屏：全同步快通道 ——
    // 告别节流短一些，但避免「解锁→锁屏」高频刷屏
    if (now - lastBye.current < 5000) return;
    lastBye.current = now;
    lastSpoke.current = now;
    // 隐私尚未确认（极冷启动即锁屏）时不静默，等确认过再说
    if (privacyReadyRef.current && !agreedRef.current) return;
    speakWithBestVoice(buildText('bye'), langRef.current, {
      cacheOnly: true, // 只播已落盘的克隆音频；没缓存就立刻用系统音，绝不现场等网络合成
      fast: true, // 不等音频会话配置，直接起播，进一步压缩延迟
      voiceId: voiceRef.current, // 用预取的声线，省掉一次存储读取
    });
  }, [refreshFarewellCache, buildText]);

  useEffect(() => {
    // 等语言从存储/系统完成初始化后再问候：避免默认 zh 先播、hydrate 后又用英文重播的竞态
    if (!hydrated) return;
    let disposed = false;
    (async () => {
      await refreshFarewellCache();
      if (disposed) return;
      speak('hello');
    })();
    // 若已克隆声音，后台预热高频短句到本地缓存：使提示音是克隆声且秒出、零 token
    // （克隆较早 / 缓存被系统清理也能补上；同进程只跑一次）
    ensurePhraseWarmup();
    // 首次安装：把「除克隆声以外的所有声音」都装进本地缓存（大姐姐/温柔女声/大哥哥/邻家姐姐），
    // 之后任何提示音、任何音色试听都命中磁盘缓存 —— 不需要缓冲、离线也能响。
    void ensurePresetVoicesInstalled();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        // 回前台先重建音频会话（2026-11-01 修复 #2）：
        // iOS 锁屏时会收回 AVAudioSession，回到前台若不经 setAudioModeAsync 重新激活，
        // 之后所有 expo-speech 都是「静默失败」——用户听到的就是
        //「故事听到一半锁屏，回来以后很多提示音都没有了」。
        inactiveAt.current = 0;
        invalidateAudioMode();
        void reassertAudioSession();
        speak('hello');
      } else if (s === 'inactive') {
        // 只记录时刻，不做事：控制中心下拉、来电横幅也会走这里但不会进后台
        inactiveAt.current = Date.now();
      } else if (s === 'background') {
        // 修复 #2：切后台/锁屏时立即停掉所有朗读（故事 / 克隆声 / 系统音），
        // 否则故事会一直念到自然结束。speak('bye') 内部也会 stopStory，
        // 但这里先无条件停一次，确保即使用户快速重复锁屏被节流、bye 没播，故事也停。
        stopStory();
        // 锁屏 / 关机：系统几乎零延迟收走 App，inactive 只停留几十毫秒 → 不说再见。
        // 主动退出（Home / 上滑 / 切 App）：要等「回家」动画播完才进后台 → 说再见。
        const gap = inactiveAt.current ? Date.now() - inactiveAt.current : 0;
        inactiveAt.current = 0;
        if (gap >= LOCK_GAP_MS) speak('bye');
      }
    });
    return () => {
      disposed = true;
      sub.remove();
    };
  }, [hydrated, speak, refreshFarewellCache]);

  return null;
}

/**
 * 「换界面就闭嘴」：提示音 / 朗读不跟着用户走到下一个页面。
 * ---------------------------------------------------------------------------
 * 需求（2026-11-04）：退出、更换操作界面时，提示音必须马上停，不能一边翻页一边还在说。
 *
 * 实现：监听路由 pathname 变化，一变化就 stopStory()（同时停云端音频与系统语音）。
 * 冷启动那 STARTUP_GRACE_MS 内不拦：启动页 → 首页的一次跳转会把刚播的问候掐掉。
 */
const STARTUP_GRACE_MS = 2500;

function StopAudioOnNavigate() {
  const pathname = usePathname();
  const mountedAt = useRef(Date.now());
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;
    // 启动阶段的「启动页 → 首页」跳转不算用户换界面
    if (Date.now() - mountedAt.current < STARTUP_GRACE_MS) return;
    stopStory();
  }, [pathname]);

  return null;
}

/**
 * 登录成功后静默找回会员。
 * 换新手机的完整链路：装 App → 登录 → 这里自动向 App Store 查一次已有订阅 →
 * 命中就写回本地权益，用户打开就到账，不需要自己去点「恢复购买」。
 * 静默查询，不弹系统框；查不到也不做任何破坏性操作。
 */
function EntitlementSyncOnLogin() {
  const { isSignedIn, loading } = useAuth();
  const doneRef = useRef(false);

  useEffect(() => {
    if (loading || !isSignedIn || doneRef.current) return;
    doneRef.current = true;
    void trySilentRestore();
  }, [loading, isSignedIn]);

  return null;
}

const PRIVACY_CONSENT_KEY = 'rms_privacy_consent_v1';
const PRIVACY_POLICY_URL = 'https://seal023.github.io/ReadMeToSleep/privacy.html';

export default function RootLayout() {
  const [showPrivacy, setShowPrivacy] = useState(false);

  /**
   * 站酷快乐体（中文字形圆润，用于全部标题与按钮）。
   * ttf 随包内置（约 1.5MB），本地读取通常几十毫秒即可完成。
   * 三重保险，绝不因为字体卡住启动：
   *   - 加载完成        → 正常渲染
   *   - 加载报错        → 立即渲染（FONT.rounded 会自动回落到系统字体）
   *   - 超过 3 秒未见结果 → 强制渲染，避免极端情况下白屏
   */
  const [fontsLoaded, fontError] = useFonts({ ZCOOLKuaiLe_400Regular });
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(t);
  }, []);

  // 需求 五：启动 App 时弹出隐私声明，未同意不可继续使用
  useEffect(() => {
    AsyncStorage.getItem(PRIVACY_CONSENT_KEY).then((val) => {
      if (val !== 'agreed') setShowPrivacy(true);
    });
  }, []);

  // hydrate Zustand from storage
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      // v82：先把旧版本「克隆成功即自动写入」的克隆声线清回默认内置大姐姐（只跑一次），
      // 否则老设备升级后会看到「默认说是大姐姐、实际念故事还是妈妈的声音」。
      await migrateVoiceDefaultsOnce();
      // v92：提示音的初始声音统一回默认大姐姐（只纠正历史遗留的克隆值，不覆盖家长的选择）
      await migratePromptVoiceOnce();
      const [lang, voice, parentMode] = await Promise.all([
        AsyncStorage.getItem('rms_language'),
        getVoiceSetting(), // 已含默认值兜底，恒为有效声线
        AsyncStorage.getItem('rms_parent_mode'),
      ]);
      const s = useAppStore.getState();
      if (!cancelled) {
        if (lang) s.setLanguage(lang as 'zh' | 'en');
        s.setCurrentVoice(voice);
        if (parentMode !== null) s.setIsParentMode(parentMode === 'true');
      }
    };
    hydrate();
    return () => { cancelled = true; };
  }, []);

  const handlePrivacyAgree = async () => {
    await AsyncStorage.setItem(PRIVACY_CONSENT_KEY, 'agreed');
    setShowPrivacy(false);
    // 同意隐私政策后才开始联网「装声音」与短句预热（未同意前一行网络都不发）
    ensurePhraseWarmup();
    void ensurePresetVoicesInstalled();
  };

  const handleOpenPrivacyPolicy = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
  };

  // 字体加载的极短暂空窗（正常 <100ms）；超时或报错都会放行，见上方说明
  if (!fontsLoaded && !fontError && !fontTimeout) return null;

  return (
    <LanguageProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <GreetingOnOpen />
        <StopAudioOnNavigate />
        <EntitlementSyncOnLogin />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(parent)" />
          <Stack.Screen name="auth/login" />
          <Stack.Screen name="auth/perks" />
          <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
          {/* 界面配色：放在根级（不属于家长模式），孩子端设置页一级可达 */}
          <Stack.Screen name="theme" />
        </Stack>

        {/* 需求 五：隐私声明弹窗（置于 LanguageProvider 内，跟随系统语言） */}
        <PrivacyModal
          visible={showPrivacy}
          onAgree={handlePrivacyAgree}
          onOpenPolicy={handleOpenPrivacyPolicy}
        />
      </AuthProvider>
    </LanguageProvider>
  );
}

/**
 * 隐私声明弹窗：必须置于 LanguageProvider 内部才能用 useLanguage() 跟随系统语言。
 * 否则像之前那样在 Provider 外硬编码中文，英文系统也会显示中文。
 */
function PrivacyModal({
  visible,
  onAgree,
  onOpenPolicy,
}: {
  visible: boolean;
  onAgree: () => void;
  onOpenPolicy: () => void;
}) {
  const { t } = useLanguage();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.privacyOverlay}>
        <View style={styles.privacyCard}>
          <Text style={styles.privacyEmoji}>📖</Text>
          <Text style={styles.privacyTitle}>{t('privacy.title')}</Text>
          <Text style={styles.privacyIntro}>{t('privacy.intro')}</Text>

          <View style={styles.privacyBulletRow}>
            <Text style={styles.privacyCheck}>✅</Text>
            <Text style={styles.privacyBullet}>{t('privacy.b1')}</Text>
          </View>
          <View style={styles.privacyBulletRow}>
            <Text style={styles.privacyCheck}>✅</Text>
            <Text style={styles.privacyBullet}>{t('privacy.b2')}</Text>
          </View>
          <View style={styles.privacyBulletRow}>
            <Text style={styles.privacyCheck}>✅</Text>
            <Text style={styles.privacyBullet}>{t('privacy.b3')}</Text>
          </View>

          <View style={styles.privacyBtnWrap}>
            <CartoonButton title={t('privacy.agree')} emoji="✅" full onPress={onAgree} />
          </View>
          <Pressable onPress={onOpenPolicy} hitSlop={8}>
            <Text style={styles.privacyLink}>{t('privacy.policy')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  privacyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(60, 45, 35, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  privacyCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    ...SHADOW.card,
  },
  privacyEmoji: {
    fontSize: 46,
    marginBottom: SPACING.sm,
  },
  privacyTitle: {
    fontSize: FONT_SIZE.title,
    fontWeight: '800',
    color: COLORS.text,
    fontFamily: FONT.rounded,
    marginBottom: SPACING.md,
  },
  privacyIntro: {
    fontSize: FONT_SIZE.body,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.md,
    lineHeight: 24,
  },
  privacyBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: SPACING.sm,
  },
  privacyCheck: {
    fontSize: 18,
    marginRight: SPACING.sm,
    lineHeight: 22,
  },
  privacyBullet: {
    flex: 1,
    fontSize: FONT_SIZE.body,
    color: COLORS.text,
    lineHeight: 22,
  },
  privacyBtnWrap: {
    width: '100%',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  privacyLink: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    textDecorationLine: 'underline',
    marginTop: SPACING.xs,
  },
});

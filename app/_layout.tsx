import { useEffect, useState, useRef, useCallback } from 'react';
import { Modal, View, Text, Pressable, Linking, StyleSheet, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LanguageProvider, useLanguage } from '../hooks/useLanguage';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { trySilentRestore } from '../services/iap';
import { useAppStore } from '../store/appStore';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CartoonButton } from '@/components/ui/CartoonButton';
import { COLORS, RADIUS, SPACING, FONT, FONT_SIZE, SHADOW } from '@/constants/theme';
import { getChildName, getVoiceSetting } from '../services/storage';
import { speakWithBestVoice, stopStory } from '../services/playback';
import { ensurePhraseWarmup } from '../services/phraseCache';

/** 按机器本地时钟分四段问候，避免大晚上还播报"早上好" */
function getGreetingKey(): string {
  const h = new Date().getHours();
  if (h < 11) return 'home.greetingMorning';
  if (h < 13) return 'home.greetingNoon';
  if (h < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

/**
 * 每日语音问候（2026-10-29）：每次打开 App（冷启动 / 从后台回到前台）都用 TTS 播报
 * "xxx，下午好 / 晚上好" 等，依时段 + 界面语言。需在隐私同意后才播报，且 60 秒内不重复。
 */
function GreetingOnOpen() {
  const { t, language, hydrated } = useLanguage();
  const lastSpoke = useRef(0);
  const lastBye = useRef(0);

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
      const agreed = await AsyncStorage.getItem(PRIVACY_CONSENT_KEY);
      agreedRef.current = agreed === 'agreed';
      privacyReadyRef.current = true;
      const [name, voice] = await Promise.all([getChildName(), getVoiceSetting()]);
      nameRef.current = name || '';
      voiceRef.current = voice;
    } catch {
      /* 预取失败保留旧值，不影响下次刷新 */
    }
  }, []);

  /** 同步拼出问候 / 告别文案（与 phraseCache 的预热文本规则逐字一致，保证命中缓存） */
  const buildText = useCallback((kind: 'hello' | 'bye') => {
    const base = kind === 'bye' ? tRef.current('home.farewell') : tRef.current(getGreetingKey());
    const name = nameRef.current;
    return name
      ? base.replace('{name}', name)
      : base.replace('，{name}！', '！').replace(', {name}!', '!');
  }, []);

  const speak = useCallback(async (kind: 'hello' | 'bye') => {
    const now = Date.now();
    if (kind === 'hello') {
      if (now - lastSpoke.current < 60000) return;
      lastSpoke.current = now;
      // 回到前台：顺手刷新告别缓存（昵称 / 声线可能刚在家长端改过）
      await refreshFarewellCache();
      if (!agreedRef.current) return;
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
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') speak('hello');
      else if (s === 'background') {
        // 修复 #2：切后台/锁屏时立即停掉所有朗读（故事 / 克隆声 / 系统音），
        // 否则故事会一直念到自然结束。speak('bye') 内部也会 stopStory，
        // 但这里先无条件停一次，确保即使用户快速重复锁屏被节流、bye 没播，故事也停。
        stopStory();
        speak('bye'); // 锁屏/切后台时说「再见xxx」
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
      const lang = await AsyncStorage.getItem('rms_language');
      const voice = await AsyncStorage.getItem('rms_voice');
      const parentMode = await AsyncStorage.getItem('rms_parent_mode');
      const s = useAppStore.getState();
      if (!cancelled) {
        if (lang) s.setLanguage(lang as 'zh' | 'en');
        if (voice) s.setCurrentVoice(voice);
        if (parentMode !== null) s.setIsParentMode(parentMode === 'true');
      }
    };
    hydrate();
    return () => { cancelled = true; };
  }, []);

  const handlePrivacyAgree = async () => {
    await AsyncStorage.setItem(PRIVACY_CONSENT_KEY, 'agreed');
    setShowPrivacy(false);
  };

  const handleOpenPrivacyPolicy = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
  };

  return (
    <LanguageProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <GreetingOnOpen />
        <EntitlementSyncOnLogin />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(parent)" />
          <Stack.Screen name="auth/login" />
          <Stack.Screen name="auth/perks" />
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

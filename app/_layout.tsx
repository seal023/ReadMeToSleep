import { useEffect, useState, useRef, useCallback } from 'react';
import { Modal, View, Text, Pressable, Linking, StyleSheet, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LanguageProvider, useLanguage } from '../hooks/useLanguage';
import { useAppStore } from '../store/appStore';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CartoonButton } from '@/components/ui/CartoonButton';
import { COLORS, RADIUS, SPACING, FONT, FONT_SIZE, SHADOW } from '@/constants/theme';
import { getChildName } from '../services/storage';
import { textToSpeech } from '../services/tts';

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

  const speak = useCallback(async () => {
    const agreed = await AsyncStorage.getItem(PRIVACY_CONSENT_KEY);
    if (agreed !== 'agreed') return;
    const now = Date.now();
    if (now - lastSpoke.current < 60000) return;
    const name = (await getChildName()) || '';
    const base = t(getGreetingKey());
    const text = name
      ? base.replace('{name}', name)
      : base.replace('，{name}！', '！').replace(', {name}!', '!');
    lastSpoke.current = now;
    textToSpeech(text, 'system', language);
  }, [t, language]);

  useEffect(() => {
    // 等语言从存储/系统完成初始化后再问候：避免默认 zh 先播、hydrate 后又用英文重播的竞态
    if (!hydrated) return;
    speak();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') speak();
    });
    return () => sub.remove();
  }, [hydrated, speak]);

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
      <StatusBar style="dark" />
      <GreetingOnOpen />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(parent)" />
      </Stack>

      {/* 需求 五：隐私声明弹窗 */}
      <Modal
        visible={showPrivacy}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.privacyOverlay}>
          <View style={styles.privacyCard}>
            <Text style={styles.privacyEmoji}>📖</Text>
            <Text style={styles.privacyTitle}>隐私声明</Text>
            <Text style={styles.privacyIntro}>Read Me To Sleep 尊重并保护你的隐私：</Text>

            <View style={styles.privacyBulletRow}>
              <Text style={styles.privacyCheck}>✅</Text>
              <Text style={styles.privacyBullet}>所有数据（录音、声音克隆、故事记录）仅保存在本设备上</Text>
            </View>
            <View style={styles.privacyBulletRow}>
              <Text style={styles.privacyCheck}>✅</Text>
              <Text style={styles.privacyBullet}>我们不会上传、收集或分享任何个人信息</Text>
            </View>
            <View style={styles.privacyBulletRow}>
              <Text style={styles.privacyCheck}>✅</Text>
              <Text style={styles.privacyBullet}>删除 App 后，所有数据将被永久删除，无法恢复</Text>
            </View>

            <View style={styles.privacyBtnWrap}>
              <CartoonButton title="同意并继续" emoji="✅" full onPress={handlePrivacyAgree} />
            </View>
            <Pressable onPress={handleOpenPrivacyPolicy} hitSlop={8}>
              <Text style={styles.privacyLink}>查看完整隐私政策</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </LanguageProvider>
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

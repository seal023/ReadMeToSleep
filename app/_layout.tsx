import { useEffect, useLayoutEffect } from 'react';
import { ToastAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LanguageProvider } from '../hooks/useLanguage';
import { useAppStore } from '../store/appStore';
import { Stack, useRouter, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

const PRIVACY_SHOWN_KEY = 'rms_privacy_shown_v1';

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();

  // catch-all fallback for /(parent)/...
  useLayoutEffect(() => {
    if (pathname?.startsWith('/(parent)/')) {
      const sub = pathname.slice('/(parent)/'.length);
      const known = ['index', 'hub', 'child-profile', 'subscription', 'sensitive-words', 'child-recordings', 'voice-clone', 'statistics'];
      if (!known.includes(sub)) {
        router.replace('/(parent)/settings');
      }
    }
  }, [pathname, router]);

  // privacy toast on first open
  useEffect(() => {
    AsyncStorage.getItem(PRIVACY_SHOWN_KEY).then((val) => {
      if (!val) {
        const msg = Platform.OS === 'ios'
          ? '所有数据仅存储在设备本地，不收集任何个人信息。'
          : 'All data stored locally. No personal info collected.';
        ToastAndroid.show(msg, ToastAndroid.SHORT);
        AsyncStorage.setItem(PRIVACY_SHOWN_KEY, '1');
      }
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

  return (
    <LanguageProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(parent)" />
      </Stack>
    </LanguageProvider>
  );
}

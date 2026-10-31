import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT } from '../../constants/theme';
import { useLanguage } from '../../hooks/useLanguage';
import {
  getSleepTimerMinutes, setSleepTimerMinutes,
  getSleepLockEnabled, setSleepLockEnabled,
} from '../../services/storage';

const OPTIONS = [
  { value: 0, labelKey: 'sleep.optionOff' },
  { value: 15, labelKey: 'sleep.option15' },
  { value: 30, labelKey: 'sleep.option30' },
  { value: 45, labelKey: 'sleep.option45' },
  { value: 60, labelKey: 'sleep.option60' },
  { value: 90, labelKey: 'sleep.option90' },
];

export default function SleepTimerSettings() {
  const { t, language: uiLang } = useLanguage();
  const [minutes, setMinutes] = useState(0);
  const [lockEnabled, setLockEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const m = await getSleepTimerMinutes();
      const l = await getSleepLockEnabled();
      setMinutes(m);
      setLockEnabled(l);
      setLoaded(true);
    })();
  }, []);

  const choose = async (v: number) => {
    setMinutes(v);
    await setSleepTimerMinutes(v);
  };

  const toggleLock = async (v: boolean) => {
    setLockEnabled(v);
    await setSleepLockEnabled(v);
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('sleep.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Text style={styles.desc}>{t('sleep.desc')}</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('sleep.sectionDuration')}</Text>
          {OPTIONS.map((o) => {
            const active = minutes === o.value;
            return (
              <TouchableOpacity
                key={o.value}
                style={active ? styles.optionActive : styles.option}
                onPress={() => choose(o.value)}
              >
                <Text style={active ? styles.optionTextActive : styles.optionText}>
                  {t(o.labelKey)}
                </Text>
                {active ? <Text style={styles.check}>✓</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.card}>
          <View style={styles.lockRow}>
            <View style={styles.lockTextWrap}>
              <Text style={styles.sectionTitle}>{t('sleep.lockTitle')}</Text>
              <Text style={styles.lockDesc}>{t('sleep.lockDesc')}</Text>
            </View>
            <Switch
              value={lockEnabled}
              onValueChange={toggleLock}
              thumbColor={lockEnabled ? COLORS.orange : '#ccc'}
              trackColor={{ false: '#ddd', true: COLORS.orange + '66' }}
            />
          </View>
        </View>

        <Text style={styles.tip}>
          {uiLang === 'en'
            ? 'Applies to the next playback. When time is up, audio fades out and stops automatically.'
            : '设置将在下一次播放时生效；时间到后声音会缓缓淡出并自动停止。'}
        </Text>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, marginBottom: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center',
  },
  backBtnText: { fontSize: 22, color: COLORS.text },
  headerSpacer: { width: 40 },
  title: { fontSize: 20, fontWeight: 'bold', color: COLORS.text, fontFamily: FONT.rounded },
  desc: { fontSize: 14, color: COLORS.textSub, lineHeight: 22, marginBottom: 16 },
  card: {
    backgroundColor: COLORS.card, borderRadius: 18, padding: 16, marginBottom: 14,
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)', elevation: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 10 },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: '#fff', marginBottom: 8, borderWidth: 1, borderColor: '#eee',
  },
  optionActive: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: COLORS.orange + '1A', marginBottom: 8, borderWidth: 1.5, borderColor: COLORS.orange,
  },
  optionText: { fontSize: 15, color: COLORS.text },
  optionTextActive: { fontSize: 15, color: COLORS.orange, fontWeight: '600' },
  check: { fontSize: 18, color: COLORS.orange },
  lockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockTextWrap: { flex: 1, marginRight: 12 },
  lockDesc: { fontSize: 12, color: COLORS.textSub, lineHeight: 18, marginTop: 4 },
  tip: { fontSize: 12, color: COLORS.textLight, lineHeight: 18, marginTop: 4 },
});

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { generateStory } from '@/services/ai';
import { saveStory, getSensitiveWords } from '@/services/storage';
import { checkStoryGate, recordStoryGenerated } from '@/services/entitlement';
import { useLanguage } from '@/hooks/useLanguage';
import { useEntitlement } from '@/hooks/useEntitlement';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import type { Story, Language, RaccoState } from '@/types';

export default function CreateScreen() {
  const router = useRouter();
  const { t, language: uiLang } = useLanguage();

  const [theme, setTheme] = useState('');
  const [protagonist, setProtagonist] = useState('');
  const [details, setDetails] = useState('');
  // 默认跟随当前界面语言：英文界面下生成英文故事；用户仍可用 chip 手动覆盖
  const [storyLang, setStoryLang] = useState<Language>(uiLang);
  // 在「设置」里切换语言时，同步把默认生成语言切过去（除非用户已手动选了别的）
  useEffect(() => {
    setStoryLang(uiLang);
  }, [uiLang]);
  const [generating, setGenerating] = useState(false);
  const [raccoState, setRaccoState] = useState<RaccoState>('idle');
  const { snapshot, refresh, showPaywall } = useEntitlement();

  const handleGenerate = async () => {
    if (!theme.trim()) {
      Alert.alert(t('create.alert.title'), t('create.alert.themeRequired'));
      return;
    }

    // 每日额度门禁（会员不限）
    const gate = await checkStoryGate();
    if (!showPaywall(gate)) return;

    setGenerating(true);
    setRaccoState('thinking');
    try {
      // 读取家长设置的敏感词，交给 AI 主动规避
      const sensitive = await getSensitiveWords();
      const result = await generateStory({
        theme,
        protagonist,
        details,
        language: storyLang,
        sensitiveWords: [...sensitive.words, ...sensitive.phrases],
      });
      const story: Story = {
        id: Date.now().toString(),
        title: result.title,
        content: result.content,
        language: storyLang,
        type: 'ai_generated',
        tags: [theme],
        duration: result.duration,
        createdAt: new Date().toISOString(),
      };
      if (result.fallback) {
        // AI 不可用（如未配置 Key），已用主题化本地兜底，明确告知用户
        Alert.alert(t('create.alert.title'), t('create.aiUnavailable'));
      }
      await saveStory(story);
      await recordStoryGenerated();
      await refresh();
      setRaccoState('happy');
      router.push(`/story/${story.id}`);
    } catch (e) {
      console.error('Generate story error:', e);
      setRaccoState('idle');
      Alert.alert(t('common.error'), t('create.genFailed'));
    }
    setGenerating(false);
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.raccoWrap}>
        <Racco
          state={generating ? 'thinking' : raccoState}
          size={120}
          showSpeechBubble
        />
      </View>

      <Text style={styles.title}>{t('create.title')}</Text>

      <View style={styles.card}>
        <Text style={styles.icon}>🌟</Text>
        <TextInput
          style={styles.input}
          placeholder={t('create.ph.theme')}
          value={theme}
          onChangeText={setTheme}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.icon}>🐰</Text>
        <TextInput
          style={styles.input}
          placeholder={t('create.ph.protagonist')}
          value={protagonist}
          onChangeText={setProtagonist}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.icon}>✨</Text>
        <TextInput
          style={styles.inputMultiline}
          placeholder={t('create.ph.details')}
          value={details}
          onChangeText={setDetails}
          multiline
          numberOfLines={3}
        />
      </View>

      <View style={styles.langRow}>
        {(['zh', 'en'] as Language[]).map((lang) => (
          <TouchableOpacity
            key={lang}
            style={storyLang === lang ? styles.chipActive : styles.chip}
            onPress={() => setStoryLang(lang)}
          >
            <Text style={storyLang === lang ? styles.chipTextActive : styles.chipText}>
              {lang === 'zh' ? '中文' : 'English'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {snapshot && !snapshot.premium && snapshot.storiesRemaining !== null && (
        <Text style={styles.quota}>
          {t('create.quota').replace('{n}', String(snapshot.storiesRemaining))}
        </Text>
      )}

      <TouchableOpacity
        style={generating ? styles.btnDisabled : styles.btn}
        onPress={handleGenerate}
        disabled={generating}
        activeOpacity={0.8}
      >
        <Text style={styles.btnText}>
          {generating ? '⏳ ...' : `✨ ${t('create.submit')}`}
        </Text>
      </TouchableOpacity>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  raccoWrap: { alignItems: 'center', marginTop: 16, marginBottom: 8 },
  title: { fontSize: 24, color: '#5D4037', textAlign: 'center', marginBottom: 20, fontWeight: '700' },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
    elevation: 2,
  },
  icon: { fontSize: 22, marginRight: 10, marginTop: 2 },
  quota: {
    fontSize: 12,
    color: '#8D6E63',
    textAlign: 'center',
    marginBottom: 10,
  },
  input: { flex: 1, fontSize: 16, color: '#333', padding: 0 },
  inputMultiline: { flex: 1, fontSize: 16, color: '#333', padding: 0, minHeight: 60, textAlignVertical: 'top' },
  langRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: 16, gap: 12 },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFE0B2',
  },
  chipActive: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FF6B6B' },
  chipText: { fontSize: 15, color: '#5D4037' },
  chipTextActive: { fontSize: 15, color: '#FFF', fontWeight: '600' },
  btn: {
    backgroundColor: '#FF8A65',
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: {
    backgroundColor: '#FF8A65',
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    opacity: 0.5,
  },
  btnText: { fontSize: 18, color: '#FFF', fontWeight: '700' },
});
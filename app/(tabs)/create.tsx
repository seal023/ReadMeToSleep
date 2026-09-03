import React, { useState } from 'react';
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
import type { Story, Language, RaccoState } from '@/types';

export default function CreateScreen() {
  const router = useRouter();
  const { t } = useLanguage();

  const [theme, setTheme] = useState('');
  const [protagonist, setProtagonist] = useState('');
  const [details, setDetails] = useState('');
  const [storyLang, setStoryLang] = useState<Language>('zh');
  const [generating, setGenerating] = useState(false);
  const [raccoState, setRaccoState] = useState<RaccoState>('idle');
  const { snapshot, refresh, showPaywall } = useEntitlement();

  const handleGenerate = async () => {
    if (!theme.trim()) {
      Alert.alert('提示', '请输入故事主题');
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
      await saveStory(story);
      await recordStoryGenerated();
      await refresh();
      setRaccoState('happy');
      router.push(`/story/${story.id}`);
    } catch (e) {
      console.error('Generate story error:', e);
      setRaccoState('idle');
      Alert.alert(t('common.error'), '生成故事失败，请重试');
    }
    setGenerating(false);
  };

  return (
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
          placeholder="太空探险 / Space adventure"
          value={theme}
          onChangeText={setTheme}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.icon}>🐰</Text>
        <TextInput
          style={styles.input}
          placeholder="小兔子 / Little rabbit"
          value={protagonist}
          onChangeText={setProtagonist}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.icon}>✨</Text>
        <TextInput
          style={styles.inputMultiline}
          placeholder="找到魔法星球 / Found a magic planet"
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
          今日剩余 {snapshot.storiesRemaining} 个故事 · 会员不限量
        </Text>
      )}

      <TouchableOpacity
        style={generating ? styles.btnDisabled : styles.btn}
        onPress={handleGenerate}
        disabled={generating}
        activeOpacity={0.8}
      >
        <Text style={styles.btnText}>
          {generating ? '⏳ ...' : '✨ 生成故事 / Generate Story'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5E6' },
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
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
import { generateStory } from '@/services/openclaw';
import { saveStory } from '@/services/storage';
import { useLanguage } from '@/hooks/useLanguage';
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

  const handleGenerate = async () => {
    setGenerating(true);
    setRaccoState('thinking');
    try {
      const result = await generateStory({
        theme,
        protagonist,
        details,
        language: storyLang,
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
      setRaccoState('happy');
      router.push(`/story/${story.id}`);
    } catch (e) {
      setRaccoState('idle');
      Alert.alert(t('common.error'));
    }
    setGenerating(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Racco */}
      <View style={styles.raccoWrap}>
        <Racco
          state={generating ? 'thinking' : raccoState}
          size={120}
          showSpeechBubble
        />
      </View>

      {/* Title */}
      <Text style={styles.title}>{t('create.title')}</Text>

      {/* Input: Theme */}
      <View style={styles.card}>
        <Text style={styles.icon}>🌟</Text>
        <TextInput
          style={styles.input}
          placeholder="太空探险 / Space adventure"
          value={theme}
          onChangeText={setTheme}
        />
      </View>

      {/* Input: Protagonist */}
      <View style={styles.card}>
        <Text style={styles.icon}>🐰</Text>
        <TextInput
          style={styles.input}
          placeholder="小兔子 / Little rabbit"
          value={protagonist}
          onChangeText={setProtagonist}
        />
      </View>

      {/* Input: Details */}
      <View style={styles.card}>
        <Text style={styles.icon}>✨</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="找到魔法星球 / Found a magic planet"
          value={details}
          onChangeText={setDetails}
          multiline
          numberOfLines={3}
        />
      </View>

      {/* Language selector */}
      <View style={styles.langRow}>
        {(['zh', 'en'] as Language[]).map((lang) => (
          <TouchableOpacity
            key={lang}
            style={[styles.chip, storyLang === lang && styles.chipActive]}
            onPress={() => setStoryLang(lang)}
          >
            <Text style={[styles.chipText, storyLang === lang && styles.chipTextActive]}>
              {lang === 'zh' ? '中文' : 'English'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Generate button */}
      <TouchableOpacity
        style={[styles.btn, generating && styles.btnDisabled]}
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
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  icon: { fontSize: 22, marginRight: 10, marginTop: 2 },
  input: { flex: 1, fontSize: 16, color: '#333', padding: 0 },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  langRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: 16, gap: 12 },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFE0B2',
  },
  chipActive: { backgroundColor: '#FF6B6B' },
  chipText: { fontSize: 15, color: '#5D4037' },
  chipTextActive: { color: '#FFF', fontWeight: '600' },
  btn: {
    backgroundColor: '#FF8A65',
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: 18, color: '#FFF', fontWeight: '700' },
});

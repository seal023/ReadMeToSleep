import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { generateStory } from '@/services/ai';
import { saveStory, getSensitiveWords } from '@/services/storage';
import { checkStoryGate, recordStoryGenerated } from '@/services/entitlement';
import { storyCacheKey, findPlayableCachedStory, attachStoryId } from '@/services/storyCache';
import { useLanguage } from '@/hooks/useLanguage';
import { useEntitlement } from '@/hooks/useEntitlement';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import type { Story, Language, RaccoState, GenerateStoryParams } from '@/types';

export default function CreateScreen() {
  const router = useRouter();
  const { t, language: uiLang } = useLanguage();

  const [theme, setTheme] = useState('');
  const [protagonist, setProtagonist] = useState('');
  const [details, setDetails] = useState('');
  // 默认跟随当前界面语言：英文界面下生成英文故事；用户仍可用 chip 手动覆盖
  const [storyLang, setStoryLang] = useState<Language>(uiLang);
  // 时长分级：short 3-4 分钟 / medium 10-15 分钟 / long 20-30 分钟
  const [storyLength, setStoryLength] = useState<'short' | 'medium' | 'long'>('short');
  // 在「设置」里切换语言时，同步把默认生成语言切过去（除非用户已手动选了别的）
  useEffect(() => {
    setStoryLang(uiLang);
  }, [uiLang]);

  // 生成时的旋转光环 + 魔法闪烁（对应设计稿 s-gen；思考浣熊由 Racco thinking 态提供）
  const spinAnim = useRef(new Animated.Value(0)).current;
  const twinkleAnim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 2200, useNativeDriver: true }),
    );
    const twinkleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(twinkleAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(twinkleAnim, { toValue: 0.3, duration: 900, useNativeDriver: true }),
      ]),
    );
    spinLoop.start();
    twinkleLoop.start();
    return () => {
      spinLoop.stop();
      twinkleLoop.stop();
    };
  }, [spinAnim, twinkleAnim]);
  const [generating, setGenerating] = useState(false);
  const [raccoState, setRaccoState] = useState<RaccoState>('idle');
  // 生成中循环展示的可爱短句（不识字的孩子也能通过文字气泡 + 语音辅助理解"正在努力生成"）
  const GEN_PHRASE_KEYS = ['create.genPhrase.1', 'create.genPhrase.2', 'create.genPhrase.3', 'create.genPhrase.4', 'create.genPhrase.5', 'create.genPhrase.6'];
  const [phraseIdx, setPhraseIdx] = useState(0);
  useEffect(() => {
    if (!generating) return;
    const id = setInterval(() => setPhraseIdx((i) => (i + 1) % GEN_PHRASE_KEYS.length), 2500);
    return () => clearInterval(id);
  }, [generating, GEN_PHRASE_KEYS.length]);
  const { snapshot, refresh, showPaywall } = useEntitlement();

  const storyLengthBucket = (): 'short' | 'long' =>
    storyLength === 'short' ? 'short' : 'long';

  const handleGenerate = async () => {
    if (!theme.trim()) {
      Alert.alert(t('create.alert.title'), t('create.alert.themeRequired'));
      return;
    }

    // 读取家长设置的敏感词（同时纳入缓存键：换词表必须重新生成）
    const sensitive = await getSensitiveWords();
    const params: GenerateStoryParams = {
      theme,
      protagonist,
      details,
      language: storyLang,
      length: storyLength,
      sensitiveWords: [...sensitive.words, ...sensitive.phrases],
    };
    const cacheKey = storyCacheKey(params);

    /**
     * ★ 缓存优先（v102）：同一套参数已经编过故事，就直接播那一篇。
     * 不发 LLM 请求、不扣当日次数、不写埋点 —— 这是「优先走缓存」的硬要求。
     * 原故事被删掉时，用缓存里的正文重新落一份，同样不联网、不扣次数。
     */
    const cached = await findPlayableCachedStory(cacheKey);
    if (cached) {
      let id = cached.storyId;
      if (!id) {
        const restored: Story = {
          id: Date.now().toString(),
          title: cached.result.title,
          content: cached.result.content,
          language: storyLang,
          type: 'ai_generated',
          tags: [theme],
          duration: cached.result.duration,
          createdAt: new Date().toISOString(),
        };
        await saveStory(restored);
        await attachStoryId(cacheKey, restored.id);
        id = restored.id;
      }
      setRaccoState('happy');
      router.push(`/story/${id}?autoplay=1`);
      return;
    }

    // 前置校验：免费 1 次/天、会员 3 次/天，满额在**发请求之前**拦截并弹提示
    const gate = await checkStoryGate();
    if (!showPaywall(gate)) return;

    setGenerating(true);
    setRaccoState('thinking');
    try {
      const result = await generateStory(params);
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
      // AI 真的写了稿子才会进缓存；绑上 storyId 后下次同参数可直接播放
      await attachStoryId(cacheKey, story.id);
      await recordStoryGenerated({ storyLength: storyLengthBucket(), source: 'create' });
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
        {/* v79 修复：光环/星星原先绝对定位在「占满整行」的容器里，会飘到左上角且显得巨大。
            现在包一层与浣熊等宽的定尺容器，环只绕在头顶，直径也从 130 收到 78。 */}
        <View style={styles.genWrap}>
          {generating && (
            <>
              <Animated.View
                style={[
                  styles.genRing,
                  {
                    transform: [
                      { rotate: spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
                    ],
                  },
                ]}
              />
              <Animated.Text style={[styles.genSpark, { top: 2, left: -4, opacity: twinkleAnim }]}>✨</Animated.Text>
              <Animated.Text style={[styles.genSpark, { top: 12, right: -4, opacity: twinkleAnim }]}>⭐</Animated.Text>
              <Animated.Text style={[styles.genSpark, { bottom: 10, left: -6, opacity: twinkleAnim }]}>🌟</Animated.Text>
              <Animated.Text style={[styles.genSpark, { bottom: 16, right: 0, opacity: twinkleAnim }]}>💫</Animated.Text>
            </>
          )}
          <Racco
            state={generating ? 'thinking' : raccoState}
            size={120}
            showSpeechBubble
            speechText={generating ? t(GEN_PHRASE_KEYS[phraseIdx]) : ''}
          />
        </View>
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
              {/* 英文界面里不出现汉字：中文选项写成 Chinese；中文界面仍显示「中文」 */}
              {lang === 'zh' ? (uiLang === 'en' ? 'Chinese' : '中文') : 'English'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.langRow}>
        {(['short', 'medium', 'long'] as const).map((len) => (
          <TouchableOpacity
            key={len}
            style={storyLength === len ? styles.chipActive : styles.chip}
            onPress={() => setStoryLength(len)}
          >
            <Text style={storyLength === len ? styles.chipTextActive : styles.chipText}>
              {len === 'short' ? t('create.lenShort') : len === 'medium' ? t('create.lenMedium') : t('create.lenLong')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 会员也有每日 3 次上限，剩余次数对所有身份都显示 */}
      {snapshot && (
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
  content: {
    padding: 20,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  raccoWrap: { alignItems: 'center', marginTop: 16, marginBottom: 8 },
  /** 与浣熊等宽的定尺容器：光环与星星都相对它定位，才不会飘到屏幕左上角 */
  genWrap: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 生成页旋转光环 + 魔法闪烁（只绕在浣熊头顶一圈，直径收小避免压迫）
  genRing: {
    position: 'absolute',
    top: 0,
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 3,
    borderColor: 'rgba(183,148,244,0.25)',
    borderTopColor: '#B794F4',
  },
  genSpark: { position: 'absolute', fontSize: 16 },
  title: { fontSize: 24, color: '#3D3229', textAlign: 'center', marginBottom: 20, fontWeight: '700' },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF',
    borderRadius: 22,
    padding: 14,
    marginBottom: 12,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
    elevation: 2,
  },
  icon: { fontSize: 22, marginRight: 10, marginTop: 2 },
  quota: {
    fontSize: 12,
    color: '#7A6A5D',
    textAlign: 'center',
    marginBottom: 10,
  },
  input: { flex: 1, fontSize: 16, color: '#3D3229', padding: 0 },
  inputMultiline: { flex: 1, fontSize: 16, color: '#3D3229', padding: 0, minHeight: 60, textAlignVertical: 'top' },
  langRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: 16, gap: 12 },
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: '#FFE0B2',
  },
  chipActive: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 24, backgroundColor: '#F2827F' },
  chipText: { fontSize: 15, color: '#3D3229' },
  chipTextActive: { fontSize: 15, color: '#3D3229', fontWeight: '600' },
  btn: {
    backgroundColor: '#EE8B5E',
    borderRadius: 24,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: {
    backgroundColor: '#EE8B5E',
    borderRadius: 24,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    opacity: 0.5,
  },
  btnText: { fontSize: 18, color: '#3D3229', fontWeight: '700' },
});
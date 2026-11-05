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
import { checkStoryGate } from '@/services/entitlement';
import { storyCacheKey, findPlayableCachedStory, attachStoryId } from '@/services/storyCache';
import { useLanguage } from '@/hooks/useLanguage';
import { useEntitlement } from '@/hooks/useEntitlement';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import type { Story, Language, RaccoState, GenerateStoryParams } from '@/types';

// 出海适配：海外用户到新加坡节点延迟偏高。
// 软提示阈值 15s（显示"AI 还在努力写故事"安抚），硬超时按档位给：
//   3-5 分钟档 60s；5-10 分钟档正文几乎翻倍（最多 2000 字 / 1300 词），模型出稿更久，
//   给到 95s（服务层自己的请求超时是 90s，UI 必须比它宽，否则会先于服务层放弃并误报超时）。
const SLOW_HINT_MS = 15000;
const GEN_HARD_TIMEOUT_MS = 60000;
const GEN_HARD_TIMEOUT_LONG_MS = 95000;

export default function CreateScreen() {
  const router = useRouter();
  const { t, language: uiLang } = useLanguage();

  const [theme, setTheme] = useState('');
  const [protagonist, setProtagonist] = useState('');
  const [details, setDetails] = useState('');
  // 默认跟随当前界面语言：英文界面下生成英文故事；用户仍可用 chip 手动覆盖
  const [storyLang, setStoryLang] = useState<Language>(uiLang);
  // 时长分级（v105 精简）：3-5 分钟 / 5-10 分钟两档。20 分钟以上的长故事已彻底下线（成本红线）
  const [storyLength, setStoryLength] = useState<'short' | 'medium'>('short');
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
  // 出海适配：海外用户到新加坡节点延迟更高，超过 15 秒给出安抚提示，避免以为"卡死"
  const [slowHint, setSlowHint] = useState(false);
  // 生成中循环展示的可爱短句（不识字的孩子也能通过文字气泡 + 语音辅助理解"正在努力生成"）
  const GEN_PHRASE_KEYS = ['create.genPhrase.1', 'create.genPhrase.2', 'create.genPhrase.3', 'create.genPhrase.4', 'create.genPhrase.5', 'create.genPhrase.6'];
  const [phraseIdx, setPhraseIdx] = useState(0);
  useEffect(() => {
    if (!generating) return;
    const id = setInterval(() => setPhraseIdx((i) => (i + 1) % GEN_PHRASE_KEYS.length), 2500);
    return () => clearInterval(id);
  }, [generating, GEN_PHRASE_KEYS.length]);
  const { snapshot, refresh, showPaywall } = useEntitlement();

  const handleGenerate = async () => {
    if (!theme.trim()) {
      Alert.alert(t('create.alert.title'), t('create.alert.themeRequired'));
      return;
    }

    // 读取家长设置的敏感词（同时纳入缓存键：换词表必须重新生成）
    const sensitive = await getSensitiveWords();
    /**
     * v105：每一次生成请求各自持有一张「放弃票」。
     * 弱网 / 跨洋链路下，UI 的 60 秒硬超时先触发、底层请求却在 65 秒才成功，
     * 于是「界面已经提示超时，额度却被扣掉一次」。
     * 超时那一刻把票作废，服务层记账前问一次，界面判定失败的那次就绝不会 +1；
     * 点「重试」会新建一张票，旧请求即使晚到也不会顶掉新请求的计数。
     */
    const myReq: { cancelled: boolean } = { cancelled: false };
    const params: GenerateStoryParams = {
      theme,
      protagonist,
      details,
      language: storyLang,
      length: storyLength,
      sensitiveWords: [...sensitive.words, ...sensitive.phrases],
      // 记账在 services/ai.ts 里做：只有云端真写成稿子才 +1，这里不再自行扣次数
      source: 'create',
      // 超时/放弃后，服务层就不再记账（见 myReq 注释）
      isCancelled: () => myReq.cancelled,
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
    setSlowHint(false);
    // 出海适配：海外用户到新加坡节点延迟更高，超过 15 秒给出安抚提示，
    // 超过 60 秒视为超时（断网/节点不可达），抛错走 catch 友好提示，绝不卡死。
    const slowTimer = setTimeout(() => setSlowHint(true), SLOW_HINT_MS);
    // 把 generateStory 包一层硬超时，避免弱网下无限转圈
    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const id = setTimeout(() => {
          // ★ 先作废这张「放弃票」再 reject：底层请求即使稍后成功，也不会扣当日次数
          myReq.cancelled = true;
          reject(new Error('GEN_TIMEOUT'));
        }, ms);
        p.then(
          (v) => { clearTimeout(id); resolve(v); },
          (e) => { clearTimeout(id); reject(e); },
        );
      });
    try {
      const hardMs = storyLength === 'short' ? GEN_HARD_TIMEOUT_MS : GEN_HARD_TIMEOUT_LONG_MS;
      const result = await withTimeout(generateStory(params), hardMs);

      /** 落库 + 进故事页（不涉及额度：额度只由 ai.ts 在云端成功时记一次） */
      const openStory = async (): Promise<string> => {
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
        await attachStoryId(cacheKey, story.id);
        return story.id;
      };

      /**
       * ★ 命中缓存（服务层兜住的极端竞态）：直接播，**不扣次数**。
       */
      if (result.origin === 'cache') {
        const id = await openStory();
        setRaccoState('happy');
        setGenerating(false);
        router.push(`/story/${id}`);
        return;
      }

      /**
       * ★ 额度已满：不落库、不扣次数、不跳转，只弹门禁（可能预检之后被别的入口用掉）。
       */
      if (result.fallbackReason === 'quota') {
        setRaccoState('idle');
        const latest = await checkStoryGate();
        showPaywall(latest);
        setGenerating(false);
        return;
      }

      /**
       * ★ AI 失败降级（无网 / Key 未配置）：沿用旧行为，把兜底故事落库让孩子有得听，
       * 但**绝不扣次数**（没消耗任何云端资源）。
       */
      if (result.origin !== 'cloud') {
        await openStory();
        await refresh();
        setRaccoState('idle');
        Alert.alert(t('create.alert.title'), t('create.aiUnavailable'));
        setGenerating(false);
        return;
      }

      const storyId = await openStory();
      // 次数已在 ai.ts 云端成功时记账，这里只刷新「今日剩余」显示
      await refresh();
      setRaccoState('happy');
      router.push(`/story/${storyId}`);
    } catch (e) {
      console.error('Generate story error:', e);
      setRaccoState('idle');
      // 超时/断网都走这里：给出友好英文提示，且**绝不扣减当日生成次数**
      // （次数只在 ai.ts 云端真正写稿成功时才记一次，失败/超时本就没扣）。
      const isTimeout = e instanceof Error && e.message === 'GEN_TIMEOUT';
      if (isTimeout) {
        // 带「重试」按钮的对话框：重试不扣次数（重新跑一遍，门禁预检同样不扣）
        Alert.alert(t('create.retryTitle'), t('create.retryMsg'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('create.retry'), onPress: () => { handleGenerate(); } },
        ]);
      } else {
        Alert.alert(t('create.alert.title'), t('create.genFailed'));
      }
    } finally {
      // 无论成功/失败/超时，都要清掉 15s 安抚计时器并复位提示，避免残留
      clearTimeout(slowTimer);
      setSlowHint(false);
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

      {/* 出海适配：海外节点延迟高时显示安抚提示，避免家长以为卡死 */}
      {generating && slowHint && (
        <Text style={styles.slowHint}>{t('create.slowHint')}</Text>
      )}

      <View style={styles.card}>
        <Text style={styles.icon}>🌟</Text>
        <TextInput
          style={styles.input}
          placeholder={t('create.ph.theme')}
          placeholderTextColor="#B9AFA6"
          value={theme}
          onChangeText={setTheme}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.icon}>🐰</Text>
        <TextInput
          style={styles.input}
          placeholder={t('create.ph.protagonist')}
          placeholderTextColor="#B9AFA6"
          value={protagonist}
          onChangeText={setProtagonist}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.icon}>✨</Text>
        <TextInput
          style={styles.inputMultiline}
          placeholder={t('create.ph.details')}
          placeholderTextColor="#B9AFA6"
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
        {(['short', 'medium'] as const).map((len) => (
          <TouchableOpacity
            key={len}
            style={storyLength === len ? styles.chipActive : styles.chip}
            onPress={() => setStoryLength(len)}
          >
            <Text style={storyLength === len ? styles.chipTextActive : styles.chipText}>
              {len === 'short' ? t('create.lenShort') : t('create.lenMedium')}
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
  title: { fontSize: 24, color: '#3D3229', textAlign: 'center', marginBottom: 14, fontWeight: '700' },
  slowHint: {
    fontSize: 14,
    color: '#A8988A',
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
    flexShrink: 1,
  },
  /**
   * 输入卡片（v105 反馈 #3）：主题 / 主角这两栏的提示语原来显得特别大、
   * 上下留白也散。这里统一到全 App 的输入规范：
   *   圆角 18 / 竖向内边距 12 / 图标 18（垂直居中）/ 提示文字 15 号、行高 20。
   * 两栏之间的间距 12 → 10，标题下留白 20 → 14，整体收紧一档。
   */
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.05)',
    elevation: 2,
  },
  icon: { fontSize: 18, lineHeight: 22, marginRight: 8 },
  quota: {
    fontSize: 12,
    color: '#7A6A5D',
    textAlign: 'center',
    marginBottom: 10,
  },
  input: { flex: 1, fontSize: 15, lineHeight: 20, color: '#3D3229', padding: 0 },
  inputMultiline: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    color: '#3D3229',
    padding: 0,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  langRow: { flexDirection: 'row', justifyContent: 'center', marginVertical: 12, gap: 10 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: '#FFE0B2',
  },
  chipActive: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, backgroundColor: '#F2827F' },
  chipText: { fontSize: 14, color: '#3D3229' },
  chipTextActive: { fontSize: 14, color: '#3D3229', fontWeight: '600' },
  btn: {
    backgroundColor: '#EE8B5E',
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 8,
  },
  btnDisabled: {
    backgroundColor: '#EE8B5E',
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 8,
    opacity: 0.5,
  },
  btnText: { fontSize: 18, color: '#3D3229', fontWeight: '700', textAlign: 'center', flexShrink: 1, flexWrap: 'wrap' },
});
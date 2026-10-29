import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Platform,
  Animated,
  TextInput,
  type DimensionValue,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useLanguage } from '../../hooks/useLanguage';
import { VOICES, textToSpeech } from '../../services/tts';
import { playStory, stopStory } from '../../services/playback';
import { hasClonedVoice } from '../../services/clonedVoicePlayback';
import { getStory, saveProgress, getProgress, getParentComment, getVoiceSetting, getChildQAs, saveChildQA, type ParentComment, type ChildQA } from '../../services/storage';
import { askQuestion, generateStoryQuestions } from '../../services/ai';
import Racco from '../../components/common/Racco';
import { RewardAnimation } from '../../components/ui/RewardAnimation';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { getLevel, getNewBadges, type BadgeRule, type LevelRule } from '../../constants/rewards';
import type { Story } from '../../types';

type Phase = 'loading' | 'playing' | 'completed' | 'qa_round1' | 'qa_round2' | 'finished';

type QAItem =
  | { type: 'choice'; question: string; options: string[] }
  | { type: 'voice'; question: string };

const VOICE_QUESTION_ZH = '你最喜欢故事的哪个部分？';
const VOICE_QUESTION_EN = 'Which part of the story did you like best?';

/** 兜底：AI 出题失败时使用的通用题（与故事无关，但至少通顺） */
const FALLBACK_QA: QAItem[] = [
  { type: 'choice', question: '故事里谁最让你喜欢？', options: ['可爱的小动物', '聪明的孩子'] },
  { type: 'choice', question: '故事发生在哪里？', options: ['安静的森林', '温暖的家里'] },
  { type: 'voice', question: VOICE_QUESTION_ZH },
];

const { width } = Dimensions.get('window');

export default function StoryPlayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language: uiLang } = useLanguage();

  const [phase, setPhase] = useState<Phase>('loading');
  const [story, setStory] = useState<Story | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0]?.id ?? '');
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [qaIndex, setQaIndex] = useState(0);
  const [qaFeedback, setQaFeedback] = useState('');
  const [childQuestion, setChildQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [qaQuestions, setQaQuestions] = useState<QAItem[]>(FALLBACK_QA);
  const [qaLoading, setQaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 奖励：升级 / 新解锁的勋章（需求 5）
  const [levelUp, setLevelUp] = useState<LevelRule | null>(null);
  const [newBadge, setNewBadge] = useState<BadgeRule | null>(null);
  // 家长悄悄话（需求 2：家长评语以动画展现）
  const [parentComment, setParentComment] = useState<ParentComment | null>(null);
  const commentOpacity = useRef(new Animated.Value(0)).current;

  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 安全兜底：若真实的播完回调（onDone）因故未触发，到点也结束，避免卡在播放页 */
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 双语解析：英文模式且故事有英文正文时取英文，否则中文。
  // 派生值每次渲染重算，跟随界面语言实时切换。
  const displayLang: 'zh' | 'en' = uiLang === 'en' && story?.contentEn ? 'en' : 'zh';
  const storyText = story ? (displayLang === 'en' ? story.contentEn! : story.content) : '';
  const storyTitle =
    displayLang === 'en'
      ? (story?.titleEn || story?.title || '')
      : (story?.title || '');

  useEffect(() => {
    if (!id) {
      setError(t('story.error.invalid'));
      return;
    }
    (async () => {
      try {
        const s = await getStory(id);
        if (!s) {
          setError(t('story.error.notFound'));
          return;
        }
        setStory(s);
        setPhase('playing');
      } catch (err) {
        console.error('Load story error:', err);
        setError(t('story.error.loadFailed'));
      }
    })();
  }, [id]);

  useEffect(() => {
    return () => {
      stopStory();
      if (progressInterval.current) clearInterval(progressInterval.current);
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    };
  }, []);

  // 默认声线：优先用全局设置；若全局是 system 但已克隆某位亲属，则默认用该克隆声
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getVoiceSetting();
      if (cancelled) return;
      if (saved && saved !== 'system') {
        setSelectedVoice(saved);
        return;
      }
      for (const t of ['mom', 'dad', 'grandma'] as const) {
        if (await hasClonedVoice(t)) {
          if (!cancelled) setSelectedVoice(t);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 听完一个故事：记入已听列表 + 刷新连续天数 + 结算等级与勋章（需求 5）
  // 放在 completed（故事讲完）而非 finished（答完题），听完立刻给正反馈
  useEffect(() => {
    if (phase !== 'completed' || !story) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getProgress();
        if (cancelled) return;

        const beforeLevel = getLevel(p.listenedStories.length);

        if (!p.listenedStories.includes(story.id)) {
          p.listenedStories.push(story.id);
        }

        // 收听历史（带时间戳，供统计/排序使用）：同一故事仅保留最新一条
        const title = storyTitle;
        const nowIso = new Date().toISOString();
        p.listenLog = [
          { id: story.id, title, at: nowIso },
          ...(p.listenLog || []).filter((l) => l.id !== story.id),
        ].slice(0, 500);

        // 连续天数：只在跨天时更新，避免同一天反复听被重复计数
        const today = new Date().toISOString().slice(0, 10);
        if (p.lastListenDate !== today) {
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          p.streakDays = p.lastListenDate === yesterday ? p.streakDays + 1 : 1;
          p.lastListenDate = today;
        }

        // 结算勋章
        const fresh = getNewBadges(
          {
            listenedCount: p.listenedStories.length,
            streakDays: p.streakDays,
            checkInCount: p.checkIns.length,
          },
          p.badges,
        );
        if (fresh.length) {
          p.badges = [...p.badges, ...fresh.map((b) => b.id)];
        }

        await saveProgress(p);
        if (cancelled) return;

        // 升级优先展示，其次才是新勋章
        const afterLevel = getLevel(p.listenedStories.length);
        if (afterLevel.level > beforeLevel.level) {
          setLevelUp(afterLevel);
        } else if (fresh.length) {
          setNewBadge(fresh[0]);
        }
      } catch (err) {
        console.error('Save progress error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [phase, story]);

  // 加载家长悄悄话（需求 2）：故事载入后即读取，存在则以淡入动画展示
  useEffect(() => {
    if (!story) return;
    let cancelled = false;
    (async () => {
      const c = await getParentComment(story.id);
      if (cancelled) return;
      if (c?.text) {
        setParentComment(c);
        Animated.timing(commentOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }).start();
      }
    })();
    return () => { cancelled = true; };
  }, [story, commentOpacity]);

  // 故事真正讲完（系统音 onDone / 克隆声 onEnded）→ 才进入「讲完啦/提问」环节
  const handleStoryEnded = () => {
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    if (progressInterval.current) clearInterval(progressInterval.current);
    setProgress(100);
    setIsPlaying(false);
    setPhase('completed');
  };

  const handlePlay = () => {
    if (!story) return;
    playStory(storyText, selectedVoice, displayLang, handleStoryEnded);
    setIsPlaying(true);

    // 进度条仅作视觉估算，不再强制跳转；真正的跳转由 handleStoryEnded 驱动
    // 中文 TTS 约 4-5 字/秒（~210ms/字）；英文按词数估算（~0.45s/词），避免进度条跑太快
    const isEn = displayLang === 'en';
    const totalDuration = isEn
      ? Math.max((storyText.split(/\s+/).filter(Boolean).length) * 450, 8000)
      : Math.max(storyText.length * 210, 10000);
    const step = 100 / (totalDuration / 500);
    if (progressInterval.current) clearInterval(progressInterval.current);
    progressInterval.current = setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 100 : prev + step));
    }, 500);

    // 兜底：万一 onDone 没触发（如克隆声 onEnded 不被支持），到点也结束
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    safetyTimerRef.current = setTimeout(handleStoryEnded, totalDuration * 1.6);
  };

  const handlePause = () => {
    stopStory();
    setIsPlaying(false);
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
  };

  const handleStop = () => {
    stopStory();
    setIsPlaying(false);
    setProgress(0);
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
  };

  const handleProgressTap = (e: any) => {
    const x = e.nativeEvent.locationX;
    const ratio = x / (width - 40);
    const newProgress = Math.max(0, Math.min(100, ratio * 100));
    setProgress(newProgress);
  };

  const handleChoiceAnswer = (optionIndex: number) => {
    const q = qaQuestions[qaIndex];
    if (q.type !== 'choice') return;
    setQaFeedback(t('story.qa.greatJob'));
    setTimeout(() => {
      setQaFeedback('');
      if (qaIndex < qaQuestions.length - 1) {
        setQaIndex(qaIndex + 1);
      } else {
        setPhase('qa_round2');
      }
    }, 1500);
  };

  const handleVoiceRecord = () => {
    if (isRecording) {
      // 再按一次 = 结束录音，然后进入下一步
      setIsRecording(false);
      setQaFeedback(t('story.qa.greatJob'));
      setTimeout(() => {
        setQaFeedback('');
        if (qaIndex < qaQuestions.length - 1) {
          setQaIndex(qaIndex + 1);
        } else {
          setPhase('qa_round2');
        }
      }, 1500);
    } else {
      // 第一次按 = 开始录音（时长由孩子自己掌握，不再强制 2 秒）
      setIsRecording(true);
    }
  };

  const handleChildQuestion = async () => {
    if (!childQuestion.trim()) return;
    setIsAsking(true);
    try {
      // 第一个参数是故事正文（作为回答依据），第二个才是孩子的问题
      const answer = await askQuestion(storyText, childQuestion);
      const finalAnswer = answer && answer.trim() ? answer : t('story.qa.unknown');
      setAiAnswer(finalAnswer);
      // 朗读 AI 的回答，让孩子「听到」回复
      textToSpeech(finalAnswer, 'system', displayLang);
      // 持久化这次问答，供家长后台（统计页）查看
      const qa: ChildQA = {
        id: `${story?.id ?? 'x'}-${Date.now()}`,
        storyId: story?.id ?? '',
        storyTitle: story?.title ?? '',
        question: childQuestion.trim(),
        answer: finalAnswer,
        at: new Date().toISOString(),
      };
      await saveChildQA(qa);
    } catch {
      const fallback = t('story.qa.unknown');
      setAiAnswer(fallback);
      textToSpeech(fallback, 'system', displayLang);
    }
    setIsAsking(false);
  };

  // 进入提问环节时，按本故事内容用 AI 生成贴合的选择题（失败则保留兜底题）
  const generateQuestions = async () => {
    if (!story) { setQaLoading(false); return; }
    try {
      const qs = await generateStoryQuestions(storyText, storyTitle, displayLang);
      if (qs && qs.length > 0) {
        const items: QAItem[] = qs.slice(0, 2).map((q) => ({
          type: 'choice',
          question: q.question,
          options: q.options.slice(0, 2),
        }));
        items.push({
          type: 'voice',
          question: displayLang === 'en' ? VOICE_QUESTION_EN : VOICE_QUESTION_ZH,
        });
        setQaQuestions(items);
      }
    } catch {
      /* 保留兜底题 */
    } finally {
      setQaLoading(false);
    }
  };

  if (error) {
    return (
      <CartoonScreen gradient="day" decor>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>❌ {error}</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>
      </CartoonScreen>
    );
  }

  if (phase === 'loading') {
    return (
      <CartoonScreen gradient="day" decor>
        <View style={styles.loadingContainer}>
          <Racco state="thinking" size={120} />
          <Text style={styles.loadingText}>{t('story.loading')}</Text>
        </View>
      </CartoonScreen>
    );
  }

  if (phase === 'playing') {
    const currentVoice = VOICES.find((v) => v.id === selectedVoice);
    const progressWidth = `${progress}%` as DimensionValue;
    
    return (
      <CartoonScreen gradient="day" decor>
        <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{storyTitle || t('story.defaultTitle')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.storyScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.storyText}>{storyText || t('story.contentLoading')}</Text>
        </ScrollView>

        <TouchableOpacity style={styles.progressBar} onPress={handleProgressTap} activeOpacity={0.8}>
          <View style={{ ...styles.progressFill, width: progressWidth }} />
        </TouchableOpacity>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.controlBtn} onPress={handlePlay} disabled={isPlaying}>
            <Text style={styles.controlIcon}>▶️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={handlePause} disabled={!isPlaying}>
            <Text style={styles.controlIcon}>⏸️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={handleStop}>
            <Text style={styles.controlIcon}>⏹️</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.voiceRow}>
          <Text style={styles.voiceLabel}>🔊 {currentVoice?.name ?? t('story.voice.default')}</Text>
          <TouchableOpacity onPress={() => setShowVoicePicker(!showVoicePicker)}>
            <Text style={styles.voiceToggle}>{showVoicePicker ? t('story.voice.collapse') : t('story.voice.switch')}</Text>
          </TouchableOpacity>
        </View>
        {showVoicePicker && (
          <View style={styles.voicePicker}>
            {VOICES.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={v.id === selectedVoice ? styles.voiceOptionActive : styles.voiceOption}
                onPress={() => { setSelectedVoice(v.id); setShowVoicePicker(false); }}
              >
                <Text style={styles.voiceOptionText}>{v.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.raccoCorner}>
          <Racco state="talking" size={60} />
        </View>
      </View>
      </CartoonScreen>
    );
  }

  if (phase === 'completed') {
    return (
      <CartoonScreen gradient="day" decor>
      <>
        <View style={styles.completedContainer}>
          <Racco state="happy" size={150} />
          <Text style={styles.completedText}>{t('story.completed.text')}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => { setQaIndex(0); setQaLoading(true); setPhase('qa_round1'); generateQuestions(); }}>
            <Text style={styles.primaryBtnText}>{t('story.completed.enterQa')}</Text>
          </TouchableOpacity>
        </View>

        {/* 需求 2/5：升级与新勋章用动画展现。升级优先，播完再显示勋章 */}
        <RewardAnimation
          visible={!!levelUp}
          emoji={levelUp?.emoji ?? '🎉'}
          title={t('reward.levelUp')}
          subtitle={levelUp ? `Lv.${levelUp.level} · ${levelUp.name}` : ''}
          desc={t('reward.keepGoing')}
          onDone={() => setLevelUp(null)}
        />
        <RewardAnimation
          visible={!levelUp && !!newBadge}
          emoji={newBadge?.emoji ?? '🏅'}
          title={t('reward.newBadge')}
          subtitle={newBadge?.name ?? ''}
          desc={newBadge?.desc}
          onDone={() => setNewBadge(null)}
        />
      </>
      </CartoonScreen>
    );
  }

  if (phase === 'qa_round1') {
    const q = qaQuestions[qaIndex];

    return (
      <CartoonScreen gradient="day" decor>
      <View style={styles.container}>
        <Text style={styles.qaRoundTitle}>{t('story.qa.roundTitle')} 🧠 ({qaIndex + 1}/{qaQuestions.length})</Text>

        {qaLoading ? (
          <View style={styles.qaLoadingWrap}>
            <ActivityIndicator size="large" color="#FF8A65" />
            <Text style={styles.qaLoadingText}>正在为你准备问题…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.qaQuestion}>{q.question}</Text>

            {q.type === 'choice' && (
              <View style={styles.optionsWrap}>
                {q.options.map((opt, i) => (
                  <TouchableOpacity key={i} style={styles.optionCard} onPress={() => handleChoiceAnswer(i)}>
                    <Text style={styles.optionText}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {q.type === 'voice' && (
              <View style={styles.voiceRecordWrap}>
                <TouchableOpacity
                  style={isRecording ? styles.micBtnActive : styles.micBtn}
                  onPress={handleVoiceRecord}
                >
                  <Text style={styles.micIcon}>🎤</Text>
                  <Text style={styles.micLabel}>{isRecording ? '点击停止' : t('story.qa.pressToTalk')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {qaFeedback ? (
              <Text style={styles.feedbackText}>{qaFeedback}</Text>
            ) : null}
          </>
        )}
      </View>
      </CartoonScreen>
    );
  }

  if (phase === 'qa_round2') {
    return (
      <CartoonScreen gradient="day" decor>
      <View style={styles.container}>
        <Text style={styles.qaRoundTitle}>{t('story.qa.yourQaTime')} 💬</Text>
        <Text style={styles.qaQuestion}>{t('story.qa.yourQuestion')}</Text>

        <TouchableOpacity
          style={isRecording ? styles.micBtnActive : styles.micBtn}
          onPress={() => {
            if (isRecording) {
              setIsRecording(false);
              // 暂未接入语音转文字，停止录音后填入示例问题，用户可改/可写
              if (!childQuestion.trim()) setChildQuestion(t('story.qa.sample'));
            } else {
              setIsRecording(true);
            }
          }}
        >
          <Text style={styles.micIcon}>🎤</Text>
          <Text style={styles.micLabel}>{isRecording ? t('story.qa.recording') : t('story.qa.pressToTalk')}</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.childQInput}
          value={childQuestion}
          onChangeText={setChildQuestion}
          placeholder={t('story.qa.yourQuestion')}
          placeholderTextColor="#bca"
          multiline
          numberOfLines={2}
        />

        {childQuestion.trim() ? (
          <TouchableOpacity style={styles.askBtn} onPress={handleChildQuestion} disabled={isAsking || !childQuestion.trim()}>
            <Text style={styles.askBtnText}>{isAsking ? t('story.qa.thinking') : t('story.qa.askAi')}</Text>
          </TouchableOpacity>
        ) : null}

        {aiAnswer ? (
          <View style={styles.aiAnswerWrap}>
            <Text style={styles.aiAnswer}>🤖 {aiAnswer}</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.primaryBtn2} onPress={() => setPhase('finished')}>
          <Text style={styles.primaryBtnText}>{t('story.qa.finish')}</Text>
        </TouchableOpacity>
      </View>
      </CartoonScreen>
    );
  }

  return (
    <CartoonScreen gradient="day" decor>
    <View style={styles.finishedContainer}>
      <Racco state="sleeping" size={150} />
      <Text style={styles.finishedText}>{t('story.finished.text')} 🌙</Text>

      {parentComment?.text ? (
        <Animated.View style={[styles.parentCommentCard, { opacity: commentOpacity }]}>
          <Text style={styles.parentCommentTitle}>💌 {t('story.parentComment.title')}</Text>
          <Text style={styles.parentCommentText}>{parentComment.text}</Text>
        </Animated.View>
      ) : null}

      <TouchableOpacity style={styles.finishedBtn} onPress={() => router.push('/(tabs)')}>
        <Text style={styles.finishedBtnIcon}>🏠</Text>
        <Text style={styles.finishedBtnText}>{t('story.finished.home')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.finishedBtn} onPress={() => router.push('/(tabs)/library')}>
        <Text style={styles.finishedBtnIcon}>🔄</Text>
        <Text style={styles.finishedBtnText}>{t('story.finished.again')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.finishedBtnDisabled}>
        <Text style={styles.finishedBtnIcon}>🎤</Text>
        <Text style={styles.finishedBtnText}>{t('story.finished.record')}</Text>
      </TouchableOpacity>
    </View>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  loadingContainer: { flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center' },
  completedContainer: { flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center' },
  finishedContainer: { flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 16, color: '#888', marginTop: 16 },
  errorText: { fontSize: 18, color: '#c00', marginBottom: 20 },
  backBtn: { padding: 8 },
  backBtnText: { fontSize: 24, color: '#5D4037' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headerSpacer: { width: 40 },

  title: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', color: '#5D4037', flex: 1 },
  storyScroll: { flex: 1, borderRadius: 16, backgroundColor: '#FFFDF7', padding: 20 },
  storyText: { fontSize: 16, lineHeight: 28, color: '#4E342E' },
  progressBar: { height: 8, backgroundColor: '#E0D5C7', borderRadius: 4, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#FF8A65', borderRadius: 4 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 16 },
  controlBtn: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#FF8A65',
    justifyContent: 'center', alignItems: 'center', elevation: 2,
  },
  controlIcon: { fontSize: 22 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 4 },
  voiceLabel: { fontSize: 14, color: '#5D4037' },
  voiceToggle: { fontSize: 14, color: '#FF8A65', fontWeight: '600' },
  voicePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  voiceOption: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FFF' },
  voiceOptionActive: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FF8A65' },
  voiceOptionText: { fontSize: 13, color: '#5D4037' },
  raccoCorner: { position: 'absolute', bottom: 20, right: 20 },

  completedText: { fontSize: 24, fontWeight: 'bold', color: '#5D4037', marginTop: 20, marginBottom: 24 },

  qaRoundTitle: { fontSize: 20, fontWeight: 'bold', color: '#5D4037', textAlign: 'center', marginTop: 20, marginBottom: 16 },
  qaQuestion: { fontSize: 18, color: '#4E342E', textAlign: 'center', marginBottom: 24, lineHeight: 28 },
  optionsWrap: { gap: 16, paddingHorizontal: 20 },
  optionCard: {
    backgroundColor: '#FFF', borderRadius: 20, paddingVertical: 24, paddingHorizontal: 20,
    alignItems: 'center', elevation: 2, borderWidth: 1, borderColor: '#FFE0B2',
  },
  optionText: { fontSize: 18, color: '#5D4037', fontWeight: '600' },
  voiceRecordWrap: { alignItems: 'center', marginTop: 10 },
  micBtn: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: '#7C4DFF',
    justifyContent: 'center', alignItems: 'center', elevation: 3,
  },
  micBtnActive: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: '#651FFF',
    justifyContent: 'center', alignItems: 'center', elevation: 3,
    transform: [{ scale: 1.1 }],
  },
  micIcon: { fontSize: 32 },
  micLabel: { fontSize: 12, color: '#FFF', marginTop: 4 },
  feedbackText: { fontSize: 20, color: '#FF8A65', fontWeight: 'bold', textAlign: 'center', marginTop: 24 },
  qaLoadingWrap: { alignItems: 'center', marginTop: 40 },
  qaLoadingText: { fontSize: 15, color: '#888', marginTop: 16 },

  primaryBtn: {
    backgroundColor: '#FF8A65', borderRadius: 28, paddingVertical: 16, paddingHorizontal: 40,
    elevation: 2, marginTop: 10,
  },
  primaryBtn2: {
    backgroundColor: '#FF8A65', borderRadius: 28, paddingVertical: 16, paddingHorizontal: 40,
    elevation: 2, marginTop: 20,
  },
  primaryBtnText: { fontSize: 16, fontWeight: 'bold', color: '#FFF' },

  childQWrap: { marginTop: 16, backgroundColor: '#FFF', borderRadius: 16, padding: 16 },
  childQ: { fontSize: 16, color: '#5D4037', marginBottom: 12 },
  childQInput: {
    marginTop: 16, borderWidth: 1, borderColor: '#FFE0B2', borderRadius: 16,
    backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: '#5D4037', textAlignVertical: 'top', minHeight: 60,
  },
  askBtn: {
    backgroundColor: '#7C4DFF', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 24,
    alignSelf: 'flex-start',
  },
  askBtnText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  aiAnswerWrap: { marginTop: 16, backgroundColor: '#F3E5F5', borderRadius: 16, padding: 16 },
  aiAnswer: { fontSize: 15, color: '#4A148C', lineHeight: 24 },

  finishedText: { fontSize: 22, fontWeight: 'bold', color: '#5D4037', marginTop: 16, marginBottom: 32 },
  finishedBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 24, paddingVertical: 16, paddingHorizontal: 28, marginBottom: 12,
    elevation: 1, minWidth: 220, justifyContent: 'center',
  },
  finishedBtnDisabled: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 24, paddingVertical: 16, paddingHorizontal: 28, marginBottom: 12,
    elevation: 1, minWidth: 220, justifyContent: 'center',
    opacity: 0.5,
  },
  finishedBtnIcon: { fontSize: 20, marginRight: 10 },
  finishedBtnText: { fontSize: 15, color: '#5D4037', fontWeight: '600' },
  parentCommentCard: {
    backgroundColor: '#FFF8E1',
    borderRadius: 24,
    padding: 18,
    marginBottom: 20,
    maxWidth: 320,
    borderWidth: 2,
    borderColor: '#FFE0B2',
    alignItems: 'center',
  },
  parentCommentTitle: { fontSize: 16, fontWeight: 'bold', color: '#F57C00', marginBottom: 8 },
  parentCommentText: { fontSize: 15, color: '#5D4037', lineHeight: 24, textAlign: 'center' },
});
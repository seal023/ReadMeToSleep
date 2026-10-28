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
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useLanguage } from '../../hooks/useLanguage';
import { VOICES } from '../../services/tts';
import { playStory, stopStory } from '../../services/playback';
import { hasClonedVoice } from '../../services/clonedVoicePlayback';
import { getStory, saveProgress, getProgress, getParentComment, getVoiceSetting, type ParentComment } from '../../services/storage';
import { askQuestion } from '../../services/ai';
import Racco from '../../components/common/Racco';
import { RewardAnimation } from '../../components/ui/RewardAnimation';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { getLevel, getNewBadges, type BadgeRule, type LevelRule } from '../../constants/rewards';
import type { Story } from '../../types';

type Phase = 'loading' | 'playing' | 'completed' | 'qa_round1' | 'qa_round2' | 'finished';

const qaQuestions = [
  { type: 'choice' as const, questionKey: 'story.qa.q1', options: ['story.qa.q1.a', 'story.qa.q1.b'], answer: 0 },
  { type: 'choice' as const, questionKey: 'story.qa.q2', options: ['story.qa.q2.a', 'story.qa.q2.b'], answer: 0 },
  { type: 'voice' as const, questionKey: 'story.qa.q3' },
];

const { width } = Dimensions.get('window');

export default function StoryPlayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useLanguage();

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
  const [error, setError] = useState<string | null>(null);
  // 奖励：升级 / 新解锁的勋章（需求 5）
  const [levelUp, setLevelUp] = useState<LevelRule | null>(null);
  const [newBadge, setNewBadge] = useState<BadgeRule | null>(null);
  // 家长悄悄话（需求 2：家长评语以动画展现）
  const [parentComment, setParentComment] = useState<ParentComment | null>(null);
  const commentOpacity = useRef(new Animated.Value(0)).current;

  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const handlePlay = () => {
    if (!story) return;
    playStory(story.content, selectedVoice, story?.language ?? 'zh');
    setIsPlaying(true);

    const totalDuration = story.content.length * 80;
    const step = 100 / (totalDuration / 500);
    if (progressInterval.current) clearInterval(progressInterval.current);
    progressInterval.current = setInterval(() => {
      setProgress((prev) => {
        const next = prev + step;
        if (next >= 100) {
          if (progressInterval.current) clearInterval(progressInterval.current);
          setIsPlaying(false);
          setPhase('completed');
          return 100;
        }
        return next;
      });
    }, 500);
  };

  const handlePause = () => {
    stopStory();
    setIsPlaying(false);
    if (progressInterval.current) clearInterval(progressInterval.current);
  };

  const handleStop = () => {
    stopStory();
    setIsPlaying(false);
    setProgress(0);
    if (progressInterval.current) clearInterval(progressInterval.current);
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
    setIsRecording(true);
    setTimeout(() => {
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
    }, 2000);
  };

  const handleChildQuestion = async () => {
    if (!childQuestion.trim()) return;
    setIsAsking(true);
    try {
      // 第一个参数是故事正文（作为回答依据），第二个才是孩子的问题
      const answer = await askQuestion(story?.content ?? '', childQuestion);
      setAiAnswer(answer);
    } catch {
      setAiAnswer(t('story.qa.unknown'));
    }
    setIsAsking(false);
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
    const progressWidth = `${progress}%`;
    
    return (
      <CartoonScreen gradient="day" decor>
        <View style={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{story?.title ?? t('story.defaultTitle')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.storyScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.storyText}>{story?.content ?? t('story.contentLoading')}</Text>
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
          <TouchableOpacity style={styles.primaryBtn} onPress={() => { setQaIndex(0); setPhase('qa_round1'); }}>
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
        <Text style={styles.qaQuestion}>{t(q.questionKey)}</Text>

        {q.type === 'choice' && q.options && (
          <View style={styles.optionsWrap}>
            {q.options.map((opt, i) => (
              <TouchableOpacity key={i} style={styles.optionCard} onPress={() => handleChoiceAnswer(i)}>
                <Text style={styles.optionText}>{t(opt)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {q.type === 'voice' && (
          <View style={styles.voiceRecordWrap}>
            <TouchableOpacity
              style={isRecording ? styles.micBtnActive : styles.micBtn}
              onPress={handleVoiceRecord}
              disabled={isRecording}
            >
              <Text style={styles.micIcon}>🎤</Text>
              <Text style={styles.micLabel}>{isRecording ? t('story.qa.recording') : t('story.qa.pressToTalk')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {qaFeedback ? (
          <Text style={styles.feedbackText}>{qaFeedback}</Text>
        ) : null}
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
            setIsRecording(true);
            setTimeout(() => {
              setIsRecording(false);
              setChildQuestion(t('story.qa.whySample'));
            }, 2000);
          }}
          disabled={isRecording}
        >
          <Text style={styles.micIcon}>🎤</Text>
          <Text style={styles.micLabel}>{isRecording ? t('story.qa.recording') : t('story.qa.pressToTalk')}</Text>
        </TouchableOpacity>

        {childQuestion ? (
          <View style={styles.childQWrap}>
            <Text style={styles.childQ}>🧒 {childQuestion}</Text>
            <TouchableOpacity style={styles.askBtn} onPress={handleChildQuestion} disabled={isAsking}>
              <Text style={styles.askBtnText}>{isAsking ? t('story.qa.thinking') : t('story.qa.askAi')}</Text>
            </TouchableOpacity>
          </View>
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

      <TouchableOpacity style={styles.finishedBtn} onPress={() => router.push('/(tabs)/create')}>
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
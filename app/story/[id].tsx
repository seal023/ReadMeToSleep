import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { textToSpeech, stopSpeech, VOICES } from '../../services/tts';
import { getStory, saveProgress, getProgress } from '../../services/storage';
import { askQuestion } from '../../services/openclaw';
import Racco from '../../components/common/Racco';
import type { Story } from '../../types';

type Phase = 'loading' | 'playing' | 'completed' | 'qa_round1' | 'qa_round2' | 'finished';

const qaQuestions = [
  { type: 'choice' as const, question: '故事里的主角是谁？', options: ['小兔子', '小熊'], answer: 0 },
  { type: 'choice' as const, question: '主角去了哪里？', options: ['魔法星球', '海底世界'], answer: 0 },
  { type: 'voice' as const, question: '你最喜欢故事的哪个部分？' },
];

const { width } = Dimensions.get('window');

export default function StoryPlayScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

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

  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load story
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const s = await getStory(id);
        setStory(s);
        setPhase('playing');
      } catch {
        setPhase('playing');
      }
    })();
  }, [id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeech();
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, []);

  // Save progress when phase changes to finished
  useEffect(() => {
    if (phase === 'finished' && story) {
      saveProgress({ storyId: story.id, completed: true, date: new Date().toISOString() });
    }
  }, [phase, story]);

  const handlePlay = () => {
    if (!story) return;
    textToSpeech(story.content);
    setIsPlaying(true);

    // Simulate progress
    const totalDuration = story.content.length * 80; // ~80ms per char
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
    stopSpeech();
    setIsPlaying(false);
    if (progressInterval.current) clearInterval(progressInterval.current);
  };

  const handleStop = () => {
    stopSpeech();
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

  // QA Round 1
  const handleChoiceAnswer = (optionIndex: number) => {
    const q = qaQuestions[qaIndex];
    if (q.type !== 'choice') return;
    setQaFeedback('太棒了！Great job! 🎉');
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
    // Simulate voice recording
    setIsRecording(true);
    setTimeout(() => {
      setIsRecording(false);
      setQaFeedback('太棒了！Great job! 🎉');
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
      const answer = await askQuestion(childQuestion);
      setAiAnswer(answer);
    } catch {
      setAiAnswer('嗯，这个问题我还不太清楚呢～');
    }
    setIsAsking(false);
  };

  // ─── Render ─────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <View style={[styles.container, styles.center]}>
        <Racco state="thinking" size={120} />
        <Text style={styles.loadingText}>正在准备故事...</Text>
      </View>
    );
  }

  if (phase === 'playing') {
    const currentVoice = VOICES.find((v) => v.id === selectedVoice);
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{story?.title ?? '故事'}</Text>

        <ScrollView style={styles.storyScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.storyText}>{story?.content ?? '加载中...'}</Text>
        </ScrollView>

        {/* Progress bar */}
        <TouchableOpacity style={styles.progressBar} onPress={handleProgressTap} activeOpacity={0.8}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </TouchableOpacity>

        {/* Controls */}
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

        {/* Voice selector */}
        <View style={styles.voiceRow}>
          <Text style={styles.voiceLabel}>🔊 {currentVoice?.name ?? '默认'}</Text>
          <TouchableOpacity onPress={() => setShowVoicePicker(!showVoicePicker)}>
            <Text style={styles.voiceToggle}>{showVoicePicker ? '收起' : '切换'}</Text>
          </TouchableOpacity>
        </View>
        {showVoicePicker && (
          <View style={styles.voicePicker}>
            {VOICES.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={[styles.voiceOption, v.id === selectedVoice && styles.voiceOptionActive]}
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
    );
  }

  if (phase === 'completed') {
    return (
      <View style={[styles.container, styles.center]}>
        <Racco state="happy" size={150} />
        <Text style={styles.completedText}>故事讲完啦！🎉</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => { setQaIndex(0); setPhase('qa_round1'); }}>
          <Text style={styles.primaryBtnText}>进入提问环节</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'qa_round1') {
    const q = qaQuestions[qaIndex];
    return (
      <View style={styles.container}>
        <Text style={styles.qaRoundTitle}>问答时间 🧠 ({qaIndex + 1}/{qaQuestions.length})</Text>
        <Text style={styles.qaQuestion}>{q.question}</Text>

        {q.type === 'choice' && q.options && (
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
              style={[styles.micBtn, isRecording && styles.micBtnActive]}
              onPress={handleVoiceRecord}
              disabled={isRecording}
            >
              <Text style={styles.micIcon}>🎤</Text>
              <Text style={styles.micLabel}>{isRecording ? '录音中...' : '按住说话'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {qaFeedback ? (
          <Text style={styles.feedbackText}>{qaFeedback}</Text>
        ) : null}
      </View>
    );
  }

  if (phase === 'qa_round2') {
    return (
      <View style={styles.container}>
        <Text style={styles.qaRoundTitle}>你的问题时间 💬</Text>
        <Text style={styles.qaQuestion}>你有什么想问的？</Text>

        <TouchableOpacity
          style={[styles.micBtn, isRecording && styles.micBtnActive]}
          onPress={() => {
            setIsRecording(true);
            setTimeout(() => {
              setIsRecording(false);
              setChildQuestion('为什么小兔子要去魔法星球？');
            }, 2000);
          }}
          disabled={isRecording}
        >
          <Text style={styles.micIcon}>🎤</Text>
          <Text style={styles.micLabel}>{isRecording ? '录音中...' : '按住说话'}</Text>
        </TouchableOpacity>

        {childQuestion ? (
          <View style={styles.childQWrap}>
            <Text style={styles.childQ}>🧒 {childQuestion}</Text>
            <TouchableOpacity style={styles.askBtn} onPress={handleChildQuestion} disabled={isAsking}>
              <Text style={styles.askBtnText}>{isAsking ? '思考中...' : '问 AI'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {aiAnswer ? (
          <View style={styles.aiAnswerWrap}>
            <Text style={styles.aiAnswer}>🤖 {aiAnswer}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 20 }]}
          onPress={() => setPhase('finished')}
        >
          <Text style={styles.primaryBtnText}>完成</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // finished
  return (
    <View style={[styles.container, styles.center]}>
      <Racco state="sleeping" size={150} />
      <Text style={styles.finishedText}>晚安，好梦 🌙</Text>

      <TouchableOpacity style={styles.finishedBtn} onPress={() => router.replace('/(tabs)')}>
        <Text style={styles.finishedBtnIcon}>🏠</Text>
        <Text style={styles.finishedBtnText}>返回首页</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.finishedBtn}
        onPress={() => { router.back(); setTimeout(() => router.push('/create'), 100); }}
      >
        <Text style={styles.finishedBtnIcon}>🔄</Text>
        <Text style={styles.finishedBtnText}>再听一个</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.finishedBtn, styles.finishedBtnDisabled]}>
        <Text style={styles.finishedBtnIcon}>🎤</Text>
        <Text style={styles.finishedBtnText}>我来讲故事（即将上线）</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5E6', padding: 20 },
  center: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 16, color: '#888', marginTop: 16 },

  // Playing
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', color: '#5D4037', marginTop: 10, marginBottom: 12 },
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
  voiceOptionActive: { backgroundColor: '#FF8A65' },
  voiceOptionText: { fontSize: 13, color: '#5D4037' },
  raccoCorner: { position: 'absolute', bottom: 20, right: 20 },

  // Completed
  completedText: { fontSize: 24, fontWeight: 'bold', color: '#5D4037', marginTop: 20, marginBottom: 24 },

  // QA
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
  micBtnActive: { backgroundColor: '#651FFF', transform: [{ scale: 1.1 }] },
  micIcon: { fontSize: 32 },
  micLabel: { fontSize: 12, color: '#FFF', marginTop: 4 },
  feedbackText: { fontSize: 20, color: '#FF8A65', fontWeight: 'bold', textAlign: 'center', marginTop: 24 },

  // Primary button
  primaryBtn: {
    backgroundColor: '#FF8A65', borderRadius: 28, paddingVertical: 16, paddingHorizontal: 40,
    elevation: 2, marginTop: 10,
  },
  primaryBtnText: { fontSize: 16, fontWeight: 'bold', color: '#FFF' },

  // QA Round 2
  childQWrap: { marginTop: 16, backgroundColor: '#FFF', borderRadius: 16, padding: 16 },
  childQ: { fontSize: 16, color: '#5D4037', marginBottom: 12 },
  askBtn: {
    backgroundColor: '#7C4DFF', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 24,
    alignSelf: 'flex-start',
  },
  askBtnText: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  aiAnswerWrap: { marginTop: 16, backgroundColor: '#F3E5F5', borderRadius: 16, padding: 16 },
  aiAnswer: { fontSize: 15, color: '#4A148C', lineHeight: 24 },

  // Finished
  finishedText: { fontSize: 22, fontWeight: 'bold', color: '#5D4037', marginTop: 16, marginBottom: 32 },
  finishedBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 24, paddingVertical: 16, paddingHorizontal: 28, marginBottom: 12,
    elevation: 1, minWidth: 220, justifyContent: 'center',
  },
  finishedBtnDisabled: { opacity: 0.5 },
  finishedBtnIcon: { fontSize: 20, marginRight: 10 },
  finishedBtnText: { fontSize: 15, color: '#5D4037', fontWeight: '600' },
});
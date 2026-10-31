import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Alert,
  PanResponder,
  Keyboard,
  type DimensionValue,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { useLanguage } from '../../hooks/useLanguage';
import { VOICES } from '../../services/tts';
import { playStory, stopStory, speakWithBestVoice } from '../../services/playback';
import { playLocalFile, prewarmClonedAudio } from '../../services/clonedVoicePlayback';
import { startSleepSession, cancelSleepSession, isSleepSessionActive, getSleepRemainingMs } from '../../services/sleepTimer';
import { hasClonedVoice, seekClonedAudio, getClonedPosition, getClonedDuration } from '../../services/clonedVoicePlayback';
import { transcribeAudio } from '../../services/voiceClone';
import { getStory, saveProgress, getProgress, getParentComment, getVoiceSetting, getChildQAs, saveChildQA, saveChildQuiz, getSleepTimerMinutes, getSleepLockEnabled, type ParentComment, type ChildQA, type ChildQuiz } from '../../services/storage';
import { askQuestion, generateStoryQuestions } from '../../services/ai';
import Racco from '../../components/common/Racco';
import { RewardAnimation } from '../../components/ui/RewardAnimation';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { getLevel, getNewBadges, type BadgeRule, type LevelRule } from '../../constants/rewards';
import type { Story } from '../../types';

type Phase = 'loading' | 'playing' | 'completed' | 'qa_round1' | 'qa_round2' | 'finished' | 'sleep';

type QAItem =
  | { type: 'choice'; question: string; options: string[]; correctIndex: number }
  | { type: 'voice'; question: string };

const VOICE_QUESTION_ZH = '你最喜欢故事的哪个部分？';
const VOICE_QUESTION_EN = 'Which part of the story did you like best?';

/** 兜底：AI 出题失败时使用的通用题（与故事无关，但至少通顺） */
const FALLBACK_QA: QAItem[] = [
  { type: 'choice', question: '故事里谁最让你喜欢？', options: ['可爱的小动物', '聪明的孩子'], correctIndex: 0 },
  { type: 'choice', question: '故事发生在哪里？', options: ['安静的森林', '温暖的家里'], correctIndex: 0 },
  { type: 'voice', question: VOICE_QUESTION_ZH },
];

const { width } = Dimensions.get('window');

/** 把剩余毫秒格式化为 mm:ss，用于睡眠定时倒计时展示 */
function formatSleep(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 随声波形：播放时一排竖条循环跳动，暂停时静止——给不识字的孩子可见的「声音在流动」反馈
function SoundWave({ playing }: { playing: boolean }) {
  const bars = useRef(Array.from({ length: 22 }, () => new Animated.Value(0.3))).current;
  useEffect(() => {
    if (!playing) {
      bars.forEach((b) => b.setValue(0.3));
      return;
    }
    const anims = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: 1, duration: 280 + (i % 6) * 80, useNativeDriver: true }),
          Animated.timing(b, { toValue: 0.3, duration: 280 + (i % 6) * 80, useNativeDriver: true }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [playing]);
  return (
    <View style={styles.waveWrap} pointerEvents="none">
      {bars.map((b, i) => (
        <Animated.View key={i} style={[styles.waveBar, { transform: [{ scaleY: b }] }]} />
      ))}
    </View>
  );
}

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
  const [aiAskError, setAiAskError] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [qaQuestions, setQaQuestions] = useState<QAItem[]>(FALLBACK_QA);
  const [qaLoading, setQaLoading] = useState(false);
  // 问答回顾日志：用于在「完成」页回显孩子的问题与回答（含第1轮选择题、第2轮自由提问）
  const [qaRound1Log, setQaRound1Log] = useState<{ q: string; a: string; correct?: boolean }[]>([]);
  const [childQaLog, setChildQaLog] = useState<{ q: string; a: string }[]>([]);
  // 录音就绪标记 + 开始 promise：避免「快速轻点」在 prepare 尚未完成时就触发 stop，
  // 导致录音没真正开始就推进（孩子感知为"轻点一下就结束了"）。停止时先 await 开始流程完成。
  const recReady = useRef(false);
  const recStartPromise = useRef<Promise<void> | null>(null);
  // 进度条拖动跳转
  const [usingClonedVoice, setUsingClonedVoice] = useState(false);
  const clonedPlayingRef = useRef(false);
  const lastTotalDuration = useRef(0);
  const [seekToast, setSeekToast] = useState('');
  const barLayout = useRef({ width: 0 });
  // 录音时长（用于语音题误触判定）
  const recStartTs = useRef(0);
  const recEndTs = useRef(0);
  // 提问环节语音转文字中
  const [transcribing, setTranscribing] = useState(false);
  const progressPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt) => {
        const w = barLayout.current.width || width || 1;
        const r = Math.max(0, Math.min(1, evt.nativeEvent.locationX / w));
        setProgress(r * 100);
      },
      onPanResponderRelease: (evt) => {
        const w = barLayout.current.width || width || 1;
        const r = Math.max(0, Math.min(1, evt.nativeEvent.locationX / w));
        setProgress(r * 100);
        if (clonedPlayingRef.current) {
          seekClonedAudio((r * lastTotalDuration.current) / 1000);
        } else {
          setSeekToast(t('story.seekHint'));
          setTimeout(() => setSeekToast(''), 2200);
        }
      },
    })
  ).current;
  const [error, setError] = useState<string | null>(null);
  // 奖励：升级 / 新解锁的勋章（需求 5）
  const [levelUp, setLevelUp] = useState<LevelRule | null>(null);
  const [newBadge, setNewBadge] = useState<BadgeRule | null>(null);
  // 家长悄悄话（需求 2：家长评语以动画展现）
  const [parentComment, setParentComment] = useState<ParentComment | null>(null);
  const commentOpacity = useRef(new Animated.Value(0)).current;
  // 睡眠定时：倒计时剩余（ms，>0 表示会话进行中）与「到点是否锁定」标记
  const [sleepRemaining, setSleepRemaining] = useState(0);
  const [sleepLocked, setSleepLocked] = useState(false);
  // 正在准备克隆声（合成/下载中）：给「点播放后等待」一个可见反馈，
  // 同时作为并发保护，避免等待期间重复点击开出第二路播放（双声叠加）。
  const [preparing, setPreparing] = useState(false);
  const startingRef = useRef(false);
  // 每次播放递增；过期的 onDone / 定时器回调一律作废，避免旧播放把新播放的界面推走
  const playTokenRef = useRef(0);
  const endFiredRef = useRef(false);

  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 安全兜底：若真实的播完回调（onDone）因故未触发，到点也结束，避免卡在播放页 */
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 提问环节「按住说话、松开停止」的真实录音（expo-audio，与声音克隆页同款）
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // 录音时麦克风持续跳动，给孩子可见的「正在录音」反馈（不识字也能看懂）
  const micPulse = useRef(new Animated.Value(1)).current;
  // 播放页背景呼吸光晕：缓慢明暗 + 缩放，营造被温柔包裹的氛围（对应设计稿 s-play 的 glow）
  const glowAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 4500, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 4500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glowAnim]);

  // 晚安页：月亮呼吸光晕 + 星星闪烁 + 流星划过（对应设计稿 s-night）
  const moonAnim = useRef(new Animated.Value(0)).current;
  const starAnim = useRef(new Animated.Value(0)).current;
  const shootAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const moonLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(moonAnim, { toValue: 1, duration: 5000, useNativeDriver: true }),
        Animated.timing(moonAnim, { toValue: 0, duration: 5000, useNativeDriver: true }),
      ]),
    );
    const starLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(starAnim, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(starAnim, { toValue: 0.25, duration: 2400, useNativeDriver: true }),
      ]),
    );
    const shootLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shootAnim, { toValue: 1, duration: 4500, useNativeDriver: true }),
        Animated.delay(1500),
      ]),
    );
    moonLoop.start();
    starLoop.start();
    shootLoop.start();
    return () => {
      moonLoop.stop();
      starLoop.stop();
      shootLoop.stop();
    };
  }, [moonAnim, starAnim, shootAnim]);

  // 退出播放页时取消睡眠定时会话（避免后台继续计时触发锁屏）
  useEffect(() => {
    return () => {
      cancelSleepSession();
    };
  }, []);

  // 播放中为睡眠定时会话刷新剩余时间（仅在 playing 阶段计时）
  useEffect(() => {
    if (phase !== 'playing') {
      setSleepRemaining(0);
      return;
    }
    const tick = setInterval(() => {
      setSleepRemaining(isSleepSessionActive() ? getSleepRemainingMs() : 0);
    }, 1000);
    return () => clearInterval(tick);
  }, [phase]);

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

  // —— 孩子友好化（2026-10-29）：目标用户含不识字小朋友，必要沟通须有语音/动画辅助 ——
  // 进入问答环节时，用语音把「该做什么」说出来，而不是只靠文字
  useEffect(() => {
    if (phase === 'qa_round1') {
      speakWithBestVoice(
        displayLang === 'en'
          ? "Let's play a question game! Listen to the question and tap an answer you like."
          : '我们来玩问答小游戏吧！听清楚问题，选一个你喜欢的答案～',
        displayLang
      );
    } else if (phase === 'qa_round2') {
      speakWithBestVoice(
        displayLang === 'en'
          ? 'Now it is your turn! Hold the microphone and tell me your question. After I answer, tap the round button below to ask another, or tap finish when you are done.'
          : '现在轮到你啦！按住小话筒，把你的问题说出来。听完我的回答，想再问一个就点下面的圆圈按钮，都说完就点完成哦～',
        displayLang
      );
    }
  }, [phase]);

  // 每出现一道题（含语音题），把题目念出来，让不识字的孩子也能参与
  useEffect(() => {
    if (phase === 'qa_round1' && !qaLoading && qaQuestions[qaIndex]) {
      const q = qaQuestions[qaIndex];
      const tail = q.type === 'voice'
        ? (displayLang === 'en' ? ' Hold the microphone and say it.' : '，按住小话筒说出来。')
        : '';
      speakWithBestVoice(q.question + tail, displayLang);
    }
  }, [phase, qaIndex, qaLoading]);

  // 录音时麦克风持续跳动，给孩子可见的「正在录音」反馈
  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(micPulse, { toValue: 1.18, duration: 480, useNativeDriver: true }),
          Animated.timing(micPulse, { toValue: 1, duration: 480, useNativeDriver: true }),
        ])
      ).start();
    } else {
      micPulse.setValue(1);
    }
    return () => { micPulse.setValue(1); };
  }, [isRecording]);

  useEffect(() => {
    return () => {
      stopStory();
      if (progressInterval.current) clearInterval(progressInterval.current);
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    };
  }, []);

  // 离开本页（切 tab / 打开别的页面）立即停止朗读，避免「已经退出界面了声音还在读」。
  // 回到本页时播放控件仍在，可重新播放 / 暂停 / 停止。
  useFocusEffect(
    useCallback(() => {
      return () => {
        playTokenRef.current++;
        startingRef.current = false;
        stopStory();
        setIsPlaying(false);
        setPreparing(false);
        cancelSleepSession();
        if (progressInterval.current) clearInterval(progressInterval.current);
        if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      };
    }, []),
  );

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

  // 预热：进故事页就先把克隆音频合成好（不播放），使「点播放」几乎瞬时出声。
  // 仅在选中亲属声线且已克隆、且不是本地录音时预热。
  useEffect(() => {
    if (!story || story.audioUri) return;
    if (!selectedVoice || selectedVoice === 'system') return;
    if (!storyText) return;
    let cancelled = false;
    (async () => {
      if (!(await hasClonedVoice(selectedVoice))) return;
      if (cancelled) return;
      prewarmClonedAudio(storyText, selectedVoice);
    })();
    return () => {
      cancelled = true;
    };
  }, [story?.id, selectedVoice, displayLang]);

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
    cancelSleepSession();
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    if (progressInterval.current) clearInterval(progressInterval.current);
    setProgress(100);
    setIsPlaying(false);
    setPhase('completed');
  };

  // 启动进度条计时器：isReal=true 用真实播放位置（克隆/本地录音，与实际时长一致），
  // false 用文字长度估算（系统音 TTS 无法读取真实位置，仅供视觉参考）
  const startProgressTicker = (isReal: boolean) => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (isReal) {
      progressInterval.current = setInterval(() => {
        const pos = getClonedPosition();
        const dur = getClonedDuration();
        if (dur > 0) {
          lastTotalDuration.current = dur * 1000;
          setProgress(Math.min(100, (pos / dur) * 100));
        }
      }, 250);
    } else {
      const totalDuration =
        displayLang === 'en'
          ? Math.max((storyText.split(/\s+/).filter(Boolean).length) * 450, 8000)
          : Math.max(storyText.length * 210, 10000);
      lastTotalDuration.current = totalDuration;
      const step = 100 / (totalDuration / 500);
      progressInterval.current = setInterval(() => {
        setProgress((prev) => (prev >= 100 ? 100 : prev + step));
      }, 500);
    }
  };

  const handlePlay = async () => {
    if (!story) return;
    // 同步并发保护：合成/预热期间重复点击不再开第二路播放。
    // （v54 现象：点一次没反应又点一次，两路同时朗读、先结束的那路把界面推到「讲完啦」）
    if (startingRef.current) return;
    startingRef.current = true;
    const token = ++playTokenRef.current;
    endFiredRef.current = false;
    // 先彻底停掉任何在播的音频，避免叠加
    stopStory();
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    setProgress(0);
    // 立即进入播放态：按钮禁用 + 波形起来 + 显示「正在准备声音」，不再是一片静止的等待
    setIsPlaying(true);
    setPreparing(true);

    try {
      // 睡眠定时：读取家长设置，启动倒计时会话（到点自动淡出停止 + 晚安锁屏）
      const sleepMin = await getSleepTimerMinutes();
      const sleepLock = await getSleepLockEnabled();
      const onSleepExpire = () => {
        setSleepLocked(sleepLock);
        setPhase('sleep');
      };
      // 故事结束只认当前这次播放：过期的 onDone / 定时器回调一律忽略
      const onEnded = () => {
        if (token !== playTokenRef.current) return;
        if (endFiredRef.current) return;
        endFiredRef.current = true;
        handleStoryEnded();
      };

      // 保留的本地录音：直接播放原文件（不走 TTS / 克隆合成），与克隆声共用全局 player
      if (story.audioUri) {
        const ok = await playLocalFile(story.audioUri, onEnded);
        if (token !== playTokenRef.current) return;
        setUsingClonedVoice(true);
        clonedPlayingRef.current = ok; // 同用全局 player，支持真实进度 + 拖动快进
        startProgressTicker(true);
        // 兜底：万一播完检测没触发，到点也结束（留 45s 余量，避免把故事掐断）
        if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
        const safeDur = (story.duration || 30) * 1000;
        safetyTimerRef.current = setTimeout(onEnded, safeDur + 45000);
        startSleepSession({ minutes: sleepMin, lockEnabled: sleepLock, onExpire: onSleepExpire });
        return;
      }

      const used = await playStory(storyText, selectedVoice, displayLang, onEnded);
      if (token !== playTokenRef.current) return;
      setUsingClonedVoice(used);
      clonedPlayingRef.current = used;

      // 克隆声：用真实播放位置驱动进度条（与实际时长一致），并支持拖动 / 快进后退；
      // 系统音（TTS）：无法读取真实位置，仍用文字长度估算（仅视觉），提示不支持拖动。
      startProgressTicker(used);

      // 兜底：万一 onDone / 播完检测都没触发，到点也结束
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      const safeDur = used
        ? ((story.duration || Math.ceil(storyText.length * 0.21) || 30) * 1000)
        : (displayLang === 'en'
            ? Math.max((storyText.split(/\s+/).filter(Boolean).length) * 450, 8000)
            : Math.max(storyText.length * 210, 10000));
      safetyTimerRef.current = setTimeout(onEnded, safeDur + 45000);
      startSleepSession({ minutes: sleepMin, lockEnabled: sleepLock, onExpire: onSleepExpire });
    } finally {
      if (token === playTokenRef.current) {
        setPreparing(false);
      }
      startingRef.current = false;
    }
  };

  const handlePause = () => {
    // 作废进行中的播放回调，并解除并发锁，避免暂停后点播放被拦
    playTokenRef.current++;
    startingRef.current = false;
    stopStory();
    setIsPlaying(false);
    setPreparing(false);
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
  };

  const handleStop = () => {
    playTokenRef.current++;
    startingRef.current = false;
    stopStory();
    cancelSleepSession();
    setIsPlaying(false);
    setPreparing(false);
    setProgress(0);
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
  };

  // 快进 / 后退（±delta 秒）：克隆声 / 本地录音用真实播放位置跳转；系统音不支持，给提示
  const handleSeekBy = (delta: number) => {
    if (clonedPlayingRef.current) {
      const pos = Math.max(0, getClonedPosition() + delta);
      seekClonedAudio(pos);
      const dur = getClonedDuration();
      if (dur > 0) {
        lastTotalDuration.current = dur * 1000;
        setProgress(Math.min(100, (pos / dur) * 100));
      }
    } else {
      setSeekToast(t('story.seekHint'));
      setTimeout(() => setSeekToast(''), 2200);
    }
  };

  const handleChoiceAnswer = (optionIndex: number) => {
    const q = qaQuestions[qaIndex];
    if (q.type !== 'choice') return;
    const isCorrect = q.correctIndex === optionIndex;
    if (isCorrect) {
      // 答对：记录第1轮问答（供「完成」页回显）+ 持久化作答，再进入下一题/第2轮
      setQaRound1Log((prev) => [
        ...prev,
        { q: q.question, a: q.options[optionIndex], correct: true },
      ]);
      const quiz: ChildQuiz = {
        id: `${story?.id ?? 'x'}-q-${Date.now()}`,
        storyId: story?.id ?? '',
        storyTitle: story?.title ?? '',
        question: q.question,
        chosen: q.options[optionIndex],
        correctText: q.options[q.correctIndex] ?? '',
        isCorrect: true,
        at: new Date().toISOString(),
      };
      saveChildQuiz(quiz).catch(() => {});
      const fb = t('story.qa.correct');
      setQaFeedback(fb);
      speakWithBestVoice(fb, displayLang);
      setTimeout(() => {
        setQaFeedback('');
        if (qaIndex < qaQuestions.length - 1) {
          setQaIndex(qaIndex + 1);
        } else {
          setPhase('qa_round2');
        }
      }, 1500);
    } else {
      // 答错：给再次选择的机会，停留在本题（选项始终可点），不进入下一步
      const fb = t('story.qa.wrong');
      setQaFeedback(fb);
      speakWithBestVoice(fb, displayLang);
    }
  };

  // 第 1 轮 voice 题：松开麦克风后停止录音并推进到下一题 / 第 2 轮
  const handleVoiceRecord = async () => {
    setIsRecording(false);
    // 等录音真正停止（含等待开始流程完成，避免快速松手漏录）后再判断
    await stopQaRecording();
    const durSec = (recEndTs.current - recStartTs.current) / 1000;
    const q = qaQuestions[qaIndex];
    // 录音过短（<0.6s）视为误触/没说话：提示重录，不推进
    if (durSec < 0.6) {
      setQaFeedback(t('story.qa.voiceTooShort'));
      speakWithBestVoice(t('story.qa.voiceTooShort'), displayLang);
      setTimeout(() => setQaFeedback(''), 1600);
      return;
    }
    if (q) setQaRound1Log((prev) => [...prev, { q: q.question, a: t('story.qa.voiceAnswer') }]);
    setQaFeedback(t('story.qa.voiceHeard'));
    speakWithBestVoice(t('story.qa.voiceHeard'), displayLang);
    setTimeout(() => {
      setQaFeedback('');
      if (qaIndex < qaQuestions.length - 1) {
        setQaIndex(qaIndex + 1);
      } else {
        setPhase('qa_round2');
      }
    }, 900);
  };

  const handleChildQuestion = async () => {
    if (!childQuestion.trim() || isAsking) return;
    setIsAsking(true);
    setAiAskError(false);
    try {
      // 第一个参数是故事正文（作为回答依据），第二个才是孩子的问题
      const answer = await askQuestion(storyText, childQuestion);
      const finalAnswer = answer && answer.trim() ? answer : t('story.qa.unknown');
      setAiAnswer(finalAnswer);
      // 记录第2轮自由提问，供「完成」页回显
      setChildQaLog((prev) => [...prev, { q: childQuestion.trim(), a: finalAnswer }]);
      // 朗读 AI 的回答，让孩子「听到」回复（有克隆声则用亲人的声音）
      speakWithBestVoice(finalAnswer, displayLang);
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
      setAiAskError(true);
      const fallback = t('story.qa.unknown');
      setAiAnswer(fallback);
      // 记录第2轮自由提问（含失败兜底），供「完成」页回显
      setChildQaLog((prev) => [...prev, { q: childQuestion.trim(), a: fallback }]);
      speakWithBestVoice(fallback, displayLang);
    }
    setIsAsking(false);
  };

  const resetChildQuestion = () => {
    setChildQuestion('');
    setAiAnswer('');
    setAiAskError(false);
  };

  // 提问环节真实录音：按住说话（onPressIn 调用），松开停止（onPressOut 调用）
  const startQaRecording = async () => {
    recReady.current = false;
    recStartPromise.current = (async () => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('需要麦克风权限', '请在系统设置中允许麦克风权限后重试');
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await audioRecorder.prepareToRecordAsync();
        await audioRecorder.record();
        recReady.current = true;
        recStartTs.current = Date.now();
        setIsRecording(true);
      } catch (err: any) {
        console.error('[story] 提问录音开始失败:', err);
        Alert.alert('录音失败', err?.message ?? '未知错误');
        recReady.current = false;
      }
    })();
  };

  const stopQaRecording = async () => {
    // 先等「开始录音」流程跑完，避免快速松手时录音还没真正开始就被判为未就绪而跳过
    if (recStartPromise.current) {
      try {
        await recStartPromise.current;
      } catch {
        /* 忽略 */
      }
    }
    if (!recReady.current) {
      setIsRecording(false);
      recReady.current = false;
      return;
    }
    try {
      await audioRecorder.stop();
      recEndTs.current = Date.now();
    } catch (err: any) {
      console.error('[story] 提问录音停止失败:', err);
    }
    recReady.current = false;
    setIsRecording(false);
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
          correctIndex: q.correctIndex,
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
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
              transform: [{ scale: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }],
            },
          ]}
        />
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

        <View
          style={styles.progressBar}
          onLayout={(e) => { barLayout.current.width = e.nativeEvent.layout.width; }}
          {...progressPan.panHandlers}
        >
          <View style={{ ...styles.progressFill, width: progressWidth }} />
        </View>
        {seekToast ? <Text style={styles.seekToast}>{seekToast}</Text> : null}

        <SoundWave playing={isPlaying} />

        {preparing ? (
          <View style={styles.preparingRow}>
            <ActivityIndicator size="small" color="#FF8A65" />
            <Text style={styles.preparingText}>
              {uiLang === 'en' ? 'Preparing the voice…' : '正在准备声音，马上开始…'}
            </Text>
          </View>
        ) : null}

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

        <View style={styles.seekRow}>
          <TouchableOpacity style={styles.seekBtn} onPress={() => handleSeekBy(-15)}>
            <Text style={styles.seekBtnText}>⏪ 15秒</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.seekBtn} onPress={() => handleSeekBy(15)}>
            <Text style={styles.seekBtnText}>15秒 ⏩</Text>
          </TouchableOpacity>
        </View>

        {sleepRemaining > 0 ? (
          <View style={styles.sleepBadge}>
            <Text style={styles.sleepBadgeText}>😴 {formatSleep(sleepRemaining)}</Text>
          </View>
        ) : null}

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
          subtitle={levelUp ? `Lv.${levelUp.level} · ${uiLang === 'en' ? levelUp.nameEn : levelUp.name}` : ''}
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

  if (phase === 'sleep') {
    return (
      <CartoonScreen gradient="night" decor decorVariant="night">
        <View style={styles.sleepScreen}>
          <Animated.View
            style={[
              styles.moonGlow,
              {
                opacity: moonAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
                transform: [{ scale: moonAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] }) }],
              },
            ]}
          >
            <Text style={styles.sleepMoon}>🌙</Text>
          </Animated.View>
          <Text style={styles.sleepTitle}>{t('sleep.locked.title')}</Text>
          <Text style={styles.sleepDesc}>{t('sleep.locked.desc')}</Text>
          <Text style={styles.sleepStars}>⭐ ✨ 🌟 ✨ ⭐</Text>
          {sleepLocked ? (
            <TouchableOpacity style={styles.sleepBtn} onPress={() => router.push('/(parent)/index')}>
              <Text style={styles.sleepBtnText}>{t('sleep.locked.unlock')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.sleepBtn} onPress={() => { setPhase('playing'); }}>
              <Text style={styles.sleepBtnText}>{t('sleep.locked.continue')}</Text>
            </TouchableOpacity>
          )}
        </View>
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
              <>
                <Animated.View style={[styles.micRing, { transform: [{ scale: micPulse }] }]} pointerEvents="none" />
                <TouchableOpacity
                  style={[isRecording ? styles.micFabActive : styles.micFab, { transform: [{ scale: micPulse }] }]}
                  onPressIn={startQaRecording}
                  onPressOut={handleVoiceRecord}
                >
                  <Text style={styles.micIcon}>🎤</Text>
                  <Text style={styles.micLabel}>{isRecording ? '松开结束' : t('story.qa.pressToTalk')}</Text>
                </TouchableOpacity>
              </>
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
      <View style={styles.qaRound2Wrap}>
      <ScrollView style={styles.container} contentContainerStyle={styles.qaContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.qaRoundTitle}>{t('story.qa.yourQaTime')} 💬</Text>
        <Text style={styles.qaQuestion}>{t('story.qa.yourQuestion')}</Text>

        {transcribing ? (
          <View style={styles.qaLoadingWrap}>
            <ActivityIndicator size="large" color="#FF8A65" />
            <Text style={styles.qaLoadingText}>{t('story.qa.transcribing')}</Text>
          </View>
        ) : null}

        <TextInput
          style={styles.childQInput}
          value={childQuestion}
          onChangeText={setChildQuestion}
          placeholder={t('story.qa.yourQuestion')}
          placeholderTextColor="#bca"
          multiline
          numberOfLines={2}
        />

        {childQuestion.trim() && !aiAnswer && !aiAskError ? (
          <TouchableOpacity style={styles.askBtn} onPress={handleChildQuestion} disabled={isAsking}>
            <Text style={styles.askBtnText}>{isAsking ? t('story.qa.thinking') : t('story.qa.askAi')}</Text>
          </TouchableOpacity>
        ) : null}

        {isAsking ? (
          <View style={styles.qaLoadingWrap}>
            <ActivityIndicator size="large" color="#FF8A65" />
            <Text style={styles.qaLoadingText}>🤔 小浣熊正在认真思考…</Text>
          </View>
        ) : null}

        {aiAnswer ? (
          <View style={styles.aiAnswerWrap}>
            <Text style={styles.aiAnswerLabel}>你问了：</Text>
            <Text style={styles.aiAnswerQuestion}>{childQuestion.trim()}</Text>
            <Text style={styles.aiAnswer}>🤖 {aiAnswer}</Text>
          </View>
        ) : null}

        {aiAskError ? (
          <View style={styles.aiAnswerWrap}>
            <Text style={styles.aiAnswer}>⚠️ 网络或 AI 暂时无法回答，但你的提问已悄悄记下来，留给爸爸妈妈看啦～</Text>
          </View>
        ) : null}

        {(aiAnswer || aiAskError) ? (
          <TouchableOpacity style={styles.askBtn} onPress={resetChildQuestion}>
            <Text style={styles.askBtnText}>🔄 再问一个</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={styles.primaryBtn2} onPress={() => { Keyboard.dismiss(); setPhase('finished'); }}>
          <Text style={styles.primaryBtnText}>✅ {t('story.qa.finish')}</Text>
        </TouchableOpacity>
      </ScrollView>
      {/* 右下角悬浮大圆钮：方便右手按住说话提问（替代原顶部居中） */}
      <Animated.View style={[styles.micRing, { transform: [{ scale: micPulse }] }]} pointerEvents="none" />
      <TouchableOpacity
        style={[isRecording ? styles.micFabActive : styles.micFab, { transform: [{ scale: micPulse }] }]}
        onPressIn={startQaRecording}
        onPressOut={async () => {
          setIsRecording(false);
          await stopQaRecording();
          const durSec = (recEndTs.current - recStartTs.current) / 1000;
          const uri = audioRecorder.uri;
          if (uri && durSec >= 0.6) {
            setTranscribing(true);
            const text = await transcribeAudio(uri);
            setTranscribing(false);
            if (text) setChildQuestion(text);
            else if (!childQuestion.trim()) setChildQuestion(t('story.qa.sample'));
          } else if (!childQuestion.trim()) {
            setChildQuestion(t('story.qa.sample'));
          }
        }}
      >
        <Text style={styles.micIcon}>🎤</Text>
        <Text style={styles.micLabel}>{isRecording ? '松开结束' : t('story.qa.pressToTalk')}</Text>
      </TouchableOpacity>
      </View>

      </CartoonScreen>
    );
  }

  return (
    <CartoonScreen gradient="day" decor>
    <View style={styles.finishedContainer}>
      {/* 月亮呼吸光晕 */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.moon,
          {
            opacity: moonAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
            transform: [{ scale: moonAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
          },
        ]}
      >
        <Text style={styles.moonEmoji}>🌙</Text>
      </Animated.View>
      {/* 闪烁星星 */}
      <Animated.View pointerEvents="none" style={[styles.nightStar, { top: 70, left: 40, opacity: starAnim }]}>
        <Text style={styles.nightStarEmoji}>⭐</Text>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.nightStar, { top: 150, left: 80, opacity: starAnim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }]}
      >
        <Text style={styles.nightStarEmoji}>✨</Text>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[styles.nightStar, { top: 60, left: 240, opacity: starAnim }]}>
        <Text style={styles.nightStarEmoji}>🌟</Text>
      </Animated.View>
      {/* 流星划过 */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.shoot,
          {
            opacity: shootAnim.interpolate({ inputRange: [0, 0.1, 0.4, 1], outputRange: [0, 1, 0, 0] }),
            transform: [
              { translateX: shootAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 220] }) },
              { translateY: shootAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 120] }) },
            ],
          },
        ]}
      >
        <Text style={styles.shootEmoji}>💫</Text>
      </Animated.View>
      <Racco state="sleeping" size={150} />
      <Text style={styles.finishedText}>{t('story.finished.text')} 🌙</Text>

      {parentComment?.text ? (
        <Animated.View style={[styles.parentCommentCard, { opacity: commentOpacity }]}>
          <Text style={styles.parentCommentTitle}>💌 {t('story.parentComment.title')}</Text>
          <Text style={styles.parentCommentText}>{parentComment.text}</Text>
        </Animated.View>
      ) : null}

      {/* 问答回顾：让孩子/家长看到「刚才的问题得到了什么回答」 */}
      {childQaLog.length > 0 || qaRound1Log.length > 0 ? (
        <View style={styles.qaRecapCard}>
          <Text style={styles.qaRecapTitle}>💡 {t('story.finished.qaTitle')}</Text>
          {qaRound1Log.map((item, i) => (
            <View key={`r1-${i}`} style={styles.qaRecapItem}>
              <Text style={styles.qaRecapQ}>Q：{item.q}</Text>
              <Text style={styles.qaRecapA}>
                {item.correct === true ? '✅ ' : item.correct === false ? '❌ ' : ''}
                A：{item.a}
              </Text>
            </View>
          ))}
          {childQaLog.map((item, i) => (
            <View key={`cq-${i}`} style={styles.qaRecapItem}>
              <Text style={styles.qaRecapQ}>❓ {item.q}</Text>
              <Text style={styles.qaRecapA}>🤖 {item.a}</Text>
            </View>
          ))}
        </View>
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
  // 晚安页夜间装饰
  moon: { position: 'absolute', top: 80, right: 46, zIndex: 0 },
  moonEmoji: { fontSize: 74 },
  nightStar: { position: 'absolute', zIndex: 0 },
  nightStarEmoji: { fontSize: 18 },
  shoot: { position: 'absolute', top: 140, left: -40, zIndex: 0 },
  shootEmoji: { fontSize: 16 },
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
  // 播放页呼吸光晕（背景，盖在内容之下）
  glow: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(255,203,92,0.28)',
  },
  // 随声波形
  waveWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 5,
    height: 56,
    marginTop: 10,
  },
  waveBar: {
    width: 6,
    height: 44,
    borderRadius: 3,
    backgroundColor: '#FF9A56',
  },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 16 },
  controlBtn: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#FF8A65',
    justifyContent: 'center', alignItems: 'center', elevation: 2,
  },
  controlIcon: { fontSize: 22 },
  seekRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
  seekBtn: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#FFF',
    borderWidth: 1, borderColor: '#FFE0B2', elevation: 1,
  },
  seekBtnText: { fontSize: 14, color: '#FF8A65', fontWeight: '700' },
  preparingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  preparingText: { fontSize: 14, color: '#8D6E63', fontWeight: '600' },
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
  // 右下角悬浮大圆钮：方便右手按住说话（替代原先顶部居中）
  micFab: {
    position: 'absolute', bottom: 28, right: 24, width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#7C4DFF', justifyContent: 'center', alignItems: 'center', elevation: 6,
    zIndex: 20, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  micFabActive: {
    position: 'absolute', bottom: 28, right: 24, width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#651FFF', justifyContent: 'center', alignItems: 'center', elevation: 6,
    zIndex: 20, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  // 麦克风外圈脉冲光环（录音时随 micPulse 呼吸），让不识字的孩子也能看到「在录」
  micRing: {
    position: 'absolute', bottom: 20, right: 16, width: 104, height: 104, borderRadius: 52,
    borderWidth: 3, borderColor: 'rgba(124,77,255,0.45)', zIndex: 19,
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
    backgroundColor: '#FF8A65', borderRadius: 28, paddingVertical: 18, paddingHorizontal: 52,
    elevation: 2, marginTop: 24, alignSelf: 'center',
  },
  primaryBtnText: { fontSize: 18, fontWeight: 'bold', color: '#FFF' },

  childQWrap: { marginTop: 16, backgroundColor: '#FFF', borderRadius: 16, padding: 16 },
  childQ: { fontSize: 16, color: '#5D4037', marginBottom: 12 },
  childQInput: {
    marginTop: 16, borderWidth: 1, borderColor: '#FFE0B2', borderRadius: 16,
    backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: '#5D4037', textAlignVertical: 'top', minHeight: 60,
  },
  askBtn: {
    backgroundColor: '#7C4DFF', borderRadius: 24, paddingVertical: 14, paddingHorizontal: 34,
    alignSelf: 'center', marginTop: 12,
  },
  askBtnText: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  qaContent: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 130 },
  qaRound2Wrap: { flex: 1, position: 'relative' },
  seekToast: { textAlign: 'center', color: '#fff', backgroundColor: 'rgba(108,92,231,0.92)', fontSize: 13, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16, marginTop: 10, alignSelf: 'center' },
  aiAnswerWrap: { marginTop: 16, backgroundColor: '#F3E5F5', borderRadius: 16, padding: 16 },
  aiAnswer: { fontSize: 15, color: '#4A148C', lineHeight: 24 },
  aiAnswerLabel: { fontSize: 13, color: '#8E6FB0', fontWeight: '600', marginBottom: 4 },
  aiAnswerQuestion: { fontSize: 15, color: '#4A148C', fontWeight: '700', marginBottom: 10, lineHeight: 22 },

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
  // 完成页问答回顾卡片
  qaRecapCard: {
    backgroundColor: '#F1F8E9',
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    maxWidth: 340,
    borderWidth: 2,
    borderColor: '#C5E1A5',
  },
  qaRecapTitle: { fontSize: 16, fontWeight: 'bold', color: '#558B2F', marginBottom: 10, textAlign: 'center' },
  qaRecapItem: { marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#AED581', paddingLeft: 10 },
  qaRecapQ: { fontSize: 14, fontWeight: '600', color: '#33691E', marginBottom: 4, lineHeight: 20 },
  qaRecapA: { fontSize: 14, color: '#555', lineHeight: 21 },
  // 睡眠定时倒计时徽标（播放页底部）
  sleepBadge: {
    alignSelf: 'center', marginTop: 10, paddingVertical: 6, paddingHorizontal: 16,
    borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.85)',
  },
  sleepBadgeText: { fontSize: 14, color: '#6B5B95', fontWeight: '600' },
  // 晚安锁屏页
  sleepScreen: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
  },
  moonGlow: { marginBottom: 8 },
  sleepMoon: { fontSize: 96 },
  sleepTitle: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginTop: 12, textAlign: 'center' },
  sleepDesc: { fontSize: 16, color: 'rgba(255,255,255,0.85)', marginTop: 12, lineHeight: 24, textAlign: 'center' },
  sleepStars: { fontSize: 24, marginTop: 18, letterSpacing: 6 },
  sleepBtn: {
    marginTop: 32, backgroundColor: '#FFD66B', paddingVertical: 14, paddingHorizontal: 36,
    borderRadius: 24,
  },
  sleepBtnText: { fontSize: 16, fontWeight: '700', color: '#5B4B23' },
});
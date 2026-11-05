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
  AppState,
  Modal,
  Pressable,
  useWindowDimensions,
  type DimensionValue,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
// 语音题录音落盘：录音器给的是缓存里的临时文件，拷一份到稳定的 qa_clips 目录，
// 避免「刚录完能听、过一会儿/重进页面就播不出来」。
import { Directory, File, Paths } from 'expo-file-system';
import { useLanguage } from '../../hooks/useLanguage';
import { playStory, stopStory, speakWithBestVoice, speakPhrase, presetTargetFor, prewarmSpeech, getLastPlayedVoice, setStoryResumePending } from '../../services/playback';
import { pickPhrase } from '../../services/phraseBank';
import { playLocalFile, prewarmClonedAudio, getChunkPlace } from '../../services/clonedVoicePlayback';
import { startSleepSession, cancelSleepSession, isSleepSessionActive, getSleepRemainingMs } from '../../services/sleepTimer';
import { hasClonedVoice, seekClonedAudio, getClonedPosition, getClonedDuration, reassertAudioSession, didPlayThisSession, getMaxPlayedPosition, setPlaybackInterrupted, pauseClonedAudio, resumeClonedAudio, didFinishNaturally, isClonedAudioPlaying, getClonedPositionRaw, getClonedDurationRaw } from '../../services/clonedVoicePlayback';
import { transcribeAudio } from '../../services/voiceClone';
import { listAvailableVoices, voiceDisplayName, normalizeVoiceId, PRESET_VOICE_OPTIONS, type VoiceOption } from '../../services/voiceCatalog';
import { getStory, saveProgress, getProgress, getParentComment, getVoiceSetting, saveVoiceSetting, getFreeCloneStoryId, getChildQAs, saveChildQA, saveChildQuiz, getSleepTimerMinutes, getSleepLockEnabled, getStoryPosition, saveStoryPosition, getStoryPlace, clearStoryPosition, type StoryPlace, type ParentComment, type ChildQA, type ChildQuiz } from '../../services/storage';
import { isPremium } from '../../services/iap';
import { askQuestion, generateStoryQuestions } from '../../services/ai';
import Racco from '../../components/common/Racco';
import { ClayIcon } from '../../components/ui/ClayIcon';
import { RewardAnimation } from '../../components/ui/RewardAnimation';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { getLevel, getNewBadges, computeRewardExtras, type BadgeRule, type LevelRule } from '../../constants/rewards';
import type { Story } from '../../types';

type Phase = 'loading' | 'playing' | 'completed' | 'qa_round1' | 'qa_round2' | 'finished' | 'sleep';

type QAItem =
  | { type: 'choice'; question: string; options: string[]; correctIndex: number }
  | { type: 'voice'; question: string };

const VOICE_QUESTION_ZH = '你最喜欢故事的哪个部分？';
const VOICE_QUESTION_EN = 'Which part of the story did you like best?';

/**
 * 语音题的尾巴提示语。⚠️ 必须与下面 prewarmClonedAudio 用的字符串**逐字一致**，
 * 否则预热出来的缓存和实际朗读的文本对不上 → 缓存永不命中 → 每题都要现场合成、等好几秒才出声。
 */
const QA_VOICE_TAIL_ZH = '，点一下小话筒说给我听，说完再点下面的大按钮。';
const QA_VOICE_TAIL_EN = ' Tap the microphone, say it, then tap the big button when you are done.';

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

/** 秒 → m:ss（断点文案用） */
function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** 问答录音的最长时长（秒）：到点自动结束，避免孩子忘了点「结束」一直录 */
const QA_MAX_REC_SEC = 20;

/**
 * 把刚录好的语音题音频拷到一个稳定位置，返回可播放的 uri。
 * ---------------------------------------------------------------------------
 * v84 反馈 #1（英文界面 3/3 录音听不到回放）：录音器给的是缓存目录里的临时文件，
 * 直接拿它去 createAudioPlayer 有时会「命令成功但一声不出」；文件还随时可能被系统回收。
 * 这里统一拷到 cache/qa_clips/ 下再播，并对「几乎没录到音」的空文件直接判失败，
 * 让界面给出明确提示，而不是按了没反应。
 */
function persistQaClip(rawUri: string | null): string | null {
  if (!rawUri) return null;
  try {
    const src = new File(rawUri);
    if (!src.exists) return null;
    const size = (src as unknown as { size?: number }).size;
    // 1.2KB 以下基本等于没录到音（正常说一两秒就有十几 KB）
    if (typeof size === 'number' && size > 0 && size < 1200) return null;
    try {
      const dir = new Directory(Paths.cache, 'qa_clips');
      if (!dir.exists) dir.create({ intermediates: true });
      const dest = new File(dir, `qaclip_${Date.now()}.m4a`);
      if (dest.exists) dest.delete();
      src.copy(dest);
      return dest.exists ? dest.uri : rawUri;
    } catch {
      return rawUri; // 拷贝失败就用原件，至少本次能播
    }
  } catch {
    return rawUri;
  }
}

// 随声波形：播放时一排竖条循环跳动，暂停时静止——给不识字的孩子可见的「声音在流动」反馈
function SoundWave({ playing, compact }: { playing: boolean; compact?: boolean }) {
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
    <View style={[styles.waveWrap, compact && styles.waveWrapCompact]} pointerEvents="none">
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[styles.waveBar, compact && styles.waveBarCompact, { transform: [{ scaleY: b }] }]}
        />
      ))}
    </View>
  );
}

export default function StoryPlayScreen() {
  /**
   * `autoplay=1`：从「我的故事」卡片上的「▶ 播放」进来时，加载完就直接开讲，
   * 不再要求孩子在播放页上再点一次播放键（v99 反馈 #3）。
   */
  const { id, autoplay } = useLocalSearchParams<{ id: string; autoplay?: string }>();
  const autoPlayRef = useRef(autoplay === '1' || autoplay === 'true');
  const autoPlayStartedRef = useRef(false);
  const { t, language: uiLang } = useLanguage();
  /**
   * v96 反馈 #3：横屏（手机横放 / iPad 横屏）时高度只有 300 多，
   * 头部 + 进度条 + 波形 + 84pt 播放键 + 停止 + 时间条把正文挤成一条缝，
   * 孩子只能看到一行字。下面播放页按横竖屏切换紧凑/常规两套尺寸。
   */
  const { width: winW, height: winH } = useWindowDimensions();
  const isLandscape = winW > winH;

  const [phase, setPhase] = useState<Phase>('loading');
  const [story, setStory] = useState<Story | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  // v79：声音选择改为常显大按钮，不再需要展开/收起状态
  // v81：可选声音统一从 voiceCatalog 取（内置样本 + 手机语音 + 真正克隆过的亲人）
  const [selectedVoice, setSelectedVoice] = useState('preset:cherry');
  /**
   * v90 #3：本轮「实际正在播」的音色。
   * 之前 pickVoice 用 `id === selectedVoice` 判「没变化」直接 return，
   * 但 selectedVoice 只是设置值——如果正在响的那一路其实是别的声线
   * （上一路没停干净 / 设置刚被别处改过），点选同名项会被误判成无操作，
   * 孩子听到的就一直是旧声（典型表现：选了大姐姐，耳朵里还是克隆声）。
   * 现在只有「和实际在播的音色也一致」才算没变化。
   */
  const playingVoiceRef = useRef('');
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>(PRESET_VOICE_OPTIONS);
  // v80 #3：正在播的到底是谁的声音？——显示当前生效的音色名（未克隆=云端预置音色）
  const [voiceIsCloned, setVoiceIsCloned] = useState(false);
  // 免费克隆体验：仅「那一篇专属故事」可用克隆声，其余故事一律退回系统音
  const [isPremiumUser, setIsPremiumUser] = useState(false);
  const [freeCloneStoryId, setFreeCloneStoryId] = useState<string | null>(null);
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
  /** 正在启动录音（权限/prepare 中）：忽略期间的重复点击 */
  const qaStarting = useRef(false);
  // 进度条拖动跳转
  const [usingClonedVoice, setUsingClonedVoice] = useState(false);
  // 读取会员状态 + 免费克隆专属故事 id：决定当前故事能否用克隆声
  useEffect(() => {
    let alive = true;
    (async () => {
      const [premium, cloneId] = await Promise.all([isPremium(), getFreeCloneStoryId()]);
      if (!alive) return;
      setIsPremiumUser(!!premium);
      setFreeCloneStoryId(cloneId);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const clonedPlayingRef = useRef(false);
  // 页面是否仍在前台：失焦（切走/退出）后置 false，用于「AI 回答到达时若已离开则不朗读」
  const aliveRef = useRef(true);
  /**
   * 本页是否是**当前可见页**（v97 反馈 #1）。
   * 故事页被 push 进路由栈后不会立刻卸载：用户退回故事库再打开另一篇时，
   * 旧实例仍然挂着 AppState 监听。若不做这道校验，旧实例在回前台时会「自动续播」，
   * 表现就是「新页面里没点播放、声音却响起来，而且播的是上一篇的声线」。
   */
  const focusedRef = useRef(true);
  // 播放按钮呼吸脉冲（isPlaying 时放大+收缩，直观提示「正在播放」）
  const playPulse = useRef(new Animated.Value(1)).current;
  const lastTotalDuration = useRef(0);
  const [seekToast, setSeekToast] = useState('');
  const barLayout = useRef({ width: 0 });
  // 录音时长（用于语音题误触判定）
  const recStartTs = useRef(0);
  const recEndTs = useRef(0);
  // 录音计时（秒）+ 自动结束：原来是「按住说话、松开结束」，孩子不习惯按住，
  // 轻点一下松手时 prepare 还没完成 → 每次都被判「太短录不上」。
  // 改为「点一下开始说、再点一下结束」，界面实时显示秒数，20 秒自动结束。
  const [qaRecSec, setQaRecSec] = useState(0);
  /**
   * 语音题「已录好、等孩子确认」的音频句柄（2026-11-01 新增）
   * 之前录完就直接跳到下一题：孩子既听不到自己说了什么，也没机会重录，
   * 大人看到的反馈就是「语音始终听不到、一下子就过去了」。
   * 现在录完先停住，界面上给「听我录的 / 重录 / 说完了下一题」三个选择。
   */
  const [voiceClipUri, setVoiceClipUri] = useState<string | null>(null);
  /**
   * v91 #2：语音题「孩子刚说的话」的转文字结果。
   * 3~5 岁孩子不识字，光有录音回放家长也不知道说了啥；这里把 ASR 结果显示出来，
   * 大人可以照着念给孩子听，也便于事后回忆孩子讲了什么。
   */
  const [qaAnswerText, setQaAnswerText] = useState('');
  /** 语音题录音回放中（按钮显示「⏸」） */
  const [voicePlaying, setVoicePlaying] = useState(false);
  const qaRecTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const qaAutoStop = useRef<(() => void) | null>(null);
  // 提问环节语音转文字中
  const [transcribing, setTranscribing] = useState(false);
  /** 进入问答环节的起始时刻：用于让「引导语」先播完，避免题目把它打断 */
  const qaPhaseEnterRef = useRef(0);
  /** 答对后「等反馈语音播完再进入下一题」的兜底计时器句柄 */
  const qaAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const commentScale = useRef(new Animated.Value(0.6)).current;
  // 睡眠定时：倒计时剩余（ms，>0 表示会话进行中）与「到点是否锁定」标记
  const [sleepRemaining, setSleepRemaining] = useState(0);
  /**
   * v95 反馈 #1：故事页底部显示的应该是**这个故事还剩多久讲完**，
   * 而不是家长端设的睡眠定时（15 分钟那种）——孩子和家长都看不懂那个数字从哪来。
   * remainSec 跟着真实播放位置走：暂停即停、快退快进立即变、停止归零。
   */
  const [remainSec, setRemainSec] = useState(0);
  const [sleepLocked, setSleepLocked] = useState(false);
  /** 到点关屏：纯黑遮罩（iOS 没有公开的「主动熄屏」API，用黑屏 + 释放常亮近似） */
  const [screenOff, setScreenOff] = useState(false);
  // 正在准备克隆声（合成/下载中）：给「点播放后等待」一个可见反馈，
  // 同时作为并发保护，避免等待期间重复点击开出第二路播放（双声叠加）。
  const [preparing, setPreparing] = useState(false);
  /** v82 反馈 #4：声线选择改成「一个按钮 + 底部弹层」，不再常驻占掉三分之一屏幕 */
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const startingRef = useRef(false);
  // 每次播放递增；过期的 onDone / 定时器回调一律作废，避免旧播放把新播放的界面推走
  const playTokenRef = useRef(0);
  const endFiredRef = useRef(false);

  // —— 断点续播 / 后台回前台恢复（v62 反馈 #2）——
  /** 本次「启动播放」的时刻：给它加超时，避免被后台打断后 startingRef 永久为 true（表现为点播放没反应） */
  const startingAtRef = useRef(0);
  /** 断点秒数：点播放时从这里开始（0 表示从头） */
  const resumeAtRef = useRef(0);
  /**
   * 分片断点（片索引 + 片内秒），比秒数准（v93 #1）。
   * App 被上划杀掉后 chunkState 只活在内存里，重新打开只能靠它「原处续播」；
   * 否则按秒估算反推片位置，15–20 分钟的故事会一路偏到末尾 → 起播就跳提问环节。
   */
  const resumePlaceRef = useRef<StoryPlace | null>(null);
  /** 断点秒数（用于界面提示，不参与播放逻辑） */
  const [resumeSec, setResumeSec] = useState(0);
  /** 云端音频被手动暂停（只 pause 未停），再点播放走「秒续」而非重新缓冲（v90 #2） */
  const cloudPausedRef = useRef(false);
  /** 当前播放的「播完」信号处理函数（句柄），供恢复播放时复用同一 onEnded（含 token 校验） */
  const onEndedRef = useRef<(() => void) | null>(null);
  /** 兜底哨兵：音频停在末尾但结束回调没送达的连续拍数（见 startProgressTicker） */
  const endStallRef = useRef(0);
  /** 是否刚从后台/锁屏回来过（回来时要把界面状态与音频会话对齐） */
  const interruptedRef = useRef(false);
  /** story 的 ref 镜像：失焦清理是空依赖的 useCallback，拿不到最新 story */
  const storyRef = useRef<Story | null>(null);
  useEffect(() => {
    storyRef.current = story;
  }, [story]);

  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 本次播放真正开始的时刻（用于识别「被系统收回音频会话后立刻回调播完」的假结束） */
  const playingSinceRef = useRef(0);
  /**
   * 是否仍处在「准备声音」阶段（合成 / 加载中）。
   * v82 反馈 #3：准备期间的任何 ended 回调都不可信——音频还没就绪就报"播完"，
   * 会把界面直接推到「讲完啦」。用 ref 而非 state，避免闭包里读到旧值。
   */
  const preparingRef = useRef(false);
  /** 安全兜底：若真实的播完回调（onDone）因故未触发，到点也结束，避免卡在播放页 */
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * v86 反馈 #1：来电 / 切后台打断后播放状态错乱。
   * 监听 AppState：进后台/来电时主动停掉播放器并记住断点（不让系统留下孤儿播放器），
   * 回到前台若仍属「被打断而非手动停止」则自动续播；打断期间用 setPlaybackInterrupted
   * 屏蔽一切「播完」判定。interruptedRef 已在上方声明（失焦清理复用），此处补两个配合用 ref。
   */
  const appActiveRef = useRef(true);
  const resumeAfterInterruptRef = useRef(false);
  /** 让 AppState 监听读到最新的 phase / isPlaying / handlePlay，避免闭包旧值 */
  const phaseRef = useRef<Phase>('playing');
  const isPlayingRef = useRef(false);
  const handlePlayRef = useRef<(v?: string) => void>(() => {});
  /** handleResume 的 ref：回前台要「原地续上」，AppState 监听的闭包拿不到后定义的函数 */
  const handleResumeRef = useRef<() => void>(() => {});
  /**
   * v98 反馈 #2：切后台再回来「马上跳到结束画面」的保护窗口。
   * ---------------------------------------------------------------------------
   * 从后台回到前台时，音频会话、播放器、位置读数都要重新对齐；这个窗口内收到的
   * 「播完」信号几乎必然是误报（音频会话被系统收回时的假 ended / 位置读数错乱）。
   * 窗口内一律不推进界面，最多自动从断点重起一次；重起后仍报结束才认。
   */
  const endGuardUntilRef = useRef(0);
  const guardRetryRef = useRef(0);
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

  // 播放中为睡眠定时会话刷新剩余时间。
  // v84 反馈 #4：故事讲完后**不再清零**计时——家长设了 30 分钟，故事 10 分钟讲完，
  // 屏幕应该继续按定时在 30 分钟时关掉（原来 handleStoryEnded 会 cancelSleepSession，
  // 等于「故事一讲完定时就作废」，屏幕再也不会按设定时间关）。
  useEffect(() => {
    if (phase === 'sleep') return;
    const tick = () => setSleepRemaining(isSleepSessionActive() ? getSleepRemainingMs() : 0);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  /**
   * 屏幕常亮（v84 反馈 #4）
   * -------------------------------------------------------------------------
   * 原来只在「isPlaying 且 phase=playing」时常亮，于是：
   *   · 正在等声音合成（preparing）时屏幕就开始变暗；
   *   · 故事一讲完（completed / 提问环节）立刻放开常亮，屏幕很快自动锁上，
   *     孩子还没答完题就黑屏了。
   * 现在：听故事（含准备中）保持常亮；只要家长设了睡眠定时，就一直常亮到定时到点，
   * 到点那一刻释放常亮 + 黑屏，屏幕才按系统自动锁定时间熄灭。
   */
  const screenWakeWanted =
    (phase === 'playing' && (isPlaying || preparing)) ||
    (phase !== 'sleep' && sleepRemaining > 0);
  useEffect(() => {
    const TAG = 'rms-story';
    if (!screenWakeWanted) {
      deactivateKeepAwake(TAG).catch(() => {});
      return;
    }
    activateKeepAwakeAsync(TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(TAG).catch(() => {});
    };
  }, [screenWakeWanted]);

  // 播放中每 3 秒记一次断点（秒数 + 分片位置），上划退出/被杀后回来能原处接着听
  useEffect(() => {
    if (!isPlaying || !story) return;
    const timer = setInterval(() => {
      const pos = getClonedPosition();
      if (pos > 3) {
        resumeAtRef.current = pos;
        // 分片断点必须一起存：App 被系统杀掉时 chunkState 随进程消失，
        // 只剩秒数就只能靠估算反推，长故事会一路偏到末尾（v93 #1）
        const place = getChunkPlace();
        if (place) resumePlaceRef.current = place;
        saveStoryPosition(story.id, pos, place);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [isPlaying, story?.id]);

  /**
   * 锁屏 / 切后台 / 来电打断再回来（v62 反馈 #2 + v86 反馈 #1）。
   * ---------------------------------------------------------------------------
   * iOS 在音频会话被系统打断（来电 / 切后台 / 锁屏）时，会由 expo-audio 在原生层把播放器
   * 暂停、并在打断结束后自动续播一个「孤儿播放器」——它的 React 状态（isPlaying）早已脱节，
   * 于是表现为「三角键却仍在响、再点播放一直缓冲、停止后重播直接跳提问」。
   * 这里统一处理 AppState 变化：
   *   ① 进后台 / 来电（state 不再是 active）：若正在播放，主动「暂停 + 记住断点」，
   *      屏蔽一切「播完」判定（setPlaybackInterrupted），不让系统留下孤儿播放器；
   *   ② 回到前台：若这次只是被打断（resumeAfterInterruptRef），原地续上（v98：不再销毁重建），
   *      状态与真实播放重新对齐；若原本就没在播（手动暂停等），重设音频会话、复位启动锁，
   *      回来点播放即可接着听。
   * 用 phaseRef / isPlayingRef / handlePlayRef 读最新值，避免闭包旧值。
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const wasActive = appActiveRef.current;
      appActiveRef.current = state === 'active';
      if (state !== 'active') {
        // 进后台 / 来电 / 锁屏：正在播放则先记断点 + 屏蔽播完判定
        if (isPlayingRef.current && phaseRef.current === 'playing') {
          const pos = getClonedPosition();
          if (pos > 3) resumeAtRef.current = pos;
          const place = getChunkPlace();
          if (place) resumePlaceRef.current = place;
          if (story) saveStoryPosition(story.id, pos > 3 ? pos : resumeAtRef.current, place);
          // 告诉全局问候「故事马上要接着播，先别出声」：
          // 否则回前台时「晚上好」会先 stopStory()，把刚重建的分片播放器连状态一起清掉，
          // 孩子看到的就是「点了播放一直缓冲 / 没声音」（v93 #1 的另一半）。
          setStoryResumePending(true);
          interruptedRef.current = true;
          resumeAfterInterruptRef.current = true;
          setPlaybackInterrupted(true);
          /**
           * v98 反馈 #2（切后台回来立刻跳结束画面）的关键修复：
           * ------------------------------------------------------------------
           * 原来这里一律 `stopStory()` —— 把播放器、分片状态、位置全部销毁，
           * 回前台再从断点**重建一路播放**。重建过程里涉及「重新合成 / 重新定位片 /
           * 重新挂播完检测」，任何一环读数错乱（位置瞬间等于时长、假 ended、
           * 估算误差把起点推到末片）都会被判成「播完了」，于是界面直接跳到结束页。
           *
           * 现在云端音频（克隆声 / 本地录音）**只暂停不销毁**：回前台调用
           * resumeClonedAudio() 原地接着响，位置、分片、播放器都是原来那一份，
           * 不存在重新定位，也就不可能「一回来就播完」。
           * 只有系统音（TTS 无法暂停）仍走停止 + 回来重讲。
           */
          if (clonedPlayingRef.current) {
            pauseClonedAudio();
            cloudPausedRef.current = true; // 暂停态：点播放走「秒续」
          } else {
            playTokenRef.current++; // 系统音：作废这一轮回调，回来重讲
            stopStory();
            cloudPausedRef.current = false;
          }
          startingRef.current = false;
          if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
          if (progressInterval.current) clearInterval(progressInterval.current);
          setIsPlaying(false);
          setPreparing(false);
        } else {
          // 没在播放（手动暂停 / 睡眠锁屏等）：仅标记回来需对齐状态
          interruptedRef.current = true;
          setStoryResumePending(false);
        }
        return;
      }
      // 回到前台
      if (wasActive === false && interruptedRef.current) {
        interruptedRef.current = false;
        setPlaybackInterrupted(false);
        if (resumeAfterInterruptRef.current && phaseRef.current === 'playing') {
          // 来电 / 切后台期间仍在听 → 自动接着播
          resumeAfterInterruptRef.current = false;
          // 保护窗口：这段时间内的「播完」信号按误报处理（见 endGuardUntilRef）
          endGuardUntilRef.current = Date.now() + 6000;
          guardRetryRef.current = 0;
          setTimeout(() => {
            if (!aliveRef.current) return;
            // v97：本页必须还是「当前可见页」才允许自动续播。
            // 旧的故事页实例仍挂在栈里，不校验就会在别的页面上自己出声。
            if (!focusedRef.current) return;
            if (phaseRef.current !== 'playing') return;
            if (clonedPlayingRef.current && cloudPausedRef.current) {
              // 原地续上：复用暂停的那一路播放器，零重建、零定位
              handleResumeRef.current();
              /**
               * 复核：iOS 在后台待久了仍可能把播放器彻底停掉（此时 resume 不报错也不出声）。
               * 1.5 秒后确认真的在响，否则退回「从断点重起」这条路。
               */
              setTimeout(() => {
                if (!aliveRef.current || !focusedRef.current) return;
                if (phaseRef.current !== 'playing') return;
                if (isClonedAudioPlaying()) return;
                cloudPausedRef.current = false;
                void handlePlayRef.current();
              }, 1500);
              return;
            }
            void handlePlayRef.current();
          }, 300);
        } else {
          // 原本就没在播（手动暂停等）：重设音频会话、复位启动锁，回来点播放即可接着听
          void reassertAudioSession();
          startingRef.current = false;
          setIsPlaying(false);
          setPreparing(false);
          if (resumeAtRef.current > 3) setResumeSec(Math.floor(resumeAtRef.current));
        }
      }
    });
    return () => sub.remove();
  }, [story?.id]);

  // 把最新的 phase / isPlaying 同步进 ref，供上面的 AppState 监听读取（避免闭包旧值）
  useEffect(() => {
    phaseRef.current = phase;
    isPlayingRef.current = isPlaying;
  });

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
        // 断点：上次没听完，这次点播放直接接着听
        try {
          const [pos, place] = await Promise.all([
            getStoryPosition(s.id),
            getStoryPlace(s.id),
          ]);
          if (place) resumePlaceRef.current = place;
          if (pos > 3) {
            resumeAtRef.current = pos;
            setResumeSec(Math.floor(pos));
          }
        } catch {
          /* 读不到断点就当从头播 */
        }
        // 「我的故事」卡片上的 ▶：进来直接开讲，省掉再点一次播放键
        if (autoPlayRef.current && !autoPlayStartedRef.current) {
          autoPlayStartedRef.current = true;
          setTimeout(() => {
            if (!aliveRef.current || !focusedRef.current) return;
            void handlePlayRef.current();
          }, 450);
        }
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
      qaPhaseEnterRef.current = Date.now();
      speakPhrase('round1', displayLang);
    } else if (phase === 'qa_round2') {
      speakPhrase('round2', displayLang);
    }
  }, [phase]);

  // 每出现一道题（含语音题），把题目念出来，让不识字的孩子也能参与。
  // 进入问答的第一题先等「引导语」播完（约 1 秒），避免题目把引导语打断。
  const qaQuestionSpeech = (q: QAItem): string => {
    const tail = q.type === 'voice' ? (displayLang === 'en' ? QA_VOICE_TAIL_EN : QA_VOICE_TAIL_ZH) : '';
    return q.question + tail;
  };

  /** 没听清题目时，点按钮再听一遍（不用等下一题） */
  const replayQuestion = () => {
    const q = qaQuestions[qaIndex];
    if (!q) return;
    speakWithBestVoice(qaQuestionSpeech(q), displayLang);
  };

  useEffect(() => {
    if (phase === 'qa_round1' && !qaLoading && qaQuestions[qaIndex]) {
      const q = qaQuestions[qaIndex];
      // 换题：清掉上一题的录音句柄与回放状态
      setVoiceClipUri(null);
      setQaAnswerText('');
      setVoicePlaying(false);
      const sinceEnter = Date.now() - qaPhaseEnterRef.current;
      const wait = qaIndex === 0 && sinceEnter < 1000 ? 1000 - sinceEnter : 0;
      const t = setTimeout(() => {
        speakWithBestVoice(qaQuestionSpeech(q), displayLang);
      }, wait);
      return () => clearTimeout(t);
    }
  }, [phase, qaIndex, qaLoading]);

  // 题目预热：进入问答阶段前，把所有题目的音频预先合成好（中英文都备），
  // 这样「题目一出现就立即朗读」，不再有合成等待的延迟（命中缓存后零 token、零延迟）
  useEffect(() => {
    if (!qaQuestions || qaQuestions.length === 0) return;
    let cancelled = false;
    (async () => {
      /**
       * ⚠️ 这里必须按「提示音声线」预热 —— 题目实际是用 speakWithBestVoice 朗读的，
       * 它读的是提示音声线设置，不是故事朗读声线。之前这里用的 selectedVoice（故事声线），
       * 一旦两个设置不同（比如故事用妈妈克隆声、提示音用大姐姐），预热出来的缓存永远命中不了，
       * 结果每题都要现场合成：慢、且网络一抖就听不到题目（v91 #2）。
       */
      for (const q of qaQuestions) {
        if (cancelled) break;
        // ⚠️ 这两句必须与 qaQuestionSpeech() 用的尾巴逐字一致，否则缓存永不命中
        const tailZh = q.type === 'voice' ? QA_VOICE_TAIL_ZH : '';
        const tailEn = q.type === 'voice' ? QA_VOICE_TAIL_EN : '';
        await prewarmSpeech(q.question + tailZh, 'zh');
        await prewarmSpeech(q.question + tailEn, 'en');
      }
    })();
    return () => { cancelled = true; };
  }, [qaQuestions, displayLang]);

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

  /**
   * 挂载即清场（v97 反馈 #1）：新故事页进来时，先把可能残留的播放器 / 分片状态清掉。
   * 否则上一篇（旧实例）遗留的声音会带进本页，看着像「没点播放自己念起来了」。
   */
  useEffect(() => {
    stopStory();
  }, []);

  useEffect(() => {
    return () => {
      stopStory();
      if (progressInterval.current) clearInterval(progressInterval.current);
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      if (qaRecTimer.current) clearInterval(qaRecTimer.current);
    };
  }, []);

  // 离开本页（切 tab / 打开别的页面）立即停止朗读，避免「已经退出界面了声音还在读」。
  // 回到本页时播放控件仍在，可重新播放 / 暂停 / 停止。
  useFocusEffect(
    useCallback(() => {
      aliveRef.current = true;
      focusedRef.current = true;
      return () => {
        aliveRef.current = false;
        focusedRef.current = false;
        // 离开本页就作废「被打断后自动续播」的资格：
        // 否则旧实例在回前台时还会自己接着播，声音出现在别的页面上（v97 反馈 #1）
        resumeAfterInterruptRef.current = false;
        setStoryResumePending(false);
        // 离开前先存断点，回来点播放就能接着听，而不是重头开始
        const pos = getClonedPosition();
        if (pos > 3 && storyRef.current) {
          resumeAtRef.current = pos;
          // 分片断点也一起存（视频离开页后 App 被杀也能原处续播）
          const place = getChunkPlace();
          if (place) resumePlaceRef.current = place;
          saveStoryPosition(storyRef.current.id, pos, place);
        }
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

  // 默认声线：只认「故事朗读声线」设置（v81 起与提示音分开，默认内置大姐姐）。
  // 不再自动改选某个已克隆亲人——那会让用户以为自己选的声音被"偷偷换掉"。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getVoiceSetting();
      if (cancelled) return;
      setSelectedVoice(normalizeVoiceId(saved));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 可选声音清单：进入页面刷新一次（克隆成功后回到本页即可看到新音色）
  useEffect(() => {
    let cancelled = false;
    listAvailableVoices()
      .then((list) => {
        if (!cancelled) setVoiceOptions(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedVoice]);

  // 当前声线是否有「真人克隆」可用（决定音色标签显示"克隆声音"还是"云端预置音色"）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedVoice || selectedVoice === 'system') {
        if (!cancelled) setVoiceIsCloned(false);
        return;
      }
      let ok = false;
      try {
        ok = await hasClonedVoice(selectedVoice);
      } catch {
        ok = false;
      }
      if (!cancelled) setVoiceIsCloned(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedVoice]);

  // 播放按钮呼吸脉冲：isPlaying 时循环放大/收缩，直观提示「正在播放」
  useEffect(() => {
    if (isPlaying) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(playPulse, { toValue: 1.14, duration: 720, useNativeDriver: true }),
          Animated.timing(playPulse, { toValue: 1, duration: 720, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      playPulse.setValue(1);
    }
  }, [isPlaying, playPulse]);

  // 预热：进故事页就先把克隆音频合成好（不播放），使「点播放」几乎瞬时出声。
  // 仅在选中亲属声线且已克隆、且不是本地录音时预热。
  useEffect(() => {
    if (!story || story.audioUri) return;
    if (!storyText) return;
    let cancelled = false;
    (async () => {
      // 已克隆且当前故事允许用克隆声 → 预热克隆声；否则（未克隆 / 或免费用户在其余故事上）
      // 预热云端预置音色，这样点播放时多半已经合成好，不用干等（v79：默认声音改成云端大姐姐音色）
      const cloneAllowedHere =
        isPremiumUser || (freeCloneStoryId && story?.id === freeCloneStoryId);
      const wantClone =
        !!selectedVoice && (await hasClonedVoice(selectedVoice)) && cloneAllowedHere;
      const target = wantClone ? selectedVoice : presetTargetFor(selectedVoice);
      if (!target || cancelled) return;
      prewarmClonedAudio(storyText, target, displayLang);
      // 主声线是克隆声时，顺手把「兜底的大姐姐」前 3 片也备好：
      // 克隆声万一合成失败/超时，降级后第一段仍能几乎立刻出声，而不是又等一轮（v91 #1）
      if (target !== 'preset:cherry') {
        void prewarmClonedAudio(storyText, 'preset:cherry', displayLang, { maxChunks: 3 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [story?.id, selectedVoice, displayLang]);

  /**
   * 听完一个故事：记入已听列表 + 刷新连续天数（需求 5）。
   *
   * v96 调整（用户反馈「奖励要在听完故事、答完 3 个问题之后才给」）：
   * 这里只记录收听数据，等级 / 勋章的结算挪到第 1 轮问答结清时（settleRewardAfterQa）。
   * 记录仍留在这个时机，避免孩子听完就退出、统计里却什么都没留下。
   */
  const rewardBaselineRef = useRef<{ storyId: string; level: number } | null>(null);
  const rewardSettledRef = useRef(false);

  useEffect(() => {
    if (phase !== 'completed' || !story) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getProgress();
        if (cancelled) return;

        const beforeLevel = getLevel(p.listenedStories.length);
        // 记住「这个故事之前」的等级，供问答结束后判断是否升级。
        // 只记一次：这个 effect 可能因 story 引用变化重跑，重跑时故事已在列表里，
        // 再取 beforeLevel 就等于 afterLevel，升级永远检不出来。
        if (!rewardBaselineRef.current || rewardBaselineRef.current.storyId !== story.id) {
          rewardBaselineRef.current = { storyId: story.id, level: beforeLevel.level };
        }

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

        // 只把收听数据落盘；勋章 / 等级留到答完 3 个问题后一起结算
        await saveProgress(p);
      } catch (err) {
        console.error('Save progress error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [phase, story]);

  /**
   * 答完第 1 轮 3 个问题后结算奖励（v96 用户要求）。
   *
   * 「提问环节不计入奖励」——答对答错都不额外加分，这里只用收听数据（篇数、连续天数、
   * 打卡、跨月等）算等级与勋章。所以结算逻辑本身没变，变的是触发时机：
   * 从「故事讲完」改到「3 个问题都答完」，孩子答完题才看到奖励动画。
   */
  const settleRewardAfterQa = useCallback(async () => {
    if (rewardSettledRef.current || !story) return;
    rewardSettledRef.current = true;
    try {
      const p = await getProgress();
      if (!aliveRef.current) return;

      // 结算勋章（含当月 / 整年等新增激励项）
      const extras = computeRewardExtras(p.listenLog);
      const fresh = getNewBadges(
        {
          listenedCount: p.listenedStories.length,
          streakDays: p.streakDays,
          checkInCount: p.checkIns.length,
          monthCount: extras.monthCount,
          listenSpanDays: extras.listenSpanDays,
        },
        p.badges,
      );
      if (fresh.length) {
        p.badges = [...p.badges, ...fresh.map((b) => b.id)];
        await saveProgress(p);
      }
      if (!aliveRef.current) return;

      // 升级优先展示，其次才是新勋章
      const afterLevel = getLevel(p.listenedStories.length);
      const beforeLevel = rewardBaselineRef.current?.level ?? afterLevel.level;
      if (afterLevel.level > beforeLevel) {
        setLevelUp(afterLevel);
      } else if (fresh.length) {
        setNewBadge(fresh[0]);
      }
    } catch (err) {
      rewardSettledRef.current = false; // 允许下次再试
      console.error('Settle reward error:', err);
    }
  }, [story]);

  /**
   * 奖励动画层（升级优先，其次新勋章）。
   * v96：从「故事讲完」页移到答题结束后的页面 —— 孩子答完 3 个问题才看到奖励。
   */
  const rewardOverlay = (
    <>
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
        clayIcon="badge"
        title={t('reward.newBadge')}
        subtitle={newBadge?.name ?? ''}
        desc={newBadge?.desc}
        onDone={() => setNewBadge(null)}
      />
    </>
  );

  // 加载家长悄悄话（需求 2）：故事载入后即读取，存在则以淡入动画展示
  useEffect(() => {
    if (!story) return;
    let cancelled = false;
    (async () => {
      const c = await getParentComment(story.id);
      if (cancelled) return;
      if (c?.text) {
        setParentComment(c);
        // 让「爸爸妈妈的悄悄话」像卡通对话框一样弹跳着跳出来（Issue 5）
        commentOpacity.setValue(0);
        commentScale.setValue(0.6);
        Animated.parallel([
          Animated.timing(commentOpacity, {
            toValue: 1,
            duration: 320,
            useNativeDriver: true,
          }),
          Animated.spring(commentScale, {
            toValue: 1,
            friction: 4,
            tension: 120,
            useNativeDriver: true,
          }),
        ]).start();
      }
    })();
    return () => { cancelled = true; };
  }, [story, commentOpacity]);

  // 故事真正讲完（系统音 onDone / 克隆声 onEnded）→ 才进入「讲完啦/提问」环节
  const handleStoryEnded = () => {
    /**
     * v84 反馈 #4：这里**不再** cancelSleepSession()。
     * 家长设的「睡眠定时」是「几点把屏幕关掉」，不是「放多久停声」：
     * 故事讲完后倒计时应继续走，到点再黑屏关屏（见 sleep 阶段的 screenOff）。
     * 只有手动停止 / 退出播放页才取消会话（见 handleStop 与失焦清理）。
     */
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    if (progressInterval.current) clearInterval(progressInterval.current);
    setProgress(100);
    setRemainSec(0);
    setIsPlaying(false);
    setPhase('completed');
    // 听完了，断点作废（下次从头开始才是对的）
    resumeAtRef.current = 0;
    resumePlaceRef.current = null;
    setResumeSec(0);
    if (story) clearStoryPosition(story.id);
    // 俏皮收尾：克隆声随机来一句「讲完啦」，与屏显的完成页呼应
    speakPhrase('done', displayLang);
  };

  // 启动进度条计时器：isReal=true 用真实播放位置（克隆/本地录音，与实际时长一致），
  // false 用文字长度估算（系统音 TTS 无法读取真实位置，仅供视觉参考）
  const startProgressTicker = (isReal: boolean) => {
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (isReal) {
      endStallRef.current = 0;
      progressInterval.current = setInterval(() => {
        const pos = getClonedPosition();
        const dur = getClonedDuration();
        if (dur > 0) {
          lastTotalDuration.current = dur * 1000;
          setProgress(Math.min(100, (pos / dur) * 100));
          // 剩余时间 = 真实总时长 - 真实播放位置（暂停时 pos 不前进，倒计时自然停住）
          setRemainSec(Math.max(0, Math.round(dur - pos)));
        }
        /**
         * v95 反馈 #3 兜底哨兵：音频已经停住、位置就在末尾，但结束回调因为
         * 各种原因（片状态被提前清理 / 事件丢失）没送到界面 —— 每 250ms 一拍，
         * 连续 8 拍（2 秒）仍是这样就主动结束，避免「声音停了界面一动不动」。
         * 只在仍在播放态时判，暂停不会被误判成播完。
         */
        if (!isPlayingRef.current) {
          endStallRef.current = 0;
          return;
        }
        const rawDur = getClonedDurationRaw();
        const rawPos = getClonedPositionRaw();
        if (!isClonedAudioPlaying() && rawDur > 1 && rawPos >= rawDur - 1) {
          endStallRef.current += 1;
          if (endStallRef.current >= 8) {
            endStallRef.current = 0;
            onEndedRef.current?.();
          }
        } else {
          endStallRef.current = 0;
        }
      }, 250);
    } else {
      const totalDuration =
        displayLang === 'en'
          ? Math.max((storyText.split(/\s+/).filter(Boolean).length) * 450, 8000)
          : Math.max(storyText.length * 210, 10000);
      lastTotalDuration.current = totalDuration;
      setRemainSec(Math.round(totalDuration / 1000));
      const step = 100 / (totalDuration / 500);
      progressInterval.current = setInterval(() => {
        setProgress((prev) => (prev >= 100 ? 100 : prev + step));
        // 系统音拿不到真实播放位置，按同一个 500ms 节拍递减（暂停时 ticker 已停，不会继续减）
        setRemainSec((prev) => Math.max(0, prev - 0.5));
      }, 500);
    }
  };

  /**
   * @param voiceOverride 指定用哪个声线起播。播放中换声时传入新声线，
   *        避免依赖 setSelectedVoice 的异步 state（同一 tick 里读到的还是旧值）。
   */
  const handlePlay = async (voiceOverride?: string) => {
    handlePlayRef.current = handlePlay;
    if (!story) return;
    /**
     * v97 反馈 #1：已经离开本页就绝不起播。
     * 起播是异步的（读设置 → 合成 → 建播放器，可能好几秒），
     * 旧实例的这条链路跑完时会绕过所有界面状态，直接把声音放出来 ——
     * 用户看到的就是「新页面没点播放，却响起了上一篇的声线」。
     */
    if (!focusedRef.current) return;
    const voice = voiceOverride ?? selectedVoice;
    playingVoiceRef.current = voice; // 记录本轮实际声线，供换声时判「真的没变化」
    // 免费用户的克隆声只能讲「那一篇专属故事」；其余故事即便全局默认是克隆声也退回系统音，
    // 不让播放被卡死（pickVoice 已经显式拦截过主动选择，这里兜住「全局默认=克隆声」的情况）
    const cloneAllowedHere =
      isPremiumUser || (freeCloneStoryId && story?.id === freeCloneStoryId);
    const voiceKind = voiceOptions.find((o) => o.id === voice)?.kind;
    let effectiveVoice: string = voice;
    if (voiceKind === 'clone' && !cloneAllowedHere) effectiveVoice = 'system';
    // 同步并发保护：合成/预热期间重复点击不再开第二路播放。
    // （v54 现象：点一次没反应又点一次，两路同时朗读、先结束的那路把界面推到「讲完啦」）
    if (startingRef.current && Date.now() - startingAtRef.current < 20000) return;
    startingRef.current = true;
    startingAtRef.current = Date.now();
    const token = ++playTokenRef.current;
    endFiredRef.current = false;
    cloudPausedRef.current = false; // 重新起播：不再是「暂停态」，恢复路径失效
    // 先彻底停掉任何在播的音频，避免叠加
    stopStory();
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    setProgress(0);
    setRemainSec(0);
    // 立即进入播放态：按钮禁用 + 波形起来 + 显示「正在准备声音」，不再是一片静止的等待
    setIsPlaying(true);
    setPreparing(true);
    setScreenOff(false); // 重新播放：撤掉到点黑屏遮罩
    preparingRef.current = true; // 准备阶段：任何 ended 回调一律忽略（见 onEnded 注释）
    clonedPlayingRef.current = false; // 本轮还没确定用云端音频，先按系统音兜底逻辑走
    playingSinceRef.current = Date.now();

    try {
      // 睡眠定时：读取家长设置，启动倒计时会话（到点自动淡出停止 + 晚安锁屏）
      const sleepMin = await getSleepTimerMinutes();
      const sleepLock = await getSleepLockEnabled();
      const onSleepExpire = () => {
        setSleepLocked(sleepLock);
        // 到点：先切黑屏（近似的「关屏」），再由 screenWakeWanted 释放常亮，
        // 让 iOS 按系统自动锁定时间真正熄屏。
        setScreenOff(true);
        setPhase('sleep');
      };
      // 故事结束只认当前这次播放：过期的 onDone / 定时器回调一律忽略
      const onEnded = () => {
        if (token !== playTokenRef.current) return;
        if (endFiredRef.current) return;
        // 打断期间（来电 / 切后台）任何 ended 信号都不可信，直接忽略，
        // 避免 iOS 孤儿播放器的暂停被误判成「故事讲完 → 跳提问」（v86 反馈 #1）
        if (!appActiveRef.current || interruptedRef.current) return;
        /**
         * v98 反馈 #2：刚从后台回到前台的保护窗口内，任何「播完」都按误报处理。
         * 系统在收回 / 重建音频会话时常常给出假 ended，位置读数也会瞬时错乱；
         * 一旦被当真，孩子看到的就是「回来还在播放页，一眨眼跳到结束页」。
         * 窗口内不推进界面：最多自动从断点重起一次（guardRetryRef），重起后仍报结束才认。
         */
        if (Date.now() < endGuardUntilRef.current) {
          if (guardRetryRef.current < 1) {
            guardRetryRef.current += 1;
            setTimeout(() => {
              if (!aliveRef.current || !focusedRef.current) return;
              if (phaseRef.current !== 'playing') return;
              cloudPausedRef.current = false;
              void handlePlayRef.current();
            }, 700);
          } else {
            // 重起后仍立刻报结束：不跳结束页，老老实实停在播放页等孩子再点一次
            setIsPlaying(false);
            setPreparing(false);
            if (progressInterval.current) clearInterval(progressInterval.current);
          }
          return;
        }
        /**
         * v79 修复：切到别的 App / 锁屏时，iOS 会收回音频会话，
         * 播放器（尤其云端合成音）常常立刻回调「播完了」——
         * 于是界面被误推到「讲完啦」，回到前台再点播放就直接进提问环节。
         *
         * v81 修正：判据从「是不是没断点」改成「是不是真的到末尾」。
         *
         * v82 修正（反馈 #3：第一次点播放直接进提问 / 换声后缓冲很久直接跳提问）：
         * 原来用 `playedMs`（从**点播放开始准备**算起）判断是不是被打断，
         * 但云端合成一次要好几秒，等音频就绪时 playedMs 早就超过 3000ms，
         * 这个「已经播够久」的假象让一次假 ended 直接被当成正常播完。
         * 现在改成让结束信号**自证**：
         *   ① 还在准备声音阶段 → 一律忽略；
         *   ② 用了云端音频（克隆声 / 本地录音）→ 必须「真的出过声 + 位置推进过」，或真的到末尾；
         *   ③ 系统音（TTS）→ onDone 由引擎触发、可信，只用最短时长兜底。
         */
        const endDur = getClonedDuration();
        const endPos = getClonedPosition();
        /**
         * v93 #1：分片模式下「播完」只认最后一片。
         * 片与片之间切播放器时，个别版本会送出一次 ended 信号；一旦被当成整篇播完，
         * 孩子听到一半就被推进提问环节（正是本次反馈的现象）。引擎在末片真正结束时
         * 会自己清掉 chunkState，所以「正常结束」时这里必然拿到 null，不会误拦。
         */
        /**
         * v95 反馈 #3（嫦娥奔月听完不跳提问）：
         * 引擎在整段**自然播完**时会自己打标记，这里直接采信。
         * 原来只靠「位置推进过」等启发式复核，而分片模式每换一片都会重置这些值，
         * 于是真实的播完信号被判成假信号丢掉 —— 声音停了，界面却停在播放页，
         * 既不进「讲完啦」，也不会结算奖励、不会进提问环节。
         */
        if (didFinishNaturally()) {
          endFiredRef.current = true;
          handleStoryEnded();
          return;
        }
        const chunkNow = getChunkPlace();
        if (chunkNow && chunkNow.index < chunkNow.total - 1) return;
        const reallyAtEnd = endDur > 1 && endPos >= endDur - 3;
        const everHeard = didPlayThisSession();
        const advanced = getMaxPlayedPosition() > 1;

        if (preparingRef.current && !reallyAtEnd) {
          return; // 声音还没就绪，此刻的 ended 一定不可信
        }
        if (clonedPlayingRef.current && !reallyAtEnd && !(everHeard && advanced)) {
          startingRef.current = false;
          setPreparing(false);
          setIsPlaying(false);
          return;
        }
        const playedMs = Date.now() - playingSinceRef.current;
        if (!clonedPlayingRef.current && playedMs < 2500 && !reallyAtEnd) {
          startingRef.current = false;
          setPreparing(false);
          setIsPlaying(false);
          return;
        }
        endFiredRef.current = true;
        handleStoryEnded();
      };
      // 句柄存到 ref，供「恢复播放」路径复用同一 onEnded（含 token 校验），避免重复实现
      onEndedRef.current = onEnded;

      // 保留的本地录音：直接播放原文件（不走 TTS / 克隆合成），与克隆声共用全局 player
      if (story.audioUri) {
        const ok = await playLocalFile(story.audioUri, onEnded);
        if (token !== playTokenRef.current) return;
        // 文件真的没了（重装 / 换机 / 用户清过数据）：明确告诉家长，别让孩子对着无声页面干等
        if (!ok) {
          setIsPlaying(false);
          Alert.alert(t('story.clipFailTitle'), t('story.clipFailMsg'));
          return;
        }
        setUsingClonedVoice(true);
        clonedPlayingRef.current = ok; // 同用全局 player，支持真实进度 + 拖动快进
        // 断点续播：本地录音也能 seek
        if (ok && resumeAtRef.current > 3) seekClonedAudio(resumeAtRef.current);
        startProgressTicker(true);
        // 兜底：万一播完检测没触发，到点也结束（留 45s 余量，避免把故事掐断）
        if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
        const safeDur = (story.duration || 30) * 1000;
        safetyTimerRef.current = setTimeout(onEnded, safeDur + 45000);
        startSleepSession({ minutes: sleepMin, lockEnabled: sleepLock, onExpire: onSleepExpire });
        return;
      }

      /**
       * 断点续播（v93 #1）：
       * 有「片索引断点」就交给播放层精确定位（与时长估算无关）；
       * 没有（旧记录）才退回按秒估算。
       */
      const resumePlace = resumePlaceRef.current;
      const used = await playStory(storyText, effectiveVoice, displayLang, onEnded, {
        startAt: resumeAtRef.current,
        startChunk: resumePlace ?? undefined,
        /**
         * v97 反馈 #1：引擎在每次合成/起播边界都会问一次「还要不要播」。
         * 只要已经离开本页、或这次播放被后来的操作作废，就在**出声之前**放弃，
         * 不再出现「页面都换了，声音却自己起来」。
         */
        isStillWanted: () => token === playTokenRef.current && focusedRef.current,
      });
      if (token !== playTokenRef.current) return;
      setUsingClonedVoice(used);
      clonedPlayingRef.current = used;
      /**
       * v91 #1：记录「实际生效」的声线。
       * 用户选了妈妈的声音但云端合成失败时，playStory 会自动降级成内置大姐姐；
       * 此时如果仍把 playingVoiceRef 记成妈妈，下次再点「妈妈的声音」会被判成
       * 「没变化」直接 return —— 用户看到的现象就是「点了半天还是大姐姐」。
       */
      playingVoiceRef.current = getLastPlayedVoice() || voice;

      // 断点续播：从上次停下的位置接着听（仅克隆声 / 本地录音可 seek，系统音不支持）
      if (used && resumeAtRef.current > 3 && !resumePlace) {
        const target = resumeAtRef.current;
        // 分片模式已经在起播时定位好了（见 playStory 的 startAt），这里只在明显偏离时补一次，
        // 避免"刚定位好又被 seek 拉一下"的小跳帧
        if (getClonedPosition() < target - 5) seekClonedAudio(target);
        // 音频刚加载时 seek 可能被忽略，600ms 后若位置仍在开头附近就补一次
        setTimeout(() => {
          if (token !== playTokenRef.current) return;
          if (getClonedPosition() < target - 1.5) seekClonedAudio(target);
        }, 600);
        const dur = getClonedDuration();
        if (dur > 0) {
          lastTotalDuration.current = dur * 1000;
          setProgress(Math.min(100, (target / dur) * 100));
        }
      } else if (used && resumePlace) {
        // 分片精确定位已经在 playChunkIndex 里做过（片内 seek），这里只校准进度条刻度。
        // 绝不能再按秒数补 seek：秒数是估算累计值，二次跳会把刚对准的位置又推偏。
        const dur = getClonedDuration();
        if (dur > 0) lastTotalDuration.current = dur * 1000;
      }

      // 克隆声：用真实播放位置驱动进度条（与实际时长一致），并支持拖动 / 快进后退；
      // 系统音（TTS）：无法读取真实位置，仍用文字长度估算（仅视觉），提示不支持拖动。
      startProgressTicker(used);

      // 兜底：万一 onDone / 播完检测都没触发，到点也结束
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      const estimatedMs =
        displayLang === 'en'
          ? Math.max(storyText.split(/\s+/).filter(Boolean).length * 450, 8000)
          : Math.max(storyText.length * 210, 10000);
      /**
       * v93 #1：安全网按「估算时长」排程，而分片模式下这个估算就是各片字数的估算之和
       * （真实 TTS 通常比它短，反过来也可能长）。若估算偏短，安全网会在故事还没讲完时
       * 就调 onEnded —— 表现正是「听到一半直接跳到结尾、进提问环节」。
       * 所以这里统一放宽成 1.5 倍 + 60 秒余量：它只当"真的卡死"的兜底，
       * 正常结束仍由分片引擎的「最后一片播完」判定（那是准的）。
       */
      const safeDur = used ? Math.max(story.duration ? story.duration * 1000 : 0, estimatedMs) : estimatedMs;
      safetyTimerRef.current = setTimeout(onEnded, safeDur * 1.5 + 60000);
      // v80 #4：起播 1.2s 后音频时长已知，把过宽的安全网收一收（同样留足 1.5 倍 + 60s，
      // 分片模式的「总时长」是估算累计值，收紧太多就会提前掐断）。
      if (used) {
        setTimeout(() => {
          if (token !== playTokenRef.current) return;
          const real = getClonedDuration();
          if (real <= 1) return;
          const remain = Math.max(0, real - getClonedPosition());
          if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
          safetyTimerRef.current = setTimeout(onEnded, remain * 1500 + 60000);
        }, 1200);
      }
      startSleepSession({ minutes: sleepMin, lockEnabled: sleepLock, onExpire: onSleepExpire });
    } finally {
      if (token === playTokenRef.current) {
        setPreparing(false);
        preparingRef.current = false;
      }
      startingRef.current = false;
      // 续播这一刻已经过去，之后回前台可以正常播问候（故事在播时由 isStoryPlaying 挡住）
      setStoryResumePending(false);
    }
  };

  /**
   * handlePlay 每次渲染都会重建，而非点击路径（自动播放、回前台续播）拿到的可能是旧闭包：
   * 统一在这里同步进 ref。之前 ref 只在 handlePlay 内部赋值，导致「还没点过播放」时
   * 这几条路径都拿到空函数，表现为点了播放按钮没反应。
   */
  useEffect(() => {
    handlePlayRef.current = handlePlay;
  });

  /**
   * v80 #2：播放中换声**立即生效**。
   * ---------------------------------------------------------------------------
   * 原来这里只 `setSelectedVoice(id)`，正在播的那段音频不会重起，
   * 于是必须「停止 / 暂停 → 再点播放」才换得过来，孩子的感受就是"点了没反应"。
   * 现在：记住当前播放位置 → 用新声线从同一位置重新起播，进度无缝衔接。
   */
  const pickVoice = (id: string) => {
    // 免费用户的克隆声只能讲「那一篇专属故事」；在其余故事上点克隆声 → 诙谐拦截
    const picked = voiceOptions.find((o) => o.id === id);
    const cloneAllowedHere =
      isPremiumUser || (freeCloneStoryId && story?.id === freeCloneStoryId);
    if (picked?.kind === 'clone' && !cloneAllowedHere) {
      Alert.alert(t('gate.freeCloneEndedTitle'), t('gate.freeCloneEndedMsg'), [
        { text: t('common.ok'), style: 'cancel' },
        { text: t('gate.goUnlock'), onPress: () => router.push('/(parent)/subscription') },
      ]);
      return;
    }
    // 只有「设置值」和「实际在播的音色」都一致，才算真的没变化（见 playingVoiceRef 注释）
    if (!id || (id === selectedVoice && id === playingVoiceRef.current)) return;
    const wasPlaying = isPlaying;
    const pos = getClonedPosition();
    const dur = getClonedDuration();
    // 换声要停在同一点：分片断点比秒数准，且必须在 stopStory 之前取（它会清掉 chunkState）
    const placeNow = getChunkPlace();
    setSelectedVoice(id);
    void saveVoiceSetting(id); // 记住选择，下次进故事页直接沿用
    if (!wasPlaying) return;

    /**
     * v82 反馈 #3：换声后「缓冲了很久，直接跳到提问环节」。
     * 换声是「从当前位置用新声线重起播」，如果当时位置已经贴到结尾
     * （剩余不足 12 秒），新声音一加载就几乎立刻播完，
     * 孩子的感受就是「等半天，然后直接进提问」。
     * 这种情况改成用新声音**从头讲**，让他真的听到新声音讲故事。
     */
    const remain = dur > 1 ? dur - pos : Infinity;
    const restartFromZero = remain < 12;
    resumeAtRef.current = !restartFromZero && pos > 3 ? pos : 0;
    // 换声 = 用新音色从同一片同一秒起播；从头讲则把分片断点一起清掉
    resumePlaceRef.current = !restartFromZero ? placeNow : null;
    setResumeSec(resumeAtRef.current > 0 ? Math.floor(resumeAtRef.current) : 0);
    // 作废旧那一路的播放回调：否则旧音频的「播完」会把界面推到完成页
    playTokenRef.current++;
    startingRef.current = false;
    stopStory();
    cloudPausedRef.current = false; // 换声 = 彻底重起，暂停态失效
    setIsPlaying(false);
    setPreparing(false);
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    // 稍等一拍再起播；用 override 传声线，不依赖 setState 是否已刷新
    setTimeout(() => {
      void handlePlay(id);
    }, 80);
  };

  const handlePause = () => {
    // 记断点：暂停后（含锁屏/退出）再点播放能接着听
    const pos = getClonedPosition();
    if (pos > 3 && story) {
      resumeAtRef.current = pos;
      const place = getChunkPlace();
      if (place) resumePlaceRef.current = place;
      setResumeSec(Math.floor(pos));
      saveStoryPosition(story.id, pos, place);
    }
    startingRef.current = false;
    if (clonedPlayingRef.current) {
      // 云端音频（克隆声/本地录音）：只 pause 当前路播放器，不销毁、不重新合成/load，
      // 再点播放可秒续（v90 #2）。暂停期间的「播完」检测由引擎屏蔽。
      pauseClonedAudio();
      cloudPausedRef.current = true;
    } else {
      // 系统音 TTS 无法暂停，只能整段停止；恢复时从断点起讲。
      // 含「还在准备声音」的阶段：必须作废这次播放回调，否则合成完成后会自己接着响。
      playTokenRef.current++;
      stopStory();
      cloudPausedRef.current = false;
    }
    setIsPlaying(false);
    setPreparing(false);
    setStoryResumePending(false); // 手动暂停：不再需要「问候让路」
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
  };

  /**
   * v90 #2：云端音频被手动暂停后，点播放「秒续」——复用同一路 player，不重新合成/load。
   * 仅当 cloudPausedRef 为 true 且仍是云端音频时走此路径；其余情况（系统音 / 已彻底停止）
   * 由 handlePlay 重新起播。
   */
  const handleResume = () => {
    void reassertAudioSession();
    /**
     * v93 #1：这里**不再** seek。
     * 暂停只 pause 了当前这一片，player 的播放位置原样保留，resume 即从原处继续；
     * 而 `resumeAtRef` 是「各片累计秒」，分片模式下拿它反推片索引会因估算误差跳到别的片，
     * 反而把刚要续上的位置推偏（表现为"接着播却跳了一段"）。
     */
    resumeClonedAudio();
    cloudPausedRef.current = false;
    // 续播已经真正发起：解除「问候语让路」标记（否则本轮 App 生命周期内问候再也不会响）
    setStoryResumePending(false);
    setIsPlaying(true);
    setPreparing(false);
    preparingRef.current = false;
    startingRef.current = false;
    startProgressTicker(clonedPlayingRef.current);
    // 重启安全定时器（按剩余时长兜底；真实播完检测仍由引擎负责）
    // 与 handlePlay 同理放宽 1.5 倍 + 60s，避免估算偏短时把故事提前掐断（v93 #1）
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    const estimatedMs =
      displayLang === 'en'
        ? Math.max(storyText.split(/\s+/).filter(Boolean).length * 450, 8000)
        : Math.max(storyText.length * 210, 10000);
    const safeDur = clonedPlayingRef.current
      ? Math.max(story?.duration ? story.duration * 1000 : 0, estimatedMs)
      : estimatedMs;
    safetyTimerRef.current = setTimeout(() => onEndedRef.current?.(), safeDur * 1.5 + 60000);
  };
  /**
   * 把最新一版 handleResume 挂到 ref 上（渲染期同步，不用 effect）。
   * AppState 监听只订阅一次，闭包里拿不到后来定义的函数；
   * 而「回前台原地续上」必须调到它，所以每次渲染都刷新一次。
   */
  handleResumeRef.current = handleResume;

  const handleStop = () => {
    playTokenRef.current++;
    startingRef.current = false;
    stopStory();
    setStoryResumePending(false);
    cancelSleepSession();
    setIsPlaying(false);
    setPreparing(false);
    setProgress(0);
    setRemainSec(0);
    cloudPausedRef.current = false;
    playingVoiceRef.current = ''; // 已彻底停止：没有「实际在播的音色」了
    // 停止 = 从头开始，断点清掉
    resumeAtRef.current = 0;
    resumePlaceRef.current = null;
    setResumeSec(0);
    if (story) clearStoryPosition(story.id);
    if (progressInterval.current) clearInterval(progressInterval.current);
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
  };

  /** 从头播放（清掉断点后走正常播放流程） */
  const handlePlayFromStart = () => {
    resumeAtRef.current = 0;
    resumePlaceRef.current = null;
    setResumeSec(0);
    if (story) clearStoryPosition(story.id);
    void handlePlay();
  };


  // 离开故事页（切到首页 / 再听一遍 / 返回 / 或 AI 回答还在响时切走）彻底停掉所有声音与会话，
  // 避免「界面走了、AI 还在朗读」（v86 反馈 #2）。同时释放常亮，交回系统熄屏。
  useEffect(() => {
    return () => {
      stopStory();
      cancelSleepSession();
      setStoryResumePending(false);
      cloudPausedRef.current = false;
      playingVoiceRef.current = '';
      deactivateKeepAwake('rms-story').catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const fb = pickPhrase('correct', displayLang);
      setQaFeedback(fb);
      // 等反馈语音播完再进下一题，避免「答对」被下一题打断；但最多只等 2.5 秒，
      // 提示音卡住时不能把孩子晾在原地（v92：提示音与界面的联动不能过长）。
      let advanced = false;
      const advance = () => {
        if (advanced) return;
        advanced = true;
        if (!aliveRef.current) return;
        setQaFeedback('');
        if (qaIndex < qaQuestions.length - 1) {
          setQaIndex(qaIndex + 1);
        } else {
          // 3 个问题都答完了 → 这时才结算奖励（听完故事 + 答完题才给，见 settleRewardAfterQa）
          void settleRewardAfterQa();
          setPhase('qa_round2');
        }
      };
      // 清理上一题可能残留的兜底计时器，避免重复推进
      if (qaAdvanceTimer.current) {
        clearTimeout(qaAdvanceTimer.current);
        qaAdvanceTimer.current = null;
      }
      speakWithBestVoice(fb, displayLang, { onDone: advance }).catch(() => {});
      // 兜底：万一音频未触发 onDone（合成失败等），也按时推进，不卡住流程
      qaAdvanceTimer.current = setTimeout(advance, 2500);
    } else {
      // 答错：给再次选择的机会，停留在本题（选项始终可点），不进入下一步
      const fb = pickPhrase('wrong', displayLang);
      setQaFeedback(fb);
      speakWithBestVoice(fb, displayLang);
    }
  };

  /**
   * 第 1 轮 voice 题：再点一下麦克风 → 停止录音，**停在本题等孩子确认**。
   *
   * 2026-11-01 改（用户反馈「语音始终听不到，要点击上传/确认才进下一步」）：
   * 原逻辑录完 900ms 就自动跳到下一题，孩子没听到自己说了什么、也没机会重录，
   * 大人看起来就是「一录完就过去了，什么也没发生」。现在：
   *   录完 → 停在本题，给「▶ 听我录的 / 🎤 重录 / ✅ 说完了，下一题」三个按钮。
   */
  const handleVoiceRecord = async () => {
    setIsRecording(false);
    // 等录音真正停止（含等待开始流程完成，避免快速松手漏录）后再判断
    await stopQaRecording();
    const durSec = (recEndTs.current - recStartTs.current) / 1000;
    // 录音过短（<0.6s）视为误触/没说话：提示重录，不推进
    if (durSec < 0.6) {
      const tooShort = pickPhrase('voiceTooShort', displayLang);
      setQaFeedback(tooShort);
      speakWithBestVoice(tooShort, displayLang);
      setTimeout(() => setQaFeedback(''), 1600);
      return;
    }
    // 录好了：保留音频句柄，交给孩子决定「听一遍 / 重录 / 继续」
    // v84 反馈 #1：拷贝到稳定目录再播（缓存临时文件常常"能创建、播不出声"）
    // 个别机型 stop() 返回时 uri 还没写回，等一下再读一次，避免误判"没录上"
    let rawUri = audioRecorder.uri ?? null;
    if (!rawUri) {
      await new Promise((r) => setTimeout(r, 220));
      rawUri = audioRecorder.uri ?? null;
    }
    const clip = persistQaClip(rawUri);
    if (!clip) {
      const tooShort = pickPhrase('voiceTooShort', displayLang);
      setQaFeedback(tooShort);
      speakWithBestVoice(tooShort, displayLang);
      setTimeout(() => setQaFeedback(''), 1600);
      return;
    }
    setVoiceClipUri(clip);
    const heard = pickPhrase('voiceHeard', displayLang);
    setQaFeedback(heard);
    speakWithBestVoice(heard, displayLang);
    // v91 #2：顺手把这段回答转成文字并显示出来（失败就只留录音，不影响流程）
    setQaAnswerText('');
    void (async () => {
      try {
        const text = await transcribeAudio(clip);
        if (text && text.trim()) setQaAnswerText(text.trim());
      } catch {
        /* 转写失败静默：录音回放仍然可用 */
      }
    })();
  };

  /** 回放刚录的这一段（孩子确认自己说了什么） */
  const playVoiceClip = async () => {
    if (!voiceClipUri) return;
    if (voicePlaying) {
      stopStory();
      setVoicePlaying(false);
      return;
    }
    setVoicePlaying(true);
    /**
     * v84 反馈 #1：录音回放不出声。
     * 录完之后音频会话还停在 playAndRecord（走听筒、音量极小，听起来就是"没声"），
     * 直接起播往往是"播放器建起来了但一点声音都没有"。
     * 所以先把会话显式切回「纯播放」，留一拍让它落定；仍失败就重置会话再试一次。
     */
    const toPlaybackMode = async () => {
      try {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      } catch {
        /* 会话配置失败不阻断，继续尝试起播 */
      }
    };
    // 先把还在响的提示音（克隆声 / 系统音）停掉，否则会盖住刚录的这段
    stopStory();
    await toPlaybackMode();
    await new Promise((r) => setTimeout(r, 160));
    let ok = await playLocalFile(voiceClipUri, () => setVoicePlaying(false));
    if (!ok) {
      await reassertAudioSession();
      await new Promise((r) => setTimeout(r, 260));
      ok = await playLocalFile(voiceClipUri, () => setVoicePlaying(false));
    }
    if (!ok) {
      setVoicePlaying(false);
      setQaFeedback(t('story.qa.clipFail'));
      setTimeout(() => setQaFeedback(''), 2200);
    }
  };

  /** 重录：清掉这段，回到话筒界面 */
  const retakeVoice = () => {
    stopStory();
    setVoicePlaying(false);
    setVoiceClipUri(null);
    setQaFeedback('');
    qaAutoStop.current = handleVoiceRecord;
    startQaRecording();
  };

  /**
   * 语音题的共同收尾：清干净状态并推进。
   * record=true 时把这次回答记进回顾日志（跳过则不记，避免日志里出现空回答）。
   */
  const finishVoiceQuestion = (record: boolean) => {
    const q = qaQuestions[qaIndex];
    if (record && q) {
      setQaRound1Log((prev) => [
        ...prev,
        { q: q.question, a: qaAnswerText || t('story.qa.voiceAnswer') },
      ]);
    }
    stopStory();
    setVoicePlaying(false);
    setVoiceClipUri(null);
    setQaAnswerText('');
    setQaFeedback('');
    if (qaIndex < qaQuestions.length - 1) {
      setQaIndex(qaIndex + 1);
    } else {
      // 3 题都过了（最后一题是语音题）→ 此时结算奖励
      void settleRewardAfterQa();
      setPhase('qa_round2');
    }
  };

  /** 确认这一题答完了 → 记日志并进入下一题 */
  const confirmVoiceAnswer = () => finishVoiceQuestion(true);

  /**
   * 跳过语音题（v96）：麦克风没授权、设备录不上、或孩子就是不想说话时，
   * 也要能往下走 —— 奖励改成答完 3 题才给，万一卡在这一题，孩子永远拿不到奖励。
   * 「提问环节不计入奖励」，所以跳过不扣分、不影响奖励。
   */
  const skipVoiceQuestion = () => finishVoiceQuestion(false);

  // 第 1 轮语音题：点一下开始录、再点一下结束。
  // 原来是「按住说话、松开结束」，孩子习惯轻点，松手时 prepareToRecordAsync 还没完成，
  // 于是每次都被判「录音太短、录不上」——改为点按切换后不再依赖按住不放。
  const toggleQaRecordRound1 = () => {
    if (isRecording) {
      handleVoiceRecord();
    } else {
      // 手指按到录音键：立刻停掉正在播放的提示音，否则无法录音（Issue 4）
      stopStory();
      qaAutoStop.current = handleVoiceRecord;
      startQaRecording();
    }
  };

  // 第 2 轮自由提问：结束录音 → 转文字回填输入框
  const finishChildRecording = async () => {
    setIsRecording(false);
    await stopQaRecording();
    const durSec = (recEndTs.current - recStartTs.current) / 1000;
    // 个别机型 stop() 返回时 uri 还没写回：等一下再读，避免误报「没录上」
    let uri = audioRecorder.uri ?? null;
    if (!uri) {
      await new Promise((r) => setTimeout(r, 220));
      uri = audioRecorder.uri ?? null;
    }
    let text = '';
    if (uri && durSec >= 0.6) {
      setTranscribing(true);
      text = (await transcribeAudio(uri)) ?? '';
      setTranscribing(false);
    }
    if (text && text.trim()) {
      setChildQuestion(text.trim());
      return;
    }
    if (childQuestion.trim()) return; // 已经手输入过问题，保留原文不打断
    const tooShort = pickPhrase('voiceTooShort', displayLang);
    setQaFeedback(tooShort);
    speakWithBestVoice(tooShort, displayLang);
    setTimeout(() => setQaFeedback(''), 1600);
  };

  const toggleQaRecordRound2 = () => {
    if (isRecording) {
      finishChildRecording();
    } else {
      // 手指按到录音键：立刻停掉正在播放的提示音（Issue 4）
      stopStory();
      qaAutoStop.current = finishChildRecording;
      startQaRecording();
    }
  };

  /**
   * 让答案文字与语音「几乎同时出现」：
   * 优先在语音真正出声（onStart）时显示文字；但最多只等 1.5 秒——
   * 提示音缓存命中的情况几乎瞬时，等不到的（网络抖动）立刻先显示文字，
   * 不能让孩子干等（v92：提示音与界面的联动不能过长）。
   */
  const revealAnswerWithVoice = (text: string) =>
    new Promise<void>((resolve) => {
      let done = false;
      const reveal = () => {
        if (done) return;
        done = true;
        if (aliveRef.current) setAiAnswer(text);
        resolve();
      };
      speakWithBestVoice(text, displayLang, { onStart: reveal }).catch(() => {});
      setTimeout(reveal, 1500);
    });

  const handleChildQuestion = async () => {
    if (!childQuestion.trim() || isAsking) return;
    setIsAsking(true);
    setAiAskError(false);
    // 立即给一个「我在听」的即时反馈（克隆声、缓存命中即秒出），
    // 避免孩子问完要等好几秒 AI 才回、还以为没反应
    speakPhrase('thinking', displayLang);
    try {
      // 第一个参数是故事正文（作为回答依据），第二个才是孩子的问题，
      // 第三个是界面语言——强制 AI 用同一语言作答（v81：英文提问曾被答成中文）
      const answer = await askQuestion(storyText, childQuestion, displayLang);
      const finalAnswer = answer && answer.trim() ? answer : t('story.qa.unknown');
      // 记录第2轮自由提问，供「完成」页回显
      setChildQaLog((prev) => [...prev, { q: childQuestion.trim(), a: finalAnswer }]);
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
      // 文字与语音同步：语音真正起播的那一刻才把答案显示出来（最多等 8 秒兜底），
      // 否则会出现「文字很快出现、声音几秒后才来」的时差。
      await revealAnswerWithVoice(finalAnswer);
    } catch {
      setAiAskError(true);
      const fallback = t('story.qa.unknown');
      setAiAnswer(fallback);
      // 记录第2轮自由提问（含失败兜底），供「完成」页回显
      setChildQaLog((prev) => [...prev, { q: childQuestion.trim(), a: fallback }]);
      if (aliveRef.current) {
        speakWithBestVoice(fallback, displayLang);
      }
    }
    setIsAsking(false);
  };

  const resetChildQuestion = () => {
    setChildQuestion('');
    setAiAnswer('');
    setAiAskError(false);
  };

  // 提问环节真实录音：点一下开始（toggleQaRecordRound1/2 调用），再点一下结束
  const startQaRecording = async () => {
    // 启动中 / 已在录：忽略重复点击，避免开了两路录音
    if (qaStarting.current || recReady.current) return;
    qaStarting.current = true;
    recReady.current = false;
    recStartPromise.current = (async () => {
      /**
       * v84 反馈 #2：第一次录音总是不成功、第二次就好（"其实操作上区别不大"）。
       * ---------------------------------------------------------------------
       * 根因是音频会话还没从上一段提示音的 playback 切到 playAndRecord，
       * 就立刻 prepareToRecordAsync()：录音器起来了，但实际一点声音都没采到，
       * 于是第一次转文字是空的（表现为"没录上"）；第二次因为会话已经待在录音态，
       * 同样的操作就正常了。
       * 现在改三步：① 先把在播的声音停干净；② 显式切录音会话并留一小段静默让它落定；
       * ③ 起录失败自动重试一次（会话切换偶尔会被系统拖慢）。
       */
      const begin = async () => {
        // 手指按到录音键：立刻停掉正在播放的提示音，否则录不到音（Issue 4）
        stopStory();
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        // 会话切换不是瞬时的：不等这一下，第一次录音几乎必然采不到音
        await new Promise((r) => setTimeout(r, 220));
        await audioRecorder.prepareToRecordAsync();
        await audioRecorder.record();
      };

      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('story.micPermTitle'), t('story.micPermMsg'));
          return;
        }
        try {
          await begin();
        } catch (firstErr) {
          console.warn('[story] 提问录音首次起录失败，重试一次:', firstErr);
          // 记录器可能停在半启动状态：先尝试收尾（没在录时 stop 会抛，忽略），再重来
          try {
            await audioRecorder.stop();
          } catch {
            /* 忽略 */
          }
          await new Promise((r) => setTimeout(r, 320));
          await begin();
        }
        recReady.current = true;
        recStartTs.current = Date.now();
        setIsRecording(true);
        // 开始计时：界面显示「3s」，到 QA_MAX_REC_SEC 自动结束
        setQaRecSec(0);
        if (qaRecTimer.current) clearInterval(qaRecTimer.current);
        qaRecTimer.current = setInterval(() => {
          const s = Math.floor((Date.now() - recStartTs.current) / 1000);
          setQaRecSec(s);
          if (s >= QA_MAX_REC_SEC) {
            if (qaRecTimer.current) {
              clearInterval(qaRecTimer.current);
              qaRecTimer.current = null;
            }
            qaAutoStop.current?.();
          }
        }, 500);
      } catch (err: any) {
        console.error('[story] 提问录音开始失败:', err);
        Alert.alert(t('story.recFailTitle'), err?.message ?? t('story.unknownErr'));
        recReady.current = false;
      } finally {
        qaStarting.current = false;
      }
    })();
  };

  const stopQaRecording = async () => {
    if (qaRecTimer.current) {
      clearInterval(qaRecTimer.current);
      qaRecTimer.current = null;
    }
    setQaRecSec(0);
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
      // 录音没真正开始：把终点对齐到起点，避免用上一次的旧时间戳算出奇怪的时长
      recEndTs.current = recStartTs.current;
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
    // 声线名不再取 VOICES 里的中文字面量（英文模式下会露出中文），改用 i18n 键
    const progressWidth = `${progress}%` as DimensionValue;
    /**
     * 故事总时长（秒）：优先真实音频时长，其次故事自带 duration。
     * duration 缺失（老录音、异常数据）时按正文长度估一个，不要显示「故事约 0:00」。
     */
    const storyDurSec = story?.duration || 0;
    const estimatedSec =
      storyDurSec > 0
        ? storyDurSec
        : Math.max(
            60,
            Math.round(
              (displayLang === 'en'
                ? (story?.contentEn || story?.content || '').length / 12
                : (story?.content || '').length / 4),
            ),
          );
    const totalStorySec = Math.round(
      (lastTotalDuration.current || estimatedSec * 1000) / 1000,
    );
    // 播放中 / 暂停中（有进度）都显示「还剩 X」，暂停时数字自然停住不动；
    // 还没开始听则显示「故事约 X」。
    const showRemain = isPlaying || preparing || progress > 0;
    const timeLabel = showRemain
      ? uiLang === 'en'
        ? `${formatClock(remainSec)} left`
        : `还剩 ${formatClock(remainSec)}`
      : uiLang === 'en'
      ? `About ${formatClock(totalStorySec)}`
      : `故事约 ${formatClock(totalStorySec)}`;
    
    return (
      <CartoonScreen gradient="day" decor>
        <View style={[styles.container, isLandscape && styles.containerL]}>
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
        <View style={[styles.headerRow, isLandscape && styles.headerRowL]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={[styles.title, isLandscape && styles.titleL]}>{storyTitle || t('story.defaultTitle')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={[styles.storyScroll, isLandscape && styles.storyScrollL]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.storyText, isLandscape && styles.storyTextL]}>
            {storyText || t('story.contentLoading')}
          </Text>
        </ScrollView>

        <View
          style={[styles.progressBar, isLandscape && styles.progressBarL]}
          onLayout={(e) => { barLayout.current.width = e.nativeEvent.layout.width; }}
          {...progressPan.panHandlers}
        >
          <View style={{ ...styles.progressFill, width: progressWidth }} />
        </View>
        {seekToast ? <Text style={styles.seekToast}>{seekToast}</Text> : null}

        <SoundWave playing={isPlaying} compact={isLandscape} />

        {preparing ? (
          <View style={styles.preparingRow}>
            <ActivityIndicator size="small" color="#FF8A65" />
            <Text style={styles.preparingText}>
              {uiLang === 'en' ? 'Preparing the voice…' : '正在准备声音，马上开始…'}
            </Text>
          </View>
        ) : null}

        {/*
          播放控制区：主次分明。
          中间「播放 / 暂停」是核心操作，放大到 84pt（原 56pt 的 1.5 倍）；
          左右快退 / 快进缩小到 48pt，退成辅助位，孩子一眼知道该按哪个。
          原来播放、暂停、停止三个按钮同尺寸横排，视觉上不分主次，
          且快进快退在另一行，操作时要来回找。
        */}
        {/* 控制区容器：竖屏上下两段（大圆钮 + 停止），横屏并成一行，把高度让给正文 */}
        <View style={[styles.controlZone, isLandscape && styles.controlZoneL]}>
        <View style={[styles.controls, isLandscape && styles.controlsL]}>
          <TouchableOpacity
            style={[styles.seekControl, isLandscape && styles.seekControlL]}
            onPress={() => handleSeekBy(-15)}
            activeOpacity={0.8}
          >
            <Text style={styles.seekControlIcon}>⏪</Text>
            <Text style={styles.seekControlLabel}>15</Text>
          </TouchableOpacity>

          <Animated.View style={{ transform: [{ scale: playPulse }] }}>
            <TouchableOpacity
              style={[styles.playBtn, isLandscape && styles.playBtnL, isPlaying && styles.playBtnActive]}
              onPress={() => {
                if (isPlaying) {
                  handlePause();
                  return;
                }
                if (cloudPausedRef.current && clonedPlayingRef.current) {
                  handleResume();
                  return;
                }
                handlePlay();
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.playIcon}>{isPlaying ? '⏸️' : '▶️'}</Text>
            </TouchableOpacity>
          </Animated.View>

          <TouchableOpacity
            style={[styles.seekControl, isLandscape && styles.seekControlL]}
            onPress={() => handleSeekBy(15)}
            activeOpacity={0.8}
          >
            <Text style={styles.seekControlIcon}>⏩</Text>
            <Text style={styles.seekControlLabel}>15</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.stopRow, isLandscape && styles.stopRowL]}>
          <TouchableOpacity style={styles.stopBtn} onPress={handleStop} activeOpacity={0.8}>
            <Text style={styles.stopBtnText}>
              ⏹️ {uiLang === 'en' ? 'Stop' : '停止播放'}
            </Text>
          </TouchableOpacity>
        </View>
        </View>

        {resumeSec > 0 && !isPlaying ? (
          <View style={[styles.resumeRow, isLandscape && styles.resumeRowL]}>
            <Text style={styles.resumeText}>
              {uiLang === 'en'
                ? `Last time stopped at ${formatClock(resumeSec)} — tap ▶ to continue`
                : `上次听到 ${formatClock(resumeSec)}，点 ▶ 接着听`}
            </Text>
            <TouchableOpacity onPress={handlePlayFromStart}>
              <Text style={styles.resumeReset}>
                {uiLang === 'en' ? 'Start over' : '从头听'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/*
          v95 反馈 #1：这里原来显示的是睡眠定时的剩余（家长端设了 15 分钟就是 😴 15:00），
          孩子和家长都以为是「这个故事要讲 15 分钟」。现在拆成两件事：
            ① 常显 = 这个故事还剩多久（跟着播放/暂停走）；
            ② 睡眠定时只在最后 5 分钟才出来，且写明「后自动停止」。
        */}
        <View style={[styles.storyTimeRow, isLandscape && styles.storyTimeRowL]}>
          <Text style={styles.storyTimeText}>⏳ {timeLabel}</Text>
        </View>

        {sleepRemaining > 0 && sleepRemaining <= 5 * 60 * 1000 ? (
          <View style={[styles.sleepBadge, isLandscape && styles.sleepBadgeL]}>
            <Text style={styles.sleepBadgeText}>
              😴 {formatSleep(sleepRemaining)}
              {uiLang === 'en' ? ' until auto-stop' : ' 后自动停止播放'}
            </Text>
          </View>
        ) : null}

        {/*
          v82 反馈 #4：原来这里把「想让谁来讲」+ 4 个声线大按钮 + 当前音色说明
          全部常驻，在 iPhone 上吃掉近三分之一屏幕，故事正文只剩一小条缝，孩子看不见。
          现在压成一行「当前声音」条，点开才弹出底部的选择面板。
          不识字的孩子也能认：左边耳朵图标 + 右边「换声音」＋下拉箭头，点了就有面板。
        */}
        <TouchableOpacity
          style={[styles.voiceBar, isLandscape && styles.voiceBarL]}
          onPress={() => setVoiceSheetOpen(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.voiceBarIcon}>
            {selectedVoice === 'system' ? '📱' : voiceIsCloned ? '🎙' : '🔊'}
          </Text>
          <Text style={styles.voiceBarText} numberOfLines={1}>
            {selectedVoice === 'system'
              ? uiLang === 'en'
                ? 'Phone voice (offline)'
                : '手机自带语音（离线）'
              : voiceIsCloned
              ? uiLang === 'en'
                ? `${voiceDisplayName(selectedVoice, 'en')}'s cloned voice`
                : `「${voiceDisplayName(selectedVoice, 'zh')}」的克隆声音`
              : uiLang === 'en'
              ? `Story voice: ${voiceDisplayName(selectedVoice, 'en')}`
              : `朗读声音：${voiceDisplayName(selectedVoice, 'zh')}`}
          </Text>
          <Text style={styles.voiceBarAction}>
            {uiLang === 'en' ? 'Change' : '换声音'} ▾
          </Text>
        </TouchableOpacity>

        <View style={styles.raccoCorner}>
          <Racco state="talking" size={60} />
        </View>
      </View>

      {/*
        v82 反馈 #4：声线选择弹层。
        底部滑出、只占屏幕下半部分，故事正文始终完整可见；
        每个声线一行大字（emoji + 名称），不识字的孩子也能靠图标辨认。
      */}
      <Modal
        visible={voiceSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setVoiceSheetOpen(false)}
        statusBarTranslucent
        /* 横屏下弹声线面板不能把屏幕掰回竖屏（同故事库筛选弹层） */
        supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setVoiceSheetOpen(false)}>
          <Pressable style={styles.sheetCard} onPress={() => { /* 吞掉点击，避免穿透关闭 */ }}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {uiLang === 'en' ? 'Who should read the story?' : '想让谁来讲故事？'}
            </Text>
            <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
              {voiceOptions.map((v) => {
                const active = v.id === selectedVoice;
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[styles.sheetRow, active && styles.sheetRowActive]}
                    onPress={() => {
                      setVoiceSheetOpen(false);
                      pickVoice(v.id);
                    }}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.sheetRowEmoji}>{v.emoji}</Text>
                    <Text style={[styles.sheetRowText, active && styles.sheetRowTextActive]}>
                      {uiLang === 'en' ? v.nameEn : v.nameZh}
                    </Text>
                    {active ? <Text style={styles.sheetRowCheck}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.sheetHint}>
              {uiLang === 'en'
                ? 'Changes apply right away, from where you are now.'
                : '选完立刻生效，从当前听的位置接着讲。'}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
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
          {/* v96：奖励改成答完 3 个问题才给，这里先把「奖励在后头」讲清楚，
              孩子知道答题不是白答的，也避免家长以为奖励丢了 */}
          <Text style={styles.completedHint}>{t('story.completed.rewardHint')}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => { setQaIndex(0); setQaLoading(true); setPhase('qa_round1'); generateQuestions(); }}>
            <Text style={styles.primaryBtnText}>{t('story.completed.enterQa')}</Text>
          </TouchableOpacity>
        </View>
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
            <TouchableOpacity style={styles.sleepBtn} onPress={() => { setScreenOff(false); setPhase('playing'); }}>
              <Text style={styles.sleepBtnText}>{t('sleep.locked.continue')}</Text>
            </TouchableOpacity>
          )}
        </View>
        {/* 到点关屏：纯黑遮罩 +（外面已释放常亮）让系统尽快熄屏。
            轻点任意处回到月亮页，家长可解锁或继续。 */}
        {screenOff ? (
          <Pressable style={styles.screenOffOverlay} onPress={() => setScreenOff(false)} />
        ) : null}
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
            <Text style={styles.qaLoadingText}>{t('story.qa.preparing')}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.qaQuestion}>{q.question}</Text>

            {q.type === 'choice' && (
              <View style={styles.optionsWrap}>
                {q.options.map((opt, i) => (
                  <TouchableOpacity key={i} style={styles.optionCard} onPress={() => handleChoiceAnswer(i)}>
                    <ClayIcon name="button" size={40} style={styles.optionClay} />
                    <Text style={styles.optionText}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {q.type === 'voice' && (
              voiceClipUri ? (
                /* 录完了：听一遍 / 重录 / 确认进入下一题 */
                <View style={styles.voiceConfirmWrap}>
                  <Text style={styles.voiceConfirmHint}>{t('story.qa.confirmHint')}</Text>
                  {/* v91 #2：把孩子的回答转成文字显示出来（不识字也能让大人念给他听） */}
                  {qaAnswerText ? (
                    <Text style={styles.voiceHeardText}>🗣 {qaAnswerText}</Text>
                  ) : null}
                  <View style={styles.voiceMiniRow}>
                    <TouchableOpacity style={styles.voiceMiniBtn} onPress={playVoiceClip}>
                      <Text style={styles.voiceMiniText}>
                        {voicePlaying ? `⏸ ${t('story.qa.stopPlay')}` : `▶ ${t('story.qa.listenMine')}`}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.voiceMiniBtn} onPress={retakeVoice}>
                      <Text style={styles.voiceMiniText}>🎤 {t('story.qa.retake')}</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.voiceConfirmBtn} onPress={confirmVoiceAnswer}>
                    <Text style={styles.voiceConfirmText}>✅ {t('story.qa.confirmNext')}</Text>
                  </TouchableOpacity>
                  {/* 录完仍可再听一遍题目（v91 #2：语音不能被"录完"挡住） */}
                  <TouchableOpacity style={styles.replayQBtn} onPress={replayQuestion}>
                    <Text style={styles.replayQText}>🔊 {t('story.qa.replayQuestion')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Animated.View style={[styles.micRing, { transform: [{ scale: micPulse }] }]} pointerEvents="none" />
                  <TouchableOpacity
                    style={[isRecording ? styles.micFabActive : styles.micFab, { transform: [{ scale: micPulse }] }]}
                    onPress={toggleQaRecordRound1}
                  >
                    {isRecording ? (
                      <Text style={styles.micSecText}>{qaRecSec}s</Text>
                    ) : (
                      <ClayIcon name="mic" size={54} />
                    )}
                    <Text style={styles.micLabel}>
                      {isRecording ? t('story.qa.tapToStop') : t('story.qa.tapToTalk')}
                    </Text>
                  </TouchableOpacity>
                  {/* 没听清题目：随时再听一遍，不用等下一题 */}
                  {!isRecording && (
                    <TouchableOpacity style={styles.replayQBtn} onPress={replayQuestion}>
                      <Text style={styles.replayQText}>🔊 {t('story.qa.replayQuestion')}</Text>
                    </TouchableOpacity>
                  )}
                  {/* 不想说 / 录不上：也能往下走，不让孩子卡在这一题、拿不到奖励 */}
                  {!isRecording && (
                    <TouchableOpacity style={styles.skipQBtn} onPress={skipVoiceQuestion}>
                      <Text style={styles.skipQText}>{t('story.qa.skipVoice')}</Text>
                    </TouchableOpacity>
                  )}
                </>
              )
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
            <Text style={styles.qaLoadingText}>{t('story.qa.thinking2')}</Text>
          </View>
        ) : null}

        {aiAnswer ? (
          <View style={styles.aiAnswerWrap}>
            <Text style={styles.aiAnswerLabel}>{t('story.qa.youAsked')}</Text>
            <Text style={styles.aiAnswerQuestion}>{childQuestion.trim()}</Text>
            <Text style={styles.aiAnswer}>🤖 {aiAnswer}</Text>
          </View>
        ) : null}

        {aiAskError ? (
          <View style={styles.aiAnswerWrap}>
            <Text style={styles.aiAnswer}>{t('story.qa.aiOffline')}</Text>
          </View>
        ) : null}

        {(aiAnswer || aiAskError) ? (
          <TouchableOpacity style={styles.askBtn} onPress={resetChildQuestion}>
            <Text style={styles.askBtnText}>{t('story.qa.askAgain')}</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={styles.primaryBtn2} onPress={() => { Keyboard.dismiss(); stopStory(); setPhase('finished'); }}>
          <Text style={styles.primaryBtnText}>✅ {t('story.qa.finish')}</Text>
        </TouchableOpacity>
      </ScrollView>
      {/* 右下角悬浮大圆钮：点一下开始说、再点一下结束（不识字也能看懂秒数在走） */}
      <Animated.View style={[styles.micRing, { transform: [{ scale: micPulse }] }]} pointerEvents="none" />
      <TouchableOpacity
        style={[isRecording ? styles.micFabActive : styles.micFab, { transform: [{ scale: micPulse }] }]}
        onPress={toggleQaRecordRound2}
      >
        {isRecording ? (
                      <Text style={styles.micSecText}>{qaRecSec}s</Text>
                    ) : (
                      <ClayIcon name="mic" size={54} />
                    )}
        <Text style={styles.micLabel}>
          {isRecording ? t('story.qa.tapToStop') : t('story.qa.tapToTalk')}
        </Text>
      </TouchableOpacity>
      </View>

      {/* 答完 3 个问题后，奖励动画在这里出现（升级 / 新勋章） */}
      {rewardOverlay}
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
        <Animated.View style={[styles.parentCommentCard, { opacity: commentOpacity, transform: [{ scale: commentScale }] }]}>
          <View style={styles.parentCommentTail} />
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
    </View>
    {/* 万一孩子手快直接点到「晚安」页，奖励动画也跟着过来，不会白答 */}
    {rewardOverlay}
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
  loadingText: { fontSize: 16, color: '#A8988A', marginTop: 16 },
  errorText: { fontSize: 18, color: '#c00', marginBottom: 20 },
  backBtn: { padding: 8 },
  backBtnText: { fontSize: 24, color: '#3D3229' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headerSpacer: { width: 40 },

  title: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', color: '#3D3229', flex: 1 },
  storyScroll: { flex: 1, borderRadius: 22, backgroundColor: '#FFFDF7', padding: 20 },
  /**
   * iPad 横屏下整行能到 1300pt 宽，一行字太长很难读。
   * 这里给正文一个阅读宽度上限并居中 —— 手机上仍是满宽。
   */
  storyText: {
    fontSize: 18,
    lineHeight: 30,
    color: '#3D3229',
    width: '100%',
    maxWidth: 780,
    alignSelf: 'center',
  },
  progressBar: { height: 8, backgroundColor: '#E0D5C7', borderRadius: 4, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#F7A072', borderRadius: 4 },
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
  // ── 播放控制区：主按钮 84pt / 次按钮 48pt，主次差 1.75 倍 ──
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 30,
    marginTop: 18,
  },
  // 核心：播放 / 暂停。原 56pt → 84pt（+50%），投影更重，一眼就是"主操作"
  playBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#EE8B5E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: '#E07B4F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  // 播放中：更饱和的实心色 + 暖色光晕，直观表示「正在播放」
  playBtnActive: {
    backgroundColor: '#FF6F3C',
    borderColor: '#FFE0CC',
    shadowOpacity: 0.6,
    shadowRadius: 22,
    elevation: 10,
  },
  playIcon: { fontSize: 36 },
  // 辅助：快退 / 快进 15 秒。原 56pt → 48pt，退成配角
  seekControl: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FFE0CC',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 1,
  },
  seekControlIcon: { fontSize: 18 },
  seekControlLabel: { fontSize: 9, color: '#A8988A', marginTop: -2 },
  // 停止：降级为文字按钮，不与播放抢视线
  stopRow: { alignItems: 'center', marginTop: 10 },
  stopBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  stopBtnText: { fontSize: 13, color: '#8A7B6E' },
  // 断点提示（v62 反馈 #2）：上次听到哪、可一键从头听
  resumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  resumeText: { fontSize: 13, color: '#8A7B6E' },
  resumeReset: { fontSize: 13, color: '#E07B4F', fontWeight: '700' },
  preparingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  preparingText: { fontSize: 14, color: '#7A6A5D', fontWeight: '600' },
  voiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 4 },
  voiceLabel: { fontSize: 14, color: '#3D3229' },
  voiceToggle: { fontSize: 14, color: '#F7A072', fontWeight: '600' },
  voicePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  voiceOption: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, backgroundColor: '#FFF' },
  voiceOptionActive: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, backgroundColor: '#F7A072' },
  voiceOptionText: { fontSize: 13, color: '#3D3229' },

  /* 孩子端「想让谁来讲」：常显大按钮，选中态用品牌橙 + 白字 */
  voiceBlock: { marginTop: 14, paddingHorizontal: 4 },
  voicePickLabel: { fontSize: 14, color: '#3D3229', fontWeight: '700', marginBottom: 8 },
  voiceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  voiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FFE0B2',
    elevation: 1,
  },
  voiceChipActive: { backgroundColor: '#F7A072', borderColor: '#F7A072' },
  voiceChipText: { fontSize: 15, color: '#3D3229', fontWeight: '600' },
  voiceChipTextActive: { color: '#FFFFFF' },
  // v80 #3：当前实际发音的音色名（"现在是 Cherry（大姐姐）的声音"）
  voiceNow: { fontSize: 13, color: '#8A6D5B', marginTop: 10, lineHeight: 18 },

  /* v82 #4：一行式「当前声音」条，替代原来占掉三分之一屏的声线按钮墙 */
  voiceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FFE0B2',
    elevation: 1,
  },
  /**
   * ── 横屏紧凑尺寸（v96 反馈 #3）─────────────────────────────────────────
   * 手机横放 / iPad 横屏的有效高度只有 300 出头。原来「头部 44 + 波形 56 + 84pt 播放键
   * + 停止 + 时间条 + 声音条」占掉大半，正文只剩一条缝（孩子只能看到一行字）。
   * 横屏统一收小操作区，把省下来的高度全给正文，同时**放大字号**方便阅读。
   */
  containerL: { padding: 10 },
  controlZone: { marginTop: 0 },
  /** 横屏：快退 / 播放 / 快进 / 停止并成一行，省下约 30pt 给正文 */
  controlZoneL: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  headerRowL: { marginBottom: 4 },
  titleL: { fontSize: 17 },
  storyScrollL: { padding: 12, borderRadius: 14 },
  storyTextL: { fontSize: 21, lineHeight: 34, maxWidth: 1000 },
  progressBarL: { height: 6, marginTop: 4 },
  waveWrapCompact: { height: 22, marginTop: 2, gap: 4 },
  waveBarCompact: { width: 5, height: 18 },
  controlsL: { marginTop: 6, gap: 22 },
  playBtnL: { width: 58, height: 58, borderRadius: 29, borderWidth: 3 },
  seekControlL: { width: 40, height: 40, borderRadius: 20 },
  stopRowL: { marginTop: 0 },
  resumeRowL: { marginTop: 4 },
  storyTimeRowL: { marginTop: 3, paddingVertical: 2, paddingHorizontal: 12 },
  sleepBadgeL: { marginTop: 3, paddingVertical: 3 },
  voiceBarL: { marginTop: 4, paddingVertical: 5, alignSelf: 'center' },
  voiceBarIcon: { fontSize: 17 },
  voiceBarText: { flex: 1, fontSize: 14, color: '#3D3229', fontWeight: '600' },
  voiceBarAction: { fontSize: 13, color: '#F7A072', fontWeight: '700' },

  /* v82 #4：声线选择底部弹层（只占下半屏，故事正文始终可见） */
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(40,28,20,0.45)', justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: '#FFF9F2',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '68%',
  },
  sheetHandle: {
    alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
    backgroundColor: '#E6D8C8', marginBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#3D3229', textAlign: 'center', marginBottom: 14 },
  sheetList: { maxHeight: 360 },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 15, paddingHorizontal: 16, borderRadius: 18,
    backgroundColor: '#FFFFFF', marginBottom: 10, borderWidth: 1.5, borderColor: '#F0E4D6',
  },
  sheetRowActive: { backgroundColor: '#FFF0E2', borderColor: '#F7A072' },
  sheetRowEmoji: { fontSize: 20 },
  sheetRowText: { flex: 1, fontSize: 17, color: '#3D3229', fontWeight: '600' },
  sheetRowTextActive: { color: '#E07B4F' },
  sheetRowCheck: { fontSize: 18, color: '#F7A072', fontWeight: '800' },
  sheetHint: { fontSize: 12, color: '#8A7B6E', textAlign: 'center', marginTop: 4 },
  raccoCorner: { position: 'absolute', bottom: 20, right: 20 },

  completedText: { fontSize: 24, fontWeight: 'bold', color: '#3D3229', marginTop: 20, marginBottom: 8 },
  /** 完成页的「答题得奖励」提示：弱化处理，别抢主标题 */
  completedHint: {
    fontSize: 14,
    color: '#A8988A',
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 20,
    marginBottom: 20,
  },

  qaRoundTitle: { fontSize: 20, fontWeight: 'bold', color: '#3D3229', textAlign: 'center', marginTop: 20, marginBottom: 16 },
  qaQuestion: { fontSize: 18, color: '#3D3229', textAlign: 'center', marginBottom: 24, lineHeight: 28 },
  optionsWrap: { gap: 16, paddingHorizontal: 20 },
  // v79：选项按钮加大（孩子手指好点），左侧配 3D 粘土圆凳做视觉锚点
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFF', borderRadius: 26, paddingVertical: 30, paddingHorizontal: 22,
    elevation: 3, borderWidth: 2, borderColor: '#FFE0B2',
  },
  optionClay: { marginTop: 2 },
  optionText: { flex: 1, fontSize: 19, color: '#3D3229', fontWeight: '600', lineHeight: 27 },
  voiceRecordWrap: { alignItems: 'center', marginTop: 10 },
  // 右下角悬浮大圆钮：方便右手按住说话（替代原先顶部居中）
  micFab: {
    position: 'absolute', bottom: 24, right: 20, width: 112, height: 112, borderRadius: 56,
    backgroundColor: '#FFF6EE', justifyContent: 'center', alignItems: 'center', elevation: 8,
    borderWidth: 3, borderColor: '#FFD9C0',
    zIndex: 20, shadowColor: '#C98B6B', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
  },
  micFabActive: {
    position: 'absolute', bottom: 24, right: 20, width: 112, height: 112, borderRadius: 56,
    backgroundColor: '#F7A072', justifyContent: 'center', alignItems: 'center', elevation: 8,
    borderWidth: 3, borderColor: '#EF8B57',
    zIndex: 20, shadowColor: '#C98B6B', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 5 },
  },
  // 麦克风外圈脉冲光环（录音时随 micPulse 呼吸），让不识字的孩子也能看到「在录」
  micRing: {
    position: 'absolute', bottom: 16, right: 12, width: 128, height: 128, borderRadius: 64,
    borderWidth: 3, borderColor: 'rgba(247,160,114,0.5)', zIndex: 19,
  },
  micIcon: { fontSize: 32 },
  micSecText: { fontSize: 26, fontWeight: '800', color: '#FFFFFF' },
  micLabel: { fontSize: 12, color: '#7A5B47', marginTop: 4, fontWeight: '700' },

  // ── 录音完成后的「确认」区（2026-11-01）──────────────────────────
  // 孩子录完先停在这里：能听回自己的声音、能重录，点大按钮才进下一题。
  voiceConfirmWrap: { alignItems: 'center', marginTop: 24, paddingHorizontal: 12 },
  voiceConfirmHint: {
    fontSize: 17, color: '#3D3229', textAlign: 'center', lineHeight: 26, marginBottom: 18,
  },
  // 语音转文字结果：孩子刚说的话（v91 #2）
  voiceHeardText: {
    fontSize: 16,
    color: '#6B5B4E',
    textAlign: 'center',
    lineHeight: 24,
    marginTop: -8,
    marginBottom: 16,
    paddingHorizontal: 8,
    fontStyle: 'italic',
  },
  voiceMiniRow: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  voiceMiniBtn: {
    backgroundColor: '#FFFFFF', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 20,
    borderWidth: 2, borderColor: '#E7DCCF', elevation: 1,
  },
  voiceMiniText: { fontSize: 15, color: '#3D3229', fontWeight: '700' },
  voiceConfirmBtn: {
    backgroundColor: '#EE8B5E', borderRadius: 30, paddingVertical: 16, paddingHorizontal: 40,
    elevation: 3, shadowColor: '#C97B4E', shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  voiceConfirmText: { fontSize: 19, color: '#3D3229', fontWeight: '800' },
  // 再听一遍题目
  replayQBtn: { marginTop: 18, paddingVertical: 10, paddingHorizontal: 18 },
  replayQText: { fontSize: 14, color: '#9B7EDE', fontWeight: '700' },
  /** 语音题的「跳过这题」：刻意做得比「再听一遍」更淡，不当主按钮抢注意力 */
  skipQBtn: { marginTop: 2, paddingVertical: 8, paddingHorizontal: 18 },
  skipQText: { fontSize: 13, color: '#B9AFA4', fontWeight: '600' },
  feedbackText: { fontSize: 20, color: '#F7A072', fontWeight: 'bold', textAlign: 'center', marginTop: 24 },
  qaLoadingWrap: { alignItems: 'center', marginTop: 40 },
  qaLoadingText: { fontSize: 15, color: '#A8988A', marginTop: 16 },

  primaryBtn: {
    backgroundColor: '#EE8B5E', borderRadius: 30, paddingVertical: 16, paddingHorizontal: 40,
    elevation: 2, marginTop: 10,
  },
  primaryBtn2: {
    backgroundColor: '#EE8B5E', borderRadius: 30, paddingVertical: 18, paddingHorizontal: 52,
    elevation: 2, marginTop: 24, alignSelf: 'center',
  },
  primaryBtnText: { fontSize: 18, fontWeight: 'bold', color: '#3D3229' },

  childQWrap: { marginTop: 16, backgroundColor: '#FFF', borderRadius: 22, padding: 16 },
  childQ: { fontSize: 16, color: '#3D3229', marginBottom: 12 },
  childQInput: {
    marginTop: 16, borderWidth: 1, borderColor: '#FFE0B2', borderRadius: 22,
    backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, color: '#3D3229', textAlignVertical: 'top', minHeight: 60,
  },
  askBtn: {
    backgroundColor: '#9B7EDE', borderRadius: 26, paddingVertical: 14, paddingHorizontal: 34,
    alignSelf: 'center', marginTop: 12,
  },
  askBtnText: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  qaContent: {
    paddingTop: 64,
    paddingHorizontal: 20,
    paddingBottom: 130,
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
  },
  qaRound2Wrap: { flex: 1, position: 'relative' },
  seekToast: { textAlign: 'center', color: '#fff', backgroundColor: 'rgba(108,92,231,0.92)', fontSize: 13, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 22, marginTop: 10, alignSelf: 'center' },
  aiAnswerWrap: { marginTop: 16, backgroundColor: '#F3E5F5', borderRadius: 22, padding: 16 },
  aiAnswer: { fontSize: 15, color: '#4A148C', lineHeight: 24 },
  aiAnswerLabel: { fontSize: 13, color: '#8E6FB0', fontWeight: '600', marginBottom: 4 },
  aiAnswerQuestion: { fontSize: 15, color: '#4A148C', fontWeight: '700', marginBottom: 10, lineHeight: 22 },

  finishedText: { fontSize: 22, fontWeight: 'bold', color: '#3D3229', marginTop: 16, marginBottom: 32 },
  finishedBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 26, paddingVertical: 16, paddingHorizontal: 28, marginBottom: 12,
    elevation: 1, minWidth: 220, justifyContent: 'center',
  },
  finishedBtnDisabled: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF',
    borderRadius: 26, paddingVertical: 16, paddingHorizontal: 28, marginBottom: 12,
    elevation: 1, minWidth: 220, justifyContent: 'center',
    opacity: 0.5,
  },
  finishedBtnIcon: { fontSize: 20, marginRight: 10 },
  finishedBtnText: { fontSize: 15, color: '#3D3229', fontWeight: '600' },
  parentCommentCard: {
    backgroundColor: '#FFF8E1',
    borderRadius: 26,
    padding: 18,
    paddingTop: 22,
    marginBottom: 20,
    maxWidth: 320,
    borderWidth: 2,
    borderColor: '#FFCC80',
    alignItems: 'center',
    // 卡通对话框：暖黄底色 + 橙色描边 + 柔光投影
    boxShadow: '0 6px 18px rgba(245, 124, 0, 0.22)',
    elevation: 6,
  },
  // 对话气泡小尾巴（指向小浣熊，强化「悄悄话」的对话感）
  parentCommentTail: {
    position: 'absolute',
    top: -10,
    left: 40,
    width: 22,
    height: 22,
    backgroundColor: '#FFF8E1',
    borderLeftWidth: 2,
    borderTopWidth: 2,
    borderColor: '#FFCC80',
    transform: [{ rotate: '45deg' }],
  },
  parentCommentTitle: { fontSize: 16, fontWeight: 'bold', color: '#F7A072', marginBottom: 8 },
  parentCommentText: { fontSize: 15, color: '#3D3229', lineHeight: 24, textAlign: 'center' },
  // 完成页问答回顾卡片
  qaRecapCard: {
    backgroundColor: '#F1F8E9',
    borderRadius: 24,
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
  storyTimeRow: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  storyTimeText: { fontSize: 14, color: '#6B5B95', fontWeight: '700' },
  sleepBadge: {
    alignSelf: 'center', marginTop: 10, paddingVertical: 6, paddingHorizontal: 16,
    borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.85)',
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
    borderRadius: 26,
  },
  sleepBtnText: { fontSize: 16, fontWeight: '700', color: '#5B4B23' },
  /** 到点关屏：整屏纯黑（轻点返回），配合释放常亮让系统自动熄屏 */
  screenOffOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
  },
});
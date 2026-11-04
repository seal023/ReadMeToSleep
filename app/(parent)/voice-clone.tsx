import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Alert, ActivityIndicator, TextInput, Animated } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import { useLanguage } from '../../hooks/useLanguage';
import { COLORS, FONT } from '@/constants/theme';
import { checkVoiceCloneGate } from '@/services/entitlement';
import { enrollVoice, isVoiceCloneConfigured, getClonedTargets, type VoiceCloneResult, type CloneTarget } from '@/services/voiceClone';
import { warmClonedPhrases, clearClonedPhraseCache } from '@/services/phraseCache';
import { playClonedAudio, getLastCloneError } from '@/services/clonedVoicePlayback';
import { stopStory } from '@/services/playback';
import { saveVoiceSetting, savePromptVoiceSetting, getPromptVoiceSetting } from '@/services/storage';
import { voiceDisplayName } from '@/services/voiceCatalog';

// 固定对象只保留「妈妈 / 爸爸」——这两个是绝大多数家庭的主力声线，一键可选。
// v84：其余家人（外婆、爷爷、奶奶、外公、小姨…）不再写死，统一走「自定义」，
// 由家长自己填称呼，避免出现「想克隆爷爷却没有入口、只能顶着外婆的名字用」。
const PRESET_TARGETS: { key: CloneTarget; labelKey: string; icon: string }[] = [
  { key: 'mom', labelKey: 'vc.mom', icon: '👩' },
  { key: 'dad', labelKey: 'vc.dad', icon: '👨' },
];

/**
 * 历史遗留的固定对象：v83 及更早版本把「外婆」做成了固定按钮，
 * 已经克隆过的设备里存着 key='grandma'。现在不再提供入口，
 * 但它必须仍能显示成「外婆」而不是一串英文 key。
 */
const LEGACY_TARGETS: { key: CloneTarget; labelKey: string; icon: string }[] = [
  { key: 'grandma', labelKey: 'vc.grandma', icon: '👵' },
];

const LABEL_LOOKUP = [...PRESET_TARGETS, ...LEGACY_TARGETS];

/** 把 target key 转成展示名（固定对象取本地化，自定义去掉 'custom:' 前缀） */
function targetLabel(key: CloneTarget, t: (k: string) => string): string {
  if (key.startsWith('custom:')) return key.slice('custom:'.length);
  const preset = LABEL_LOOKUP.find((p) => p.key === key);
  return preset ? t(preset.labelKey) : key;
}

const READ_TEXT_ZH = `从前有座山，山里有座庙。庙里有个老和尚在给小和尚讲故事。讲的什么呢？老和尚对小和尚说："从前有座山，山里有座庙……"小和尚歪着头问："妈妈，这故事的结尾是什么呀？"老和尚笑着说："这就是故事的魅力呀，我们每天都可以从头开始听。"`;
const READ_TEXT_EN = `Once upon a time, there was a little bird who wanted to learn how to sing. Every morning, she would sit on a branch and listen to the old birds sing beautiful songs. "Practice makes perfect," the old bird said kindly. So every day, the little bird opened her beak and tried again and again until one day, she discovered her own wonderful voice.`;

/**
 * 提交克隆后要等 1–2 分钟，底部轮播的诙谐小句子。
 * 只做视觉陪伴（家长在操作，无需朗读），让"干等"变得有温度。
 */
const CLONE_PHRASE_KEYS = [
  'vc.clonePhrase.1',
  'vc.clonePhrase.2',
  'vc.clonePhrase.3',
  'vc.clonePhrase.4',
  'vc.clonePhrase.5',
  'vc.clonePhrase.6',
  'vc.clonePhrase.7',
  'vc.clonePhrase.8',
];
const CLONE_PHRASE_INTERVAL_MS = 3600;

export default function VoiceClonePage() {
  const { t, language } = useLanguage();
  const uiLang: 'zh' | 'en' = language === 'en' ? 'en' : 'zh';
  const [target, setTarget] = useState<CloneTarget>('mom');
  const [step, setStep] = useState<'select' | 'recording' | 'preview' | 'done'>('select');
  const [duration, setDuration] = useState(0);
  // ⚠️ expo-audio 的 AudioRecorder 只能由 useAudioRecorder Hook 创建，
  // 不能用 new AudioRecorder()（那会得到一个方法未初始化、运行期报
  // "undefined is not a function" 的空壳对象）
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [uri, setUri] = useState<string | null>(null);
  const [waveData, setWaveData] = useState<number[]>([]);
  const [cloning, setCloning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [cloneMsg, setCloneMsg] = useState<string | null>(null);
  const [cloneResult, setCloneResult] = useState<VoiceCloneResult | null>(null);
  // v82：克隆成功后要把「朗读声已换、提示音没换」讲清楚，并允许一键把提示音也换成它
  const [promptVoiceId, setPromptVoiceId] = useState('preset:cherry');
  // 克隆等待期间底部轮播的诙谐句子
  const [clonePhraseIdx, setClonePhraseIdx] = useState(0);
  const clonePhraseFade = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStart = useRef(0);

  const router = useRouter();

  // 克隆中：底部小句子每 3.6 秒换一句（等 1–2 分钟时给点陪伴感）
  useEffect(() => {
    if (!cloning) {
      setClonePhraseIdx(0);
      return;
    }
    const id = setInterval(() => {
      setClonePhraseIdx((i) => (i + 1) % CLONE_PHRASE_KEYS.length);
    }, CLONE_PHRASE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [cloning]);

  // 换句时淡入，避免文字"啪"地跳变
  useEffect(() => {
    if (!cloning) return;
    clonePhraseFade.setValue(0.1);
    Animated.timing(clonePhraseFade, {
      toValue: 1,
      duration: 520,
      useNativeDriver: true,
    }).start();
  }, [clonePhraseIdx, cloning, clonePhraseFade]);

  // 克隆成功后试听：用刚克隆出的音色合成一句欢迎语并播放，确认声音真的"像"
  const handlePreview = async () => {
    if (previewing) return;
    setPreviewing(true);
    try {
      const text = t('vc.previewText').replace('{name}', targetLabel(target, t));
      const ok = await playClonedAudio(text, target, () => setPreviewing(false));
      if (!ok) {
        setPreviewing(false);
        // 透出真实失败原因（合成 HTTP 状态/响应内容），便于一步定位，而不是只弹模糊提示
        const detail = getLastCloneError();
        Alert.alert(
          t('vc.previewFailedTitle') || '试听失败',
          detail
            ? `${t('vc.previewFailedMsg')}\n\n${t('vc.diagLabel')}${detail}`
            : (t('vc.previewFailedMsg') ||
                '没能用克隆声播放。常见原因：音色仍在训练（提交后约几分钟），或设备处于静音模式。请稍后重试，或在设置里用系统音试听。')
        );
      }
    } catch {
      setPreviewing(false);
    }
  };
  /** null = 校验中；true = 放行；false = 被拦下 */
  const [gatePassed, setGatePassed] = useState<boolean | null>(null);

  // 自定义克隆对象（target = 'custom:<名称>'）
  const [customName, setCustomName] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customTargets, setCustomTargets] = useState<{ key: CloneTarget; label: string; icon: string }[]>([]);
  /**
   * v100 反馈 #1：已经克隆过的家人要在选择区里明确标出来（妈妈/外婆…），
   * 否则家长看不出「这个声音是不是早就录好了」，容易重复录一遍。
   * 这里存的是本机所有已克隆的 target key（含妈妈/爸爸/自定义）。
   */
  const [clonedKeys, setClonedKeys] = useState<Set<string>>(new Set());
  /**
   * 每次进入本页都重新扫描已克隆对象。
   * v84：家长可能在「声音设置」里把某个声音改名或删掉了，
   * 若只在挂载时扫一次，返回本页还会看到旧的（甚至已删除的）对象。
   */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const all = await getClonedTargets();
        const fixed = new Set(PRESET_TARGETS.map((p) => p.key));
        // 除妈妈/爸爸外，凡本机克隆过的对象都排成一格：
        //   custom:爷爷 → 显示「爷爷」；历史 grandma → 显示「外婆」。
        const extras = all
          .filter((k) => !fixed.has(k))
          .map((k) => ({
            key: k,
            label: k.startsWith('custom:') ? k.slice('custom:'.length) : k,
            icon: LEGACY_TARGETS.find((l) => l.key === k)?.icon || '🧑',
          }));
        if (alive) setCustomTargets(extras);
        if (alive) setClonedKeys(new Set(all));
      })();
      return () => {
        alive = false;
      };
    }, []),
  );
  const confirmCustom = () => {
    const name = customName.trim();
    if (!name) return;
    // 填了「妈妈 / 爸爸」就别再建一个重名对象，直接选中已有的固定项
    const dupFixed = PRESET_TARGETS.find((p) => t(p.labelKey) === name);
    if (dupFixed) {
      setTarget(dupFixed.key);
      setCustomName('');
      setShowCustomInput(false);
      return;
    }
    const key = `custom:${name}`;
    setCustomTargets((prev) =>
      prev.some((c) => c.key === key) ? prev : [...prev, { key, label: name, icon: '🧑' }]
    );
    setTarget(key);
    setCustomName('');
    setShowCustomInput(false);
  };

  // 用 useFocusEffect 而非 useEffect：从订阅页返回时会重新校验，刚买完能立刻使用
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const gate = await checkVoiceCloneGate();
        if (!alive) return;
        if (gate.allowed) {
          setGatePassed(true);
          return;
        }
        setGatePassed(false);
        Alert.alert(gate.title, gate.message, [
          { text: t('common.back'), style: 'cancel', onPress: () => router.back() },
          { text: t('vc.viewPlans'), onPress: () => router.push('/(parent)/subscription') },
        ]);
      })();
      return () => {
        alive = false;
      };
    }, [router])
  );

  const raccoState = step === 'recording' ? 'listening' : step === 'select' ? 'idle' : 'happy';

  useEffect(() => {
    if (step === 'recording') {
      timerStart.current = Date.now();
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - timerStart.current) / 1000));
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step]);

  const generateWaveform = () =>
    Array.from({ length: 40 }, () => Math.random() * 40 + 5);

  const startRecording = async () => {
    try {
      // 录音前先停掉正在响的提示音 / 试听：否则录进去杂音，会话也切不到录音态
      stopStory();
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('vc.recFail'), t('vc.micPerm'));
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        staysActiveInBackground: false,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setStep('recording');
    } catch (err: any) {
      console.error('[voice-clone] Recording error:', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
      });
      Alert.alert(
        t('vc.diag'),
        `name: ${err?.name ?? t('vc.none')}\nmessage: ${err?.message ?? t('vc.none')}\n${
          err?.stack ? String(err.stack).slice(0, 240) : ''
        }`
      );
    }
  };

  const stopRecording = async () => {
    try {
      await audioRecorder.stop();
      const uriPath = audioRecorder.uri;
      setUri(uriPath || null);
      setWaveData(generateWaveform());
    } catch (err) {
      console.error('Stop recording error:', err);
    }
    setStep('preview');
  };

  const handleDone = async () => {
    // 前置拦截：录音过短几乎必然被百炼判为静音，提前给出明确指引
    if (duration > 0 && duration < 5) {
      Alert.alert(t('vc.tooShort'), t('vc.tooShortMsg'));
      return;
    }
    if (uri) {
      setCloning(true);
      setCloneMsg(null);
      const res = await enrollVoice(uri, target);
      setCloning(false);
      setCloneResult(res);
      setCloneMsg(res.message);
      // 克隆成功：自动把当前故事声音设为该亲属/自定义对象，让孩子立刻听到真人声
      if (res.ok) {
        await saveVoiceSetting(target);
        // 刚克隆成功：立刻在对象上打出「已克隆」标记，不用退回上一页再进来
        setClonedKeys((prev) => new Set(prev).add(target));
        // 记下当前提示音，成功页要如实告诉家长「提示音用的是哪个、没跟着变」
        try {
          setPromptVoiceId(await getPromptVoiceSetting());
        } catch {
          /* 读取失败按默认展示 */
        }
        // 重新克隆同一对象 → 清掉旧音色缓存，避免旧音频残留 / 误用
        clearClonedPhraseCache(target);
        // 静默预合成一批高频短句（你好/再见/答对/晚安…）到本地缓存，
        // 之后这些提示音都是克隆声且秒出、零 token（失败静默忽略，不阻塞本页）
        warmClonedPhrases(target);
      }
    } else {
      setCloneResult({ ok: false, message: t('vc.noFile') });
    }
    setStep('done');
  };

  /**
   * v82：把「提示音」也换成刚克隆的声音。
   * 默认不动提示音（保持内置大姐姐，中英文界面一致、朗读与播报不会突然换人），
   * 但家长想让孩子连提问声都是自己的，这里一键搞定，不用再翻设置页。
   */
  const handleUseForPrompt = async () => {
    try {
      await savePromptVoiceSetting(target);
      setPromptVoiceId(target);
    } catch {
      /* 写失败时保持原样，家长仍可去「声音设置」里改 */
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // 门禁未放行时不渲染功能 UI，避免免费用户看到可操作界面却点不动
  if (gatePassed !== true) {
    return (
      <CartoonScreen gradient="candy" decor>
        <View style={styles.gateWrap}>
          {gatePassed === null ? (
            <ActivityIndicator size="large" color="#6c5ce7" />
          ) : (
            <Text style={styles.gateText}>{t('vc.gate')}</Text>
          )}
        </View>
      </CartoonScreen>
    );
  }

  // 克隆提交/训练中：全屏等待提示，避免「干等不知是否成功」
  if (cloning) {
    return (
      <CartoonScreen gradient="candy" decor>
        <View style={styles.cloningFull}>
          <View style={styles.cloningCenter}>
            <ActivityIndicator size="large" color="#6c5ce7" />
            <Text style={styles.cloningText}>{t('vc.submitting')}</Text>
            <Text style={styles.cloningSub}>{t('vc.cloningHint')}</Text>
          </View>

          {/* 底部：诙谐小句子轮播（视觉陪伴，不朗读） */}
          <View style={styles.clonePhraseBox} pointerEvents="none">
            <Animated.Text style={[styles.clonePhraseText, { opacity: clonePhraseFade }]}>
              {t(CLONE_PHRASE_KEYS[clonePhraseIdx])}
            </Animated.Text>
          </View>
        </View>
      </CartoonScreen>
    );
  }

  return (
    <CartoonScreen gradient="candy" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('vc.title')}</Text>

      <View style={styles.raccoRow}>
        <Racco state={raccoState} size={56} />
        <Text style={styles.raccoText}>
          {step === 'select' && t('vc.raccoSelect')}
          {step === 'recording' && t('vc.raccoRecording')}
          {step === 'preview' && t('vc.raccoPreview')}
          {step === 'done' && t('vc.raccoDone')}
        </Text>
      </View>

      {step !== 'done' && (
        <>
          <Text style={styles.sectionTitle}>{t('vc.chooseTarget')}</Text>
          <View style={styles.segmented}>
            {[...PRESET_TARGETS, ...customTargets].map((tg) => {
              const isCloned = clonedKeys.has(tg.key);
              return (
                <TouchableOpacity
                  key={tg.key}
                  style={target === tg.key ? styles.segmentActive : styles.segmentBtn}
                  onPress={() => setTarget(tg.key)}
                >
                  <Text style={styles.segmentIcon}>{tg.icon}</Text>
                  <Text style={target === tg.key ? styles.segmentActiveLabel : styles.segmentLabel}>
                    {targetLabel(tg.key, t)}
                  </Text>
                  {isCloned && (
                    <Text style={styles.segmentCloned}>✓ {t('vc.clonedTag')}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={styles.segmentBtn}
              onPress={() => setShowCustomInput(true)}
            >
              <Text style={styles.segmentIcon}>➕</Text>
              <Text style={styles.segmentLabel}>{t('vc.customAdd')}</Text>
            </TouchableOpacity>
          </View>
          {showCustomInput && (
            <View style={styles.customInputRow}>
              <TextInput
                style={styles.customInput}
                value={customName}
                onChangeText={setCustomName}
                placeholder={t('vc.customNamePlaceholder')}
                placeholderTextColor="#bbb"
                maxLength={8}
                autoFocus
              />
              <TouchableOpacity style={styles.customConfirm} onPress={confirmCustom}>
                <Text style={styles.customConfirmText}>{t('common.ok')}</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.sectionTitle}>{t('vc.guideTitle')}</Text>
          <Text style={styles.guide}>{t('vc.guideText')}</Text>

          <View style={styles.textCard}>
            <Text style={styles.subLabel}>{t('vc.exampleZh')}</Text>
            <Text style={styles.readText}>{READ_TEXT_ZH}</Text>
          </View>
          <View style={styles.textCard}>
            <Text style={styles.subLabel}>{t('vc.exampleEn')}</Text>
            <Text style={styles.readText}>{READ_TEXT_EN}</Text>
          </View>

          {step === 'select' && (
            <TouchableOpacity style={styles.recordBtn} onPress={startRecording}>
              <Text style={styles.recordBtnText}>{t('vc.startRecord')}</Text>
            </TouchableOpacity>
          )}

          {step === 'recording' && (
            <>
              <View style={styles.timerCard}>
                <Text style={styles.timer}>{formatTime(duration)}</Text>
                <Text style={styles.timerHint}>{t('vc.timerHint')}</Text>
              </View>
              <TouchableOpacity style={styles.stopBtn} onPress={stopRecording}>
                <Text style={styles.recordBtnText}>{t('vc.stopRecord')}</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'preview' && (
            <>
              <Text style={styles.sectionTitle}>{t('vc.waveform')}</Text>
              <View style={styles.waveform}>
                {waveData.map((h, i) => (
                  <View key={i} style={{ ...styles.bar, height: h }} />
                ))}
              </View>
              <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
                <Text style={styles.doneBtnText}>{t('vc.submit')}</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {step === 'done' && (
        <View style={styles.successCard}>
          <Text style={{ fontSize: 48 }}>{cloning ? '⏳' : cloneResult?.ok ? '🎉' : '⚠️'}</Text>
          <Text style={styles.successText}>
            {cloning
              ? t('vc.submitting')
              : cloneResult?.ok
              ? t('vc.successOk')
              : cloneResult
              ? t('vc.failTitle')
              : t('vc.successOk')}
          </Text>
          {/*
            v82 反馈 #1：原来标题直接用 cloneResult.message、下面「服务端返回：{msg}」又贴一遍，
            同一段诊断话出现了两次。现在标题固定为短句「克隆没成功」，原因只显示一次。
          */}
          {!cloning && cloneResult && !cloneResult.ok && (
            <Text style={styles.successSub}>{cloneResult.message}</Text>
          )}
          {!cloning && cloneResult?.ok && (
            <>
              <Text style={styles.successSub}>{t('vc.successSubOk')}</Text>

              {/*
                v82：把「哪条声线换成了谁」逐条写清楚。
                之前只有一句「已为你启用 X 的声音」，家长点试听听到的却是提示音
                （仍是大姐姐），很容易判定成「克隆没生效 / 声音又乱了」。
              */}
              <View style={styles.voiceSplitCard}>
                <Text style={styles.voiceSplitRow}>
                  {`📖 ${t('vc.storyVoiceNow').replace('{name}', voiceDisplayName(target, uiLang))}`}
                </Text>
                <Text style={styles.voiceSplitRow}>
                  {`🔔 ${t('vc.promptVoiceNow').replace('{name}', voiceDisplayName(promptVoiceId, uiLang))}`}
                </Text>
              </View>

              <Text style={styles.voiceSplitHint}>{t('vc.voiceSplitHint')}</Text>

              {/* 提示音仍不是刚克隆的声音 → 给一键同设入口，免去翻设置页 */}
              {promptVoiceId !== target && (
                <TouchableOpacity style={styles.linkBtn} onPress={handleUseForPrompt} activeOpacity={0.85}>
                  <Text style={styles.linkBtnText}>
                    {t('vc.useForPrompt').replace('{name}', voiceDisplayName(target, uiLang))}
                  </Text>
                </TouchableOpacity>
              )}

              <View style={{ marginTop: 14 }}>
                <TouchableOpacity
                  style={[styles.previewBtn, previewing && styles.previewBtnDisabled]}
                  onPress={handlePreview}
                  disabled={previewing}
                >
                  <Text style={styles.previewBtnText}>
                    {previewing ? t('vc.previewing') : t('vc.preview')}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          {!cloning && (
            <View style={styles.doneActions}>
              {cloneResult && !cloneResult.ok && (
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => { setCloneResult(null); setCloneMsg(null); setStep('select'); }}
                >
                  <Text style={styles.retryBtnText}>{t('vc.retry')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.backHomeBtn} onPress={() => router.back()}>
                <Text style={styles.backHomeBtnText}>{t('vc.back')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  gateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gateText: { fontSize: 15, color: COLORS.textSub, marginTop: 12 },
  title: { fontSize: 28, color: COLORS.purple, marginBottom: 8, fontFamily: FONT.rounded },
  raccoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  raccoText: { fontSize: 15, color: COLORS.textSub, marginLeft: 8 },
  sectionTitle: { fontSize: 17, color: COLORS.purple, marginVertical: 8, fontFamily: FONT.rounded },
  guide: { fontSize: 14, color: '#e67e22', marginVertical: 4 },
  segmented: { flexDirection: 'row', backgroundColor: '#e8e0f0', borderRadius: 18, padding: 4, marginBottom: 12 },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 18 },
  segmentActive: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 18, backgroundColor: '#fff' },
  segmentIcon: { fontSize: 20 },
  segmentLabel: { fontSize: 13, color: '#A8988A' },
  /** 已克隆标记：小一号的绿色「✓ 已克隆」，不挤占名字的空间 */
  segmentCloned: { fontSize: 10, color: '#2E9E7E', fontWeight: '700', marginTop: 1 },
  segmentActiveLabel: { fontSize: 13, fontWeight: '600', color: '#3D3229' },
  textCard: { backgroundColor: '#fff', borderRadius: 18, padding: 12, marginBottom: 8 },
  subLabel: { fontSize: 12, color: '#A8988A', marginBottom: 4 },
  readText: { fontSize: 14, lineHeight: 22, color: '#3D3229' },
  recordBtn: { backgroundColor: '#9B7EDE', borderRadius: 22, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  recordBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  stopBtn: { backgroundColor: '#F2827F', borderRadius: 22, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  timerCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16, alignItems: 'center', marginVertical: 12 },
  timer: { fontSize: 36, fontWeight: 'bold', color: '#3D3229' },
  timerHint: { fontSize: 13, color: '#A8988A', marginTop: 4 },
  waveform: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 50, paddingHorizontal: 4, marginVertical: 8 },
  bar: { width: 6, backgroundColor: '#9B7EDE', borderRadius: 3 },
  doneBtn: { backgroundColor: '#5FC3A4', borderRadius: 22, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  successCard: { backgroundColor: '#fff', borderRadius: 22, padding: 32, alignItems: 'center', marginTop: 20 },
  successText: { fontSize: 22, fontWeight: 'bold', color: '#5FC3A4', marginTop: 8 },
  successSub: { fontSize: 14, color: '#A8988A', marginTop: 4 },
  /** v82：成功页「朗读 / 提示音各用谁」的对照小卡 */
  voiceSplitCard: {
    width: '100%', backgroundColor: '#F7F3EC', borderRadius: 16,
    paddingVertical: 12, paddingHorizontal: 14, marginTop: 14,
  },
  voiceSplitRow: { fontSize: 14, color: '#3D3229', lineHeight: 24 },
  voiceSplitHint: { fontSize: 12, color: '#A8988A', lineHeight: 18, marginTop: 8, textAlign: 'center' },
  linkBtn: {
    marginTop: 12, paddingVertical: 10, paddingHorizontal: 18,
    borderRadius: 16, borderWidth: 1.5, borderColor: '#9B7EDE',
  },
  linkBtnText: { fontSize: 13, color: '#9B7EDE', fontWeight: '600' },
  doneActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 20, gap: 12 },
  retryBtn: { backgroundColor: '#F2827F', borderRadius: 26, paddingVertical: 12, paddingHorizontal: 24 },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  backHomeBtn: { backgroundColor: '#9B7EDE', borderRadius: 26, paddingVertical: 12, paddingHorizontal: 24 },
  backHomeBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  previewBtn: { backgroundColor: '#F2827F', borderRadius: 26, paddingVertical: 12, paddingHorizontal: 28, alignSelf: 'center' },
  previewBtnDisabled: { opacity: 0.6 },
  previewBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cloningFull: { flex: 1, justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 40 },
  cloningCenter: { alignItems: 'center' },
  cloningText: { fontSize: 20, fontWeight: 'bold', color: '#3D3229', marginTop: 16 },
  cloningSub: { fontSize: 14, color: '#A8988A', marginTop: 8, textAlign: 'center' },
  // 底部轮播的诙谐句子：贴在页面下方，不压中间的转圈与标题
  clonePhraseBox: {
    position: 'absolute',
    left: 28,
    right: 28,
    bottom: 72,
    alignItems: 'center',
  },
  clonePhraseText: {
    fontSize: 15,
    lineHeight: 24,
    color: '#8e7cc3',
    textAlign: 'center',
    fontFamily: FONT.rounded,
  },
  customInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 6 },
  customInput: { flex: 1, backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#3D3229', borderWidth: 1, borderColor: '#e0d4f0' },
  customConfirm: { backgroundColor: '#5FC3A4', borderRadius: 18, paddingVertical: 10, paddingHorizontal: 16, marginLeft: 8 },
  customConfirmText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
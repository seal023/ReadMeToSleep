import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Alert, ActivityIndicator, TextInput } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAudioRecorder, RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import { useLanguage } from '../../hooks/useLanguage';
import { COLORS, FONT } from '@/constants/theme';
import { checkVoiceCloneGate } from '@/services/entitlement';
import { enrollVoice, isVoiceCloneConfigured, getClonedTargets, type VoiceCloneResult, type CloneTarget } from '@/services/voiceClone';
import { saveVoiceSetting } from '@/services/storage';

// 预设对象；自定义克隆以 key = 'custom:<名称>' 形式存在
const PRESET_TARGETS: { key: CloneTarget; labelKey: string; icon: string }[] = [
  { key: 'mom', labelKey: 'vc.mom', icon: '👩' },
  { key: 'dad', labelKey: 'vc.dad', icon: '👨' },
  { key: 'grandma', labelKey: 'vc.grandma', icon: '👵' },
];

/** 把 target key 转成展示名（预设取本地化，自定义去掉 'custom:' 前缀） */
function targetLabel(key: CloneTarget, t: (k: string) => string): string {
  if (key.startsWith('custom:')) return key.slice('custom:'.length);
  const preset = PRESET_TARGETS.find((p) => p.key === key);
  return preset ? t(preset.labelKey) : key;
}

const READ_TEXT_ZH = `从前有座山，山里有座庙。庙里有个老和尚在给小和尚讲故事。讲的什么呢？老和尚对小和尚说："从前有座山，山里有座庙……"小和尚歪着头问："妈妈，这故事的结尾是什么呀？"老和尚笑着说："这就是故事的魅力呀，我们每天都可以从头开始听。"`;
const READ_TEXT_EN = `Once upon a time, there was a little bird who wanted to learn how to sing. Every morning, she would sit on a branch and listen to the old birds sing beautiful songs. "Practice makes perfect," the old bird said kindly. So every day, the little bird opened her beak and tried again and again until one day, she discovered her own wonderful voice.`;

export default function VoiceClonePage() {
  const { t } = useLanguage();
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
  const [cloneMsg, setCloneMsg] = useState<string | null>(null);
  const [cloneResult, setCloneResult] = useState<VoiceCloneResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStart = useRef(0);

  const router = useRouter();
  /** null = 校验中；true = 放行；false = 被拦下 */
  const [gatePassed, setGatePassed] = useState<boolean | null>(null);

  // 自定义克隆对象（target = 'custom:<名称>'）
  const [customName, setCustomName] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customTargets, setCustomTargets] = useState<{ key: CloneTarget; label: string; icon: string }[]>([]);
  useEffect(() => {
    (async () => {
      const all = await getClonedTargets();
      const customs = all
        .filter((k) => k.startsWith('custom:'))
        .map((k) => ({ key: k, label: k.slice('custom:'.length), icon: '🧑' }));
      setCustomTargets(customs);
    })();
  }, []);
  const confirmCustom = () => {
    const name = customName.trim();
    if (!name) return;
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
          { text: '返回', style: 'cancel', onPress: () => router.back() },
          { text: '查看方案', onPress: () => router.push('/(parent)/subscription') },
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
        `name: ${err?.name ?? '无'}\nmessage: ${err?.message ?? '无'}\n${
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
      }
    } else {
      setCloneResult({ ok: false, message: t('vc.noFile') });
    }
    setStep('done');
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
          <ActivityIndicator size="large" color="#6c5ce7" />
          <Text style={styles.cloningText}>{t('vc.submitting')}</Text>
          <Text style={styles.cloningSub}>{t('vc.cloningHint')}</Text>
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
            {[...PRESET_TARGETS, ...customTargets].map((tg) => (
              <TouchableOpacity
                key={tg.key}
                style={target === tg.key ? styles.segmentActive : styles.segmentBtn}
                onPress={() => setTarget(tg.key)}
              >
                <Text style={styles.segmentIcon}>{tg.icon}</Text>
                <Text style={target === tg.key ? styles.segmentActiveLabel : styles.segmentLabel}>
                  {targetLabel(tg.key, t)}
                </Text>
              </TouchableOpacity>
            ))}
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
            {cloning ? t('vc.submitting') : (cloneResult?.message || t('vc.successOk'))}
          </Text>
          {!cloning && cloneResult && !cloneResult.ok && (
            <Text style={styles.successSub}>
              {t('vc.successSubFail').replace('{msg}', cloneResult.message)}
            </Text>
          )}
          {!cloning && cloneResult?.ok && (
            <>
              <Text style={styles.successSub}>{t('vc.successSubOk')}</Text>
              <Text style={styles.successSub}>{t('vc.enabledNow').replace('{name}', targetLabel(target, t))}</Text>
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
  title: { fontSize: 28, fontWeight: 'bold', color: COLORS.purple, marginBottom: 8, fontFamily: FONT.rounded },
  raccoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  raccoText: { fontSize: 15, color: COLORS.textSub, marginLeft: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: COLORS.purple, marginVertical: 8, fontFamily: FONT.rounded },
  guide: { fontSize: 14, color: '#e67e22', marginVertical: 4 },
  segmented: { flexDirection: 'row', backgroundColor: '#e8e0f0', borderRadius: 12, padding: 4, marginBottom: 12 },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  segmentActive: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: '#fff' },
  segmentIcon: { fontSize: 20 },
  segmentLabel: { fontSize: 13, color: '#888' },
  segmentActiveLabel: { fontSize: 13, fontWeight: '600', color: '#2d1b69' },
  textCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  subLabel: { fontSize: 12, color: '#999', marginBottom: 4 },
  readText: { fontSize: 14, lineHeight: 22, color: '#333' },
  recordBtn: { backgroundColor: '#6c5ce7', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  recordBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  stopBtn: { backgroundColor: '#e74c3c', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  timerCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', marginVertical: 12 },
  timer: { fontSize: 36, fontWeight: 'bold', color: '#2d1b69' },
  timerHint: { fontSize: 13, color: '#999', marginTop: 4 },
  waveform: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 50, paddingHorizontal: 4, marginVertical: 8 },
  bar: { width: 6, backgroundColor: '#6c5ce7', borderRadius: 3 },
  doneBtn: { backgroundColor: '#00b894', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  successCard: { backgroundColor: '#fff', borderRadius: 16, padding: 32, alignItems: 'center', marginTop: 20 },
  successText: { fontSize: 22, fontWeight: 'bold', color: '#00b894', marginTop: 8 },
  successSub: { fontSize: 14, color: '#999', marginTop: 4 },
  doneActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 20, gap: 12 },
  retryBtn: { backgroundColor: '#e74c3c', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 24 },
  retryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  backHomeBtn: { backgroundColor: '#6c5ce7', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 24 },
  backHomeBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cloningFull: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  cloningText: { fontSize: 20, fontWeight: 'bold', color: '#2d1b69', marginTop: 16 },
  cloningSub: { fontSize: 14, color: '#999', marginTop: 8, textAlign: 'center' },
  customInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 6 },
  customInput: { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#333', borderWidth: 1, borderColor: '#e0d4f0' },
  customConfirm: { backgroundColor: '#00b894', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, marginLeft: 8 },
  customConfirmText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
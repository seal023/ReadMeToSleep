import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import {
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system/next';
import { saveStory } from '../../services/storage';
import { transcribeAudio } from '../../services/voiceClone';
import { useLanguage } from '../../hooks/useLanguage';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import Racco from '@/components/common/Racco';
import { COLORS, FONT } from '@/constants/theme';
import type { Story, Language } from '../../types';

type Step = 'record' | 'process' | 'edit';

export default function RecordScreen() {
  const { t, language } = useLanguage();
  const [step, setStep] = useState<Step>('record');
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStart = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('record.permFail'), t('record.micPerm'));
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        staysActiveInBackground: false,
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setRecording(true);
      setStep('record');
      setDuration(0);
      timerStart.current = Date.now();
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - timerStart.current) / 1000));
      }, 1000);
    } catch (err: any) {
      console.error('[record] start failed:', err);
      Alert.alert(t('record.permFail'), String(err?.message || err));
    }
  };

  const stopRecording = async () => {
    try {
      await audioRecorder.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      const u = audioRecorder.uri || null;
      setUri(u);
      setRecording(false);
      if (!u) {
        Alert.alert(t('record.noFile'));
        return;
      }
      // 录音过短几乎必然 ASR 识别为空，提前提示
      if (duration > 0 && duration < 2) {
        setTranscript('');
        setStep('edit');
        Alert.alert(t('record.tooShort'), t('record.tooShortMsg'));
        return;
      }
      // 自动转文字
      setStep('process');
      const text = await transcribeAudio(u);
      setTranscript(text || '');
      if (!text) {
        Alert.alert(t('record.noTranscript'));
      }
      setStep('edit');
    } catch (err: any) {
      console.error('[record] stop failed:', err);
      setRecording(false);
      Alert.alert(t('record.permFail'), String(err?.message || err));
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (!uri) return;
    setSaving(true);
    try {
      const id = `rec_${Date.now()}`;
      // 把录音从缓存复制到 documents，保证长期保留。
      // ★ 修复：SDK57 真机上顶层 FileSystem.documentDirectory 可能返回空（克隆音频落盘已踩过同一坑），
      //   旧代码拼字符串会得到 "nullrecordings/xxx.m4a" 的坏路径；更糟的是 .catch(()=>{}) 把
      //   复制失败静默吞掉，坏路径照样写进 story.audioUri → 这条录音之后永远播不出来。
      //   改用 expo-file-system/next 的 Paths.document + Directory/File，失败则退回缓存原件。
      let finalUri = uri;
      try {
        const dir = new Directory(Paths.document, 'recordings');
        if (!dir.exists) dir.create();
        const src = new File(uri);
        const dest = new File(dir, `${id}.m4a`);
        if (src.exists) {
          if (dest.exists) dest.delete();
          src.copy(dest);
          finalUri = dest.uri;
        }
      } catch (copyErr) {
        // 复制失败不再静默：退回缓存原件，至少本次能正常播放
        console.warn('[record] copy to documents failed, fallback to cache:', copyErr);
      }
      const finalTitle =
        title.trim() ||
        `${language === 'zh' ? '我的故事' : 'My Story'} ${new Date().toLocaleDateString()}`;
      const story: Story = {
        id,
        title: finalTitle,
        content: transcript.trim() || t('record.noTranscript'),
        language: (language === 'zh' ? 'zh' : 'en') as Language,
        type: 'recorded',
        tags: [],
        duration,
        audioUri: finalUri,
        createdAt: new Date().toISOString(),
      };
      await saveStory(story);
      router.back();
    } catch (err: any) {
      console.error('[record] save failed:', err);
      Alert.alert(t('record.permFail'), String(err?.message || err));
      setSaving(false);
    }
  };

  const raccoState = recording ? 'listening' : 'idle';
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${String(ss).padStart(2, '0')}`;
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('record.title')}</Text>
        {/* 说明用途：这个页面到底是干嘛的（此前缺文案，只显示原始 key，家长看不懂） */}
        <Text style={styles.intro}>{t('record.intro')}</Text>

        <View style={styles.raccoWrap}>
          <Racco state={raccoState} size={120} showSpeechBubble speechText={t('record.racco')} />
        </View>

        {/* 录音中：波形 + 计时 */}
        {step === 'record' && (
          <View style={styles.centerCol}>
            <View style={styles.wave}>
              {[0, 1, 2, 3, 4].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.waveBar,
                    recording && { height: 16 + ((i * 13 + duration * 7) % 40) },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.timer}>{fmt(duration)}</Text>
          </View>
        )}

        {/* 转文字中 */}
        {step === 'process' && (
          <View style={styles.centerCol}>
            <ActivityIndicator size="large" color={COLORS.orange} />
            <Text style={styles.hint}>{t('record.processing')}</Text>
          </View>
        )}

        {/* 编辑 / 保存 */}
        {step === 'edit' && (
          <View style={styles.editBox}>
            <Text style={styles.label}>{t('record.transcriptHint')}</Text>
            <TextInput
              style={styles.transcript}
              value={transcript}
              onChangeText={setTranscript}
              multiline
              placeholder={t('record.noTranscript')}
              placeholderTextColor="#bbb"
            />
            <Text style={styles.label}>{t('record.titlePlaceholder')}</Text>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder={t('record.titlePlaceholder')}
              placeholderTextColor="#bbb"
              maxLength={30}
            />
          </View>
        )}

        {/* 操作按钮 */}
        <View style={styles.actions}>
          {!recording && step === 'record' && (
            <TouchableOpacity style={styles.bigBtn} onPress={startRecording}>
              <Text style={styles.bigBtnText}>🎤</Text>
              <Text style={styles.btnLabel}>{t('record.start')}</Text>
            </TouchableOpacity>
          )}
          {recording && (
            <TouchableOpacity style={[styles.bigBtn, styles.stopBtn]} onPress={stopRecording}>
              <Text style={styles.bigBtnText}>⏹️</Text>
              <Text style={styles.btnLabel}>{t('record.stop')}</Text>
            </TouchableOpacity>
          )}
          {step === 'edit' && (
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>
                {saving ? t('record.saving') : t('record.save')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, alignItems: 'center' },
  title: { fontSize: 22, fontWeight: 'bold', color: COLORS.text, marginTop: 8, marginBottom: 8 },
  intro: {
    fontSize: 13,
    lineHeight: 20,
    color: '#7A6A5F',
    textAlign: 'center',
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  raccoWrap: { marginVertical: 12 },
  centerCol: { alignItems: 'center', marginVertical: 18 },
  wave: { flexDirection: 'row', alignItems: 'center', height: 56 },
  waveBar: { width: 8, height: 10, borderRadius: 4, marginHorizontal: 5, backgroundColor: COLORS.orange },
  timer: { fontSize: 26, fontWeight: '600', color: COLORS.orange, marginTop: 10 },
  hint: { fontSize: 15, color: '#999', marginTop: 14 },
  editBox: { width: '100%' },
  label: { fontSize: 14, color: '#666', marginTop: 14, marginBottom: 6, alignSelf: 'flex-start' },
  transcript: {
    width: '100%', minHeight: 120, backgroundColor: '#fff', borderRadius: 12,
    padding: 12, fontSize: 15, color: COLORS.text, textAlignVertical: 'top',
  },
  titleInput: {
    width: '100%', backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12,
    paddingVertical: 10, fontSize: 15, color: COLORS.text,
  },
  actions: { alignItems: 'center', marginTop: 20 },
  bigBtn: {
    alignItems: 'center', padding: 14, backgroundColor: '#FFF0ED',
    borderRadius: 24, minWidth: 120,
  },
  stopBtn: { backgroundColor: '#FFD9D4' },
  bigBtnText: { fontSize: 44 },
  btnLabel: { fontSize: 14, color: '#666', marginTop: 4 },
  saveBtn: {
    backgroundColor: COLORS.orange, borderRadius: 24, paddingVertical: 14,
    paddingHorizontal: 40, alignItems: 'center', marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

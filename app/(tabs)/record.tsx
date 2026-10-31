import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { router, useFocusEffect } from 'expo-router';
import {
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system/next';
import { saveStory, getStories, deleteStory } from '../../services/storage';
import { playLocalFile, stopClonedAudio } from '../../services/clonedVoicePlayback';
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

  // 历史录音目录：录音页下方列出每次录音的标题 / 日期 / 时长，可直接试听、删除
  const [recordings, setRecordings] = useState<Story[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const loadRecordings = useCallback(async () => {
    try {
      const all = await getStories();
      const recs = all
        .filter((s) => s.type === 'recorded')
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setRecordings(recs);
    } catch {
      /* 读取异常保持空列表 */
    }
  }, []);

  // 每次回到本页刷新（保存新录音返回、或从别处删除后）；离开本 tab 时停掉试听
  useFocusEffect(
    useCallback(() => {
      loadRecordings();
      return () => {
        stopClonedAudio();
        setPreviewId(null);
      };
    }, [loadRecordings])
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopClonedAudio(); // 离开时停掉试听
    };
  }, []);

  const togglePreview = async (story: Story) => {
    if (!story.audioUri) return;
    if (recording) return; // 录音进行中不打断
    if (previewId === story.id) {
      stopClonedAudio();
      setPreviewId(null);
      return;
    }
    stopClonedAudio();
    const ok = await playLocalFile(story.audioUri, () => setPreviewId(null));
    setPreviewId(ok ? story.id : null);
  };

  const confirmDelete = (story: Story) => {
    Alert.alert(
      language === 'en' ? 'Delete recording?' : '删除这段录音？',
      story.title,
      [
        { text: language === 'en' ? 'Cancel' : '取消', style: 'cancel' },
        {
          text: language === 'en' ? 'Delete' : '删除',
          style: 'destructive',
          onPress: async () => {
            if (previewId === story.id) {
              stopClonedAudio();
              setPreviewId(null);
            }
            await deleteStory(story.id);
            await loadRecordings();
          },
        },
      ],
    );
  };

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
  const formatDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return language === 'en'
      ? `${d.getMonth() + 1}/${d.getDate()}`
      : `${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const totalSec = recordings.reduce((sum, r) => sum + (r.duration || 0), 0);

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

        {/* 历史录音目录：每次录音的标题 / 日期 / 时长一览，可试听、可删除 */}
        <View style={styles.dirSection}>
          <View style={styles.dirHeader}>
            <Text style={styles.dirTitle}>{language === 'en' ? '📁 Recording list' : '📁 历史录音目录'}</Text>
            <Text style={styles.dirSummary}>
              {recordings.length === 0
                ? (language === 'en' ? 'No recordings yet' : '还没有录音')
                : (language === 'en'
                    ? `${recordings.length} clip(s) · total ${fmt(totalSec)}`
                    : `共 ${recordings.length} 段 · 总计 ${fmt(totalSec)}`)}
            </Text>
          </View>

          {recordings.length === 0 ? (
            <Text style={styles.dirEmpty}>
              {language === 'en'
                ? 'Record a story above — it will show up here.'
                : '在上面录一个故事，录完就会出现在这里～'}
            </Text>
          ) : (
            recordings.map((story, i) => (
              <View key={story.id} style={styles.dirRow}>
                <Text style={styles.dirIndex}>{i + 1}</Text>
                <View style={styles.dirInfo}>
                  <Text style={styles.dirName} numberOfLines={1}>{story.title}</Text>
                  <Text style={styles.dirMeta}>
                    {formatDate(story.createdAt)} · {story.duration ? fmt(story.duration) : '—'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.dirIconBtn}
                  onPress={() => togglePreview(story)}
                  disabled={!story.audioUri}
                >
                  <Text style={styles.dirIcon}>{previewId === story.id ? '⏸' : '▶'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dirIconBtn} onPress={() => confirmDelete(story)}>
                  <Text style={styles.dirIcon}>🗑</Text>
                </TouchableOpacity>
              </View>
            ))
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

  // 历史录音目录
  dirSection: { width: '100%', marginTop: 32 },
  dirHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  dirTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  dirSummary: { fontSize: 12, color: '#8D6E63' },
  dirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
    elevation: 1,
  },
  dirIndex: { width: 22, fontSize: 13, color: '#B0A395', fontWeight: '700' },
  dirInfo: { flex: 1, marginRight: 8 },
  dirName: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  dirMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  dirIconBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFF0ED',
    alignItems: 'center', justifyContent: 'center', marginLeft: 6,
  },
  dirIcon: { fontSize: 15 },
  dirEmpty: { fontSize: 13, color: '#AAA', textAlign: 'center', paddingVertical: 20 },
});

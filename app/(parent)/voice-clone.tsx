import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import * as Audio from 'expo-av';

type CloneTarget = 'mom' | 'dad' | 'grandma';

const TARGETS: { key: CloneTarget; label: string; icon: string }[] = [
  { key: 'mom', label: 'Mom', icon: '👩' },
  { key: 'dad', label: 'Dad', icon: '👨' },
  { key: 'grandma', label: 'Grandma', icon: '👵' },
];

const READ_TEXT_ZH = `从前有座山，山里有座庙。庙里有个老和尚在给小和尚讲故事。讲的什么呢？老和尚对小和尚说："从前有座山，山里有座庙……"小和尚歪着头问："妈妈，这故事的结尾是什么呀？"老和尚笑着说："这就是故事的魅力呀，我们每天都可以从头开始听。"`;
const READ_TEXT_EN = `Once upon a time, there was a little bird who wanted to learn how to sing. Every morning, she would sit on a branch and listen to the old birds sing beautiful songs. "Practice makes perfect," the old bird said kindly. So every day, the little bird opened her beak and tried again and again until one day, she discovered her own wonderful voice.`;

export default function VoiceClonePage() {
  const [target, setTarget] = useState<CloneTarget>('mom');
  const [step, setStep] = useState<'select' | 'recording' | 'preview' | 'done'>('select');
  const [duration, setDuration] = useState(0);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [waveData, setWaveData] = useState<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerStart = useRef(0);

  // ── Racco listening state (中间步骤显示) ──
  const raccoState = step === 'recording' ? 'listening' : step === 'select' ? 'idle' : 'happy';

  // Timer for recording duration
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

  // Generate fake waveform data
  const generateWaveform = () =>
    Array.from({ length: 40 }, () => Math.random() * 40 + 5);

  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecording: true, playThroughEarpiece: false });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY);
      await rec.startAsync();
      setRecording(rec);
      setStep('recording');
    } catch (err) {
      console.error('Recording error:', err);
    }
  };

  const stopRecording = async () => {
    if (recording) {
      await recording.stopAndUnloadAsync();
      const uriPath = recording.getURI();
      setUri(uriPath);
      setWaveData(generateWaveform());
      setStep('preview');
    }
  };

  const handleDone = async () => {
    setStep('done');
    // TODO: 上传到 ElevenLabs Voice Cloning API → 返回 voiceId
    // const formData = new FormData();
    // formData.append('file', { uri, name: `${target}.wav`, type: 'audio/wav' });
    // const resp = await fetch('https://api.elevenlabs.io/v1/voice-synthesis/clone', {
    //   method: 'POST',
    //   headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '' },
    //   body: formData,
    // });
    // const result = await resp.json();
    // const voiceId = result.voice_id;
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Title */}
      <Text style={styles.title}>声音克隆</Text>

      {/* Step indicator with Racco */}
      <View style={styles.raccoRow}>
        <Text style={{ fontSize: 32 }}>
          {raccoState === 'idle' ? '🦝' : raccoState === 'listening' ? '🦝🎧' : '🦝✨'}
        </Text>
        <Text style={styles.raccoText}>
          {step === 'select' && '选择你想克隆的声音'}
          {step === 'recording' && 'Racco 正在聆听...请保持稳定朗读'}
          {step === 'preview' && '录音完成！检查波形并确认'}
          {step === 'done' && '声音克隆已提交'}
        </Text>
      </View>

      {/* Segmented Control */}
      {step !== 'done' && (
        <>
          <Text style={styles.sectionTitle}>选择克隆对象</Text>
          <View style={styles.segmented}>
            {TARGETS.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.segmentBtn, target === t.key && styles.segmentActive]}
                onPress={() => setTarget(t.key)}
              >
                <Text style={styles.segmentIcon}>{t.icon}</Text>
                <Text style={[styles.segmentLabel, target === t.key && styles.segmentActiveLabel]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Guide & Read Text */}
          <Text style={styles.sectionTitle}>引导录音</Text>
          <Text style={styles.guide}>请朗读以下段落，持续 3–5 分钟</Text>

          <View style={styles.textCard}>
            <Text style={styles.subLabel}>中文示例</Text>
            <Text style={styles.readText}>{READ_TEXT_ZH}</Text>
          </View>
          <View style={styles.textCard}>
            <Text style={styles.subLabel}>English Example</Text>
            <Text style={styles.readText}>{READ_TEXT_EN}</Text>
          </View>

          {/* Action Button */}
          {step === 'select' && (
            <TouchableOpacity style={styles.recordBtn} onPress={startRecording}>
              <Text style={styles.recordBtnText}>🎤 开始录音</Text>
            </TouchableOpacity>
          )}

          {/* Recording timer */}
          {step === 'recording' && (
            <>
              <View style={styles.timerCard}>
                <Text style={styles.timer}>{formatTime(duration)}</Text>
                <Text style={styles.timerHint}>目标：3–5 分钟</Text>
              </View>
              <TouchableOpacity style={[styles.recordBtn, styles.stopBtn]} onPress={stopRecording}>
                <Text style={styles.recordBtnText}>⏹ 完成录音</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Preview waveform */}
          {step === 'preview' && (
            <>
              <Text style={styles.sectionTitle}>波形预览</Text>
              <View style={styles.waveform}>
                {waveData.map((h, i) => (
                  <View key={i} style={[styles.bar, { height: h }]} />
                ))}
              </View>
              <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
                <Text style={styles.doneBtnText}>✅ 确认并提交克隆</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}

      {step === 'done' && (
        <View style={styles.successCard}>
          <Text style={{ fontSize: 48 }}>🎉</Text>
          <Text style={styles.successText}>声音克隆已提交！</Text>
          <Text style={styles.successSub}>通常需要几分钟处理时间。</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f0ff' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#2d1b69', marginBottom: 8 },
  raccoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  raccoText: { fontSize: 15, color: '#666', marginLeft: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#4a3080', marginVertical: 8 },
  guide: { fontSize: 14, color: '#e67e22', marginVertical: 4 },
  segmented: { flexDirection: 'row', backgroundColor: '#e8e0f0', borderRadius: 12, padding: 4, marginBottom: 12 },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  segmentActive: { backgroundColor: '#fff' },
  segmentIcon: { fontSize: 20 },
  segmentLabel: { fontSize: 13, color: '#888' },
  segmentActiveLabel: { fontWeight: '600', color: '#2d1b69' },
  textCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  subLabel: { fontSize: 12, color: '#999', marginBottom: 4 },
  readText: { fontSize: 14, lineHeight: 22, color: '#333' },
  recordBtn: { backgroundColor: '#6c5ce7', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  recordBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  stopBtn: { backgroundColor: '#e74c3c' },
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
});

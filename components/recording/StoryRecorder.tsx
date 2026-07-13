import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  TextInput,
  Alert,
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

interface StoryRecorderProps {
  onSave?: (uri: string, title: string) => void;
}

const BAR_COUNT = 5;
const BAR_W = 6;
const BAR_GAP = 6;

const randomHeight = () => 20 + Math.random() * 60;

export default function StoryRecorder({ onSave }: StoryRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayed, setIsPlayed] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const [waveHeights, setWaveHeights] = useState<number[]>(
    Array(BAR_COUNT).fill(0).map(() => randomHeight())
  );
  const [showTitleInput, setShowTitleInput] = useState(false);
  const [title, setTitle] = useState('');

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerAnim = useRef(new Animated.Value(0)).current;

  const formatTime = (s: number) => {
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${m}:${ss}`;
  };

  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
    } catch (e) {
      Alert.alert('录音失败', '无法初始化录音设备');
      return;
    }

    setIsRecording(true);
    setTimer(0);
    setIsPlayed(false);
    setAudioUri(null);

    timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
    waveRef.current = setInterval(() => {
      setWaveHeights(Array(BAR_COUNT).fill(0).map(() => randomHeight()));
    }, 200);
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    await recordingRef.current.stopAndUnloadAsync();
    const uri = recordingRef.current.getURI();
    recordingRef.current = null;

    if (timerRef.current) clearInterval(timerRef.current);
    if (waveRef.current) clearInterval(waveRef.current);

    setIsRecording(false);
    setAudioUri(uri);
    setIsPlayed(false);
  };

  const playAudio = async () => {
    if (!audioUri) return;
    const { sound } = await Audio.Sound.createAsync({ uri: audioUri });
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((s) => {
      if (s.isLoaded && s.didJustFinish) {
        setIsPlayed(false);
        sound.unloadAsync();
      }
    });
    setIsPlayed(true);
  };

  const saveRecording = () => {
    setShowTitleInput(true);
  };

  const confirmSave = () => {
    if (!title.trim() || !audioUri) return;
    const dir = FileSystem.documentDirectory + 'recordings/';
    const id = Date.now().toString();
    const uri = dir + id + '.m4a';

    // Move to permanent location
    FileSystem.moveAsync({
      from: audioUri,
      to: uri,
    }).then(() => {
      setShowTitleInput(false);
      setTitle('');
      setAudioUri(null);
      setTimer(0);
      setWaveHeights(Array(BAR_COUNT).fill(0).map(() => 0));
      onSave?.(uri, title.trim());
    }).catch(() => {
      Alert.alert('保存失败', '无法保存录音文件');
    });
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (waveRef.current) clearInterval(waveRef.current);
    };
  }, []);

  return (
    <View style={styles.container}>
      {/* Waveform */}
      <View style={styles.waveContainer}>
        {waveHeights.map((h, i) => (
          <Animated.View
            key={i}
            style={[
              styles.waveBar,
              { height: Math.max(h, 4) },
              isRecording && { backgroundColor: '#B388FF' },
            ]}
          />
        ))}
      </View>

      {/* Timer */}
      {isRecording && <Text style={styles.timer}>{formatTime(timer)}</Text>}

      {/* Initial / Recording / Played States */}
      {!audioUri && !isRecording && (
        <Pressable onPress={startRecording} style={styles.bigButton}>
          <Text style={styles.bigBtnText}>🎤</Text>
          <Text style={styles.btnLabel}>开始录音</Text>
        </Pressable>
      )}

      {isRecording && (
        <Pressable onPress={stopRecording} style={styles.stopButton}>
          <Text style={styles.bigBtnText}>⏹️</Text>
          <Text style={styles.btnLabel}>停止录音</Text>
        </Pressable>
      )}

      {audioUri && (
        <View style={styles.playbackRow}>
          <Pressable onPress={playAudio} style={styles.smallBtn}>
            <Text style={styles.btnIcon}>{isPlayed ? '🔊' : '▶️'}</Text>
            <Text style={styles.btnLabel}>回放</Text>
          </Pressable>
          <Pressable onPress={saveRecording} style={styles.smallBtn}>
            <Text style={styles.btnIcon}>💾</Text>
            <Text style={styles.btnLabel}>保存</Text>
          </Pressable>
        </View>
      )}

      {/* Title Input */}
      {showTitleInput && (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="输入故事标题"
            value={title}
            onChangeText={setTitle}
            autoFocus
          />
          <Pressable onPress={confirmSave} style={styles.confirmBtn}>
            <Text style={styles.confirmText}>确定</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 24,
  },
  waveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
    marginBottom: 12,
  },
  waveBar: {
    width: BAR_W,
    marginHorizontal: BAR_GAP / 2,
    borderRadius: 3,
    backgroundColor: '#7C4DFF',
    opacity: 0.7,
  },
  timer: {
    fontSize: 28,
    fontWeight: '600',
    color: '#7C4DFF',
    marginBottom: 16,
    fontVariant: ['tabular-nums'],
  },
  bigButton: {
    alignItems: 'center',
    padding: 12,
  },
  stopButton: {
    alignItems: 'center',
    padding: 12,
  },
  bigBtnText: {
    fontSize: 48,
  },
  btnLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  playbackRow: {
    flexDirection: 'row',
    gap: 20,
  },
  smallBtn: {
    alignItems: 'center',
    padding: 10,
  },
  btnIcon: {
    fontSize: 28,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: '#7C4DFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  confirmBtn: {
    backgroundColor: '#7C4DFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  confirmText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 15,
  },
});

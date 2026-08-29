import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert,
} from 'react-native';
import { AudioPlayer, setAudioModeAsync } from 'expo-audio';
import Racco from '../../components/common/Racco';
import { useLanguage } from '../../hooks/useLanguage';
import { getStories, saveStory, deleteStory } from '../../services/storage';
import type { Story } from '../../types';

export default function ChildRecordingsScreen() {
  const { t } = useLanguage();
  const [recordings, setRecordings] = useState<Story[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => { load(); }, []);

  // 组件卸载时停止播放
  useEffect(() => {
    return () => {
      playerRef.current?.remove();
      playerRef.current = null;
    };
  }, []);

  async function load() {
    const all = await getStories();
    setRecordings(all.filter(s => s.type === 'recording' || s.audioUri));
  }

  async function toggleLike(story: Story) {
    const updated = { ...story, isLiked: !story.isLiked };
    await saveStory(updated);
    setRecordings(prev => prev.map(s => s.id === story.id ? updated : s));
  }

  async function playRecording(story: Story) {
    if (!story.audioUri) return;

    // 如果正在播放同一个，暂停
    if (playingId === story.id && playerRef.current) {
      playerRef.current.pause();
      setPlayingId(null);
      return;
    }

    // 停止之前的
    if (playerRef.current) {
      playerRef.current.remove();
      playerRef.current = null;
    }
    setPlayingId(null);

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        staysActiveInBackground: false,
      });

      const player = new AudioPlayer({ uri: story.audioUri });
      playerRef.current = player;
      player.play();
      setPlayingId(story.id);

      // 播放结束后重置状态
      player.addListener('playbackStatusUpdate', (status) => {
        if (!status.isLoaded || status.didJustFinish) {
          setPlayingId(null);
        }
      });
    } catch (e) {
      console.error('播放失败:', e);
      Alert.alert('播放失败', '无法加载音频');
    }
  }

  async function handleDelete(story: Story) {
    Alert.alert(
      t('common.confirm') || '确认删除',
      `确定要删除「${story.title}」吗？`,
      [
        { text: t('common.cancel') || '取消', style: 'cancel' },
        { text: t('common.delete') || '删除', style: 'destructive', onPress: async () => {
          // 如果正在播放被删除的录音，先停
          if (playingId === story.id && playerRef.current) {
            playerRef.current.remove();
            playerRef.current = null;
            setPlayingId(null);
          }
          await deleteStory(story.id);
          setRecordings(prev => prev.filter(s => s.id !== story.id));
        }},
      ],
    );
  }

  function formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.raccoWrap}>
        <Racco state="happy" size={100} />
      </View>
      <Text style={styles.title}>{t('myStories.title') || '孩子录音'}</Text>

      {recordings.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🎤</Text>
          <Text style={styles.emptyText}>暂无录音 / No recordings yet</Text>
        </View>
      ) : (
        recordings.map(story => (
          <View key={story.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{story.title}</Text>
              <TouchableOpacity onPress={() => toggleLike(story)}>
                <Text style={{ fontSize: 20 }}>{story.isLiked ? '❤️' : '🤍'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.cardMeta}>
              <Text style={styles.metaText}>{formatDate(story.createdAt)}</Text>
              <Text style={styles.metaText}>·</Text>
              <Text style={styles.metaText}>{formatDuration(story.duration)}</Text>
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={playingId === story.id ? styles.playingBtn : styles.actionBtn}
                onPress={() => playRecording(story)}
              >
                <Text style={styles.actionText}>{playingId === story.id ? '⏸ 暂停' : '▶ 播放'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(story)}>
                <Text style={styles.deleteText}>🗑 删除</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  raccoWrap: { alignItems: 'center', marginVertical: 16 },
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 16, color: '#333' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 56, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#aaa', textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '600', flex: 1, marginRight: 8 },
  cardMeta: { flexDirection: 'row', marginTop: 6, marginBottom: 10 },
  metaText: { fontSize: 13, color: '#999' },
  cardActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, backgroundColor: '#4A90D9', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  playingBtn: { flex: 1, backgroundColor: '#6AB0F3', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  deleteBtn: { flex: 1, backgroundColor: '#FFF0F0', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  actionText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  deleteText: { fontSize: 14, fontWeight: '600', color: '#E53935' },
});
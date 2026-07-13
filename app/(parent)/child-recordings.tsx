import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert,
} from 'react-native';
import * as Audio from 'expo-av';
import Racco from '../../components/common/Racco';
import { useLanguage } from '../../hooks/useLanguage';
import storage from '../../services/storage';
import type { Story } from '../../types';

export default function ChildRecordingsScreen() {
  const { t } = useLanguage();
  const [recordings, setRecordings] = useState<Story[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const all = await storage.getStories();
    setRecordings(all.filter(s => s.type === 'recording' || s.audioUri));
  }

  async function toggleLike(story: Story) {
    const updated = { ...story, isLiked: !story.isLiked };
    await storage.saveStory(updated);
    setRecordings(prev => prev.map(s => s.id === story.id ? updated : s));
  }

  async function playRecording(story: Story) {
    if (!story.audioUri) return;

    if (playingId === story.id && sound) {
      await sound.stopAsync();
      setPlayingId(null);
      setSound(null);
      return;
    }

    if (sound) {
      await sound.unloadAsync();
    }
    setPlayingId(null);

    try {
      const { sound: s } = await Audio.Sound.createAsync(
        { uri: story.audioUri },
        { shouldPlay: true },
        { onPlaybackStatusUpdate: () => {} },
      );
      setSound(s);
      setPlayingId(story.id);
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
          await storage.deleteStory(story.id);
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
                style={[styles.actionBtn, playingId === story.id && styles.playingBtn]}
                onPress={() => playRecording(story)}
              >
                <Text style={styles.actionText}>{playingId === story.id ? '⏸ 暂停' : '▶ 播放'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleDelete(story)}>
                <Text style={[styles.actionText, styles.deleteText]}>🗑 删除</Text>
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
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '600', flex: 1, marginRight: 8 },
  cardMeta: { flexDirection: 'row', marginTop: 6, marginBottom: 10 },
  metaText: { fontSize: 13, color: '#999' },
  cardActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, backgroundColor: '#4A90D9', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  playingBtn: { backgroundColor: '#6AB0F3' },
  deleteBtn: { backgroundColor: '#FFF0F0' },
  actionText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  deleteText: { color: '#E53935' },
});



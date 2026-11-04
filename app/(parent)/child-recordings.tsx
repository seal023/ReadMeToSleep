import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, TextInput,
} from 'react-native';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { ScreenBackButton } from '../../components/ui/ScreenBackButton';
import { useRouter } from 'expo-router';
import { useLanguage } from '../../hooks/useLanguage';
import {
  getStories, saveStory, deleteStory, getChildName, saveParentComment, getParentComment,
} from '../../services/storage';
import { playLocalFile, stopClonedAudio, getLastCloneError } from '../../services/clonedVoicePlayback';
import { COLORS, FONT } from '../../constants/theme';
import type { Story } from '../../types';

export default function ChildRecordingsScreen() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [recordings, setRecordings] = useState<Story[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [childName, setChildName] = useState<string>('');
  // 哪个录音的「写悄悄话」输入框是展开状态
  const [commentBoxFor, setCommentBoxFor] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<string>('');
  // 各录音已保存的家长悄悄话（按 story.id 存）
  const [comments, setComments] = useState<Record<string, string>>({});
  const commentInputRef = useRef<TextInput | null>(null);

  useEffect(() => { load(); }, []);

  // 组件卸载时停止播放
  useEffect(() => {
    return () => {
      stopClonedAudio();
    };
  }, []);

  async function load() {
    const all = await getStories();
    const recs = all.filter(s => s.type === 'recorded' || s.audioUri);
    setRecordings(recs);
    const name = await getChildName();
    setChildName(name);
    // 预读已保存的悄悄话，便于卡片上显示「已留言」徽标
    const map: Record<string, string> = {};
    for (const r of recs) {
      const c = await getParentComment(r.id);
      if (c?.text) map[r.id] = c.text;
    }
    setComments(map);
  }

  async function toggleLike(story: Story) {
    const updated = { ...story, isLiked: !story.isLiked };
    await saveStory(updated);
    setRecordings(prev => prev.map(s => s.id === story.id ? updated : s));
  }

  async function playRecording(story: Story) {
    if (!story.audioUri) return;

    // 正在播放同一个 → 停止
    if (playingId === story.id) {
      stopClonedAudio();
      setPlayingId(null);
      return;
    }

    // 停止上一段（若有），再播放当前
    stopClonedAudio();
    setPlayingId(null);

    try {
      // ⚠️ 不要用外层的 playingId 判断：它是本次渲染时的快照（此刻通常还是 null），
      //    闭包里拿到的一直是旧值，播完就永远回不到「▶ 播放」。改成函数式更新。
      const onEnded = () => setPlayingId((cur) => (cur === story.id ? null : cur));
      // 用统一的播放入口：会自动解析沙盒路径（升级后容器 UUID 变了也能找到文件），
      // 并配置正确的音频会话（静音模式也能出声）。
      const ok = await playLocalFile(story.audioUri, onEnded);
      if (!ok) {
        Alert.alert(t('rec.playFail'), getLastCloneError() || t('rec.playFailMsg'));
        return;
      }
      setPlayingId(story.id);
    } catch (e) {
      console.error('播放失败:', e);
      Alert.alert(t('rec.playFail'), String((e as Error)?.message || e));
    }
  }

  async function handleDelete(story: Story) {
    Alert.alert(
      t('common.confirm'),
      t('rec.deleteMsg').replace('{title}', story.title),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: async () => {
          // 如果正在播放被删除的录音，先停
          if (playingId === story.id) {
            stopClonedAudio();
            setPlayingId(null);
          }
          await deleteStory(story.id);
          setRecordings(prev => prev.filter(s => s.id !== story.id));
        }},
      ],
    );
  }

  function openCommentBox(story: Story) {
    setCommentBoxFor(story.id);
    setCommentDraft(comments[story.id] ?? '');
    setTimeout(() => commentInputRef.current?.focus(), 120);
  }

  async function saveComment(story: Story) {
    const text = commentDraft.trim();
    if (!text) return;
    await saveParentComment(story.id, text);
    setComments(prev => ({ ...prev, [story.id]: text }));
    setCommentBoxFor(null);
    setCommentDraft('');
    Alert.alert(t('rec.savedTitle'), t('rec.savedMsg'));
  }

  function closeCommentBox() {
    setCommentBoxFor(null);
    setCommentDraft('');
  }

  function formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN', {
      month: 'numeric',
      day: 'numeric',
    });
  }

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.scrollRoot} contentContainerStyle={styles.scroll}>
      <ScreenBackButton onPress={() => router.back()} />
      <View style={styles.raccoWrap}>
        <Racco state="happy" size={100} />
      </View>
      <Text style={styles.title}>
        {childName ? t('rec.titleNamed').replace('{name}', childName) : t('myStories.title')}
      </Text>

      {recordings.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🎤</Text>
          <Text style={styles.emptyText}>{t('rec.empty')}</Text>
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
                <Text style={styles.actionText}>
                  {playingId === story.id ? t('rec.stop') : t('rec.play')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(story)}>
                <Text style={styles.deleteText}>{t('rec.delete')}</Text>
              </TouchableOpacity>
            </View>
            {/* 听后给宝贝写悄悄话 / 赞扬（Issue 2） */}
            <TouchableOpacity style={styles.commentBtn} onPress={() => openCommentBox(story)}>
              <Text style={styles.commentBtnText}>
                💌 {comments[story.id] ? t('rec.editNote') : t('rec.writeNote')}
              </Text>
            </TouchableOpacity>
            {commentBoxFor === story.id ? (
              <View style={styles.commentBox}>
                <TextInput
                  ref={commentInputRef}
                  style={styles.commentInput}
                  placeholder={t('rec.notePh')}
                  placeholderTextColor={COLORS.textSub}
                  value={commentDraft}
                  onChangeText={setCommentDraft}
                  multiline
                  maxLength={200}
                />
                <View style={styles.commentBoxActions}>
                  <TouchableOpacity style={styles.commentCancel} onPress={closeCommentBox}>
                    <Text style={styles.commentCancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.commentSend} onPress={() => saveComment(story)}>
                    <Text style={styles.commentSendText}>{t('rec.send')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : comments[story.id] ? (
              <View style={styles.commentSaved}>
                <Text style={styles.commentSavedLabel}>{t('rec.savedBadge')}</Text>
                <Text style={styles.commentSavedText}>{comments[story.id]}</Text>
              </View>
            ) : null}
          </View>
        ))
      )}
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  scrollRoot: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  raccoWrap: { alignItems: 'center', marginVertical: 16 },
  title: { fontSize: 22, textAlign: 'center', marginBottom: 16, color: COLORS.text, fontFamily: FONT.rounded },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 56, marginBottom: 12 },
  emptyText: { fontSize: 15, color: COLORS.textLight, textAlign: 'center' },
  card: { backgroundColor: COLORS.card, borderRadius: 24, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '600', flex: 1, marginRight: 8, color: COLORS.text },
  cardMeta: { flexDirection: 'row', marginTop: 6, marginBottom: 10 },
  metaText: { fontSize: 13, color: COLORS.textSub },
  cardActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, backgroundColor: COLORS.skyBlue, borderRadius: 22, paddingVertical: 8, alignItems: 'center' },
  playingBtn: { flex: 1, backgroundColor: COLORS.purple, borderRadius: 22, paddingVertical: 8, alignItems: 'center' },
  deleteBtn: { flex: 1, backgroundColor: COLORS.pinkLight, borderRadius: 22, paddingVertical: 8, alignItems: 'center' },
  actionText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  deleteText: { fontSize: 14, fontWeight: '600', color: COLORS.pink },
  // 写悄悄话入口按钮（全宽，独立于播放/删除）
  commentBtn: { marginTop: 10, backgroundColor: '#FFF3E0', borderRadius: 22, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#FFCC80' },
  commentBtnText: { fontSize: 14, fontWeight: '600', color: '#F7A072' },
  // 展开的输入区
  commentBox: { marginTop: 10, backgroundColor: '#FFFDF7', borderRadius: 22, padding: 12, borderWidth: 1, borderColor: '#FFE0B2' },
  commentInput: { minHeight: 64, maxHeight: 140, textAlignVertical: 'top', fontSize: 15, color: COLORS.text, padding: 8 },
  commentBoxActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  commentCancel: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 18, backgroundColor: '#EEE' },
  commentCancelText: { fontSize: 14, color: COLORS.textSub, fontWeight: '600' },
  commentSend: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 18, backgroundColor: COLORS.orange },
  commentSendText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  // 已保存的悄悄话展示
  commentSaved: { marginTop: 10, backgroundColor: '#FFF8E1', borderRadius: 22, padding: 12, borderWidth: 1, borderColor: '#FFCC80' },
  commentSavedLabel: { fontSize: 12, fontWeight: '700', color: '#F7A072', marginBottom: 4 },
  commentSavedText: { fontSize: 14, color: '#3D3229', lineHeight: 22 },
});
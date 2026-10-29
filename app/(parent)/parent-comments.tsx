import React, { useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert,
} from 'react-native';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT } from '../../constants/theme';
import {
  getStories,
  getProgress,
  saveParentComment,
  getParentComment,
  type ParentComment,
} from '../../services/storage';
import type { Story } from '../../types';
import storiesIndex from '../../data/classic-stories/stories-index.json';

interface PickItem {
  id: string;
  title: string;
  listened: boolean;
  lastAt: string;
}

export default function ParentComments() {
  const [items, setItems] = useState<PickItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const normalizeTitle = (raw: any): string => {
        if (typeof raw === 'string') return raw;
        if (raw && typeof raw === 'object') return raw.zh ?? raw.en ?? '';
        return '';
      };
      const created: Story[] = await getStories();
      const createdItems: PickItem[] = created.map((s) => ({ id: s.id, title: normalizeTitle(s.title), listened: false, lastAt: '' }));
      const classicItems: PickItem[] = (storiesIndex as any[]).map((s) => ({
        id: s.id,
        title: normalizeTitle(s.title),
        listened: false,
        lastAt: '',
      }));
      // 合并：自建故事优先，经典故事补充
      const merged = [...createdItems];
      const have = new Set(createdItems.map((i) => i.id));
      for (const c of classicItems) {
        if (!have.has(c.id)) merged.push(c);
      }

      // 已听优先级：读进度，标记已听并按最近收听时间倒序排到前面
      const p = await getProgress();
      const lastAtMap = new Map<string, string>();
      for (const l of p.listenLog || []) {
        const prev = lastAtMap.get(l.id);
        if (!prev || l.at > prev) lastAtMap.set(l.id, l.at);
      }
      const listenedSet = new Set(p.listenedStories || []);

      const withFlags: PickItem[] = merged.map((m) => ({
        id: m.id,
        title: m.title,
        listened: listenedSet.has(m.id),
        lastAt: lastAtMap.get(m.id) || '',
      }));
      withFlags.sort((a, b) => {
        if (a.listened !== b.listened) return a.listened ? -1 : 1;
        if (a.listened && b.listened) return (b.lastAt || '').localeCompare(a.lastAt || '');
        return 0;
      });

      setItems(withFlags);
    })();
  }, []);

  const displayItems = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.title.toLowerCase().includes(q));
  })();

  const selectStory = async (id: string) => {
    setSelectedId(id);
    const existing: ParentComment | null = await getParentComment(id);
    setDraft(existing?.text ?? '');
    setSavedAt(existing?.updatedAt ?? null);
  };

  const onSave = async () => {
    if (!selectedId) {
      Alert.alert('请先选择一篇故事');
      return;
    }
    if (!draft.trim()) {
      Alert.alert('悄悄话不能为空');
      return;
    }
    await saveParentComment(selectedId, draft.trim());
    setSavedAt(new Date().toISOString());
    Alert.alert('已保存 💌', '孩子听完这篇故事时就能看到你的悄悄话啦');
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← 返回</Text>
        </TouchableOpacity>

        <View style={styles.raccoWrap}>
          <Racco state="happy" size={100} />
        </View>
        <Text style={styles.header}>给孩子写悄悄话</Text>
        <Text style={styles.sub}>选择一篇故事，写下你的专属鼓励。孩子听完故事时，会以动画形式看到这条悄悄话。</Text>

        {/* 搜索框 */}
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="搜索故事名称…"
            placeholderTextColor={COLORS.textLight}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>① 选择故事{search ? `（${displayItems.length}）` : ''}</Text>
        <View style={styles.pickWrap}>
          {displayItems.map((it) => (
            <TouchableOpacity
              key={it.id}
              style={[
                styles.pickItem,
                selectedId === it.id && styles.pickItemActive,
                it.listened && styles.pickItemListened,
              ]}
              onPress={() => selectStory(it.id)}
            >
              {it.listened ? <Text style={styles.listenedBadge}>✓</Text> : null}
              <Text
                style={[
                  styles.pickText,
                  selectedId === it.id && styles.pickTextActive,
                ]}
                numberOfLines={1}
              >
                {it.title}
              </Text>
            </TouchableOpacity>
          ))}
          {displayItems.length === 0 ? (
            <Text style={styles.emptyText}>没有找到匹配的故事</Text>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>② 写下悄悄话</Text>
        <TextInput
          style={styles.input}
          multiline
          placeholder="例如：宝贝今天听得真认真，爸爸/妈妈爱你～"
          placeholderTextColor={COLORS.textLight}
          value={draft}
          onChangeText={setDraft}
          editable={!!selectedId}
        />
        {savedAt ? (
          <Text style={styles.savedHint}>✅ 已于 {new Date(savedAt).toLocaleString('zh-CN')} 保存</Text>
        ) : null}

        <TouchableOpacity
          style={[styles.saveBtn, !selectedId && styles.saveBtnDisabled]}
          onPress={onSave}
          disabled={!selectedId}
        >
          <Text style={styles.saveBtnText}>💾 保存悄悄话</Text>
        </TouchableOpacity>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 8 },
  backText: { fontSize: 16, color: COLORS.orange, fontWeight: '600' },
  raccoWrap: { alignItems: 'center', marginVertical: 8 },
  header: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', color: COLORS.text, fontFamily: FONT.rounded },
  sub: { fontSize: 13, color: COLORS.textSub, textAlign: 'center', marginTop: 6, marginBottom: 16, lineHeight: 20 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: COLORS.text },
  searchClear: { fontSize: 16, color: COLORS.textLight, marginLeft: 8, padding: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 8, marginTop: 8 },
  pickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pickItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pickItemListened: { backgroundColor: COLORS.orangeLight },
  pickItemActive: { backgroundColor: COLORS.orangeLight, borderColor: COLORS.orange },
  listenedBadge: { color: COLORS.orange, fontWeight: 'bold', marginRight: 6, fontSize: 14 },
  pickText: { fontSize: 13, color: COLORS.text, maxWidth: 220 },
  pickTextActive: { color: COLORS.orange, fontWeight: '600' },
  emptyText: { fontSize: 13, color: COLORS.textLight, paddingVertical: 12 },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    fontSize: 15,
    color: COLORS.text,
    height: 110,
    textAlignVertical: 'top',
    marginTop: 4,
  },
  savedHint: { fontSize: 12, color: COLORS.mint, marginTop: 8, textAlign: 'center' },
  saveBtn: {
    backgroundColor: COLORS.orange,
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
});

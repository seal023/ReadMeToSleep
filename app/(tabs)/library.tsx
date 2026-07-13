import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import Racco from '../../components/common/Racco';
import { useLanguage } from '../../hooks/useLanguage';
import storiesIndex from '../../data/classic-stories/stories-index.json';

const TAGS = [
  { label: '动物', emoji: '🐾' },
  { label: '冒险', emoji: '🏰' },
  { label: '友情', emoji: '🤝' },
  { label: '魔法', emoji: '✨' },
  { label: '成长', emoji: '🌱' },
  { label: '自然', emoji: '🌿' },
];

const TAG_EMOJI: Record<string, string> = {
  动物: '🐾',
  冒险: '🏰',
  友情: '🤝',
  魔法: '✨',
  成长: '🌱',
  自然: '🌿',
};

type TabKey = 'classic' | 'ai' | 'travel';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'classic', label: '经典故事' },
  { key: 'ai', label: 'AI生成' },
  { key: 'travel', label: '旅行打卡' },
];

interface StoryItem {
  id: string;
  title: { zh: string; en: string };
  tags: string[];
  duration: number;
  source: string;
}

export default function LibraryScreen() {
  const router = useRouter();
  const { language } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabKey>('classic');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (activeTab !== 'classic') return [];
    let list = storiesIndex as StoryItem[];
    if (activeTag) list = list.filter(s => s.tags.includes(activeTag));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(s => s.title.zh.toLowerCase().includes(q) || s.title.en.toLowerCase().includes(q));
    }
    return list;
  }, [activeTab, activeTag, search]);

  const fmtDuration = (sec: number) => `${Math.floor(sec / 60)}分钟`;

  const renderCard = ({ item }: { item: StoryItem }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/story/${item.id}`)}
    >
      <View style={styles.cardLeft}>
        <Text style={styles.cardEmoji}>{TAG_EMOJI[item.tags[0]] || '📖'}</Text>
      </View>
      <View style={styles.cardCenter}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {language === 'zh' ? item.title.zh : item.title.en}
        </Text>
        <View style={styles.tagRow}>
          {item.tags.map(tag => (
            <Text key={tag} style={styles.tag}>
              {tag}
            </Text>
          ))}
          <Text style={styles.duration}>{fmtDuration(item.duration)}</Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <Text style={styles.playBtn}>▶️</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Racco state="idle" size={100} />
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="搜索故事..."
            placeholderTextColor="#999"
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Tab Switch */}
      <View style={styles.tabRow}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive]}
            onPress={() => { setActiveTab(tab.key); setActiveTag(null); }}
          >
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tag Filter */}
      {activeTab === 'classic' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tagBar}
          contentContainerStyle={styles.tagBarInner}
        >
          <TouchableOpacity
            style={[styles.tagChip, !activeTag && styles.tagChipActive]}
            onPress={() => setActiveTag(null)}
          >
            <Text style={[styles.tagChipText, !activeTag && styles.tagChipTextActive]}>
              全部
            </Text>
          </TouchableOpacity>
          {TAGS.map(tag => (
            <TouchableOpacity
              key={tag.label}
              style={[styles.tagChip, activeTag === tag.label && styles.tagChipActive]}
              onPress={() => setActiveTag(activeTag === tag.label ? null : tag.label)}
            >
              <Text style={[styles.tagChipText, activeTag === tag.label && styles.tagChipTextActive]}>
                {tag.emoji} {tag.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Story List */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderCard}
        contentContainerStyle={filtered.length ? styles.list : styles.emptyList}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📚</Text>
            <Text style={styles.emptyText}>暂无故事</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5E6' },
  header: { alignItems: 'center', paddingTop: 16, paddingBottom: 8 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    width: '88%', backgroundColor: '#fff',
    borderRadius: 24, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#F0D9B5',
    height: 42, marginTop: 4,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#333', height: '100%' },
  clearBtn: { fontSize: 14, color: '#999', marginLeft: 4 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8 },
  tabBtn: {
    flex: 1, paddingVertical: 8, alignItems: 'center',
    borderRadius: 20, marginHorizontal: 4,
    backgroundColor: '#FFF0D6', borderWidth: 1, borderColor: '#F0D9B5',
  },
  tabBtnActive: { backgroundColor: '#FFB347', borderColor: '#FF8C00' },
  tabLabel: { fontSize: 13, color: '#888', fontWeight: '500' },
  tabLabelActive: { color: '#fff', fontWeight: '700' },
  tagBar: { maxHeight: 40 },
  tagBarInner: { paddingHorizontal: 12, paddingVertical: 4 },
  tagChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#FFF0D6', marginHorizontal: 4, borderWidth: 1, borderColor: '#F0D9B5',
  },
  tagChipActive: { backgroundColor: '#FFB347', borderColor: '#FF8C00' },
  tagChipText: { fontSize: 12, color: '#888' },
  tagChipTextActive: { color: '#fff', fontWeight: '600' },
  list: { paddingHorizontal: 12, paddingTop: 8 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardLeft: { marginRight: 12 },
  cardEmoji: { fontSize: 32 },
  cardCenter: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#333' },
  tagRow: { flexDirection: 'row', marginTop: 4, flexWrap: 'wrap' },
  tag: {
    fontSize: 11, color: '#FF8C00', backgroundColor: '#FFF0D6',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginRight: 6,
  },
  duration: { fontSize: 11, color: '#999' },
  cardRight: { marginLeft: 8 },
  playBtn: { fontSize: 18 },
  emptyList: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#999' },
});

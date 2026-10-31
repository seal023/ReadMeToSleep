import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { useLanguage } from '../../hooks/useLanguage';
import storiesIndex from '../../data/classic-stories/stories-index.json';
import { CLASSIC_EN_IDS, getStories, getProgress } from '../../services/storage';
import type { Story, Progress } from '../../types';

// 与 data/classic-stories/stories-index.json 的实际标签保持一致（100 篇公版故事）
const TAGS = [
  { key: 'cat.fairy', zh: '童话', emoji: '📖' },
  { key: 'cat.growth', zh: '成长', emoji: '🌱' },
  { key: 'cat.fable', zh: '寓言', emoji: '🦉' },
  { key: 'cat.animal', zh: '动物', emoji: '🐾' },
  { key: 'cat.bedtime', zh: '睡前', emoji: '🌙' },
  { key: 'cat.nature', zh: '自然', emoji: '🍃' },
];

// 故事数据中的中文分类 → i18n key（英文界面下卡片标签也能本地化）
const TAG_KEY: Record<string, string> = {
  童话: 'cat.fairy',
  成长: 'cat.growth',
  寓言: 'cat.fable',
  动物: 'cat.animal',
  睡前: 'cat.bedtime',
  自然: 'cat.nature',
};

const TAG_EMOJI: Record<string, string> = {
  童话: '📖',
  成长: '🌱',
  寓言: '🦉',
  动物: '🐾',
  睡前: '🌙',
  自然: '🍃',
};

type TabKey = 'classic' | 'ai' | 'travel';
const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'classic', labelKey: 'library.tab.classic' },
  { key: 'ai', labelKey: 'library.tab.ai' },
  { key: 'travel', labelKey: 'library.tab.travel' },
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
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabKey>('classic');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // #6 同步：AI / 旅行两个标签原来恒返回 []（与「我的故事」对不上）。
  // 现从存储真实加载，与「我的故事」(created=ai_generated / checkins) 同源。
  const [aiStories, setAiStories] = useState<Story[]>([]);
  const [travelCheckins, setTravelCheckins] = useState<Progress['checkIns']>([]);

  // 每次回到本页（从创作 / 打卡页返回）都刷新，保证与「我的故事」实时同步
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const [all, prog] = await Promise.all([getStories(), getProgress()]);
          if (!alive) return;
          setAiStories(all.filter((s) => s.type === 'ai_generated'));
          setTravelCheckins(prog.checkIns ?? []);
        } catch {
          /* 读取失败保持空列表，不阻塞浏览 */
        }
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (activeTab === 'classic') {
      let list = storiesIndex as StoryItem[];
      // 英文模式：经典故事库仅有部分具备英文正文，过滤到只有英文的故事，
      // 保证「英文界面下故事必须是英文」（不含英文的故事不会以中文出现在英文列表）
      if (language === 'en') list = list.filter((s) => CLASSIC_EN_IDS.has(s.id));
      if (activeTag) list = list.filter((s) => s.tags.includes(activeTag));
      if (q) list = list.filter((s) => s.title.zh.toLowerCase().includes(q) || s.title.en.toLowerCase().includes(q));
      return list;
    }
    if (activeTab === 'ai') {
      let list = aiStories;
      if (q) list = list.filter((s) => (s.title || '').toLowerCase().includes(q));
      return list;
    }
    // travel：与「我的故事 → 旅行打卡」同一数据源
    let list = travelCheckins;
    if (q) list = list.filter((c) => c.location.toLowerCase().includes(q));
    return list;
  }, [activeTab, activeTag, search, language, aiStories, travelCheckins]);

  const fmtDuration = (sec: number) => `${Math.floor(sec / 60)} ${t('common.minute')}`;

  const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const renderClassic = ({ item }: { item: StoryItem }) => (
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
              {t(TAG_KEY[tag] ?? tag)}
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

  const renderAi = ({ item }: { item: Story }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/story/${item.id}`)}
    >
      <View style={styles.cardLeft}>
        <Text style={styles.cardEmoji}>✨</Text>
      </View>
      <View style={styles.cardCenter}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <View style={styles.tagRow}>
          <Text style={styles.tag}>{t('library.tab.ai')}</Text>
          {item.duration ? <Text style={styles.duration}>{fmtDuration(item.duration)}</Text> : null}
        </View>
      </View>
      <View style={styles.cardRight}>
        <Text style={styles.playBtn}>▶️</Text>
      </View>
    </TouchableOpacity>
  );

  const renderTravel = ({ item }: { item: Progress['checkIns'][number] }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => router.push('/story/travel-checkin')}
    >
      <View style={styles.cardLeft}>
        <Text style={styles.cardEmoji}>✈️</Text>
      </View>
      <View style={styles.cardCenter}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.location}</Text>
        <View style={styles.tagRow}>
          <Text style={styles.tag}>{t('library.tab.travel')}</Text>
          <Text style={styles.duration}>{fmtDate(item.date)}</Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <Text style={styles.playBtn}>▶️</Text>
      </View>
    </TouchableOpacity>
  );

  const renderItem = ({ item }: { item: any }) => {
    if (activeTab === 'classic') return renderClassic({ item: item as StoryItem });
    if (activeTab === 'ai') return renderAi({ item: item as Story });
    return renderTravel({ item: item as Progress['checkIns'][number] });
  };

  return (
    <CartoonScreen gradient="day" decor>
      <View style={styles.container}>
      <View style={styles.header}>
        <Racco state="idle" size={100} />
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={t('library.search')}
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

      <View style={styles.tabRow}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={activeTab === tab.key ? styles.tabBtnActive : styles.tabBtn}
            onPress={() => { setActiveTab(tab.key); setActiveTag(null); }}
          >
            <Text style={activeTab === tab.key ? styles.tabLabelActive : styles.tabLabel}>
              {t(tab.labelKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'classic' && (
        <View style={styles.tagBarWrap}>
          <TouchableOpacity
            style={!activeTag ? styles.tagChipActive : styles.tagChip}
            onPress={() => setActiveTag(null)}
          >
            <Text style={!activeTag ? styles.tagChipTextActive : styles.tagChipText}>
              {t('library.all')}
            </Text>
          </TouchableOpacity>
          {TAGS.map(tag => (
            <TouchableOpacity
              key={tag.zh}
              style={activeTag === tag.zh ? styles.tagChipActive : styles.tagChip}
              onPress={() => setActiveTag(activeTag === tag.zh ? null : tag.zh)}
            >
              <Text style={activeTag === tag.zh ? styles.tagChipTextActive : styles.tagChipText}>
                {tag.emoji} {t(tag.key)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={filtered as any}
        keyExtractor={(item, index) => {
          const it = item as any;
          return it?.id ?? `${it?.location ?? 'x'}_${it?.date ?? index}`;
        }}
        renderItem={renderItem}
        contentContainerStyle={filtered.length ? styles.list : styles.emptyList}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📚</Text>
            <Text style={styles.emptyText}>{t('library.empty')}</Text>
          </View>
        }
      />
      </View>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  tabBtnActive: {
    flex: 1, paddingVertical: 8, alignItems: 'center',
    borderRadius: 20, marginHorizontal: 4,
    backgroundColor: '#FFB347', borderWidth: 1, borderColor: '#FF8C00',
  },
  tabLabel: { fontSize: 13, color: '#888', fontWeight: '500' },
  tabLabelActive: { fontSize: 13, color: '#fff', fontWeight: '700' },
  tagBarWrap: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingVertical: 6,
  },
  tagChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16,
    backgroundColor: '#FFF0D6', marginHorizontal: 4, marginVertical: 4, borderWidth: 1, borderColor: '#F0D9B5',
  },
  tagChipActive: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#FFB347', marginHorizontal: 4, marginVertical: 4, borderWidth: 1, borderColor: '#FF8C00',
  },
  tagChipText: { fontSize: 13, color: '#4E342E', fontWeight: '600' },
  tagChipTextActive: { fontSize: 13, color: '#fff', fontWeight: '600' },
  list: { paddingHorizontal: 12, paddingTop: 8 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14,
    padding: 14, marginBottom: 10,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.05)', elevation: 2,
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
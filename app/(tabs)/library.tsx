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
// 长篇原创故事轻量索引（id/标题/标签/时长/来源/长度档），不含正文
import longIndex from '../../data/classic-stories/long/index.json';
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
  /** 长度桶：short=经典短篇，5-10 / 15-20=长篇档位 */
  bucket: 'short' | '5-10' | '15-20';
  /** 是否具备英文正文（英文界面/英文筛选下可用） */
  hasEn: boolean;
}

// 经典故事（id 以 classic- 开头）：统一归入「短篇」桶；英文可见性按 CLASSIC_EN_IDS
const classicItems: StoryItem[] = (storiesIndex as Array<{
  id: string; title: { zh: string; en: string }; tags: string[]; duration: number; source: string;
}>).map((s) => ({
  id: s.id,
  title: s.title,
  tags: s.tags,
  duration: s.duration,
  source: s.source,
  bucket: 'short' as const,
  hasEn: CLASSIC_EN_IDS.has(s.id),
}));

// 长篇原创故事（无版权）：按 lengthMin 归入对应桶，全部具备英文
const longItems: StoryItem[] = (longIndex as Array<{
  id: string; title: { zh: string; en: string }; tags: string[]; duration: number; source: string; lengthMin: string;
}>).map((s) => ({
  id: s.id,
  title: s.title,
  tags: s.tags,
  duration: s.duration,
  source: s.source,
  bucket: (s.lengthMin === '15-20' ? '15-20' : '5-10') as '5-10' | '15-20',
  hasEn: true,
}));

// 故事库 = 经典短篇 + 长篇原创，统一作为「经典」Tab 的数据源
const CLASSIC_LIBRARY: StoryItem[] = [...classicItems, ...longItems];

// 长度档筛选选项（全部 / 短篇 / 5-10 / 15-20）
const LENGTH_FILTERS: { key: 'all' | 'short' | '5-10' | '15-20'; labelKey: string }[] = [
  { key: 'all', labelKey: 'library.all' },
  { key: 'short', labelKey: 'library.len.short' },
  { key: '5-10', labelKey: 'library.len.5-10' },
  { key: '15-20', labelKey: 'library.len.15-20' },
];

// 语言筛选选项（全部 / 中文 / 英文）
const LANG_FILTERS: { key: 'all' | 'zh' | 'en'; labelKey: string }[] = [
  { key: 'all', labelKey: 'library.all' },
  { key: 'zh', labelKey: 'library.lang.zh' },
  { key: 'en', labelKey: 'library.lang.en' },
];

// 排序选项
const SORT_KEYS: { key: 'recommend' | 'durationAsc' | 'durationDesc' | 'name'; labelKey: string }[] = [
  { key: 'recommend', labelKey: 'library.sort.recommend' },
  { key: 'durationAsc', labelKey: 'library.sort.durationAsc' },
  { key: 'durationDesc', labelKey: 'library.sort.durationDesc' },
  { key: 'name', labelKey: 'library.sort.name' },
];

export default function LibraryScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabKey>('classic');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // 长度 / 语言 / 排序 三个整理维度
  const [lengthFilter, setLengthFilter] = useState<'all' | 'short' | '5-10' | '15-20'>('all');
  const [langFilter, setLangFilter] = useState<'all' | 'zh' | 'en'>('all');
  const [sortKey, setSortKey] = useState<'recommend' | 'durationAsc' | 'durationDesc' | 'name'>('recommend');
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
      let list = CLASSIC_LIBRARY;
      // 长度筛选
      if (lengthFilter !== 'all') list = list.filter((s) => s.bucket === lengthFilter);
      // 类型筛选
      if (activeTag) list = list.filter((s) => s.tags.includes(activeTag));
      // 语言筛选 + 生效语言：en 只显示有英文的故事；zh 显示全部；all 沿用全局语言
      let effLang: 'zh' | 'en' = language;
      if (langFilter === 'en') {
        list = list.filter((s) => s.hasEn);
        effLang = 'en';
      } else if (langFilter === 'zh') {
        effLang = 'zh';
      } else if (language === 'en') {
        list = list.filter((s) => s.hasEn);
      }
      // 搜索：标题中英 + 标签
      if (q) {
        list = list.filter(
          (s) =>
            s.title.zh.toLowerCase().includes(q) ||
            s.title.en.toLowerCase().includes(q) ||
            s.tags.some((tg) => tg.toLowerCase().includes(q)),
        );
      }
      // 排序
      const sorted = [...list];
      if (sortKey === 'durationAsc') sorted.sort((a, b) => a.duration - b.duration);
      else if (sortKey === 'durationDesc') sorted.sort((a, b) => b.duration - a.duration);
      else if (sortKey === 'name') {
        const pick = (s: StoryItem) => (effLang === 'en' ? s.title.en : s.title.zh);
        sorted.sort((a, b) => pick(a).localeCompare(pick(b), effLang === 'en' ? 'en' : 'zh'));
      }
      return { list: sorted, effLang };
    }

    if (activeTab === 'ai') {
      let list = aiStories;
      if (q) list = list.filter((s) => (s.title || '').toLowerCase().includes(q));
      return { list, effLang: language };
    }
    // travel：与「我的故事 → 旅行打卡」同一数据源
    let list = travelCheckins;
    if (q) list = list.filter((c) => c.location.toLowerCase().includes(q));
    return { list, effLang: language };
  }, [activeTab, activeTag, search, language, lengthFilter, langFilter, sortKey, aiStories, travelCheckins]);

  const classicResult = activeTab === 'classic' ? (filtered as { list: StoryItem[]; effLang: 'zh' | 'en' }) : null;
  const effLang: 'zh' | 'en' = classicResult ? classicResult.effLang : language;
  const classicList: StoryItem[] = classicResult ? classicResult.list : [];

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
          {effLang === 'zh' ? item.title.zh : item.title.en}
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

  const aiResult = activeTab === 'ai' ? (filtered as { list: Story[]; effLang: 'zh' | 'en' }) : null;
  const travelResult = activeTab === 'travel' ? (filtered as { list: Progress['checkIns']; effLang: 'zh' | 'en' }) : null;
  const listData: any[] =
    activeTab === 'classic' ? classicList : activeTab === 'ai' ? (aiResult?.list ?? []) : (travelResult?.list ?? []);

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
        <>
          {/* 长度档筛选 */}
          <View style={styles.tagBarWrap}>
            {LENGTH_FILTERS.map((f) => (
              <TouchableOpacity
                key={f.key}
                style={lengthFilter === f.key ? styles.tagChipActive : styles.tagChip}
                onPress={() => setLengthFilter(f.key)}
              >
                <Text style={lengthFilter === f.key ? styles.tagChipTextActive : styles.tagChipText}>
                  {t(f.labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 类型筛选 */}
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

          {/* 语言 + 排序 */}
          <View style={styles.tagBarWrap}>
            {LANG_FILTERS.map((f) => (
              <TouchableOpacity
                key={f.key}
                style={langFilter === f.key ? styles.tagChipActive : styles.tagChip}
                onPress={() => setLangFilter(f.key)}
              >
                <Text style={langFilter === f.key ? styles.tagChipTextActive : styles.tagChipText}>
                  {t(f.labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.filterDivider} />
            {SORT_KEYS.map((s) => (
              <TouchableOpacity
                key={s.key}
                style={sortKey === s.key ? styles.tagChipActive : styles.tagChip}
                onPress={() => setSortKey(s.key)}
              >
                <Text style={sortKey === s.key ? styles.tagChipTextActive : styles.tagChipText}>
                  {t(s.labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <FlatList
        data={listData}
        keyExtractor={(item, index) => {
          const it = item as any;
          return it?.id ?? `${it?.location ?? 'x'}_${it?.date ?? index}`;
        }}
        renderItem={renderItem}
        contentContainerStyle={listData.length ? styles.list : styles.emptyList}
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
    borderRadius: 26, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#F0D9B5',
    height: 42, marginTop: 4,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#3D3229', height: '100%' },
  clearBtn: { fontSize: 14, color: '#A8988A', marginLeft: 4 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8 },
  tabBtn: {
    flex: 1, paddingVertical: 8, alignItems: 'center',
    borderRadius: 24, marginHorizontal: 4,
    backgroundColor: '#FFF0D6', borderWidth: 1, borderColor: '#F0D9B5',
  },
  tabBtnActive: {
    flex: 1, paddingVertical: 8, alignItems: 'center',
    borderRadius: 24, marginHorizontal: 4,
    backgroundColor: '#FFB347', borderWidth: 1, borderColor: '#FF8C00',
  },
  tabLabel: { fontSize: 13, color: '#A8988A', fontWeight: '500' },
  tabLabelActive: { fontSize: 13, color: '#fff', fontWeight: '700' },
  tagBarWrap: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingVertical: 6,
  },
  tagChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 22,
    backgroundColor: '#FFF0D6', marginHorizontal: 4, marginVertical: 4, borderWidth: 1, borderColor: '#F0D9B5',
  },
  tagChipActive: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 22,
    backgroundColor: '#FFB347', marginHorizontal: 4, marginVertical: 4, borderWidth: 1, borderColor: '#FF8C00',
  },
  tagChipText: { fontSize: 13, color: '#3D3229', fontWeight: '600' },
  tagChipTextActive: { fontSize: 13, color: '#fff', fontWeight: '600' },
  filterDivider: { width: 1, height: 22, backgroundColor: '#E8D5B5', marginHorizontal: 8, marginVertical: 4 },
  list: { paddingHorizontal: 12, paddingTop: 8 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 22,
    /** iPad 横屏：卡片限宽居中，不拉成整屏一条 */
    width: '100%', maxWidth: 820, alignSelf: 'center',
    padding: 14, marginBottom: 10,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.05)', elevation: 2,
  },
  cardLeft: { marginRight: 12 },
  cardEmoji: { fontSize: 32 },
  cardCenter: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#3D3229' },
  tagRow: { flexDirection: 'row', marginTop: 4, flexWrap: 'wrap' },
  tag: {
    fontSize: 11, color: '#FF8C00', backgroundColor: '#FFF0D6',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginRight: 6,
  },
  duration: { fontSize: 11, color: '#A8988A' },
  cardRight: { marginLeft: 8 },
  playBtn: { fontSize: 18 },
  emptyList: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#A8988A' },
});
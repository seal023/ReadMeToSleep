import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { useLanguage } from '../../hooks/useLanguage';
import storiesIndex from '../../data/classic-stories/stories-index.json';
// 长篇原创故事轻量索引（id/标题/标签/时长/来源/长度档），不含正文
import longIndex from '../../data/classic-stories/long/index.json';
import {
  CLASSIC_EN_IDS,
  getStories,
  getProgress,
  FREE_OFFLINE_POOL_IDS,
  getFreeCloneStoryId,
} from '../../services/storage';
import { isPremium } from '../../services/iap';
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
  /**
   * v95 反馈 #2：原来 3 行筛选 chip（长度 / 类型 / 语言+排序）在竖屏吃掉半个屏幕，
   * 列表只剩一条缝；横屏时 header+筛选把高度占满，FlatList 没有剩余高度 → 完全划不动。
   * 现在：分类 chip 单行横向滚动，长度/语言/排序收进「筛选」弹层；FlatList 显式 flex:1。
   */
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  /**
   * v100 反馈 #2：手机横屏时顶部几乎贴边（搜索框紧贴屏幕上沿），看着很压抑。
   * CartoonScreen 里的 SafeAreaView 在横屏下顶边安全区为 0，页面得自己让出留白。
   */
  const headerPadTop = isLandscape ? 16 : 10;
  // 横屏手机 / iPad：卡片两列，一次能看到更多
  const twoCols = width >= 700 || isLandscape;
  const [filterOpen, setFilterOpen] = useState(false);
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
  // 免费用户故事库门禁：会员全部可听；免费仅 5 篇经典池 + 已完成的免费克隆篇可听
  const [isPremiumUser, setIsPremiumUser] = useState(false);
  const [freeCloneStoryId, setFreeCloneStoryId] = useState<string | null>(null);

  // 每次回到本页（从创作 / 打卡页返回）都刷新，保证与「我的故事」实时同步
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const [all, prog, premium, cloneId] = await Promise.all([
            getStories(),
            getProgress(),
            isPremium(),
            getFreeCloneStoryId(),
          ]);
          if (!alive) return;
          setAiStories(all.filter((s) => s.type === 'ai_generated'));
          setTravelCheckins(prog.checkIns ?? []);
          setIsPremiumUser(!!premium);
          setFreeCloneStoryId(cloneId);
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

  // 不足 1 分钟的故事直接显示秒，别显示成「0 分钟」（时长单位统一走 storage.storyDurationSec 折算）
  const fmtDuration = (sec: number) =>
    sec >= 60 ? `${Math.floor(sec / 60)} ${t('common.minute')}` : `${Math.round(sec)} ${t('common.second')}`;

  const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** 免费用户的故事库门禁：会员全部可听；免费仅 5 篇经典池 + 已完成的免费克隆篇可听 */
  const isClassicFree = (id: string): boolean => {
    if (isPremiumUser) return true;
    if (FREE_OFFLINE_POOL_IDS.includes(id)) return true;
    if (freeCloneStoryId && id === freeCloneStoryId) return true;
    return false;
  };

  /** 点击被锁定的非池内故事 → 诙谐付费窗，引导去订阅解锁全部 */
  const openPoolPaywall = () => {
    Alert.alert(t('gate.poolExceedTitle'), t('gate.poolExceedMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('gate.goUnlock'), onPress: () => router.push('/(parent)/subscription?plan=yearly') },
    ]);
  };

  const renderClassic = ({ item }: { item: StoryItem }) => {
    const locked = !isClassicFree(item.id);
    return (
      <TouchableOpacity
        style={[styles.card, twoCols ? styles.cardHalf : styles.cardSingle, locked && styles.cardLocked]}
        activeOpacity={0.7}
        onPress={() => (locked ? openPoolPaywall() : router.push(`/story/${item.id}`))}
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
          <Text style={locked ? styles.lockBtn : styles.playBtn}>{locked ? '🔒' : '▶️'}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderAi = ({ item }: { item: Story }) => (
    <TouchableOpacity
      style={[styles.card, twoCols ? styles.cardHalf : styles.cardSingle]}
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
      style={[styles.card, twoCols ? styles.cardHalf : styles.cardSingle]}
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

  /** 已启用的「非默认」筛选数，显示在筛选按钮上，避免收进弹层后不知道有没有筛 */
  const activeFilterCount =
    (lengthFilter !== 'all' ? 1 : 0) + (langFilter !== 'all' ? 1 : 0) + (sortKey !== 'recommend' ? 1 : 0);

  return (
    <>
    <CartoonScreen gradient="day" decor>
      <View style={styles.container}>
      {/* 顶栏：小浣熊 + 搜索同一行，横屏时压到最小高度，把空间让给列表 */}
      <View style={[styles.header, isLandscape && styles.headerLandscape, { paddingTop: headerPadTop }]}>
        <Racco state="idle" size={isLandscape ? 54 : 78} />
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={t('library.search')}
            placeholderTextColor="#999"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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

      {/*
        分类改成**单行横向滚动**：原来 7 个分类 + 4 个时长 + 3 个语言 + 4 个排序
        挤成 4 行，竖屏占掉半屏、横屏直接把列表压没（无法上滑）。
        现在常驻只有这一行，长度 / 语言 / 排序收进右侧「筛选」弹层。
      */}
      {activeTab === 'classic' && (
        <View style={styles.chipBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipScroll}
            style={styles.chipScrollWrap}
          >
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
          </ScrollView>
          <TouchableOpacity
            style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnOn]}
            onPress={() => setFilterOpen(true)}
            activeOpacity={0.85}
          >
            <Text style={[styles.filterBtnText, activeFilterCount > 0 && styles.filterBtnTextOn]}>
              ⚙️ {t('library.filter')}{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        style={styles.listFlex}
        data={listData}
        // 列数变化必须换 key，否则 FlatList 复用旧布局会错位
        key={twoCols ? 'grid' : 'row'}
        numColumns={twoCols ? 2 : 1}
        columnWrapperStyle={twoCols ? styles.columnWrap : undefined}
        keyExtractor={(item, index) => {
          const it = item as any;
          return it?.id ?? `${it?.location ?? 'x'}_${it?.date ?? index}`;
        }}
        renderItem={renderItem}
        contentContainerStyle={listData.length ? styles.list : styles.emptyList}
        showsVerticalScrollIndicator={!isLandscape}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📚</Text>
            <Text style={styles.emptyText}>{t('library.empty')}</Text>
          </View>
        }
      />
      </View>
    </CartoonScreen>

    {/* 筛选弹层：长度 / 语言 / 排序 */}
    <Modal
      visible={filterOpen}
      transparent
      animationType="fade"
      /**
       * v96 反馈 #2：iOS 的 Modal 默认只支持竖屏，一旦弹出就会把整个界面掰回竖屏
       * （孩子正横着用 iPad / 手机横屏，点「筛选」屏幕突然转正）。
       * 显式声明四种方向，弹层跟随当前方向。
       */
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={() => setFilterOpen(false)}
    >
      <View style={styles.modalRoot}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setFilterOpen(false)}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{t('library.filterTitle')}</Text>
            <TouchableOpacity
              onPress={() => {
                setLengthFilter('all');
                setLangFilter('all');
                setSortKey('recommend');
              }}
            >
              <Text style={styles.sheetReset}>{t('library.reset')}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sheetLabel}>{t('library.byLength')}</Text>
          <View style={styles.sheetRow}>
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

          <Text style={styles.sheetLabel}>{t('library.byLang')}</Text>
          <View style={styles.sheetRow}>
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
          </View>

          <Text style={styles.sheetLabel}>{t('library.bySort')}</Text>
          <View style={styles.sheetRow}>
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

          <TouchableOpacity style={styles.sheetDone} onPress={() => setFilterOpen(false)}>
            <Text style={styles.sheetDoneText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // 小浣熊与搜索框同一行：竖屏 Racco 78px，横屏 54px，整体高度不再吃掉半屏
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 10, paddingBottom: 4, paddingHorizontal: 14,
  },
  headerLandscape: { paddingTop: 2, paddingBottom: 0 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 26, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#F0D9B5', height: 40, marginLeft: 6,
    maxWidth: 640,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#3D3229', height: '100%' },
  clearBtn: { fontSize: 14, color: '#A8988A', marginLeft: 4 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 6, marginTop: 2 },
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
  // 单行分类条：左侧横向滚动，右侧固定「筛选」按钮
  chipBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: 8, paddingRight: 10, paddingVertical: 2, marginBottom: 2,
  },
  chipScrollWrap: { flex: 1 },
  chipScroll: { alignItems: 'center', paddingRight: 4 },
  filterBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#FFF0D6', borderWidth: 1, borderColor: '#F0D9B5', marginLeft: 6,
  },
  filterBtnOn: { backgroundColor: '#FFB347', borderColor: '#FF8C00' },
  filterBtnText: { fontSize: 12, color: '#8A7A6A', fontWeight: '700' },
  filterBtnTextOn: { color: '#fff' },
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
  // 关键修复：FlatList 必须占满剩余高度，否则横屏时内容被挤出屏幕且无法上滑
  listFlex: { flex: 1 },
  columnWrap: { gap: 10 },
  list: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 24 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 22,
    padding: 14, marginBottom: 10,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.05)', elevation: 2,
  },
  /** 单列：撑满一行；两列（横屏 / iPad）：均分宽度 */
  cardSingle: { width: '100%' },
  cardHalf: { flex: 1 },
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
  /** 免费用户被锁定的非池内故事：整体压暗 + 挂锁图标，提示需会员解锁 */
  cardLocked: { opacity: 0.55 },
  lockBtn: { fontSize: 18, opacity: 0.85 },
  emptyList: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 16, color: '#A8988A' },

  // 筛选弹层
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: '#FFFBF4',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#3D3229' },
  sheetReset: { fontSize: 13, color: '#FF8C00', fontWeight: '600' },
  sheetLabel: { fontSize: 12, color: '#A8988A', fontWeight: '600', marginTop: 12, marginBottom: 2 },
  sheetRow: { flexDirection: 'row', flexWrap: 'wrap' },
  sheetDone: {
    marginTop: 20, height: 46, borderRadius: 23,
    backgroundColor: '#FFB347', alignItems: 'center', justifyContent: 'center',
  },
  sheetDoneText: { fontSize: 16, color: '#fff', fontWeight: '700' },
});
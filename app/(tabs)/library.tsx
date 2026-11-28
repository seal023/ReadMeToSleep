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
  useWindowDimensions,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { SceneRaccoLayer } from '../../components/ui/SceneRaccoLayer';
import { SCENE_BACKGROUNDS, SCENE_SHIFT_Y } from '../../constants/sceneBackgrounds';
import ClayIcon, { type ClayIconName } from '../../components/ui/ClayIcon';
import { useLanguage } from '../../hooks/useLanguage';
import { useRaccoGuide } from '../../hooks/useRaccoGuide';
import { FONT, COLORS, RADIUS } from '../../constants/theme';
import {
  CLAY_SHADOW, clayCard, clayChip, clayChipActive, clayInput, claySurface,
} from '../../constants/clayStyle';
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
// 图标走 3D 粘土素材：童话=书、成长=嫩芽、寓言=猫头鹰、动物=爪印、睡前=月亮、自然=地球
const TAGS: { key: string; zh: string; icon: ClayIconName }[] = [
  { key: 'cat.fairy', zh: '童话', icon: 'book' },
  { key: 'cat.growth', zh: '成长', icon: 'catGrowth' },
  { key: 'cat.fable', zh: '寓言', icon: 'catOwl' },
  { key: 'cat.animal', zh: '动物', icon: 'catAnimal' },
  { key: 'cat.bedtime', zh: '睡前', icon: 'moon' },
  { key: 'cat.nature', zh: '自然', icon: 'globe' },
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

// 故事卡片左侧图标：按分类取粘土素材，兜底=书
const TAG_ICON: Record<string, ClayIconName> = {
  童话: 'book',
  成长: 'catGrowth',
  寓言: 'catOwl',
  动物: 'catAnimal',
  睡前: 'moon',
  自然: 'globe',
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

  // 小浣熊向导：进页面说一句"这里有好多故事，慢慢挑"
  const guide = useRaccoGuide({ autoKey: 'b1', autoDelay: 1200, enterFrom: 'left', gesture: 'wave' });

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

  /**
   * v108：非池内免费故事不再「点了直接弹窗」——改为允许进入详情页看开头，
   * 由详情页负责「不可滚动 / 滑动弹付费窗 / 不播放」。这里只负责导航。
   */

  const renderClassic = ({ item }: { item: StoryItem }) => {
    const locked = !isClassicFree(item.id);
    // 严格限定：只有那 5 篇免费池经典故事才高亮「免费畅听」（会员解锁的全部经典故事不高亮）
    const isFreePool = FREE_OFFLINE_POOL_IDS.includes(item.id);
    return (
      <TouchableOpacity
        style={[
          styles.card,
          twoCols ? styles.cardHalf : styles.cardSingle,
          locked && styles.cardLocked,
          isFreePool && styles.cardFree,
        ]}
        activeOpacity={0.7}
        onPress={() => router.push(`/story/${item.id}`)}
      >
        <View style={styles.cardLeft}>
          <ClayIcon name={TAG_ICON[item.tags[0]] ?? 'book'} size={38} />
        </View>
        <View style={styles.cardCenter}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {effLang === 'zh' ? item.title.zh : item.title.en}
          </Text>
          <View style={styles.tagRow}>
            {isFreePool && <Text style={styles.freeTag}>{t('library.freeListen')}</Text>}
            {item.tags.map(tag => (
              <Text key={tag} style={styles.tag}>
                {t(TAG_KEY[tag] ?? tag)}
              </Text>
            ))}
            <Text style={styles.duration}>{fmtDuration(item.duration)}</Text>
          </View>
        </View>
        <View style={styles.cardRight}>
          <ClayIcon name={locked ? 'lock' : 'play'} size={28} />
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
        <ClayIcon name="starBig" size={38} />
      </View>
      <View style={styles.cardCenter}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <View style={styles.tagRow}>
          <Text style={styles.tag}>{t('library.tab.ai')}</Text>
          {item.duration ? <Text style={styles.duration}>{fmtDuration(item.duration)}</Text> : null}
        </View>
      </View>
      <View style={styles.cardRight}>
        <ClayIcon name="play" size={28} />
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
        <ClayIcon name="plane" size={38} />
      </View>
      <View style={styles.cardCenter}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.location}</Text>
        <View style={styles.tagRow}>
          <Text style={styles.tag}>{t('library.tab.travel')}</Text>
          <Text style={styles.duration}>{fmtDate(item.date)}</Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <ClayIcon name="play" size={28} />
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

  // Scene background only in true landscape (an iPad in portrait must keep the animated raccoon layout)
  const isWide = width >= 768 && isLandscape;

  return (
    <View style={styles.root}>
    <CartoonScreen
      gradient="day"
      decor={false}
      wide={false}
      backgroundSource={isWide ? SCENE_BACKGROUNDS.library : undefined}
      backgroundResizeMode="contain"
      backgroundShiftY={isWide ? SCENE_SHIFT_Y : undefined}
    >
      <View style={[styles.container, isWide && styles.containerWide]}>
      {/* 顶栏：横屏时搜索框在左、小浣熊移到右上角并放大；竖屏保持浣熊在左 */}
      <View style={[styles.header, isLandscape && styles.headerLandscape, { paddingTop: headerPadTop }]}>
        {!isLandscape && !isWide && (
          <View style={styles.raccoWrap}>
            <Racco
              state={guide.state}
              size={78}
              showSpeechBubble={!!guide.line}
              speechText={guide.line}
              gesture={guide.gesture}
              anim={guide.anim}
              animPlaying={guide.animPlaying}
            />
          </View>
        )}
        <View style={[styles.searchBox, isLandscape && styles.searchBoxLandscape]}>
          <ClayIcon name="search" size={22} style={styles.searchIcon} />
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
        {isLandscape && !isWide && (
          <View style={styles.raccoWrapLandscape}>
            <Racco
              state={guide.state}
              size={144}
              showSpeechBubble={!!guide.line}
              speechText={guide.line}
              enterFrom={guide.enterFrom}
              gesture={guide.gesture}
              anim={guide.anim}
              animPlaying={guide.animPlaying}
            />
          </View>
        )}
      </View>

      <View style={styles.tabRow}>
        {TABS.filter((tab) => isPremiumUser || tab.key === 'classic').map(tab => (
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
                <View style={styles.chipInner}>
                  <ClayIcon name={tag.icon} size={20} />
                  <Text style={activeTag === tag.zh ? styles.tagChipTextActive : styles.tagChipText}>
                    {t(tag.key)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnOn]}
            onPress={() => setFilterOpen(true)}
            activeOpacity={0.85}
          >
            <View style={styles.chipInner}>
              <ClayIcon name="settings" size={18} />
              <Text style={[styles.filterBtnText, activeFilterCount > 0 && styles.filterBtnTextOn]}>
                {t('library.filter')}{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
              </Text>
            </View>
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
            <ClayIcon name="book" size={64} />
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
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
          </ScrollView>
        </View>
      </View>
    </Modal>
    {isWide && (
      <SceneRaccoLayer
        text={guide.line}
        onPress={() => guide.say('b1')}
      />
    )}
    </View>
  );
}

/**
 * 3D 粘土化（2026-11-25）：所有控件从"扁平 App 控件"换成软陶质感——
 * 厚圆角 + 内高光 + 暖投影 + COLORS token。父母端不在此列。
 */
const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1 },
  // iPad landscape: content column on the right, static scene on the left (castle library)
  containerWide: {
    width: '52%',
    maxWidth: 620,
    alignSelf: 'flex-end',
    marginRight: 18,
  },
  // 小浣熊与搜索框同一行：竖屏 Racco 78px，横屏放大，整体高度不再吃掉半屏
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 10, paddingBottom: 4, paddingHorizontal: 14,
  },
  headerLandscape: { paddingTop: 2, paddingBottom: 0, alignItems: 'flex-start' },
  // 横屏：搜索框在左、浣熊从最右往左让到搜索框右侧的空白区（红圈位置，中心约屏宽80%）
  raccoWrap: {},
  raccoWrapLandscape: { marginLeft: 'auto', marginRight: '15%' },
  // 搜索框：粘土凹槽（内阴影为主，像在软陶上按出的槽）
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    ...clayInput,
    borderRadius: RADIUS.pill, paddingHorizontal: 14,
    height: 44, marginLeft: 6, maxWidth: 640,
  },
  searchBoxLandscape: { marginLeft: 0, marginTop: 8, flex: 0, width: 640 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: COLORS.text, height: '100%', fontFamily: FONT.body },
  clearBtn: { fontSize: 16, color: COLORS.textLight, marginLeft: 4 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 6, marginTop: 2 },
  tabBtn: {
    flex: 1, paddingVertical: 9, alignItems: 'center',
    marginHorizontal: 4, ...clayChip,
  },
  tabBtnActive: {
    flex: 1, paddingVertical: 9, alignItems: 'center',
    marginHorizontal: 4, ...clayChipActive,
  },
  tabLabel: { fontSize: 15, color: COLORS.textSub, fontFamily: FONT.rounded },
  tabLabelActive: { fontSize: 15, color: COLORS.onPrimary, fontFamily: FONT.rounded },
  // 单行分类条：左侧横向滚动，右侧固定「筛选」按钮
  chipBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingLeft: 8, paddingRight: 10, paddingVertical: 2, marginBottom: 2,
  },
  chipScrollWrap: { flex: 1 },
  chipScroll: { alignItems: 'center', paddingRight: 4 },
  // 图标+文字水平排列（胶囊内部）
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  filterBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    marginLeft: 6, ...clayChip,
  },
  filterBtnOn: { ...clayChipActive },
  filterBtnText: { fontSize: 12, color: COLORS.textSub, fontWeight: '700' },
  filterBtnTextOn: { color: COLORS.onPrimary },
  tagChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    marginHorizontal: 4, marginVertical: 4, ...clayChip,
  },
  tagChipActive: {
    paddingHorizontal: 14, paddingVertical: 7,
    marginHorizontal: 4, marginVertical: 4, ...clayChipActive,
  },
  tagChipText: { fontSize: 15, color: COLORS.text, fontFamily: FONT.rounded },
  tagChipTextActive: { fontSize: 15, color: COLORS.onPrimary, fontFamily: FONT.rounded },
  filterDivider: { width: 1, height: 22, backgroundColor: COLORS.divider, marginHorizontal: 8, marginVertical: 4 },
  // 关键修复：FlatList 必须占满剩余高度，否则横屏时内容被挤出屏幕且无法上滑
  listFlex: { flex: 1 },
  columnWrap: { gap: 10 },
  list: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 24 },
  // 故事卡片：厚软陶块 + 暖投影
  card: {
    flexDirection: 'row', alignItems: 'center',
    ...clayCard,
    padding: 14, marginBottom: 12,
  },
  /** 单列：撑满一行；两列（横屏 / iPad）：均分宽度 */
  cardSingle: { width: '100%' },
  cardHalf: { flex: 1 },
  cardLeft: { marginRight: 12 },
  cardCenter: { flex: 1 },
  cardTitle: { fontSize: 17, fontFamily: FONT.rounded, color: COLORS.text },
  tagRow: { flexDirection: 'row', marginTop: 4, flexWrap: 'wrap' },
  tag: {
    fontSize: 11, color: COLORS.orangeDeep, backgroundColor: COLORS.orangeLight,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.xs, marginRight: 6,
  },
  duration: { fontSize: 11, color: COLORS.textLight },
  cardRight: { marginLeft: 8 },
  /** 免费用户被锁定的非池内故事：整体压暗 + 挂锁图标，提示需会员解锁 */
  cardLocked: { opacity: 0.55 },
  /** 免费畅听的 5 篇经典池：暖色高亮边框 + 浅橙底 + 发光投影 */
  cardFree: {
    borderWidth: 2, borderColor: COLORS.orangeDeep,
    ...claySurface(COLORS.orangeLight, 'active'),
  },
  /** 「免费畅听」金色标签 */
  freeTag: {
    fontSize: 11, color: COLORS.onPrimary, backgroundColor: COLORS.orangeDeep, fontWeight: '700',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.xs, marginRight: 6,
  },
  emptyList: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 17, color: COLORS.textLight, fontFamily: FONT.rounded, marginTop: 14 },

  // 筛选弹层
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: COLORS.cardSoft,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '88%', // 横屏矮屏限制高度，内部 ScrollView 滚动，避免顶部筛选项被裁
    boxShadow: CLAY_SHADOW.large,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },
  sheetTitle: { fontSize: 19, fontFamily: FONT.rounded, color: COLORS.text },
  sheetReset: { fontSize: 13, color: COLORS.orangeDeep, fontWeight: '600' },
  sheetLabel: { fontSize: 12, color: COLORS.textLight, fontWeight: '600', marginTop: 12, marginBottom: 2 },
  sheetRow: { flexDirection: 'row', flexWrap: 'wrap' },
  sheetDone: {
    marginTop: 20, height: 48, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.orangeDeep, alignItems: 'center', justifyContent: 'center',
    boxShadow: CLAY_SHADOW.active, elevation: 5,
  },
  sheetDoneText: { fontSize: 17, color: COLORS.onPrimary, fontFamily: FONT.rounded },
});
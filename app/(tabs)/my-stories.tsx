import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { Link, router, useFocusEffect } from 'expo-router';
import { getStories, deleteStory } from '../../services/storage';
import { getProgress } from '../../services/storage';
import { useLanguage } from '../../hooks/useLanguage';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import type { Story, Progress } from '../../types';

type Tab = 'created' | 'recorded' | 'checkins';

const TABS: { key: Tab; labelKey: string }[] = [
  { key: 'created', labelKey: 'myStories.tab.created' },
  { key: 'recorded', labelKey: 'myStories.tab.recorded' },
  { key: 'checkins', labelKey: 'myStories.tab.checkins' },
];

const BADGES = [
  { key: 'flag', emoji: '🚩', labelKey: 'badge.flag' },
  { key: 'bronze', emoji: '🏅', labelKey: 'badge.bronze' },
  { key: 'silver', emoji: '🥈', labelKey: 'badge.silver' },
  { key: 'gold', emoji: '🥇', labelKey: 'badge.gold' },
];

export default function MyStoriesScreen() {
  const { t } = useLanguage();
  /**
   * v100 反馈 #2：横屏时顶部三段 Tab 紧贴屏幕上沿，看着压抑。
   * 与故事库一致：横屏补 16pt 顶部留白（竖屏不动）。
   */
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const topPad = isLandscape ? 16 : 0;
  const [tab, setTab] = useState<Tab>('created');
  const [stories, setStories] = useState<Story[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);

  const loadData = useCallback(async () => {
    const [all, prog] = await Promise.all([getStories(), getProgress()]);
    setStories(all);
    setProgress(prog);
  }, []);

  // #6 同步：从打卡/创作页返回时刷新，否则切 tab 不重新读，列表与故事库对不上
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const filtered = stories.filter(s => {
    if (tab === 'created') return s.type === 'ai_generated';
    if (tab === 'recorded') return s.type === 'recorded';
    return false;
  });

  const fmtDuration = (sec: number) => {
    if (!sec) return '';
    const m = Math.floor(sec / 60);
    return m > 0 ? `${m} ${t('common.minute')}` : `${sec} ${t('common.second')}`;
  };

  const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const handleDelete = (id: string) => {
    Alert.alert(t('myStories.confirmTitle'), t('myStories.confirmMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteStory(id);
          loadData();
        },
      },
    ]);
  };

  /**
   * v99 反馈 #3：整张卡片都是「进入故事」的点击区，右侧那颗按钮是「立刻播放」。
   * 删除从按钮行里撤掉，改成「长按卡片」——避免孩子误触把故事删掉。
   */
  const handleOpen = (id: string) => {
    router.push(`/story/${id}`);
  };

  const handlePlay = (id: string) => {
    router.push(`/story/${id}?autoplay=1`);
  };

  // ---- AI生成 ----
  const renderCreatedItem = ({ item }: { item: Story }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => handleOpen(item.id)}
      onLongPress={() => handleDelete(item.id)}
      delayLongPress={600}
    >
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardMeta}>{fmtDate(item.createdAt)}</Text>
        <Text style={styles.cardMeta}>{fmtDuration(item.duration)}</Text>
      </View>
      <TouchableOpacity
        style={styles.playBtn}
        onPress={() => handlePlay(item.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.playBtnText}>▶ {t('myStories.playNow')}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // ---- 我的录音 ----
  const renderRecordedItem = ({ item }: { item: Story }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => handleOpen(item.id)}
      onLongPress={() => handleDelete(item.id)}
      delayLongPress={600}
    >
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardMeta}>{fmtDate(item.createdAt)}</Text>
        <Text style={styles.cardMeta}>{fmtDuration(item.duration)}</Text>
      </View>
      <TouchableOpacity
        style={styles.playBtn}
        onPress={() => handlePlay(item.id)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.playBtnText}>▶ {t('myStories.playNow')}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // ---- 旅行打卡 ----
  const renderCheckin = ({ item }: { item: Progress['checkIns'][number] }) => (
    <View style={styles.card}>
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.location}</Text>
        <Text style={styles.cardMeta}>{fmtDate(item.date)}</Text>
      </View>
    </View>
  );

  const EmptyState = ({ emoji, text }: { emoji: string; text: string }) => (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );

  /** 卡片操作说明：点一下进去听、长按删除（删除不再做成按钮，避免误触） */
  const ListHint = () => <Text style={styles.listHint}>{t('myStories.listHint')}</Text>;

  return (
    <CartoonScreen gradient="day" decor>
      <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(tabItem => (
          <TouchableOpacity
            key={tabItem.key}
            style={[styles.tab, tab === tabItem.key && styles.tabActive]}
            onPress={() => setTab(tabItem.key)}
          >
            <Text style={[styles.tabLabel, tab === tabItem.key && styles.tabLabelActive]}>
              {t(tabItem.labelKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {tab === 'created' && (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderCreatedItem}
          ListHeaderComponent={filtered.length > 0 ? <ListHint /> : null}
          contentContainerStyle={filtered.length === 0 ? { flex: 1 } : undefined}
          ListEmptyComponent={
            <EmptyState emoji="📝" text={t('myStories.empty.created')} />
          }
        />
      )}

      {tab === 'recorded' && (
        <View style={{ flex: 1 }}>
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={renderRecordedItem}
            ListHeaderComponent={filtered.length > 0 ? <ListHint /> : null}
            contentContainerStyle={filtered.length === 0 ? { flex: 1 } : undefined}
            ListEmptyComponent={
              <EmptyState emoji="🎤" text={t('myStories.empty.recorded')} />
            }
          />
          <Link href="/(tabs)/record" asChild>
            <TouchableOpacity style={styles.recordBtn}>
              <Text style={styles.recordBtnText}>🎤 {t('myStories.startRecord')}</Text>
            </TouchableOpacity>
          </Link>
        </View>
      )}

      {tab === 'checkins' && (
        <View style={{ flex: 1 }}>
          {/* 勋章墙 */}
          <View style={styles.badgeSection}>
            <Text style={styles.badgeTitle}>🏆 {t('myStories.badgeWall')}</Text>
            <View style={styles.badgeRow}>
              {BADGES.map(b => {
                // travel-checkin 存储的 badges 是 emoji 串（🚩🏅🥈🥇），故按 emoji 比对（之前误用 key 永不命中）
                const earned = progress?.badges.includes(b.emoji);
                return (
                  <View key={b.key} style={[styles.badge, !earned && styles.badgeLocked]}>
                    <Text style={[styles.badgeEmoji, !earned && styles.badgeEmojiLocked]}>
                      {b.emoji}
                    </Text>
                    <Text style={[styles.badgeLabel, !earned && styles.badgeLabelLocked]}>
                      {t(b.labelKey)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* 打卡列表 */}
          <FlatList
            data={progress?.checkIns ?? []}
            keyExtractor={(item, i) => item.location + item.date + i}
            renderItem={renderCheckin}
            contentContainerStyle={(progress?.checkIns?.length ?? 0) === 0 ? { flex: 1 } : undefined}
            ListEmptyComponent={
              <EmptyState emoji="🚩" text={t('myStories.empty.checkins')} />
            }
          />
        </View>
      )}
      </View>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 18,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 18,
  },
  tabActive: {
    backgroundColor: '#F2827F',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#A8988A',
  },
  tabLabelActive: {
    color: '#FFF',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    /** iPad 横屏：卡片限宽居中 */
    width: '100%', maxWidth: 820, alignSelf: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 18,
    padding: 14,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
    elevation: 2,
  },
  cardMain: {
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3D3229',
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 12,
    color: '#A8988A',
    marginBottom: 2,
  },
  listHint: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    paddingHorizontal: 20,
    marginTop: 12,
    fontSize: 12,
    color: '#A8988A',
  },
  /** 「立刻播放」胶囊按钮（点卡片本身是进入故事页，两者职责分开） */
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#F2827F',
    marginLeft: 8,
  },
  playBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFF',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyEmoji: {
    fontSize: 56,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#BBB',
  },
  recordBtn: {
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: '#F2827F',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  recordBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  badgeSection: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 18,
    padding: 14,
  },
  badgeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3D3229',
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  badge: {
    alignItems: 'center',
    width: 72,
  },
  badgeLocked: {
    opacity: 0.35,
  },
  badgeEmoji: {
    fontSize: 36,
    marginBottom: 4,
  },
  badgeEmojiLocked: {
    filter: 'grayscale(100%)',
  },
  badgeLabel: {
    fontSize: 11,
    color: '#7A6A5D',
    fontWeight: '500',
  },
  badgeLabelLocked: {
    color: '#BBB',
  },
});

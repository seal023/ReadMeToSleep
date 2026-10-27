import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Link, router } from 'expo-router';
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
  const [tab, setTab] = useState<Tab>('created');
  const [stories, setStories] = useState<Story[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);

  const loadData = useCallback(async () => {
    const [all, prog] = await Promise.all([getStories(), getProgress()]);
    setStories(all);
    setProgress(prog);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = stories.filter(s => {
    if (tab === 'created') return s.type === 'ai_generated';
    if (tab === 'recorded') return s.audioUri && s.type !== 'classic' && s.type !== 'travel';
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

  const handlePlay = (id: string) => {
    router.push(`/story/${id}`);
  };

  // ---- AI生成 ----
  const renderCreatedItem = ({ item }: { item: Story }) => (
    <View style={styles.card}>
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardMeta}>{fmtDate(item.createdAt)}</Text>
        <Text style={styles.cardMeta}>{fmtDuration(item.duration)}</Text>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => handlePlay(item.id)}>
          <Text style={styles.iconText}>▶️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(item.id)}>
          <Text style={styles.iconText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ---- 我的录音 ----
  const renderRecordedItem = ({ item }: { item: Story }) => (
    <View style={styles.card}>
      <View style={styles.cardMain}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardMeta}>{fmtDate(item.createdAt)}</Text>
        <Text style={styles.cardMeta}>{fmtDuration(item.duration)}</Text>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => handlePlay(item.id)}>
          <Text style={styles.iconText}>▶️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(item.id)}>
          <Text style={styles.iconText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
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

  return (
    <CartoonScreen gradient="day" decor>
      <View style={styles.container}>
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
            contentContainerStyle={filtered.length === 0 ? { flex: 1 } : undefined}
            ListEmptyComponent={
              <EmptyState emoji="🎤" text={t('myStories.empty.recorded')} />
            }
          />
          <Link href="/(tabs)/create" asChild>
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
                const earned = progress?.badges.includes(b.key);
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
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: '#FF6B6B',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
  },
  tabLabelActive: {
    color: '#FFF',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
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
    color: '#333',
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 12,
    color: '#999',
    marginBottom: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF0ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 14,
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
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
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
    borderRadius: 12,
    padding: 14,
  },
  badgeTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
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
    color: '#666',
    fontWeight: '500',
  },
  badgeLabelLocked: {
    color: '#BBB',
  },
});

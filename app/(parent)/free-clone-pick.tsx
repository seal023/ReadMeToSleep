import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import { useLanguage } from '@/hooks/useLanguage';
import { COLORS, FONT } from '@/constants/theme';
import storiesIndex from '../../data/classic-stories/stories-index.json';
import { FREE_OFFLINE_POOL_IDS, getFreeCloneTarget, setFreeCloneStoryId } from '@/services/storage';
import { voiceDisplayName } from '@/services/voiceCatalog';

/**
 * 免费用户「1 次克隆体验」的专属故事选择页。
 * 克隆成功后由 voice-clone.tsx 带过来：这里让用户从「3 分钟以内的短篇」里挑 1 篇，
 * 选中的那篇会用克隆声讲、永久落盘到手机、之后无限收听；克隆声锁死仅限这篇。
 */
export default function FreeClonePickPage() {
  const { t, language } = useLanguage();
  const uiLang: 'zh' | 'en' = language === 'en' ? 'en' : 'zh';
  const router = useRouter();

  const [target, setTarget] = useState<string>('');
  const [stories, setStories] = useState<
    { id: string; title: { zh: string; en: string }; duration: number }[]
  >([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const tg = await getFreeCloneTarget();
      // 没有克隆对象（不该到达这里）→ 直接回家长主页，避免空页卡死
      if (!tg) {
        router.replace('/(parent)/hub');
        return;
      }
      if (!alive) return;
      setTarget(tg);
      // 只给「3 分钟以内」且不在 5 篇免费经典池里的短篇，确保是一份额外的专属福利
      const list = (storiesIndex as Array<{
        id: string;
        title: { zh: string; en: string };
        duration: number;
      }>)
        .filter((s) => s.duration <= 180 && !FREE_OFFLINE_POOL_IDS.includes(s.id))
        .map((s) => ({ id: s.id, title: s.title, duration: s.duration }));
      if (alive) setStories(list);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pick = async (id: string) => {
    if (saving) return;
    setSaving(true);
    await setFreeCloneStoryId(id);
    // 给一拍视觉反馈；真正的克隆合成在故事页首次播放时发生并永久缓存
    setTimeout(() => router.replace(`/story/${id}`), 500);
  };

  const fmtDuration = (sec: number) =>
    sec >= 60 ? `${Math.floor(sec / 60)} ${t('common.minute')}` : `${sec} ${t('common.second')}`;

  const name = target ? voiceDisplayName(target, uiLang) : '';

  return (
    <CartoonScreen gradient="candy" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.raccoTop}>
          <Racco state="happy" size={86} />
        </View>
        <Text style={styles.title}>{t('freeClone.title')}</Text>
        <Text style={styles.subtitle}>{t('freeClone.subtitle').replace('{name}', name)}</Text>
        <Text style={styles.hint}>{t('freeClone.hint')}</Text>

        <View style={styles.list}>
          {stories.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📚</Text>
              <Text style={styles.emptyText}>{t('freeClone.empty')}</Text>
            </View>
          ) : (
            stories.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.card}
                activeOpacity={0.7}
                disabled={saving}
                onPress={() => pick(s.id)}
              >
                <View style={styles.cardCenter}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {uiLang === 'zh' ? s.title.zh : s.title.en}
                  </Text>
                  <Text style={styles.cardDur}>{fmtDuration(s.duration)}</Text>
                </View>
                <Text style={styles.cardPlay}>▶️</Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {saving && (
          <View style={styles.saving}>
            <ActivityIndicator color="#9B7EDE" />
            <Text style={styles.savingText}>{t('freeClone.synthesizing')}</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.skipBtn}
          activeOpacity={0.85}
          disabled={saving}
          onPress={() => router.replace('/(parent)/hub')}
        >
          <Text style={styles.skipText}>{t('freeClone.skip')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, alignItems: 'center' },
  raccoTop: { alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 26, color: COLORS.purple, fontWeight: '700', fontFamily: FONT.rounded, textAlign: 'center' },
  subtitle: { fontSize: 14, color: COLORS.textSub, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  hint: { fontSize: 12, color: '#e67e22', textAlign: 'center', marginTop: 6 },
  list: { width: '100%', maxWidth: 560, marginTop: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 14,
    marginBottom: 10,
  },
  cardCenter: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#3D3229' },
  cardDur: { fontSize: 11, color: '#A8988A', marginTop: 4 },
  cardPlay: { fontSize: 18, marginLeft: 8 },
  empty: { alignItems: 'center', marginTop: 40 },
  emptyIcon: { fontSize: 46, marginBottom: 12 },
  emptyText: { fontSize: 14, color: '#A8988A', textAlign: 'center' },
  saving: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
  savingText: { fontSize: 13, color: COLORS.purple },
  skipBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: '#e0d4f0',
  },
  skipText: { fontSize: 14, color: '#9B7EDE', fontWeight: '600' },
});

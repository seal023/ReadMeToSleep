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
import { ScreenBackButton } from '@/components/ui/ScreenBackButton';
import { useLanguage } from '@/hooks/useLanguage';
import { COLORS, FONT } from '@/constants/theme';
import storiesIndex from '../../data/classic-stories/stories-index.json';
import {
  FREE_OFFLINE_POOL_IDS,
  getFreeCloneTarget,
  getFreeCloneStoryId,
  setFreeCloneStoryId,
  getStory,
} from '@/services/storage';
import { prewarmClonedAudio } from '@/services/clonedVoicePlayback';
import { voiceDisplayName } from '@/services/voiceCatalog';

type PoolItem = { id: string; title: { zh: string; en: string }; duration: number };

/**
 * 免费用户「1 次克隆体验」的专属故事选择页。
 * ---------------------------------------------------------------------------
 * 克隆成功后由 voice-clone.tsx 带过来：用户从「5 篇高亮经典池」里挑 1 篇，
 * 选中的那篇用克隆声讲、永久落盘到手机、之后无限收听；克隆声锁死仅限这篇，选好不可换。
 *
 * ⚠️ 与早期版本的区别（2026-11-04 修正）：此前错误地让免费用户从「池外任意短篇」里挑，
 * 与产品需求「5 个高亮故事中的一个」不符 —— 这里严格限定在 FREE_OFFLINE_POOL_IDS。
 */
export default function FreeClonePickPage() {
  const { t, language } = useLanguage();
  const uiLang: 'zh' | 'en' = language === 'en' ? 'en' : 'zh';
  const router = useRouter();

  const [target, setTarget] = useState<string>('');
  const [pickedId, setPickedId] = useState<string>('');
  const [stories, setStories] = useState<PoolItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [tg, pid] = await Promise.all([getFreeCloneTarget(), getFreeCloneStoryId()]);
      // 没有克隆对象（不该到达这里）→ 直接回家长主页，避免空页卡死
      if (!tg) {
        router.replace('/(parent)/hub');
        return;
      }
      if (!alive) return;
      setTarget(tg);
      setPickedId(pid);
      // 严格限定在 5 篇高亮经典池（保持池内既定顺序，不暴露池外其它故事）
      const byId = new Map<string, PoolItem>(
        (storiesIndex as PoolItem[]).map((s) => [s.id, s]),
      );
      const pool = FREE_OFFLINE_POOL_IDS.map((id) => byId.get(id)).filter(
        (s): s is PoolItem => Boolean(s),
      );
      if (alive) setStories(pool);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pick = async (id: string) => {
    if (saving) return;
    setSaving(true);
    await setFreeCloneStoryId(id);
    // 立刻把这篇用克隆声合成并落盘到本地缓存（秒出、零 token），
    // 满足「声音保存在当地手机、可无限次试听」；失败静默忽略，故事页首次播放仍会合成。
    try {
      const s = await getStory(id);
      const text = s ? (uiLang === 'en' && s.contentEn ? s.contentEn : s.content) : '';
      if (text) await prewarmClonedAudio(text, target, uiLang);
    } catch {
      /* 预热失败不影响主流程 */
    }
    // 带去故事页：该篇为免费克隆专属故事，会自动用克隆声朗读
    router.replace(`/story/${id}`);
  };

  const fmtDuration = (sec: number) =>
    sec >= 60 ? `${Math.floor(sec / 60)} ${t('common.minute')}` : `${sec} ${t('common.second')}`;

  const name = target ? voiceDisplayName(target, uiLang) : '';
  const picked = stories.find((s) => s.id === pickedId);

  return (
    <CartoonScreen gradient="candy" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <ScreenBackButton
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(parent)/hub'))}
        />
        <View style={styles.raccoTop}>
          <Racco state="happy" size={86} />
        </View>
        <Text style={styles.title}>{t('freeClone.title')}</Text>
        <Text style={styles.subtitle}>{t('freeClone.subtitle').replace('{name}', name)}</Text>

        {pickedId && picked ? (
          <>
            {/* 已选过：展示「收藏好啦」确认态，且锁死不可更换 */}
            <Text style={styles.pickedTitle}>{t('freeClone.pickedTitle')}</Text>
            <Text style={styles.subtitle}>{t('freeClone.pickedMsg').replace('{name}', name)}</Text>
            <View style={styles.pickedCard}>
              <Text style={styles.pickedEmoji}>📖</Text>
              <View style={styles.pickedInfo}>
                <Text style={styles.pickedName} numberOfLines={2}>
                  {uiLang === 'zh' ? picked.title.zh : picked.title.en}
                </Text>
                <Text style={styles.pickedDur}>{fmtDuration(picked.duration)}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={() => router.replace(`/story/${picked.id}`)}
            >
              <Text style={styles.primaryBtnText}>{t('freeClone.pick')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
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
          </>
        )}
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, alignItems: 'center' },
  raccoTop: { alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 26, color: COLORS.purple, fontWeight: '700', fontFamily: FONT.rounded, textAlign: 'center' },
  subtitle: { fontSize: 14, color: COLORS.textSub, textAlign: 'center', marginTop: 8, lineHeight: 22, paddingHorizontal: 8 },
  hint: { fontSize: 12, color: '#e67e22', textAlign: 'center', marginTop: 6, marginBottom: 4 },
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
  // 已选确认态
  pickedTitle: { fontSize: 22, color: COLORS.purple, fontWeight: '700', fontFamily: FONT.rounded, textAlign: 'center', marginTop: 8 },
  pickedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3ECFF',
    borderRadius: 22,
    padding: 16,
    marginTop: 16,
    marginBottom: 8,
    width: '100%',
    maxWidth: 560,
    borderWidth: 1.5,
    borderColor: '#D9C8F5',
  },
  pickedEmoji: { fontSize: 34, marginRight: 14 },
  pickedInfo: { flex: 1 },
  pickedName: { fontSize: 16, fontWeight: '700', color: '#3D3229', marginBottom: 4 },
  pickedDur: { fontSize: 12, color: '#9C8579' },
  primaryBtn: {
    backgroundColor: COLORS.purple,
    borderRadius: 26,
    paddingVertical: 14,
    paddingHorizontal: 40,
    marginTop: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

import { useMemo } from 'react';
import { router } from 'expo-router';
import { useWindowDimensions, View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import Constants from 'expo-constants';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT } from '../../constants/theme';
import { useLanguage } from '../../hooks/useLanguage';

/** 关于卡用：便于家长在真机上确认装的是哪一个包 */
const APP_VERSION: string = (Constants.expoConfig?.version as string | undefined) ?? '1.1.0';
const BUILD_NUMBER: string = (Constants.nativeBuildVersion as string | undefined) ?? '?';

interface CardDef {
  icon: string;
  title: string;
  desc: string;
  href?: string;
  action?: () => void;
}

/** 内容最大宽度：iPad 横屏下卡片不会被拉成一整屏那么宽 */
const MAX_CONTENT_WIDTH = 1024;

// 家长页沿用全局 3D 粘土风吉祥物（原 raccoon-parent.png 已并入 assets/clay）
export default function ParentHub() {
  const { t } = useLanguage();
  const { width, height } = useWindowDimensions();

  /**
   * iPad 是这个 App 的主要设备，横屏是主场景。
   * 横屏时一行 3 张卡、竖屏 2 张，卡片宽度按「可用宽度 ÷ 列数」算，
   * 并给内容区一个上限，避免 1366pt 宽屏上每张卡片宽过 600pt 显得松散。
   */
  const { cardWidth, columns } = useMemo(() => {
    const cols = width >= 900 ? 3 : 2;
    const contentW = Math.min(width, MAX_CONTENT_WIDTH) - 32;
    const gap = 12;
    return { cardWidth: (contentW - gap * (cols - 1)) / cols, columns: cols };
  }, [width]);

  /** 横屏高度紧张时收掉大浣熊，把首屏留给功能卡 */
  const compact = height < 500;

  const CARDS: CardDef[] = useMemo(() => [
    { icon: '🛡️', title: t('parentHub.card.sensitive.title'), desc: t('parentHub.card.sensitive.desc'), href: '/(parent)/sensitive-words' },
    { icon: '😴', title: t('parentHub.card.sleep.title'), desc: t('parentHub.card.sleep.desc'), href: '/(parent)/sleep-timer' },
    { icon: '🎤', title: t('parentHub.card.recordings.title'), desc: t('parentHub.card.recordings.desc'), href: '/(parent)/child-recordings' },
    { icon: '🎚️', title: t('parentHub.card.voiceSettings.title'), desc: t('parentHub.card.voiceSettings.desc'), href: '/(parent)/voices' },
    { icon: '🔊', title: t('parentHub.card.voice.title'), desc: t('parentHub.card.voice.desc'), href: '/(parent)/voice-clone' },
    { icon: '💳', title: t('parentHub.card.subscription.title'), desc: t('parentHub.card.subscription.desc'), href: '/(parent)/subscription' },
    { icon: '👤', title: t('parentHub.card.account.title'), desc: t('parentHub.card.account.desc'), href: '/(parent)/account' },
    // v84 反馈 #7：「关于」从孩子端设置页搬到家长模式（版本号是排查问题用的，家长才需要）
    { icon: 'ℹ️', title: t('parentHub.card.about.title'), desc: `v${APP_VERSION} · build ${BUILD_NUMBER}`, action: () => {
      Alert.alert(
        t('parentHub.card.about.title'),
        `${t('settings.about.description')}\n\nv${APP_VERSION} · build ${BUILD_NUMBER}\n${t('parentHub.card.about.desc')}`,
      );
    }},
    { icon: '📊', title: t('parentHub.card.stats.title'), desc: t('parentHub.card.stats.desc'), href: '/(parent)/statistics' },
    // 配色页在根级路由（孩子端设置页也能直接进），这里只是同一个页面的家长入口
    { icon: '🎨', title: t('parentHub.card.theme.title'), desc: t('parentHub.card.theme.desc'), href: '/theme' },
    { icon: '💌', title: t('parentHub.card.comments.title'), desc: t('parentHub.card.comments.desc'), href: '/(parent)/parent-comments' },
    { icon: '🔍', title: t('parentHub.card.aiCheck.title'), desc: t('parentHub.card.aiCheck.desc'), href: '/(parent)/ai-check' },
    /**
     * 奖励页是开发自测用的临时入口。
     * 审核视角：「🧪 测试」这类字样会被认定成未完成功能 / Beta 特性（2.3.1），
     * 而且它里面还有硬编码中文按钮，英文界面下很突兀 —— 生产包里直接不出现。
     */
    ...(__DEV__
      ? [{ icon: '🧪', title: t('parentHub.card.testing.title'), desc: t('parentHub.card.testing.desc'), href: '/(parent)/reward-test' }]
      : []),
    { icon: '🚪', title: t('parentHub.card.exit.title'), desc: t('parentHub.card.exit.desc'), action: () => {
      Alert.alert(t('parentHub.exitTitle'), t('parentHub.exitMsg'), [
        { text: t('common.cancel') },
        {
          text: t('parentHub.exit'),
          style: 'destructive',
          /**
           * v94 反馈 #2：原来用 router.back() —— 栈里下面还有「密码门」那一页，
           * 于是每次退出家长模式都退回到输密码界面。现在直接 replace 回孩子端，
           * 家长相关的页面整体出栈；右滑返回同理（栈里只剩孩子端）。
           */
          onPress: () => router.replace('/(tabs)'),
        },
      ]);
    }},
  ], [t]);

  const handleCardPress = (card: CardDef) => {
    if (card.href) {
      router.push(card.href);
    } else if (card.action) {
      card.action();
    }
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.page}>
          {/* 封面英雄区：柔和光晕 + 星星点缀 + 更大的小浣熊，比原来单张小图更亲切 */}
          <View style={[styles.hero, compact && styles.heroCompact]}>
            <View style={[styles.heroGlow, compact && styles.heroGlowCompact]} pointerEvents="none" />
            <Racco state="idle" size={compact ? 84 : 150} />
          </View>
          <Text style={[styles.header, compact && styles.headerCompact]}>{t('parentHub.title')}</Text>
          <Text style={styles.headerSub}>{t('parentHub.sub')}</Text>
          <View style={styles.grid}>
            {CARDS.map((card, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.card, { width: cardWidth }]}
                onPress={() => handleCardPress(card)}
              >
                <Text style={styles.icon}>{card.icon}</Text>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.desc}>{card.desc}</Text>
                <Text style={styles.arrow}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  page: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
    paddingBottom: 6,
    position: 'relative',
  },
  heroCompact: { paddingTop: 8, paddingBottom: 0 },
  heroGlow: {
    position: 'absolute',
    top: 8,
    width: 178,
    height: 178,
    borderRadius: 89,
    backgroundColor: 'rgba(255, 203, 92, 0.34)',
  },
  heroGlowCompact: { top: 4, width: 104, height: 104, borderRadius: 52 },
  header: {
    fontSize: 22,
    textAlign: 'center',
    color: COLORS.text,
    marginBottom: 6,
    fontFamily: FONT.rounded,
  },
  headerCompact: { fontSize: 18, marginBottom: 2 },
  headerSub: {
    fontSize: 13,
    textAlign: 'center',
    color: COLORS.textSub,
    marginBottom: 18,
    paddingHorizontal: 24,
    lineHeight: 19,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    padding: 20,
    marginVertical: 6,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
    elevation: 3,
    minHeight: 120,
    position: 'relative',
  },
  icon: { fontSize: 36, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  desc: { fontSize: 13, color: COLORS.textSub, flex: 1 },
  arrow: { position: 'absolute', bottom: 20, right: 20, fontSize: 24, color: COLORS.textLight },
});

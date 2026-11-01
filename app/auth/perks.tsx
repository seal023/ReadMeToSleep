/**
 * app/auth/perks.tsx — 「开通会员能享受到什么」说明页
 *
 * 位置：订阅页点「开始订阅」→ 未登录 → 先进本页看待遇 → 再点「登录并开通」。
 * 为什么要有这一页：登录是有心理成本的动作，先让人看到"我能得到什么"再要求登录，
 * 转化和观感都更好；同时明确回答"为什么要登录"（会员绑账号、换手机能找回）。
 *
 * ⚠️ 权益描述必须与代码实际行为一致（Apple Guideline 2.3.1 会抽查），
 *    额度与 services/entitlement.ts 的常量保持同一口径。
 */

import React, { useCallback } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import { CartoonButton } from '@/components/ui/CartoonButton';
import { COLORS, FONT, FONT_SIZE, RADIUS, SHADOW, SPACING } from '@/constants/theme';
import { EMAIL_LOGIN_ENABLED } from '@/constants/featureFlags';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

interface Perk {
  emoji: string;
  title: string;
  desc: string;
  free: string;
  member: string;
}

/** 权益卡：文案走 i18n，随界面语言切换 */
function buildPerks(t: (k: string) => string): Perk[] {
  return [
    {
      emoji: '🎙️',
      title: t('perks.p1.title'),
      desc: t('perks.p1.desc'),
      free: t('perks.p1.free'),
      member: t('perks.p1.member'),
    },
    {
      emoji: '📚',
      title: t('perks.p2.title'),
      desc: t('perks.p2.desc'),
      free: t('perks.p2.free'),
      member: t('perks.p2.member'),
    },
    {
      emoji: '🗺️',
      title: t('perks.p3.title'),
      desc: t('perks.p3.desc'),
      free: t('perks.p3.free'),
      member: t('perks.p3.member'),
    },
  ];
}

export default function PerksScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const { isSignedIn } = useAuth();

  // 从登录页回来时（已登录）自动退回订阅页：不该让用户看完待遇再点一次。
  // 加一点点延迟，让登录页的退出动画先走完，避免连续出栈的闪烁感。
  useFocusEffect(
    useCallback(() => {
      if (!isSignedIn) return;
      const timer = setTimeout(() => router.back(), 260);
      return () => clearTimeout(timer);
    }, [isSignedIn, router])
  );

  const goNext = () => {
    // 已登录（比如从账号页绕回来）就直接回订阅页，不再要求登录
    if (isSignedIn) {
      router.back();
      return;
    }
    router.push('/auth/login');
  };

  return (
    <CartoonScreen gradient="sunset" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Racco state="happy" size={78} />
          <Text style={styles.title}>{t('perks.title')}</Text>
        </View>

        {buildPerks(t).map((p) => (
          <View key={p.title} style={styles.card}>
            <Text style={styles.cardEmoji}>{p.emoji}</Text>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{p.title}</Text>
              <Text style={styles.cardDesc}>{p.desc}</Text>
              <View style={styles.compareRow}>
                <Text style={styles.freeTag}>
                  {t('perks.freeTag').replace('{v}', p.free)}
                </Text>
                <Text style={styles.memberTag}>
                  {t('perks.memberTag').replace('{v}', p.member)}
                </Text>
              </View>
            </View>
          </View>
        ))}

        {/* 为什么要登录 */}
        <View style={styles.whyCard}>
          <Text style={styles.whyTitle}>{t('perks.whyTitle')}</Text>
          <Text style={styles.whyBody}>
            {EMAIL_LOGIN_ENABLED ? t('perks.whyBodyEmail') : t('perks.whyBodyApple')}
          </Text>
        </View>

        <View style={styles.cta}>
          <CartoonButton title={t('perks.cta')} emoji="🎁" full onPress={goNext} />
        </View>

        <Text style={styles.notice}>
          {t('perks.notice')}{'\n'}
          <Text
            style={styles.noticeLink}
            onPress={() =>
              Linking.openURL('https://seal023.github.io/ReadMeToSleep/terms.html').catch(() => {})
            }
          >
            {t('perks.noticeTerms')}
          </Text>
          {' · '}
          <Text
            style={styles.noticeLink}
            onPress={() =>
              Linking.openURL('https://seal023.github.io/ReadMeToSleep/privacy.html').catch(() => {})
            }
          >
            {t('perks.noticePrivacy')}
          </Text>
        </Text>

        <Text style={styles.skip} onPress={() => router.back()}>
          {t('perks.skip')}
        </Text>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl * 1.5,
  },
  hero: { alignItems: 'center', marginBottom: SPACING.lg },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '800',
    color: COLORS.text,
    fontFamily: FONT.rounded,
    marginTop: SPACING.sm,
  },

  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  cardEmoji: { fontSize: 34, marginRight: SPACING.md, lineHeight: 40 },
  cardBody: { flex: 1 },
  cardTitle: {
    fontSize: FONT_SIZE.body,
    fontWeight: '800',
    color: COLORS.text,
    fontFamily: FONT.rounded,
  },
  cardDesc: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    lineHeight: 20,
    marginTop: SPACING.xs,
  },
  compareRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.sm },
  freeTag: {
    fontSize: FONT_SIZE.tiny,
    color: COLORS.textSub,
    backgroundColor: COLORS.divider,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: SPACING.sm,
    overflow: 'hidden',
  },
  memberTag: {
    fontSize: FONT_SIZE.tiny,
    color: '#8A5A00',
    backgroundColor: COLORS.yellowLight,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
    fontWeight: '700',
  },

  whyCard: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
    borderWidth: 2,
    borderColor: COLORS.purpleLight,
  },
  whyTitle: { fontSize: FONT_SIZE.body, fontWeight: '800', color: COLORS.text },
  whyBody: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    lineHeight: 21,
    marginTop: SPACING.sm,
  },

  cta: { marginBottom: SPACING.md },
  notice: {
    fontSize: FONT_SIZE.tiny,
    color: COLORS.textSub,
    textAlign: 'center',
    lineHeight: 18,
  },
  noticeLink: { color: COLORS.purple, textDecorationLine: 'underline' },
  skip: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: SPACING.lg,
  },
});

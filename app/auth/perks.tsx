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
import { useAuth } from '@/hooks/useAuth';

interface Perk {
  emoji: string;
  title: string;
  desc: string;
  free: string;
  member: string;
}

const PERKS: Perk[] = [
  {
    emoji: '🎙️',
    title: '用你自己的声音讲',
    desc: '录一段话，AI 学会你的音色，之后每篇故事都用你的声音念给孩子听。',
    free: '可体验 1 次',
    member: '不限次使用',
  },
  {
    emoji: '📚',
    title: '想听几个就听几个',
    desc: '睡前听一个不过瘾？会员当天故事数量不设上限。',
    free: '每天 1 个',
    member: '无限',
  },
  {
    emoji: '🗺️',
    title: '走到哪里，故事讲到哪里',
    desc: '旅行打卡把城市地标变成专属故事，路上也能哄睡。',
    free: '共 3 次',
    member: '无限',
  },
];

export default function PerksScreen() {
  const router = useRouter();
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
          <Text style={styles.title}>开通会员，你可以</Text>
        </View>

        {PERKS.map((p) => (
          <View key={p.title} style={styles.card}>
            <Text style={styles.cardEmoji}>{p.emoji}</Text>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{p.title}</Text>
              <Text style={styles.cardDesc}>{p.desc}</Text>
              <View style={styles.compareRow}>
                <Text style={styles.freeTag}>免费 · {p.free}</Text>
                <Text style={styles.memberTag}>会员 · {p.member}</Text>
              </View>
            </View>
          </View>
        ))}

        {/* 为什么要登录 */}
        <View style={styles.whyCard}>
          <Text style={styles.whyTitle}>💡 为什么要先登录？</Text>
          <Text style={styles.whyBody}>
            你的会员是记在账号上的，不是记在这台手机上。{'\n'}
            登录后，换新手机、重装 App，用同一个账号（Apple 或邮箱）登录，会员会自动回来，不用再付一次钱。
          </Text>
        </View>

        <View style={styles.cta}>
          <CartoonButton title="登录并开通会员" emoji="🎁" full onPress={goNext} />
        </View>

        <Text style={styles.notice}>
          订阅通过 App Store 扣款，可随时在系统设置中取消。{'\n'}
          <Text
            style={styles.noticeLink}
            onPress={() =>
              Linking.openURL('https://seal023.github.io/ReadMeToSleep/terms.html').catch(() => {})
            }
          >
            《用户协议》
          </Text>
          {' · '}
          <Text
            style={styles.noticeLink}
            onPress={() =>
              Linking.openURL('https://seal023.github.io/ReadMeToSleep/privacy.html').catch(() => {})
            }
          >
            《隐私政策》
          </Text>
        </Text>

        <Text style={styles.skip} onPress={() => router.back()}>
          再想想，先回去看看
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

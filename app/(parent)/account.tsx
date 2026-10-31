/**
 * app/(parent)/account.tsx — 我的账号
 *
 * 家长在这里能看到：当前登录方式、邮箱、会员归属，并且可以退出登录或注销账号。
 * ⚠️ Apple Guideline 5.1.1(v)：App 支持注册账号，就必须提供「删除账号」入口，
 *    否则审核会被拒。删除走服务端的 delete_me() 函数（见 Supabase 配置说明）。
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import { CartoonButton, ElasticPressable } from '@/components/ui/CartoonButton';
import { COLORS, FONT, FONT_SIZE, RADIUS, SHADOW, SPACING } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';

export default function AccountScreen() {
  const router = useRouter();
  const {
    configured,
    loading,
    isSignedIn,
    email,
    displayName,
    signOut,
    deleteAccount,
  } = useAuth();
  const [busy, setBusy] = useState(false);

  const handleSignOut = useCallback(() => {
    Alert.alert('退出登录？', '退出后这台手机上仍可继续使用，但会员状态需要重新登录才能确认。', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出登录',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await signOut();
            router.back();
          } catch (err) {
            Alert.alert('退出失败', (err as Error)?.message || '请稍后重试');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [signOut, router]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      '注销账号？',
      '账号会被永久删除，已购买的会员不会退款（退款需在 Apple 侧申请）。此操作不可撤销，确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认注销',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAccount();
              Alert.alert('已注销', '账号已删除。');
              router.back();
            } catch (err) {
              Alert.alert('注销失败', (err as Error)?.message || '请稍后重试');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [deleteAccount, router]);

  return (
    <CartoonScreen gradient="sky" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <ElasticPressable onPress={() => router.back()} containerStyle={styles.backWrap}>
          <Text style={styles.backText}>‹ 返回</Text>
        </ElasticPressable>

        <View style={styles.hero}>
          <Racco state="idle" size={72} />
          <Text style={styles.title}>我的账号</Text>
        </View>

        {!configured && (
          <View style={styles.warnCard}>
            <Text style={styles.warnText}>
              ⚠️ 当前构建未注入 Supabase 环境变量，账号功能不可用。请补齐配置后重新构建。
            </Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={COLORS.purple} style={{ marginTop: SPACING.xl }} />
        ) : isSignedIn ? (
          <>
            <View style={styles.profileCard}>
              <Text style={styles.avatar}>👤</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{displayName}</Text>
                <Text style={styles.meta}>{email || '使用 Apple 账号登录（邮箱未授权共享）'}</Text>
              </View>
            </View>

            <View style={styles.tipCard}>
              <Text style={styles.tipTitle}>💡 换手机怎么办？</Text>
              <Text style={styles.tipBody}>
                在新手机上装好 App，用同一个账号登录（Apple 或邮箱），再进「订阅管理」点一下「恢复购买」，
                会员就会回来。{'\n\n'}
                注意：订阅本身记在 Apple ID 上，所以新手机上的 App Store 也要登录同一个 Apple ID，
                否则 Apple 不会把订阅交还给 App。
              </Text>
            </View>

            <View style={styles.actions}>
              <CartoonButton
                title="查看订阅与凭证"
                emoji="🧾"
                full
                onPress={() => router.push('/(parent)/subscription')}
              />
              <View style={{ height: SPACING.sm }} />
              <CartoonButton
                title={busy ? '处理中…' : '退出登录'}
                emoji="🚪"
                variant="secondary"
                full
                onPress={handleSignOut}
                disabled={busy}
              />
            </View>

            <Text style={styles.dangerLink} onPress={handleDelete}>
              注销账号（永久删除）
            </Text>
          </>
        ) : (
          <>
            <View style={styles.tipCard}>
              <Text style={styles.tipTitle}>还没有登录</Text>
              <Text style={styles.tipBody}>
                不登录也能继续使用本 App。但登录后，会员会绑在账号上，
                换手机或重装时才能证明「这个会员是你买的」。
              </Text>
            </View>
            <View style={styles.actions}>
              <CartoonButton
                title="登录 / 注册"
                emoji="🔑"
                full
                onPress={() => router.push('/auth/login')}
              />
            </View>
          </>
        )}
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl * 1.5,
  },
  backWrap: { alignSelf: 'flex-start', paddingVertical: SPACING.sm },
  backText: { fontSize: FONT_SIZE.body, color: COLORS.textSub, fontWeight: '700' },

  hero: { alignItems: 'center', marginBottom: SPACING.lg },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '800',
    color: COLORS.text,
    fontFamily: FONT.rounded,
    marginTop: SPACING.sm,
  },

  warnCard: {
    backgroundColor: '#FFF3D6',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  warnText: { fontSize: FONT_SIZE.caption, color: '#8A6A20', lineHeight: 20 },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  avatar: { fontSize: 40, marginRight: SPACING.md },
  name: { fontSize: FONT_SIZE.section, fontWeight: '800', color: COLORS.text, fontFamily: FONT.rounded },
  meta: { fontSize: FONT_SIZE.caption, color: COLORS.textSub, marginTop: 4 },

  tipCard: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    borderWidth: 2,
    borderColor: COLORS.purpleLight,
  },
  tipTitle: { fontSize: FONT_SIZE.body, fontWeight: '800', color: COLORS.text },
  tipBody: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    lineHeight: 21,
    marginTop: SPACING.sm,
  },

  actions: { marginBottom: SPACING.md },
  dangerLink: {
    fontSize: FONT_SIZE.caption,
    color: '#C0504D',
    textAlign: 'center',
    textDecorationLine: 'underline',
    marginTop: SPACING.lg,
  },
});

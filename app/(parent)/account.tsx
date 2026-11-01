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
import { EMAIL_LOGIN_ENABLED } from '@/constants/featureFlags';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

export default function AccountScreen() {
  const router = useRouter();
  const { t } = useLanguage();
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
    Alert.alert(t('account.signOutAsk'), t('account.signOutMsg'), [
      { text: t('account.cancel'), style: 'cancel' },
      {
        text: t('account.signOut'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await signOut();
            router.back();
          } catch (err) {
            Alert.alert(t('account.signOutFail'), (err as Error)?.message || t('sub.alert.retry'));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [signOut, router, t]);

  const handleDelete = useCallback(() => {
    Alert.alert(
      t('account.deleteAsk'),
      t('account.deleteMsg'),
      [
        { text: t('account.cancel'), style: 'cancel' },
        {
          text: t('account.deleteConfirm'),
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAccount();
              Alert.alert(t('account.deleted'), t('account.deletedMsg'));
              router.back();
            } catch (err) {
              Alert.alert(t('account.deleteFail'), (err as Error)?.message || t('sub.alert.retry'));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [deleteAccount, router, t]);

  return (
    <CartoonScreen gradient="sky" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.page}>
        <ElasticPressable onPress={() => router.back()} containerStyle={styles.backWrap}>
          <Text style={styles.backText}>{t('account.back')}</Text>
        </ElasticPressable>

        <View style={styles.hero}>
          <Racco state="idle" size={72} />
          <Text style={styles.title}>{t('account.title')}</Text>
        </View>

        {!configured && (
          <View style={styles.warnCard}>
            <Text style={styles.warnText}>{t('account.notConfigured')}</Text>
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
                <Text style={styles.meta}>{email || t('account.appleNoEmail')}</Text>
              </View>
            </View>

            <View style={styles.tipCard}>
              <Text style={styles.tipTitle}>{t('account.tipTitle')}</Text>
              <Text style={styles.tipBody}>
                {EMAIL_LOGIN_ENABLED ? t('account.tipBodyAccount') : t('account.tipBodyApple')}
              </Text>
            </View>

            <View style={styles.actions}>
              <CartoonButton
                title={t('account.viewSub')}
                emoji="🧾"
                full
                onPress={() => router.push('/(parent)/subscription')}
              />
              <View style={{ height: SPACING.sm }} />
              <CartoonButton
                title={busy ? t('account.busy') : t('account.signOut')}
                emoji="🚪"
                variant="secondary"
                full
                onPress={handleSignOut}
                disabled={busy}
              />
            </View>

            <Text style={styles.dangerLink} onPress={handleDelete}>
              {t('account.deleteLink')}
            </Text>
          </>
        ) : (
          <>
            <View style={styles.tipCard}>
              <Text style={styles.tipTitle}>{t('account.notSignedTitle')}</Text>
              <Text style={styles.tipBody}>{t('account.notSignedBody')}</Text>
            </View>
            <View style={styles.actions}>
              <CartoonButton
                title={t('account.signIn')}
                emoji="🔑"
                full
                onPress={() => router.push('/auth/login')}
              />
            </View>
          </>
        )}
        </View>
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
  /** iPad 横屏：内容居中一列，不贴着屏幕左边 */
  page: { width: '100%', maxWidth: 760, alignSelf: 'center' },
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
  name: { fontSize: FONT_SIZE.section, color: COLORS.text, fontFamily: FONT.rounded },
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

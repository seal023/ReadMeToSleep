/**
 * app/(parent)/account.tsx — 我的账号
 *
 * 家长在这里能看到：当前登录方式、邮箱、会员归属，并且可以退出登录或注销账号。
 * ⚠️ Apple Guideline 5.1.1(v)：App 支持注册账号，就必须提供「删除账号」入口，
 *    否则审核会被拒。删除走服务端的 delete_me() 函数（见 Supabase 配置说明）。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import { CartoonButton, ElasticPressable } from '@/components/ui/CartoonButton';
import { COLORS, FONT, FONT_SIZE, RADIUS, SHADOW, SPACING } from '@/constants/theme';
import { EMAIL_LOGIN_ENABLED } from '@/constants/featureFlags';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { getAccountNickname, setAccountNickname } from '@/services/storage';

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
  // 显示名称：用户可以自己改称呼；系统给的姓名/邮箱仍是账号的唯一标识
  const [nickname, setNickname] = useState('');
  const [nickSaveTip, setNickSaveTip] = useState(false);

  useEffect(() => {
    getAccountNickname().then(setNickname);
  }, []);

  const handleSaveNickname = useCallback(async () => {
    await setAccountNickname(nickname);
    setNickSaveTip(true);
    setTimeout(() => setNickSaveTip(false), 1800);
  }, [nickname]);

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
                <Text style={styles.name}>{nickname.trim() || displayName}</Text>
                <Text style={styles.meta}>{email || t('account.appleNoEmail')}</Text>
                <Text style={styles.metaHint}>{t('account.accountId')}</Text>
              </View>
            </View>

            {/* 显示名称：自己起一个称呼，不影响账号标识（会员归属仍认系统账号） */}
            <View style={styles.nickCard}>
              <Text style={styles.tipTitle}>{t('account.nicknameTitle')}</Text>
              <TextInput
                style={styles.nickInput}
                value={nickname}
                onChangeText={setNickname}
                placeholder={displayName}
                placeholderTextColor="#9B8F86"
                maxLength={16}
                autoCapitalize="none"
              />
              <Text style={styles.tipBody}>{t('account.nicknameHint')}</Text>
              <TouchableOpacity style={styles.nickSaveBtn} onPress={handleSaveNickname} activeOpacity={0.85}>
                <Text style={styles.nickSaveText}>
                  {nickSaveTip ? t('account.nicknameSaved') : t('account.nicknameSave')}
                </Text>
              </TouchableOpacity>
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
                onPress={() => router.push('/(parent)/subscription?plan=yearly')}
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
  metaHint: { fontSize: 11, color: '#A79A90', marginTop: 2 },

  nickCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  nickInput: {
    marginTop: SPACING.sm,
    backgroundColor: '#FFF8F2',
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.purpleLight,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONT_SIZE.body,
    color: COLORS.text,
  },
  nickSaveBtn: {
    marginTop: SPACING.md,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.purple,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 9,
  },
  nickSaveText: { color: '#FFFFFF', fontSize: FONT_SIZE.caption, fontWeight: '800' },

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

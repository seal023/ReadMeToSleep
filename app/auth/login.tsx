/**
 * app/auth/login.tsx — 登录页（去 Supabase 化后只保留 Sign in with Apple）
 *
 * 2026-11-17：账号后端移除。邮件验证码登录彻底删除（D1）——
 * 它原本就因 Supabase 免费邮件限流 2 封/小时、只投递组织成员而完全不可用，
 * 且深链回跳页 auth-callback 也已一并删除。现在本页只有一个 Apple 登录按钮：
 * 点一下走系统授权 → Apple 稳定 id + 邮箱只存本机 AsyncStorage，不发任何服务器。
 *
 * 交互原则：这是给「家长」看的页面，允许文字为主，但按钮要大、状态要清楚。
 * 不识字的孩子不该被卡在这里 —— 所以本页只在家长主动点击「开通会员」后才出现。
 *
 * 登录成功后固定 router.back()，回到来源页（订阅页 / 权益说明页）。
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import { COLORS, FONT, FONT_SIZE, RADIUS, SHADOW, SPACING } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

/** Apple 原生登录按钮尺寸：全页唯一主操作，做得足够大、足够圆（胶囊） */
const APPLE_BTN_HEIGHT = 72;
const APPLE_BTN_RADIUS = APPLE_BTN_HEIGHT / 2;
const PRIVACY_URL = 'https://seal023.github.io/ReadMeToSleep/privacy.html';
const TERMS_URL = 'https://seal023.github.io/ReadMeToSleep/terms.html';

export default function LoginScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const { appleAvailable, signInApple } = useAuth();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApple = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await signInApple();
      router.back();
    } catch (err) {
      const e = err as Error & { userCancelled?: boolean };
      if (!e.userCancelled) setError(e.message || t('login.appleFail'));
    } finally {
      setBusy(false);
    }
  }, [signInApple, router, t]);

  return (
    <CartoonScreen gradient="candy" decor>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* 关闭：绝对定位，避免参与垂直居中、把整块内容顶下去 */}
          <Pressable
            style={styles.closeBtn}
            hitSlop={12}
            onPress={() => router.back()}
            accessibilityLabel={t('login.close')}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>

          <View style={styles.hero}>
            <Racco state="happy" size={168} />
            <Text style={styles.title}>{t('login.title')}</Text>
            <Text style={styles.subtitle}>{t('login.sub')}</Text>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          )}

          {/* Apple 登录：全页唯一的主操作，做成大胶囊。
              ⚠️ 这里**不能**用 expo-apple-authentication 的原生 AppleAuthenticationButton：
                 它的按钮文案由 **系统语言** 决定，跟 App 内的语言开关无关，于是会出现
                 「英文界面 + 中文系统」显示中文按钮的错乱。改为自绘黑色胶囊 +
                 系统字体里的 Apple 标志字形（U+F8FF），文案走 t()，两种语言都对。 */}
          {appleAvailable ? (
            <View style={styles.appleShadow}>
              <Pressable
                style={({ pressed }) => [
                  styles.appleBtn,
                  pressed && { opacity: 0.86, transform: [{ scale: 0.99 }] },
                ]}
                onPress={handleApple}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('login.appleButton')}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.appleLogo}>{'\uF8FF'}</Text>
                    <Text style={styles.appleLabel}>{t('login.appleButton')}</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : (
            <View style={styles.warnCard}>
              <Text style={styles.warnTitle}>{t('login.noAppleTitle')}</Text>
              <Text style={styles.warnBody}>{t('login.noAppleBody')}</Text>
            </View>
          )}

          {busy && <ActivityIndicator style={{ marginTop: SPACING.md }} color={COLORS.purple} />}

          {/* 条款 */}
          <View style={styles.legal}>
            <Text style={styles.legalText}>
              {t('login.legalPrefix')}
              <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
                {' '}{t('login.legalTerms')}{' '}
              </Text>
              {t('login.legalAnd')}
              <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
                {' '}{t('login.legalPrivacy')}{' '}
              </Text>
              {t('login.legalTailApple')}
            </Text>
          </View>

          <Pressable style={styles.skipBtn} hitSlop={8} onPress={() => router.back()}>
            <Text style={styles.skipText}>{t('login.skip')}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl * 2.2,
    paddingBottom: SPACING.xl * 1.6,
  },
  closeBtn: {
    position: 'absolute',
    top: SPACING.md,
    right: SPACING.lg,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.soft,
  },
  closeText: { fontSize: 17, color: COLORS.textSub, fontWeight: '700' },

  hero: { alignItems: 'center', marginBottom: SPACING.xl },
  title: {
    fontSize: FONT_SIZE.title,
    color: COLORS.text,
    fontFamily: FONT.rounded,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  subtitle: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSub,
    textAlign: 'center',
    lineHeight: 26,
    marginTop: SPACING.sm,
  },

  warnCard: {
    backgroundColor: '#FFF3D6',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  warnTitle: { fontSize: FONT_SIZE.body, fontWeight: '800', color: '#8A6A20' },
  warnBody: { fontSize: FONT_SIZE.caption, color: '#8A6A20', marginTop: SPACING.xs, lineHeight: 20 },

  errorCard: {
    backgroundColor: '#FFE7E7',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  errorText: { fontSize: FONT_SIZE.caption, color: '#B03A3A', lineHeight: 20 },

  // Apple 原生按钮本身不支持投影，用外层 View 兜出一点浮起感
  appleShadow: {
    borderRadius: APPLE_BTN_RADIUS,
    shadowColor: '#3D3229',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 6,
  },
  appleBtn: {
    width: '100%',
    height: APPLE_BTN_HEIGHT,
    borderRadius: APPLE_BTN_RADIUS,
    backgroundColor: '#000000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  //  U+F8FF：iOS 系统字体里就是 Apple 标志本身，白色
  appleLogo: { fontSize: 30, color: '#FFFFFF' },
  appleLabel: { fontSize: 22, color: '#FFFFFF', fontWeight: '600', letterSpacing: 0.2 },

  legal: { marginTop: SPACING.lg },
  legalText: {
    fontSize: FONT_SIZE.tiny,
    color: COLORS.textSub,
    lineHeight: 19,
    textAlign: 'center',
  },
  legalLink: { color: COLORS.purple, textDecorationLine: 'underline' },

  skipBtn: { alignItems: 'center', marginTop: SPACING.lg },
  skipText: { fontSize: FONT_SIZE.caption, color: COLORS.textSub, textDecorationLine: 'underline' },
});

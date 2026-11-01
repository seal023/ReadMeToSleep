/**
 * app/auth/login.tsx — 登录页（当前只暴露 Sign in with Apple）
 *
 * ⚠️ 邮件登录开关：见 constants/featureFlags.ts 的 EMAIL_LOGIN_ENABLED
 *    现在为 false —— 邮箱输入框、发送验证码按钮、验证码输入框、相关提示文案
 *    全部不渲染，页面只剩「通过 Apple 登录」一个大按钮。
 *    底层实现（sendCode / verifyCode / 深链回调）完整保留，把开关改成 true
 *    即可原样恢复，不需要改本文件任何一行 JSX。
 *
 * 交互原则：这是给「家长」看的页面，允许文字为主，但按钮要大、状态要清楚。
 * 不识字的孩子不该被卡在这里 —— 所以本页只在家长主动点击「开通会员」后才出现。
 *
 * 登录成功后固定 router.back()，回到来源页（订阅页 / 权益说明页）。
 * 不用 replace 是为了不把导航栈搞乱（replace 会替换栈顶，留重复页面）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import { CartoonButton, ElasticPressable } from '@/components/ui/CartoonButton';
import { COLORS, FONT, FONT_SIZE, RADIUS, SHADOW, SPACING } from '@/constants/theme';
import { EMAIL_LOGIN_ENABLED } from '@/constants/featureFlags';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

const RESEND_SECONDS = 60;
/** Apple 原生登录按钮尺寸：全页唯一主操作，做得足够大、足够圆（胶囊） */
const APPLE_BTN_HEIGHT = 72;
const APPLE_BTN_RADIUS = APPLE_BTN_HEIGHT / 2;
const PRIVACY_URL = 'https://seal023.github.io/ReadMeToSleep/privacy.html';
const TERMS_URL = 'https://seal023.github.io/ReadMeToSleep/terms.html';

/** 简易邮箱格式校验：决定「发送验证码」按键是否可点（Issue 10 按键变灰） */
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export default function LoginScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const { configured, appleAvailable, signInApple, sendCode, verifyCode } = useAuth();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const codeInputRef = useRef<TextInput>(null);

  // 重发倒计时
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  /**
   * ⚠️ 这里曾经有一段「linkLoginSeq 变化就 router.back()」的逻辑，已删除。
   *
   * 两个原因：
   *   1) 深链到达时 expo-router 会把导航切到 auth-callback 页面，登录页可能仍挂在栈底；
   *      此时登录页若执行 back()，弹掉的很可能是栈顶的 auth-callback，
   *      导致它的「登录成功 → 回首页」来不及执行。这是一个竞态，没必要留着。
   *   2) 深链登录落地页应该只有一个负责人。现在统一由 app/auth-callback.tsx 处理，
   *      它会明确显示「登录成功 + 账号」，用户不会再误以为点了链接没反应。
   */

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

  const handleSendCode = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await sendCode(email);
      setStep('code');
      setCountdown(RESEND_SECONDS);
      setTimeout(() => codeInputRef.current?.focus(), 350);
    } catch (err) {
      setError((err as Error).message || t('login.sendFail'));
    } finally {
      setBusy(false);
    }
  }, [sendCode, email, t]);

  const handleVerify = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyCode(email, code);
      router.back();
    } catch (err) {
      setError((err as Error).message || t('login.loginFail'));
    } finally {
      setBusy(false);
    }
  }, [verifyCode, email, code, router, t]);

  const handleResend = useCallback(async () => {
    if (countdown > 0 || busy) return;
    setError(null);
    setBusy(true);
    try {
      await sendCode(email);
      setCountdown(RESEND_SECONDS);
    } catch (err) {
      setError((err as Error).message || t('login.sendFail'));
    } finally {
      setBusy(false);
    }
  }, [countdown, busy, sendCode, email, t]);

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
            {/* 邮箱表单下线后整页只剩一个按钮，插画放大撑住画面重心 */}
            <Racco state="happy" size={EMAIL_LOGIN_ENABLED ? 76 : 168} />
            <Text style={styles.title}>{t('login.title')}</Text>
            <Text style={styles.subtitle}>{t('login.sub')}</Text>
          </View>

          {!configured && (
            <View style={styles.warnCard}>
              <Text style={styles.warnTitle}>{t('login.notConfiguredTitle')}</Text>
              <Text style={styles.warnBody}>{t('login.notConfiguredBody')}</Text>
            </View>
          )}

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          )}

          {/* Apple 登录：全页唯一的主操作，做成大胶囊 */}
          {appleAvailable ? (
            <View style={styles.appleShadow}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={APPLE_BTN_RADIUS}
                style={styles.appleBtn}
                onPress={handleApple}
              />
            </View>
          ) : (
            <View style={styles.warnCard}>
              <Text style={styles.warnTitle}>{t('login.noAppleTitle')}</Text>
              <Text style={styles.warnBody}>{t('login.noAppleBody')}</Text>
            </View>
          )}

          {/* 邮箱入口与邮箱表单：受 EMAIL_LOGIN_ENABLED 控制，关闭时整段不渲染，
              实现代码完整保留在下方（改成 true 即恢复，JSX 无需改动） */}
          {EMAIL_LOGIN_ENABLED && appleAvailable && (
            <Text style={styles.orText}>{t('login.orEmail')}</Text>
          )}

          {/*
            邮箱流程（2026-11-01 起暂时关闭，开关见 constants/featureFlags.ts）

            ⚠️ 关闭的是「入口」，不是「功能」：
            services/auth.ts 的 sendCode / verifyCode、hooks/useAuth 的深链监听、
            app/auth-callback.tsx 的落地页全部原样保留。已发出的旧登录邮件点进来
            依然能登录成功。
            原因：Supabase 免费版邮件限流 2 封/小时且仅组织成员可收，
            免费版模板又锁死无法发 6 位码。等 SMTP2GO 接好后把开关改回 true 即恢复。
          */}
          {EMAIL_LOGIN_ENABLED && (step === 'email' ? (
            <View style={styles.form}>
              <Text style={styles.label}>{t('login.emailLabel')}</Text>
              <TextInput
                style={styles.input}
                placeholder="name@example.com"
                placeholderTextColor={COLORS.textLight}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (error) setError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!busy}
                returnKeyType="send"
                onSubmitEditing={handleSendCode}
              />
              <CartoonButton
                title={busy ? t('login.sending') : t('login.sendCode')}
                emoji="✉️"
                full
                onPress={handleSendCode}
                disabled={busy || !configured || !isValidEmail(email)}
              />
              <Text style={styles.hint}>{t('login.emailHint')}</Text>
            </View>
          ) : (
            <View style={styles.form}>
              {/* 明确告知「验证码已发送」+ 填写位置（Issue 10） */}
              <View style={styles.successCard}>
                <Text style={styles.successTitle}>{t('login.sentTitle')}</Text>
                <Text style={styles.successText}>{t('login.sentTo')}</Text>
                <Text style={styles.successEmail}>{email.trim().toLowerCase()}</Text>
                <Text style={styles.successText}>{t('login.sentBody')}</Text>
              </View>

              <TextInput
                ref={codeInputRef}
                style={styles.codeInput}
                placeholder="123456"
                placeholderTextColor={COLORS.textLight}
                value={code}
                onChangeText={(v) => {
                  setCode(v.replace(/\D/g, '').slice(0, 6));
                  if (error) setError(null);
                }}
                keyboardType="number-pad"
                maxLength={6}
                editable={!busy}
                returnKeyType="done"
                onSubmitEditing={handleVerify}
              />

              <CartoonButton
                title={busy ? t('login.loggingIn') : t('login.doLogin')}
                emoji="🔓"
                full
                onPress={handleVerify}
                disabled={busy || code.length < 6}
              />

              <Text style={styles.hint}>
                {t('login.codeHint').replace('{s}', String(RESEND_SECONDS))}
              </Text>

              <View style={styles.codeActions}>
                <ElasticPressable onPress={() => setStep('email')} disabled={busy}>
                  <Text style={styles.linkText}>{t('login.changeEmail')}</Text>
                </ElasticPressable>
                <ElasticPressable onPress={handleResend} disabled={countdown > 0 || busy}>
                  <Text style={[styles.linkText, countdown > 0 && styles.linkDisabled]}>
                    {countdown > 0
                      ? t('login.resendIn').replace('{s}', String(countdown))
                      : t('login.resend')}
                  </Text>
                </ElasticPressable>
              </View>
            </View>
          ))}

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
              {EMAIL_LOGIN_ENABLED ? t('login.legalTailEmail') : t('login.legalTailApple')}
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
    // 邮箱表单下线后内容变短，整块垂直居中，别让按钮浮在半空
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
  appleBtn: { width: '100%', height: APPLE_BTN_HEIGHT },
  orText: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    textAlign: 'center',
    marginVertical: SPACING.md,
  },

  form: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOW.card,
  },
  // 验证码已发送的明确提示卡（Issue 10）
  successCard: {
    backgroundColor: '#E7F7EC',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#B7E4C7',
  },
  successTitle: { fontSize: FONT_SIZE.body, fontWeight: '800', color: '#1E7A3C', marginBottom: SPACING.xs },
  successText: { fontSize: FONT_SIZE.caption, color: '#2E7D4F', lineHeight: 20, textAlign: 'center' },
  successEmail: { fontSize: FONT_SIZE.body, fontWeight: '800', color: '#1E7A3C', marginVertical: SPACING.xs },
  label: { fontSize: FONT_SIZE.caption, color: COLORS.textSub, marginBottom: SPACING.sm },
  emailEcho: {
    fontSize: FONT_SIZE.body,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  input: {
    borderWidth: 2,
    borderColor: COLORS.divider,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    fontSize: FONT_SIZE.body,
    color: COLORS.text,
    backgroundColor: COLORS.cardSoft,
    marginBottom: SPACING.md,
  },
  codeInput: {
    borderWidth: 2,
    borderColor: COLORS.purpleLight,
    borderRadius: RADIUS.md,
    paddingVertical: 16,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 10,
    textAlign: 'center',
    color: COLORS.text,
    backgroundColor: COLORS.cardSoft,
    marginBottom: SPACING.md,
  },
  hint: {
    fontSize: FONT_SIZE.tiny,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.md,
    lineHeight: 18,
  },
  codeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.md,
  },
  linkText: { fontSize: FONT_SIZE.caption, color: COLORS.purple, fontWeight: '700' },
  linkDisabled: { color: COLORS.textLight, fontWeight: '400' },

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

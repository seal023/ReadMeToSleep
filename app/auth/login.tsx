/**
 * app/auth/login.tsx — 登录页（Sign in with Apple / 邮件验证码）
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

const RESEND_SECONDS = 60;
const PRIVACY_URL = 'https://seal023.github.io/ReadMeToSleep/privacy.html';
const TERMS_URL = 'https://seal023.github.io/ReadMeToSleep/terms.html';

/** 简易邮箱格式校验：决定「发送验证码」按键是否可点（Issue 10 按键变灰） */
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export default function LoginScreen() {
  const router = useRouter();
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
      if (!e.userCancelled) setError(e.message || 'Apple 登录失败，请重试');
    } finally {
      setBusy(false);
    }
  }, [signInApple, router]);

  const handleSendCode = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await sendCode(email);
      setStep('code');
      setCountdown(RESEND_SECONDS);
      setTimeout(() => codeInputRef.current?.focus(), 350);
    } catch (err) {
      setError((err as Error).message || '发送失败，请重试');
    } finally {
      setBusy(false);
    }
  }, [sendCode, email]);

  const handleVerify = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyCode(email, code);
      router.back();
    } catch (err) {
      setError((err as Error).message || '登录失败，请重试');
    } finally {
      setBusy(false);
    }
  }, [verifyCode, email, code, router]);

  const handleResend = useCallback(async () => {
    if (countdown > 0 || busy) return;
    setError(null);
    setBusy(true);
    try {
      await sendCode(email);
      setCountdown(RESEND_SECONDS);
    } catch (err) {
      setError((err as Error).message || '发送失败，请重试');
    } finally {
      setBusy(false);
    }
  }, [countdown, busy, sendCode, email]);

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
          {/* 关闭 */}
          <Pressable
            style={styles.closeBtn}
            hitSlop={12}
            onPress={() => router.back()}
            accessibilityLabel="关闭"
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>

          <View style={styles.hero}>
            <Racco state="happy" size={76} />
            <Text style={styles.title}>登录后，会员跟着你走</Text>
            <Text style={styles.subtitle}>
              换新手机、重装 App，只要用同一个账号登录，{'\n'}会员和故事都还在，不用再次付费。
            </Text>
          </View>

          {!configured && (
            <View style={styles.warnCard}>
              <Text style={styles.warnTitle}>⚠️ 账号服务尚未配置</Text>
              <Text style={styles.warnBody}>
                当前构建没有注入 Supabase 环境变量，登录暂时不可用。请联系开发者补齐配置后再试。
              </Text>
            </View>
          )}

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          )}

          {/* Apple 登录 */}
          {appleAvailable && (
            <View style={styles.appleWrap}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={RADIUS.md}
                style={styles.appleBtn}
                onPress={handleApple}
              />
            </View>
          )}

          {/* 邮箱入口按开关显示：关闭时整段不渲染，代码保留在下方 */}
          {EMAIL_LOGIN_ENABLED && appleAvailable && (
            <Text style={styles.orText}>或使用邮箱</Text>
          )}

          {!EMAIL_LOGIN_ENABLED && (
            <Text style={styles.hint}>
              邮箱登录暂时关闭，请使用上方 Apple 账号登录。{'\n'}
              不登录也能继续使用本 App，只是会员无法跨设备找回。
            </Text>
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
              <Text style={styles.label}>你的邮箱</Text>
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
                title={busy ? '发送中…' : '发送验证码'}
                emoji="✉️"
                full
                onPress={handleSendCode}
                disabled={busy || !configured || !isValidEmail(email)}
              />
              <Text style={styles.hint}>
                点击「发送验证码」后，我们会向这个邮箱发送登录邮件。{'\n'}
                邮件里可能是 6 位验证码，也可能是一条「登录链接」——两种方式都支持。
              </Text>
            </View>
          ) : (
            <View style={styles.form}>
              {/* 明确告知「验证码已发送」+ 填写位置（Issue 10） */}
              <View style={styles.successCard}>
                <Text style={styles.successTitle}>✅ 登录邮件已发送</Text>
                <Text style={styles.successText}>我们已向</Text>
                <Text style={styles.successEmail}>{email.trim().toLowerCase()}</Text>
                <Text style={styles.successText}>
                  发送了登录邮件。如果邮件里是 6 位数字，请填在下方；如果是「登录链接」，直接点它即可自动登录。
                </Text>
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
                title={busy ? '登录中…' : '登录'}
                emoji="🔓"
                full
                onPress={handleVerify}
                disabled={busy || code.length < 6}
              />

              <Text style={styles.hint}>
                把邮件里的 6 位数字填到上面的大框里即可登录。{'\n'}
                如果邮件里只有一条蓝色链接，直接点它，回到本 App 会自动登录。{'\n'}
                没收到？请先检查「垃圾邮件」文件夹，或等 {RESEND_SECONDS}s 后点下方「重新发送」。
              </Text>

              <View style={styles.codeActions}>
                <ElasticPressable onPress={() => setStep('email')} disabled={busy}>
                  <Text style={styles.linkText}>← 换个邮箱</Text>
                </ElasticPressable>
                <ElasticPressable onPress={handleResend} disabled={countdown > 0 || busy}>
                  <Text style={[styles.linkText, countdown > 0 && styles.linkDisabled]}>
                    {countdown > 0 ? `${countdown}s 后可重发` : '重新发送'}
                  </Text>
                </ElasticPressable>
              </View>
            </View>
          ))}

          {busy && <ActivityIndicator style={{ marginTop: SPACING.md }} color={COLORS.purple} />}

          {/* 条款 */}
          <View style={styles.legal}>
            <Text style={styles.legalText}>
              登录即表示你同意
              <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
                {' '}《用户协议》{' '}
              </Text>
              与
              <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
                {' '}《隐私政策》{' '}
              </Text>
              。我们只保存邮箱 / Apple 账号标识与你孩子的昵称、故事偏好，不会用于广告。
            </Text>
          </View>

          <Pressable style={styles.skipBtn} hitSlop={8} onPress={() => router.back()}>
            <Text style={styles.skipText}>先不登录，继续试用</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl * 1.6,
  },
  closeBtn: {
    alignSelf: 'flex-end',
    width: 36,
    height: 36,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.soft,
  },
  closeText: { fontSize: 17, color: COLORS.textSub, fontWeight: '700' },

  hero: { alignItems: 'center', marginTop: SPACING.sm, marginBottom: SPACING.lg },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '800',
    color: COLORS.text,
    fontFamily: FONT.rounded,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  subtitle: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSub,
    textAlign: 'center',
    lineHeight: 24,
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

  appleWrap: { marginBottom: SPACING.sm },
  appleBtn: { width: '100%', height: 52 },
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

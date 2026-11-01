import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../hooks/useAuth';
import { EMAIL_LOGIN_ENABLED } from '../constants/featureFlags';

/**
 * 邮件「魔法链接」深链承接页。
 *
 * Supabase 免费版默认邮件模板只发「登录链接」而非 6 位验证码，
 * 用户点邮件里的 Confirm 链接 → 系统用 readmetosleep://auth-callback#access_token=… 拉起 App。
 *
 * 此前因为路由表里没有 auth-callback 这个页面，Expo Router 解析
 * readmetosleep://auth-callback#… 时路由匹配失败 → 抛出未捕获异常 → 原生崩溃（"已崩溃"）。
 * 现在用一个专属路由承接：会话解析交给 useAuth 的 Linking 监听器统一处理，
 * 本页只负责「让用户看见登录结果」+「回到主界面」，从根上消除闪退。
 *
 * 为什么要有「登录成功」这一屏（构建 73 反馈）：
 *   之前成功后 600ms 就静默 replace 到首页，而首页（模式选择页）**不显示登录态**，
 *   用户点了链接回到 App 只看到转圈→首页，会以为「没登录上」，
 *   直到杀掉 App 重开、进家长模式才看到已登录。现在明确显示账号再走。
 */

type Phase = 'working' | 'ok' | 'fail';

export default function AuthCallbackScreen() {
  const { isSignedIn, email, linkLoginSeq } = useAuth();
  const [phase, setPhase] = useState<Phase>('working');

  /** 进入本页时的深链登录计数基线，用来区分「这次链接真的登录了」与「本来就已登录」 */
  const baseSeq = useRef(linkLoginSeq);
  const left = useRef(false);

  const goHome = useCallback(() => {
    if (left.current) return;
    left.current = true;
    // 回到模式选择首页（app/index.tsx）。登录态已由 useAuth 写入。
    router.replace('/');
  }, []);

  // 判定结果
  useEffect(() => {
    if (linkLoginSeq > baseSeq.current) {
      // 本次深链解析成功并建立了会话 → 明确告诉用户
      setPhase('ok');
      return;
    }
    if (isSignedIn) {
      // 本来就已经是登录态（例如已登录用户又点了一次旧链接），无需停留，直接回家
      goHome();
    }
  }, [linkLoginSeq, isSignedIn, goHome]);

  // 成功后停留一小会儿，让用户看清「已登录：xxx@…」，再回主界面
  useEffect(() => {
    if (phase !== 'ok') return;
    const t = setTimeout(goHome, 1800);
    return () => clearTimeout(t);
  }, [phase, goHome]);

  // 兜底：6 秒还没拿到会话就明说失败，绝不让用户干等（也不崩溃）
  useEffect(() => {
    const t = setTimeout(() => {
      setPhase((p) => (p === 'working' ? 'fail' : p));
    }, 6000);
    return () => clearTimeout(t);
  }, []);

  if (phase === 'ok') {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>✅</Text>
        <Text style={styles.okTitle}>登录成功</Text>
        {!!email && <Text style={styles.okEmail}>{email}</Text>}
        <Text style={styles.tip}>正在回到首页…</Text>
      </View>
    );
  }

  if (phase === 'fail') {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>🔗</Text>
        <Text style={styles.failTitle}>登录未完成</Text>
        <Text style={styles.tip}>
          这条登录链接可能已过期，或已在别的设备上使用过。{'\n'}
          {EMAIL_LOGIN_ENABLED ? '回到登录页重新获取一次即可。' : '请在登录页改用 Apple 账号登录。'}
        </Text>
        <Pressable
          style={styles.primaryBtn}
          onPress={() => {
            if (left.current) return;
            left.current = true;
            router.replace('/auth/login');
          }}
        >
          <Text style={styles.primaryText}>
            {EMAIL_LOGIN_ENABLED ? '重新获取登录邮件' : '返回登录页'}
          </Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={goHome}>
          <Text style={styles.secondaryText}>先回首页</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#6c5ce7" />
      <Text style={styles.tip}>正在登录…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF5E6',
    paddingHorizontal: 32,
  },
  emoji: { fontSize: 56, marginBottom: 10 },
  okTitle: { fontSize: 22, fontWeight: '800', color: '#1E7A3C' },
  okEmail: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '700',
    color: '#3D3229',
    textAlign: 'center',
  },
  failTitle: { fontSize: 20, fontWeight: '800', color: '#B03A3A', marginBottom: 8 },
  tip: {
    marginTop: 14,
    fontSize: 14,
    lineHeight: 21,
    color: '#7A6A5D',
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: 22,
    backgroundColor: '#9B7EDE',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10 },
  secondaryText: { color: '#7A6A5D', fontSize: 14, textDecorationLine: 'underline' },
});

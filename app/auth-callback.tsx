import { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../hooks/useAuth';

/**
 * 邮件「魔法链接」深链承接页。
 *
 * Supabase 免费版默认邮件模板只发「登录链接」而非 6 位验证码，
 * 用户点邮件里的 Confirm 链接 → 系统用 readmetosleep://auth-callback#access_token=… 拉起 App。
 *
 * 此前因为路由表里没有 auth-callback 这个页面，Expo Router 解析
 * readmetosleep://auth-callback#… 时路由匹配失败 → 抛出未捕获异常 → 原生崩溃（"已崩溃"）。
 * 现在用一个专属路由承接：它本身不解析会话（交给 useAuth 的 Linking 监听器统一处理），
 * 只负责「登录成功后回到主界面」+「异常时兜底跳转」，从根上消除闪退。
 */
export default function AuthCallbackScreen() {
  const { isSignedIn } = useAuth();
  const done = useRef(false);

  const goHome = () => {
    if (done.current) return;
    done.current = true;
    // 回到模式选择首页（app/index.tsx）。登录态已由 useAuth 写入，
    // 之后进入家长模式看到的账号即为已登录状态。
    router.replace('/');
  };

  // 登录成功（useAuth 已 setSession）→ 稍候让首屏逻辑稳定再回主界面
  useEffect(() => {
    if (isSignedIn) {
      const t = setTimeout(goHome, 600);
      return () => clearTimeout(t);
    }
  }, [isSignedIn]);

  // 兜底：无论成败，最多 4 秒后回到主界面（失败则用户可在登录页手动重试，绝不卡死）
  useEffect(() => {
    const t = setTimeout(goHome, 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#6c5ce7" />
      <Text style={styles.tip}>登录中…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF5E6',
  },
  tip: {
    marginTop: 14,
    fontSize: 15,
    color: '#8D6E63',
  },
});

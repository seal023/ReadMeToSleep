/**
 * app/+not-found.tsx — 全局「找不到页面」兜底（儿童友好版）
 * ---------------------------------------------------------------------------
 * 为什么必须有这个文件：
 *  App 注册了 URL scheme `readmetosleep`（app.json），且 iOS 启用了 Scene
 *  生命周期（enableSceneSupport）。锁屏重开 / 从后台恢复 scene 时，iOS 会
 *  重新投递一个**空的** `readmetosleep://` 深链。expo-router 解析它时匹配
 *  不到任何页面 → 落到 +not-found。
 *
 *  没有自定义 +not-found 时，expo-router 会显示默认的技术页面（黑底白字
 *  "Unmatched Route / Page could not be found"），上面的 "Sitemap" 链接指向
 *  expo-router 的 develop-only 路由，**生产包里点它就崩**。
 *
 * 本页设计：
 *  · 自动返回：导航容器就绪后短暂延时即 back（锁屏重开→回原页面）或
 *    replace('/')（冷启动即深链→回模式选择首页），孩子无需读字、无需操作。
 *  · 手动兜底：一个大胆量按钮，自动返回因任何原因失效时也能点。
 *  · 儿童友好：浣熊 + 柔和配色 + 大字，不出现任何技术术语 / Sitemap。
 *  · 绝对稳：只依赖 react-native / expo-router / useLanguage，不引入新模块；
 *    文案内联中英双语（跟随系统语言），不依赖可能缺失的 i18n 键。
 */
import { useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import { useLanguage } from '../hooks/useLanguage';

export default function NotFoundScreen() {
  const { language } = useLanguage();
  const nav = useRootNavigationState();
  const done = useRef(false);
  const zh = language === 'zh';

  /** 回到来处：有历史栈就 back，冷启动无栈就回模式选择首页 */
  const goBack = useCallback(() => {
    if (done.current) return;
    done.current = true;
    try {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch {
      router.replace('/');
    }
  }, []);

  // 等导航容器就绪再自动返回，避免在 navigation 未 mount 时调用失败
  useEffect(() => {
    if (!nav?.key) return;
    const timer = setTimeout(goBack, 400);
    return () => clearTimeout(timer);
  }, [nav?.key, goBack]);

  return (
    <View style={styles.center}>
      <Text style={styles.mascot}>🦝</Text>
      <Text style={styles.title}>{zh ? '咦，走错路啦' : 'Oops, wrong turn'}</Text>
      <Text style={styles.tip}>
        {zh ? '小浣熊这就带你回去…' : 'Let’s take you right back...'}
      </Text>
      <Pressable style={styles.btn} onPress={goBack} accessibilityRole="button">
        <Text style={styles.btnText}>{zh ? '🏠 回到刚才' : '🏠 Go back'}</Text>
      </Pressable>
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
  mascot: { fontSize: 76, marginBottom: 14 },
  title: { fontSize: 24, fontWeight: '800', color: '#3D3229', textAlign: 'center' },
  tip: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 22,
    color: '#7A6A5D',
    textAlign: 'center',
  },
  btn: {
    marginTop: 28,
    backgroundColor: '#9B7EDE',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});

import { Stack, usePathname, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import {
  isParentVerified,
  setPendingParentTarget,
  scheduleBackgroundLock,
  cancelBackgroundLock,
} from '@/services/parentGate';

/**
 * 家长区统一守卫（Kids Category 1.3 / 5.1.4）
 * ---------------------------------------------------------------------------
 * 只有 PIN 门 (parent)/index 本身放行；其余任何家长页（订阅、声音克隆、
 * 敏感词、账号……）未通过 PIN 验证一律弹回 PIN 门。
 *
 * 这是集中式防线：无论从哪个页面 router.push 进来（包括未来新增的入口），
 * 都会在这里被拦截，不必逐个改散落在孩子端的 push 调用。
 *
 * pathname 说明：route group `(parent)` 不进 URL，所以 PIN 门 index 的
 * pathname 是 '/'；家长子页是 '/hub'、'/subscription' 等。tabs 首页同样是
 * '/'，但它由 (tabs)/_layout 包裹，不经过本守卫，不会误伤。
 */
const GATE_PATH = '/';

export default function ParentLayout() {
  const pathname = usePathname();
  // 用 ref 保存最新 pathname，供 AppState 监听读取（避免闭包旧值 / 重复订阅）
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // 路由变化时守卫
  useEffect(() => {
    if (pathname === GATE_PATH) return; // PIN 门本身放行
    if (!isParentVerified()) {
      setPendingParentTarget(pathname);
      router.replace('/(parent)/index');
    }
  }, [pathname]);

  // 切后台延迟上锁；回前台若仍停留在家长子页且已上锁 → 弹回 PIN 门
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        scheduleBackgroundLock();
      } else if (state === 'active') {
        cancelBackgroundLock();
        const current = pathRef.current;
        if (current !== GATE_PATH && !isParentVerified()) {
          setPendingParentTarget(current);
          router.replace('/(parent)/index');
        }
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="hub" />
      <Stack.Screen name="sensitive-words" />
      <Stack.Screen name="child-recordings" />
      <Stack.Screen name="voice-clone" />
      <Stack.Screen name="voices" />
      <Stack.Screen name="subscription" />
      <Stack.Screen name="account" />
      <Stack.Screen name="sleep-timer" />
      <Stack.Screen name="parent-comments" />
      <Stack.Screen name="statistics" />
      {/* 配色页已移到根级路由 app/theme.tsx（孩子端可直接进），家长模式不再注册 */}
    </Stack>
  );
}

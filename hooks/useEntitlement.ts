/**
 * hooks/useEntitlement.ts — 会员权益快照 + 付费墙弹窗
 *
 * 用法：
 *   const { snapshot, refresh, showPaywall } = useEntitlement();
 *
 *   const gate = await checkStoryGate();
 *   if (!showPaywall(gate)) return;   // 被拦下了，已弹窗引导订阅
 *   await doTheThing();
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getSnapshot,
  type EntitlementSnapshot,
  type GateResult,
} from '@/services/entitlement';

const EMPTY: EntitlementSnapshot = {
  premium: false,
  plan: 'free',
  storiesUsedToday: 0,
  storiesRemaining: 1,
  checkInsUsed: 0,
  checkInsRemaining: 3,
};

export interface UseEntitlementResult {
  /** null 表示还在加载 */
  snapshot: EntitlementSnapshot | null;
  /** 主动刷新（购买成功、页面重新聚焦后调用） */
  refresh: () => Promise<void>;
  /**
   * 处理门禁结果：放行返回 true；
   * 被拦下时弹出引导订阅的对话框并返回 false。
   */
  showPaywall: (gate: GateResult) => boolean;
}

export function useEntitlement(): UseEntitlementResult {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<EntitlementSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getSnapshot());
    } catch (err) {
      console.warn('[useEntitlement] refresh failed:', err);
      setSnapshot(EMPTY);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showPaywall = useCallback(
    (gate: GateResult): boolean => {
      if (gate.allowed) return true;

      Alert.alert(gate.title, gate.message, [
        { text: '稍后再说', style: 'cancel' },
        {
          text: '查看方案',
          onPress: () => router.push('/(parent)/subscription'),
        },
      ]);
      return false;
    },
    [router]
  );

  return { snapshot, refresh, showPaywall };
}

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
import { ts } from '@/services/i18n';

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

      // v107 防白嫖：AI 生成要求先登录（额度必须落在账号上，否则卸载重装就重置）
      if (gate.reason === 'login') {
        Alert.alert(gate.title, gate.message, [
          { text: ts('gate.later'), style: 'cancel' },
          { text: ts('gate.goLogin'), onPress: () => router.push('/auth/login') },
        ]);
        return false;
      }

      // 会员今天 3 次已用完：不能再去卖会员，只提示并给「去经典故事库」的出口，
      // 与提示文案「或者去经典故事库听听哦」对应（孩子不识字也能照着点）。
      if (gate.reason === 'premium') {
        Alert.alert(gate.title, gate.message, [
          { text: ts('common.ok'), style: 'cancel' },
          {
            text: ts('gate.goLibrary'),
            onPress: () => router.push('/(tabs)/library'),
          },
        ]);
        return false;
      }

      // 免费额度用完：引导到付费墙，并默认落在年付档（主推 $49.99）
      Alert.alert(gate.title, gate.message, [
        { text: ts('gate.later'), style: 'cancel' },
        {
          text: ts('gate.viewPlans'),
          onPress: () => router.push('/(parent)/subscription?plan=yearly'),
        },
      ]);
      return false;
    },
    [router]
  );

  return { snapshot, refresh, showPaywall };
}

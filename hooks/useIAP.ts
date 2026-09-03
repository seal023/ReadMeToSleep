/**
 * hooks/useIAP.ts — 订阅状态的 React 封装
 *
 * 把 services/iap.ts 的命令式 API 包装成组件可直接消费的状态，
 * 统一处理：初始化、加载中、忙碌态、错误提示、卸载竞态。
 *
 * 用法：
 *   const { initializing, busy, offers, entitlement, isSubscribed,
 *           priceOf, purchase, restore, manage } = useIAP();
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FALLBACK_PRICES,
  isIapSupported,
  loadOffers,
  openManageSubscriptions,
  purchasePlan,
  refreshEntitlement,
  restorePurchasesAsync,
  type Entitlement,
  type PaidPlan,
  type Plan,
  type PlanOffer,
} from '@/services/iap';

export interface UseIAPResult {
  /** 首次初始化中（拉价格 + 校验订阅） */
  initializing: boolean;
  /** 购买 / 恢复进行中，用于禁用按钮 */
  busy: boolean;
  /** 商店返回的真实价格；null 表示拉取失败（UI 应回落到兜底价） */
  offers: PlanOffer[] | null;
  /** 本地持有的有效权益；null 表示无订阅 */
  entitlement: Entitlement | null;
  /** 当前是否享有会员权益 */
  isSubscribed: boolean;
  /** 当前方案（'free' | 'monthly' | 'yearly'），由 entitlement 推导 */
  activePlan: Plan;
  /** 原生 IAP 是否可用（Expo Go / Web 下为 false） */
  supported: boolean;
  /** 取展示价，如 priceOf('monthly') => "$4.99" */
  priceOf: (plan: PaidPlan) => string;
  /** 发起购买。返回 entitlement 成功，返回 null 表示用户取消（不弹错误） */
  purchase: (plan: PaidPlan) => Promise<Entitlement | null>;
  /** 恢复购买。返回 entitlement，null 表示当前 Apple ID 下无有效订阅 */
  restore: () => Promise<Entitlement | null>;
  /** 跳转系统订阅管理页（Apple 3.1.2 要求） */
  manage: () => Promise<boolean>;
  /** 主动刷新订阅状态 */
  refresh: () => Promise<void>;
}

export function useIAP(): UseIAPResult {
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [offers, setOffers] = useState<PlanOffer[] | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);

  /** 防止卸载后仍调用 setState */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const isExpired = useCallback((e: Entitlement | null) => {
    return !e || e.expiryMs <= Date.now();
  }, []);

  // 进入页面时：拉真实价格 + 校验订阅是否仍然有效
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isIapSupported) {
        if (!cancelled) setInitializing(false);
        return;
      }
      try {
        const [loadedOffers, current] = await Promise.all([
          loadOffers(),
          refreshEntitlement(),
        ]);
        if (cancelled) return;
        setOffers(loadedOffers);
        setEntitlement(current && !isExpired(current) ? current : null);
      } catch (err) {
        console.warn('[useIAP] init failed:', err);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isExpired]);

  const priceOf = useCallback(
    (plan: PaidPlan) => {
      const offer = offers?.find((o) => o.plan === plan);
      return offer?.displayPrice || FALLBACK_PRICES[plan];
    },
    [offers]
  );

  /**
   * 购买。约定返回值语义（让 UI 层不必再解析异常）：
   *   - 成功           → Entitlement
   *   - 用户主动取消   → null（不应弹错误）
   *   - 其它失败       → 抛出 Error（message 已本地化）
   */
  const purchase = useCallback(
    async (plan: PaidPlan): Promise<Entitlement | null> => {
      if (busy) return null;
      setBusy(true);
      try {
        const result = await purchasePlan(plan);
        if (aliveRef.current) setEntitlement(result);
        return result;
      } catch (err) {
        const cancelled = (err as { userCancelled?: boolean } | null)?.userCancelled;
        if (cancelled) return null;
        throw err instanceof Error ? err : new Error('购买失败，请稍后重试');
      } finally {
        if (aliveRef.current) setBusy(false);
      }
    },
    [busy]
  );

  /** 恢复购买。无有效订阅时返回 null，并清空本地权益缓存 */
  const restore = useCallback(async (): Promise<Entitlement | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      const restored = await restorePurchasesAsync();
      const valid = restored && !isExpired(restored) ? restored : null;
      if (aliveRef.current) setEntitlement(valid);
      return valid;
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [busy, isExpired]);

  const manage = useCallback(async (): Promise<boolean> => {
    return openManageSubscriptions();
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!isIapSupported) return;
    try {
      const current = await refreshEntitlement();
      if (aliveRef.current) {
        setEntitlement(current && !isExpired(current) ? current : null);
      }
    } catch (err) {
      console.warn('[useIAP] refresh failed:', err);
    }
  }, [isExpired]);

  const isSubscribed = !isExpired(entitlement);

  return {
    initializing,
    busy,
    offers,
    entitlement,
    isSubscribed,
    activePlan: isSubscribed && entitlement ? entitlement.plan : ('free' as Plan),
    supported: isIapSupported,
    priceOf,
    purchase,
    restore,
    manage,
    refresh,
  };
}

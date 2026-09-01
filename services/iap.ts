/**
 * services/iap.ts — 真实应用内购买（App Store 自动续订订阅）
 *
 * 依赖：react-native-iap v16（OpenIAP / Nitro 架构）
 *
 * 注意 v16 的 API 与老版本（v12 及更早）完全不同：
 *   - initConnection()                       建立商店连接
 *   - fetchProducts({ skus, type: 'subs' })  拉取商品（Promise 式）
 *   - requestPurchase({ request, type })     ⚠️ 事件驱动，返回值不可信
 *     结果必须由 purchaseUpdatedListener / purchaseErrorListener 接收
 *   - finishTransaction({ purchase })        完成交易（不完成会在每次启动重放）
 *
 * 商品 ID（需与 App Store Connect 中创建的订阅商品完全一致）：
 *   com.seal023.ReadMeToSleep.monthly
 *   com.seal023.ReadMeToSleep.yearly
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ErrorCode,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  deepLinkToSubscriptions,
  type ProductSubscription,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export type Plan = 'free' | 'monthly' | 'yearly';
export type PaidPlan = Exclude<Plan, 'free'>;

export const PRODUCT_IDS: Record<PaidPlan, string> = {
  monthly: 'com.seal023.ReadMeToSleep.monthly',
  yearly: 'com.seal023.ReadMeToSleep.yearly',
};

/** 商店拉取失败时的兜底展示价（App Store Connect 里请按此价格档配置） */
export const FALLBACK_PRICES: Record<PaidPlan, string> = {
  monthly: '¥28',
  yearly: '¥168',
};

const ENTITLEMENT_KEY = 'rms_entitlement';
const ALL_SKUS = [PRODUCT_IDS.monthly, PRODUCT_IDS.yearly];
const DAY_MS = 24 * 60 * 60 * 1000;

/** 原生模块仅在 iOS / Android 的正式构建里可用（Expo Go / Web 无原生模块） */
export const isIapSupported = Platform.OS === 'ios' || Platform.OS === 'android';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface Entitlement {
  plan: PaidPlan;
  productId: string;
  /** 过期时间（毫秒时间戳） */
  expiryMs: number;
  /** 是否处于自动续订状态 */
  autoRenewing: boolean;
  updatedAt: number;
}

export interface PlanOffer {
  plan: PaidPlan;
  productId: string;
  /** 商店返回的本地化价格，如 "¥28" */
  displayPrice: string;
  currency: string;
  title: string;
  description: string;
}

// ---------------------------------------------------------------------------
// 连接管理
// ---------------------------------------------------------------------------

let connectionReady = false;

export async function ensureConnection(): Promise<boolean> {
  if (!isIapSupported) return false;
  if (connectionReady) return true;
  try {
    const ok = await initConnection();
    connectionReady = !!ok;
    return connectionReady;
  } catch (err) {
    console.warn('[IAP] initConnection failed:', err);
    connectionReady = false;
    return false;
  }
}

export async function closeConnection(): Promise<void> {
  if (!connectionReady) return;
  try {
    await endConnection();
  } catch {
    /* 忽略关闭异常 */
  }
  connectionReady = false;
}

// ---------------------------------------------------------------------------
// 商品
// ---------------------------------------------------------------------------

/** 从 App Store 拉取真实价格。失败返回 null（调用方应回落到兜底价） */
export async function loadOffers(): Promise<PlanOffer[] | null> {
  if (!(await ensureConnection())) return null;
  try {
    const result = await fetchProducts({ skus: ALL_SKUS, type: 'subs' });
    const list: ProductSubscription[] = Array.isArray(result) ? (result as ProductSubscription[]) : [];

    const offers = list
      .filter((p) => p && typeof p.id === 'string')
      .map<PlanOffer>((p) => {
        const plan = planFromProductId(p.id);
        return {
          plan: plan ?? 'monthly',
          productId: p.id,
          displayPrice: p.displayPrice || FALLBACK_PRICES[plan ?? 'monthly'],
          currency: p.currency || 'CNY',
          title: p.title || '',
          description: p.description || '',
        };
      })
      .filter((o) => o.plan && ALL_SKUS.includes(o.productId));

    return offers.length > 0 ? offers : null;
  } catch (err) {
    console.warn('[IAP] fetchProducts failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 购买
// ---------------------------------------------------------------------------

/**
 * 发起订阅购买。
 * 内部注册监听器 → 调 requestPurchase → 等待事件回调 → 完成交易 → 写入本地权益。
 * @throws 用户取消时抛出的 Error 带 `userCancelled = true`
 */
export async function purchasePlan(plan: PaidPlan): Promise<Entitlement> {
  if (!(await ensureConnection())) {
    throw new Error('无法连接到 App Store，请稍后重试');
  }

  const sku = PRODUCT_IDS[plan];

  return new Promise<Entitlement>((resolve, reject) => {
    let settled = false;
    let purchaseSub: { remove(): void } | null = null;
    let errorSub: { remove(): void } | null = null;

    const cleanup = () => {
      try {
        purchaseSub?.remove();
      } catch {
        /* noop */
      }
      try {
        errorSub?.remove();
      } catch {
        /* noop */
      }
      purchaseSub = null;
      errorSub = null;
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    purchaseSub = purchaseUpdatedListener(async (purchase: Purchase) => {
      // 未完成的交易会在每次启动时重放，这里只处理本次要买的商品
      if (!purchase || purchase.productId !== sku) return;
      try {
        const entitlement = await applyPurchase(purchase);
        settle(() => resolve(entitlement));
      } catch (err) {
        settle(() => reject(wrapError(err)));
      }
    });

    errorSub = purchaseErrorListener((error: PurchaseError) => {
      settle(() => reject(toFriendlyError(error)));
    });

    requestPurchase({
      request: { apple: { sku }, google: { skus: [sku] } },
      type: 'subs',
    }).catch((err) => {
      settle(() => reject(toFriendlyError(err)));
    });
  });
}

/** 完成交易 + 落库权益 */
async function applyPurchase(purchase: Purchase): Promise<Entitlement> {
  try {
    await finishTransaction({ purchase, isConsumable: false });
  } catch (err) {
    console.warn('[IAP] finishTransaction failed:', err);
  }

  const entitlement = entitlementFromPurchase(purchase);
  if (!entitlement) {
    throw new Error('购买成功，但未能识别订阅方案');
  }
  await saveEntitlement(entitlement);
  return entitlement;
}

// ---------------------------------------------------------------------------
// 恢复 / 刷新
// ---------------------------------------------------------------------------

/** 恢复购买（Apple 要求：有订阅的 App 必须提供恢复入口） */
export async function restorePurchasesAsync(): Promise<Entitlement | null> {
  if (!(await ensureConnection())) {
    throw new Error('无法连接到 App Store，请稍后重试');
  }

  const purchases = await getAvailablePurchases({
    onlyIncludeActiveItemsIOS: true,
    alsoPublishToEventListenerIOS: false,
  });

  const best = pickBestEntitlement(purchases ?? []);
  if (!best) {
    await AsyncStorage.removeItem(ENTITLEMENT_KEY);
    return null;
  }
  await saveEntitlement(best);
  return best;
}

/**
 * 启动时校验订阅是否仍然有效（续订 / 退款 / 过期）。
 * 网络异常时沿用本地缓存，绝不因校验失败而剥夺用户已购权益。
 */
export async function refreshEntitlement(): Promise<Entitlement | null> {
  if (!(await ensureConnection())) return loadEntitlement();

  try {
    const purchases = await getAvailablePurchases({
      onlyIncludeActiveItemsIOS: true,
      alsoPublishToEventListenerIOS: false,
    });
    const best = pickBestEntitlement(purchases ?? []);
    if (best) {
      await saveEntitlement(best);
      return best;
    }
    await AsyncStorage.removeItem(ENTITLEMENT_KEY);
    return null;
  } catch (err) {
    console.warn('[IAP] refreshEntitlement failed, fallback to cache:', err);
    return loadEntitlement();
  }
}

/** 从当前有效购买中挑出最优权益（年度优先，其次到期时间最晚） */
function pickBestEntitlement(purchases: Purchase[]): Entitlement | null {
  const list = purchases
    .map(entitlementFromPurchase)
    .filter((e): e is Entitlement => !!e && e.expiryMs > Date.now());

  if (list.length === 0) return null;

  list.sort((a, b) => {
    if (a.plan !== b.plan) return a.plan === 'yearly' ? -1 : 1;
    return b.expiryMs - a.expiryMs;
  });
  return list[0];
}

function entitlementFromPurchase(purchase: Purchase): Entitlement | null {
  const plan = planFromProductId(purchase?.productId);
  if (!plan) return null;

  // iOS 特有字段：expirationDateIOS（毫秒）
  const ios = purchase as unknown as { expirationDateIOS?: number | null };
  const expiryMs =
    typeof ios.expirationDateIOS === 'number' && ios.expirationDateIOS > 0
      ? ios.expirationDateIOS
      : estimateExpiry(purchase.transactionDate, plan);

  return {
    plan,
    productId: purchase.productId,
    expiryMs,
    autoRenewing: !!purchase.isAutoRenewing,
    updatedAt: Date.now(),
  };
}

/** 商店未返回到期时间时，按订阅周期粗估（仅用于展示，实际以商店校验为准） */
function estimateExpiry(fromMs: number, plan: PaidPlan): number {
  const base = typeof fromMs === 'number' && fromMs > 0 ? fromMs : Date.now();
  return plan === 'yearly' ? base + 365 * DAY_MS : base + 30 * DAY_MS;
}

// ---------------------------------------------------------------------------
// 本地权益读写
// ---------------------------------------------------------------------------

export async function saveEntitlement(entitlement: Entitlement): Promise<void> {
  await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(entitlement));
}

export async function loadEntitlement(): Promise<Entitlement | null> {
  try {
    const raw = await AsyncStorage.getItem(ENTITLEMENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Entitlement;
  } catch (err) {
    console.warn('[IAP] loadEntitlement failed:', err);
    return null;
  }
}

/** 当前是否享有会员权益（本地缓存判定，秒开不阻塞 UI） */
export async function isPremium(): Promise<boolean> {
  const entitlement = await loadEntitlement();
  return !!entitlement && entitlement.expiryMs > Date.now();
}

// ---------------------------------------------------------------------------
// 订阅管理（Apple 审核要求：App 内必须提供管理/取消订阅入口）
// ---------------------------------------------------------------------------

export async function openManageSubscriptions(): Promise<boolean> {
  if (!(await ensureConnection())) return false;
  try {
    await deepLinkToSubscriptions();
    return true;
  } catch (err) {
    console.warn('[IAP] deepLinkToSubscriptions failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 错误与工具
// ---------------------------------------------------------------------------

function planFromProductId(productId?: string | null): PaidPlan | null {
  if (!productId) return null;
  if (productId === PRODUCT_IDS.yearly) return 'yearly';
  if (productId === PRODUCT_IDS.monthly) return 'monthly';
  return null;
}

function toFriendlyError(error: PurchaseError | unknown): Error {
  const code = (error as PurchaseError | undefined)?.code;

  if (code === ErrorCode.UserCancelled) {
    const err = new Error('已取消购买') as Error & { userCancelled?: boolean };
    err.userCancelled = true;
    return err;
  }
  if (code === ErrorCode.Pending) {
    return new Error('购买已提交，正在等待家长确认');
  }
  if (code === ErrorCode.ItemUnavailable || code === ErrorCode.SkuNotFound) {
    return new Error('该订阅暂时不可用，请稍后再试');
  }
  if (code === ErrorCode.NetworkError || code === ErrorCode.ServiceError) {
    return new Error('网络异常，请检查网络后重试');
  }
  if (code === ErrorCode.AlreadyOwned) {
    return new Error('你已经订阅了该方案');
  }

  const message = (error as PurchaseError | undefined)?.message;
  return new Error(message || '购买失败，请稍后重试');
}

function wrapError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === 'string' ? err : '购买失败，请稍后重试');
}

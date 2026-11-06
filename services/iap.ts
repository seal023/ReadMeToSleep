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
 *   ASC 参考名 Monthly Subscription → com.seal023.ReadMeToSleep.monthly （$4.99/月）
 *   ASC 参考名 Yearly  Subscription → com.seal023.ReadMeToSleep.yearly  （$49.99/年）
 * 订阅群组 ID：22351191（仅 ASC 后台使用，代码无需引用）
 *
 * ⚠️ 商品 ID 一律由 BUNDLE_ID + 后缀拼出，禁止手抄整串：
 *    以前文档里出现过 `.mor` / `.yea` 这类截断缩写，手抄极易漏字符，
 *    而 ASC 的商品 ID 创建后不可修改，一旦对不上就是「拉不到商品 / 找不到商品」。
 *    这里用单一真源拼接，并额外做启动自检（validateProductIds）。
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ts } from './i18n';
import { logReceipt } from './receiptLog';
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

/** Bundle ID 与 app.json 的 ios.bundleIdentifier 一致（商品 ID 的前缀） */
const BUNDLE_ID = 'com.seal023.ReadMeToSleep';

/** ASC 后台的「参考名称」↔ 代码里的 plan，仅供核对/日志，不参与购买 */
export const ASC_REFERENCE_NAMES: Record<PaidPlan, string> = {
  monthly: 'Monthly Subscription',
  yearly: 'Yearly Subscription',
};

/** 拼接而非手写整串，杜绝 .montly / .year 之类的拼写截断 */
export const PRODUCT_IDS: Record<PaidPlan, string> = {
  monthly: `${BUNDLE_ID}.monthly`,
  yearly: `${BUNDLE_ID}.yearly`,
};

/**
 * 商店返回的商品 ID 兜底归一：StoreKit 偶尔带首尾空白/换行，
 * 直接 === 比较会判成「未知商品」，进而出现「恢复购买找不到商品」。
 * 只做 trim，不改大小写（Apple 商品 ID 大小写敏感）。
 */
export function normalizeProductId(productId?: string | null): string {
  return typeof productId === 'string' ? productId.trim() : '';
}

/** 是否是我们认识的商品（购买事件、恢复购买都靠它过滤） */
export function isKnownProductId(productId?: string | null): boolean {
  const id = normalizeProductId(productId);
  return id === PRODUCT_IDS.monthly || id === PRODUCT_IDS.yearly;
}

/**
 * 启动自检：常量一旦被改坏（截断、拼错、重复），立刻在日志里报出来，
 * 而不是等真机上「拉不到商品」才排查。不抛错、不影响启动。
 */
export function validateProductIds(): boolean {
  const problems: string[] = [];
  (['monthly', 'yearly'] as PaidPlan[]).forEach((plan) => {
    const id = PRODUCT_IDS[plan];
    const expected = `${BUNDLE_ID}.${plan}`;
    if (id !== expected) problems.push(`${plan}: 期望 ${expected}，实际 ${id}`);
    if (/\s/.test(id)) problems.push(`${plan}: 商品 ID 含空白字符`);
    if (id.length !== expected.length) problems.push(`${plan}: 长度异常（疑似截断）`);
  });
  if (PRODUCT_IDS.monthly === PRODUCT_IDS.yearly) problems.push('两个商品 ID 相同');
  if (problems.length) {
    console.error('[IAP] 商品 ID 自检失败：', problems.join('; '));
    return false;
  }
  return true;
}

/**
 * 商店拉取失败时的兜底展示价。
 * 与 App Store Connect 锁定定价一致：月度 $4.99 / 年度 $49.99。
 * 注意：兜底价只用于 UI 展示，实际扣款金额永远以 App Store 返回为准。
 */
export const FALLBACK_PRICES: Record<PaidPlan, string> = {
  monthly: '$4.99',
  yearly: '$49.99',
};

/** 兜底币种（与 ASC 商品定价币种一致） */
export const FALLBACK_CURRENCY = 'USD';

/**
 * 把商店返回的展示价（可能带本地化符号/分隔符）解析成数值。
 * 例："$4.99" → 4.99；"€47,99" → 47.99；"￥540" → 540。
 * 仅用于折算/省钱计算，不用于展示。
 */
function parsePrice(raw: string | number | undefined): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (!raw || typeof raw !== 'string') return undefined;
  const m = raw.replace(/[^0-9.,]/g, '').match(/[0-9]+[.,][0-9]+|[0-9]+/);
  if (!m) return undefined;
  const n = parseFloat(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 用「参考展示价」里的币种符号与小数分隔符，把金额格式化成同风格的字符串。
 * 例：参考 "$4.99"、金额 9.89 → "$9.89"；参考 "€47,99"、金额 9.89 → "€9,89"。
 * 避免把欧区价格写成美式 "€9.89" 这种别扭格式。
 */
export function formatMoney(referenceDisplayPrice: string, amount: number): string {
  const ref = referenceDisplayPrice || FALLBACK_PRICES.monthly;
  const symbol = ref.replace(/[0-9.,\s]/g, '').trim() || '$';
  const usesComma = /,[0-9]/.test(ref);
  const n = usesComma ? amount.toFixed(2).replace('.', ',') : amount.toFixed(2);
  return `${symbol}${n}`;
}

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
  /**
   * App Store 交易号。给客户对账、找 Apple 客服申诉时唯一有用的编号。
   * 商店偶尔不返回（例如从缓存恢复的老记录），所以是可选的。
   */
  transactionId?: string;
  /** 首次购买的交易号（Apple 的 originalTransactionId，续订时保持不变） */
  originalTransactionId?: string;
  /** 购买时间（毫秒时间戳） */
  purchasedAtMs?: number;
}

export interface PlanOffer {
  plan: PaidPlan;
  productId: string;
  /** 商店返回的本地化价格，如 "$4.99"（已按用户 App Store 地区本地化） */
  displayPrice: string;
  currency: string;
  title: string;
  description: string;
  /**
   * 价格的数值形式（如 4.99）。仅用于「年付折算月单价 / 年付省多少」这类计算。
   * 展示价永远用 displayPrice（商店本地化）；这里不做任何本地化格式化。
   */
  price?: number;
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
    // 首次连上商店就做一次商品 ID 自检：拉商品、购买、恢复三条链路都会经过这里
    if (connectionReady) validateProductIds();
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
  validateProductIds();
  try {
    // 请求里只用 PRODUCT_IDS，绝不在别处再写一遍字面量
    const result = await fetchProducts({ skus: ALL_SKUS, type: 'subs' });
    const list: ProductSubscription[] = Array.isArray(result) ? (result as ProductSubscription[]) : [];

    const offers = list
      .filter((p) => p && typeof p.id === 'string')
      .map<PlanOffer | null>((p) => {
        const id = normalizeProductId(p.id);
        const plan = planFromProductId(id);
        // 商店返回了不认识的商品：明确打日志，别静默丢掉后让人以为「价格拉取成功」
        if (!plan) {
          console.warn('[IAP] 商店返回未知商品，已忽略：', JSON.stringify(p.id));
          return null;
        }
        return {
          plan,
          productId: id,
          displayPrice: p.displayPrice || FALLBACK_PRICES[plan],
          currency: p.currency || FALLBACK_CURRENCY,
          title: p.title || '',
          description: p.description || '',
          price: parsePrice(p.price ?? p.displayPrice),
        };
      })
      .filter((o): o is PlanOffer => !!o && ALL_SKUS.includes(o.productId));

    if (offers.length < ALL_SKUS.length) {
      const got = offers.map((o) => o.productId);
      console.warn(
        '[IAP] 商品未全部返回（检查 ASC 商品 ID / 元数据状态 / 是否关联到版本）：',
        JSON.stringify({ expected: ALL_SKUS, got }),
      );
    }
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
    throw new Error(ts('iap.err.connect'));
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
      // 未完成的交易会在每次启动时重放，这里只处理本次要买的商品。
      // 用归一后的 ID 比较：StoreKit 偶发带空白时，严格 === 会漏掉本次购买，
      // 表现为「扣款成功但会员没生效」。
      if (!purchase || normalizeProductId(purchase.productId) !== sku) return;
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
      // v16 官方推荐字段名是 apple / google（ios / android 虽 deprecated 但仍支持；
      // 实测当前版本用 ios/android 会报 "sku property is required"，故用 apple/google）
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
    throw new Error(ts('iap.err.unknownPlan'));
  }
  await saveEntitlement(entitlement);
  // 服务端留痕（fire-and-forget）：供后续接 Apple 服务端校验与客诉排查
  void logReceipt({
    plan: entitlement.plan,
    productId: entitlement.productId,
    transactionId: entitlement.transactionId,
    originalTransactionId: entitlement.originalTransactionId,
    purchasedAtMs: entitlement.purchasedAtMs,
    expiryMs: entitlement.expiryMs,
    autoRenewing: entitlement.autoRenewing,
    source: 'purchase',
  });
  return entitlement;
}

// ---------------------------------------------------------------------------
// 恢复 / 刷新
// ---------------------------------------------------------------------------

/** 恢复购买（Apple 要求：有订阅的 App 必须提供恢复入口） */
export async function restorePurchasesAsync(): Promise<Entitlement | null> {
  if (!(await ensureConnection())) {
    throw new Error(ts('iap.err.connect'));
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
  void logReceipt({
    plan: best.plan,
    productId: best.productId,
    transactionId: best.transactionId,
    originalTransactionId: best.originalTransactionId,
    purchasedAtMs: best.purchasedAtMs,
    expiryMs: best.expiryMs,
    autoRenewing: best.autoRenewing,
    source: 'restore',
  });
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

/**
 * 登录后静默恢复：这是「换新手机 → 登录 → 会员自动回来」的关键一环。
 *
 * 与 restorePurchasesAsync 的两个关键差别：
 *   1. 只在本地「没有」有效权益时才去问 App Store —— 本地已有的权益绝不被覆盖；
 *   2. 找不到订阅时**不删除**本地记录（不擅自清户），只返回 null。
 * 整个调用不弹任何系统框（getAvailablePurchases 是静默查询），可以放心在登录后自动跑。
 */
export async function trySilentRestore(): Promise<Entitlement | null> {
  // 测试开关：强制免费态时不做静默找回，否则一登录又变回会员
  if (await getForceFreeOverride()) return null;
  if (!(await ensureConnection())) return null;

  const current = await loadEntitlement();
  if (current && current.expiryMs > Date.now()) return current;

  try {
    const purchases = await getAvailablePurchases({
      onlyIncludeActiveItemsIOS: true,
      alsoPublishToEventListenerIOS: false,
    });
    const best = pickBestEntitlement(purchases ?? []);
    if (!best) return null;
    await saveEntitlement(best);
    void logReceipt({
      plan: best.plan,
      productId: best.productId,
      transactionId: best.transactionId,
      originalTransactionId: best.originalTransactionId,
      purchasedAtMs: best.purchasedAtMs,
      expiryMs: best.expiryMs,
      autoRenewing: best.autoRenewing,
      source: 'silent',
    });
    return best;
  } catch (err) {
    console.warn('[IAP] trySilentRestore failed:', err);
    return null;
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
  const productId = normalizeProductId(purchase?.productId);
  const plan = planFromProductId(productId);
  if (!plan) return null;

  // iOS 特有字段（v16 的 Purchase 类型在不同小版本上字段名略有差异，
  // 本地 node_modules 还是旧的 v12 类型，所以这里用宽松读取，避免类型假错）
  const raw = purchase as unknown as {
    expirationDateIOS?: number | null;
    transactionId?: string | null;
    originalTransactionId?: string | null;
    transactionDate?: number | null;
  };
  const expiryMs =
    typeof raw.expirationDateIOS === 'number' && raw.expirationDateIOS > 0
      ? raw.expirationDateIOS
      : estimateExpiry(purchase.transactionDate, plan);

  return {
    plan,
    productId,
    expiryMs,
    autoRenewing: !!purchase.isAutoRenewing,
    updatedAt: Date.now(),
    transactionId: raw.transactionId || undefined,
    originalTransactionId: raw.originalTransactionId || undefined,
    purchasedAtMs:
      typeof raw.transactionDate === 'number' && raw.transactionDate > 0
        ? raw.transactionDate
        : undefined,
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

/**
 * 清除本地权益。**退出登录时调用**：
 * 会员是记在账号上的，退出登录后这台设备就不该继续享有会员，
 * 否则同一台手机换个账号登录仍能白用会员。重新登录会自动 trySilentRestore 找回。
 */
export async function clearEntitlement(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ENTITLEMENT_KEY);
  } catch (err) {
    console.warn('[IAP] clearEntitlement failed:', err);
  }
}

/**
 * 测试用：强制免费态。
 * ---------------------------------------------------------------------------
 * 场景：测试账号在沙盒里有订阅，登录后会被 trySilentRestore 找回成会员，
 * 导致无法验收「新人登录后的免费体验」。打开此开关后：
 *   · isPremium() 恒为 false（所有免费门禁生效）
 *   · trySilentRestore() 直接跳过（不会一登录又被找回会员）
 * 家长中心有开关可随时切回。上架前记得关闭并移除入口。
 */
const FORCE_FREE_KEY = 'rms_force_free_override';

export async function getForceFreeOverride(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FORCE_FREE_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setForceFreeOverride(on: boolean): Promise<void> {
  try {
    if (on) await AsyncStorage.setItem(FORCE_FREE_KEY, 'true');
    else await AsyncStorage.removeItem(FORCE_FREE_KEY);
  } catch (err) {
    console.warn('[IAP] setForceFreeOverride failed:', err);
  }
}

/** 当前是否享有会员权益（本地缓存判定，秒开不阻塞 UI） */
export async function isPremium(): Promise<boolean> {
  // 测试开关优先级最高：强制免费态下一切按免费处理
  if (await getForceFreeOverride()) return false;
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

/** 商品 ID → plan。反向查表，避免把 ID 再抄一遍导致两处不一致 */
function planFromProductId(productId?: string | null): PaidPlan | null {
  const id = normalizeProductId(productId);
  if (!id) return null;
  for (const plan of ['monthly', 'yearly'] as PaidPlan[]) {
    if (PRODUCT_IDS[plan] === id) return plan;
  }
  return null;
}

function toFriendlyError(error: PurchaseError | unknown): Error {
  const code = (error as PurchaseError | undefined)?.code;

  if (code === ErrorCode.UserCancelled) {
    const err = new Error(ts('iap.err.cancelled')) as Error & { userCancelled?: boolean };
    err.userCancelled = true;
    return err;
  }
  if (code === ErrorCode.Pending) {
    return new Error(ts('iap.err.pending'));
  }
  if (code === ErrorCode.ItemUnavailable || code === ErrorCode.SkuNotFound) {
    return new Error(ts('iap.err.unavailable'));
  }
  if (code === ErrorCode.NetworkError || code === ErrorCode.ServiceError) {
    return new Error(ts('iap.err.network'));
  }
  if (code === ErrorCode.AlreadyOwned) {
    return new Error(ts('iap.err.already'));
  }

  const message = (error as PurchaseError | undefined)?.message;
  return new Error(message || ts('iap.err.failed'));
}

function wrapError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === 'string' ? err : ts('iap.err.failed'));
}

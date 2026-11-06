/**
 * services/receiptLog.ts — 订阅凭证留痕（服务端审计用）
 *
 * 现状说明（务必看清，别被"服务端校验"四个字误导）：
 *   iOS 端的权益来自 **StoreKit 2**：react-native-iap 拿到的是 Apple 签名的交易
 *   （JWS），库内部会校验签名，伪造需要越狱 + 拦截 StoreKit，门槛很高。
 *   但「客户端说了算」终究不是服务端校验：要真正端到端核验，需要部署一个
 *   Edge Function 调 Apple 的 App Store Server API（需 ASC 的 In-App Purchase Key），
 *   那是下一步的活，且必须在 Apple 侧配置密钥，不能靠客户端完成。
 *
 * 这一版做的事（把地基铺好）：
 *   每次「购买成功 / 恢复购买 / 静默恢复」都把交易要素写到 Supabase 的 iap_receipts，
 *   作为**服务端留痕**。有了这份数据，后续接上 Apple 服务端校验时可以直接比对，
 *   也能据此排查「用户说买了但没生效」这类客诉。
 *
 * 原则：fire-and-forget，绝不阻塞购买流程，失败也不弹窗。
 */

import { supabase } from './supabase';

const TABLE = 'iap_receipts';

export interface ReceiptLogInput {
  plan?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  purchasedAtMs?: number;
  expiryMs?: number;
  autoRenewing?: boolean;
  /** purchase = 本次购买；restore = 手动恢复；silent = 登录后静默恢复 */
  source: 'purchase' | 'restore' | 'silent';
}

export async function logReceipt(input: ReceiptLogInput): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data?.session?.user?.id;
    if (!uid) return; // 未登录：无从归属，跳过
    const row = {
      user_id: uid,
      plan: input.plan ?? null,
      product_id: input.productId ?? null,
      transaction_id: input.transactionId ?? null,
      original_transaction_id: input.originalTransactionId ?? null,
      purchased_at: input.purchasedAtMs ? new Date(input.purchasedAtMs).toISOString() : null,
      expiry: input.expiryMs ? new Date(input.expiryMs).toISOString() : null,
      auto_renewing: input.autoRenewing ?? null,
      source: input.source,
    };
    const { error } = await supabase.from(TABLE).insert(row);
    if (error) console.warn('[ReceiptLog] insert skipped:', error.message);
  } catch (err) {
    console.warn('[ReceiptLog] log failed (ignored):', err);
  }
}

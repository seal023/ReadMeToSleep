/**
 * services/receiptLog.ts — 订阅凭证留痕（去 Supabase 化后为空实现）
 *
 * 原本把 StoreKit 交易要素写到 Supabase 的 iap_receipts 表做服务端留痕。
 * 权益本身来自 StoreKit 2 的 Apple 签名交易（JWS，库内部已校验），从不依赖这张表。
 * 去 Supabase 后保留文件与 logReceipt 签名（iap.ts 三处调用零改动），函数体改为 no-op。
 */

export interface ReceiptLogInput {
  plan?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  purchasedAtMs?: number;
  expiryMs?: number;
  autoRenewing?: boolean;
  source: 'purchase' | 'restore' | 'silent';
}

/** 去后端后为空操作，永不产生网络请求、永不抛错、绝不阻塞购买流程。 */
export async function logReceipt(_input: ReceiptLogInput): Promise<void> {
  // no-op（保留供 iap.ts 调用，签名不变）
}

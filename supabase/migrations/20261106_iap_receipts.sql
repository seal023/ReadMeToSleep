-- ===========================================================================
-- 20261106_iap_receipts.sql
-- 订阅凭证留痕（服务端审计）
--
-- 说明：iOS 端的会员判定来自 StoreKit 2 的 Apple 签名交易（react-native-iap 内部
-- 已校验 JWS 签名）。本表的作用是**把交易要素落到服务端**，用于：
--   ① 客诉排查（用户说买了但没生效，能查到对应的 transaction_id）；
--   ② 将来接 Apple App Store Server API 做真正的服务端校验时，作为比对基准。
-- 客户端只 insert，不读（RLS 只开 insert）。
-- ===========================================================================

create table if not exists public.iap_receipts (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 text        not null,
  plan                    text,
  product_id              text,
  transaction_id          text,
  original_transaction_id text,
  purchased_at            timestamptz,
  expiry                  timestamptz,
  auto_renewing           boolean,
  -- purchase = 本次购买；restore = 手动恢复；silent = 登录后静默恢复
  source                  text        not null default 'purchase',
  created_at              timestamptz not null default now()
);

alter table public.iap_receipts enable row level security;

drop policy if exists "iap_receipts_insert_client" on public.iap_receipts;
create policy "iap_receipts_insert_client"
  on public.iap_receipts
  for insert
  to anon, authenticated
  with check (true);

create index if not exists iap_receipts_user_idx on public.iap_receipts (user_id, created_at desc);
create index if not exists iap_receipts_txn_idx on public.iap_receipts (transaction_id);

-- 分析：最近 30 天的购买留痕
-- select created_at, plan, source, transaction_id from public.iap_receipts
--  where created_at > now() - interval '30 days' order by created_at desc;

-- ReadMeToSleep · AI 故事生成埋点表
-- 在 Supabase 控制台 → SQL Editor 里整段执行即可（幂等，可重复跑）。
-- 对应客户端：services/generationLog.ts
--
-- 字段口径：
--   user_id       登录用户 = auth.users.id；未登录 = 客户端稳定的 anon-* 标识
--   timestamp     生成时刻（timestamptz，含时区）
--   story_length  'short' | 'long'（medium/long 归 long）
--   source        'create' | 'travel' 等入口
--   plan          'free' | 'monthly' | 'yearly'
--   cached        是否命中缓存（正常应为 false，命中缓存不会写日志）

create table if not exists public.generation_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      text        not null,
  "timestamp"  timestamptz not null default now(),
  story_length text        not null check (story_length in ('short', 'long')),
  source       text,
  plan         text,
  cached       boolean     not null default false
);

create index if not exists generation_logs_user_ts_idx
  on public.generation_logs (user_id, "timestamp" desc);
create index if not exists generation_logs_ts_idx
  on public.generation_logs ("timestamp" desc);
create index if not exists generation_logs_length_idx
  on public.generation_logs (story_length);

-- 客户端只允许写，不允许读（埋点数据不暴露给 App）
alter table public.generation_logs enable row level security;

drop policy if exists "generation_logs_insert_client" on public.generation_logs;
create policy "generation_logs_insert_client"
  on public.generation_logs
  for insert
  to anon, authenticated
  with check (true);

-- 不建 select / update / delete 策略：
--   · SQL Editor 用 postgres 角色（绕过 RLS），可直接跑分析 SQL；
--   · service_role 同样绕过 RLS，可供后续服务端报表使用；
--   · anon key 即使被拿到也读不走别人的数据。

-- 常用分析 SQL 示例：
--   select date_trunc('day', "timestamp") as d, story_length, count(*)
--   from public.generation_logs group by 1, 2 order by 1 desc;
--
--   select user_id, count(*) as gens, count(distinct date_trunc('day', "timestamp")) as active_days
--   from public.generation_logs group by user_id order by gens desc limit 50;

-- ===========================================================================
-- 20261106_server_quota_rights.sql
-- 服务端额度 + 免费权益绑定（防改本地时间、防卸载重装重置）
--
-- 背景：
--   额度原先只存在手机 AsyncStorage 里 —— 调快手机日期就能无限刷，
--   卸载重装也能把「1 次免费克隆」重置掉。这里把两件事搬到服务端：
--     1) daily_usage  每天每用户每种用途的用量（日期用**服务器时间**算）；
--     2) user_rights  免费权益（1 次克隆 + 1 篇指定故事），跟着 user_id 走。
--
-- 安全设计：
--   · 两张表都开 RLS 且**不建任何策略** → 客户端 anon/authenticated 无法直接读写；
--     所有读写只走下面几个 SECURITY DEFINER 函数，函数内部用 auth.uid() 定位用户。
--   · 额度日期 = 服务器 now() + 客户端时区偏移（偏移钳制在 ±14 小时内）。
--     客户端时区改了最多挪动一次日界，改系统时间毫无作用。
--   · consume_daily_quota 用单条 upsert 原子加 1，并发点击不会超发。
--
-- 幂等：可重复执行。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. 每日用量
-- ---------------------------------------------------------------------------
create table if not exists public.daily_usage (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  day        date        not null,
  kind       text        not null check (kind in ('story', 'qa', 'checkin')),
  used       integer     not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);

comment on table public.daily_usage is '按用户+服务器日期统计的用量（AI 故事 / 问答 / 打卡）';

alter table public.daily_usage enable row level security;
revoke all on public.daily_usage from anon, authenticated;

create index if not exists daily_usage_user_day_idx on public.daily_usage (user_id, day desc);

-- ---------------------------------------------------------------------------
-- 2. 免费权益（跟账号走，换设备 / 重装 / 退登都不重置）
-- ---------------------------------------------------------------------------
create table if not exists public.user_rights (
  user_id             uuid        primary key references auth.users(id) on delete cascade,
  free_clone_used     boolean     not null default false,
  free_clone_story_id text,
  free_clone_target   text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.user_rights is '免费用户的 1 次声音克隆 + 1 篇指定故事权益，绑定 user_id';

alter table public.user_rights enable row level security;
revoke all on public.user_rights from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 内部工具：把「服务器时间 + 时区偏移」折算成用户当地的日期
-- ---------------------------------------------------------------------------
create or replace function public.local_day(p_tz_minutes integer)
returns date
language sql
stable
as $$
  select ((now() + make_interval(mins => greatest(-840, least(840, coalesce(p_tz_minutes, 0)))))
          at time zone 'UTC')::date;
$$;

-- ---------------------------------------------------------------------------
-- 4. 只读查询：今天用了多少（不消耗）
-- ---------------------------------------------------------------------------
create or replace function public.peek_daily_usage(p_kind text, p_tz_minutes integer default 0)
returns table (day date, used integer, server_now timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  v_day := public.local_day(p_tz_minutes);
  return query
    select v_day, coalesce(du.used, 0), now()
    from (select 1) as dummy
    left join public.daily_usage du
      on du.user_id = auth.uid() and du.day = v_day and du.kind = p_kind;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 原子消耗一次：达到上限则拒绝（allowed = false，不会加）
-- ---------------------------------------------------------------------------
create or replace function public.consume_daily_quota(
  p_kind       text,
  p_limit      integer,
  p_tz_minutes integer default 0
)
returns table (allowed boolean, used integer, day date, server_now timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day  date;
  v_used integer;
  v_ok   boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_limit is null or p_limit < 1 then
    return query select false, 0, public.local_day(p_tz_minutes), now();
    return;
  end if;

  v_day := public.local_day(p_tz_minutes);

  -- 已有记录：仅当 used < limit 时才 +1；否则 WHERE 不成立 → 不返回行 → v_used 为 null
  update public.daily_usage du
     set used = du.used + 1, updated_at = now()
   where du.user_id = auth.uid() and du.day = v_day and du.kind = p_kind
     and du.used < p_limit
  returning du.used into v_used;

  if v_used is not null then
    return query select true, v_used, v_day, now();
    return;
  end if;

  -- 没有记录（首次）或已达上限：用 upsert 兜住「并发下两边都没记录」的竞态
  insert into public.daily_usage (user_id, day, kind, used, updated_at)
  values (auth.uid(), v_day, p_kind, 1, now())
  on conflict (user_id, day, kind) do update
    set used = public.daily_usage.used + 1, updated_at = now()
    where public.daily_usage.used < p_limit
  returning public.daily_usage.used into v_used;

  v_ok := v_used is not null;

  if not v_ok then
    select du.used into v_used
      from public.daily_usage du
     where du.user_id = auth.uid() and du.day = v_day and du.kind = p_kind;
  end if;

  return query select v_ok, coalesce(v_used, 0), v_day, now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 退还一次（AI 请求失败 / 超时放弃时用，保证「失败不扣次数」）
-- ---------------------------------------------------------------------------
create or replace function public.refund_daily_quota(p_kind text, p_tz_minutes integer default 0)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.daily_usage du
     set used = greatest(0, du.used - 1), updated_at = now()
   where du.user_id = auth.uid()
     and du.day = public.local_day(p_tz_minutes)
     and du.kind = p_kind
  returning du.used into v_used;
  return coalesce(v_used, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 免费权益：读取
-- ---------------------------------------------------------------------------
create or replace function public.get_my_rights()
returns table (free_clone_used boolean, free_clone_story_id text, free_clone_target text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return query
    select coalesce(r.free_clone_used, false),
           coalesce(r.free_clone_story_id, ''),
           coalesce(r.free_clone_target, '')
    from (select 1) as dummy
    left join public.user_rights r on r.user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. 免费权益：原子占用「那一次克隆」（已用过则返回 false，不会重复放行）
-- ---------------------------------------------------------------------------
create or replace function public.claim_free_clone(p_target text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.user_rights (user_id, free_clone_used, free_clone_target, updated_at)
  values (auth.uid(), true, p_target, now())
  on conflict (user_id) do update
    set free_clone_used = true,
        free_clone_target = coalesce(excluded.free_clone_target, public.user_rights.free_clone_target),
        updated_at = now()
    where public.user_rights.free_clone_used = false
  returning public.user_rights.free_clone_used into v_ok;

  return coalesce(v_ok, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. 免费权益：记录「指定给免费用户的那一篇」
-- ---------------------------------------------------------------------------
create or replace function public.set_free_clone_story(p_story_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  insert into public.user_rights (user_id, free_clone_story_id, updated_at)
  values (auth.uid(), p_story_id, now())
  on conflict (user_id) do update
    set free_clone_story_id = excluded.free_clone_story_id,
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. 注销账号时一并清掉（delete_me 已存在的话，这两张表靠 on delete cascade 自动清）
--     这里只补一句说明：user_id 外键带 on delete cascade，删除 auth.users 行即级联。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 分析用（在 SQL Editor 里以 postgres 角色跑，绕过 RLS）：
--   今日各用户用量
--   select day, kind, count(*) as users, sum(used) as total from public.daily_usage
--    where day >= current_date - 7 group by 1,2 order by 1 desc;
--   免费权益使用情况
--   select count(*) filter (where free_clone_used) as used_clone, count(*) as total from public.user_rights;
-- ---------------------------------------------------------------------------

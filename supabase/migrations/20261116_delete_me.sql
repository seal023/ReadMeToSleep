-- ===========================================================================
-- 20261116_delete_me.sql
-- 应用内注销账号（Apple App Store Guideline 5.1.1(v) 硬性要求）
--
-- 客户端调用：services/auth.ts 的 deleteAccountAsync() → supabase.rpc('delete_me')
-- 这个函数以 SECURITY DEFINER 运行（拥有者权限），用 auth.uid() 精确定位
-- 「当前登录用户自己」，只能删自己，不能删别人。客户端拿不到 service_role key。
--
-- 执行方式：Supabase 控制台 → SQL Editor → 整段粘贴 → Run（幂等，可重复跑）。
-- ===========================================================================

-- 先用 drop 保证可重复执行（返回类型和参数保持一致）
drop function if exists public.delete_me();

create function public.delete_me()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
begin
  -- 必须已登录：杜绝匿名调用
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- 1) user_id 为 text、无外键的表：手动删除该用户的数据
  --    （daily_usage / user_rights 的 user_id 是 uuid 外键且带 on delete cascade，
  --      会在下面 delete from auth.users 时自动级联清掉，无需在此处理。）
  delete from public.generation_logs where user_id = v_uid::text;
  delete from public.iap_receipts    where user_id = v_uid::text;

  -- 2) 删除 auth.users 本体：级联清掉 daily_usage / user_rights，
  --    并使该用户所有会话 token 失效（此后无法再登录/访问）。
  delete from auth.users where id = v_uid;
end;
$$;

-- 只允许已登录用户调用
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

comment on function public.delete_me() is
  '应用内注销：删除当前登录用户自己的全部业务数据及 auth.users 账号（5.1.1(v)）';

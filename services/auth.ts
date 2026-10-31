/**
 * services/auth.ts — 账号：Sign in with Apple + 邮件验证码
 *
 * 两种方式都落到同一个 Supabase 用户体系（同一个人的 Pro 权益只有一份）：
 *   1) Apple：expo-apple-authentication 拿到 identityToken → supabase.auth.signInWithIdToken
 *      —— 纯原生，不需要跳浏览器，也不会离开 App。
 *   2) 邮件：signInWithOtp 发 6 位验证码 → verifyOtp 校验。
 *      ⚠️ 需要 Supabase 后台把「Magic Link」邮件模板里的 {{ .ConfirmationURL }}
 *         改成 {{ .Token }}，否则邮件里只有链接、没有 6 位数字，用户没法在本页输入。
 *
 * 会话持久化由 services/supabase.ts 的 storage: AsyncStorage 负责，
 * 重开 App 自动恢复登录态，不需要重复登录。
 */

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { Session, User } from '@supabase/supabase-js';
import { isAuthConfigured, supabase } from './supabase';

/** 账号服务未配置时统一抛这个，UI 据此给出准确提示而不是"网络错误" */
export const AUTH_NOT_CONFIGURED =
  '账号服务尚未配置（缺少 Supabase 环境变量），请在构建环境中补齐后重试。';

function client() {
  if (!supabase || !isAuthConfigured) throw new Error(AUTH_NOT_CONFIGURED);
  return supabase;
}

// ---------------------------------------------------------------------------
// Apple 登录
// ---------------------------------------------------------------------------

/** 当前设备能否用 Apple 登录（iOS 13+ 且系统支持） */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export interface AppleSignInResult {
  session: Session | null;
  user: User | null;
}

/**
 * 发起 Apple 登录。
 * @throws 用户取消时抛出的 Error 带 `userCancelled = true`（调用方应静默处理）
 */
export async function signInWithApple(): Promise<AppleSignInResult> {
  const sb = client();

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    // ERR_CANCELED 是用户自己点了取消，不该弹错误
    if (code === 'ERR_CANCELED' || code === 'ERR_REQUEST_CANCELED') {
      const e = new Error('已取消登录') as Error & { userCancelled?: boolean };
      e.userCancelled = true;
      throw e;
    }
    throw new Error('Apple 登录失败，请稍后重试');
  }

  const identityToken = credential.identityToken;
  if (!identityToken) {
    throw new Error('未拿到 Apple 身份令牌，请重试（若反复出现请检查 App ID 是否开启 Sign in with Apple）');
  }

  const { data, error } = await sb.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
  });
  if (error) throw friendlyAuthError(error);

  // Apple 只在「第一次授权」返回姓名，之后都是 null。
  // 首次拿到就写进用户元数据，后续所有设备都能读到这个名字。
  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (fullName) {
    try {
      await sb.auth.updateUser({ data: { full_name: fullName } });
    } catch {
      /* 写元数据失败不影响登录本身 */
    }
  }

  return { session: data.session ?? null, user: data.user ?? null };
}

// ---------------------------------------------------------------------------
// 邮件验证码
// ---------------------------------------------------------------------------

/** 发送 6 位验证码到邮箱（新邮箱自动注册） */
export async function sendEmailCode(email: string): Promise<void> {
  const sb = client();
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    throw new Error('邮箱格式不正确，请检查后重试');
  }
  const { error } = await sb.auth.signInWithOtp({
    email: clean,
    options: { shouldCreateUser: true },
  });
  if (error) throw friendlyAuthError(error);
}

/** 校验 6 位验证码，成功后即建立会话（首次即注册） */
export async function verifyEmailCode(
  email: string,
  code: string
): Promise<AppleSignInResult> {
  const sb = client();
  const clean = email.trim().toLowerCase();
  const token = code.replace(/\D/g, '');
  if (token.length < 6) throw new Error('请输入邮件里的 6 位数字验证码');

  const { data, error } = await sb.auth.verifyOtp({
    email: clean,
    token,
    type: 'email',
  });
  if (error) throw friendlyAuthError(error);
  return { session: data.session ?? null, user: data.user ?? null };
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  } catch {
    return null;
  }
}

export function onAuthStateChange(cb: (session: Session | null) => void) {
  if (!supabase) return { unsubscribe: () => {} };
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return data.subscription;
}

export async function signOutAsync(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw friendlyAuthError(error);
}

/**
 * 注销账号（Apple 5.1.1(v) 硬性要求：能注册就必须能删除）。
 * 服务端通过 SECURITY DEFINER 的 SQL 函数 delete_me() 以 auth.uid() 删除自己，
 * 客户端拿不到 service_role key，也不需要。
 */
export async function deleteAccountAsync(): Promise<void> {
  const sb = client();
  const { error } = await sb.rpc('delete_me');
  if (error) {
    throw new Error(
      '账号删除失败。若这是首次使用该功能，请确认 Supabase 已创建 delete_me 函数。'
    );
  }
  await sb.auth.signOut().catch(() => {});
}

// ---------------------------------------------------------------------------
// 错误本地化
// ---------------------------------------------------------------------------

function friendlyAuthError(error: { message?: string; status?: number }): Error {
  const msg = (error?.message || '').toLowerCase();

  if (msg.includes('provider is not enabled') || msg.includes('unsupported provider')) {
    return new Error('该登录方式尚未在服务端开启，请联系开发者配置 Supabase 的 Apple Provider');
  }
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return new Error('发送太频繁了，请稍等几分钟再试');
  }
  if (msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) {
    return new Error('验证码不正确或已过期，请重新获取');
  }
  if (msg.includes('signups not allowed') || msg.includes('email not confirmed')) {
    return new Error('该邮箱暂时无法注册，请换一个邮箱或联系客服');
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return new Error('网络异常，请检查网络后重试');
  }
  return new Error(error?.message || '操作失败，请稍后重试');
}

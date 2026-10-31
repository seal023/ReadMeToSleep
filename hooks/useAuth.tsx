/**
 * hooks/useAuth.tsx — 全局登录态
 *
 * 挂在 app/_layout.tsx 的 LanguageProvider 内层，全 App 共享同一个会话。
 * 只要登录过，重开 App 会自动恢复（Supabase 把会话存在 AsyncStorage）。
 *
 * 用法：
 *   const { isSignedIn, email, displayName, signInApple, sendCode, verifyCode, signOut } = useAuth();
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import {
  deleteAccountAsync,
  getSession,
  isAppleSignInAvailable,
  onAuthStateChange,
  sendEmailCode,
  signInWithApple,
  signOutAsync,
  verifyEmailCode,
} from '@/services/auth';
import { isAuthConfigured } from '@/services/supabase';
import { clearEntitlement } from '@/services/iap';

export interface AuthContextValue {
  /** 账号服务是否已配置（构建时注入了 Supabase 变量） */
  configured: boolean;
  /** 正在恢复会话（冷启动那一下），UI 可先显示占位 */
  loading: boolean;
  session: Session | null;
  user: User | null;
  isSignedIn: boolean;
  /** 展示用账号标识：邮箱优先，Apple 无邮箱时回落 uid 片段 */
  email: string | null;
  displayName: string;
  /** 当前设备是否支持 Apple 登录 */
  appleAvailable: boolean;
  signInApple: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  // 冷启动恢复会话
  useEffect(() => {
    let alive = true;
    (async () => {
      if (isAuthConfigured) {
        const s = await getSession();
        if (alive) setSession(s);
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 订阅会话变化（登录 / 登出 / token 刷新）
  useEffect(() => {
    if (!isAuthConfigured) return;
    const sub = onAuthStateChange((s) => setSession(s));
    return () => {
      try {
        sub.unsubscribe();
      } catch {
        /* noop */
      }
    };
  }, []);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const signInApple = useCallback(async () => {
    const result = await signInWithApple();
    if (result.session) setSession(result.session);
  }, []);

  const sendCode = useCallback(async (email: string) => {
    await sendEmailCode(email);
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const result = await verifyEmailCode(email, code);
    if (result.session) setSession(result.session);
  }, []);

  const signOut = useCallback(async () => {
    await signOutAsync();
    // 会员归属账号：退出后清掉本地权益，避免同机换号白用会员。
    // 下次登录会由 EntitlementSyncOnLogin 静默找回。
    await clearEntitlement();
    setSession(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteAccountAsync();
    setSession(null);
  }, []);

  const user = session?.user ?? null;
  const email = user?.email ?? null;
  const displayName = useMemo(() => {
    const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
    const name = meta.full_name || meta.name;
    if (name && name.trim()) return name.trim();
    if (email) return email.split('@')[0];
    return '妈妈/爸爸';
  }, [user, email]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isAuthConfigured,
      loading,
      session,
      user,
      isSignedIn: !!session,
      email,
      displayName,
      appleAvailable,
      signInApple,
      sendCode,
      verifyCode,
      signOut,
      deleteAccount,
    }),
    [
      loading,
      session,
      user,
      email,
      displayName,
      appleAvailable,
      signInApple,
      sendCode,
      verifyCode,
      signOut,
      deleteAccount,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}

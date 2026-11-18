/**
 * hooks/useAuth.tsx — 全局登录态（去 Supabase 化，本地会话）
 *
 * 挂在 app/_layout.tsx 的 LanguageProvider 内层，全 App 共享同一个会话。
 * 会话只存本机 AsyncStorage（services/auth.ts），不发任何服务器；
 * 只要登录过，重开 App 自动恢复，不需要重复登录。
 *
 * 对外接口与去后端前保持一致（configured / loading / session / user /
 * isSignedIn / email / displayName / appleAvailable / signInApple /
 * signOut / deleteAccount），调用方无需改动。
 * 已删除：邮件登录 sendCode/verifyCode、深链登录 linkLoginSeq（D1 邮件登录下线）。
 *
 * 用法：
 *   const { isSignedIn, email, displayName, signInApple, signOut } = useAuth();
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
import {
  deleteAccountAsync,
  getSession,
  isAppleSignInAvailable,
  signInWithApple,
  signOutAsync,
  type Session,
  type User,
} from '@/services/auth';
import { clearEntitlement } from '@/services/iap';
import { clearAccountScopedData } from '@/services/storage';
import { clearAllClonedAudioCache } from '@/services/clonedVoicePlayback';
import { useLanguage } from '@/hooks/useLanguage';

export interface AuthContextValue {
  /** 兼容旧字段：去后端后账号服务恒可用（纯本地），恒为 true */
  configured: boolean;
  /** 正在恢复会话（冷启动那一下），UI 可先显示占位 */
  loading: boolean;
  session: Session | null;
  user: User | null;
  isSignedIn: boolean;
  /** 展示用账号标识：邮箱优先，Apple 无邮箱时回落 id 片段 */
  email: string | null;
  displayName: string;
  /** 当前设备是否支持 Apple 登录 */
  appleAvailable: boolean;
  signInApple: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  // 冷启动恢复本地会话（读一次 AsyncStorage，很快）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await getSession();
        if (alive) setSession(s);
      } catch {
        /* 读失败当作未登录，不阻塞启动 */
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const signInApple = useCallback(async () => {
    const result = await signInWithApple();
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
    // 1) 本地身份：清本机会话（去后端后没有服务端 delete_me 可调用）
    await deleteAccountAsync();
    // 2) 本地：清会员权益（与 signOut 对齐，避免同机换号白用会员）
    await clearEntitlement();
    // 3) 本地：清账号身份/免费克隆资格等跟账号走的数据
    await clearAccountScopedData();
    // 4) 本地：清克隆声音缓存文件（父母/至亲声音，隐私敏感，注销后不留本机）
    clearAllClonedAudioCache();
    // 5) 客户端登出会话
    setSession(null);
  }, []);

  const { language } = useLanguage();
  const user = session?.user ?? null;
  const email = user?.email ?? null;
  const displayName = useMemo(() => {
    if (user?.fullName && user.fullName.trim()) return user.fullName.trim();
    if (email) return email.split('@')[0];
    // 无姓名无邮箱时的兜底称呼：按界面语言给对应语种，避免英文界面冒出中文。
    return language === 'en' ? 'Mom / Dad' : '妈妈/爸爸';
  }, [user, email, language]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: true,
      loading,
      session,
      user,
      isSignedIn: !!session,
      email,
      displayName,
      appleAvailable,
      signInApple,
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

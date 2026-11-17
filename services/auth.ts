/**
 * services/auth.ts — 账号：本地 Sign in with Apple（去 Supabase 化，v116）
 *
 * 2026-11-17：彻底移除 Supabase。原因：Supabase 免费项目长期不活跃被回收，
 * 域名 NXDOMAIN → 真机登录报「未能找到使用指定主机名的服务器」，全 App 登录瘫痪。
 *
 * 现在的设计：
 *   · 登录只做「本地身份」——Sign in with Apple 拿到 Apple 的稳定 user id + 邮箱，
 *     只写到本机 AsyncStorage，不发任何服务器。
 *   · Pro 权益从来不在账号后端：它是 StoreKit 2 交易 + 本地 AsyncStorage（services/iap.ts），
 *     换机靠「恢复购买」向 App Store 查账，与登录无关。
 *   · 账号注销 = 清本机全部账号/权益/克隆音频数据（Apple 5.1.1(v) 依然满足）。
 *
 * 会话持久化：本地 AsyncStorage，重开 App 自动恢复，不需要重复登录。
 */

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ts } from './i18n';

const SESSION_KEY = 'rms_local_auth_session';

/** 极简本地用户：Apple 稳定 id + 首次授权返回的邮箱/姓名 */
export interface User {
  id: string;
  email: string | null;
  fullName: string | null;
}

export interface Session {
  user: User;
}

export interface AppleSignInResult {
  session: Session | null;
  user: User | null;
}

/** 当前设备能否用 Apple 登录（iOS 13+ 且系统支持） */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * 发起 Apple 登录：只取身份存本地，不上传任何服务器。
 * @throws 用户取消时抛出的 Error 带 `userCancelled = true`（调用方应静默处理）
 */
export async function signInWithApple(): Promise<AppleSignInResult> {
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
      const e = new Error(ts('auth.err.cancelled')) as Error & { userCancelled?: boolean };
      e.userCancelled = true;
      throw e;
    }
    throw new Error(ts('auth.err.appleFail'));
  }

  const id = credential.user;
  if (!id) throw new Error(ts('auth.err.appleFail'));

  // Apple 只在首次授权返回姓名/邮箱（之后可能为 null）——与旧会话合并，避免丢失显示名
  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const prev = await getSession().catch(() => null);
  const user: User = {
    id,
    email: credential.email || prev?.user?.email || null,
    fullName: fullName || prev?.user?.fullName || null,
  };
  const session: Session = { user };
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* 写失败不阻塞本次登录态（内存里仍算登录） */
  }
  return { session, user };
}

/** 读本地会话；没有 / 损坏都返回 null */
export async function getSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (parsed?.user?.id) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** 退出登录：只清本地会话，不动权益（权益清理由 useAuth.signOut 负责） */
export async function signOutAsync(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 注销账号（Apple 5.1.1(v)）。
 * 去后端后「删除账号」= 清本机身份会话；会员权益/账号昵称/免费克隆资格/克隆音频缓存
 * 由 useAuth.deleteAccount() 统一清理（clearEntitlement / clearAccountScopedData / clearAllClonedAudioCache）。
 */
export async function deleteAccountAsync(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * services/generationLog.ts — AI 故事生成埋点（纯后台，不进 UI）
 *
 * 每次「真正发起一次生成 / 扣减当日次数」写一条到 Supabase 的 generation_logs：
 *   user_id      登录用户用 Supabase Auth 的 uid；未登录用本机稳定的匿名 ID
 *   timestamp    生成时刻（服务端 now() 兜底，客户端也带一份）
 *   story_length 'short' | 'long'（medium / long 三档统一归到 long，便于跑 SQL）
 *
 * 设计原则：
 *   1. 纯 fire-and-forget：不 await 到 UI 流程里、不弹错、不重试、失败只打日志。
 *      埋点表还没建 / 没网 / RLS 拒绝，都绝不能影响孩子听故事。
 *   2. 缓存命中（直接播旧故事）不写日志 —— 那不是一次生成请求。
 *   3. 只 insert，客户端不读：分析走 Supabase SQL Editor / service_role。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const TABLE = 'generation_logs';
const ANON_ID_KEY = 'rms_analytics_anon_id';

/** 分析用的两档：短篇 / 长篇（中篇归入长篇） */
export type StoryLengthBucket = 'short' | 'long';

export interface GenerationLogInput {
  storyLength: StoryLengthBucket;
  /** 入口，便于区分「编故事」与「旅行打卡」 */
  source?: string;
  /** free / monthly / yearly */
  plan?: string;
  /** 是否命中缓存（命中时不该调用本函数，留作诊断位） */
  cached?: boolean;
}

/** 未登录用户也给一个稳定的本机 ID，否则所有匿名行为会挤成一条 null */
async function resolveUserId(): Promise<string> {
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id;
      if (uid) return uid;
    } catch {
      /* 会话读不到就退回匿名 ID */
    }
  }
  try {
    let anon = await AsyncStorage.getItem(ANON_ID_KEY);
    if (!anon) {
      anon = `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      await AsyncStorage.setItem(ANON_ID_KEY, anon);
    }
    return anon;
  } catch {
    return 'anon-unknown';
  }
}

/**
 * 写一条生成日志。调用方用 `void logGeneration(...)`，不要 await 到主流程。
 * supabase 未配置（本地模式）时直接返回，不产生任何网络请求。
 */
export async function logGeneration(input: GenerationLogInput): Promise<void> {
  if (!supabase) return;
  try {
    const user_id = await resolveUserId();
    const row = {
      user_id,
      timestamp: new Date().toISOString(),
      story_length: input.storyLength === 'short' ? 'short' : 'long',
      source: input.source ?? 'create',
      plan: input.plan ?? 'free',
      cached: !!input.cached,
    };
    const { error } = await supabase.from(TABLE).insert(row);
    // 表尚未创建 / RLS 未放行时只打一条日志，绝不抛给 UI
    if (error) console.warn('[GenerationLog] insert skipped:', error.message);
  } catch (err) {
    console.warn('[GenerationLog] log failed (ignored):', err);
  }
}

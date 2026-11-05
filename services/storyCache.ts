/**
 * services/storyCache.ts — AI 故事「按参数」本地缓存（成本与额度的第一道闸）
 *
 * 同一组主题 / 主角 / 细节 / 语言 / 时长，只向云端要一次稿子：
 *   · 命中后 create.tsx 直接跳到已保存的故事播放，**不扣当日次数、不发 LLM 请求、不写埋点**；
 *   · ai.ts 也会先查这份缓存，任何绕过 UI 的生成入口（如旅行打卡）同样复用；
 *   · 家长新增/修改敏感词会改变 key，不会把「按旧词表生成的故事」翻出来给孩子听。
 *
 * 存储：AsyncStorage 里一份小索引（最多 MAX_ENTRIES 条，超出按时间淘汰）。
 * 真正的大正文留在 stories 里（getStories），索引只记 storyId + 一份结果副本。
 * 结果副本用于「原故事已被删除」时仍能不联网地重放一份，以及给其它生成入口复用。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GenerateStoryParams, StoryGenerateResult } from '../types';
import { getStories } from './storage';

const CACHE_KEY = 'rms_generated_story_cache_v1';
const MAX_ENTRIES = 24;

export interface CachedStory {
  /** 已保存下来的故事 id；可能被用户删掉，用之前要校验 */
  storyId?: string;
  title: string;
  content: string;
  duration: number;
  createdAt: string;
}

type CacheMap = Record<string, CachedStory>;

function norm(v?: string): string {
  return (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 稳定 hash（与音频缓存同一套思路，纯确定性、无随机数） */
function hashText(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * 生成参数的缓存键。
 * 注意把 sensitiveWords 纳入：家长后来加了禁词，同一主题必须重新生成，
 * 否则缓存会把含旧违禁词的故事直接放出来。
 */
export function storyCacheKey(params: GenerateStoryParams): string {
  const words = (params.sensitiveWords ?? []).map(norm).filter(Boolean).sort();
  const raw = [
    norm(params.theme),
    norm(params.protagonist),
    norm(params.details),
    params.language || 'zh',
    params.length || 'short',
    words.join('|'),
  ].join('\u0001');
  return hashText(raw);
}

async function readMap(): Promise<CacheMap> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CacheMap) : {};
  } catch {
    return {};
  }
}

async function writeMap(map: CacheMap): Promise<void> {
  try {
    const keys = Object.keys(map);
    let next = map;
    if (keys.length > MAX_ENTRIES) {
      const keep = keys
        .sort((a, b) => (map[b].createdAt || '').localeCompare(map[a].createdAt || ''))
        .slice(0, MAX_ENTRIES);
      next = {};
      for (const k of keep) next[k] = map[k];
    }
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[StoryCache] write failed:', err);
  }
}

/** 直接取一份可复用的生成结果（供 ai.ts 在任何入口先查缓存） */
export async function getCachedResult(key: string): Promise<StoryGenerateResult | null> {
  const map = await readMap();
  const hit = map[key];
  if (!hit || !hit.content || hit.content.trim().length < 20) return null;
  return { title: hit.title, content: hit.content, duration: hit.duration };
}

/** 生成成功后写入结果（不覆盖已有的 storyId） */
export async function putCachedResult(
  key: string,
  result: StoryGenerateResult,
): Promise<void> {
  const map = await readMap();
  const prev = map[key];
  map[key] = {
    storyId: prev?.storyId,
    title: result.title,
    content: result.content,
    duration: result.duration,
    createdAt: new Date().toISOString(),
  };
  await writeMap(map);
}

/** create.tsx 保存故事后把 storyId 绑到同一个 key，命中即可直接跳转播放 */
export async function attachStoryId(key: string, storyId: string): Promise<void> {
  const map = await readMap();
  const entry = map[key];
  if (!entry) return;
  map[key] = { ...entry, storyId };
  await writeMap(map);
}

/**
 * 查缓存并校验「可播放的那篇故事还在不在」。
 * 返回 null 表示没有可用缓存，调用方应走正常生成流程。
 */
export async function findPlayableCachedStory(
  key: string,
): Promise<{ storyId?: string; result: StoryGenerateResult } | null> {
  const map = await readMap();
  const hit = map[key];
  if (!hit || !hit.content || hit.content.trim().length < 20) return null;
  const result: StoryGenerateResult = {
    title: hit.title,
    content: hit.content,
    duration: hit.duration,
  };
  if (!hit.storyId) return { result };
  try {
    const stories = await getStories();
    const exists = stories.some((s) => s.id === hit.storyId);
    if (exists) return { storyId: hit.storyId, result };
    // 故事被删了：留着正文，下次仍可不联网重放一份
    map[key] = { ...hit, storyId: undefined };
    await writeMap(map);
  } catch {
    /* 读不到列表就只返回正文 */
  }
  return { result };
}

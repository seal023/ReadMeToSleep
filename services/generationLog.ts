/**
 * services/generationLog.ts — AI 故事生成埋点（去 Supabase 化后为空实现）
 *
 * 原本每次生成写一条到 Supabase 的 generation_logs 表（纯 fire-and-forget 统计）。
 * 去 Supabase 后没有上报目标，且它从不进 UI、失败也不影响功能，
 * 因此保留文件与 logGeneration 签名（调用方零改动），函数体改为 no-op。
 * 将来若要恢复统计，接自有 HTTP 端点即可，与本清单无关。
 */

/** 分析用的两档：短篇 / 长篇（中篇归入长篇） */
export type StoryLengthBucket = 'short' | 'long';

export interface GenerationLogInput {
  storyLength: StoryLengthBucket;
  source?: string;
  plan?: string;
  cached?: boolean;
}

/** 写一条生成日志。去后端后为空操作，永不产生网络请求、永不抛错。 */
export async function logGeneration(_input: GenerationLogInput): Promise<void> {
  // no-op（保留供 entitlement.ts 调用，签名不变）
}

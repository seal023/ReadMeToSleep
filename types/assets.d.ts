/**
 * 静态资源（音频）的类型声明
 * ---------------------------------------------------------------------------
 * `assets/prompts/index.ts` 由 scripts/gen-prompt-audio.mjs 生成，里面是
 * `require('./xxx.mp3')` 的字面量列表（Metro 只能静态解析字面量 require）。
 * TS 需要知道 .mp3 是「可 require 的资源」。
 */

declare module '*.mp3' {
  const assetId: number;
  export default assetId;
}

declare module '*.wav' {
  const assetId: number;
  export default assetId;
}

declare module '*.m4a' {
  const assetId: number;
  export default assetId;
}

/**
 * 长文本 TTS 费用核验（静态检查，不联网、不改文件）
 * 运行：node scripts/verify-tts-cache.mjs
 *
 * 目的：确认「再次播放 / 重新收听」100% 走本地分片缓存，
 * 绝不存在绕过缓存直接打云端 TTS 的路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const engine = read('services/clonedVoicePlayback.ts');
const playback = read('services/playback.ts');
const story = read('app/story/[id].tsx');
const lines = engine.split('\n');
const lineOf = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;

let failed = 0;
function check(name, ok, detail = '') {
  const tag = ok ? 'PASS' : 'FAIL';
  if (!ok) failed++;
  console.log(`  [${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

section('1. 云端合成只有一个出口');
const ensureStart = lineOf('async function ensureSynthFile');
const prewarmStart = lineOf('export async function prewarmClonedAudio');
// 只统计真实代码行，忽略文件头/行内注释里提到的函数名
const synthCallLines = [];
lines.forEach((l, i) => {
  const t = l.trim();
  if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
  if (/synthesizeWithClonedVoice\s*\(/.test(l)) synthCallLines.push(i + 1);
});
check(
  'clonedVoicePlayback.ts 里只有 1 处真正调用 synthesizeWithClonedVoice（其余为 import）',
  synthCallLines.length === 1,
  `找到 ${synthCallLines.length} 处`,
);
check(
  '该调用位于 ensureSynthFile 内部',
  synthCallLines.length === 1 && synthCallLines[0] > ensureStart && synthCallLines[0] < prewarmStart,
  `调用行 ${synthCallLines[0]}，ensureSynthFile ${ensureStart}–${prewarmStart}`,
);
check(
  'voiceClone.ts 只在引擎之外定义该接口（无第二处直调）',
  !/synthesizeWithClonedVoice\s*\(/.test(playback) && !/synthesizeWithClonedVoice\s*\(/.test(story),
);

section('2. 每次合成前必查本地缓存');
const ensureBody = lines.slice(ensureStart - 1, prewarmStart - 1).join('\n');
check('命中本地文件立即返回，不发请求', /if \(isUsableCacheFile\(cached\)\)/.test(ensureBody) && /return \{ ok: true \}/.test(ensureBody));
check('并发请求被 inflight 合并', /inflight\.get\(fileName\)/.test(ensureBody));
check('失败有冷却，不会反复重试扣费', /failedCooldown\.get/.test(ensureBody) && /FAILED_COOLDOWN_MS/.test(engine));
check('缓存文件有有效性校验（不会把 0 字节当命中）', /function isUsableCacheFile/.test(engine) && /size < 512/.test(engine));
check('缓存落在 Paths.document（不会被 iOS 回收）', /new Directory\(Paths\.document, AUDIO_DIR_NAME\)/.test(engine));

section('3. 分片缓存的键是确定性的');
check('cacheFileName = 音色 + 文本 hash', /rms_clone_\$\{encodeURIComponent\(target\)\}_\$\{hashText\(text\)\}\.mp3/.test(engine));
const pureFns = ['function hashText', 'function splitIntoChunks', 'function dedupeAdjacentSentences'];
for (const fn of pureFns) {
  const start = lineOf(fn);
  // 取该函数往后 90 行做粗略扫描（只查随机/时间源）
  const body = lines.slice(start - 1, start + 90).join('\n');
  check(`${fn} 不含随机数 / 当前时间`, !/Math\.random|Date\.now\(\)|new Date\(/.test(body));
}
check('预热与播放共用同一套切分与去重', /dedupeAdjacentSentences\(text\)/.test(engine) && (engine.match(/splitIntoChunks\(body, language, target\)/g) || []).length >= 2);

section('4. 再次播放路径');
check('「从头播放」走 handlePlay → playStory（不重新生成文本）', /const handlePlayFromStart/.test(story) && /void handlePlay\(\)/.test(story));
check('playStory 不直接合成，交给 playClonedAudio → ensureSynthFile', /await playClonedAudio\(/.test(playback) && !/synthesizeWithClonedVoice/.test(playback));
check('停止播放不删除缓存文件', (() => {
  const s = lineOf('export function stopClonedAudio');
  const e = lineOf('function hardStopPlayer');
  return !/\.delete\(\)/.test(lines.slice(s - 1, e - 1).join('\n'));
})(), 'stopClonedAudio 里没有 delete()');
check('cacheOnly 分支不再后台补合成整篇', (() => {
  const s = lineOf('if (opts?.cacheOnly)');
  const body = lines.slice(s - 1, s + 30).join('\n');
  // 注释里会提到这个函数名，只查真正的调用语句
  return !/(?:void|await)\s+prewarmClonedAudio\s*\(/.test(body);
})());
check('预热在整篇已缓存时直接返回', /if \(hasAllChunksCached\(text, target, language, opts\?\.maxChunks\)\) return;/.test(engine));

section('5. 可观测性');
check('导出缓存命中/云端调用统计', /export function getSynthCacheStats/.test(engine));
check('playStory 在全分片命中时打日志', /全分片命中本地缓存/.test(playback));

console.log(`\n结论：${failed === 0 ? '全部通过 —— 再次播放不存在第二次云端 TTS 调用路径' : `${failed} 项未通过，需要复核`}`);
process.exit(failed === 0 ? 0 : 1);

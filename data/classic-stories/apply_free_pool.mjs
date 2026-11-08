/**
 * 把 free-pool-v2.json（5 篇出海免费故事的唯一源）同步回 App 实际读取的三份数据：
 *   zh/1-25.json        中文正文
 *   en/1-25.json        英文正文
 *   stories-index.json  列表元数据（标题 / 标签 / 时长）
 *
 * 用法：
 *   node apply_free_pool.mjs                 # 用估算时长
 *   node apply_free_pool.mjs durations.json # 用 MP3 的真实时长（build_free_audio.mjs 产出）
 *
 * 只改这 5 个 id，其它 95 篇经典故事一个字节都不动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const write = (p, v) =>
  fs.writeFileSync(path.join(ROOT, p), JSON.stringify(v, null, 2) + '\n', 'utf8');

const pool = read('free-pool-v2.json');
const durations = process.argv[2]
  ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  : {};

/** 无实测数据时的估算：ffprobe 实测 Cherry 语速 中文 4.404 字/秒、英文 2.804 词/秒 */
function estimateSeconds(entry) {
  const zhSec = entry.content.zh.replace(/\s/g, '').length / 4.404;
  const enSec = entry.content.en.trim().split(/\s+/).filter(Boolean).length / 2.804;
  return Math.round(Math.max(zhSec, enSec));
}

/**
 * durations.json 的新结构是 { id: { zh, en } }（两种语言分别记录真实秒数），
 * 兼容旧版 { id: number }。中文正文用中文时长；索引中英共用一条，取较长一路。
 */
function durationOf(id, lang, entry) {
  const d = durations[id];
  if (typeof d === 'number') return d;
  if (d && typeof d[lang] === 'number') return d[lang];
  return estimateSeconds(entry);
}

const byId = new Map(pool.map((s) => [s.id, s]));

// ① 中文正文
const zh = read('zh/1-25.json');
let zhCount = 0;
for (const s of zh) {
  const e = byId.get(s.id);
  if (!e) continue;
  s.title = e.title.zh;
  s.content = e.content.zh;
  s.tags = e.tags;
  s.duration = durationOf(s.id, 'zh', e);
  s.source = e.source;
  zhCount++;
}

// ② 英文正文
const en = read('en/1-25.json');
let enCount = 0;
for (const s of en) {
  const e = byId.get(s.id);
  if (!e) continue;
  s.title = { zh: e.title.zh, en: e.title.en };
  s.content = e.content.en;
  enCount++;
}

// ③ 元数据索引
const idx = read('stories-index.json');
let idxCount = 0;
for (const s of idx) {
  const e = byId.get(s.id);
  if (!e) continue;
  s.title = { zh: e.title.zh, en: e.title.en };
  s.tags = e.tags;
  s.duration = Math.max(durationOf(s.id, 'zh', e), durationOf(s.id, 'en', e));
  s.source = e.source;
  idxCount++;
}

if (zhCount !== pool.length || enCount !== pool.length || idxCount !== pool.length) {
  throw new Error(
    `同步不完整：zh=${zhCount} en=${enCount} index=${idxCount}，期望 ${pool.length}。已中止，未写文件。`,
  );
}

write('zh/1-25.json', zh);
write('en/1-25.json', en);
write('stories-index.json', idx);

console.log('已同步 5 篇出海免费故事：');
for (const e of pool) {
  const zhChars = e.content.zh.replace(/\s/g, '').length;
  const enWords = e.content.en.trim().split(/\s+/).length;
  const zsec = durationOf(e.id, 'zh', e);
  const esec = durationOf(e.id, 'en', e);
  console.log(
    `  ${e.id}  ${e.title.zh} / ${e.title.en}  中 ${zhChars} 字 / 英 ${enWords} 词  zh ${zsec}s / en ${esec}s`,
  );
}

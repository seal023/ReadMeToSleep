/**
 * gen_en.mjs — 把经典故事库里的「中文源」故事用百炼 qwen-plus 译英。
 *
 * 用途：ReadMeToSleep 双语化。西文经典用 Gutenberg 原版精编（已手工完成首批），
 *       中国民间/神话/原创等「中文源」故事由本脚本批量译英，写入 data/classic-stories/en/*。
 *
 * 运行（需项目根目录 .env 里有 EXPO_PUBLIC_AI_BASE_URL / EXPO_PUBLIC_AI_API_KEY）：
 *   node data/classic-stories/gen_en.mjs            # 译全部尚无英文的故事
 *   ONLY=classic-038,classic-040 node ...           # 只译指定 id
 *   DRY=1 node ...                                  # 不写盘，仅打印将译哪些
 *
 * 行为：
 *   - 只处理「zh 有、en 还没有」的故事（自动去重，绝不覆盖已有英文）。
 *   - 按 1-25/26-50/51-75/76-100 分卷合并写回 en 文件。
 *   - 串行请求，失败跳过并继续，最后汇报成功/失败清单。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EN_DIR = path.join(ROOT, 'data/classic-stories/en');
const ZH_DIR = path.join(ROOT, 'data/classic-stories/zh');

// ---- 读 .env（EXPO_PUBLIC_* 不会自动注入普通 node 进程） ----
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !line.startsWith('#')) {
      const v = m[2].replace(/^["']|["']$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  }
}
loadEnv();

const BASE = process.env.EXPO_PUBLIC_AI_BASE_URL;
const KEY = process.env.EXPO_PUBLIC_AI_API_KEY;
const MODEL = process.env.EXPO_PUBLIC_AI_MODEL || 'qwen-plus';
if (!BASE || !KEY) {
  console.error('缺少 EXPO_PUBLIC_AI_BASE_URL / EXPO_PUBLIC_AI_API_KEY，无法访问百炼。');
  process.exit(1);
}

const ZH_BATCHES = ['1-25', '26-50', '51-75', '76-100'];
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const DRY = process.env.DRY === '1';

async function chat(messages) {
  const resp = await fetch(`${BASE.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.4 }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function stripCodeFence(s) {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : s.trim();
}

async function translate(story) {
  const sys = `You are a children's bedtime-story translator. Translate the given Chinese story into natural, gentle English suitable for a bedtime app for young children. Keep it roughly the same length (about 150-350 words). Use simple, warm language. Also provide a short English title. Respond ONLY with a JSON object: {"title":"<English title>","content":"<English story>"}. No extra text.`;
  const user = `Title (zh): ${story.title}\nContent (zh):\n${story.content}`;
  const out = await chat([
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]);
  const json = JSON.parse(stripCodeFence(out));
  if (!json.content || !json.title) throw new Error('bad json');
  return { title: json.title, content: json.content };
}

// ---- 读 zh + 现有 en ----
const zhAll = [];
const enAll = [];
for (const b of ZH_BATCHES) {
  const zh = JSON.parse(fs.readFileSync(path.join(ZH_DIR, `${b}.json`), 'utf8'));
  zhAll.push(...zh);
}
for (const b of ZH_BATCHES) {
  const p = path.join(EN_DIR, `${b}.json`);
  if (fs.existsSync(p)) enAll.push(...JSON.parse(fs.readFileSync(p, 'utf8')));
}
const enIds = new Set(enAll.map((e) => e.id));

// 待译：zh 有、en 还没有；若 ONLY 指定则过滤
let todo = zhAll.filter((s) => !enIds.has(s.id) && s.content && s.content.trim());
if (ONLY.length) todo = todo.filter((s) => ONLY.includes(s.id));

console.log(`待译故事数: ${todo.length}${DRY ? ' (DRY RUN)' : ''}`);
const byBatch = {};
for (const b of ZH_BATCHES) byBatch[b] = enAll.filter((e) => true); // 保留现有

const ok = [];
const fail = [];
for (const s of todo) {
  const batch = s.id.split('-')[1] ? ZH_BATCHES.find((b) => {
    const [lo, hi] = b.split('-').map(Number);
    const num = parseInt(s.id.split('-')[1], 10);
    return num >= lo && num <= hi;
  }) : null;
  if (!batch) { fail.push([s.id, 'batch not found']); continue; }
  if (DRY) { console.log('  [dry]', s.id, s.title); continue; }
  try {
    const { title, content } = await translate(s);
    byBatch[batch].push({
      id: s.id,
      title: { zh: s.title, en: title },
      content,
      tags: s.tags || [],
      duration: s.duration || 0,
      source: s.source || '',
    });
    ok.push(s.id);
    console.log('  ✓', s.id, '->', title);
  } catch (e) {
    fail.push([s.id, e.message]);
    console.log('  ✗', s.id, e.message);
  }
}

if (!DRY) {
  for (const b of ZH_BATCHES) {
    fs.writeFileSync(path.join(EN_DIR, `${b}.json`), JSON.stringify(byBatch[b], null, 0) + '\n');
  }
}
console.log(`完成：成功 ${ok.length}，失败 ${fail.length}`);
if (fail.length) console.log('失败列表:', fail);

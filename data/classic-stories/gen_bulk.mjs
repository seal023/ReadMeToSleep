/**
 * gen_bulk.mjs — 批量生成公共版权风格的儿童睡前故事，补足到目标数量。
 *
 * 用法（在包含本文件的目录外，或任意位置，需能读到 data/classic-stories）：
 *   EXPO_PUBLIC_AI_API_KEY=你的百炼Key \
 *   EXPO_PUBLIC_AI_BASE_URL=https://ws-xxxx.ap-southeast-1.maas.aliyuncs.com \
 *   node data/classic-stories/gen_bulk.mjs [目标总数=500] [每批篇数=10]
 *
 * 行为：
 *   1. 读取现有 stories-index.json 与 zh/*.json，统计已有标题（去重）
 *   2. 按 6 大分类均衡分配待生成数量
 *   3. 分批调用百炼 qwen-plus（OpenAI 兼容接口）生成故事
 *   4. 解析并校验（字数 200–500 中文、标签合法、字段完整），不合格丢弃
 *   5. 追加写入 zh/101-<末位>.json，并重写 stories-index.json（仅元数据）
 *
 * 注意：
 *   - 仅追加，不修改已有 1–100 数据
 *   - 网络/解析失败的批次会自动重试
 *   - 生成内容均为「公共版权风格」原创，不抄录受版权保护文本
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname); // data/classic-stories
const ZH_DIR = path.join(ROOT, 'zh');
const INDEX_PATH = path.join(ROOT, 'stories-index.json');

const CATEGORIES = ['童话', '成长', '寓言', '动物', '睡前', '自然'];
const SOURCES = [
  '伊索寓言', '格林童话', '安徒生童话', '王尔德童话', '法国经典',
  '英国民间', '一千零一夜', '中国民间故事', '中国古代神话', '睡前原创',
];

const TARGET_TOTAL = parseInt(process.argv[2] || '500', 10);
const BATCH = Math.min(Math.max(parseInt(process.argv[3] || '10', 10), 4), 15);

const API_KEY = process.env.EXPO_PUBLIC_AI_API_KEY;
const BASE_URL =
  process.env.EXPO_PUBLIC_AI_BASE_URL ||
  'https://ws-6f52kltpls7886bp.ap-southeast-1.maas.aliyuncs.com';
const CHAT_URL = `${BASE_URL.replace(/\/$/, '')}/compatible-mode/v1/chat/completions`;
const MODEL = 'qwen-plus';

function loadIndex() {
  return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
}
function loadAllZh() {
  const files = fs
    .readdirSync(ZH_DIR)
    .filter((f) => /^(\d+)-(\d+)\.json$/.test(f))
    .sort();
  const all = [];
  for (const f of files) {
    const arr = JSON.parse(fs.readFileSync(path.join(ZH_DIR, f), 'utf8'));
    all.push(...arr);
  }
  return all;
}

function cjkLen(s) {
  return (s.match(/[\u4e00-\u9fa5]/g) || []).length;
}

function extractJsonArray(text) {
  // 去掉 ```json ``` 围栏
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callModel(prompt) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.95,
          max_tokens: 6000,
          messages: [
            {
              role: 'system',
              content:
                '你是儿童睡前故事作家。只输出符合要求的 JSON 数组，不要任何解释或 Markdown 围栏。',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!resp.ok) {
        console.warn(`  HTTP ${resp.status}，重试(${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content || '';
      const arr = extractJsonArray(text);
      if (!arr) {
        console.warn(`  解析失败，重试(${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return arr;
    } catch (e) {
      console.warn(`  请求异常 ${e.message}，重试(${attempt + 1})`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

function buildPrompt(count, cats) {
  const catLine = cats.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `请生成 ${count} 篇适合 3–8 岁儿童的睡前故事，要求：
- 语言：简体中文，温暖、舒缓、适合睡前。
- 每篇正文中文汉字数严格在 200–500 字之间（含标点不算，只数汉字）。
- 每篇必须包含字段：title(故事名), content(正文), tags(2–3 个标签，只能从下方列表选), duration(朗读秒数, 整数 150–260), source(来源，只能从下方来源列表选)。
- 标签必须从以下 6 类中选 2–3 个：
${catLine}
- 来源必须从以下列表选一个：${SOURCES.join('、')}
- 题材为「公共版权风格」的原创（参考伊索/格林/安徒生等民间与童话传统），不要抄录受版权保护的现代文本。
- 故事要各不相同，不要重复标题或套路。

输出格式（严格 JSON 数组，不要任何多余文字）：
[
  {"title":"...","content":"...","tags":["..."],"duration":200,"source":"..."},
  ...
]`;
}

async function main() {
  if (!API_KEY) {
    console.error('缺少环境变量 EXPO_PUBLIC_AI_API_KEY，无法生成。');
    process.exit(1);
  }
  const index = loadIndex();
  const zhAll = loadAllZh();
  const existingTitles = new Set(zhAll.map((s) => s.title));
  const lastIdNum = index.length; // classic-001.. 已到 100
  let startId = lastIdNum + 1;

  const need = Math.max(0, TARGET_TOTAL - index.length);
  if (need === 0) {
    console.log(`已达目标数量 ${index.length}，无需生成。`);
    return;
  }
  console.log(`现有 ${index.length} 篇，目标 ${TARGET_TOTAL}，需生成 ${need} 篇（每批 ${BATCH}）。`);

  const newStories = [];
  let produced = 0;
  let batchIdx = 0;
  while (produced < need) {
    const remaining = need - produced;
    const thisBatch = Math.min(BATCH, remaining);
    // 本轮分类权重：优先补足占比低的类别
    const catsForBatch = [];
    for (let i = 0; i < thisBatch; i++) {
      catsForBatch.push(CATEGORIES[i % CATEGORIES.length]);
    }
    batchIdx++;
    console.log(`批次 ${batchIdx}：生成 ${thisBatch} 篇…`);
    const arr = await callModel(buildPrompt(thisBatch, catsForBatch));
    if (!arr) {
      console.warn('  本批次 3 次失败，跳过。');
      continue;
    }
    let addedThisBatch = 0;
    for (const item of arr) {
      if (produced + addedThisBatch >= need) break;
      if (!item || typeof item.title !== 'string' || typeof item.content !== 'string') continue;
      if (existingTitles.has(item.title)) continue;
      const tags = Array.isArray(item.tags)
        ? item.tags.filter((t) => CATEGORIES.includes(t)).slice(0, 3)
        : [];
      if (tags.length < 2) tags.push('童话');
      const n = cjkLen(item.content);
      if (n < 200 || n > 500) continue;
      const duration =
        typeof item.duration === 'number' && item.duration >= 120 && item.duration <= 300
          ? Math.round(item.duration)
          : 200;
      const source = SOURCES.includes(item.source) ? item.source : '睡前原创';
      const id = `classic-${String(startId + produced + addedThisBatch).padStart(3, '0')}`;
      newStories.push({
        id,
        title: item.title,
        content: item.content,
        tags,
        duration,
        source,
      });
      existingTitles.add(item.title);
      addedThisBatch++;
    }
    produced += addedThisBatch;
    console.log(`  本批有效 ${addedThisBatch} 篇，累计 ${produced}/${need}。`);
    await new Promise((r) => setTimeout(r, 800));
  }

  if (newStories.length === 0) {
    console.log('未生成任何有效故事，结束。');
    return;
  }

  // 写入新的 zh 文件（按 25 篇一组分文件，沿用现有命名）
  const lastExistingZh = fs
    .readdirSync(ZH_DIR)
    .filter((f) => /^(\d+)-(\d+)\.json$/.test(f))
    .map((f) => {
      const m = f.match(/^(\d+)-(\d+)\.json$/);
      return [parseInt(m[1], 10), parseInt(m[2], 10)];
    })
    .sort((a, b) => b[1] - a[1])[0] || [0, 0];
  let fileStart = lastExistingZh[1] + 1;
  let fileEnd = fileStart - 1;
  for (let i = 0; i < newStories.length; i += 25) {
    const chunk = newStories.slice(i, i + 25);
    fileStart = fileEnd + 1;
    fileEnd = fileStart + chunk.length - 1;
    fs.writeFileSync(
      path.join(ZH_DIR, `${fileStart}-${fileEnd}.json`),
      JSON.stringify(chunk, null, 2) + '\n',
      'utf8'
    );
    console.log(`写出 zh/${fileStart}-${fileEnd}.json（${chunk.length} 篇）`);
  }

  // 重建索引（仅元数据）
  const allZh = loadAllZh().concat(newStories);
  const newIndex = allZh.map(({ id, title, tags, duration, source }) => ({
    id,
    title,
    tags,
    duration,
    source,
  }));
  fs.writeFileSync(INDEX_PATH, JSON.stringify(newIndex, null, 2) + '\n', 'utf8');
  console.log(`索引已更新：总计 ${newIndex.length} 篇。`);
}

main().catch((e) => {
  console.error('生成失败：', e);
  process.exit(1);
});

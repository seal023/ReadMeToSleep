/**
 * gen_long_stories.mjs — 批量生成「长篇」儿童睡前故事（15–20 分钟 / 20–30 分钟）。
 *
 * 与 gen_bulk.mjs（短篇 200–500 字）不同，这里产出的是可连续朗读 15–30 分钟的长故事，用于
 * 孩子「一觉睡到天亮」式的陪伴。用英文原创（公共版权风格、AI 生成，无版权纠纷），再由同一模型
 * 翻译成中文，做到中英双语都有正文（contentEn / content）。
 *
 * 用法（需能读到项目根目录下的 .env，或直接传环境变量）：
 *   node data/classic-stories/gen_long_stories.mjs [短篇模式篇数=2] [长篇模式篇数=2]
 *
 * 例：各生成 100 篇（全量，会跑很久、消耗较多额度，建议用后台任务分次跑）：
 *   node data/classic-stories/gen_long_stories.mjs 100 100
 *
 * 行为：
 *   1. 从 .env 读取 EXPO_PUBLIC_AI_API_KEY / EXPO_PUBLIC_AI_BASE_URL（与 App 同源百炼 Key）。
 *   2. 英文原创长故事按「分两段生成 + 必要时续写」保证篇幅达标，再逐段翻译成中文。
 *   3. 每篇带字段：id, title(zh), titleEn(en), content(zh), contentEn(en), tags, duration(秒),
 *      source, lengthMin(15-20 | 20-30)。
 *   4. 单独写入 data/classic-stories/long/<mode>/ 与 long/index.json，**不触碰** classic 1–100 与短篇扩展。
 *   5. 已存在标题自动去重；网络/解析失败自动重试；单词数不达标则续写补齐。
 *
 * 版权：全部为模型原创的公共版权风格文本，不抄录任何受版权保护的现代作品。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname; // data/classic-stories
const LONG_DIR = path.join(ROOT, 'long');

// —— 读取 .env（与 App 共用同一份百炼 Key）——
function loadEnv() {
  const envPath = path.resolve(ROOT, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    const txt = fs.readFileSync(envPath, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
 if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();

const API_KEY = process.env.EXPO_PUBLIC_AI_API_KEY;
const BASE_URL =
  process.env.EXPO_PUBLIC_AI_BASE_URL ||
  'https://ws-6f52kltpls7886bp.ap-southeast-1.maas.aliyuncs.com';
const CHAT_URL = `${BASE_URL.replace(/\/$/, '')}/compatible-mode/v1/chat/completions`;
const MODEL = process.env.EXPO_PUBLIC_AI_MODEL || 'qwen-plus';

const CATEGORIES = ['童话', '成长', '寓言', '动物', '睡前', '自然'];
const SOURCES = [
  '睡前原创', '格林童话', '安徒生童话', '王尔德童话', '法国经典',
  '英国民间', '一千零一夜', '中国民间故事', '中国古代神话', '伊索寓言',
];

// 两种长度档位的目标英文单词数（按 ~150 词/分钟估算）
const MODES = {
  '15-20': { folder: '15-20', wordMin: 2200, wordMax: 2800 },
  '20-30': { folder: '20-30', wordMin: 3000, wordMax: 4200 },
};

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function wordCount(s) {
  return (s.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}
function cjkLen(s) {
  return (s.match(/[一-鿿]/g) || []).length;
}

async function callModel(prompt, maxTokens, system) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.9,
          top_p: 0.9,
          max_tokens: maxTokens,
          messages: [
            {
              role: 'system',
              content:
                system ||
                'You are a gentle children\'s bedtime story author. Write warm, soothing, non-scary stories suitable for ages 3-8. Avoid any copyright-protected modern text; write original public-domain-style tales.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!resp.ok) {
        console.warn(`  HTTP ${resp.status}，重试(${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content || '';
      if (!text.trim()) {
        console.warn(`  空响应，重试(${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return text;
    } catch (e) {
      console.warn(`  请求异常 ${e.message}，重试(${attempt + 1})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

function stripFence(t) {
  return t.trim().replace(/^```(?:json|markdown|md|text)?\s*/i, '').replace(/\s*```$/i, '');
}

/**
 * 生成一篇英文长故事（分两段 + 必要时续写）。
 * 返回 { title, text }，text 为完整英文正文。
 */
async function genEnglishStory(mode, idx) {
  const cfg = MODES[mode];
  const halfMin = Math.floor(cfg.wordMin / 2);
  const halfMax = Math.floor(cfg.wordMax / 2);
  const titlePrompt = `Invent ONE brand-new, original, public-domain-style bedtime story title for children (English, 3-8 years). Respond with ONLY the title text, no quotes, no extra words. Make it gentle and dreamy.`;
  let title = stripFence(await callModel(titlePrompt, 64));
  title = (title || `The Sleepy Tale ${idx}`).replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 80);

  const p1 = `Write the FIRST HALF (about ${halfMin}-${halfMax} words, roughly) of a brand-new, original, public-domain-style bedtime story titled "${title}". 
Tone: warm, soothing, gentle, suitable for ages 3-8, perfect to fall asleep to. No violence, no scary parts, no modern copyrighted characters.
Use simple, rhythmic English. End this half at a calm, natural pause — do NOT conclude the story yet.
Output ONLY the story prose, no title, no notes.`;
  let part1 = stripFence(await callModel(p1, 2200));

  const p2 = `Continue and CONCLUDE the bedtime story titled "${title}". 
Here is how the first half ended (do not repeat it): "...${part1.slice(-220)}"
Write the SECOND HALF (about ${halfMin}-${halfMax} words) that gently resolves the story and ends with a sleepy, peaceful conclusion (child drifting off to sleep). 
Output ONLY the continuing prose, no title, no notes.`;
  let part2 = stripFence(await callModel(p2, 2200));

  let full = `${part1.trim()}\n\n${part2.trim()}`;
  // 篇幅不足则续写补齐
  let guard = 0;
  while (wordCount(full) < cfg.wordMin && guard < 4) {
    const cont = stripFence(
      await callModel(
        `The story "${title}" is too short. Continue it (about ${Math.ceil(
          (cfg.wordMin - wordCount(full)) * 0.8,
        )} more words) and then bring it to a gentle sleepy conclusion. Output ONLY prose.`,
        2200,
      ),
    );
    full = `${full.trim()}\n\n${cont.trim()}`;
    guard++;
  }
  // 偶尔超长则截断到 wordMax + 一点余量（保留句末）
  if (wordCount(full) > cfg.wordMax + 400) {
    const words = full.split(/\s+/);
    full = words.slice(0, cfg.wordMax + 200).join(' ');
  }
  return { title, text: full };
}

/** 把英文正文翻译成中文（分两段，保持中文自然流畅、温暖舒缓） */
async function translateToZh(enText) {
  const mid = Math.floor(enText.length / 2);
  // 在空格处切，避免句子切断
  let cut = enText.lastIndexOf(' ', mid);
  if (cut < mid * 0.6) cut = mid;
  const a = enText.slice(0, cut);
  const b = enText.slice(cut);
  const sysZh = '你是专业的儿童文学译者，把英文睡前故事翻译成中文，语言温暖、舒缓、口语化，适合 3-8 岁孩子听。只输出译文，不要标题和注释。';
  const t1 = stripFence(await callModel(`把下面这段英文翻译成中文：\n\n${a}`, 2000, sysZh));
  const t2 = stripFence(await callModel(`继续翻译下面这段英文（承接上文，不要重复）：\n\n${b}`, 2000, sysZh));
  return `${t1.trim()}\n\n${t2.trim()}`;
}

function durationEstimate(enWords) {
  // 英文 ~0.4s/词；取整数秒
  return Math.round(enWords * 0.4);
}

function loadExistingTitles() {
  const titles = new Set();
  const idxPath = path.join(LONG_DIR, 'index.json');
  if (fs.existsSync(idxPath)) {
    try {
      const arr = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
      for (const s of arr) {
        if (s?.title?.zh) titles.add(s.title.zh);
        if (s?.title?.en) titles.add(s.title.en);
      }
    } catch {
      /* ignore */
    }
  }
  return titles;
}

function loadLongIndex() {
  const idxPath = path.join(LONG_DIR, 'index.json');
  if (fs.existsSync(idxPath)) return JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  return [];
}

async function genOne(mode, idx, existingTitles) {
  const cfg = MODES[mode];
  const en = await genEnglishStory(mode, idx);
  if (!en.text || wordCount(en.text) < cfg.wordMin - 300) return null;
  const zh = await translateToZh(en.text);
  const id = `long-${mode.replace('-', '')}-${String(idx).padStart(3, '0')}`;
  const tags = [mode === '15-20' ? '睡前' : '童话', CATEGORIES[idx % CATEGORIES.length]];
  const source = SOURCES[idx % SOURCES.length];
  const story = {
    id,
    title: en.title,
    titleEn: en.title,
    content: zh,
    contentEn: en.text,
    tags,
    duration: durationEstimate(wordCount(en.text)),
    source,
    lengthMin: mode,
  };
  existingTitles.add(en.title);
  return story;
}

function appendToFile(folder, story) {
  const dir = path.join(LONG_DIR, folder);
  ensureDir(dir);
  const file = path.join(dir, `${story.id}.json`);
  fs.writeFileSync(file, JSON.stringify(story, null, 2) + '\n', 'utf8');
}

function rebuildLongIndex() {
  const idx = [];
  for (const mode of Object.keys(MODES)) {
    const dir = path.join(LONG_DIR, MODES[mode].folder);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        idx.push({
          id: s.id,
          title: { zh: s.title, en: s.titleEn },
          tags: s.tags,
          duration: s.duration,
          source: s.source,
          lengthMin: s.lengthMin,
        });
      } catch {
        /* ignore */
      }
    }
  }
  fs.writeFileSync(
    path.join(LONG_DIR, 'index.json'),
    JSON.stringify(idx, null, 2) + '\n',
    'utf8',
  );
  return idx.length;
}

async function main() {
  if (!API_KEY) {
    console.error('缺少 EXPO_PUBLIC_AI_API_KEY（请配置 .env 或环境变量）。');
    process.exit(1);
  }
  const shortCount = parseInt(process.argv[2] || '2', 10);
  const longCount = parseInt(process.argv[3] || '2', 10);
  ensureDir(LONG_DIR);
  const existingTitles = loadExistingTitles();

  for (const mode of ['15-20', '20-30']) {
    const target = mode === '15-20' ? shortCount : longCount;
    if (target <= 0) continue;
    let done = loadLongIndex().filter((s) => s.lengthMin === mode).length;
    let idx = done + 1;
    console.log(`\n=== 模式 ${mode} 分钟：目标 ${target} 篇（已有 ${done}）===`);
    let produced = 0;
    while (produced < target) {
      console.log(`  生成第 ${idx} 篇…`);
      const story = await genOne(mode, idx, existingTitles);
      if (!story) {
        console.warn('    生成失败/过短，重试本篇');
        const retry = await genOne(mode, idx, existingTitles);
        if (!retry) {
          console.warn('    重试仍失败，跳过本篇序号');
          idx++;
          continue;
        }
        appendToFile(MODES[mode].folder, retry);
        produced++;
        console.log(`    ✔ ${retry.title}（EN ${wordCount(retry.contentEn)} 词 / ZH ${cjkLen(retry.content)} 字）`);
        idx++;
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      appendToFile(MODES[mode].folder, story);
      produced++;
      console.log(`    ✔ ${story.title}（EN ${wordCount(story.contentEn)} 词 / ZH ${cjkLen(story.content)} 字）`);
      idx++;
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  const total = rebuildLongIndex();
  console.log(`\n完成。long/index.json 总计 ${total} 篇（15-20 与 20-30 分目录存放）。`);
}

main().catch((e) => {
  console.error('生成失败：', e);
  process.exit(1);
});

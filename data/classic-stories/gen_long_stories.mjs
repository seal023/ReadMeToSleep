/**
 * gen_long_stories.mjs — 批量生成「长篇」儿童睡前故事（5–10 分钟 / 15–20 分钟）。
 *
 * 与 gen_bulk.mjs（短篇 200–500 字）不同，这里产出的是可连续朗读 15–30 分钟的长故事，用于
 * 孩子「一觉睡到天亮」式的陪伴。用英文原创（公共版权风格、AI 生成，无版权纠纷），再由同一模型
 * 翻译成中文，做到中英双语都有正文（contentEn / content）。
 *
 * 用法（需能读到项目根目录下的 .env，或直接传环境变量）：
 *   node data/classic-stories/gen_long_stories.mjs [5-10分钟篇数=0] [15-20分钟篇数=0]
 *
 * 例：5-10 分钟 50 篇 + 15-20 分钟 10 篇：
 *   node data/classic-stories/gen_long_stories.mjs 50 10
 *
 * 行为：
 *   1. 从 .env 读取 EXPO_PUBLIC_AI_API_KEY / EXPO_PUBLIC_AI_BASE_URL（与 App 同源百炼 Key）。
 *   2. 英文原创长故事按「分两段生成 + 必要时续写」保证篇幅达标，再逐段翻译成中文。
 *   3. 每篇带字段：id, title(zh), titleEn(en), content(zh), contentEn(en), tags, duration(秒),
 *      source, lengthMin(5-10 | 15-20)。
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
// 无论 .env 的 BASE_URL 是否自带 /compatible-mode/v1 后缀，统一只用 host 根拼固定路径，避免双重拼接导致 404
const API_ORIGIN = (() => {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return BASE_URL.replace(/\/compatible-mode.*$/, '').replace(/\/$/, '');
  }
})();
const CHAT_URL = `${API_ORIGIN}/compatible-mode/v1/chat/completions`;
const MODEL = process.env.EXPO_PUBLIC_AI_MODEL || 'qwen-plus';

const CATEGORIES = ['童话', '成长', '寓言', '动物', '睡前', '自然'];
const SOURCES = [
  '睡前原创', '格林童话', '安徒生童话', '王尔德童话', '法国经典',
  '英国民间', '一千零一夜', '中国民间故事', '中国古代神话', '伊索寓言',
];

// 长度档位的目标英文单词数（按 ~150 词/分钟估算；5–10 分钟≈750–1500 词）。
// half = 每段目标词数区间；maxTok = 该档每段生成硬上限（token），避免单段写超。
// 注：20–30 分钟档已按需求移除。
// 标题主题池：每篇强制绑定一个不同主题，从根本上杜绝「Moonlit/Lullaby」套路刷屏
const THEMES = [
  'a cozy forest', 'the deep blue ocean', 'a snowy mountain', 'a warm little bakery',
  'a library at midnight', 'a meadow of wildflowers', 'a friendly little train', 'a lighthouse by the sea',
  'an attic full of old toys', 'a garden after the rain', 'a castle in the clouds', 'a quiet riverbank',
  'a fireplace on a cold night', 'a star observatory', 'a busy honeybee hive', 'a gentle waterfall',
  'a wooden sailboat', 'a pumpkin patch in autumn', 'a music box that plays itself', 'a paper lantern festival',
  'a burrow under the tree roots', 'a hot-air balloon', 'a kite festival', 'a hidden waterfall cave',
];
let themeCursor = 0;
function nextTheme() {
  const t = THEMES[themeCursor % THEMES.length];
  themeCursor++;
  return t;
}

const MODES = {
  '5-10': { folder: '5-10', wordMin: 750, wordMax: 1500, half: [375, 750], maxTok: 1100 },
  '15-20': { folder: '15-20', wordMin: 2200, wordMax: 2800, half: [1000, 1300], maxTok: 1600 },
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

const SYS_ZH =
  '你是专业的儿童文学译者，把英文睡前故事翻译成中文，语言温暖、舒缓、口语化，适合 3-8 岁孩子听。只输出译文，不要标题和注释。';

async function callModel(prompt, maxTokens, system, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        signal: controller.signal,
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
      const why = e.name === 'AbortError' ? '超时' : e.message;
      console.warn(`  请求异常 ${why}，重试(${attempt + 1})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  clearTimeout(timer);
  return null;
}

function stripFence(t) {
  return t.trim().replace(/^```(?:json|markdown|md|text)?\s*/i, '').replace(/\s*```$/i, '');
}

/**
 * 生成一篇英文长故事（分两段 + 必要时续写）。
 * 返回 { title, text }，text 为完整英文正文。
 */
async function genEnglishStory(mode, idx, existingTitles = new Set(), theme = 'a cozy bedtime') {
  const cfg = MODES[mode];
  const [halfMin, halfMax] = cfg.half;
  let enTitle = `The Sleepy Tale ${idx}`;
  let zhTitle = `睡梦故事 ${idx}`;

  // 标题去重 + 主题多样性：每篇强制绑定一个不同主题（theme），重试时一并避开已撞车的候选
  const enOnly = [...existingTitles].filter((t) => /^[\x00-\x7F]+$/.test(t));
  const tried = new Set();
  let titleOk = false;
  for (let attempt = 0; attempt < 8 && !titleOk; attempt++) {
    const avoidList = [...enOnly, ...tried];
    const avoidNote = avoidList.length
      ? `\nDo NOT reuse any of these ALREADY-USED titles (invent something clearly different):\n- ${avoidList.slice(0, 50).join('\n- ')}`
      : '';
    const titlePrompt = `Invent ONE brand-new, original bedtime story title for children (English, 3-8 years), gentle and soothing.
REQUIRED: the title MUST clearly feature this specific setting/subject — ${theme}.
STRICT RULES:
- Avoid overused words unless the theme truly needs them: moon, moonlit, moonlight, lullaby, velvet, sleepy, dream, star, sleep.
- Make the title distinct in imagery from all the already-used titles listed below.${avoidNote}
Respond with ONLY a JSON object (no markdown, no extra text): {"en":"English title","zh":"中文标题"}`;
    const rawTitle = stripFence(await callModel(titlePrompt, 160));
    if (!rawTitle) continue; // API 偶发失败，下一轮重试
    // 鲁棒提取：正则抓 "en"/"zh"，容忍模型偶发加前后缀或 markdown 导致 JSON.parse 失败
    const mEn = rawTitle.match(/"en"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
    const mZh = rawTitle.match(/"zh"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
    const cand = mEn ? mEn[1].trim() : '';
    const zhCand = mZh ? mZh[1].trim() : '';
    if (cand && !existingTitles.has(cand) && !tried.has(cand)) {
      enTitle = cand.slice(0, 80);
      if (zhCand) zhTitle = zhCand.slice(0, 60);
      titleOk = true;
    } else if (cand) {
      tried.add(cand); // 本次撞车，下一轮避开这个候选
    }
  }

  const p1 = `Write the FIRST HALF (about ${halfMin}-${halfMax} words) of a brand-new, original, public-domain-style bedtime story titled "${enTitle}". 
Tone: warm, soothing, gentle, suitable for ages 3-8, perfect to fall asleep to. No violence, no scary parts, no modern copyrighted characters.
Use simple, rhythmic English. End this half at a calm, natural pause — do NOT conclude the story yet. Do not exceed ${Math.round(halfMax * 1.15)} words.
Output ONLY the story prose, no title, no notes.`;
  let part1 = stripFence(await callModel(p1, cfg.maxTok));

  const p2 = `Continue and CONCLUDE the bedtime story titled "${enTitle}". 
Here is how the first half ended (do not repeat it): "...${part1.slice(-220)}"
Write the SECOND HALF (about ${halfMin}-${halfMax} words) that gently resolves the story and ends with a sleepy, peaceful conclusion (child drifting off to sleep). Do not exceed ${Math.round(halfMax * 1.15)} words.
Output ONLY the continuing prose, no title, no notes.`;
  let part2 = stripFence(await callModel(p2, cfg.maxTok));

  let full = `${part1.trim()}\n\n${part2.trim()}`;
  // 篇幅不足则续写补齐
  let guard = 0;
  while (wordCount(full) < cfg.wordMin && guard < 4) {
    const cont = stripFence(
      await callModel(
        `The story "${enTitle}" is too short. Continue it (about ${Math.ceil(
          (cfg.wordMin - wordCount(full)) * 0.8,
        )} more words) and then bring it to a gentle sleepy conclusion. Output ONLY prose.`,
        cfg.maxTok,
      ),
    );
    full = `${full.trim()}\n\n${cont.trim()}`;
    guard++;
  }
  // 偶尔超长则截断到 wordMax + 一点余量（保留句末）
  if (wordCount(full) > cfg.wordMax + 500) {
    const words = full.split(/\s+/);
    full = words.slice(0, cfg.wordMax + 200).join(' ');
  }
  return { enTitle, zhTitle, text: full };
}

/** 按词数把英文切成若干小段（在空格边界切，避免句子切断） */
function splitByWords(text, per) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += per) {
    out.push(words.slice(i, i + per).join(' '));
  }
  return out;
}

/**
 * 把英文正文翻译成中文：整篇一次性翻译。
 * 观察：百炼 qwen-plus 对该 workspace 实际不严格限制 max_tokens（英文生成时
 * max_tokens=2200 却能产出 3000+ 词），故整篇放宽到 8000 让模型一次翻完，
 * 避免分段翻译被稳定截断到 ~700 字/段导致中文残缺。
 */
async function translateToZh(enText) {
  const t = stripFence(
    await callModel(
      `把下面完整的英文睡前故事翻译成温暖、舒缓、口语化的中文，适合 3-8 岁孩子听。务必完整翻译全部内容，不要省略任何句子，也不要提前结束。只输出译文，不要标题和注释：\n\n${enText}`,
      8000,
      SYS_ZH,
    ),
  );
  return t.trim();
}

function durationEstimate(enWords) {
  // 英文 ~0.4s/词；取整数秒
  return Math.round(enWords * 0.4);
}

function loadExistingTitles() {
  const titles = new Set();
  // 1) 从 index.json 读取（若存在）
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
  // 2) 直接扫描各档 JSON 文件（防止 index 未重建时漏判已落盘故事）
  for (const mode of Object.keys(MODES)) {
    const dir = path.join(LONG_DIR, MODES[mode].folder);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (s?.title?.zh) titles.add(s.title.zh);
        else if (s?.title?.en) titles.add(s.title.en);
        else if (typeof s?.title === 'string') titles.add(s.title);
      } catch {
        /* ignore */
      }
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
  const theme = nextTheme();
  const en = await genEnglishStory(mode, idx, existingTitles, theme);
  if (!en.text || wordCount(en.text) < cfg.wordMin - 300) return null;
  const zh = await translateToZh(en.text);
  const id = `long-${mode.replace('-', '')}-${String(idx).padStart(3, '0')}`;
  const tags = [mode === '20-30' ? '童话' : '睡前', CATEGORIES[idx % CATEGORIES.length]];
  const source = SOURCES[idx % SOURCES.length];
  const story = {
    id,
    title: { zh: en.zhTitle, en: en.enTitle },
    content: zh,
    contentEn: en.text,
    tags,
    duration: durationEstimate(wordCount(en.text)),
    source,
    lengthMin: mode,
  };
  existingTitles.add(en.enTitle);
  existingTitles.add(en.zhTitle);
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
          title: { zh: s.title?.zh ?? s.title, en: s.title?.en ?? s.title },
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
  // 参数：argv[2]=5-10 分钟篇数，argv[3]=15-20 分钟篇数（20-30 已移除）
  const counts = {
    '5-10': parseInt(process.argv[2] || '0', 10),
    '15-20': parseInt(process.argv[3] || '0', 10),
  };
  ensureDir(LONG_DIR);
  const existingTitles = loadExistingTitles();

  for (const mode of Object.keys(MODES)) {
    const target = counts[mode] ?? 0;
    if (target <= 0) continue;
    const bucketDir = path.join(LONG_DIR, MODES[mode].folder);
    let done = fs.existsSync(bucketDir)
      ? fs.readdirSync(bucketDir).filter((f) => f.endsWith('.json')).length
      : 0;
    // target 视为「该模式总目标篇数」：已有则补齐，不叠加（支持中断后续跑）
    const toGenerate = Math.max(0, target - done);
    if (toGenerate === 0) {
      console.log(`\n=== 模式 ${mode} 分钟：已达成目标 ${target} 篇，跳过 ===`);
      continue;
    }
    let idx = done + 1;
    console.log(`\n=== 模式 ${mode} 分钟：目标 ${target} 篇（已有 ${done}，本次补 ${toGenerate}）===`);
    let produced = 0;
    while (produced < toGenerate) {
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
        console.log(`    ✔ ${retry.title.en}（EN ${wordCount(retry.contentEn)} 词 / ZH ${cjkLen(retry.content)} 字）`);
        idx++;
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      appendToFile(MODES[mode].folder, story);
      produced++;
      console.log(`    ✔ ${story.title.en}（EN ${wordCount(story.contentEn)} 词 / ZH ${cjkLen(story.content)} 字）`);
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

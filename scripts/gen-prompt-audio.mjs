/**
 * 预生成「内置提示音」mp3，打包进 App（v93）
 * ---------------------------------------------------------------------------
 * 需求（2026-11-04）：「先生成 mp3，直接安装进去」——不要在用户首次启动后
 * 联网逐条合成，而是开发期就把 4 个内置音色 × 中英双语的全部提示音生成好，
 * 作为静态资源随 App 一起发布。装完即有声、零网络、零 token、离线可用。
 *
 * 用法：
 *   node scripts/gen-prompt-audio.mjs                 # 生成全部 4 音色
 *   node scripts/gen-prompt-audio.mjs --voice=cherry  # 只生成某个音色
 *   node scripts/gen-prompt-audio.mjs --probe         # 只合成 1 条做验证
 *   node scripts/gen-prompt-audio.mjs --force         # 忽略已存在，强制重生成
 *
 * 产出：
 *   assets/prompts/<voice>/<lang>/<hash>.mp3     音频
 *   assets/prompts/manifest.json                 清单（文本 ↔ 文件，供运行时落盘）
 *   assets/prompts/index.ts                      require 映射（Metro 静态打包必需）
 *
 * ⚠️ 文本清单必须与运行时播报「逐字一致」，否则缓存 key（文本 hash）对不上，
 *    内置音频永远不会被命中。故这里与 services/phraseBank.ts 共用同一份数据源。
 *
 * ⚠️ 含 {name} 的问候 / 告别不在清单内：昵称由用户输入，无法预生成，
 *    这几条仍由运行时合成（首次设置昵称后会立即预热）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'prompts');

const args = process.argv.slice(2);
const argOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const ONLY_VOICE = argOf('voice');
const PROBE = args.includes('--probe');
const FORCE = args.includes('--force');
const CONCURRENCY = Number(argOf('concurrency') || 3);

/* -------------------------------------------------------------------------- */
/*  环境变量                                                                   */
/* -------------------------------------------------------------------------- */

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    // .env 里可能存在字面量 \n（多行 PEM 之类），这里用不到，原样即可
    process.env[m[1]] = v;
  }
}
loadEnv();

const API_KEY = process.env.EXPO_PUBLIC_AI_API_KEY;
const WORKSPACE = (process.env.EXPO_PUBLIC_VOICE_WORKSPACE_ID || '').replace(/\s/g, '');
const BASE_URL = (process.env.EXPO_PUBLIC_AI_BASE_URL || '').replace(/\s/g, '');
const TTS_MODEL = process.env.EXPO_PUBLIC_TTS_MODEL || 'qwen3-tts-flash';

/** 与 services/endpoints.ts 的 endpointOrigin 等价（只取协议 + 主机） */
function resolveOrigin() {
  const clean = (s) => (s || '').replace(/[\s\u3000]/g, '').replace(/^["'`]+|["'`]+$/g, '');
  const wsEnv = clean(WORKSPACE).toLowerCase();
  let host = '';
  const src = clean(BASE_URL);
  if (src) {
    let s = src;
    if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
    if (/^http:\/\//i.test(s)) s = 'https://' + s.slice('http://'.length);
    const m = s.match(/^https:\/\/[^/?#]+/i);
    if (m) host = m[0].slice('https://'.length);
  }
  if (host) {
    const wsInHost = (host.match(/^(ws-[a-z0-9]+)\./i) || [])[1];
    if (wsEnv && wsInHost && wsInHost.toLowerCase() !== wsEnv) {
      const region = (host.match(/^ws-[a-z0-9]+\.([a-z0-9-]+)\.maas\.aliyuncs\.com$/i) || [])[1];
      return `https://${wsEnv}.${region || 'ap-southeast-1'}.maas.aliyuncs.com`;
    }
    return `https://${host}`;
  }
  if (wsEnv) return `https://${wsEnv}.ap-southeast-1.maas.aliyuncs.com`;
  return '';
}

const ORIGIN = resolveOrigin();
const MULTIMODAL_URL = ORIGIN
  ? `${ORIGIN}/api/v1/services/aigc/multimodal-generation/generation`
  : '';
const SYNTH_URL = ORIGIN ? `${ORIGIN}/api/v1/services/audio/tts/SpeechSynthesizer` : '';

/* -------------------------------------------------------------------------- */
/*  音色映射（与 services/voiceClone.ts 的 PRESET_VOICES 一致）                 */
/* -------------------------------------------------------------------------- */

const VOICES = [
  { key: 'cherry', target: 'preset:cherry', voice: 'Cherry' },
  { key: 'serena', target: 'preset:serena', voice: 'Serena' },
  { key: 'ethan', target: 'preset:ethan', voice: 'Ethan' },
  { key: 'nini', target: 'preset:nini', voice: 'Nini' },
];

/* -------------------------------------------------------------------------- */
/*  文本清单（与运行时逐字一致）                                                */
/* -------------------------------------------------------------------------- */

async function buildTextList() {
  const mod = await import(pathToFileURL(path.join(ROOT, 'services', 'phraseBank.ts')).href);
  const { PHRASE_BANK, VOICE_PREVIEW_SAMPLE } = mod;
  const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'zh.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', 'en.json'), 'utf8'));

  const items = [];
  const seen = new Set();
  const push = (text, lang) => {
    const t = (text || '').trim();
    if (!t || t.includes('{name}')) return;
    const k = `${lang}|${t}`;
    if (seen.has(k)) return;
    seen.add(k);
    items.push({ text: t, lang });
  };

  for (const cat of Object.keys(PHRASE_BANK)) {
    PHRASE_BANK[cat].zh.forEach((t) => push(t, 'zh'));
    PHRASE_BANK[cat].en.forEach((t) => push(t, 'en'));
  }
  push(VOICE_PREVIEW_SAMPLE.zh, 'zh');
  push(VOICE_PREVIEW_SAMPLE.en, 'en');
  push(zh['story.qa.unknown'], 'zh');
  push(en['story.qa.unknown'], 'en');

  // 问候 / 告别的「未设昵称」版本（applyName 去掉占位符后的形态）。
  // 含具体昵称的句子无法预生成（昵称由用户输入），但这 10 条能让「还没设昵称」
  // 或「清空了昵称」的宝宝同样秒出问候，不必等一次网络合成。
  const NAME_KEYS = [
    'home.greetingMorning',
    'home.greetingNoon',
    'home.greetingAfternoon',
    'home.greetingEvening',
    'home.farewell',
  ];
  const applyName = (base, name) => {
    if (!base) return '';
    if (name) return base.replace('{name}', name);
    return base.replace('，{name}！', '！').replace(', {name}!', '!');
  };
  for (const k of NAME_KEYS) {
    push(applyName(zh[k], ''), 'zh');
    push(applyName(en[k], ''), 'en');
  }
  return items;
}

/** 与 clonedVoicePlayback.hashText 完全一致（命名对齐用，便于人工核对） */
function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

/* -------------------------------------------------------------------------- */
/*  合成                                                                       */
/* -------------------------------------------------------------------------- */

function headers() {
  const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` };
  if (WORKSPACE) h['X-Workspace-Id'] = WORKSPACE;
  return h;
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} 超时 ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 一次合成 → 返回音频字节 */
async function synthesize(text, voiceName) {
  const body = {
    model: TTS_MODEL,
    input: { text, voice: voiceName, format: 'mp3', sample_rate: 24000 },
  };
  const res = await withTimeout(
    fetch(MULTIMODAL_URL, { method: 'POST', headers: headers(), body: JSON.stringify(body) }),
    30000,
    '合成请求',
  );
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${t.slice(0, 160)}`);
  }
  const data = await res.json().catch(() => null);
  let url = data?.output?.audio?.url;
  if (!url && typeof data?.output?.audio === 'string') url = data.output.audio;
  if (!url) throw new Error(`响应缺少音频地址 ${JSON.stringify(data).slice(0, 180)}`);
  if (url.startsWith('data:')) {
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  }
  if (url.startsWith('http://')) url = 'https://' + url.slice(7);
  const audioRes = await withTimeout(fetch(url), 30000, '下载音频');
  if (!audioRes.ok) throw new Error(`下载失败 HTTP ${audioRes.status}`);
  return Buffer.from(await audioRes.arrayBuffer());
}

/* -------------------------------------------------------------------------- */
/*  转码：百炼 qwen3-tts 返回的是未压缩 WAV（约 48KB/秒），直接内置会有几十 MB，   */
/*  故统一转 32kbps 单声道 mp3（约 4KB/秒），音质对提示音完全够用。              */
/* -------------------------------------------------------------------------- */

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function isMp3(buf) {
  if (buf.length < 4) return false;
  // ID3 标签 或 MPEG frame sync
  return (
    buf.subarray(0, 3).toString('latin1') === 'ID3' ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  );
}

async function transcodeToMp3(inputBuf, outFile) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rms-tts-'));
  const tmpWav = path.join(tmpDir, 'in.wav');
  fs.writeFileSync(tmpWav, inputBuf);
  try {
    await new Promise((resolve, reject) => {
      execFile(
        FFMPEG,
        [
          '-hide_banner',
          '-loglevel', 'error',
          '-y',
          '-i', tmpWav,
          '-codec:a', 'libmp3lame',
          '-b:a', '32k',
          '-ac', '1',
          '-ar', '24000',
          outFile,
        ],
        { timeout: 60000 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(`ffmpeg 转码失败：${String(stderr || err.message).slice(0, 200)}`));
          else resolve();
        },
      );
    });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  主流程                                                                     */
/* -------------------------------------------------------------------------- */

async function main() {
  if (!API_KEY) throw new Error('.env 缺少 EXPO_PUBLIC_AI_API_KEY');
  if (!ORIGIN) throw new Error('无法解析百炼端点（检查 EXPO_PUBLIC_AI_BASE_URL / WORKSPACE_ID）');
  if (!process.env.EXPO_PUBLIC_TTS_MODEL) {
    console.log(`· 未配置 EXPO_PUBLIC_TTS_MODEL，使用默认 ${TTS_MODEL}`);
  }

  const texts = await buildTextList();
  console.log(`· 端点 ${ORIGIN}`);
  console.log(`· 文本 ${texts.length} 条 × ${VOICES.length} 音色 = ${texts.length * VOICES.length} 条音频`);

  // 转码依赖 ffmpeg（百炼返回的是未压缩 WAV）
  await new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-version'], { timeout: 15000 }, (err) =>
      err ? reject(new Error('找不到 ffmpeg。请安装 ffmpeg 或设置 FFMPEG_PATH 环境变量（转 mp3 必需）')) : resolve(),
    );
  });

  const voices = ONLY_VOICE ? VOICES.filter((v) => v.key === ONLY_VOICE) : VOICES;
  if (!voices.length) throw new Error(`未知音色 ${ONLY_VOICE}`);

  if (PROBE) {
    const [v] = voices;
    const t = texts[0];
    console.log(`· 试合成 [${v.key}] ${t.text}`);
    const buf = await synthesize(t.text, v.voice);
    const magic = buf.subarray(0, 4).toString('latin1');
    console.log(`  原始 ${(buf.length / 1024).toFixed(1)} KB，头部 "${magic}"`);
    const tmp = path.join(os.tmpdir(), `rms-probe-${Date.now()}.mp3`);
    if (isMp3(buf)) {
      fs.writeFileSync(tmp, buf);
    } else {
      await transcodeToMp3(buf, tmp);
    }
    const size = fs.statSync(tmp).size;
    console.log(`  ✓ mp3 ${(size / 1024).toFixed(1)} KB（压缩率 ${((size / buf.length) * 100).toFixed(0)}%）`);
    fs.rmSync(tmp, { force: true });
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const prev = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { version: 1, entries: [] };
  // 保留其它音色已有记录（只重生成指定音色时）
  const keepEntries = prev.entries.filter(
    (e) => !voices.some((v) => v.target === e.target),
  );

  let done = 0;
  let skipped = 0;
  const failed = [];
  const entries = [];

  for (const v of voices) {
    const tasks = texts.map((t) => ({ ...t, rel: `${v.key}/${t.lang}/${hashText(t.text)}` }));
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const it = tasks[cursor++];
        const file = path.join(OUT_DIR, `${it.rel}.mp3`);
        if (!FORCE && fs.existsSync(file) && fs.statSync(file).size > 2000) {
          skipped++;
          entries.push({ target: v.target, lang: it.lang, text: it.text, file: `${it.rel}.mp3` });
          continue;
        }
        // 最多重试 2 次（网络抖动）
        let ok = false;
        for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
          try {
            const buf = await synthesize(it.text, v.voice);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            if (isMp3(buf)) fs.writeFileSync(file, buf);
            else await transcodeToMp3(buf, file);
            entries.push({ target: v.target, lang: it.lang, text: it.text, file: `${it.rel}.mp3` });
            done++;
            ok = true;
            process.stdout.write(
              `\r  [${v.key}] ${done} 新生成 / ${skipped} 已存在 / ${failed.length} 失败   `,
            );
          } catch (e) {
            if (attempt === 3) {
              failed.push({ target: v.target, text: it.text, error: String(e.message || e) });
            } else {
              await new Promise((r) => setTimeout(r, 800 * attempt));
            }
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  }

  const all = [...keepEntries, ...entries];
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, entries: all }, null, 0));

  // 生成 require 映射（Metro 只能静态解析字面量 require）
  const needs = all.map((e) => e.file).sort();
  const lines = [
    '/* eslint-disable */',
    '// ⚠️ 由 scripts/gen-prompt-audio.mjs 自动生成，请勿手改。',
    '// Metro 只认「字面量 require」，所以这里必须逐条列出，不能动态拼接路径。',
    '',
    'export const PROMPT_MODULES: Record<string, number> = {',
    ...needs.map((f) => `  '${f}': require('./${f}'),`),
    '};',
    '',
  ];
  fs.writeFileSync(path.join(OUT_DIR, 'index.ts'), lines.join('\n'));

  const bytes = all.reduce((sum, e) => {
    const p = path.join(OUT_DIR, e.file);
    return sum + (fs.existsSync(p) ? fs.statSync(p).size : 0);
  }, 0);

  console.log('\n');
  console.log(`✓ 完成：新生成 ${done}，沿用 ${skipped}，失败 ${failed.length}`);
  console.log(`· 清单 ${all.length} 条，音频合计 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  if (failed.length) {
    console.log('· 失败明细（前 10 条）：');
    failed.slice(0, 10).forEach((f) => console.log(`  - [${f.target}] ${f.text} :: ${f.error}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('✗ 失败：', e.message || e);
  process.exitCode = 1;
});

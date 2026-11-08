/**
 * 把 5 篇出海免费故事合成「大姐姐 Cherry」音色的离线 MP3，随 App 打包。
 * ---------------------------------------------------------------------------
 * 云端：百炼 qwen3-tts-flash / multimodal-generation 端点，voice = Cherry
 *       （与服务里 PRESET_VOICES['preset:cherry'] 完全一致，不是换一个音色）
 * 流程：POST 合成 → output.audio.url（WAV 下载地址）→ 二次 GET → ffmpeg 转 MP3
 *       → 多片 concat → ffprobe 读真实时长 → durations.json
 * 输出：assets/audio/free/{id}-zh.mp3 / {id}-en.mp3（10 个）
 *       data/classic-stories/durations.json（供 apply_free_pool.mjs 回填）
 *
 * 特性：
 *   · 已存在且非空的成品自动跳过（断点续跑，不重复消耗额度）
 *   · 整篇优先一次合成，失败/过长自动按句子边界分片，避免语调被硬切
 *   · 每个请求带 60s 超时 + 2 次重试
 *   · 全程不打印 API Key（只从 .env 读取）
 *
 * 用法：node build_free_audio.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT_DIR = path.join(ROOT, 'assets', 'audio', 'free');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rms-free-tts-'));
const POOL = JSON.parse(fs.readFileSync(path.join(HERE, 'free-pool-v2.json'), 'utf8'));

// —— 读取 .env（绝不打印 key）——
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const ORIGIN = new URL(env.EXPO_PUBLIC_AI_BASE_URL).origin;
const SYNTH_URL = `${ORIGIN}/api/v1/services/aigc/multimodal-generation/generation`;
const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${env.EXPO_PUBLIC_AI_API_KEY}`,
};
if (env.EXPO_PUBLIC_VOICE_WORKSPACE_ID) {
  HEADERS['X-Workspace-Id'] = env.EXPO_PUBLIC_VOICE_WORKSPACE_ID;
}
if (!env.EXPO_PUBLIC_AI_API_KEY) throw new Error('.env 缺少 EXPO_PUBLIC_AI_API_KEY');

const MODEL = 'qwen3-tts-flash';
const VOICE = 'Cherry'; // 大姐姐
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 按句子边界把长文本切成片，宁可多一片也不把句子砍断 */
function splitText(text, lang) {
  const limit = lang === 'zh' ? 600 : 1600;
  if (text.length <= limit) return [text];
  const sentences = text.match(/[^。！？；\n.!?]+[。！？；\n.!?]*/g) || [text];
  const parts = [];
  let cur = '';
  for (const s of sentences) {
    const piece = lang === 'zh' ? s : s + ' ';
    if (cur.length + piece.length > limit && cur.trim()) {
      parts.push(cur.trim());
      cur = '';
    }
    cur += piece;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.length ? parts : [text];
}

async function postSynth(text, attempt = 1) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(SYNTH_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        model: MODEL,
        input: { text, voice: VOICE, format: 'mp3', sample_rate: 24000 },
      }),
      signal: ctrl.signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 180)}`);
    const data = JSON.parse(body);
    let url = data?.output?.audio?.url;
    if (!url && typeof data?.output?.audio === 'string') url = data.output.audio;
    if (!url) throw new Error(`响应缺少音频地址：${body.slice(0, 180)}`);
    // 百炼偶发返回 http:// 下载地址，统一升级（iOS ATS 也要求 https）
    return url.replace(/^http:\/\//, 'https://');
  } catch (err) {
    if (attempt < 3) {
      console.log(`    ↻ 重试 ${attempt}/2 (${err.message.slice(0, 90)})`);
      await sleep(1200 * attempt);
      return postSynth(text, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadWav(url, dest, attempt = 1) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`下载 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error(`音频过小 ${buf.length}B`);
    fs.writeFileSync(dest, buf);
  } catch (err) {
    if (attempt < 3) {
      await sleep(1000 * attempt);
      return downloadWav(url, dest, attempt + 1);
    }
    throw err;
  }
}

function wavToMp3(wav, mp3) {
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', wav, '-ar', '24000', '-ac', '1', '-b:a', '64k', mp3],
    { stdio: 'pipe' },
  );
}

function concatMp3(parts, out) {
  const listPath = path.join(TMP, `list-${path.basename(out)}.txt`);
  fs.writeFileSync(
    listPath,
    parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n',
    'utf8',
  );
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', out],
    { stdio: 'pipe' },
  );
}

function probeSeconds(file) {
  const s = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { encoding: 'utf8' },
  );
  return Math.round(parseFloat(s.trim()));
}

/** 合成一路（zh / en）：先整篇，失败自动分片 */
async function synthOne(id, lang, text) {
  const outFile = path.join(OUT_DIR, `${id}-${lang}.mp3`);
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 20_000) {
    const sec = probeSeconds(outFile);
    console.log(`  ✓ ${id}-${lang} 已存在 ${sec}s，跳过`);
    return { file: outFile, sec };
  }

  let parts = [text];
  let wholeOk = false;
  try {
    const url = await postSynth(text);
    const wav = path.join(TMP, `${id}-${lang}-whole.wav`);
    await downloadWav(url, wav);
    const mp3 = path.join(TMP, `${id}-${lang}-whole.mp3`);
    wavToMp3(wav, mp3);
    fs.copyFileSync(mp3, outFile);
    wholeOk = true;
    console.log(`    整篇一次合成成功`);
  } catch (err) {
    console.log(`    整篇失败(${err.message.slice(0, 80)})，改为按句分片`);
    parts = splitText(text, lang);
  }

  if (!wholeOk) {
    const mp3Parts = [];
    for (let i = 0; i < parts.length; i++) {
      console.log(`    片 ${i + 1}/${parts.length} (${parts[i].length} 字符)`);
      const url = await postSynth(parts[i]);
      const wav = path.join(TMP, `${id}-${lang}-${i}.wav`);
      const mp3 = path.join(TMP, `${id}-${lang}-${i}.mp3`);
      await downloadWav(url, wav);
      wavToMp3(wav, mp3);
      mp3Parts.push(mp3);
    }
    concatMp3(mp3Parts, outFile);
  }

  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 20_000) {
    throw new Error(`${id}-${lang} 成品异常（过小或不存在）`);
  }
  const sec = probeSeconds(outFile);
  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`  ✓ ${id}-${lang}.mp3  ${sec}s  ${kb}KB`);
  return { file: outFile, sec };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const durations = {};
  const existing = path.join(HERE, 'durations.json');
  if (fs.existsSync(existing)) Object.assign(durations, JSON.parse(fs.readFileSync(existing, 'utf8')));

  console.log(`TTS: ${MODEL} / voice=${VOICE} / ${ORIGIN}`);
  console.log(`输出: ${OUT_DIR}\n`);

  for (const entry of POOL) {
    console.log(`[${entry.id}] ${entry.title.zh}`);
    for (const lang of ['zh', 'en']) {
      const { sec } = await synthOne(entry.id, lang, entry.content[lang]);
      // 展示时长取中英较长的一路
      durations[entry.id] = Math.max(durations[entry.id] || 0, sec);
    }
    fs.writeFileSync(existing, JSON.stringify(durations, null, 2) + '\n', 'utf8');
  }

  console.log('\n真实时长(秒):', JSON.stringify(durations));
  console.log('TMP:', TMP);
})().catch((err) => {
  console.error('\n合成失败：', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * scripts/diag-ai.mjs — 百炼 AI 链路本地体检
 *
 * 用途：判断「401 到底是 Key 的问题、地址的问题，还是环境变量没生效」。
 *
 * 用法：
 *   node scripts/diag-ai.mjs                # 读项目里的 .env 体检
 *   node scripts/diag-ai.mjs sk-xxxxxxxx    # 直接测这一把（临时验证新 Key，不写文件）
 *   node scripts/diag-ai.mjs --format sk-x  # 只做格式体检，不发请求（不花钱、不联网）
 *
 * 安全：任何情况下都不打印完整 Key，只输出长度、前 3 位、是否含空白。
 */

import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');

const args = process.argv.slice(2);
const formatOnly = args.includes('--format');
const cliKey = args.find((a) => a.startsWith('sk-') || a.startsWith('--key='))?.replace('--key=', '');

function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const env = readEnv();
const key = cliKey || env.EXPO_PUBLIC_AI_API_KEY || '';

/** 只取协议 + 主机：用户填的 Base URL 可能带 /compatible-mode/v1，路径由脚本自己拼 */
function originOf(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/[\s\u3000]/g, '').replace(/^["']+|["']+$/g, '');
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  if (/^http:\/\//i.test(s)) s = 'https://' + s.slice('http://'.length);
  const m = s.match(/^https:\/\/[^/?#]+/i);
  return m ? m[0] : '';
}

const rawBase = env.EXPO_PUBLIC_AI_BASE_URL || '';
const baseUrl = originOf(rawBase) || 'https://ws-6f52kltpls7886bp.ap-southeast-1.maas.aliyuncs.com';
const workspace = env.EXPO_PUBLIC_VOICE_WORKSPACE_ID || '(未设置)';

const line = (s = '') => console.log(s);
const kv = (k, v) => console.log(`  ${k.padEnd(22, ' ')}${v}`);

line('══════════ 1. Key 格式体检 ══════════');
kv('来源', cliKey ? '命令行参数' : '.env 文件');
kv('是否存在', key ? '是' : '❌ 空');
if (key) {
  kv('长度', `${key.length} 字符`);
  kv('前缀', `${key.slice(0, 6)}…`);
  kv('首尾空白', key !== key.trim() ? '⚠️ 有（会导致 401）' : '无');
  kv('含内部空白', /\s/.test(key) ? '⚠️ 有' : '无');
  kv('含引号', /["']/.test(key) ? '⚠️ 有' : '无');
  kv('全 ASCII', /^[\x20-\x7E]+$/.test(key) ? '是' : '⚠️ 否（可能有全角/零宽字符）');
  const isStandard = /^sk-[A-Za-z0-9]{32}$/.test(key);
  const isWorkspace = /^sk-ws-[A-Za-z0-9._-]{20,}$/.test(key);
  kv(
    'Key 类型',
    isStandard
      ? '✅ 传统 Key（sk- + 32 位，任何站点都认）'
      : isWorkspace
      ? '✅ 业务空间专属 Key（sk-ws-…，只能配它所属 workspace 的专属域名）'
      : '⚠️ 无法识别（既不是 35 位传统 Key，也不像 sk-ws- 专属 Key）'
  );
}

line();
line('══════════ 2. 地址与工作空间 ══════════');
kv('EXPO_PUBLIC_AI_BASE_URL 原值', rawBase || '(未设置，用内置默认)');
kv('归一后 origin', baseUrl);
if (rawBase && originOf(rawBase) !== rawBase.replace(/\/+$/, '')) {
  kv('路径处理', '已自动剥掉末尾路径，不会拼出双份 /compatible-mode/v1');
}
kv('实际请求地址', `${baseUrl}/compatible-mode/v1/chat/completions`);
kv('Workspace ID', workspace);
try {
  const host = new URL(baseUrl).hostname;
  const addrs = await dns.lookup(host, { all: true });
  kv('DNS 解析', `✅ ${host} → ${addrs.map((a) => a.address).join(', ')}`);
  const m = host.match(/^ws-([a-z0-9]+)\./i);
  if (m) {
    kv('地址内 workspace', `ws-${m[1]}`);
    if (workspace !== '(未设置)' && `ws-${m[1]}` !== workspace) {
      kv('一致性', '⚠️ 与 EXPO_PUBLIC_VOICE_WORKSPACE_ID 不一致');
    } else {
      kv('一致性', '✅ 与配置的 workspace 一致');
    }
  }
} catch (e) {
  kv('DNS 解析', `❌ 失败：${e.message}`);
}

if (!key) {
  line();
  line('结论：没读到 Key，无法继续。');
  process.exit(1);
}

if (formatOnly) {
  line();
  line('（--format 模式，未发起网络请求）');
  process.exit(0);
}

line();
line('══════════ 3. 真实请求探测 ══════════');

const isWorkspaceKey = /^sk-ws-/.test(key);

// sk-ws- 专属 Key 打到通用国际站必然 401（它只认自己 workspace 的专属域名），
// 探了只会误导，所以这类 Key 不探通用站；再用一把假 Key 做对照组：
// 若真 Key 的报错与假 Key 完全一致，就说明这把 Key 本身不被承认。
const probes = [];
if (!isWorkspaceKey) {
  probes.push({ label: '通用国际站（只看 Key 所属账号）', base: 'https://dashscope-intl.aliyuncs.com' });
}
probes.push({ label: '项目实际的 Base URL', base: baseUrl });
probes.push({ label: '对照组：假 Key（应为 401）', base: baseUrl, fake: true });

const FAKE_KEY = 'sk-0123456789abcdef0123456789abcdef';

const results = [];
for (const p of probes) {
  const url = `${p.base}/compatible-mode/v1/chat/completions`;
  const probeKey = p.fake ? FAKE_KEY : key;
  const t0 = Date.now();
  let status = null;
  let code = '';
  let msg = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${probeKey}` },
      body: JSON.stringify({ model: 'qwen-plus', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    status = res.status;
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      code = j?.error?.code ?? '';
      msg = j?.error?.message ?? '';
    } catch {
      msg = text.slice(0, 100);
    }
  } catch (e) {
    msg = e.message;
  }
  const ms = Date.now() - t0;
  const ok = status !== null && status >= 200 && status < 300;
  results.push({ ...p, status, code, msg, ms, ok });
  line();
  console.log(`▶ ${p.label}`);
  kv('URL', url);
  kv('HTTP', status === null ? '无响应' : `${status}${ok ? ' ✅' : ' ❌'}  (${ms}ms)`);
  if (!ok) {
    if (code) kv('错误码', code);
    if (msg) kv('错误信息', msg.replace(/\s+/g, ' ').slice(0, 160));
  }
}

line();
line('══════════ 结论 ══════════');
const realResults = results.filter((r) => !r.fake);
const fakeResult = results.find((r) => r.fake);
const anyOk = realResults.some((r) => r.ok);
const all401 = realResults.length > 0 && realResults.every((r) => r.status === 401);
const allNet = realResults.every((r) => r.status === null);
const sameAsFake =
  fakeResult && all401 && realResults.every((r) => r.status === fakeResult.status && r.code === fakeResult.code);

if (anyOk) {
  line('✅ Key 有效，链路通。');
  const failed = realResults.filter((r) => !r.ok);
  if (failed.length) {
    line(`⚠️ 但有 ${failed.length} 个地址失败 → 该地址与 Key 可能不属于同一个 workspace。`);
  }
} else if (sameAsFake) {
  line('❌ 真 Key 的报错与假 Key 完全一致 → 这把 Key 不被服务端承认。');
  line('   → 不是地址问题（地址已按要求归一），是 Key 本身：没复制全 / 已被轮换 / 属于别的账号或地域。');
  line('   → 请到控制台重新复制一次完整 Key，再执行：node scripts/diag-ai.mjs <新Key>');
} else if (all401) {
  line('❌ 返回 401，但报错细节与假 Key 不同 → 更可能是 Key 与地址（workspace / 地域）不匹配。');
  line('   → 确认 Base URL 的 workspace 与地域，和 Key 所属业务空间完全一致。');
} else if (allNet) {
  line('❌ 全部无响应 → 网络/DNS 问题（或本机代理拦截）。');
} else {
  line('⚠️ 结果不一致，看上面每个地址的状态码。');
}

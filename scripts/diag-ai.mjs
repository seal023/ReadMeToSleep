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
const baseUrl = (env.EXPO_PUBLIC_AI_BASE_URL || 'https://ws-6f52kltpls7886bp.ap-southeast-1.maas.aliyuncs.com').replace(/\/+$/, '');
const workspace = env.EXPO_PUBLIC_VOICE_WORKSPACE_ID || '(未设置)';

const line = (s = '') => console.log(s);
const kv = (k, v) => console.log(`  ${k.padEnd(22, ' ')}${v}`);

line('══════════ 1. Key 格式体检 ══════════');
kv('来源', cliKey ? '命令行参数' : '.env 文件');
kv('是否存在', key ? '是' : '❌ 空');
if (key) {
  kv('长度', `${key.length} 字符`);
  kv('前缀', `${key.slice(0, 3)}***`);
  kv('首尾空白', key !== key.trim() ? '⚠️ 有（会导致 401）' : '无');
  kv('含内部空白', /\s/.test(key) ? '⚠️ 有' : '无');
  kv('含引号', /["']/.test(key) ? '⚠️ 有' : '无');
  kv('全 ASCII', /^[\x20-\x7E]+$/.test(key) ? '是' : '⚠️ 否（可能有全角/零宽字符）');
  const standard = /^sk-[A-Za-z0-9]{32}$/.test(key);
  kv('百炼标准格式', standard ? '✅ sk- + 32 位' : `⚠️ 否（标准为 sk- 加 32 位，共 35 字符）`);
  if (!standard) {
    const segs = key.split('-');
    kv('分段结构', segs.map((s) => s.length).join('-') + `（共 ${segs.length} 段，${(key.match(/\./g) || []).length} 个点号）`);
  }
}

line();
line('══════════ 2. 地址与工作空间 ══════════');
kv('Base URL', baseUrl);
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

const probes = [
  { label: '通用国际站（只看 Key 所属账号）', base: 'https://dashscope-intl.aliyuncs.com' },
  { label: '项目实际的 Base URL', base: baseUrl },
];

const results = [];
for (const p of probes) {
  const url = `${p.base}/compatible-mode/v1/chat/completions`;
  const t0 = Date.now();
  let status = null;
  let code = '';
  let msg = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
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
const anyOk = results.some((r) => r.ok);
const all401 = results.every((r) => r.status === 401);
const allNet = results.every((r) => r.status === null);

if (anyOk) {
  line('✅ Key 有效，链路通。');
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    line(`⚠️ 但有 ${failed.length} 个地址失败 → Base URL 与 Key 可能不属于同一个 workspace，检查该地址。`);
  }
} else if (all401) {
  line('❌ 两个地址都返回 401 invalid_api_key。');
  line('   → 这不是「地址不匹配」，而是 Key 本身不被承认：');
  line('     复制错 / 已删除 / 已轮换 / 带了不可见字符 / 贴成了别的服务的 Key。');
  line('   → 去百炼控制台重新生成一把（形如 sk- 加 32 位），再跑一次本脚本。');
} else if (allNet) {
  line('❌ 全部无响应 → 网络/DNS 问题（或本机代理拦截）。');
} else {
  line('⚠️ 结果不一致，看上面每个地址的状态码。');
  line('   → 通用站点通、workspace 站点不通 = 地址或 workspace 写错；');
  line('   → 通用站点也不通 = Key 问题。');
}

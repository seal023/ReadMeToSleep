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
  const isCoding = /^sk-ws-/.test(key);
  const isTokenPlan = /^sk-sp-/.test(key);
  kv(
    'Key 类型',
    isStandard
      ? '✅ 按量付费 Key（sk- + 32 位）'
      : isCoding
      ? '✅ sk-ws- Key —— 业务空间专属 或 Coding Plan（实测前缀不能唯一区分，靠端点探测判定）'
      : isTokenPlan
      ? '✅ Token Plan Key（sk-sp-…）—— 只能配 token-plan.cn-beijing.maas.aliyuncs.com'
      : '⚠️ 无法识别（不是 sk- 32 位 / sk-ws- / sk-sp- 任一种）'
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

// 百炼有三套互不相通的「Key + Base URL」组合，混用一律 401：
//   ① 按量付费  sk-…    → https://{WorkspaceId}.{region}.maas.aliyuncs.com  (compatible-mode)
//   ② Coding Plan sk-ws-… → https://coding.dashscope.aliyuncs.com/v1        (OpenAI 兼容)
//   ③ Token Plan  sk-sp-… → https://token-plan.cn-beijing.maas.aliyuncs.com
//
// ⚠️ 实测发现 sk-ws- 前缀并不能唯一判定为 Coding Plan：业务空间的专属 Key 也是
//    sk-ws- 开头（如 sk-ws-H.xxxx.xxxx.MEUCIQ…），它配 workspace 专属域名就能用。
//    所以不按前缀猜，直接把三条路都探一遍，再用假 Key 作对照组。
const probes = [
  { label: '项目配置的 Base URL（业务空间兼容模式）', url: `${baseUrl}/compatible-mode/v1/chat/completions`, model: 'qwen-plus' },
  { label: '按量付费·通用国际站', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
  { label: 'Coding Plan（中国站）', url: 'https://coding.dashscope.aliyuncs.com/v1/chat/completions', model: 'qwen3.5-plus' },
  { label: 'Coding Plan（国际站）', url: 'https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions', model: 'qwen3.5-plus' },
  { label: 'Token Plan', url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
];

const FAKE_KEY = 'sk-0123456789abcdef0123456789abcdef';
probes.push({ label: '对照组：假 Key（必然失败）', url: probes[0].url, model: probes[0].model, fake: true });

const results = [];
for (const p of probes) {
  const probeKey = p.fake ? FAKE_KEY : key;
  const t0 = Date.now();
  let status = null;
  let code = '';
  let msg = '';
  try {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${probeKey}` },
      body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
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
  kv('URL', p.url);
  kv('model', p.model);
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
const okResult = realResults.find((r) => r.ok);
const allNet = realResults.every((r) => r.status === null);
const sameAsFake =
  fakeResult &&
  realResults.every((r) => r.status === fakeResult.status && r.code === fakeResult.code);
const expired = realResults.some((r) => /expired|token/i.test(r.msg || ''));

// 鉴权已过、但模型被拒：403 Model.AccessDenied —— Key 是好的，只是这个空间/账号
// 没有该模型的调用权限（新业务空间常见：没做模型授权、没开通模型服务、没额度）。
const deniedProbe = realResults.find(
  (r) => r.status === 403 && /accessdenied|access denied/i.test(`${r.code} ${r.msg}`)
);
// Key 被正确绑定到了别的空间：说明 Base URL 写错了空间 ID。
const workspaceMismatch = realResults.some((r) => /workspace endpoint access denied/i.test(r.msg || ''));

if (okResult) {
  const endpoint = okResult.url.replace(/\/chat\/completions$/, '');
  line('✅ 通了！');
  kv('能用的 Base URL', endpoint);
  kv('能用的 model', okResult.model);
  line('   → 把 EXPO_PUBLIC_AI_BASE_URL 改成上面的 Base URL、model 改成上面的模型名即可。');
} else if (allNet) {
  line('❌ 全部无响应 → 网络/DNS 问题（或本机代理拦截）。');
} else if (deniedProbe && !sameAsFake) {
  line('🔑 Key 鉴权通过（不再是 401），卡在模型权限：403 Model.AccessDenied。');
  if (workspaceMismatch) {
    line('   ⚠️ 另有地址报 "Workspace endpoint access denied" → 那把 Base URL 不是这个 Key 所属的空间。');
    line('   → 用控制台该 Key 旁边给出的 Base URL，不要手抄空间 ID。');
  }
  line('   → Key 本身有效，但当前业务空间/账号没有该模型的调用权限，需要去控制台放开：');
  line('     百炼控制台 → 该业务空间 → 模型管理 / 模型授权 → 添加并授权：');
  line('       qwen-plus              （生成故事）');
  line('       qwen3-tts-flash        （语音合成 / 预置音色）');
  line('       qwen-audio-3.0-asr-flash（语音转文字）');
  line('     同时确认账号已开通百炼「按量付费」且未欠费（免费额度用尽也会 403）。');
  line('   → 放开后复测：node scripts/diag-ai.mjs');
} else if (sameAsFake) {
  line('❌ 真 Key 的报错与假 Key 完全一致 → 这把 Key 在当前所有站点都不被承认。');
  if (expired) {
    line('   → 报错明确是 access token 无效/已过期：Key 已被轮换，或所属订阅已到期/未开通。');
    line('   → 去控制台「我的订阅 / API Key」页，确认订阅状态后再复制 Key。');
  } else {
    line('   → Key 本身不可用：没复制全 / 已被轮换 / 属于别的账号。');
  }
  line('   → 复测：node scripts/diag-ai.mjs <新Key>');
} else {
  line('⚠️ 各地址结果不一致，逐条看上面的状态码。');
  line('   → 若「项目配置的 Base URL」失败、其它某个地址成功，说明 Key 与配置的 Base URL 不配套。');
}

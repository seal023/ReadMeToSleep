#!/usr/bin/env node
/**
 * scripts/verify-quota-scope.mjs
 *
 * 「生成扣次数 / 收听不扣次数」的静态核验。
 *
 * 规则（产品红线）：
 *   1. 每日额度只在**真正调用云端 AI 并拿到成稿**时 +1；
 *   2. 收听任何故事（书架、经典库、我的故事、重播、缓存命中、本地录音回放）绝不 +1；
 *   3. 兜底故事、额度已满被拦、无网失败，都不 +1。
 *
 * 因为这是「看不见的记账」，出错的代价是客诉，所以用静态断言把它钉住。
 * 用法：node scripts/verify-quota-scope.mjs   （退出码 0 = 全部通过）
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const lines = (p) => read(p).split('\n');
/** 找第一个匹配行的 1-based 行号；找不到返回 -1 */
function lineOf(text, re) {
  const idx = text.search(re);
  if (idx < 0) return -1;
  return text.slice(0, idx).split('\n').length;
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// 1. 计数写入只有一处：services/entitlement.ts 的 recordStoryGenerated
// ---------------------------------------------------------------------------
{
  const ent = read('services/entitlement.ts');
  const increments = [...ent.matchAll(/storyCount\s*(\+=|\+\+)/g)].length;
  check('storyCount 只在 entitlement 里 +1（全项目唯一写入点）', increments === 1, `找到 ${increments} 处`);

  const callers = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (f.name === 'node_modules' || f.name.startsWith('.')) continue;
      const rel = path.join(dir, f.name);
      if (f.isDirectory()) {
        walk(rel);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(f.name)) continue;
      const src = read(rel);
      // 调用点（排除 entitlement.ts 内的定义）
      if (rel !== path.join('services', 'entitlement.ts') && /recordStoryGenerated\s*\(/.test(src)) {
        callers.push(rel);
      }
    }
  };
  walk('services');
  walk('app');
  walk('hooks');
  walk('components');

  check(
    'recordStoryGenerated 的调用点只有 services/ai.ts（UI 不再自行记账）',
    callers.length === 1 && callers[0].replace(/\\/g, '/') === 'services/ai.ts',
    callers.join(', ') || '无调用点',
  );
}

// ---------------------------------------------------------------------------
// 2. ai.ts 的记账必须落在「云端成功」分支之后
// ---------------------------------------------------------------------------
{
  const ai = read('services/ai.ts');
  const cacheHit = lineOf(ai, /return \{ \.\.\.cached, origin: 'cache' \}/);
  const gate = lineOf(ai, /const gate = await checkStoryGate\(\)/);
  const cloudSuccess = lineOf(ai, /origin: 'cloud'/);
  const record = lineOf(ai, /recordStoryGenerated\(\{/);
  const guard = lineOf(ai, /if \(countQuota\) \{/);

  check('缓存命中先于门禁（命中缓存绝不会走到扣次数）', cacheHit > 0 && gate > 0 && cacheHit < gate);
  check('记账在云端成功标记之后', record > cloudSuccess && cloudSuccess > 0);
  check('记账被 countQuota 开关包住', guard > 0 && record > guard);
  check('命中缓存返回 origin=cache', cacheHit > 0);
  check('额度已满返回 fallbackReason=quota', /fallbackReason: 'quota'/.test(ai));
  check('异常降级返回 origin=fallback', /origin: 'fallback', fallbackReason: 'error'/.test(ai));
  check('缓存只持久化正文三件套（不会把 origin=cloud 存下来）', /putCachedResult\(cacheKey, \{\s*\n\s*title: result\.title/.test(ai));
}

// ---------------------------------------------------------------------------
// 3. 收听链路严禁出现门禁 / 记账
// ---------------------------------------------------------------------------
{
  const listenFiles = [
    'app/story/[id].tsx',
    'services/playback.ts',
    'services/clonedVoicePlayback.ts',
    'app/(tabs)/my-stories.tsx',
    'app/(tabs)/library.tsx',
    'app/(tabs)/index.tsx',
  ];
  for (const f of listenFiles) {
    if (!fs.existsSync(path.join(root, f))) {
      check(`收听链路文件存在：${f}`, false, '文件缺失');
      continue;
    }
    const src = read(f);
    const dirty = /recordStoryGenerated\s*\(|checkStoryGate\s*\(|countQuota/.test(src);
    check(`收听链路零扣费：${f}`, !dirty, dirty ? '出现了额度相关调用' : '');
  }
}

// ---------------------------------------------------------------------------
// 4. create.tsx 只做「预检」，不做「记账」
// ---------------------------------------------------------------------------
{
  const create = read('app/(tabs)/create.tsx');
  check('创作页保留前置门禁（发请求前拦截）', /checkStoryGate\(\)/.test(create));
  check('创作页不再自行扣次数', !/recordStoryGenerated/.test(create));
  check('创作页区分 quota / error 两种降级', /fallbackReason === 'quota'/.test(create));
  check('创作页只在 origin=cloud 时才落库跳转', /result\.origin !== 'cloud'/.test(create));
}

// ---------------------------------------------------------------------------
// 5. 旅行打卡：属于生成，共用每日额度（且有独立打卡额度）
// ---------------------------------------------------------------------------
{
  const travel = read('app/story/travel-checkin.tsx');
  const story = read('services/travelStory.ts');
  check('打卡页在进入生成前过生成次数门禁', /checkStoryGate\(\)/.test(travel));
  check('打卡仍保留自己的打卡额度门禁', /checkCheckInGate\(\)/.test(travel));
  check('打卡生成走同一记账通道（source=travel）', /source: 'travel'/.test(story));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);

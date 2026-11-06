import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GenerateStoryParams, StoryGenerateResult, StoryLength } from '../types';
import { Alert } from 'react-native';
import { endpointOrigin, originSource } from './endpoints';
import { checkStoryGate, recordStoryGenerated } from './entitlement';
import { USE_AI_PROXY, proxyUrl, proxyAuthHeaders } from './cloudFetch';
import { storyCacheKey, getCachedResult, putCachedResult } from './storyCache';

/**
 * AI 服务层 —— 阿里云百炼（DashScope OpenAI 兼容模式）
 *
 * 端点已在 2026-11-02 用全新业务空间实测通过：
 *   POST https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1/chat/completions
 *   model = qwen-plus，返回标准 OpenAI chat.completion 结构。
 *   （域名里的 WorkspaceId 必须与 API Key 所属业务空间一致，否则 403 access_denied；
 *    详见 services/endpoints.ts 的推导与自愈逻辑。）
 *
 * 设计要点：
 *   1. 全链路 HTTPS，满足 iOS ATS 要求（明文 http 会被系统拦截）。
 *   2. 强制语言门控：要求模型全量使用目标语言输出，避免中英混杂。
 *   3. 每日调用额度保护，防止 Key 被盗刷产生额外费用。
 *   4. 三级降级：JSON 解析失败 → 纯文本兜底 → 内置故事库，保证任何情况下都能讲故事。
 *
 * ⚠️ 安全说明：API Key 已从源码移除，只通过环境变量注入，绝不写死在代码里。
 *    - 本地开发：复制到 .env（已被 gitignore，不会提交）
 *    - Xcode Cloud / EBA 构建：在 Xcode Cloud 工作流的环境变量里配置同名变量
 *    - 上架前强烈建议改为自建后端代理转发，客户端只持有短期签名令牌
 *    - 由于历史提交（3188c05）曾含 Key，建议到阿里云控制台轮换该 Key 使旧值失效
 */

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/**
 * 构建期注入的环境变量（Expo 通过 Metro 把 EXPO_PUBLIC_* 静态内联烧录进客户端包）。
 * ⚠️ 必须用 `process.env.EXPO_PUBLIC_X` 字面量访问：Metro 只识别这个精确表达式做
 *    静态替换；一旦裹上 (globalThis as any)?.process?.env?.X 或可选链，运行期就读不到
 *    值（落到 undefined），导致 API Key 为空、AI 永远降级到本地故事。
 */
const ENV_API_KEY = (process.env.EXPO_PUBLIC_AI_API_KEY as string | undefined) || '';
const ENV_BASE_URL = process.env.EXPO_PUBLIC_AI_BASE_URL as string | undefined;

/**
 * Base URL 容错（详见 services/endpoints.ts）：
 *   1. 控制台给的「只到主机」与「带 /compatible-mode/v1」两种写法都接受，
 *      统一归一成 origin，再自己拼 chat 路径，避免双份路径 404；
 *   2. ★ Base URL 缺失时用 EXPO_PUBLIC_VOICE_WORKSPACE_ID 推导专属域名；
 *   3. ★ Base URL 里的空间与 WORKSPACE_ID 不一致时以 WORKSPACE_ID 为准重建。
 *      （v80 事故：云端 Base URL 还是旧空间 ws-6f52…，而 Key 属于新空间
 *        ws-grdk…，于是 403 Workspace endpoint access denied，界面只报「AI 请求失败」。）
 */
const RESOLVED_ORIGIN = endpointOrigin(ENV_BASE_URL);

export const AI_CONFIG = {
  baseUrl: RESOLVED_ORIGIN,
  chatPath: '/compatible-mode/v1/chat/completions',
  /** 仅来自环境变量；未配置时为空，generateStory 会自动降级到内置故事库 */
  apiKey: ENV_API_KEY.trim(),
  model: 'qwen-plus',
  timeoutMs: 90_000,
  maxTokens: 3072,
};

/**
 * 技术层「防 Key 盗刷」上限（按本地日期 0 点重置）。
 * ⚠️ 这不是业务额度：业务口径是免费 1 次 / 会员 3 次，由 services/entitlement.ts
 *    的 checkStoryGate() 在**请求发出之前**拦截。这里只兜住「绕过 UI 直调」的极端情况，
 *    故意设得比业务值宽（12），避免与打卡等次要入口的正常调用互相误伤。
 */
const DAILY_QUOTA = {
  story: 12,
  qa: 999,
} as const;

type QuotaKind = keyof typeof DAILY_QUOTA;

const QUOTA_KEY = 'rms_ai_quota';

// ---------------------------------------------------------------------------
// 每日额度控制
// ---------------------------------------------------------------------------

interface QuotaState {
  date: string;
  story: number;
  qa: number;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function emptyQuota(): QuotaState {
  return { date: todayStr(), story: 0, qa: 0 };
}

/**
 * 消耗一次额度。
 * @returns true = 允许继续调用；false = 今日额度已用完
 */
async function consumeQuota(kind: QuotaKind): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(QUOTA_KEY);
    let state: QuotaState = raw ? JSON.parse(raw) : emptyQuota();
    if (!state || state.date !== todayStr()) {
      state = emptyQuota();
    }
    if (state[kind] >= DAILY_QUOTA[kind]) {
      return false;
    }
    state[kind] += 1;
    await AsyncStorage.setItem(QUOTA_KEY, JSON.stringify(state));
    return true;
  } catch {
    // 存储异常不应阻断故事生成
    return true;
  }
}

/** 查询今日剩余额度，供 UI 展示 */
export async function getRemainingQuota(): Promise<Record<QuotaKind, number>> {
  try {
    const raw = await AsyncStorage.getItem(QUOTA_KEY);
    const state: QuotaState = raw ? JSON.parse(raw) : emptyQuota();
    if (!state || state.date !== todayStr()) {
      return { ...DAILY_QUOTA };
    }
    return {
      story: Math.max(0, DAILY_QUOTA.story - state.story),
      qa: Math.max(0, DAILY_QUOTA.qa - state.qa),
    };
  } catch {
    return { ...DAILY_QUOTA };
  }
}

// ---------------------------------------------------------------------------
// 底层请求
// ---------------------------------------------------------------------------

async function chat(
  system: string,
  user: string,
  temperature: number,
  maxTokens?: number
): Promise<string> {
  // v107：切到代理模式后，Key 只存在服务端，客户端不再需要它
  if (!AI_CONFIG.apiKey && !USE_AI_PROXY) {
    // 未配置 Key：不发起网络请求，让上层降级到内置故事库
    if (__DEV__) {
      Alert.alert('AI 未配置', 'EXPO_PUBLIC_AI_API_KEY 为空，AI 将降级到本地故事');
    }
    throw new Error('AI_API_KEY_NOT_CONFIGURED');
  }
  // 端点也没解析出来（既没有 Base URL，也没有 workspace id）：
  // 明确报错，不要拼出相对路径去请求一个不存在的地址
  if (!AI_CONFIG.baseUrl) {
    if (__DEV__) {
      Alert.alert(
        'AI 未配置端点',
        'EXPO_PUBLIC_AI_BASE_URL 与 EXPO_PUBLIC_VOICE_WORKSPACE_ID 都为空，无法确定百炼端点。'
      );
    }
    throw new Error('AI_ENDPOINT_NOT_CONFIGURED');
  }
  let res;
  try {
    // v107：配置了 EXPO_PUBLIC_AI_PROXY_URL 就走 Edge Function 代理（带用户 JWT），
    // Key 只在服务端；否则维持原来的直连（本版默认）。
    const chatUrl = `${AI_CONFIG.baseUrl}${AI_CONFIG.chatPath}`;
    const authHeaders = USE_AI_PROXY
      ? { 'Content-Type': 'application/json', ...(await proxyAuthHeaders()) }
      : {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_CONFIG.apiKey}`,
        };
    res = await axios.post(
    proxyUrl(chatUrl),
    {
      model: AI_CONFIG.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens ?? AI_CONFIG.maxTokens,
    },
    {
      timeout: AI_CONFIG.timeoutMs,
      headers: authHeaders,
    }
  );
  } catch (err: any) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const code = typeof data === 'object' && data ? (data as any)?.code || (data as any)?.error?.code : undefined;
    const url = `${AI_CONFIG.baseUrl}${AI_CONFIG.chatPath}`;
    console.error('[ai] chat request failed', {
      status,
      code,
      data: typeof data === 'string' ? data.slice(0, 300) : data,
      url,
      originSource: originSource(),
      hasKey: !!AI_CONFIG.apiKey,
      message: err?.message,
    });
    // 把最常见的两种鉴权失败翻译成人话，避免家长/测试者对着 403 猜
    let hint = '';
    if (status === 403 && code === 'access_denied') {
      hint =
        '\n\n👉 这是「Key 与端点不属于同一个业务空间」：' +
        'Key 是新的，但请求打到了旧空间的域名。' +
        '本版已做自动纠正（以 EXPO_PUBLIC_VOICE_WORKSPACE_ID 为准重建域名），' +
        '若仍报此错，请核对该变量是否为当前空间的 ID。';
    } else if (status === 403) {
      hint = '\n\n👉 业务空间未授权该模型，去控制台「模型权限」里打开 qwen-plus。';
    } else if (status === 401) {
      hint = '\n\n👉 Key 无效或已轮换，去百炼控制台重新复制一把。';
    }
    // ⚠️ 出海：诊断信息（含内部端点 URL）只在开发包里弹出，
    // 生产包绝不向海外用户暴露端点/密钥痕迹，也不要弹中文。失败交由上层降级处理。
    if (__DEV__) {
      Alert.alert(
        'AI 请求失败（诊断）',
        `status: ${status ?? '无'}\n` +
          `url: ${url}\n` +
          `地址来源: ${originSource()}（env=环境变量 / workspace=由空间ID推导）\n` +
          `hasKey: ${!!AI_CONFIG.apiKey}\n` +
          `message: ${err?.message ?? '无'}\n` +
          `data: ${
            typeof data === 'string'
              ? data.slice(0, 200)
              : data
              ? JSON.stringify(data).slice(0, 200)
              : '无'
          }` +
          hint
      );
    }
    throw err;
  }

  const content: string = res.data?.choices?.[0]?.message?.content ?? '';
  return typeof content === 'string' ? content.trim() : '';
}

// ---------------------------------------------------------------------------
// 响应解析（多级容错）
// ---------------------------------------------------------------------------

interface StoryPayload {
  title?: string;
  content?: string;
}

function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

function extractJson(text: string): StoryPayload | null {
  if (!text) return null;

  const cleaned = stripCodeFence(text);

  // 1) 直接整体解析
  try {
    return JSON.parse(cleaned) as StoryPayload;
  } catch {
    /* 继续尝试 */
  }

  // 2) 截取第一个完整 {...} 块
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]) as StoryPayload;
    } catch {
      /* 继续尝试 */
    }
    // 3) 模型可能输出了未转义的真实换行，规范化后重试
    try {
      return JSON.parse(match[0].replace(/\r?\n/g, '\\n')) as StoryPayload;
    } catch {
      /* 落到纯文本兜底 */
    }
  }

  return null;
}

/**
 * 估算朗读时长（**秒**，v98 反馈 #1）
 * ---------------------------------------------------------------------------
 * 这里原来返回的是「分钟」（如 3），而经典 / 长篇故事的 duration 是「秒」（如 646），
 * 两套单位混在一起，播放页就把 3 分钟显示成了「故事约 0:03」。
 * 现在统一返回秒，与其余故事数据保持一致（storage.storyDurationSec 还会兜底折算历史数据）。
 */
function estimateDuration(content: string, language: 'zh' | 'en'): number {
  const minutes =
    language === 'zh'
      ? Math.max(1, Math.ceil(content.replace(/\s/g, '').length / 200))
      : Math.max(1, Math.ceil(content.split(/\s+/).filter(Boolean).length / 130));
  // ⚠️ 成本硬红线（v104）：AI 生成故事时长强制 ≤10 分钟，绝不超
  return Math.min(minutes * 60, 600);
}

/**
 * 成本硬红线（v104）：所有 AI 生成故事时长强制写死在 5-10 分钟内，绝不超过 10 分钟。
 * 时长越长，云端 TTS 算力费越高；月付 $4.99 扛不住单篇 15-25 分钟。
 * 这里在「生成之后」物理截断正文到上限（句边界处截断，绝不中途腰斩一段话）。
 */
const MAX_STORY_MINUTES = 10;
const STORY_CHAR_CAP_ZH = 2000; // 中文 ≈10 分钟（200 字/分钟）
const STORY_WORD_CAP_EN = 1300; // 英文 ≈10 分钟（130 词/分钟）

/** 硬截断：超过上限则在最近的「句末标点」边界处截断，保留最后一个完整句 */
function capStoryLength(content: string, language: 'zh' | 'en'): string {
  const cap = language === 'zh' ? STORY_CHAR_CAP_ZH : STORY_WORD_CAP_EN;
  if (language === 'zh') {
    if (content.length <= cap) return content;
    const slice = content.slice(0, cap);
    const m = slice.match(/[\s\S]*[。！？!?\.]+\s*$/);
    return (m ? m[0] : slice).trim();
  }
  const words = content.split(/\s+/).filter(Boolean);
  if (words.length <= cap) return content;
  const sliced = words.slice(0, cap).join(' ');
  const m = sliced.match(/[\s\S]*[.!?]+\s*$/);
  return (m ? m[0] : sliced).trim();
}

// ---------------------------------------------------------------------------
// 兜底故事库（网络异常 / 额度用完时使用，保证功能永不空白）
// ---------------------------------------------------------------------------

const FALLBACK_STORIES: Record<string, { title: string; content: string; duration: number }> = {
  default: {
    title: '星星的秘密',
    content:
      '在遥远的夜空中，住着一颗小小的星星，它的名字叫亮亮。亮亮每天晚上都努力地闪烁着，希望能给地上的小朋友们带来光明。\n\n有一天晚上，亮亮发现自己的光芒变得越来越弱了。它非常着急，不知道该怎么办。这时，月亮姐姐温柔地对它说："别担心，小星星，你只是太累了。每一颗星星都需要休息，就像小朋友们需要睡觉一样。"\n\n亮亮听了月亮姐姐的话，慢慢地闭上了眼睛。它做了一个甜甜的梦，梦见自己变成了一只萤火虫，在花丛中快乐地飞舞。梦里有好多可爱的小动物，小兔子、小熊、小松鼠，它们围在一起听它讲故事。\n\n第二天早上，亮亮醒来的时候，发现自己又变得闪闪发光了！它开心地向月亮姐姐道谢，然后继续在夜空中守护着大地。\n\n小朋友们，每一颗星星都有自己的秘密。当你看到星星闪烁的时候，也许它正在对你眨眼睛说晚安呢。好好睡觉，做一个甜甜的梦吧。',
    duration: 180,
  },
  space: {
    title: '太空探险',
    content:
      '小兔子乐乐一直梦想着能去太空探险。有一天，它收到了一封来自太空的信，邀请它去月球做客！\n\n乐乐穿上了特制的太空服，坐上了一艘闪亮的火箭。火箭嗖的一声冲上了天空，穿过了厚厚的云层，来到了神秘的太空。\n\n在太空中，乐乐看到了好多神奇的东西：闪闪发光的星星、五彩斑斓的星云、还有弯弯的月亮。月球上住着一群友好的玉兔，它们带着乐乐参观了月球基地。\n\n玉兔们告诉乐乐，月球上有很多有趣的地方，比如环形山、月海，还有一座用奶酪做成的城堡！乐乐在月球上度过了快乐的一天，和玉兔们一起唱歌、跳舞、讲故事。\n\n天色渐晚，乐乐依依不舍地告别了玉兔们，坐上火箭回到了地球。虽然探险结束了，但乐乐知道，只要心中有梦想，每一天都是新的冒险。晚安，小探险家！',
    duration: 240,
  },
  animal: {
    title: '森林音乐会',
    content:
      '在一片茂密的森林里，住着许多可爱的小动物。今天晚上，它们要举办一场特别的音乐会！\n\n小熊担任指挥，小兔子拉起了小提琴，小松鼠敲起了木琴，小鸟站在树枝上欢快地歌唱。森林里的每一个角落都充满了美妙的音乐。\n\n小刺猬也想来参加音乐会，可是它身上的刺总是不小心碰到乐器，发出刺耳的声音。小刺猬很难过，觉得自己什么都做不好。\n\n这时，聪明的小兔子想到了一个好主意。它让小刺猬用身上的刺敲打击乐器，没想到声音竟然特别好听！小刺猬开心极了，原来每个人都有自己独特的才能。\n\n音乐会一直持续到月亮升起。小动物们手拉着手，一起唱着晚安的歌曲。森林里安静下来，小动物们带着甜甜的微笑进入了梦乡。',
    duration: 240,
  },
  magic: {
    title: '魔法花园',
    content:
      '在一座古老的城堡后面，有一个神秘的魔法花园。花园里种满了会发光的花朵，每一朵花都是一个小精灵的家。\n\n有一天，小女孩莉莉无意中发现了这个花园。小精灵们热情地欢迎她，带她参观了花园里的每一个角落。她们一起在彩虹桥上跳舞，在水晶湖边唱歌，还品尝了用月光做成的蛋糕。\n\n夜幕降临，小精灵们送给莉莉一颗发光的种子，并告诉她："只要你用心呵护它，它就会长出世界上最美的花。"\n\n莉莉把种子带回了家，每天都细心地浇水、施肥。不久，种子发芽了，长出了一朵美丽的花朵，花瓣上闪烁着星星的光芒。\n\n从此以后，每当莉莉想念小精灵们的时候，她就会看看窗外的魔法花，心里感到温暖又幸福。晚安，魔法花园里的小精灵们！',
    duration: 300,
  },
  sea: {
    title: '航海的小船',
    content:
      '在蔚蓝的大海边，停着一艘小小的帆船，它的名字叫丁丁号。丁丁号每天最大的愿望，就是出海去看一看远方的世界。\n\n有一天清晨，海风轻轻吹来，丁丁号扬起了白色的船帆，出发啦！海水在船边唱歌，浪花跳着欢快的舞蹈，海鸥在天上为它引路。\n\n航行到半路，天色渐渐暗了下来，丁丁号有点害怕。这时，天上的星星们眨着眼睛对它说："别怕，我们一直在这里为你照亮回家的路。"\n\n丁丁号鼓起勇气，继续向前航行。不久，它发现了一座美丽的小岛，岛上住着许多友好的小鱼和小海龟。大家一起在浅浅的海水里玩耍，听着海浪轻轻的摇篮曲。\n\n夜深了，月亮升起来，把银色的光洒在海面上，像铺了一条亮晶晶的小路。丁丁号慢慢地停进温暖的港湾，收起船帆，甜甜地睡着了。\n\n小朋友们，只要勇敢又不怕黑，就能看到最美的风景。现在闭上眼睛，让小船带着你，一起飘进甜甜的梦里吧。晚安！',
    duration: 240,
  },
};

function pickFallbackStory(theme: string, protagonist: string): StoryGenerateResult {
  const t = theme || '';
  let picked = FALLBACK_STORIES.default;
  if (/航海|航行|海洋|大海|海|船|帆船|冒险|sail|sea|ocean|ship|boat|adventure/i.test(t)) picked = FALLBACK_STORIES.sea;
  else if (/太空|space|星星|star|月亮|moon|宇航/i.test(t)) picked = FALLBACK_STORIES.space;
  else if (/动物|animal|森林|forest|小熊|兔子|小猫/i.test(t)) picked = FALLBACK_STORIES.animal;
  else if (/魔法|magic|精灵|fairy|仙子|城堡/i.test(t)) picked = FALLBACK_STORIES.magic;

  let content = picked.content;
  if (protagonist && protagonist.trim()) {
    content = content.replace(/丁丁|小兔子|乐乐|莉莉/g, protagonist.trim());
  }

  return {
    title: protagonist ? `${protagonist}的${picked.title}` : picked.title,
    content,
    duration: picked.duration,
    fallback: true,
  };
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/**
 * 生成睡前故事。
 * 永远返回结果，不会抛错（任何异常都会降级到内置故事库）。
 */
export async function generateStory(
  params: GenerateStoryParams
): Promise<StoryGenerateResult> {
  const {
    theme,
    protagonist,
    details,
    language = 'zh',
    length = 'short',
    sensitiveWords,
    source = 'create',
    countQuota = true,
  } = params;

  const isZh = language === 'zh';

  /**
   * ★ 第一道闸：本地缓存优先。
   * 同一组参数已有成稿就直接复用，既不发 LLM 请求、也不消耗技术层 quota，
   * 更不会让调用方扣当日业务次数（create.tsx 也会先查同一份缓存直接播放）。
   */
  const cacheKey = storyCacheKey(params);
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    console.log('[ai] 命中本地故事缓存，跳过云端生成');
    // origin='cache'：调用方据此**绝不扣次数**（用户只是复用已编好的故事）
    return { ...cached, origin: 'cache' };
  }

  /**
   * ★ 第二道闸：业务前置校验（免费 1 次/天、会员 3 次/天）。
   * 放在任何网络请求之前，保证「今日已满 3 次」时绝不会扣百炼 token。
   * 返回本地兜底故事，调用方（旅行打卡等）会据此降级到本地模板。
   */
  const gate = await checkStoryGate();
  if (!gate.allowed) {
    console.warn('[ai] 每日生成额度已用完，拦截本次云端请求');
    return { ...pickFallbackStory(theme, protagonist), origin: 'fallback', fallbackReason: 'quota' };
  }

  /** 第三道闸：技术层防滥用（见 DAILY_QUOTA 注释） */
  const allowed = await consumeQuota('story');
  if (!allowed) {
    console.warn('[ai] 今日故事生成额度已用完，使用内置故事');
    return { ...pickFallbackStory(theme, protagonist), origin: 'fallback', fallbackReason: 'quota' };
  }

  // ⚠️ v104 成本红线：所有 AI 故事绝不超过 10 分钟；v105 起 UI 只保留 3-5 / 5-10 两档
  //    这既是成本约束，也是体验约束——睡前故事太长孩子听不完、也费 TTS 算力。
  // 时长分级 → 字数/词数要求 + 输出 token 上限
  // ⚠️ v105：档位精简为两档 —— short 3-5 分钟 / medium 5-10 分钟。
  //    20 分钟以上的「长故事」已从创作页彻底下线（TTS 成本红线 + 睡前故事听不完），
  //    旧参数里若仍有 'long'，一律按 medium 处理，保证老缓存/老调用不会走空。
  const lenRule = (
    isZh
      ? {
          short: '正文字数 700-1000 个汉字（约 3-5 分钟）',
          medium:
            '正文字数 1200-2000 个汉字（约 5-10 分钟），**绝对不超过 2000 字**（这是硬上限，必须严格满足）',
          long: '正文字数 1200-2000 个汉字（约 5-10 分钟），**绝对不超过 2000 字**（这是硬上限，必须严格满足）',
        }
      : {
          short: 'about 400-650 English words (about 3-5 minutes)',
          medium:
            'about 800-1300 English words (about 5-10 minutes), and **NEVER more than 1300 words** (hard upper limit, strict)',
          long: 'about 800-1300 English words (about 5-10 minutes), and **NEVER more than 1300 words** (hard upper limit, strict)',
        }
  )[length] as string;

  // 物理上限：即便模型想写长，也在 token 层面被挡住（zh≈1.5 tokens/字，en≈1.3 tokens/词，留安全余量）
  const lenTokens = (
    { short: 1800, medium: 3000, long: 3000 } as Record<StoryLength, number>
  )[length];

  const langName = isZh ? '简体中文' : 'English';
  const lengthRule = lenRule;

  const avoidRule =
    sensitiveWords && sensitiveWords.length > 0
      ? `\n严禁出现以下内容或词汇：${sensitiveWords.join('、')}。`
      : '';

  const system = [
    '你是一位专业的儿童睡前故事作家，为 3-8 岁儿童创作温馨的睡前故事。',
    `【语言要求】必须全部使用${langName}输出，不得混用其他语言。`,
    '【内容要求】',
    `- ${lengthRule}，分成 5-8 个自然段，段落之间用空行分隔。`,
    '- 每段都要推进一点情节，不要堆砌景物描写、不要反复形容同一个画面，不要为凑字数加排比句。',
    '- 情节简单温暖、有画面感，节奏舒缓，越往后越安静。',
    '- 结尾必须是安宁、助眠的收束，例如"晚安""做个好梦"。',
    '- 不得出现暴力、恐怖、惊吓、死亡、争吵、负面情绪描写。',
    '- 不得出现任何真实品牌、真实人名、网址或联系方式。',
    '- 不得出现武器（枪、刀、匕首等）、毒品（鸦片、大麻等）、犯罪、走私、血腥伤害等内容。',
    /**
     * v94 反馈 #3 的核心修复：家长给的主题里带危险元素时，模型以前会「忠于主题」把它写进故事，
     * 只是换个说法（pistol instead of gun、"poppies for medicine" instead of opium），
     * 既不安全、也绕过了按字面匹配的敏感词过滤。
     * 现在明确要求：**替换掉这些元素**，而不是在故事里提及/否认它们。
     */
    '- 【主题净化】如果主题或细节里出现武器、毒品、犯罪、伤害等不适合儿童的元素，必须**直接替换成安全的日常事物**（例如枪→水壶、刀→铅笔、毒品→向日葵、罪犯→路过的旅人），并且**绝对不要在故事里提到原来的词**，也不要写成「听说有人带枪其实没有」这种仍在提及的方式，故事要顺着替换后的内容自然展开。',
    avoidRule,
    '【输出格式】只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要前后缀文字：',
    '{"title": "故事标题", "content": "故事正文"}',
    '其中 content 内的换行请使用 \\n 表示（两个换行表示分段）。',
  ]
    .filter(Boolean)
    .join('\n');

  /** 同一套结构拼两版 user：原始主题 + 净化主题（重写时用后者，避免模型又"紧扣"危险元素） */
  const buildUser = (t: string, d: string) =>
    [
      `请创作一个睡前故事。`,
      `【最重要的要求】故事必须紧紧围绕下面用户给出的主题来写，主题是什么就写什么，绝不能替换或偏离主题。`,
      `主题：${t}`,
      protagonist ? `主角：${protagonist}（必须以它作为故事的主角）` : '',
      d ? `需要包含的细节：${d}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  const safeTheme = neutralizeTheme(theme) || '温馨的睡前时光';
  const user = buildUser(theme || '温馨的睡前时光', details ? String(details) : '');
  const safeUser = buildUser(safeTheme, details ? neutralizeTheme(String(details)) : '');

  // 家长词 + 内置儿童安全词，一起作为「生成后必须扫一遍」的底线
  const safetyWords = [...(sensitiveWords || []), ...(isZh ? SAFETY_WORDS_ZH : SAFETY_WORDS_EN)];

  try {
    const raw = await chat(system, user, 0.8, lenTokens);
    if (!raw) throw new Error('empty response');

    const parsed = extractJson(raw);

    let title = (theme || '晚安故事') as string;
    let content = '';
    if (parsed?.content) {
      content = String(parsed.content).trim();
      title = String(parsed.title || '').trim() || title;
    } else {
      // JSON 解析失败但拿到了文本 —— 直接当正文用
      const plain = stripCodeFence(raw);
      if (plain.length <= 40) throw new Error('unparsable response');
      content = plain;
      title = plain.split(/\r?\n/)[0].replace(/^#+\s*/, '').slice(0, 30) || title;
    }

    // 内容安全硬过滤：家长词 + 内置儿童安全词一起扫，命中则用「净化后的主题」重写一次；
    // 仍命中则字符串替换兜底（绝不能让违禁内容原样交付给孩子——软约束不可靠）
    const guarded = await enforceStorySafety(
      content,
      title,
      safetyWords,
      isZh,
      system,
      safeUser,
      lenTokens,
    );

    // ★ 成本硬红线（v104）：生成后物理截断正文到 5-10 分钟上限（句边界处），
    //   无论模型实际写多长，落库的成稿绝不超过 10 分钟，杜绝 TTS 算力失控。
    const finalContent = capStoryLength(guarded.content, language);

    const result: StoryGenerateResult = {
      title: guarded.title,
      content: finalContent,
      duration: estimateDuration(finalContent, language),
      origin: 'cloud',
    };
    // 只有 AI 真的写成稿子才进缓存；兜底故事不缓存，下次仍会尝试重新生成。
    // 缓存里只留正文三件套：origin 是「本次调用」的元信息，不该被持久化成 cloud。
    await putCachedResult(cacheKey, {
      title: result.title,
      content: result.content,
      duration: result.duration,
    });

    /**
     * ★ 扣次数的唯一入口（v103 收紧）：
     * 只有走到这里 —— 云端真的返回了可用正文、稿子已经落缓存 —— 才算一次「生成」。
     * 收听、重播、书架、经典库、命中缓存、AI 失败降级，全部不会经过这一行。
     * 记账放在服务层而不是 UI，任何新入口都无法漏记或错记。
     */
    if (countQuota && !params.isCancelled?.()) {
      await recordStoryGenerated({
        storyLength: length === 'short' ? 'short' : 'long',
        source,
      });
    }
    return result;
  } catch (err: any) {
    console.warn('[ai] generateStory failed, using fallback:', err?.message ?? err);
    return { ...pickFallbackStory(theme, protagonist), origin: 'fallback', fallbackReason: 'error' };
  }
}

// ---------------------------------------------------------------------------
// 内容安全过滤（v94 反馈 #3 重做）
// ---------------------------------------------------------------------------
/**
 * 内置儿童安全词（与家长设置无关的底线）。
 *
 * 为什么必须有：家长输入 gun / dagger / opium，模型只要换个写法（pistol、dagger、
 * "poppies—we grow them for medicine and seeds"）就能完全绕过「按字面匹配家长词」的过滤，
 * 结果一篇提枪、提匕首、提罂粟的故事原样交给孩子。
 * 所以这里内置一份中英同义词表，生成后强制扫一遍，命中就重写。
 */
const SAFETY_WORDS_EN = [
  'gun', 'guns', 'pistol', 'pistols', 'rifle', 'rifles', 'shotgun', 'firearm', 'firearms',
  'weapon', 'weapons', 'bullet', 'bullets', 'bomb', 'bombs', 'explosive', 'explosives',
  'dagger', 'daggers', 'knife', 'knives', 'blade', 'blades', 'sword', 'swords',
  'opium', 'heroin', 'cocaine', 'marijuana', 'cannabis', 'narcotic', 'narcotics',
  'drug', 'drugs', 'poppy', 'poppies',
  'kill', 'kills', 'killed', 'killing', 'murder', 'murdered', 'stab', 'stabbed', 'stabbing',
  'shoot', 'shooting', 'shot', 'blood', 'bloody', 'corpse', 'gang', 'gangster', 'gangsters',
  'smuggle', 'smuggler', 'smugglers', 'trafficker', 'traffickers', 'violence', 'violent',
];
const SAFETY_WORDS_ZH = [
  '手枪', '步枪', '枪支', '枪', '子弹', '武器', '炸药', '炸弹',
  '匕首', '利刃', '刀剑',
  '鸦片', '海洛因', '大麻', '可卡因', '毒品', '吸毒', '贩毒',
  '杀人', '杀死', '谋杀', '刺伤', '开枪', '枪击', '血腥', '尸体', '暴力', '犯罪集团', '走私',
];

/** 主题净化表：把危险元素直接换成安全的日常事物（英文按整词替换，中文按词替换） */
const THEME_NEUTRALIZE: { re: RegExp; to: string }[] = [
  // 冠词一起吃掉再补上，否则会出现「Carrying a a water bottle」这种双冠词
  { re: /\b(?:(?:a|an|the)\s+)?(?:guns?|pistols?|rifles?|shotguns?|firearms?|weapons?|bullets?|bombs?|explosives?)\b/gi, to: 'a water bottle' },
  { re: /\b(?:(?:a|an|the)\s+)?(?:knife|knives|daggers?|blades?|swords?)\b/gi, to: 'a pencil' },
  { re: /\b(?:opium|heroin|cocaine|marijuana|cannabis|narcotics?|drugs?|popp(?:y|ies))\b/gi, to: 'sunflowers' },
  { re: /\b(?:gangsters?|smugglers?|traffickers?|gangs?|criminals?)\b/gi, to: 'travellers' },
  { re: /\b(?:kill|kills|killed|killing|murder|murdered|stab|stabbed|stabbing|shoot|shooting|shot)\b/gi, to: 'greet' },
  { re: /(?:一[把支杆])?(?:手枪|步枪|枪支|枪|子弹|武器|炸药|炸弹)/g, to: '一壶水' },
  { re: /(?:一[把支])?(?:匕首|利刃|刀剑)/g, to: '一支铅笔' },
  { re: /(?:鸦片|海洛因|大麻|可卡因|毒品|吸毒|贩毒)/g, to: '向日葵' },
  { re: /(?:犯罪集团|走私|杀人|杀死|谋杀|刺伤|开枪|枪击|血腥|尸体|暴力)/g, to: '打招呼' },
];

/** 把主题 / 细节里的危险元素换成安全等价物（生成前预净化，重写时用） */
function neutralizeTheme(text: string | undefined): string {
  let out = String(text || '');
  if (!out.trim()) return '';
  // 中英两套规则都跑：主题语言与界面语言不一定一致（家长可能贴一段英文进来）
  for (const { re, to } of THEME_NEUTRALIZE) {
    out = out.replace(re, to);
  }
  return out.trim();
}

/** 扫描命中词：中文按包含匹配，英文按整词匹配（避免 drugstore / skirting 这类误命中） */
function findSafetyHits(text: string, words: string[], isZh: boolean): string[] {
  if (!text || !words?.length) return [];
  const seen = new Set<string>();
  for (const raw of words) {
    const w = (raw || '').trim();
    if (!w || seen.has(w)) continue;
    if (isZh) {
      if (text.includes(w)) seen.add(w);
    } else {
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${esc}\\b`, 'i').test(text)) seen.add(w);
    }
  }
  return Array.from(seen);
}

/** 最后一道兜底：命中词统一替换成中性词（保证绝不出违禁词，哪怕句子会略生硬） */
function replaceSafetyWords(text: string, words: string[], isZh: boolean): string {
  let out = text;
  const safe = isZh ? '小玩意儿' : 'something fun';
  for (const raw of words) {
    const w = (raw || '').trim();
    if (!w) continue;
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = isZh ? new RegExp(esc, 'g') : new RegExp(`\\b${esc}\\b`, 'gi');
    out = out.replace(re, (m) =>
      !isZh && m && m[0] === m[0].toUpperCase()
        ? safe.charAt(0).toUpperCase() + safe.slice(1)
        : safe,
    );
  }
  return out;
}

/**
 * 生成后内容安全兜底：命中（家长词 + 内置安全词）→ 用**净化后的主题**整篇重写一次；
 * 仍命中 → 字符串替换兜底。标题也一起检查、一起处理。
 */
async function enforceStorySafety(
  content: string,
  title: string,
  words: string[],
  isZh: boolean,
  system: string,
  safeUser: string,
  maxTokens?: number,
): Promise<{ title: string; content: string }> {
  const hit = findSafetyHits(`${title}\n${content}`, words, isZh);
  if (hit.length === 0) return { title, content };

  try {
    const retrySystem =
      system +
      `\n【强制重申】上一版故事的标题或正文里出现了不该给 3-8 岁孩子看的词：${hit.join('、')}。` +
      `请完全重新创作一版：把这些元素换成主题里已经给出的安全事物，` +
      `全文（含标题）一个都不许再出现，也不要用"听说/传说里有过"这类暗示方式提及。`;
    const raw2 = await chat(retrySystem, safeUser, 0.85, maxTokens);
    const p2 = extractJson(raw2 || '');
    const c2 = p2?.content ? String(p2.content).trim() : '';
    const t2 = p2?.title ? String(p2.title).trim() : title;
    if (c2 && findSafetyHits(`${t2}\n${c2}`, words, isZh).length === 0) {
      return { title: t2 || title, content: c2 };
    }
    if (c2) {
      return {
        title: replaceSafetyWords(t2 || title, words, isZh),
        content: replaceSafetyWords(c2, words, isZh),
      };
    }
  } catch {
    /* 落到下方替换兜底 */
  }
  return {
    title: replaceSafetyWords(title, words, isZh),
    content: replaceSafetyWords(content, words, isZh),
  };
}

/**
 * 故事问答。
 * @param context  故事正文
 * @param question 孩子提出的问题
 */
/**
 * 回答孩子在听完故事后的自由提问。
 * @param language 当前界面语言。v81 修复：原来让模型「跟着孩子提问的语言走」，
 *   结果英文界面提问、故事正文是中文时，模型会按故事语言用中文回答；
 *   现在强制用界面语言作答（孩子听到的语音、看到的文字必须一致）。
 */
export async function askQuestion(
  context: string,
  question: string,
  language: 'zh' | 'en' = 'zh',
): Promise<string> {
  const isZh = language === 'zh';
  if (!question?.trim()) {
    return isZh ? '你想问什么呢？' : 'What would you like to ask?';
  }

  const allowed = await consumeQuota('qa');
  if (!allowed) {
    return isZh
      ? '今天的问题有点多啦，我们明天再聊好不好？先乖乖睡觉吧～'
      : "That's a lot of questions for today! Let's talk more tomorrow. Time to sleep now.";
  }

  const langName = isZh ? '简体中文' : 'English';
  const system = [
    '你是儿童故事助手"小浣熊"，正在陪 3-8 岁的孩子听完睡前故事后聊天。',
    '【回答要求】',
    `- 无论孩子用什么语言提问，一律使用${langName}回答，不得混用其他语言。`,
    `- 如果孩子的提问与故事无关，也用${langName}温柔地回应，并把话题带回故事或睡觉。`,
    '- 简洁温柔，2-4 句话，总长度不超过 80 字（英文不超过 60 词）。',
    '- 只围绕故事内容回答；故事里没提到的，就温柔地说不知道，不要编造。',
    '- 语气亲切，可以用简单的比喻。不得出现恐怖、暴力内容。',
    '- 不要提及你是 AI、模型或程序。',
    '',
    `【故事内容】\n${(context || '').slice(0, 3000)}`,
  ].join('\n');

  try {
    const answer = await chat(system, question.trim(), 0.7);
    return answer || (isZh ? '嗯，这个问题我还不太清楚呢～' : "Hmm, I'm not quite sure about that one.");
  } catch (err: any) {
    console.warn('[ai] askQuestion failed:', err?.message ?? err);
    return isZh ? '嗯，这个问题我还不太清楚呢～' : "Hmm, I'm not quite sure about that one.";
  }
}

/**
 * 根据刚讲完的故事正文，给孩子生成 2 道贴合故事内容的二选一理解题。
 * 永远返回（失败返回 null，由上层回退到通用题）。
 * @returns 每项为 { question, options: [A, B] }；至少返回 1 道
 */
export async function generateStoryQuestions(
  content: string,
  title: string,
  language: 'zh' | 'en'
): Promise<{ question: string; options: string[]; correctIndex: number }[] | null> {
  const allowed = await consumeQuota('qa');
  if (!allowed) return null;

  const isZh = language === 'zh';
  const langName = isZh ? '简体中文' : 'English';

  const system = [
    '你是儿童睡前故事助手，负责根据刚讲完的故事，给 3-8 岁的孩子出 2 道有趣的理解/互动选择题。',
    `【语言】全部使用${langName}输出，不得混用其他语言。`,
    '【要求】',
    '- 只输出一个 JSON 数组，不要解释、不要 markdown 代码块、不要任何前后缀文字。',
    '- 数组含 2 个元素，每个元素为 {"question":"一道简短的问题（必须紧扣这个故事里的角色、情节或场景）","options":["选项A的简短词语","选项B的简短词语"],"correct":0 或 1}。',
    '- correct 必须是 0 或 1，表示 options 中哪一个才是符合故事内容的答案（用于判断孩子是否答对）。',
    '- 问题要让孩子能听懂、且与这个故事的具体内容相关；选项为 2 个简短词语，不要长句。',
  ].join('\n');

  const user = `故事标题：${title}\n\n故事内容：\n${(content || '').slice(0, 2000)}\n\n请出 2 道与这个故事有关的二选一问题，并标明正确答案的索引。`;

  try {
    const raw = await chat(system, user, 0.6);
    if (!raw) return null;
    const cleaned = stripCodeFence(raw);

    const parse = (text: string): { question: string; options: string[]; correctIndex: number }[] | null => {
      try {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) return null;
        const out = arr
          .filter(
            (x: any) =>
              x && typeof x.question === 'string' && Array.isArray(x.options) && x.options.length >= 2
          )
          .map((x: any) => {
            let correct = Number(x.correct);
            if (!Number.isFinite(correct) || correct < 0 || correct >= x.options.length) correct = 0;
            return {
              question: String(x.question),
              options: x.options.slice(0, 2).map(String),
              correctIndex: correct,
            };
          });
        return out.length ? out : null;
      } catch {
        return null;
      }
    };

    const direct = parse(cleaned);
    if (direct) return direct;

    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) {
      const fromMatch = parse(m[0]);
      if (fromMatch) return fromMatch;
    }
    return null;
  } catch (err: any) {
    console.warn('[ai] generateStoryQuestions failed:', err?.message ?? err);
    return null;
  }
}

/** 连通性自检，便于排查配置是否正确 */
export async function pingAI(): Promise<{ ok: boolean; message: string }> {
  try {
    const text = await chat('You reply with exactly one word.', 'OK', 0);
    return { ok: true, message: text || 'ok' };
  } catch (err: any) {
    return { ok: false, message: err?.response?.data?.error?.message ?? err?.message ?? 'unknown error' };
  }
}

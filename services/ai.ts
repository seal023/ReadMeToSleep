import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GenerateStoryParams, StoryGenerateResult } from '../types';

/**
 * AI 服务层 —— 阿里云百炼（DashScope OpenAI 兼容模式）
 *
 * 端点已在 2026-09-01 实测通过：
 *   POST https://ws-6f52kltpls7886bp.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions
 *   model = qwen-plus，返回标准 OpenAI chat.completion 结构。
 *
 * 设计要点：
 *   1. 全链路 HTTPS，满足 iOS ATS 要求（明文 http 会被系统拦截）。
 *   2. 强制语言门控：要求模型全量使用目标语言输出，避免中英混杂。
 *   3. 每日调用额度保护，防止 Key 被盗刷产生额外费用。
 *   4. 三级降级：JSON 解析失败 → 纯文本兜底 → 内置故事库，保证任何情况下都能讲故事。
 *
 * ⚠️ 安全提示：当前 API Key 写在客户端代码里，存在被反编译提取的风险。
 *    正式上架前强烈建议改为自建后端代理转发，客户端只持有短期签名令牌。
 */

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 优先读取构建期注入的环境变量，未配置时回落到下方内置值 */
const ENV_API_KEY = (globalThis as any)?.process?.env?.EXPO_PUBLIC_AI_API_KEY as
  | string
  | undefined;

export const AI_CONFIG = {
  baseUrl: 'https://ws-6f52kltpls7886bp.ap-southeast-1.maas.aliyuncs.com',
  chatPath: '/compatible-mode/v1/chat/completions',
  apiKey:
    ENV_API_KEY ||
    'sk-ws-H.IRLMRX.ef5O.MEUCIQCnQdFgB_jGXufYJIVjjUIcbEKa7zv3_s2bo6eqLeR4tAIgJU-yhoIKPynfDIuRZyNfgFyQuBNwvDwHmw1_aPmiVjE',
  model: 'qwen-plus',
  timeoutMs: 90_000,
  maxTokens: 3072,
};

/** 每日调用额度（防止 Key 被滥用） */
const DAILY_QUOTA = {
  story: 8,
  qa: 20,
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
  temperature: number
): Promise<string> {
  const res = await axios.post(
    `${AI_CONFIG.baseUrl}${AI_CONFIG.chatPath}`,
    {
      model: AI_CONFIG.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: AI_CONFIG.maxTokens,
    },
    {
      timeout: AI_CONFIG.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_CONFIG.apiKey}`,
      },
    }
  );

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

/** 估算朗读时长（分钟） */
function estimateDuration(content: string, language: 'zh' | 'en'): number {
  if (language === 'zh') {
    return Math.max(1, Math.ceil(content.replace(/\s/g, '').length / 200));
  }
  const words = content.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 130));
}

// ---------------------------------------------------------------------------
// 兜底故事库（网络异常 / 额度用完时使用，保证功能永不空白）
// ---------------------------------------------------------------------------

const FALLBACK_STORIES: Record<string, { title: string; content: string; duration: number }> = {
  default: {
    title: '星星的秘密',
    content:
      '在遥远的夜空中，住着一颗小小的星星，它的名字叫亮亮。亮亮每天晚上都努力地闪烁着，希望能给地上的小朋友们带来光明。\n\n有一天晚上，亮亮发现自己的光芒变得越来越弱了。它非常着急，不知道该怎么办。这时，月亮姐姐温柔地对它说："别担心，小星星，你只是太累了。每一颗星星都需要休息，就像小朋友们需要睡觉一样。"\n\n亮亮听了月亮姐姐的话，慢慢地闭上了眼睛。它做了一个甜甜的梦，梦见自己变成了一只萤火虫，在花丛中快乐地飞舞。梦里有好多可爱的小动物，小兔子、小熊、小松鼠，它们围在一起听它讲故事。\n\n第二天早上，亮亮醒来的时候，发现自己又变得闪闪发光了！它开心地向月亮姐姐道谢，然后继续在夜空中守护着大地。\n\n小朋友们，每一颗星星都有自己的秘密。当你看到星星闪烁的时候，也许它正在对你眨眼睛说晚安呢。好好睡觉，做一个甜甜的梦吧。',
    duration: 3,
  },
  space: {
    title: '太空探险',
    content:
      '小兔子乐乐一直梦想着能去太空探险。有一天，它收到了一封来自太空的信，邀请它去月球做客！\n\n乐乐穿上了特制的太空服，坐上了一艘闪亮的火箭。火箭嗖的一声冲上了天空，穿过了厚厚的云层，来到了神秘的太空。\n\n在太空中，乐乐看到了好多神奇的东西：闪闪发光的星星、五彩斑斓的星云、还有弯弯的月亮。月球上住着一群友好的玉兔，它们带着乐乐参观了月球基地。\n\n玉兔们告诉乐乐，月球上有很多有趣的地方，比如环形山、月海，还有一座用奶酪做成的城堡！乐乐在月球上度过了快乐的一天，和玉兔们一起唱歌、跳舞、讲故事。\n\n天色渐晚，乐乐依依不舍地告别了玉兔们，坐上火箭回到了地球。虽然探险结束了，但乐乐知道，只要心中有梦想，每一天都是新的冒险。晚安，小探险家！',
    duration: 4,
  },
  animal: {
    title: '森林音乐会',
    content:
      '在一片茂密的森林里，住着许多可爱的小动物。今天晚上，它们要举办一场特别的音乐会！\n\n小熊担任指挥，小兔子拉起了小提琴，小松鼠敲起了木琴，小鸟站在树枝上欢快地歌唱。森林里的每一个角落都充满了美妙的音乐。\n\n小刺猬也想来参加音乐会，可是它身上的刺总是不小心碰到乐器，发出刺耳的声音。小刺猬很难过，觉得自己什么都做不好。\n\n这时，聪明的小兔子想到了一个好主意。它让小刺猬用身上的刺敲打击乐器，没想到声音竟然特别好听！小刺猬开心极了，原来每个人都有自己独特的才能。\n\n音乐会一直持续到月亮升起。小动物们手拉着手，一起唱着晚安的歌曲。森林里安静下来，小动物们带着甜甜的微笑进入了梦乡。',
    duration: 4,
  },
  magic: {
    title: '魔法花园',
    content:
      '在一座古老的城堡后面，有一个神秘的魔法花园。花园里种满了会发光的花朵，每一朵花都是一个小精灵的家。\n\n有一天，小女孩莉莉无意中发现了这个花园。小精灵们热情地欢迎她，带她参观了花园里的每一个角落。她们一起在彩虹桥上跳舞，在水晶湖边唱歌，还品尝了用月光做成的蛋糕。\n\n夜幕降临，小精灵们送给莉莉一颗发光的种子，并告诉她："只要你用心呵护它，它就会长出世界上最美的花。"\n\n莉莉把种子带回了家，每天都细心地浇水、施肥。不久，种子发芽了，长出了一朵美丽的花朵，花瓣上闪烁着星星的光芒。\n\n从此以后，每当莉莉想念小精灵们的时候，她就会看看窗外的魔法花，心里感到温暖又幸福。晚安，魔法花园里的小精灵们！',
    duration: 5,
  },
};

function pickFallbackStory(theme: string, protagonist: string): StoryGenerateResult {
  const t = theme || '';
  let picked = FALLBACK_STORIES.default;
  if (/太空|space|星星|star|月亮|moon|宇航/i.test(t)) picked = FALLBACK_STORIES.space;
  else if (/动物|animal|森林|forest|小熊|兔子|小猫/i.test(t)) picked = FALLBACK_STORIES.animal;
  else if (/魔法|magic|精灵|fairy|仙子|城堡/i.test(t)) picked = FALLBACK_STORIES.magic;

  let content = picked.content;
  if (protagonist && protagonist.trim()) {
    content = content.replace(/小兔子|乐乐|莉莉/g, protagonist.trim());
  }

  return {
    title: protagonist ? `${protagonist}的${picked.title}` : picked.title,
    content,
    duration: picked.duration,
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
    sensitiveWords,
  } = params;

  const isZh = language === 'zh';

  // 额度保护
  const allowed = await consumeQuota('story');
  if (!allowed) {
    console.warn('[ai] 今日故事生成额度已用完，使用内置故事');
    return pickFallbackStory(theme, protagonist);
  }

  const langName = isZh ? '简体中文' : 'English';
  const lengthRule = isZh
    ? '正文字数 900-1200 个汉字，绝对不少于 800 字（这个长度要求必须严格满足）'
    : 'about 600-800 English words, and NEVER fewer than 500 words (this is a strict requirement)';

  const avoidRule =
    sensitiveWords && sensitiveWords.length > 0
      ? `\n严禁出现以下内容或词汇：${sensitiveWords.join('、')}。`
      : '';

  const system = [
    '你是一位专业的儿童睡前故事作家，为 3-8 岁儿童创作温馨的睡前故事。',
    `【语言要求】必须全部使用${langName}输出，不得混用其他语言。`,
    '【内容要求】',
    `- ${lengthRule}，分成 5-8 个自然段，段落之间用空行分隔。`,
    '- 情节简单温暖、有画面感，节奏舒缓，越往后越安静。',
    '- 结尾必须是安宁、助眠的收束，例如"晚安""做个好梦"。',
    '- 不得出现暴力、恐怖、惊吓、死亡、争吵、负面情绪描写。',
    '- 不得出现任何真实品牌、真实人名、网址或联系方式。',
    avoidRule,
    '【输出格式】只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要前后缀文字：',
    '{"title": "故事标题", "content": "故事正文"}',
    '其中 content 内的换行请使用 \\n 表示（两个换行表示分段）。',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `请创作一个睡前故事：`,
    `主题：${theme || '温馨的睡前时光'}`,
    protagonist ? `主角：${protagonist}` : '',
    details ? `需要包含的细节：${details}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await chat(system, user, 0.8);
    if (!raw) throw new Error('empty response');

    const parsed = extractJson(raw);

    if (parsed?.content) {
      const content = String(parsed.content).trim();
      const title = String(parsed.title || '').trim() || theme || '晚安故事';
      return {
        title,
        content,
        duration: estimateDuration(content, language),
      };
    }

    // JSON 解析失败但拿到了文本 —— 直接当正文用
    const plain = stripCodeFence(raw);
    if (plain.length > 40) {
      const title = plain.split(/\r?\n/)[0].replace(/^#+\s*/, '').slice(0, 30);
      return {
        title: title || theme || '晚安故事',
        content: plain,
        duration: estimateDuration(plain, language),
      };
    }

    throw new Error('unparsable response');
  } catch (err: any) {
    console.warn('[ai] generateStory failed, using fallback:', err?.message ?? err);
    return pickFallbackStory(theme, protagonist);
  }
}

/**
 * 故事问答。
 * @param context  故事正文
 * @param question 孩子提出的问题
 */
export async function askQuestion(context: string, question: string): Promise<string> {
  if (!question?.trim()) {
    return '你想问什么呢？';
  }

  const allowed = await consumeQuota('qa');
  if (!allowed) {
    return '今天的问题有点多啦，我们明天再聊好不好？先乖乖睡觉吧～';
  }

  const system = [
    '你是儿童故事助手"小浣熊"，正在陪 3-8 岁的孩子听完睡前故事后聊天。',
    '【回答要求】',
    '- 使用与孩子提问相同的语言，简洁温柔，2-4 句话，总长度不超过 80 字。',
    '- 只围绕故事内容回答；故事里没提到的，就温柔地说不知道，不要编造。',
    '- 语气亲切，可以用简单的比喻。不得出现恐怖、暴力内容。',
    '- 不要提及你是 AI、模型或程序。',
    '',
    `【故事内容】\n${(context || '（暂无故事内容）').slice(0, 3000)}`,
  ].join('\n');

  try {
    const answer = await chat(system, question.trim(), 0.7);
    return answer || '嗯，这个问题我还不太清楚呢～';
  } catch (err: any) {
    console.warn('[ai] askQuestion failed:', err?.message ?? err);
    return '嗯，这个问题我还不太清楚呢～';
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

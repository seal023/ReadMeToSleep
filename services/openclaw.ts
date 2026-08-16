import axios from 'axios';
import { GenerateStoryParams, StoryGenerateResult } from '../types';

const CONFIG = {
  baseUrl: 'http://127.0.0.1:18789/api/v1',
  token: '',
  model: 'bailian/deepseek-v4-flash',
};

const api = axios.create({
  baseURL: CONFIG.baseUrl,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${CONFIG.token}`,
  },
  timeout: 30000,
});

export function setToken(token: string) {
  CONFIG.token = token;
  api.defaults.headers.Authorization = `Bearer ${token}`;
}

const MOCK_STORIES: Record<string, { title: string; content: string; duration: number }> = {
  default: {
    title: '星星的秘密',
    content: '在遥远的夜空中，住着一颗小小的星星，它的名字叫亮亮。亮亮每天晚上都努力地闪烁着，希望能给地上的小朋友们带来光明。\n\n有一天晚上，亮亮发现自己的光芒变得越来越弱了。它非常着急，不知道该怎么办。这时，月亮姐姐温柔地对它说："别担心，小星星，你只是太累了。每一颗星星都需要休息，就像小朋友们需要睡觉一样。"\n\n亮亮听了月亮姐姐的话，慢慢地闭上了眼睛。它做了一个甜甜的梦，梦见自己变成了一只萤火虫，在花丛中快乐地飞舞。梦里有好多可爱的小动物，小兔子、小熊、小松鼠，它们围在一起听它讲故事。\n\n第二天早上，亮亮醒来的时候，发现自己又变得闪闪发光了！它开心地向月亮姐姐道谢，然后继续在夜空中守护着大地。\n\n小朋友们，每一颗星星都有自己的秘密。当你看到星星闪烁的时候，也许它正在对你眨眼睛说晚安呢。好好睡觉，做一个甜甜的梦吧。',
    duration: 3,
  },
  space: {
    title: '太空探险',
    content: '小兔子乐乐一直梦想着能去太空探险。有一天，它收到了一封来自太空的信，邀请它去月球做客！\n\n乐乐穿上了特制的太空服，坐上了一艘闪亮的火箭。火箭嗖的一声冲上了天空，穿过了厚厚的云层，来到了神秘的太空。\n\n在太空中，乐乐看到了好多神奇的东西：闪闪发光的星星、五彩斑斓的星云、还有弯弯的月亮。月球上住着一群友好的玉兔，它们带着乐乐参观了月球基地。\n\n玉兔们告诉乐乐，月球上有很多有趣的地方，比如环形山、月海，还有一座用奶酪做成的城堡！乐乐在月球上度过了快乐的一天，和玉兔们一起唱歌、跳舞、讲故事。\n\n天色渐晚，乐乐依依不舍地告别了玉兔们，坐上火箭回到了地球。虽然探险结束了，但乐乐知道，只要心中有梦想，每一天都是新的冒险。晚安，小探险家！',
    duration: 4,
  },
  animal: {
    title: '森林音乐会',
    content: '在一片茂密的森林里，住着许多可爱的小动物。今天晚上，它们要举办一场特别的音乐会！\n\n小熊担任指挥，小兔子拉起了小提琴，小松鼠敲起了木琴，小鸟站在树枝上欢快地歌唱。森林里的每一个角落都充满了美妙的音乐。\n\n小刺猬也想来参加音乐会，可是它身上的刺总是不小心碰到乐器，发出刺耳的声音。小刺猬很难过，觉得自己什么都做不好。\n\n这时，聪明的小兔子想到了一个好主意。它让小刺猬用身上的刺敲打击乐器，没想到声音竟然特别好听！小刺猬开心极了，原来每个人都有自己独特的才能。\n\n音乐会一直持续到月亮升起。小动物们手拉着手，一起唱着晚安的歌曲。森林里安静下来，小动物们带着甜甜的微笑进入了梦乡。',
    duration: 4,
  },
  magic: {
    title: '魔法花园',
    content: '在一座古老的城堡后面，有一个神秘的魔法花园。花园里种满了会发光的花朵，每一朵花都是一个小精灵的家。\n\n有一天，小女孩莉莉无意中发现了这个花园。小精灵们热情地欢迎她，带她参观了花园里的每一个角落。她们一起在彩虹桥上跳舞，在水晶湖边唱歌，还品尝了用月光做成的蛋糕。\n\n夜幕降临，小精灵们送给莉莉一颗发光的种子，并告诉她："只要你用心呵护它，它就会长出世界上最美的花。"\n\n莉莉把种子带回了家，每天都细心地浇水、施肥。不久，种子发芽了，长出了一朵美丽的花朵，花瓣上闪烁着星星的光芒。\n\n从此以后，每当莉莉想念小精灵们的时候，她就会看看窗外的魔法花，心里感到温暖又幸福。晚安，魔法花园里的小精灵们！',
    duration: 5,
  },
};

function getMockStory(theme: string): { title: string; content: string; duration: number } {
  if (theme.includes('太空') || theme.includes('space') || theme.includes('星星') || theme.includes('moon')) {
    return MOCK_STORIES.space;
  }
  if (theme.includes('动物') || theme.includes('animal') || theme.includes('森林') || theme.includes('forest')) {
    return MOCK_STORIES.animal;
  }
  if (theme.includes('魔法') || theme.includes('magic') || theme.includes('精灵') || theme.includes('fairy')) {
    return MOCK_STORIES.magic;
  }
  return MOCK_STORIES.default;
}

export async function generateStory(params: GenerateStoryParams): Promise<StoryGenerateResult> {
  const { theme, protagonist, details, language } = params;
  const langHint = language === 'zh' ? '中文' : 'English';

  let systemPrompt = `你是一位专业的儿童睡前故事作家。请根据以下信息生成一个温馨的睡前故事。
语言：${langHint}
主题：${theme}
主角：${protagonist}
细节：${details}
要求：故事温馨有趣，适合3-8岁儿童，结尾安宁，有助于入睡。
请直接输出 JSON 格式：{ "title": "故事标题", "content": "故事正文" }，不要附加其他内容。`;

  try {
    const res = await api.post('/chat/completions', {
      model: CONFIG.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请生成一个关于"${theme}"的睡前故事。` },
      ],
      temperature: 0.8,
    });

    const raw = res.data.choices?.[0]?.message?.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid response format');

    const parsed = JSON.parse(jsonMatch[0]);
    const content = parsed.content || '';
    const charCount = content.length;
    const duration = language === 'zh'
      ? Math.ceil(charCount / 200)
      : Math.ceil(content.split(/\s+/).length / 150);

    return {
      title: parsed.title || theme,
      content,
      duration: Math.max(duration, 1),
    };
  } catch (err: any) {
    console.warn('API call failed, using mock data:', err.message);
    const mock = getMockStory(theme);
    let content = mock.content;
    if (protagonist) {
      content = content.replace(/小兔子/g, protagonist).replace(/乐乐/g, protagonist);
    }
    return {
      title: `${protagonist ? protagonist + '的' : ''}${mock.title}`,
      content,
      duration: mock.duration,
    };
  }
}

export async function askQuestion(context: string, question: string): Promise<string> {
  try {
    const res = await api.post('/chat/completions', {
      model: CONFIG.model,
      messages: [
        { role: 'system', content: `你是一个儿童故事助手。根据以下故事内容回答孩子的问题。\n\n故事内容：${context}` },
        { role: 'user', content: question },
      ],
      temperature: 0.7,
    });
    return res.data.choices?.[0]?.message?.content || '抱歉，我无法回答这个问题。';
  } catch (err: any) {
    console.error('askQuestion error:', err);
    return '出错了，请稍后再试';
  }
}

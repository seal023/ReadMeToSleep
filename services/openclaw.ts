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
});

export function setToken(token: string) {
  CONFIG.token = token;
  api.defaults.headers.Authorization = `Bearer ${token}`;
}

export async function generateStory(params: GenerateStoryParams): Promise<StoryGenerateResult> {
  const { theme, protagonist, details, language, sensitiveWords } = params;
  const langHint = language === 'zh' ? '中文' : 'English';

  let systemPrompt = `你是一位专业的儿童睡前故事作家。请根据以下信息生成一个温馨的睡前故事。
语言：${langHint}
主题：${theme}
主角：${protagonist}
细节：${details}
要求：故事温馨有趣，适合3-8岁儿童，结尾安宁，有助于入睡。
请直接输出 JSON 格式：{ "title": "故事标题", "content": "故事正文" }，不要附加其他内容。`;

  if (sensitiveWords && sensitiveWords.length > 0) {
    systemPrompt += `\n重要：故事中绝对不能出现以下词汇或短语：${sensitiveWords.join('、')}。请用温和的替代表达。`;
  }

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
    console.error('generateStory error:', err);
    throw new Error('故事生成失败，请稍后再试');
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

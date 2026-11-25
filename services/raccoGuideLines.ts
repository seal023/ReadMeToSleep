/**
 * 小浣熊向导 · 40 句引导语文案表（中英双语）
 * ---------------------------------------------------------------------------
 * 与 raccoGuideAudio.ts 的音频一一对应（相同 key）。
 * 文案用于气泡显示；音频用于发音。二者在 useRaccoGuide 里同步触发。
 *
 * 注意：预生成音频里含 {name} 的句子已改写为通用称呼（"宝贝"/"sweetheart"），
 * 所以这里的气泡文案也保持一致，不显示具体昵称——避免"听到的"和"看到的"不一致。
 */
import { getRuntimeLanguage } from './i18n';

type Lang = 'zh' | 'en';
const LINES: Record<string, { zh: string; en: string }> = {
  a1: { zh: '宝贝，你来啦！今天想听什么故事？', en: "Sweetheart, you're here! What story shall we hear today?" },
  a2: { zh: '嗨宝贝，小浣熊等你好久啦！', en: "Hi, sweetheart! I've been waiting for you!" },
  a3: { zh: '快挑一个喜欢的故事吧！', en: 'Pick a story you like!' },
  a4: { zh: '我准备好了，你呢？', en: "I'm ready. How about you?" },
  a5: { zh: '想听星星的，还是小动物的？', en: 'Stars or little animals, which one?' },
  a6: { zh: '昨晚那个故事，还念念不忘吗？', en: "Still thinking about last night's story?" },
  a7: { zh: '小小探险家，欢迎回来！', en: 'Welcome back, little explorer!' },
  a8: { zh: '点一下，故事就开始咯！', en: 'Tap once, and the story begins!' },
  b1: { zh: '这里有好多故事，慢慢挑。', en: 'So many stories here, take your time.' },
  b2: { zh: '想要短的，还是长一点的？', en: 'Something short, or a longer one?' },
  b3: { zh: '嗯，让我想想你喜欢什么。', en: "Hmm, let me think what you'd like." },
  b4: { zh: '没找到呀，换个词试试？', en: 'Nothing found, try another word?' },
  b5: { zh: '这本很棒，我给它盖个章！', en: "This one's great, I'll stamp it!" },
  b6: { zh: '找到啦！快打开看看！', en: 'Found it! Go on, open it!' },
  c1: { zh: '自己编故事？好酷！', en: 'Make your own story? So cool!' },
  c2: { zh: '告诉我主角是谁，我来帮忙！', en: "Tell me the hero, and I'll help!" },
  c3: { zh: '我在认真想哦，等一下下。', en: "I'm thinking hard, just a tick." },
  c4: { zh: '灵感正在飞过来。', en: 'Ideas are flying over.' },
  c5: { zh: '哇！你的故事做好啦！', en: 'Wow! Your story is ready!' },
  c6: { zh: '再试一次，这次一定行！', en: "Let's try again, this time for sure!" },
  c7: { zh: '讲个什么主题呢？小兔子？恐龙？', en: "What's it about, bunny or dinosaur?" },
  d1: { zh: '这些都是你自己的故事哦！', en: 'These are all your very own stories!' },
  d2: { zh: '还有一枚徽章没拿到，加油！', en: 'One more badge to go, you can do it!' },
  d3: { zh: '哇，你的奖杯墙好厉害！', en: 'Wow, your trophy wall is amazing!' },
  d4: { zh: '这里还空空的，去写一个吧！', en: "It's empty here, let's write one!" },
  d5: { zh: '每听一个故事，就多一点勇敢！', en: 'Every story makes you a little braver!' },
  e1: { zh: '轮到你讲啦，我听着呢！', en: "Your turn to tell, I'm listening!" },
  e2: { zh: '对着小话筒，慢慢说。', en: 'Speak into the little mic, nice and slow.' },
  e3: { zh: '我在认真听哦，别害羞！', en: "I'm all ears, don't be shy!" },
  e4: { zh: '录好啦！你的声音真好听！', en: 'Got it! Your voice sounds lovely!' },
  e5: { zh: '再录一遍？没关系的。', en: 'Record again? No worries at all.' },
  f1: { zh: '我们去过的地方，都记得哦！', en: "I remember everywhere we've been!" },
  f2: { zh: '你在哪儿呀？我来找找看！', en: 'Where are you? Let me find out!' },
  f3: { zh: '这个地方，有个好玩的故事！', en: 'This place has a fun story!' },
  f4: { zh: '打卡成功，又多了一段回忆！', en: 'Checked in, one more memory!' },
  g1: { zh: '好啦，躺好，故事开始了。', en: 'Okay, lie down. The story begins.' },
  g2: { zh: '闭上眼睛，慢慢听。', en: 'Close your eyes and listen.' },
  g3: { zh: '我也困了，陪你一起睡。', en: "I'm sleepy too, I'll sleep with you." },
  g4: { zh: '故事讲完咯，做个好梦。', en: "The story's done. Sweet dreams." },
  g5: { zh: '晚安，宝贝，明天见。', en: 'Goodnight, sweetheart. See you tomorrow.' },
};

/** 取某句引导语在当前界面语言的文案 */
export function getRaccoGuideLine(key: string, lang?: Lang): string {
  const entry = LINES[key];
  if (!entry) return '';
  const l = lang ?? getRuntimeLanguage();
  return entry[l] || entry.zh;
}

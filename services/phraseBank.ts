import type { Language } from '../types';

/**
 * 「俏皮短句」素材库（克隆声随机取用 + 预热缓存）
 * ---------------------------------------------------------------------------
 * 用途：把原来每处都固定的提示音（答对啦 / 让我想一想 / 我听到啦…）换成
 * 一个分类词库，运行时从对应分类里随机挑一句——孩子每次听到的反馈都不一样，
 * 更俏皮、更有人情味，而不是机器人式重复。
 *
 * 成本：这些全部是短文本（几十字以内）。克隆声「首次合成一次 + 本地缓存」，
 * 之后命中缓存零 token、秒出；预热在克隆成功 / App 启动时静默进行。
 * 文本本身几乎不占内存，缓存音频也只是几十个几百字节的小 mp3。
 *
 * 关键约束：预热文本必须与运行时播报的字符串「逐字一致」（缓存 key = 文本 hash），
 * 所以运行时一律通过 pickPhrase() 取值，预热也走同一份数据，绝不在两处硬编码文本。
 */

export type PhraseCategory =
  | 'thinking' // 孩子提问后：「让我想一想」
  | 'correct' // 答对：「答对啦」
  | 'wrong' // 答错：「再想想」
  | 'voiceTooShort' // 录音太短：「没听清」
  | 'voiceHeard' // 录音成功：「我听到啦」
  | 'guide' // 首页语音引导
  | 'round1' // 问答第一回合引导
  | 'round2' // 问答第二回合引导
  | 'done'; // 故事讲完

export const PHRASE_BANK: Record<PhraseCategory, { zh: string[]; en: string[] }> = {
  thinking: {
    zh: [
      '让我想一想哦～',
      '嗯…我琢磨琢磨～',
      '稍等，我猜猜看～',
      '我动动小脑筋想想～',
      '嘘…我正在想办法～',
      '别急，我想一想呀～',
    ],
    en: [
      'Let me think...',
      'Hmm, let me see...',
      'Wait, I’m guessing...',
      'Let me use my little brain...',
      'Shh... I’m figuring it out...',
      'Don’t rush, let me think...',
    ],
  },
  correct: {
    zh: [
      '答对啦！你真棒！',
      '哇，答对咯！',
      '太厉害了，答对了！',
      '聪明的小脑袋，答对啦！',
      '答对啦，给你鼓个掌！',
      '完全正确，你真行！',
    ],
    en: [
      'Correct! You’re amazing!',
      'Wow, that’s right!',
      'So smart, you got it!',
      'Clever you, that’s correct!',
      'Right answer, a big clap for you!',
      'Perfect, you did it!',
    ],
  },
  wrong: {
    zh: [
      '再想想看呀～',
      '差一点点哦，再试一次～',
      '没关系，再想一想～',
      '嗯…好像不太对，再来～',
      '别灰心，再想想～',
      '快接近啦，再试一次～',
    ],
    en: [
      'Think again~',
      'So close, try once more~',
      'It’s okay, give it another thought~',
      'Hmm, not quite, try again~',
      'Don’t give up, think again~',
      'Almost there, one more try~',
    ],
  },
  voiceTooShort: {
    zh: [
      '没听清呢，再说长一点好不好～',
      '呀，太短啦，多说几句嘛～',
      '我还没听够呢，再说一句～',
      '没关系的，慢慢说长一点～',
      '声音太小啦，再说一次哦～',
    ],
    en: [
      'I didn’t catch that, say a bit more~',
      'Oops, too short, tell me more~',
      'I want to hear more, one more time~',
      'It’s okay, take your time and say more~',
      'Too quiet, say it again~',
    ],
  },
  voiceHeard: {
    zh: [
      '我听到你啦！',
      '听见咯，你说得好清楚～',
      '哎呀，我听到啦！',
      '收到你的声音啦～',
      '嗯嗯，我听见你说话了～',
    ],
    en: [
      'I heard you!',
      'Got it, you spoke so clearly~',
      'Oh, I heard you!',
      'I received your voice~',
      'Mmm, I hear you talking~',
    ],
  },
  guide: {
    zh: [
      '想听故事啦？点上面的故事就好～',
      '想听故事，就点一个喜欢的吧～',
      '今晚想听什么故事呀？挑一个吧～',
      '小手指点一点，故事就来啦～',
      '想听故事，选一个开始吧～',
    ],
    en: [
      'Want a story? Just tap one above~',
      'Pick a story you like to begin~',
      'What story shall we hear tonight? Choose one~',
      'Tap with your little finger and the story comes~',
      'Want a story? Choose one to start~',
    ],
  },
  round1: {
    zh: [
      '我们来玩问答小游戏吧！听清楚问题，选一个你喜欢的答案～',
      '问答时间到！听好问题，挑一个你喜欢的答案哦～',
      '来玩问答吧！仔细听问题，选一个答案就好～',
    ],
    en: [
      'Let’s play a question game! Listen to the question and pick an answer you like~',
      'Question time! Hear the question and choose an answer you like~',
      'Let’s do Q&A! Listen carefully and pick any answer~',
    ],
  },
  round2: {
    zh: [
      '现在轮到你啦！按住小话筒，把你的问题说出来。听完我的回答，想再问一个就点下面的圆圈按钮，都说完就点完成哦～',
      '该你提问咯！按住话筒说出你的问题，听完回答后想继续就点圆圈，结束就点完成～',
      '轮到你问啦！按住小话筒说说你的疑问，答完还想问就点圆圈，好了就点完成～',
    ],
    en: [
      'Now it’s your turn! Hold the mic and tell me your question. After I answer, tap the round button to ask another, or tap finish when done~',
      'Your turn to ask! Hold the mic, say your question, then tap the circle to continue or finish when ready~',
      'It’s your turn! Press the mic and ask, then tap the circle to keep going or finish~',
    ],
  },
  done: {
    zh: [
      '故事讲完啦，你今天真棒！',
      '好啦，故事说完咯，乖乖睡吧～',
      '故事结束啦，做个甜甜的梦哦～',
      '讲完啦，今天辛苦啦，晚安～',
      '故事讲完咯，闭上眼睛睡觉觉吧～',
    ],
    en: [
      'The story is done, you were great today!',
      'All done, now sleep tight~',
      'Story’s over, sweet dreams~',
      'That’s the end, good job today, goodnight~',
      'Story finished, close your eyes and sleep~',
    ],
  },
};

/** 从某分类随机取一句（运行时播报用，保证与预热同源） */
export function pickPhrase(cat: PhraseCategory, lang: Language): string {
  const arr = PHRASE_BANK[cat]?.[lang] ?? PHRASE_BANK[cat]?.zh ?? [];
  if (!arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 列出全部短句（含语言），供预热缓存一次性合成 */
export function allBankPhrases(): { text: string; lang: Language }[] {
  const out: { text: string; lang: Language }[] = [];
  (Object.keys(PHRASE_BANK) as PhraseCategory[]).forEach((cat) => {
    PHRASE_BANK[cat].zh.forEach((t) => out.push({ text: t, lang: 'zh' }));
    PHRASE_BANK[cat].en.forEach((t) => out.push({ text: t, lang: 'en' }));
  });
  return out;
}

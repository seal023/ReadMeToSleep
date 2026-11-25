/**
 * 小浣熊序列帧动画资源表
 * ---------------------------------------------------------------------------
 * 6 种动作 × 12 帧透明 PNG（256x256），由 AI 视频抽帧抠图生成。
 * Metro 要求 require 用字面量，故逐条列出，不可动态拼接。
 */
export type RaccoAnim = 'none' | 'wave' | 'walk' | 'think' | 'happy' | 'listen' | 'sleep';

const FRAMES: Record<Exclude<RaccoAnim, 'none'>, any[]> = {
  wave: [
    require('../assets/racco_anim/wave_01.png'),
    require('../assets/racco_anim/wave_02.png'),
    require('../assets/racco_anim/wave_03.png'),
    require('../assets/racco_anim/wave_04.png'),
    require('../assets/racco_anim/wave_05.png'),
    require('../assets/racco_anim/wave_06.png'),
    require('../assets/racco_anim/wave_07.png'),
    require('../assets/racco_anim/wave_08.png'),
    require('../assets/racco_anim/wave_09.png'),
    require('../assets/racco_anim/wave_10.png'),
    require('../assets/racco_anim/wave_11.png'),
    require('../assets/racco_anim/wave_12.png'),
  ],
  walk: [
    require('../assets/racco_anim/walk_01.png'),
    require('../assets/racco_anim/walk_02.png'),
    require('../assets/racco_anim/walk_03.png'),
    require('../assets/racco_anim/walk_04.png'),
    require('../assets/racco_anim/walk_05.png'),
    require('../assets/racco_anim/walk_06.png'),
    require('../assets/racco_anim/walk_07.png'),
    require('../assets/racco_anim/walk_08.png'),
    require('../assets/racco_anim/walk_09.png'),
    require('../assets/racco_anim/walk_10.png'),
    require('../assets/racco_anim/walk_11.png'),
    require('../assets/racco_anim/walk_12.png'),
  ],
  think: [
    require('../assets/racco_anim/think_01.png'),
    require('../assets/racco_anim/think_02.png'),
    require('../assets/racco_anim/think_03.png'),
    require('../assets/racco_anim/think_04.png'),
    require('../assets/racco_anim/think_05.png'),
    require('../assets/racco_anim/think_06.png'),
    require('../assets/racco_anim/think_07.png'),
    require('../assets/racco_anim/think_08.png'),
    require('../assets/racco_anim/think_09.png'),
    require('../assets/racco_anim/think_10.png'),
    require('../assets/racco_anim/think_11.png'),
    require('../assets/racco_anim/think_12.png'),
  ],
  happy: [
    require('../assets/racco_anim/happy_01.png'),
    require('../assets/racco_anim/happy_02.png'),
    require('../assets/racco_anim/happy_03.png'),
    require('../assets/racco_anim/happy_04.png'),
    require('../assets/racco_anim/happy_05.png'),
    require('../assets/racco_anim/happy_06.png'),
    require('../assets/racco_anim/happy_07.png'),
    require('../assets/racco_anim/happy_08.png'),
    require('../assets/racco_anim/happy_09.png'),
    require('../assets/racco_anim/happy_10.png'),
    require('../assets/racco_anim/happy_11.png'),
    require('../assets/racco_anim/happy_12.png'),
  ],
  listen: [
    require('../assets/racco_anim/listen_01.png'),
    require('../assets/racco_anim/listen_02.png'),
    require('../assets/racco_anim/listen_03.png'),
    require('../assets/racco_anim/listen_04.png'),
    require('../assets/racco_anim/listen_05.png'),
    require('../assets/racco_anim/listen_06.png'),
    require('../assets/racco_anim/listen_07.png'),
    require('../assets/racco_anim/listen_08.png'),
    require('../assets/racco_anim/listen_09.png'),
    require('../assets/racco_anim/listen_10.png'),
    require('../assets/racco_anim/listen_11.png'),
    require('../assets/racco_anim/listen_12.png'),
  ],
  sleep: [
    require('../assets/racco_anim/sleep_01.png'),
    require('../assets/racco_anim/sleep_02.png'),
    require('../assets/racco_anim/sleep_03.png'),
    require('../assets/racco_anim/sleep_04.png'),
    require('../assets/racco_anim/sleep_05.png'),
    require('../assets/racco_anim/sleep_06.png'),
    require('../assets/racco_anim/sleep_07.png'),
    require('../assets/racco_anim/sleep_08.png'),
    require('../assets/racco_anim/sleep_09.png'),
    require('../assets/racco_anim/sleep_10.png'),
    require('../assets/racco_anim/sleep_11.png'),
    require('../assets/racco_anim/sleep_12.png'),
  ],
};

/** 取某动作的序列帧数组；none/未知返回 null */
export function getRaccoAnimFrames(anim: RaccoAnim): any[] | null {
  if (anim === 'none') return null;
  return FRAMES[anim] ?? null;
}

export const RACCO_ANIM_FPS = 12; // 每帧约 83ms，一个循环 1 秒

/**
 * 语音 key → 动画动作映射（40 句引导语按语义分配）。
 * 说话时播放对应动作，动画循环到语音结束，做到声画同步不错位。
 * a 组=首页欢迎/挑故事、b=故事库、c=创作、d=我的故事、e=录音、f=旅行、g=睡觉。
 */
const KEY_ANIM: Record<string, RaccoAnim> = {
  // a 组：欢迎、邀请挑故事 → 挥手打招呼
  a1: 'wave', a2: 'wave', a3: 'wave', a4: 'wave', a5: 'wave', a6: 'wave', a7: 'wave', a8: 'wave',
  // b 组：故事库
  b1: 'wave',   // 这里好多故事慢慢挑
  b2: 'think',  // 想短的还是长的
  b3: 'think',  // 让我想想
  b4: 'think',  // 没找到换词
  b5: 'happy',  // 盖章
  b6: 'happy',  // 找到啦
  // c 组：创作
  c1: 'wave',   // 自己编故事好酷
  c2: 'listen', // 告诉我主角
  c3: 'think',  // 认真想
  c4: 'think',  // 灵感飞过来
  c5: 'happy',  // 做好啦
  c6: 'wave',   // 再试一次
  c7: 'think',  // 什么主题
  // d 组：我的故事
  d1: 'wave',   // 都是你自己的
  d2: 'happy',  // 还差一枚徽章
  d3: 'happy',  // 奖杯墙厉害
  d4: 'wave',   // 空空的去写一个
  d5: 'happy',  // 更勇敢
  // e 组：录音
  e1: 'listen', // 轮到你讲我听着
  e2: 'listen', // 对着话筒慢慢说
  e3: 'listen', // 认真听别害羞
  e4: 'happy',  // 录好啦
  e5: 'wave',   // 再录一遍没关系
  // f 组：旅行打卡
  f1: 'wave',   // 都记得
  f2: 'think',  // 我来找找看
  f3: 'happy',  // 有个好玩故事
  f4: 'happy',  // 打卡成功
  // g 组：睡觉/播放结束
  g1: 'sleep', g2: 'sleep', g3: 'sleep', g4: 'sleep', g5: 'sleep',
};

/** 取某句语音对应的动画动作；未映射返回 none */
export function getRaccoAnimForKey(key: string): RaccoAnim {
  return KEY_ANIM[key] ?? 'none';
}

/** 进场专用动画：从边缘进场时播走路（站姿）；不对应任何语音 key */
export const RACCO_ENTER_ANIM: RaccoAnim = 'walk';

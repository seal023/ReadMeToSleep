/**
 * 小浣熊向导 hook
 * ---------------------------------------------------------------------------
 * 把「气泡文案 + 发音 + 浣熊动作」打包成一行接入。
 *
 * 用法：
 *   const guide = useRaccoGuide({ autoKey: 'b1', autoDelay: 600 });
 *   // guide.line       当前气泡文案（'' = 不显示）
 *   // guide.state      浣熊 state
 *   // guide.gesture    一次性手势
 *   // guide.enterFrom  进场方向
 *   // guide.say('b6')  手动触发（按钮/空状态等）
 *   // guide.clear()    清空气泡
 *
 * 设计：
 *  - autoKey：进页面（mount）后延时播一句 + 显示气泡，延时用于让每日问候先说完。
 *  - 发音走 services/raccoGuide（独立 player，故事在播时自动让路）。
 *  - 气泡显示时长 = 音频估计时长（按字数），到点自动收起，state 回 idle。
 *  - 卸载时停止发音、清定时器，绝不把声音带出页面。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { speakGuideLine, stopRaccoGuide } from '../services/raccoGuide';
import { getRaccoGuideLine } from '../services/raccoGuideLines';
import { getRaccoAnimForKey, type RaccoAnim } from '../services/raccoAnim';
import type { RaccoEnter, RaccoGesture } from '../components/common/Racco';
import type { RaccoState } from '../types';

interface Options {
  /** 进页面自动播的引导语 key（a1..g5）；不传则不自动播 */
  autoKey?: string;
  /** 自动播的延时毫秒（让每日问候先说完）。默认 900 */
  autoDelay?: number;
  /** 进场方向。默认 bottom */
  enterFrom?: RaccoEnter;
  /** 自动播时配的手势。默认 wave */
  gesture?: RaccoGesture;
  /** 气泡停留毫秒；不传则按字数估算 */
  bubbleMs?: number;
}

export interface RaccoGuideApi {
  line: string;
  state: RaccoState;
  gesture: RaccoGesture;
  enterFrom: RaccoEnter;
  /** 当前序列帧动作（按语音 key 语义映射），none = 不播动画用静态图 */
  anim: RaccoAnim;
  /** 是否正在播序列帧。说话期间 true，气泡收起后 false（定格第一帧） */
  animPlaying: boolean;
  say: (key: string, opts?: { gesture?: RaccoGesture; force?: boolean }) => void;
  clear: () => void;
}

export function useRaccoGuide(opts: Options = {}): RaccoGuideApi {
  const {
    autoKey,
    autoDelay = 900,
    enterFrom = 'bottom',
    gesture: defaultGesture = 'wave',
    bubbleMs,
  } = opts;

  const [line, setLine] = useState('');
  const [state, setState] = useState<RaccoState>('idle');
  const [gesture, setGesture] = useState<RaccoGesture>('none');
  const [anim, setAnim] = useState<RaccoAnim>('none');
  const [animPlaying, setAnimPlaying] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const clear = useCallback(() => {
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    setLine('');
    setState('idle');
    setGesture('none');
    // 动画回到 idle 动作并继续循环，不保留上一句话的动作定格（否则页面变静态）
    setAnim('none');
    setAnimPlaying(false);
  }, []);

  const say = useCallback((
    key: string,
    o: { gesture?: RaccoGesture; force?: boolean } = {},
  ) => {
    const text = getRaccoGuideLine(key);
    if (!text) return;
    if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
    setLine(text);
    setState('talking');
    setGesture(o.gesture ?? defaultGesture);
    // 按语音语义播对应序列帧动画，从第一帧开始
    setAnim(getRaccoAnimForKey(key));
    setAnimPlaying(true);

    // 发音走统一入口（按向导语音角色选小浣熊声 / 提示音声线），失败也不影响气泡显示
    speakGuideLine(key, { force: o.force }).catch(() => {});

    // 气泡自动收起（按字数估，中文每字约 220ms、英文每字符约 95ms，至少 1.8s）
    const cjk = /[\u4e00-\u9fa5]/.test(text);
    const estimate = cjk ? text.length * 220 : text.length * 95;
    const ms = bubbleMs ?? Math.max(1800, Math.min(7000, estimate));
    clearTimer.current = setTimeout(() => {
      if (!alive.current) return;
      setLine('');
      setState('idle');
      setGesture('none');
      // 语音结束回到 idle 循环挥手，避免定格首帧让页面看起来"没动画"
      setAnim('none');
      setAnimPlaying(false);
    }, ms);
  }, [defaultGesture, bubbleMs]);

  useEffect(() => {
    alive.current = true;
    if (autoKey) {
      autoTimer.current = setTimeout(() => {
        if (alive.current) say(autoKey);
      }, autoDelay);
    }
    return () => {
      alive.current = false;
      if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null; }
      if (clearTimer.current) { clearTimeout(clearTimer.current); clearTimer.current = null; }
      stopRaccoGuide();
    };
  }, [autoKey, autoDelay, say]);

  return { line, state, gesture, enterFrom, anim, animPlaying, say, clear };
}

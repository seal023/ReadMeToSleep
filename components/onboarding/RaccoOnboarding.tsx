/**
 * RaccoOnboarding —— 3 屏新手引导（v1.2.0）
 * ---------------------------------------------------------------------------
 * 设计原则（来自 UI Visual Polish Brief）：
 *  - 只展示价值，不登录、不申请任何权限、不弹订阅。
 *  - 麦克风权限延后到用户真正点「录音」时（见 app/(tabs)/record.tsx）。
 *  - 每屏都有 Skip，完成后写 AsyncStorage hasSeenOnboarding_v1，不再出现。
 *  - 颜色/圆角/间距全部取自设计 token，跟随当前主题，不硬编码 hex。
 *  - 全英文文案（App 不在中国大陆销售）。
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Racco from '../common/Racco';
import type { RaccoState } from '../../types';
import { COLORS } from '../../constants/Colors';
import { RADIUS, SPACING, SHADOW, FONT } from '../../constants/theme';

export const ONBOARDING_KEY = 'hasSeenOnboarding_v1';

/** 引导是否已看完；入口页据此决定是否展示 */
export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === '1';
  } catch {
    return false;
  }
}

async function markOnboardingSeen() {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    /* 存储失败不影响进入 App */
  }
}

interface Slide {
  state: RaccoState;
  speech: string;
  button: string;
}

const SLIDES: Slide[] = [
  {
    state: 'talking',
    speech: 'Let me read your child a story tonight.',
    button: 'Continue',
  },
  {
    state: 'listening',
    speech: 'Record your voice once, and I will read in your voice.',
    button: 'Continue',
  },
  {
    state: 'happy',
    speech: 'Your story is ready. Goodnight.',
    button: 'Get started',
  },
];

interface Props {
  /** 看完或跳过后调用：由父级决定进入 (tabs) */
  onDone: () => void;
}

export default function RaccoOnboarding({ onDone }: Props) {
  const [index, setIndex] = useState(0);
  const { width, height } = useWindowDimensions();
  const compact = height < 520;
  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const finish = async () => {
    await markOnboardingSeen();
    onDone();
  };

  const onPrimary = () => {
    if (isLast) {
      void finish();
    } else {
      setIndex((i) => i + 1);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.card, compact && styles.cardCompact]}>
        <Text style={styles.brand}>Read Me To Sleep</Text>

        <View style={styles.raccoArea}>
          <Racco
            state={slide.state}
            size={compact ? 120 : 180}
            showSpeechBubble
            speechText={slide.speech}
            bubbleColor={COLORS.purple}
          />
        </View>

        {/* 进度点：孩子也能看懂"还剩几屏" */}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={onPrimary} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>{slide.button}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => void finish()} activeOpacity={0.7} hitSlop={12}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.cream,
    padding: SPACING.lg,
  },
  card: {
    width: '100%',
    maxWidth: 560,
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    ...SHADOW.card,
  },
  cardCompact: {
    paddingVertical: SPACING.md,
  },
  brand: {
    fontSize: 22,
    fontFamily: FONT.rounded,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  raccoArea: {
    alignItems: 'center',
    marginVertical: SPACING.lg,
    minHeight: 230,
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.divider,
  },
  dotActive: {
    width: 24,
    backgroundColor: COLORS.purple,
  },
  primaryBtn: {
    backgroundColor: COLORS.orangeDeep,
    borderRadius: RADIUS.pill,
    paddingVertical: 14,
    paddingHorizontal: 56,
    ...SHADOW.button,
  },
  primaryBtnText: {
    fontSize: 18,
    fontFamily: FONT.rounded,
    color: COLORS.onPrimary,
  },
  skipText: {
    fontSize: 15,
    color: COLORS.textSub,
    marginTop: SPACING.md,
    textDecorationLine: 'underline',
  },
});

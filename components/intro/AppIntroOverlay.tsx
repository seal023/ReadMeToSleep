/**
 * 冷启动开场动画（独立全屏层）
 * ---------------------------------------------------------------------------
 * 小浣熊从左侧走进来 → 挥手 → 说开场白，播完关闭露出静态场景首页。
 * 与首页完全分离：首页背景图里的浣熊是静态的，这里的浣熊是动画的，永不同屏，
 * 因此不会出现「一只静态浣熊 + 一只动画浣熊叠在一起」的贴纸感。
 *
 * 时序与原首页版本一致：walk 1.6s → wave + 语音 + 气泡 → 共 5.2s 后 onDone。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useLanguage } from '../../hooks/useLanguage';
import { speakSystemVoice } from '../../services/raccoSystemVoice';
import Racco from '../common/Racco';
import { GradientBackground } from '../ui/Gradient';
import { COLORS, FONT, GRADIENTS } from '../../constants/theme';

type Phase = 'walk' | 'wave';

interface Props {
  visible: boolean;
  onDone: () => void;
}

const WALK_MS = 1600;
const TOTAL_MS = 5200;

export default function AppIntroOverlay({ visible, onDone }: Props) {
  const { t, language } = useLanguage();
  const { width, height } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>('walk');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isWide = width >= 768;
  const raccoSize = isWide ? Math.min(height * 0.52, 300) : Math.min(width * 0.46, 230);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setPhase('walk');
    timers.current.forEach(clearTimeout);
    timers.current = [];

    const speakTimer = setTimeout(() => {
      if (!alive) return;
      setPhase('wave');
      void speakSystemVoice(language, {
        key: 'intro',
        text: t('home.intro'),
        force: true, // 冷启动无故事在播，确保一定出声
      });
    }, WALK_MS);

    const doneTimer = setTimeout(() => {
      if (alive) onDone();
    }, TOTAL_MS);

    timers.current.push(speakTimer, doneTimer);
    return () => {
      alive = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [visible, language, t, onDone]);

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onDone}
    >
      <GradientBackground colors={GRADIENTS.day} decor decorVariant="day" style={styles.flex}>
        {/* 全屏透明热区：家长可点任意处跳过；孩子正常等它自动结束 */}
        <Pressable style={styles.skipHit} onPress={onDone} accessibilityLabel="skip intro">
          <Text style={styles.skipText}>›</Text>
        </Pressable>

        <View style={[styles.stage, isWide && styles.stageWide]} pointerEvents="box-none">
          <View style={styles.raccoSlot}>
            <Racco
              state={phase === 'wave' ? 'happy' : 'talking'}
              size={raccoSize}
              enterFrom={phase === 'walk' ? 'left' : 'none'}
              anim={phase === 'walk' ? 'walk' : 'wave'}
              animPlaying
              flipImage
              showSpeechBubble={phase === 'wave'}
              speechText={phase === 'wave' ? t('home.intro') : ''}
            />
          </View>
          <Text style={styles.hint}>{phase === 'walk' ? '···' : ''}</Text>
        </View>
      </GradientBackground>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  skipHit: {
    position: 'absolute',
    top: 12,
    right: 18,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  skipText: { fontSize: 34, color: COLORS.textLight, fontFamily: FONT.rounded },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageWide: {
    // 横屏时浣熊站在画面偏左，面朝右侧（由 scaleX:-1 翻转实现）
    paddingRight: '22%',
  },
  raccoSlot: {
    alignItems: 'center',
  },
  hint: {
    fontSize: 26,
    color: COLORS.textLight,
    letterSpacing: 6,
    minHeight: 32,
  },
});

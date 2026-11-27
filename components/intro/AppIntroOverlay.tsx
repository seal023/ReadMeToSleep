/**
 * Cold-start intro animation (standalone full-screen layer).
 * ---------------------------------------------------------------------------
 * The raccoon walks in from the left, waves, says the intro line, then closes
 * to reveal the static-scene home screen.
 * Kept fully separate from the home screen: the raccoon baked into the home
 * background is static, this one is animated, and they are never on screen at
 * the same time - no "static raccoon + animated raccoon" sticker overlap.
 *
 * Timing matches the old in-home version: walk 1.6s -> wave + voice + bubble,
 * then onDone at 5.2s total.
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
        force: true, // no story is playing at cold start, always speak
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
        {/* Full-screen transparent hot zone: parents can tap anywhere to skip; kids just wait */}
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
    // In landscape the raccoon sits left of center, facing right (via scaleX:-1)
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

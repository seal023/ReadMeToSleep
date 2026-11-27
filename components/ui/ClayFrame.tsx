/**
 * ClayFrame - cartoon picture frame / window (3D clay look).
 * ===========================================================================
 * Wraps each home "window" in a thick soft-clay frame, like a cartoon picture frame:
 *   1) Clay border - thick rounded edges + inner highlight + outer shadow (CLAY_SHADOW.surface)
 *   2) Recessed glass - the content area sits slightly inside (CLAY_SHADOW.inset)
 *   3) Corner nails - four small clay balls to sell the physical frame (optional)
 *   4) Hanger nail - an optional nail + string for the "hanging frame" look
 *
 * Colors come from the current theme palette, so all four skins stay in sync.
 * Usage:
 *   <ClayFrame tone="peach"><Text>...</Text></ClayFrame>
 *   Wrap in a Pressable/TouchableOpacity if the whole frame must be tappable
 *   (this component does not capture events itself).
 */

import React from 'react';
import {
  View,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { COLORS } from '../../constants/Colors';
import { RADIUS } from '../../constants/theme';
import { CLAY_SHADOW } from '../../constants/clayStyle';

/** Frame palette: semantic name -> theme light tone (frame) / theme main tone (nails) */
export type ClayFrameTone =
  | 'cream' | 'peach' | 'pink' | 'grape'
  | 'mint' | 'sky' | 'lemon';

const FRAME_BG: Record<ClayFrameTone, string> = {
  cream: COLORS.cardSoft,
  peach: COLORS.orangeLight,
  pink: COLORS.pinkLight,
  grape: COLORS.purpleLight,
  mint: COLORS.mintLight,
  sky: COLORS.skyBlueLight,
  lemon: COLORS.yellowLight,
};

const NAIL_COLOR: Record<ClayFrameTone, string> = {
  cream: COLORS.card,
  peach: COLORS.orangeDeep,
  pink: COLORS.pink,
  grape: COLORS.purple,
  mint: COLORS.mint,
  sky: COLORS.skyBlue,
  lemon: COLORS.yellow,
};

export interface ClayFrameProps {
  children: React.ReactNode;
  /** Frame color, defaults to cream */
  tone?: ClayFrameTone;
  /** Four corner clay nails, defaults to true */
  nails?: boolean;
  /** Top hanger nail (hanging-frame look), defaults to false */
  hanger?: boolean;
  /** Outer frame style (margin / height / alignSelf, layout only) */
  style?: StyleProp<ViewStyle>;
  /** Recessed content area style (padding / radius / flex direction, etc.) */
  innerStyle?: StyleProp<ViewStyle>;
  /** Content area background, defaults to warm-white card */
  glassColor?: string;
}

export function ClayFrame({
  children,
  tone = 'cream',
  nails = true,
  hanger = false,
  style,
  innerStyle,
  glassColor,
}: ClayFrameProps) {
  return (
    <View style={[styles.frame, { backgroundColor: FRAME_BG[tone] }, style]}>
      {/* Top hanger nail + string: sells the hanging-frame look */}
      {hanger && (
        <View style={styles.hangerWrap} pointerEvents="none">
          <View style={styles.hangerString} />
          <View style={[styles.hangerNail, { backgroundColor: NAIL_COLOR[tone] }]} />
        </View>
      )}

      {/* Recessed glass: the area that actually holds the content */}
      <View
        style={[
          styles.glass,
          { backgroundColor: glassColor ?? COLORS.card },
          innerStyle,
        ]}
      >
        {children}
      </View>

      {/* Four corner clay nails, sitting on the glass/frame seam */}
      {nails && (
        <View style={styles.nails} pointerEvents="none">
          <View style={[styles.nail, styles.nailTL, { backgroundColor: NAIL_COLOR[tone] }]} />
          <View style={[styles.nail, styles.nailTR, { backgroundColor: NAIL_COLOR[tone] }]} />
          <View style={[styles.nail, styles.nailBL, { backgroundColor: NAIL_COLOR[tone] }]} />
          <View style={[styles.nail, styles.nailBR, { backgroundColor: NAIL_COLOR[tone] }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: RADIUS.xl,
    padding: 8, // clay border thickness
    boxShadow: CLAY_SHADOW.surface,
    elevation: 6,
    position: 'relative',
  },
  glass: {
    borderRadius: RADIUS.lg - 2,
    boxShadow: CLAY_SHADOW.inset,
    overflow: 'hidden',
    flex: 1,
    position: 'relative', // keep absolutely-positioned children inside the glass area
  },
  nails: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Nail layer must not swallow taps meant for the content
  },
  nail: {
    position: 'absolute',
    width: 11,
    height: 11,
    borderRadius: 6,
    // Clay ball: white top highlight + bottom inner shadow + a touch of outer shadow
    boxShadow: CLAY_SHADOW.small,
    elevation: 2,
  },
  nailTL: { top: 3, left: 3 },
  nailTR: { top: 3, right: 3 },
  nailBL: { bottom: 3, left: 3 },
  nailBR: { bottom: 3, right: 3 },
  hangerWrap: {
    position: 'absolute',
    top: -14,
    left: '50%',
    marginLeft: -7,
    width: 14,
    height: 20,
    alignItems: 'center',
    zIndex: 2,
  },
  hangerString: {
    width: 2,
    height: 12,
    backgroundColor: COLORS.textLight,
    opacity: 0.5,
  },
  hangerNail: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: -1,
    boxShadow: CLAY_SHADOW.small,
    elevation: 2,
  },
});

export default ClayFrame;

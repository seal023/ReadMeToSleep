/**
 * ClayFrame —— 卡通相框 / 窗户（3D 泥土质感）
 * ===========================================================================
 * 把首页每一个「窗口」都装进一个厚厚的软陶相框里，像卡通动画里的画框：
 *   ① 泥条外框 —— 厚圆角 + 内高光 + 外投影（CLAY_SHADOW.surface）
 *   ② 内凹玻璃 —— 画面区往里凹（CLAY_SHADOW.inset），像透窗看进去
 *   ③ 四角铆钉 —— 四颗小泥球，强化「相框」的实体感（可关）
 *   ④ 顶部挂钉 —— 可选的一颗挂钉 + 小绳，强化「挂墙相框」的意象
 *
 * 颜色全部走当前主题色盘，糖果/森林/星空/樱花四套皮肤下都协调。
 * 用法：
 *   <ClayFrame tone="peach"><Text>...</Text></ClayFrame>
 *   需要整框点击时套一层 Pressable/TouchableOpacity 即可（组件本身不抢事件）。
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

/** 泥框配色：语义名 → 主题浅色（框体）/ 主题主色（铆钉） */
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
  /** 泥框颜色，默认 cream */
  tone?: ClayFrameTone;
  /** 四角橡皮铆钉，默认 true */
  nails?: boolean;
  /** 顶部挂钉（挂墙相框意象），默认 false */
  hanger?: boolean;
  /** 外框样式（margin / 高度 / alignSelf 等布局用） */
  style?: StyleProp<ViewStyle>;
  /** 内凹画面区样式（padding / 圆角 / flex 方向等） */
  innerStyle?: StyleProp<ViewStyle>;
  /** 画面区底色，默认暖白 card */
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
      {/* 顶部挂钉 + 小绳：强化「挂墙相框」意象 */}
      {hanger && (
        <View style={styles.hangerWrap} pointerEvents="none">
          <View style={styles.hangerString} />
          <View style={[styles.hangerNail, { backgroundColor: NAIL_COLOR[tone] }]} />
        </View>
      )}

      {/* 内凹玻璃：真正承载内容的画面区 */}
      <View
        style={[
          styles.glass,
          { backgroundColor: glassColor ?? COLORS.card },
          innerStyle,
        ]}
      >
        {children}
      </View>

      {/* 四角泥球铆钉，压在玻璃与泥框交界处 */}
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
    padding: 8, // 泥条厚度
    boxShadow: CLAY_SHADOW.surface,
    elevation: 6,
    position: 'relative',
  },
  glass: {
    borderRadius: RADIUS.lg - 2,
    boxShadow: CLAY_SHADOW.inset,
    overflow: 'hidden',
    flex: 1,
    position: 'relative', // 让内部按钮的绝对定位落在画面区里
  },
  nails: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // 让铆钉层不拦截内容点击（各 nail 再单独关）
  },
  nail: {
    position: 'absolute',
    width: 11,
    height: 11,
    borderRadius: 6,
    // 泥球：顶部白高光 + 底部内阴影 + 一点点外投影
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

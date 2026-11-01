/**
 * app/(parent)/theme.tsx — 界面配色（4 套预设主题）
 *
 * 背景：主题色盘早在 v74 就写进了 constants/Colors.ts（candy / forest /
 * starry / sakura 四套），但只有代码常量、界面上没有入口 —— 用户的原话是
 * 「需要有 4 种颜色的设置，但是好像没看见具体的操作地点」。
 * 这个页面就是那个入口。
 *
 * ⚠️ 为什么选了之后要「重新打开 App」才生效：
 *    RN 的 StyleSheet.create 在模块加载时就把颜色固化成样式对象了，
 *    30 多个页面的 styles 都是模块级常量。运行期改 COLORS 不会让已创建的
 *    样式跟着变。设置页把这件事写在明面上，而不是让用户点了没反应还以为坏了。
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT, FONT_SIZE, RADIUS, SPACING, SHADOW } from '../../constants/theme';
import {
  ACTIVE_THEME,
  THEMES,
  THEME_KEYS,
  getSavedThemeKey,
  saveThemeKey,
  type ThemeKey,
} from '../../constants/Colors';

/** 每套主题在卡片上的一句话定位，选的时候更有画面感 */
const THEME_TAGLINE: Record<ThemeKey, string> = {
  candy: '蜜桃 + 草莓，暖白底，最经典的糖果风',
  forest: '薄荷 + 柠檬，极淡草绿，安静清新',
  starry: '天空蓝 + 葡萄紫，极淡星空蓝，睡前也很配',
  sakura: '草莓粉 + 珊瑚红，极淡樱花粉，软软的',
};

export default function ThemeScreen() {
  /** 磁盘上已保存的选择（点一下就更新，用来做「待生效」提示） */
  const [saved, setSaved] = useState<ThemeKey>(() => getSavedThemeKey());
  /** 本次运行正在使用的主题（重启后才会变） */
  const running = ACTIVE_THEME;
  const pendingRestart = saved !== running;

  const pick = (key: ThemeKey) => {
    const ok = saveThemeKey(key);
    if (!ok) {
      Alert.alert('保存失败', '没能写入主题设置，请稍后再试。');
      return;
    }
    setSaved(key);
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>🎨 界面配色</Text>
        <Text style={styles.subtitle}>
          给整个 App 换一套颜色，支持 4 套预设。{'\n'}
          选好后需要<Text style={styles.strong}>重新打开 App</Text>才会全部生效。
        </Text>

        {pendingRestart && (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingTitle}>✅ 已保存：{THEMES[saved].name}</Text>
            <Text style={styles.pendingText}>
              当前正显示的是「{THEMES[running].name}」。{'\n'}
              请上滑关闭 App 后重新打开，新配色就会应用到所有页面。
            </Text>
          </View>
        )}

        {THEME_KEYS.map((key) => {
          const p = THEMES[key];
          const isRunning = key === running;
          const isSaved = key === saved;
          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.85}
              onPress={() => pick(key)}
              style={[styles.card, { backgroundColor: p.bg }, isSaved && styles.cardSelected]}
            >
              {/* 卡片顶部：名称 + 状态角标 */}
              <View style={styles.cardHead}>
                <Text style={[styles.cardName, { color: p.text }]}>{p.name}</Text>
                {isRunning ? (
                  <View style={[styles.badge, { backgroundColor: p.mintSoft, borderColor: p.mint }]}>
                    <Text style={[styles.badgeText, { color: p.text }]}>✓ 使用中</Text>
                  </View>
                ) : isSaved ? (
                  <View style={[styles.badge, { backgroundColor: p.lemonSoft, borderColor: p.lemon }]}>
                    <Text style={[styles.badgeText, { color: p.text }]}>待生效</Text>
                  </View>
                ) : null}
              </View>

              <Text style={[styles.cardDesc, { color: p.textSub }]}>{THEME_TAGLINE[key]}</Text>

              {/* 色块预览：主色 / 次色 / 强调色 / 功能色 */}
              <View style={styles.swatchRow}>
                {[p.primaryDeep, p.secondary, p.accent, p.mint, p.sky, p.lemon].map((c, i) => (
                  <View key={i} style={[styles.swatch, { backgroundColor: c }]} />
                ))}
              </View>

              {/* 底部模拟一条「主按钮」，让用户直观看到按钮长什么样 */}
              <View style={[styles.mockBtn, { backgroundColor: p.primaryDeep }]}>
                <Text style={[styles.mockBtnText, { color: p.onPrimary }]}>开始听故事</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>为什么要点「重新打开」？</Text>
          <Text style={styles.noteText}>
            页面里的颜色是在 App 启动时一次性生成好的（React Native 的样式表机制），
            运行中改不了。这里保存的是你下次启动时要用的那套，
            iOS 也不允许 App 自己重启，所以需要你手动关掉再打开一次。
          </Text>
        </View>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2 },

  title: {
    fontSize: FONT_SIZE.title,
    color: COLORS.text,
    fontFamily: FONT.rounded,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  subtitle: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSub,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  strong: { color: COLORS.orangeDeep, fontWeight: '700' },

  pendingBanner: {
    backgroundColor: COLORS.mintLight,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.mint,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  pendingTitle: { fontSize: FONT_SIZE.body, fontWeight: '800', color: COLORS.text },
  pendingText: { fontSize: FONT_SIZE.caption, color: COLORS.textSub, marginTop: 6, lineHeight: 20 },

  card: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 3,
    borderColor: 'transparent',
    ...SHADOW.card,
  },
  cardSelected: { borderColor: COLORS.orangeDeep },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { fontSize: FONT_SIZE.body, fontWeight: '800' },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: '800' },
  cardDesc: { fontSize: FONT_SIZE.caption, marginTop: 6, lineHeight: 20 },

  swatchRow: { flexDirection: 'row', gap: 8, marginTop: SPACING.md },
  swatch: { flex: 1, height: 26, borderRadius: 10 },

  mockBtn: {
    marginTop: SPACING.md,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  mockBtnText: { fontSize: FONT_SIZE.caption, fontWeight: '800' },

  noteCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    ...SHADOW.soft,
  },
  noteTitle: { fontSize: FONT_SIZE.body, fontWeight: '800', color: COLORS.text },
  noteText: { fontSize: FONT_SIZE.tiny, color: COLORS.textSub, marginTop: 6, lineHeight: 19 },
});

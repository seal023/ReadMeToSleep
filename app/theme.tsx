/**
 * app/theme.tsx — 界面配色（4 套预设主题）
 *
 * 背景：色盘早在 v74 就写进了 constants/Colors.ts（candy / forest / starry /
 * sakura 四套），但界面上一直没有入口 —— 用户的原话是「需要有 4 种颜色的设置，
 * 但是好像没看见具体的操作地点」。
 *
 * 📍 位置：这个页面**特意放在根级路由**（app/theme.tsx），而不是家长模式里。
 *   换颜色是孩子自己就能决定的小事，不该被家长 PIN 挡在门外；
 *   入口挂在孩子端「设置」页一级（app/(tabs)/settings.tsx），一步可达。
 *
 * ⚠️ 为什么选了之后要「重新打开 App」才生效：
 *   RN 的 StyleSheet.create 在模块加载时就把颜色固化成样式对象了，
 *   30 多个页面的 styles 都是模块级常量。运行期改 COLORS 不会让已创建的
 *   样式跟着变。所以这里是「保存 → 下次启动生效」，并在页面上把这件事
 *   用大字 + 图标 + 语音说清楚，而不是让用户点了没反应还以为坏了。
 *
 * 👶 儿童友好：4 张大色卡（emoji + 渐变卡面 + 色板），点一下＝立即选好，
 *   配震动反馈 + 语音播报，不识字也能玩。
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { CartoonScreen } from '../components/ui/CartoonScreen';
// 项目不用 expo-linear-gradient（依赖树 peer 冲突，见 components/ui/Gradient.tsx 注释），
// 渐变统一走这里的纯 JS 实现，零依赖。
import { GradientView } from '../components/ui/Gradient';
import { COLORS, FONT, FONT_SIZE, RADIUS, SPACING, SHADOW } from '../constants/theme';
import {
  ACTIVE_THEME,
  THEMES,
  THEME_KEYS,
  getSavedThemeKey,
  saveThemeKey,
  type ThemeKey,
} from '../constants/Colors';
import { useLanguage } from '../hooks/useLanguage';
import { speakWithBestVoice, prewarmSpeech } from '../services/playback';

/** 每套主题一个专属 emoji，孩子看图标就能认出来 */
const THEME_EMOJI: Record<ThemeKey, string> = {
  candy: '🍑',
  forest: '🌿',
  starry: '🌙',
  sakura: '🌸',
};

export default function ThemeScreen() {
  const { t, language } = useLanguage();
  /** 磁盘上已保存的选择（点一下就更新，用来做「待生效」提示） */
  const [saved, setSaved] = useState<ThemeKey>(() => getSavedThemeKey());
  /** 本次运行正在使用的主题（重启后才会变） */
  const running = ACTIVE_THEME;
  const pendingRestart = saved !== running;

  const nameOf = (key: ThemeKey) => t(`theme.names.${key}`);
  const tagOf = (key: ThemeKey) => t(`theme.tags.${key}`);

  /** 点选后要说的那句话（预热与播放必须逐字一致，否则缓存永不命中） */
  const pickedLine = (key: ThemeKey) =>
    `${nameOf(key)}${language === 'zh' ? '，' : '. '}${t('theme.speakPicked')}`;

  /**
   * v91 #4：进页面先把 4 句反馈语合成好落盘。
   * 之前是点击当下才发起合成，网络一抖就要等十几秒（用户以为没反应直接退了）。
   * 预热后点一下就命中本地缓存，几乎瞬时出声。
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const k of THEME_KEYS) {
        if (cancelled) return;
        await prewarmSpeech(pickedLine(k), language);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const pick = (key: ThemeKey) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = saveThemeKey(key);
    if (!ok) {
      Alert.alert(t('theme.saveFailedTitle'), t('theme.saveFailedMsg'));
      return;
    }
    setSaved(key);
    // 语音反馈：孩子不识字，选完要「听得见」结果。
    // fast：不再等音频会话配置，进一步压缩起播延迟。
    void speakWithBestVoice(pickedLine(key), language, { fast: true });
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* 返回：根 Stack 全局 headerShown:false，所以自己画 */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>

        <Text style={styles.emojiTitle}>🎨</Text>
        <Text style={styles.title}>{t('theme.title')}</Text>
        <Text style={styles.subtitle}>{t('theme.subtitle')}</Text>

        {pendingRestart && (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingTitle}>
              ✅ {t('theme.pendingTitle')}：{nameOf(saved)}
            </Text>
            <Text style={styles.pendingText}>{t('theme.pendingText')}</Text>
          </View>
        )}

        {/* 4 张色卡，两列平铺：一眼看全，点一下就好 */}
        <View style={styles.grid}>
          {THEME_KEYS.map((key) => {
            const p = THEMES[key];
            const isRunning = key === running;
            const isSaved = key === saved;
            return (
              <TouchableOpacity
                key={key}
                activeOpacity={0.88}
                onPress={() => pick(key)}
                style={[styles.card, isSaved && styles.cardSelected]}
              >
                <GradientView colors={p.gradient} bands={24} style={styles.cardInner}>
                  {(isRunning || isSaved) && (
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: isRunning ? p.mintSoft : p.lemonSoft,
                          borderColor: isRunning ? p.mint : p.lemon,
                        },
                      ]}
                    >
                      <Text style={[styles.badgeText, { color: p.text }]}>
                        {isRunning ? `✓ ${t('theme.inUse')}` : t('theme.pending')}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.cardEmoji}>{THEME_EMOJI[key]}</Text>
                  <Text style={[styles.cardName, { color: p.text }]}>{nameOf(key)}</Text>
                  <Text style={[styles.cardTag, { color: p.textSub }]}>{tagOf(key)}</Text>

                  {/* 色板：主色 / 次色 / 强调色 */}
                  <View style={styles.swatchRow}>
                    {[p.primaryDeep, p.secondary, p.accent].map((c, i) => (
                      <View key={i} style={[styles.swatch, { backgroundColor: c }]} />
                    ))}
                  </View>

                  {/* 模拟一颗主按钮，让「换完长啥样」有画面 */}
                  <View style={[styles.mockBtn, { backgroundColor: p.primaryDeep }]}>
                    <Text style={[styles.mockBtnText, { color: p.onPrimary }]}>
                      {t('theme.mockBtn')}
                    </Text>
                  </View>
                </GradientView>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 重启说明：一句话 + 大图标，别写成技术文档 */}
        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>⏰ {t('theme.restartTitle')}</Text>
          <Text style={styles.noteText}>{t('theme.restartText')}</Text>
        </View>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xl * 2 },

  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.soft,
  },
  backBtnText: { fontSize: 22, color: COLORS.text },

  emojiTitle: { fontSize: 44, textAlign: 'center', marginTop: SPACING.md },
  title: {
    fontSize: FONT_SIZE.title,
    color: COLORS.text,
    fontFamily: FONT.rounded,
    textAlign: 'center',
    marginTop: 4,
  },
  subtitle: {
    fontSize: FONT_SIZE.body,
    color: COLORS.textSub,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: SPACING.lg,
  },

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

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  card: {
    width: '48%',
    borderRadius: RADIUS.lg,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
    ...SHADOW.card,
  },
  cardSelected: { borderColor: COLORS.orangeDeep },
  cardInner: { padding: SPACING.md, minHeight: 240 },

  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginBottom: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '800' },

  cardEmoji: { fontSize: 32 },
  cardName: { fontSize: FONT_SIZE.body, fontWeight: '800', marginTop: 4 },
  cardTag: { fontSize: FONT_SIZE.tiny, marginTop: 2, lineHeight: 16 },

  swatchRow: { flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 10 },
  swatch: { flex: 1, height: 18, borderRadius: 8 },

  mockBtn: {
    // 贴卡片底部：四张卡内容长短不一，按钮对齐才整齐
    marginTop: 'auto',
    borderRadius: 999,
    paddingVertical: 8,
    alignItems: 'center',
  },
  mockBtnText: { fontSize: FONT_SIZE.tiny, fontWeight: '800' },

  noteCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.lg,
    ...SHADOW.soft,
  },
  noteTitle: { fontSize: FONT_SIZE.body, fontWeight: '800', color: COLORS.text },
  noteText: { fontSize: FONT_SIZE.caption, color: COLORS.textSub, marginTop: 6, lineHeight: 21 },
});

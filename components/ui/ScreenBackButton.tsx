/**
 * ScreenBackButton —— 统一的「返回」按钮
 *
 * 背景（v91 #3）：全 App 走的是根级 Stack + `headerShown: false`，
 * 所以每个二级页面都得自己画返回键。旅行打卡页之前只有「打卡成功」页有返回，
 * 故事生成出来之后必须听完才走得掉；家长端的录音列表 / 统计 / 订阅页同样没有返回。
 *
 * 这里做两个形态，按页面结构选：
 *   - inline（默认）：放在 ScrollView 顶部，随内容滚动，最安全，不会压住标题
 *   - floating：绝对定位悬浮在左上角，适合全屏内容页（如打卡页的流程卡片）
 *
 * 文案取 `common.back`（中英都有），不额外维护字串。
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useLanguage } from '../../hooks/useLanguage';

interface ScreenBackButtonProps {
  onPress: () => void;
  /** 悬浮模式：绝对定位在左上角 */
  floating?: boolean;
}

export function ScreenBackButton({ onPress, floating = false }: ScreenBackButtonProps) {
  const { t } = useLanguage();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
      style={[styles.base, floating ? styles.floating : styles.inline]}
      // 悬浮态容易被父层裁切 / 被滚动内容盖住，显式抬高层级
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.text}>← {t('common.back')}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  inline: { alignSelf: 'flex-start', marginBottom: 10 },
  floating: { position: 'absolute', top: 44, left: 14, zIndex: 30 },
  text: { fontSize: 15, fontWeight: '700', color: '#3D3229' },
});

/**
 * 横屏场景页左侧覆盖层：点击图中静态浣熊说话 + 气泡。
 * 场景图里已画有浣熊，页面不能再叠动态 Racco；此层只负责「热区 + 气泡」。
 * 竖屏不渲染（由调用方用 isWide 控制），页面保留原有动态浣熊。
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, FONT } from '../../constants/theme';

interface Props {
  text: string;
  onPress: () => void;
}

export function SceneRaccoLayer({ text, onPress }: Props) {
  return (
    <>
      <Pressable
        style={styles.hit}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="talk to raccoon"
      />
      {!!text && (
        <View style={styles.bubble} pointerEvents="none">
          <Text style={styles.bubbleText}>{text}</Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  hit: {
    position: 'absolute',
    left: '11%',
    top: '26%',
    width: '30%',
    height: '46%',
    zIndex: 2,
  },
  bubble: {
    position: 'absolute',
    left: '9%',
    top: '12%',
    maxWidth: 260,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 9,
    zIndex: 3,
    shadowColor: '#8A6A55',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 5,
  },
  bubbleText: {
    color: COLORS.text,
    fontSize: 15,
    fontFamily: FONT.rounded,
    textAlign: 'center',
  },
});

/**
 * UpsellModal — 全局「升级会员」可爱弹窗
 * ---------------------------------------------------------------------------
 * 取代原来冷冰冰的原生 Alert：小浣熊（Racco）从卡片上方探出头，像它在跟
 * 孩子/家长说这句话，下方是气泡卡片 + 两个胶囊按钮。
 *
 * 由根布局 app/_layout.tsx 渲染一次即可；任意位置用 store/upsellStore 的
 * openUpsell({...}) 唤起。
 */

import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import Racco from '@/components/common/Racco';
import { COLORS } from '@/constants/theme';
import { useUpsellStore } from '@/store/upsellStore';

const BRAND_ORANGE = '#FF8A65';

export function UpsellModal() {
  const payload = useUpsellStore((s) => s.payload);
  const close = useUpsellStore((s) => s.close);
  const router = useRouter();
  const { height: screenH } = useWindowDimensions();
  const isShort = screenH < 500; // 横屏矮屏：收起浣熊、缩小内边距

  const handleConfirm = () => {
    if (!payload) return;
    const p = payload;
    close();
    if (p.onConfirm) {
      // 先关弹窗再执行动作，避免 Modal 与跳转动画打架
      setTimeout(p.onConfirm, 0);
      return;
    }
    setTimeout(() => {
      if (p.action === 'sub') router.push('/(parent)/subscription?plan=yearly');
      else if (p.action === 'library') router.push('/(tabs)/library');
      else if (p.action === 'login') router.push('/auth/login');
    }, 0);
  };

  const handleCancel = () => {
    if (!payload) return;
    const p = payload;
    close();
    if (p.onCancel) setTimeout(p.onCancel, 0);
  };

  return (
    <Modal
      visible={!!payload}
      transparent
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        {payload ? (
          <View style={styles.cardWrap}>
            {/* 小浣熊探头：横屏矮屏收起，避免挤压卡片；竖屏保留探头效果 */}
            {!isShort && (
              <View style={styles.raccoWrap} pointerEvents="none">
                <Racco state="talking" size={116} />
              </View>
            )}

            <ScrollView
              style={[styles.cardScroll, { maxHeight: screenH * 0.85 }]}
              contentContainerStyle={styles.card}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.title}>{payload.title}</Text>
              <Text style={styles.message}>{payload.message}</Text>

              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.cancelBtn]}
                  onPress={handleCancel}
                  activeOpacity={0.85}
                >
                  <Text style={styles.cancelText}>{payload.cancelLabel ?? '稍后再说'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.confirmBtn]}
                  onPress={handleConfirm}
                  activeOpacity={0.9}
                >
                  <Text style={styles.confirmText}>{payload.confirmLabel}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

export default UpsellModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(60, 45, 35, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '90%',
    alignItems: 'center',
  },
  raccoWrap: {
    zIndex: 2,
    marginBottom: -46,
  },
  // 横屏矮屏可滚，避免标题/按钮被裁；flexGrow 让短内容仍垂直居中观感
  cardScroll: {
    width: '100%',
    flexGrow: 0,
  },
  card: {
    width: '100%',
    flexGrow: 1,
    justifyContent: 'center',
    backgroundColor: COLORS.cardSoft,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#FFE3CB',
    paddingTop: 44,
    paddingHorizontal: 22,
    paddingBottom: 20,
    alignItems: 'center',
    shadowColor: '#B08968',
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 27,
  },
  message: {
    fontSize: 14,
    lineHeight: 22,
    color: COLORS.textSub,
    textAlign: 'center',
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: '#F1EAE2',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textSub,
  },
  confirmBtn: {
    backgroundColor: BRAND_ORANGE,
    shadowColor: BRAND_ORANGE,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});

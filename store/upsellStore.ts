/**
 * store/upsellStore.ts — 全局「升级会员」可爱弹窗状态
 * ---------------------------------------------------------------------------
 * 原来各处用原生 Alert.alert 弹升级提示，样式粗糙、没有吉祥物。
 * 现在统一改为：任意位置调用 openUpsell(...) → 根布局里的 <UpsellModal /> 渲染
 * 一个带小浣熊（Racco）的可爱气泡弹窗，像小浣熊在跟孩子/家长说话。
 *
 * 非组件环境（如 useEntitlement 的 showPaywall、services）直接用 openUpsell()；
 * 组件里也可以用 useUpsellStore() 读状态。
 */

import { create } from 'zustand';

/** 确认按钮点击后的去向 */
export type UpsellAction = 'sub' | 'library' | 'login' | 'none';

export interface UpsellPayload {
  title: string;
  message: string;
  /** 确认按钮文案 */
  confirmLabel: string;
  /** 取消按钮文案（缺省用「稍后再说」由调用方传入，避免这里再依赖 i18n） */
  cancelLabel?: string;
  action: UpsellAction;
  /** 自定义确认回调（优先于 action；用于需要额外逻辑的场景） */
  onConfirm?: () => void;
  /** 取消回调（如门禁页无返回按钮时，取消需退回上一页） */
  onCancel?: () => void;
}

interface UpsellState {
  payload: UpsellPayload | null;
  open: (p: UpsellPayload) => void;
  close: () => void;
}

export const useUpsellStore = create<UpsellState>((set) => ({
  payload: null,
  open: (payload) => set({ payload }),
  close: () => set({ payload: null }),
}));

/** 供非组件环境直接唤起弹窗 */
export function openUpsell(p: UpsellPayload): void {
  useUpsellStore.getState().open(p);
}

/** 关闭弹窗 */
export function closeUpsell(): void {
  useUpsellStore.getState().close();
}

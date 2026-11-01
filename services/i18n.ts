/**
 * services/i18n.ts — 非组件代码里的语言出口
 *
 * 为什么需要这个文件：
 *   服务层（services/iap.ts、auth.ts、entitlement.ts…）会抛出或返回**用户能看到的**
 *   错误文案与弹窗标题，但它们不是 React 组件，拿不到 useLanguage()。
 *   以前这些句子全是硬编码中文 —— 英文模式下订阅失败、登录失败弹出来的仍是中文。
 *
 * 做法：
 *   LanguageProvider 在语言变化时调用 setRuntimeLanguage()，这里保存一份当前语言，
 *   服务层直接 ts('key') 取文案，能跟着界面语言一起变。
 *   组件内仍请用 useLanguage().t()（它是响应式的）。
 */

import en from '../locales/en.json';
import zh from '../locales/zh.json';
import type { Language } from '../types';

const DICTS: Record<Language, any> = { en, zh };

let current: Language = 'zh';

export function setRuntimeLanguage(lang: Language) {
  current = lang;
}

export function getRuntimeLanguage(): Language {
  return current;
}

/**
 * 与 hooks/useLanguage 的 t() 行为保持一致：
 * 先按扁平 key 直接取（如 'sub.plan.monthly'），再按嵌套 key 逐层取（如 'sleep.title'）。
 */
export function ts(key: string): string {
  const locale = DICTS[current];
  if (typeof locale[key] === 'string') return locale[key];
  const val = key.split('.').reduce((o: any, k) => (o && typeof o === 'object' ? o[k] : undefined), locale);
  return typeof val === 'string' ? val : key;
}

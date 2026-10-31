import AsyncStorage from '@react-native-async-storage/async-storage';
import zh from '../locales/zh.json';
import en from '../locales/en.json';
import { getChildName, getVoiceSetting } from './storage';
import {
  prewarmPhraseBatch,
  clearClonedCacheForTarget,
  hasClonedVoice,
} from './clonedVoicePlayback';
import { allBankPhrases } from './phraseBank';
import type { CloneTarget } from './voiceClone';
import type { Language } from '../types';

/**
 * 克隆声「高频短句」预热与缓存管理
 * ---------------------------------------------------------------------------
 * 需求：让提示音也是克隆声，但不每次都消耗 token。
 *   - 首次使用某短句时用克隆声合成一次并落盘本地缓存，之后走缓存（秒出、零 token）；
 *   - 克隆成功后静默预合成一批固定高频短句（问候 / 鼓励 / 晚安 / 引导），
 *     直接下载到本地缓存目录；
 *   - 重新克隆同一对象时清空旧缓存，避免旧音色音频残留 / 误用。
 *
 * 关键：预热文本必须与运行时 speakWithBestVoice 实际播报的字符串「逐字一致」，
 * 否则缓存 key（文本 hash）对不上，命中不了。故这里复用同一套 i18n 键与名字替换规则。
 */

const locales: Record<string, any> = { en, zh };

/** 复刻 useLanguage 的 t()：先扁平取，再按点号下钻 */
function translate(key: string, lang: Language): string {
  const locale = locales[lang] || locales.zh;
  if (locale && typeof locale[key] === 'string') return locale[key];
  const val = key.split('.').reduce(
    (o: any, k) => (o && typeof o === 'object' ? o[k] : undefined),
    locale,
  );
  return typeof val === 'string' ? val : key;
}

/** 含 {name} 占位、需按孩子昵称替换的问候 / 告别键 */
const NAME_KEYS = [
  'home.greetingMorning',
  'home.greetingNoon',
  'home.greetingAfternoon',
  'home.greetingEvening',
  'home.farewell', // 含「再见 + 晚安」
];

/** 与 _layout.tsx 的问候名字替换规则保持一致 */
function applyName(base: string, name: string): string {
  if (name) return base.replace('{name}', name);
  return base.replace('，{name}！', '！').replace(', {name}!', '!');
}

/** 构造与运行时完全一致的预热文本列表（含名字替换），保证缓存命中。
 *  覆盖：① 整份「俏皮短句」词库（按当前语言，约 40+ 条，随机取用也一定命中缓存）；
 *        ② 含 {name} 的问候 / 告别；③ AI 兜底回答。 */
function buildWarmPhrases(lang: Language, name: string): string[] {
  const out: string[] = [];
  for (const p of allBankPhrases()) {
    if (p.lang === lang) out.push(p.text);
  }
  for (const key of NAME_KEYS) out.push(applyName(translate(key, lang), name));
  out.push(translate('story.qa.unknown', lang));
  return out;
}

/** 读取当前界面语言（存储偏好，默认 zh） */
async function getCurrentLang(): Promise<Language> {
  try {
    const saved = await AsyncStorage.getItem('rms_language');
    return saved === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

/**
 * 把某音色的高频短句合成并落盘到本地缓存（静默、失败忽略）。
 * 用于克隆成功后 / App 打开时。每项只在本地缺失时发起一次合成，命中缓存即跳过。
 */
export async function warmClonedPhrases(target: CloneTarget): Promise<void> {
  try {
    const lang = await getCurrentLang();
    const name = (await getChildName()) || '';
    const phrases = buildWarmPhrases(lang, name);
    await prewarmPhraseBatch(target, phrases);
  } catch {
    /* 预热失败不影响正常使用 */
  }
}

/** 重新克隆某一对象时：清空其旧缓存（旧音色音频），使新音色重新生效 */
export function clearClonedPhraseCache(target: CloneTarget): void {
  clearClonedCacheForTarget(target);
}

let appWarmTriggered = false;
/**
 * App 打开（语言 hydrate 后）触发「一次」全量预热。
 * 覆盖两种情形：① 克隆较早、缓存被系统清理；② 用户从未重新克隆但希望提示音是克隆声。
 * 同进程内仅跑一次，避免重复；重新克隆时由 clear+warm 单独触发，不受影响。
 */
export async function ensurePhraseWarmup(): Promise<void> {
  if (appWarmTriggered) return;
  appWarmTriggered = true;
  try {
    const voice = await getVoiceSetting();
    if (!voice || voice === 'system') return;
    if (!(await hasClonedVoice(voice))) return;
    await warmClonedPhrases(voice);
  } catch {
    /* 忽略 */
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import zh from '../locales/zh.json';
import en from '../locales/en.json';
import { getChildName, getPromptVoiceSetting } from './storage';
import {
  prewarmPhraseBatch,
  prewarmClonedAudio,
  clearClonedCacheForTarget,
  hasClonedVoice,
  hasCachedAudio,
  isClonedAudioPlaying,
} from './clonedVoicePlayback';
import { installBundledPrompts } from './bundledPrompts';
import { allBankPhrases, VOICE_PREVIEW_SAMPLE } from './phraseBank';
import { PRESET_VOICE_OPTIONS, DEFAULT_VOICE } from './voiceCatalog';
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
  // 顺序有讲究：含名字的「问候 / 告别」必须排在最前面。
  // 它们是「必须秒出」的短句（锁屏告别尤其不能等），而预热走网络、逐条串行完成；
  // 若排在几十条俏皮短句之后，App 刚打开就锁屏时它还在队列里没合成 → 只能现场合成，
  // 后台网络又被 iOS 降速 → 听起来就是「再见」过了十几秒才出来。
  const out: string[] = [];
  for (const key of NAME_KEYS) out.push(applyName(translate(key, lang), name));
  // 声音设置页的试听样句：点选后要立刻出声，不能现合成
  out.push(VOICE_PREVIEW_SAMPLE[lang]);
  for (const p of allBankPhrases()) {
    if (p.lang === lang) out.push(p.text);
  }
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

/** 隐私同意标记（与 _layout.tsx 同一个 key）：未同意前不发任何网络请求 */
const PRIVACY_CONSENT_KEY = 'rms_privacy_consent_v1';

async function privacyAgreed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRIVACY_CONSENT_KEY)) === 'agreed';
  } catch {
    return false;
  }
}

/**
 * App 打开（语言 hydrate 后）触发「一次」全量预热。
 * 覆盖两种情形：① 早前预热过、缓存被系统清理；② 用户换了提示音声线。
 * 同进程内仅跑一次，避免重复；重新克隆 / 改设置时由 clear+warm 单独触发，不受影响。
 */
export async function ensurePhraseWarmup(): Promise<void> {
  if (appWarmTriggered) return;
  // 先查隐私同意：未同意前一行网络都不发（同意后由 _layout 再调一次）
  if (!(await privacyAgreed())) return;
  appWarmTriggered = true;
  try {
    // v81：提示音声线与故事声线独立，这里只预热「提示音」要用的那个声线
    const voice = await getPromptVoiceSetting();
    if (!voice || voice === 'system') return;
    // 内置样本音色无需克隆、恒定可用；克隆音色要确认真的克隆过
    if (!voice.startsWith('preset:') && !(await hasClonedVoice(voice))) return;
    await warmClonedPhrases(voice);
  } catch {
    /* 忽略 */
  }
}

/* -------------------------------------------------------------------------- */
/*  首次安装：把「除克隆声以外的所有声音」装进本地缓存                          */
/* -------------------------------------------------------------------------- */

/**
 * 需求（2026-11-04）：「初次安装的时候，除了克隆的声音，其他声音都安装进去，
 * 这样就不需要缓冲了」。
 *
 * 做法：把内置样本音色（大姐姐 / 温柔女声 / 大哥哥 / 邻家姐姐）各自需要的
 * 提示音全部提前合成、落到本地缓存。之后任何一次提示音 / 试听都直接命中磁盘缓存，
 * 零网络、零 token、点下去就出声；离线也能响。
 *
 * 覆盖内容（中英各一份，与运行时逐字一致才命中）：
 *   · 带昵称的问候 / 告别（必须秒出，尤其锁屏告别）
 *   · 声音设置页的试听样句
 *   · 整份俏皮短句词库（答对 / 再想想 / 我听到啦 / 引导语…）
 *   · AI 兜底回答
 *
 * 代价：每个音色约 100 条短句，四条音色约 400 次合成请求。全部是几十字的短文本，
 * token 成本很低；带宽/耗时靠「先装正在用的 → 再装默认 → 最后装其余」+ 低并发 + 音色间停顿
 * 控制在可接受范围。只跑一次（标记落盘），中途被打断下次启动会接着补（已落盘的自动跳过）。
 */
const PRESET_INSTALL_FLAG = 'rms_preset_voices_installed_v1';
let presetInstallStarted = false;

/** 中英双语全套提示音文本（含名字替换，和运行时播报逐字一致） */
function buildWarmPhrasesAllLangs(name: string): { text: string; lang: Language }[] {
  const out: { text: string; lang: Language }[] = [];
  (['zh', 'en'] as Language[]).forEach((lang) => {
    // 问候 / 告别排最前：它们必须秒出（锁屏告别尤其不能等）
    for (const key of NAME_KEYS) out.push({ text: applyName(translate(key, lang), name), lang });
    out.push({ text: VOICE_PREVIEW_SAMPLE[lang], lang });
    for (const p of allBankPhrases()) {
      if (p.lang === lang) out.push(p);
    }
    out.push({ text: translate('story.qa.unknown', lang), lang });
  });
  return out;
}

/** 把某个内置样本音色需要的全部提示音装进本地缓存（已存在的自动跳过） */
export async function warmPresetVoice(target: string): Promise<void> {
  if (!target || !target.startsWith('preset:')) return;
  try {
    const name = (await getChildName()) || '';
    // 内置 mp3 覆盖了固定短句（368 条）；这里只处理「内置补不到的」——
    // 主要是带昵称的问候 / 告别（昵称由用户输入，无法预生成）。
    // 过滤掉已落盘的，避免内置装完后又白发几百次合成请求。
    const items = buildWarmPhrasesAllLangs(name).filter(
      (it) => !hasCachedAudio(it.text, target as CloneTarget),
    );
    if (items.length === 0) return;
    // 安装期并发压到 2：别和「用户正在播的故事」抢带宽，也别撞接口限流
    const CONCURRENCY = 2;
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const it = items[cursor++];
        // 用户正在听故事时先让路（最多等 20 秒）：安装不能让正在播的故事卡顿。
        let waited = 0;
        while (isClonedAudioPlaying() && waited < 20000) {
          await new Promise((r) => setTimeout(r, 400));
          waited += 400;
        }
        try {
          await prewarmClonedAudio(it.text, target as CloneTarget, it.lang);
        } catch {
          /* 单条失败不影响其它 */
        }
        // 轻微限速：把突发请求摊平，别和首播抢接口
        await new Promise((r) => setTimeout(r, 120));
      }
    };
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, items.length); i++) workers.push(worker());
    await Promise.all(workers);
  } catch {
    /* 单个音色失败不影响其它音色 */
  }
}

/** 后台预热某个内置音色（切换声音后调用，不阻塞界面） */
export function warmPresetVoiceInBackground(target: string): void {
  if (!target || !target.startsWith('preset:')) return;
  void warmPresetVoice(target);
}

/**
 * 首次安装（或缓存被系统清空后）一次性把全部内置音色装满缓存。
 * 同进程只尝试一次；成功标记落盘后不再重复。
 */
export async function ensurePresetVoicesInstalled(): Promise<void> {
  // ① 先装「随包内置」的 mp3：纯本地文件复制，不发任何网络请求，故不受隐私门控。
  //    内部幂等（flag + 已存在文件跳过），重复调用开销可忽略。
  await installBundledPrompts();

  if (presetInstallStarted) return;
  // 未同意隐私政策前不发任何合成请求（同意后 _layout 会再调一次）
  if (!(await privacyAgreed())) return;
  presetInstallStarted = true;
  try {
    const done = await AsyncStorage.getItem(PRESET_INSTALL_FLAG);
    if (done === '1') return;

    let prompt = DEFAULT_VOICE;
    try {
      prompt = await getPromptVoiceSetting();
    } catch {
      prompt = DEFAULT_VOICE;
    }

    // 顺序：正在用的 → 默认大姐姐 → 其余内置音色（去重）
    const order: string[] = [];
    [prompt, DEFAULT_VOICE, ...PRESET_VOICE_OPTIONS.map((o) => o.id)].forEach((v) => {
      if (v && v.startsWith('preset:') && !order.includes(v)) order.push(v);
    });

    for (const v of order) {
      await warmPresetVoice(v);
      // 音色之间喘一口：把接口让给真正的播放请求，避免首播排队
      await new Promise((r) => setTimeout(r, 800));
    }
    await AsyncStorage.setItem(PRESET_INSTALL_FLAG, '1');
  } catch {
    /* 安装失败不影响使用；下次启动继续补（已落盘的会跳过） */
  }
}

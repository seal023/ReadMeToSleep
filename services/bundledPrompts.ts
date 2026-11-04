import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import manifest from '../assets/prompts/manifest.json';
import { PROMPT_MODULES } from '../assets/prompts/index';
import { seedBundledAudio } from './clonedVoicePlayback';

/**
 * 内置提示音安装（v93）
 * ---------------------------------------------------------------------------
 * 需求（2026-11-04）：「先生成 mp3，直接安装进去」——不要把 368 条提示音留给
 * 用户首次启动后联网逐条合成，而是开发期就生成好、随 App 包一起发布。
 *
 * 做法：音频放在 assets/prompts/ 下（Metro 打包为静态资源），App 首次启动时
 * 把它们**复制到本地音频缓存目录、文件名与联网合成完全一致**。之后
 * `ensureSynthFile` 的「缓存已存在」判断直接命中 → 零网络、零 token、离线可用，
 * 点下去就出声。播放层（含分片、断点、seek）一行都不用改。
 *
 * 为什么不是直接播放 asset：现有链路统一走「缓存目录里的文件」，且 seek / 分片 /
 * 结束检测都以该路径为准；复制一份（约 4–6MB，一次性）换来零改动与行为一致。
 *
 * 何时跑：隐私政策同意后（本地复制本来不发网络，但放在同一时机避免启动拥堵）。
 * 幂等：flag 里记 manifest 版本 + 条目数；同一版本只跑一次，升级（版本号变化）时
 * 重跑一遍并**强制覆盖**同名旧文件——内置音频是定稿版本，覆盖安装不能留旧声线。
 */

const INSTALL_FLAG = 'rms_bundled_prompts_installed_v1';

let started = false;

export type BundledInstallResult = {
  total: number;
  installed: number;
  skipped: boolean;
};

function flagValue(): string {
  return `${manifest.version}:${manifest.entries.length}`;
}

/**
 * 把随包内置的提示音全部落到本地缓存。
 * 幂等、可重复调用、任何失败都不抛（最坏情况退回「首次使用时联网合成」）。
 */
export async function installBundledPrompts(): Promise<BundledInstallResult> {
  const total = manifest.entries.length;
  if (started) return { total, installed: 0, skipped: true };
  started = true;

  try {
    if ((await AsyncStorage.getItem(INSTALL_FLAG)) === flagValue()) {
      return { total, installed: 0, skipped: true };
    }
  } catch {
    /* 读标记失败就当没装过，继续装（seedBundledAudio 内部也会跳过已存在文件） */
  }

  let installed = 0;
  try {
    for (let i = 0; i < total; i++) {
      const entry = manifest.entries[i];
      const mod = PROMPT_MODULES[entry.file];
      if (!mod) continue;
      try {
        const asset = Asset.fromModule(mod);
        // release 包里资源随 app 下载，localUri 通常已就绪；downloadAsync 保证可用
        if (!asset.localUri) await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        if (!uri) continue;
        if (await seedBundledAudio(entry.text, entry.target, uri, { overwrite: true })) installed++;
      } catch {
        /* 单条失败跳过，运行时仍可联网补 */
      }
      // 每 16 条让出一次事件循环：首装时也不卡住启动/动画
      if (i % 16 === 15) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await AsyncStorage.setItem(INSTALL_FLAG, flagValue());
  } catch {
    /* 安装中断：下次启动会接着补（已落盘的会自动跳过） */
  }
  return { total, installed, skipped: false };
}

/** 内置清单概览（诊断用） */
export function bundledPromptsInfo(): { total: number; version: number } {
  return { total: manifest.entries.length, version: manifest.version };
}

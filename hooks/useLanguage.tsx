import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Localization from 'expo-localization'
import en from '../locales/en.json'
import zh from '../locales/zh.json'
import { Language, LocaleDict, LanguageContextType } from '../types'

const STORAGE_KEY = 'rms_language'

const locales: Record<Language, LocaleDict> = { en, zh }

/**
 * 首次安装（本地还没存过语言偏好）时，跟随手机系统的语言设置：
 * 按系统语言优先级列表，取第一个 App 支持的语言（中文 / 英文）。
 *  - 系统为中文（含繁體）→ zh
 *  - 系统为英文 → en
 *  - 系统是第一语言为日/韩/法等、但列表里还有中文或英文 → 取列表中靠前的那个
 *  - 系统语言完全不含中/英 → 走英文（国际默认，避免给非中文用户看中文）
 */
function detectSystemLanguage(): Language {
  try {
    const systemLocales = Localization.getLocales()
    for (const l of systemLocales) {
      const code = (l.languageCode || '').toLowerCase()
      if (code === 'zh') return 'zh'
      if (code === 'en') return 'en'
    }
    return systemLocales.length > 0 ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'zh',
  setLanguage: async () => {},
  t: (key: string) => key,
  hydrated: false,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  // 首帧即按系统语言初始化，避免先渲染中文再闪成英文（本地无存储偏好时）
  const [language, setLang] = useState<Language>(detectSystemLanguage)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'en' || saved === 'zh') {
        // 用户在 App 内手动选过语言：以手动选择为准
        setLang(saved)
      } else {
        // 从没手动选过：每次启动都跟着手机系统语言走。
        // 这里故意不落盘，这样以后在系统设置里改语言、重装，App 都能自动跟上。
        setLang(detectSystemLanguage())
      }
    }).catch(() => {
      setLang(detectSystemLanguage())
    }).finally(() => {
      // 无论读取成功与否，标记语言已初始化，避免 UI 用默认 zh 提前播报/渲染
      setHydrated(true)
    })
  }, [])

  const setLanguage = async (lang: Language) => {
    setLang(lang)
    await AsyncStorage.setItem(STORAGE_KEY, lang)
  }

  const t = (key: string): string => {
    const locale: any = locales[language];
    // 先按扁平 key 直接取（如 app.name / common.back）
    if (typeof locale[key] === 'string') return locale[key];
    // 再按嵌套 key 取（如 sleep.locked.title / privacy.title）
    const val = key.split('.').reduce(
      (o: any, k) => (o && typeof o === 'object' ? o[k] : undefined),
      locale,
    );
    return typeof val === 'string' ? val : key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, hydrated }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextType {
  return useContext(LanguageContext)
}
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Localization from 'expo-localization'
import en from '../locales/en.json'
import zh from '../locales/zh.json'
import { Language, LocaleDict, LanguageContextType } from '../types'

const STORAGE_KEY = 'rms_language'

const locales: Record<Language, LocaleDict> = { en, zh }

const LanguageContext = createContext<LanguageContextType>({
  language: 'zh',
  setLanguage: async () => {},
  t: (key: string) => key,
  hydrated: false,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  // 首帧即按系统语言初始化，避免先渲染中文再闪成英文（本地无存储偏好时）
  const [language, setLang] = useState<Language>(() => {
    try {
      const sysLang = Localization.getLocales()[0]?.languageCode
      return sysLang === 'en' ? 'en' : 'zh'
    } catch {
      return 'zh'
    }
  })
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'en' || saved === 'zh') {
        setLang(saved)
      } else {
        // 首次启动且未在 App 内手动选过语言：跟随系统语言（iOS/Android 设备语言）
        try {
          const sysLang = Localization.getLocales()[0]?.languageCode;
          const lang: Language = sysLang === 'en' ? 'en' : 'zh';
          setLang(lang);
          AsyncStorage.setItem(STORAGE_KEY, lang);
        } catch {
          setLang('zh');
          AsyncStorage.setItem(STORAGE_KEY, 'zh');
        }
      }
    }).catch(() => {
      setLang('zh')
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
    const locale = locales[language];
    return locale[key] || key;
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, hydrated }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextType {
  return useContext(LanguageContext)
}
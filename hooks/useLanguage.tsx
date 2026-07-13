import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import en from '../locales/en.json'
import zh from '../locales/zh.json'
import { Language, LocaleDict, LanguageContextType } from '../types'

const STORAGE_KEY = 'rms_language'

const locales: Record<Language, LocaleDict> = { en, zh }

const LanguageContext = createContext<LanguageContextType>({
  language: 'zh',
  setLanguage: async () => {},
  t: (key: string) => key,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLang] = useState<Language>('zh')

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'en' || saved === 'zh') setLang(saved as Language)
    })
  }, [])

  const setLanguage = async (lang: Language) => {
    setLang(lang)
    await AsyncStorage.setItem(STORAGE_KEY, lang)
  }

  const t = (key: string): string => {
    const dict = locales[language]
    return (dict as Record<string, string>)[key] ?? key
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(): LanguageContextType {
  return useContext(LanguageContext)
}

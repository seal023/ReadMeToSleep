import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Story, Progress, Language, SensitiveWords } from '../types';

const KEYS = {
  LANGUAGE: 'rms_language',
  VOICE: 'rms_voice',
  PARENT_MODE: 'rms_parent_mode',
  SUBSCRIPTION: 'rms_subscription',
};

interface AppState {
  // state
  language: Language;
  currentVoice: string;
  isParentMode: boolean;
  subscription: 'free' | 'monthly' | 'yearly';
  sensitiveWords: string[];
  stories: Story[];
  progress: Progress;
  // actions
  setLanguage: (lang: Language) => void;
  setCurrentVoice: (voiceId: string) => void;
  setIsParentMode: (v: boolean) => void;
  addStory: (story: Story) => void;
  removeStory: (id: string) => void;
  updateProgress: (patch: Partial<Progress>) => void;
  addSensitiveWord: (word: string) => void;
  removeSensitiveWord: (word: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  language: 'zh',
  currentVoice: 'system',
  isParentMode: false,
  subscription: 'free',
  sensitiveWords: [],
  stories: [],
  progress: {
    listenedStories: [],
    checkIns: [],
    badges: [],
    streakDays: 0,
    lastListenDate: '',
  },

  setLanguage: async (lang) => {
    set({ language: lang });
    await AsyncStorage.setItem(KEYS.LANGUAGE, lang);
  },

  setCurrentVoice: async (voiceId) => {
    set({ currentVoice: voiceId });
    await AsyncStorage.setItem(KEYS.VOICE, voiceId);
  },

  setIsParentMode: async (v) => {
    set({ isParentMode: v });
    await AsyncStorage.setItem(KEYS.PARENT_MODE, String(v));
  },

  addStory: async (story) => {
    set((s) => ({ stories: [...s.stories, story] }));
  },

  removeStory: async (id) => {
    set((s) => ({ stories: s.stories.filter((st) => st.id !== id) }));
  },

  updateProgress: async (patch) => {
    set((s) => ({ progress: { ...s.progress, ...patch } }));
  },

  addSensitiveWord: async (word) => {
    set((s) => ({ sensitiveWords: [...s.sensitiveWords, word] }));
  },

  removeSensitiveWord: async (word) => {
    set((s) => ({ sensitiveWords: s.sensitiveWords.filter((w) => w !== word) }));
  },
}));

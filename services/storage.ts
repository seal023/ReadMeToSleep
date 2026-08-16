import AsyncStorage from '@react-native-async-storage/async-storage';
import { Story, Progress, SensitiveWords } from '../types';
import { MOCK_STORIES } from '../data/classic-stories/mock-stories';

const CLASSIC_STORIES_DATA = MOCK_STORIES;

const KEYS = {
  STORIES: 'rms_stories',
  PROGRESS: 'rms_progress',
  SENSITIVE_WORDS: 'rms_sensitive_words',
  VOICE: 'rms_voice',
};

const DEFAULT_PROGRESS: Progress = {
  listenedStories: [],
  checkIns: [],
  badges: [],
  streakDays: 0,
  lastListenDate: '',
};

const DEFAULT_SENSITIVE_WORDS: SensitiveWords = {
  words: [],
  phrases: [],
};

export async function saveStory(story: Story): Promise<void> {
  const stories = await getStories();
  const idx = stories.findIndex(s => s.id === story.id);
  if (idx >= 0) {
    stories[idx] = story;
  } else {
    stories.push(story);
  }
  await AsyncStorage.setItem(KEYS.STORIES, JSON.stringify(stories));
}

export async function getStories(): Promise<Story[]> {
  const raw = await AsyncStorage.getItem(KEYS.STORIES);
  return raw ? JSON.parse(raw) : [];
}

export async function getStory(id: string): Promise<Story | null> {
  const stories = await getStories();
  const found = stories.find(s => s.id === id);
  if (found) return found;

  for (const data of CLASSIC_STORIES_DATA) {
    const classicStory = data.find((s: any) => s.id === id);
    if (classicStory) {
      return {
        id: classicStory.id,
        title: classicStory.title,
        content: classicStory.content,
        language: 'zh' as const,
        type: 'classic' as const,
        tags: classicStory.tags || [],
        duration: classicStory.duration || 0,
        createdAt: new Date().toISOString(),
      };
    }
  }
  return null;
}

export async function deleteStory(id: string): Promise<void> {
  const stories = await getStories();
  const filtered = stories.filter(s => s.id !== id);
  await AsyncStorage.setItem(KEYS.STORIES, JSON.stringify(filtered));
}

export async function saveProgress(progress: Progress): Promise<void> {
  await AsyncStorage.setItem(KEYS.PROGRESS, JSON.stringify(progress));
}

export async function getProgress(): Promise<Progress> {
  const raw = await AsyncStorage.getItem(KEYS.PROGRESS);
  return raw ? JSON.parse(raw) : { ...DEFAULT_PROGRESS };
}

export async function saveSensitiveWords(words: SensitiveWords): Promise<void> {
  await AsyncStorage.setItem(KEYS.SENSITIVE_WORDS, JSON.stringify(words));
}

export async function getSensitiveWords(): Promise<SensitiveWords> {
  const raw = await AsyncStorage.getItem(KEYS.SENSITIVE_WORDS);
  return raw ? JSON.parse(raw) : { ...DEFAULT_SENSITIVE_WORDS };
}

export async function saveVoiceSetting(voiceId: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.VOICE, voiceId);
}

export async function getVoiceSetting(): Promise<string> {
  const val = await AsyncStorage.getItem(KEYS.VOICE);
  return val || 'system';
}

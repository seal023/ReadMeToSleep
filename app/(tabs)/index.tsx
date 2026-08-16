import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { router } from 'expo-router';
import { useLanguage } from '../../hooks/useLanguage';
import Racco from '../../components/common/Racco';
import type { RaccoState } from '../../types';

const TITLES = ['Little Star', 'Champion', 'Adventurer', 'Dreamer', 'Storyteller', 'Sweetie'] as const;
const RACCO_STATES: RaccoState[] = ['idle', 'talking', 'listening', 'thinking', 'happy', 'sleeping'];

function getGreetingKey(): string {
  const h = new Date().getHours();
  if (h < 12) return 'home.greetingMorning';
  if (h < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

export default function HomeTab() {
  const { t } = useLanguage();

  const [raccoState, setRaccoState] = useState<RaccoState>('idle');
  const [title] = useState(() => TITLES[Math.floor(Math.random() * TITLES.length)]);

  const raccoSize = Dimensions.get('window').width * 0.4;

  const handleRaccoPress = () => {
    const next = RACCO_STATES[Math.floor(Math.random() * RACCO_STATES.length)];
    setRaccoState(next);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.greetingSection}>
        <Text style={styles.greetingText}>
          {t(getGreetingKey())}, {title} ✨
        </Text>
      </View>

      <TouchableOpacity activeOpacity={0.7} onPress={handleRaccoPress} style={styles.raccoWrap}>
        <Racco state={raccoState} size={raccoSize} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.recCard}
        activeOpacity={0.8}
        onPress={() => router.push('/(tabs)/library')}
      >
        <View style={styles.recCover}>
          <Text style={styles.recCoverEmoji}>📖</Text>
        </View>
        <View style={styles.recInfo}>
          <Text style={styles.recTitle}>{t('home.recTitle')}</Text>
          <View style={styles.recTags}>
            <Text style={styles.recTag}>{t('home.recTag1')}</Text>
            <Text style={styles.recTag}>{t('home.recTag2')}</Text>
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionCard1}
          activeOpacity={0.8}
          onPress={() => router.push('/(tabs)/library')}
        >
          <Text style={styles.actionEmoji}>🎧</Text>
          <Text style={styles.actionLabel}>{t('home.quickListen')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard2}
          activeOpacity={0.8}
          onPress={() => router.push('/(tabs)/create')}
        >
          <Text style={styles.actionEmoji}>✏️</Text>
          <Text style={styles.actionLabel}>{t('home.quickCreate')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard3}
          activeOpacity={0.8}
          onPress={() => router.push('/story/travel-checkin')}
        >
          <Text style={styles.actionEmoji}>✈️</Text>
          <Text style={styles.actionLabel}>{t('home.quickTravel')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('home.recentStories')}</Text>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{t('home.noStories')}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5E6',
  },
  content: {
    paddingBottom: 40,
  },

  greetingSection: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
  },
  greetingText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#5D4037',
  },

  raccoWrap: {
    alignItems: 'center',
    marginVertical: 16,
  },

  recCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginHorizontal: 24,
    marginBottom: 20,
    padding: 14,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
    elevation: 3,
  },
  recCover: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recCoverEmoji: {
    fontSize: 32,
  },
  recInfo: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  recTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  recTags: {
    flexDirection: 'row',
    gap: 8,
  },
  recTag: {
    fontSize: 12,
    color: '#FF6B6B',
    backgroundColor: '#FFF0F0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },

  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  actionCard1: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#FFB5A0',
  },
  actionCard2: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#FFD3B0',
  },
  actionCard3: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#C8E6C9',
  },
  actionEmoji: {
    fontSize: 28,
    marginBottom: 6,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5D4037',
    textAlign: 'center',
  },

  section: {
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#5D4037',
    marginBottom: 12,
  },
  emptyState: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 36,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#BDBDBD',
  },
});
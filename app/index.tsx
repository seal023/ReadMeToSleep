import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import Racco from '../components/common/Racco';
import { useLanguage } from '../hooks/useLanguage';
import { ChildTitle } from '../types';
import { useState } from 'react';

export default function IndexScreen() {
  const { t, language, setLanguage } = useLanguage();
  const [childTitle] = useState(
    () => ChildTitle[Math.floor(Math.random() * ChildTitle.length)]
  );

  const toggleLanguage = () => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  };

  const handleChildMode = () => {
    router.push('/(tabs)');
  };

  const handleParentMode = () => {
    router.push('/(parent)');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.appName}>{t('app.name')}</Text>
        <Text style={styles.tagline}>{t('app.tagline')}</Text>
      </View>

      <View style={styles.raccoArea}>
        <Racco
          state="happy"
          size={180}
          showSpeechBubble
          speechText={t('home.racco.happy')}
        />
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={styles.childCard}
          onPress={handleChildMode}
          activeOpacity={0.8}
        >
          <Text style={styles.cardEmoji}>🎮</Text>
          <Text style={styles.cardTitle}>
            {t('home.childMode')} · {childTitle}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.parentCard}
          onPress={handleParentMode}
          activeOpacity={0.8}
        >
          <Text style={styles.cardEmoji}>👨‍👩‍👧‍👦</Text>
          <Text style={styles.cardTitle}>{t('home.parentMode')}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.langBtn} onPress={toggleLanguage}>
        <Text style={styles.langText}>
          {language === 'zh' ? '🌐 English' : '🌐 中文'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5E6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  appName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#5D4037',
  },
  tagline: {
    fontSize: 16,
    color: '#8D6E63',
    marginTop: 4,
  },
  raccoArea: {
    marginVertical: 30,
    alignItems: 'center',
  },
  buttons: {
    width: '100%',
    gap: 16,
  },
  childCard: {
    borderRadius: 16,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
    backgroundColor: '#FFE0B2',
  },
  parentCard: {
    borderRadius: 16,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
    backgroundColor: '#E8F5E9',
  },
  cardEmoji: {
    fontSize: 32,
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#5D4037',
  },
  langBtn: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
  },
  langText: {
    fontSize: 16,
    color: '#8D6E63',
  },
});
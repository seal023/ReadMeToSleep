import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { useLanguage } from '../../hooks/useLanguage';

/** 便于在真机上确认装的是哪一个包（app.json → expo.version） */
const APP_VERSION: string =
  (Constants.expoConfig?.version as string | undefined) ?? '1.1.0';

export default function SettingsScreen() {
  const { t, language, setLanguage } = useLanguage();

  const toggleLanguage = () => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  };

  const showVoiceOptions = () => {
    Alert.alert(
      t('settings.voice.title'),
      '',
      [
        { text: t('settings.voice.system'), onPress: () => {} },
        { text: t('settings.voice.mom'), onPress: () => {} },
        { text: t('settings.voice.dad'), onPress: () => {} },
        { text: t('settings.voice.grandma'), onPress: () => {} },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.raccoWrap}>
        <Racco
          state="idle"
          size={120}
          showSpeechBubble
          speechText={t('settings.racco.idle')}
        />
      </View>

      <Text style={styles.title}>{t('settings.title')}</Text>

      <TouchableOpacity style={styles.card} onPress={toggleLanguage}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>🌐</Text>
          <Text style={styles.cardText}>Language / 语言</Text>
        </View>
        <Text style={styles.cardValue}>
          {language === 'zh' ? '中文' : 'English'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={showVoiceOptions}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>🔊</Text>
          <Text style={styles.cardText}>{t('settings.voice')}</Text>
        </View>
        <Text style={styles.cardValue}>{t('settings.voice.system')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={() => router.push('/(parent)')}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>👨‍👩‍👧‍👦</Text>
          <Text style={styles.cardText}>{t('settings.parentMode')}</Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>ℹ️</Text>
          <View style={styles.aboutInfo}>
            <Text style={styles.cardText}>{t('settings.about')}</Text>
            <Text style={styles.aboutSub}>{t('settings.about.description')}</Text>
            <Text style={styles.versionBadge}>v{APP_VERSION}</Text>
          </View>
        </View>
      </View>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  raccoWrap: {
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 24,
    color: '#5D4037',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    elevation: 3,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  cardIcon: {
    fontSize: 22,
    marginRight: 14,
  },
  cardText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  cardValue: {
    fontSize: 15,
    color: '#999',
    fontWeight: '400',
  },
  arrow: {
    fontSize: 24,
    color: '#bbb',
    fontWeight: '300',
  },
  aboutInfo: {
    flex: 1,
  },
  aboutSub: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  versionBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    fontSize: 13,
    fontWeight: '700',
    color: '#8D6E63',
    backgroundColor: '#FFF1DC',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
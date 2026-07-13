import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import Racco from '../../components/common/Racco';
import { useLanguage } from '../../hooks/useLanguage';

export default function SettingsScreen() {
  const { t, language, setLanguage } = useLanguage();
  const router = useRouter();

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 顶部 Racco */}
      <View style={styles.raccoWrap}>
        <Racco
          state="idle"
          size={120}
          showSpeechBubble
          speechText={t('settings.racco.idle')}
        />
      </View>

      {/* 标题 */}
      <Text style={styles.title}>{t('settings.title')}</Text>

      {/* 语言切换 */}
      <TouchableOpacity style={styles.card} onPress={toggleLanguage}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>🌐</Text>
          <Text style={styles.cardText}>Language / 语言</Text>
        </View>
        <Text style={styles.cardValue}>
          {language === 'zh' ? '中文' : 'English'}
        </Text>
      </TouchableOpacity>

      {/* 声音选择 */}
      <TouchableOpacity style={styles.card} onPress={showVoiceOptions}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>🔊</Text>
          <Text style={styles.cardText}>{t('settings.voice')}</Text>
        </View>
        <Text style={styles.cardValue}>{t('settings.voice.system')}</Text>
      </TouchableOpacity>

      {/* 家长入口 */}
      <TouchableOpacity style={styles.card} onPress={() => router.push('/(parent)')}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>👨‍👩‍👧‍👦</Text>
          <Text style={styles.cardText}>{t('settings.parentMode')}</Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      {/* 关于 */}
      <View style={styles.card}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>ℹ️</Text>
          <View style={styles.aboutInfo}>
            <Text style={styles.cardText}>{t('settings.about')}</Text>
            <Text style={styles.aboutSub}>
              {t('settings.about.version')} · {t('settings.about.description')}
            </Text>
          </View>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
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
});

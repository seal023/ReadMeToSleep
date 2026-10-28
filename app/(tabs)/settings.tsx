import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch, TextInput } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { useLanguage } from '../../hooks/useLanguage';
import { getVoiceGuidance, setVoiceGuidance, getVoiceSetting, saveVoiceSetting, getChildName, setChildName } from '../../services/storage';
import { hasClonedVoice } from '../../services/clonedVoicePlayback';

/** 便于在真机上确认装的是哪一个包（app.json → expo.version） */
const APP_VERSION: string =
  (Constants.expoConfig?.version as string | undefined) ?? '1.1.0';

export default function SettingsScreen() {
  const { t, language, setLanguage } = useLanguage();
  const [voiceGuidance, setVoiceGuidanceState] = useState(false);
  const [currentVoice, setCurrentVoice] = useState('system');
  const [cloned, setCloned] = useState<Record<string, boolean>>({});
  const [childName, setChildNameState] = useState('');

  useEffect(() => {
    getVoiceGuidance().then(setVoiceGuidanceState);
  }, []);

  useEffect(() => {
    getVoiceSetting().then((v) => v && setCurrentVoice(v));
    (async () => {
      const map: Record<string, boolean> = {};
      for (const t of ['mom', 'dad', 'grandma'] as const) {
        map[t] = await hasClonedVoice(t);
      }
      setCloned(map);
      setChildNameState(await getChildName());
    })();
  }, []);

  const toggleVoiceGuidance = async (val: boolean) => {
    setVoiceGuidanceState(val);
    await setVoiceGuidance(val);
  };

  const toggleLanguage = () => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  };

  const selectVoice = async (voiceId: string) => {
    setCurrentVoice(voiceId);
    await saveVoiceSetting(voiceId);
  };

  const showVoiceOptions = () => {
    const optionFor = (id: string, labelKey: string) => {
      const mark = cloned[id] ? ` ✓${t('settings.voice.cloned')}` : '';
      return { text: t(labelKey) + mark, onPress: () => selectVoice(id) };
    };
    Alert.alert(t('settings.voice.title'), t('settings.voice.hint'), [
      optionFor('system', 'settings.voice.system'),
      optionFor('mom', 'settings.voice.mom'),
      optionFor('dad', 'settings.voice.dad'),
      optionFor('grandma', 'settings.voice.grandma'),
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const currentVoiceLabel =
    currentVoice === 'system'
      ? t('settings.voice.system')
      : t(`settings.voice.${currentVoice}` as 'settings.voice.mom');

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
          <Text style={styles.cardText}>{t('settings.language')}</Text>
        </View>
        <Text style={styles.cardValue}>
          {language === 'zh' ? '中文' : 'English'}
        </Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>👶</Text>
          <View style={styles.cardTextWrap}>
            <Text style={styles.cardText}>{t('settings.childName')}</Text>
            <Text style={styles.cardSub}>{t('settings.childName.hint')}</Text>
          </View>
        </View>
      </View>
      <TextInput
        style={styles.nameInput}
        value={childName}
        placeholder={t('settings.childName.placeholder')}
        placeholderTextColor="#999"
        maxLength={12}
        onChangeText={setChildNameState}
        onBlur={() => setChildName(childName)}
      />

      <TouchableOpacity style={styles.card} onPress={showVoiceOptions}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>🔊</Text>
          <Text style={styles.cardText}>{t('settings.voice')}</Text>
        </View>
        <Text style={styles.cardValue}>{currentVoiceLabel}</Text>
      </TouchableOpacity>

      {/* 需求 3 占位：语音引导开关（真实语音识别待接入 STT） */}
      <View style={styles.card}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>🎤</Text>
          <View style={styles.cardTextWrap}>
            <Text style={styles.cardText}>{t('settings.voiceGuide.title')}</Text>
            <Text style={styles.cardSub}>{t('settings.voiceGuide.hint')}</Text>
          </View>
        </View>
        <Switch value={voiceGuidance} onValueChange={toggleVoiceGuidance} />
      </View>

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
  cardTextWrap: {
    flex: 1,
  },
  cardSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 3,
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
  nameInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0D9B5',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#333',
    marginBottom: 12,
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
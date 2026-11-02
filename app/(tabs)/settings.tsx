import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch, TextInput } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { ClayIcon } from '../../components/ui/ClayIcon';
import { useLanguage } from '../../hooks/useLanguage';
import { useAuth } from '../../hooks/useAuth';
import { getVoiceGuidance, setVoiceGuidance, getVoiceSetting, getChildName, setChildName } from '../../services/storage';
import { voiceDisplayName, normalizeVoiceId } from '../../services/voiceCatalog';
import { THEMES, THEME_KEYS } from '../../constants/Colors';

/** 便于在真机上确认装的是哪一个包（app.json → expo.version + 原生 build number） */
const APP_VERSION: string =
  (Constants.expoConfig?.version as string | undefined) ?? '1.1.0';
const BUILD_NUMBER: string =
  (Constants.nativeBuildVersion as string | undefined) ?? '?';

export default function SettingsScreen() {
  const { t, language, setLanguage } = useLanguage();
  // 账号：让家长在设置页一级就能看见"会员记在哪个账号上"
  const { isSignedIn, email: accountEmail, displayName } = useAuth();
  const [voiceGuidance, setVoiceGuidanceState] = useState(false);
  const [currentVoice, setCurrentVoice] = useState('preset:cherry');
  const [childName, setChildNameState] = useState('');

  useEffect(() => {
    getVoiceGuidance().then(setVoiceGuidanceState);
  }, []);

  useEffect(() => {
    getVoiceSetting().then((v) => v && setCurrentVoice(normalizeVoiceId(v)));
    (async () => {
      setChildNameState(await getChildName());
    })();
  }, []);

  const toggleVoiceGuidance = async (val: boolean) => {
    setVoiceGuidanceState(val);
    await setVoiceGuidance(val);
  };

  const toggleLanguage = () => {
    Alert.alert(t('settings.language'), t('settings.language.hint'), [
      { text: '中文', onPress: () => setLanguage('zh') },
      { text: 'English', onPress: () => setLanguage('en') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  /**
   * v81：声音选择从「弹窗里选 4 个亲属」改为进入统一的「声音设置」页。
   * 那里把「提示音」和「故事朗读」分开列，并会把内置样本音色一起列出来——
   * 原来只有 系统/妈妈/爸爸/外婆 四项，没克隆过的人选谁都是同一把机器音。
   */
  const showVoiceOptions = () => {
    router.push('/(parent)/voices');
  };

  const currentVoiceLabel = voiceDisplayName(currentVoice, language === 'en' ? 'en' : 'zh');

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

      {/* 界面配色：孩子自己就能换，不走家长模式（路由在根级 /theme） */}
      <TouchableOpacity style={styles.card} onPress={() => router.push('/theme')}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>🎨</Text>
          <View style={styles.cardTextWrap}>
            <Text style={styles.cardText}>{t('theme.title')}</Text>
            <Text style={styles.cardSub}>{t('theme.subtitle')}</Text>
          </View>
        </View>
        <View style={styles.themeDots}>
          {THEME_KEYS.map((k) => (
            <View key={k} style={[styles.themeDot, { backgroundColor: THEMES[k].primaryDeep }]} />
          ))}
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      {/* 宝宝名字：合并为一栏并紧跟语言卡片置顶，方便查找 */}
      <View style={styles.babyCard}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>👶</Text>
          <View style={styles.cardTextWrap}>
            <Text style={styles.cardText}>{t('settings.childName')}</Text>
            <Text style={styles.cardSub}>{t('settings.childName.hint')}</Text>
          </View>
        </View>
        <TextInput
          style={styles.nameInputInline}
          value={childName}
          placeholder={t('settings.childName.placeholder')}
          placeholderTextColor="#999"
          maxLength={12}
          onChangeText={setChildNameState}
          onBlur={() => setChildName(childName)}
        />
      </View>

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
          <ClayIcon name="mic" size={28} />
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

      {/* 账号入口：会员权益与缴费凭证都归属这个账号，必须在设置页一级可见。
          v79：卡片标题固定显示「我的账号」，账号明细进详情页再展开（避免首页直接暴露邮箱）。 */}
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(isSignedIn ? '/(parent)/account' : '/auth/login')}
      >
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>{isSignedIn ? '👤' : '🔑'}</Text>
          <View style={styles.cardTextWrap}>
            <Text style={styles.cardText}>
              {isSignedIn ? t('settings.account.title') : t('settings.account.signIn')}
            </Text>
            <Text style={styles.cardSub}>
              {isSignedIn
                ? displayName || accountEmail || t('settings.account.appleBound')
                : t('settings.account.hint')}
            </Text>
          </View>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      {/* 声音克隆二级入口：首页有常驻大卡，但设置页也必须有一处，避免用户找不到 */}
      <TouchableOpacity style={styles.card} onPress={() => router.push('/(parent)/voice-clone')}>
        <View style={styles.cardLeft}>
          <ClayIcon name="mic" size={30} />
          <View style={styles.cardTextWrap}>
            <Text style={styles.cardText}>{t('settings.cloneEntry.title')}</Text>
            <Text style={styles.cardSub}>{t('settings.cloneEntry.hint')}</Text>
          </View>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      {/* 会员入口：直达订阅/会员中心（上架前声音克隆门禁恢复后，亦是引导升级的主路径） */}
      <TouchableOpacity style={styles.card} onPress={() => router.push('/(parent)/subscription')}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>💎</Text>
          <View style={styles.cardTextWrap}>
            <Text style={styles.cardText}>{t('settings.premium')}</Text>
            <Text style={styles.cardSub}>{t('settings.premium.hint')}</Text>
          </View>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardIcon}>ℹ️</Text>
          <View style={styles.aboutInfo}>
            <Text style={styles.cardText}>{t('settings.about')}</Text>
            <Text style={styles.aboutSub}>{t('settings.about.description')}</Text>
            <Text style={styles.versionBadge}>v{APP_VERSION} · build {BUILD_NUMBER}</Text>
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
    /** iPad 横屏：设置项居中一列，不铺满整屏 */
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
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
    color: '#3D3229',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 22,
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
    color: '#3D3229',
    fontWeight: '600',
  },
  cardTextWrap: {
    flex: 1,
  },
  cardSub: {
    fontSize: 12,
    color: '#A8988A',
    marginTop: 3,
  },
  cardValue: {
    fontSize: 15,
    color: '#A8988A',
    fontWeight: '400',
  },
  arrow: {
    fontSize: 24,
    color: '#bbb',
    fontWeight: '300',
  },
  themeDots: {
    flexDirection: 'row',
    gap: 5,
    marginRight: 6,
  },
  themeDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  aboutInfo: {
    flex: 1,
  },
  aboutSub: {
    fontSize: 13,
    color: '#A8988A',
    marginTop: 4,
  },
  babyCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    elevation: 3,
  },
  nameInputInline: {
    backgroundColor: '#F7F1E8',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F0D9B5',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#3D3229',
    marginTop: 12,
  },
  versionBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    fontSize: 13,
    fontWeight: '700',
    color: '#7A6A5D',
    backgroundColor: '#FFF1DC',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 18,
    overflow: 'hidden',
  },
});
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch, TextInput } from 'react-native';
import { router } from 'expo-router';
import Racco from '../../components/common/Racco';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { ClayIcon } from '../../components/ui/ClayIcon';
import { useLanguage } from '../../hooks/useLanguage';
import { useAuth } from '../../hooks/useAuth';
import { getVoiceGuidance, setVoiceGuidance, getChildName, setChildName, getPromptVoiceSetting } from '../../services/storage';
import { warmPresetVoiceInBackground } from '../../services/phraseCache';
import { speakWithBestVoice } from '../../services/playback';
import { THEMES, THEME_KEYS } from '../../constants/Colors';

/** 点小浣熊时轮流说的话：先讲「这里能做什么」，再讲「以后能陪你聊天」 */
const RACCO_REPLIES = ['settings.racco.reply1', 'settings.racco.reply2'];

export default function SettingsScreen() {
  const { t, language, setLanguage } = useLanguage();
  // 账号：让家长在设置页一级就能看见"会员记在哪个账号上"
  const { isSignedIn, email: accountEmail, displayName } = useAuth();
  const [voiceGuidance, setVoiceGuidanceState] = useState(false);
  const [childName, setChildNameState] = useState('');

  /**
   * v99 反馈 #1：页面顶部的小浣熊原来只是张图片（Racco 没挂 onPress），
   * 点了完全没反应，看着像坏掉了。现在点它会换一句话并念出来
   *（不识字的孩子也能听懂），气泡里那句「有什么需要帮忙的吗？」保留，
   * 以后接入「点小浣熊就能提问/聊天」时，这里就是现成的入口。
   */
  const [raccoLine, setRaccoLine] = useState('');
  const [raccoHappy, setRaccoHappy] = useState(false);
  const raccoTapIdx = useRef(0);
  const raccoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tapRacco = () => {
    const key = RACCO_REPLIES[raccoTapIdx.current % RACCO_REPLIES.length];
    raccoTapIdx.current += 1;
    const line = t(key);
    setRaccoLine(line);
    setRaccoHappy(true);
    /**
     * v101 反馈：这里原来直接调 textToSpeech()，它只走 expo-speech（iOS 自带
     * 「婷婷」），完全没读设置里的「提示音声线」，所以听上去是机器默认音，
     * 而不是家长选的大姐姐。改走 speakWithBestVoice：与首页问候、问答反馈、
     * 换主题语音同一条链路，会读 getPromptVoiceSetting()、走内置音色/克隆声缓存，
     * 家长在声音设置里换什么，这里就跟着换成什么。
     */
    void speakWithBestVoice(line, language === 'en' ? 'en' : 'zh', { fast: true });
    if (raccoTimer.current) clearTimeout(raccoTimer.current);
    raccoTimer.current = setTimeout(() => setRaccoHappy(false), 2800);
  };

  useEffect(() => () => {
    if (raccoTimer.current) clearTimeout(raccoTimer.current);
  }, []);

  /**
   * 昵称改了以后：新的问候 / 告别是全新文本，内置 mp3 里没有，
   * 这里顺手用当前提示音声线后台预热一次（内置音色才有意义），
   * 否则下次开机那句「早上好呀，小明！」要现场联网合成，会慢一拍。
   */
  const saveNameAndWarm = async (name: string) => {
    await setChildName(name);
    try {
      const v = await getPromptVoiceSetting();
      if (v && v.startsWith('preset:')) warmPresetVoiceInBackground(v);
    } catch {
      /* 预热失败不影响设置 */
    }
  };

  useEffect(() => {
    getVoiceGuidance().then(setVoiceGuidanceState);
  }, []);

  useEffect(() => {
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

  /** 声音设置入口已统一收到家长中心（/(parent)/voices），设置页不再重复放卡 */

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.raccoWrap}>
        <Racco
          state={raccoHappy ? 'happy' : 'idle'}
          size={120}
          showSpeechBubble
          speechText={raccoLine || t('settings.racco.idle')}
          onPress={tapRacco}
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
          onBlur={() => saveNameAndWarm(childName)}
        />
      </View>

      {/*
        v82 反馈 #2：这里原来还有一张「🔊 声音」卡，点进去和家长中心的
        「🎚️ 声音设置」跳的是同一个页面（/(parent)/voices），两个入口一模一样。
        声音选择属于家长配置，统一收在家长中心一处；孩子端设置页保持精简。
      */}

      {/* v95：原来的「开机提问（你想做什么呀）」卡片已从首页删除，这个开关改为
          「语音介绍今日推荐」——开启后进首页会念一遍今天推荐的故事。 */}
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

      {/*
        v84 反馈 #7：「会员中心」与「关于」两处从孩子端设置页撤掉，统一收进家长模式。
        —— 会员/订阅属于家长付费决策，放孩子能碰到的地方容易误触；
        —— 版本号等「关于」信息也是家长排查用的，家长中心里更顺手。
      */}
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
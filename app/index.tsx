import { View, Text, StyleSheet, TouchableOpacity, ScrollView, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Racco from '../components/common/Racco';
import { CartoonScreen } from '../components/ui/CartoonScreen';
import { useLanguage } from '../hooks/useLanguage';
import { ChildTitle } from '../types';
import { useState } from 'react';

const TITLE_KEYS = [
  'title.star',
  'title.champion',
  'title.adventurer',
  'title.dreamer',
  'title.storyteller',
  'title.sweetie',
] as const;

export default function IndexScreen() {
  const { t, language, setLanguage } = useLanguage();
  const { height } = useWindowDimensions();
  /**
   * 横屏（尤其 iPhone 横过来只有 ~390pt 高）时，180pt 的浣熊会把两个入口顶出屏幕。
   * 这里按高度降级，并让外层可滚动 —— iPad 横屏（主场景）仍然是大图。
   */
  const compact = height < 520;
  const [titleIndex] = useState(() => Math.floor(Math.random() * ChildTitle.length));
  const childTitle = t(TITLE_KEYS[titleIndex]);

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
    <CartoonScreen gradient="day" decor>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.container, compact && styles.containerCompact]}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.header}>
        <Text style={styles.appName}>{t('app.name')}</Text>
        <Text style={styles.tagline}>{t('app.tagline')}</Text>
      </View>

      <View style={styles.raccoArea}>
        <Racco
          state="happy"
          size={compact ? 110 : 180}
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
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  /** 横屏：压缩上下留白，内容仍可滚动 */
  containerCompact: { justifyContent: 'flex-start', paddingVertical: 12 },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  appName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#3D3229',
  },
  tagline: {
    fontSize: 16,
    color: '#7A6A5D',
    marginTop: 4,
  },
  raccoArea: {
    marginVertical: 30,
    alignItems: 'center',
  },
  buttons: {
    width: '100%',
    /** iPad 横屏下入口卡不要拉成一整屏宽 */
    maxWidth: 560,
    alignSelf: 'center',
    gap: 16,
  },
  childCard: {
    borderRadius: 22,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
    backgroundColor: '#FFE0B2',
  },
  parentCard: {
    borderRadius: 22,
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
    color: '#3D3229',
  },
  langBtn: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
  },
  langText: {
    fontSize: 16,
    color: '#7A6A5D',
  },
});
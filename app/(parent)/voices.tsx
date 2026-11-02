import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT } from '../../constants/theme';
import { useLanguage } from '../../hooks/useLanguage';
import {
  getVoiceSetting, saveVoiceSetting,
  getPromptVoiceSetting, savePromptVoiceSetting,
} from '../../services/storage';
import { listAvailableVoices, type VoiceOption } from '../../services/voiceCatalog';
import { speakWithBestVoice, stopStory } from '../../services/playback';

/**
 * 家长端「声音设置」（v81 新增）
 * ---------------------------------------------------------------------------
 * 反馈原文：提示音和故事朗读混在一起，中文界面提示音是克隆的、英文界面又变成
 * 机器的女声，故事朗读又是另一个声音，家长完全没法预期。
 *
 * 这里拆成两个互不干扰的选择，并把「可选声音」摆明：
 *   · 提示音：提问、鼓励、状态播报等短句用谁的声音
 *   · 故事朗读：念故事正文用谁的声音
 * 两者默认都是内置「大姐姐」，可换成其他内置样本、手机自带语音，或已克隆的亲人。
 */
export default function VoiceSettings() {
  const { t, language: uiLang } = useLanguage();
  const [storyVoice, setStoryVoice] = useState('preset:cherry');
  const [promptVoice, setPromptVoice] = useState('preset:cherry');
  const [options, setOptions] = useState<VoiceOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  /**
   * 每次进入本页都重新读一遍清单。
   * 用 useFocusEffect 而不是 useEffect：家长常常「先来这页看有什么声音 → 去克隆 → 返回」，
   * 若只在挂载时读一次，刚克隆好的声音不会立刻出现，看着像没保存成功。
   */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const [s, p, list] = await Promise.all([
          getVoiceSetting(),
          getPromptVoiceSetting(),
          listAvailableVoices(),
        ]);
        if (!alive) return;
        setStoryVoice(s);
        setPromptVoice(p);
        setOptions(list);
        setLoaded(true);
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  /** 试听：一句话让孩子/家长直接听出差别（用当前点的那个声音，不改设置） */
  const preview = useCallback(
    (id: string) => {
      const sample =
        uiLang === 'en'
          ? 'Sweetheart, shall we read a little story together tonight?'
          : '宝贝，今晚我们一起讲一个小浣熊的故事好不好？';
      void speakWithBestVoice(sample, uiLang, { voiceId: id });
    },
    [uiLang],
  );

  const pickStory = async (id: string) => {
    setStoryVoice(id);
    await saveVoiceSetting(id);
    preview(id);
  };

  const pickPrompt = async (id: string) => {
    setPromptVoice(id);
    await savePromptVoiceSetting(id);
    preview(id);
  };

  const renderOptions = (current: string, onPick: (id: string) => void) => (
    <View>
      {options.map((o) => {
        const active = current === o.id;
        return (
          <TouchableOpacity
            key={o.id}
            style={active ? styles.optionActive : styles.option}
            onPress={() => onPick(o.id)}
            activeOpacity={0.85}
          >
            <View style={styles.optionLeft}>
              <Text style={styles.optionEmoji}>{o.emoji}</Text>
              <Text style={active ? styles.optionTextActive : styles.optionText}>
                {uiLang === 'en' ? o.nameEn : o.nameZh}
              </Text>
            </View>
            {active ? <Text style={styles.check}>✓</Text> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              stopStory();
              router.back();
            }}
          >
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('voices.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Text style={styles.desc}>{t('voices.desc')}</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('voices.sectionPrompt')}</Text>
          <Text style={styles.sectionSub}>{t('voices.promptDesc')}</Text>
          {loaded ? renderOptions(promptVoice, pickPrompt) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('voices.sectionStory')}</Text>
          <Text style={styles.sectionSub}>{t('voices.storyDesc')}</Text>
          {loaded ? renderOptions(storyVoice, pickStory) : null}
        </View>

        <Text style={styles.tip}>{t('voices.tip')}</Text>
      </ScrollView>
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, marginBottom: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 24, backgroundColor: COLORS.card,
    alignItems: 'center', justifyContent: 'center',
  },
  backBtnText: { fontSize: 22, color: COLORS.text },
  headerSpacer: { width: 40 },
  title: { fontSize: 20, color: COLORS.text, fontFamily: FONT.rounded },
  desc: { fontSize: 14, color: COLORS.textSub, lineHeight: 22, marginBottom: 16 },
  card: {
    backgroundColor: COLORS.card, borderRadius: 24, padding: 16, marginBottom: 14,
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)', elevation: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  sectionSub: { fontSize: 12, color: COLORS.textSub, lineHeight: 18, marginBottom: 12 },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 14, borderRadius: 18,
    backgroundColor: '#fff', marginBottom: 8, borderWidth: 1, borderColor: '#eee',
  },
  optionActive: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 14, borderRadius: 18,
    backgroundColor: COLORS.orange + '1A', marginBottom: 8, borderWidth: 1.5, borderColor: COLORS.orange,
  },
  optionLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  optionEmoji: { fontSize: 18, marginRight: 10 },
  optionText: { fontSize: 15, color: COLORS.text, flexShrink: 1 },
  optionTextActive: { fontSize: 15, color: COLORS.orange, fontWeight: '600', flexShrink: 1 },
  check: { fontSize: 18, color: COLORS.orange },
  tip: { fontSize: 12, color: COLORS.textLight, lineHeight: 18, marginTop: 4 },
});

import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT } from '../../constants/theme';
import { useLanguage } from '../../hooks/useLanguage';
import {
  getVoiceSetting, saveVoiceSetting,
  getPromptVoiceSetting, savePromptVoiceSetting,
  DEFAULT_PROMPT_VOICE,
} from '../../services/storage';
import {
  listAvailableVoices, renameClonedVoice, deleteClonedVoice,
  MAX_CLONE_NAME_LEN, type VoiceOption,
} from '../../services/voiceCatalog';
import { speakWithBestVoice, stopStory } from '../../services/playback';
import { VOICE_PREVIEW_SAMPLE } from '../../services/phraseBank';
import { warmPresetVoiceInBackground } from '../../services/phraseCache';

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
  /** 正在改名的对象（null = 弹层关闭） */
  const [renaming, setRenaming] = useState<VoiceOption | null>(null);
  const [renameText, setRenameText] = useState('');
  const [renameErr, setRenameErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 读一次当前设置与可选清单（进入页面、改名、删除后都复用） */
  const reload = useCallback(async () => {
    const [s, p, list] = await Promise.all([
      getVoiceSetting(),
      getPromptVoiceSetting(),
      listAvailableVoices(),
    ]);
    setStoryVoice(s);
    setPromptVoice(p);
    setOptions(list);
    setLoaded(true);
  }, []);

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
      // ⚠️ 必须与预热用的样句同源（phraseBank.VOICE_PREVIEW_SAMPLE），
      // 否则首点永远命不中缓存，听起来就是「点了半天才出声」。
      void speakWithBestVoice(VOICE_PREVIEW_SAMPLE[uiLang], uiLang, { voiceId: id, fast: true });
    },
    [uiLang],
  );

  const pickStory = async (id: string) => {
    setStoryVoice(id);
    await saveVoiceSetting(id);
    // 换成内置音色时后台补齐该音色的提示音缓存（首次安装已装好，这里只是兜底）
    warmPresetVoiceInBackground(id);
    preview(id);
  };

  const pickPrompt = async (id: string) => {
    setPromptVoice(id);
    await savePromptVoiceSetting(id);
    warmPresetVoiceInBackground(id);
    preview(id);
  };

  /** 已克隆的声音（管理区只列这些；预置音色与手机语音不可改名/删除） */
  const clones = options.filter((o) => o.kind === 'clone');
  const label = (o: VoiceOption) => (uiLang === 'en' ? o.nameEn : o.nameZh);
  /**
   * 输入框里预填的「称呼」：把展示名里的后缀去掉——
   * 「妈妈的声音」→「妈妈」，"Mom's voice" → "Mom"。
   * 否则家长一按保存就把「妈妈」改成了叫「妈妈的声音」的奇怪对象。
   */
  const shortName = (o: VoiceOption) =>
    label(o).replace(/的声音$/, '').replace(/'s voice$/i, '').trim();

  const openRename = (o: VoiceOption) => {
    stopStory();
    setRenameText(shortName(o));
    setRenameErr(null);
    setRenaming(o);
  };

  const confirmRename = async () => {
    if (!renaming || saving) return;
    // 称呼没改就关掉：否则「妈妈」会被存成 custom:妈妈，平白丢掉一键入口
    if (renameText.trim() === shortName(renaming)) {
      setRenaming(null);
      return;
    }
    setSaving(true);
    try {
      const res = await renameClonedVoice(renaming.id, renameText);
      if (!res.ok) {
        setRenameErr(
          res.reason === 'duplicate'
            ? t('voices.renameDuplicate').replace('{name}', renameText.trim())
            : res.reason === 'tooLong'
            ? t('voices.renameTooLong').replace('{n}', String(MAX_CLONE_NAME_LEN))
            : t('voices.renameEmpty'),
        );
        return;
      }
      setRenaming(null);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (o: VoiceOption) => {
    stopStory();
    Alert.alert(
      t('voices.deleteTitle').replace('{name}', label(o)),
      t('voices.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteClonedVoice(o.id);
            await reload();
          },
        },
      ],
    );
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
          {/* 一键回默认大姐姐：提示音的「初始声音」就是它，改乱了也能一键还原 */}
          {loaded && promptVoice !== DEFAULT_PROMPT_VOICE ? (
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => void pickPrompt(DEFAULT_PROMPT_VOICE)}
              activeOpacity={0.85}
            >
              <Text style={styles.resetBtnText}>↩ {t('voices.resetPrompt')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('voices.sectionStory')}</Text>
          <Text style={styles.sectionSub}>{t('voices.storyDesc')}</Text>
          {loaded ? renderOptions(storyVoice, pickStory) : null}
        </View>

        {/* 管理区：只列已克隆的声音。预置音色和手机语音是内置的，不需要管理。 */}
        {loaded && clones.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('voices.clonedSection')}</Text>
            <Text style={styles.sectionSub}>{t('voices.clonedDesc')}</Text>
            {clones.map((o) => (
              <View key={o.id} style={styles.manageRow}>
                <Text style={styles.optionEmoji}>{o.emoji}</Text>
                <Text style={styles.manageName} numberOfLines={1}>
                  {label(o)}
                </Text>
                <TouchableOpacity style={styles.miniBtn} onPress={() => openRename(o)} activeOpacity={0.85}>
                  <Text style={styles.miniBtnText}>✏️ {t('voices.rename')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.miniBtnDanger}
                  onPress={() => confirmDelete(o)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.miniBtnDangerText}>🗑 {t('common.delete')}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.tip}>{t('voices.tip')}</Text>
      </ScrollView>

      {/* 改名弹层：只改称呼，不重新克隆，所以不会多消耗一次复刻 */}
      <Modal
        visible={!!renaming}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalMask}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('voices.renameTitle')}</Text>
            <Text style={styles.modalSub}>
              {t('voices.renameSub').replace('{name}', renaming ? label(renaming) : '')}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={renameText}
              onChangeText={(v) => {
                setRenameText(v);
                setRenameErr(null);
              }}
              placeholder={t('voices.renamePlaceholder')}
              placeholderTextColor="#bbb"
              maxLength={MAX_CLONE_NAME_LEN}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmRename}
            />
            {renameErr ? <Text style={styles.modalErr}>{renameErr}</Text> : null}
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setRenaming(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSave, saving && styles.modalSaveDisabled]}
                onPress={confirmRename}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Text style={styles.modalSaveText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  resetBtn: {
    alignSelf: 'flex-start', marginTop: 4, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: COLORS.orange + '14',
  },
  resetBtnText: { fontSize: 13, color: COLORS.orange, fontWeight: '600' },

  /* 已克隆声音的管理行 */
  manageRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: '#fff', marginBottom: 8, borderWidth: 1, borderColor: '#eee',
  },
  manageName: { flex: 1, fontSize: 15, color: COLORS.text },
  miniBtn: {
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12,
    backgroundColor: COLORS.orange + '18', marginLeft: 6,
  },
  miniBtnText: { fontSize: 12, color: COLORS.orange, fontWeight: '600' },
  miniBtnDanger: {
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12,
    backgroundColor: '#FF6B6B18', marginLeft: 6,
  },
  miniBtnDangerText: { fontSize: 12, color: '#D64545', fontWeight: '600' },

  /* 改名弹层 */
  modalMask: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 420, backgroundColor: COLORS.card,
    borderRadius: 24, padding: 20,
    boxShadow: '0 8px 24px rgba(0,0,0,0.18)', elevation: 8,
  },
  modalTitle: { fontSize: 18, color: COLORS.text, fontFamily: FONT.rounded, marginBottom: 6 },
  modalSub: { fontSize: 13, color: COLORS.textSub, lineHeight: 19, marginBottom: 12 },
  modalInput: {
    borderWidth: 1.5, borderColor: '#eee', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: COLORS.text,
    backgroundColor: '#fff',
  },
  modalErr: { fontSize: 12, color: '#D64545', marginTop: 8, lineHeight: 18 },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 16, marginRight: 8 },
  modalCancelText: { fontSize: 15, color: COLORS.textSub },
  modalSave: {
    paddingVertical: 10, paddingHorizontal: 22, borderRadius: 16, backgroundColor: COLORS.orange,
  },
  modalSaveDisabled: { opacity: 0.6 },
  modalSaveText: { fontSize: 15, color: '#fff', fontWeight: '600' },
});

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import Racco from '../../components/common/Racco';
import { useLanguage } from '../../hooks/useLanguage';
import storage from '../../services/storage';

export default function SensitiveWordsScreen() {
  const { t } = useLanguage();
  const [allWords, setAllWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState('');
  const [batchText, setBatchText] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const data = await storage.getSensitiveWords();
    const combined: string[] = [
      ...data.words.map(w => ({ label: w, tag: 'w' })),
      ...data.phrases.map(p => ({ label: p, tag: 'p' })),
    ];
    setAllWords(combined.map(c => c.label));
  }

  async function save(sepWords: string[], sepPhrases: string[]) {
    await storage.saveSensitiveWords({ words: sepWords, phrases: sepPhrases });
  }

  function getSepLists(label: string) {
    return allWords.includes(label)
      ? allWords.filter(w => w !== label)
      : [];
  }

  async function handleRemove(label: string) {
    Alert.alert(
      t('common.confirm') || '确认删除',
      `确定要删除「${label}」吗？`,
      [
        { text: t('common.cancel') || '取消', style: 'cancel' },
        { text: t('common.delete') || '删除', style: 'destructive', onPress: () => {
          setAllWords(prev => prev.filter(w => w !== label));
        }},
      ],
    );
  }

  function handleAdd() {
    const trimmed = newWord.trim();
    if (!trimmed) return;
    setAllWords(prev => [...prev, trimmed]);
    setNewWord('');
  }

  function handleBatchImport() {
    const items = batchText.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
    if (items.length === 0) return;
    setAllWords(prev => {
      const set = new Set([...prev, ...items]);
      return [...set];
    });
    setBatchText('');
  }

  async function handleSave() {
    const sepWords: string[] = [];
    const sepPhrases: string[] = [];
    for (const label of allWords) {
      // 简单启发：带空格的算短语，否则算词
      sepWords.push(label);
    }
    await save(sepWords, sepPhrases);
    Alert.alert(t('common.success') || '保存成功', `${t('common.count') || '共'} ${allWords.length} ${t('common.items') || '个词'}`);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.raccoWrap}>
          <Racco state="idle" size={80} />
        </View>
        <Text style={styles.title}>{t('settings.sensitiveWords.title') || '敏感词管理'}</Text>

        {/* 词列表 */}
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>
            {(t('settings.sensitiveWords.list') || '当前词库')}（{allWords.length}）
          </Text>
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveBtnText}>{t('common.save') || '💾 保存'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.listWrap}>
          {allWords.length === 0 && (
            <Text style={styles.emptyText}>暂无敏感词 / No sensitive words</Text>
          )}
          {allWords.map((label, idx) => (
            <View key={idx} style={styles.wordRow}>
              <Text style={styles.wordLabel}>{label}</Text>
              <TouchableOpacity onPress={() => handleRemove(label)}>
                <Text style={styles.deleteIcon}>❌</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* 添加区 */}
        <Text style={styles.sectionTitle}>{t('settings.sensitiveWords.add') || '添加新词'}</Text>
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={newWord}
            onChangeText={setNewWord}
            placeholder={t('settings.sensitiveWords.placeholder') || '输入敏感词'}
          />
          <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
            <Text style={styles.addBtnText}>{t('common.add') || '添加'}</Text>
          </TouchableOpacity>
        </View>

        {/* 批量导入 */}
        <Text style={styles.sectionTitle}>{t('settings.sensitiveWords.batch') || '批量导入'}</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={batchText}
          onChangeText={setBatchText}
          placeholder={t('settings.sensitiveWords.batchPlaceholder') || '每行一个或用逗号分隔'}
          multiline
          numberOfLines={3}
        />
        <TouchableOpacity style={styles.addBtn} onPress={handleBatchImport}>
          <Text style={styles.addBtnText}>{t('settings.sensitiveWords.batchImport') || '📋 批量导入'}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 返回列表 */}
      <View style={styles.backBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => {
          if (typeof (global as any).router?.back === 'function') {
            // @ts-expect-error expo-router type issue
            (global as any).router.back();
          } else {
            // @ts-expect-error
            require('expo-router').useRouter().back();
          }
        }}>
          <Text style={styles.backBtnText}>{t('common.back') || '← 返回列表'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F6FA' },
});

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 80 },
  raccoWrap: { alignItems: 'center', marginVertical: 16 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 16, color: '#333' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8, color: '#555' },
  listWrap: { minHeight: 60, maxHeight: 300, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fff', marginBottom: 16, overflow: 'hidden' },
  emptyText: { textAlign: 'center', paddingVertical: 24, color: '#aaa', fontSize: 14 },
  wordRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  wordLabel: { fontSize: 15, flex: 1 },
  deleteIcon: { fontSize: 18, marginLeft: 8 },
  addRow: { flexDirection: 'row', marginBottom: 12 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, backgroundColor: '#fff', marginRight: 8 },
  multilineInput: { height: 80, textAlignVertical: 'top', marginBottom: 8 },
  addBtn: { backgroundColor: '#4A90D9', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  saveBtn: { backgroundColor: '#52C41A', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  backBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee', padding: 16 },
  backBtn: { alignSelf: 'center' },
  backBtnText: { fontSize: 15, color: '#4A90D9', fontWeight: '600' },
});

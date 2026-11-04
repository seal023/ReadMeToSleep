import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, Alert, TouchableOpacity,
  Keyboard, KeyboardAvoidingView, ScrollView, Platform, useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import Racco from '@/components/common/Racco';
import { getParentPin, saveParentPin, isParentSetup } from '@/services/storage';
import { useLanguage } from '@/hooks/useLanguage';
import { COLORS, FONT } from '@/constants/theme';

// 家长模式沿用全局 3D 粘土风吉祥物（原 raccoon-parent.png 已并入 assets/clay）

/** 输入区最大宽度：iPad 横屏下不再拉成一整屏，整块居中成一个「面板」 */
const PANEL_MAX_WIDTH = 420;

export default function ParentIndex() {
  const { t } = useLanguage();
  const { width, height } = useWindowDimensions();
  /**
   * 横屏（尤其 iPhone 横过来只有 ~390pt 高）时：
   *  · 170pt 的浣熊会直接把两个密码框顶出屏幕；
   *  · 键盘弹出后可用高度更小。
   * 这里按高度自动降级，并让 ScrollView 真正可滚动（见 styles.scroll）。
   */
  const compact = height < 560;
  const raccoSize = compact ? 84 : height > 900 ? 200 : 170;

  const [mode, setMode] = useState<'setup' | 'unlock'>('setup');
  const [digits1, setDigits1] = useState('');
  const [digits2, setDigits2] = useState('');
  const [pinEntry, setPinEntry] = useState('');
  const [failCount, setFailCount] = useState(0);
  const [locked, setLocked] = useState(false);

  // Check if password already set on mount
  useEffect(() => {
    (async () => {
      const setup = await isParentSetup();
      setMode(setup ? 'unlock' : 'setup');
    })();
  }, []);

  // Lockout timer
  useEffect(() => {
    if (!locked || failCount < 3) return;
    const timer = setTimeout(() => {
      setLocked(false);
      setFailCount(0);
    }, 30_000);
    return () => clearTimeout(timer);
  }, [locked, failCount]);

  // ---- Setup flow ----
  const handleSetupNext = async () => {
    Keyboard.dismiss();
    if (digits1.length !== 4 || digits2.length !== 4) {
      Alert.alert(t('parentPin.alertTitle'), t('parentPin.incomplete'));
      return;
    }
    if (digits1 !== digits2) {
      Alert.alert(t('parentPin.alertTitle'), t('parentPin.mismatch'));
      setDigits1('');
      setDigits2('');
      return;
    }
    await saveParentPin(digits1);
    // 用 replace：把「密码门」从栈里换掉，之后从家长中心退出/右滑返回会直接回到孩子端，
    // 而不是又落回这个密码页（v94 反馈 #2）
    router.replace('/(parent)/hub');
  };

  // ---- Unlock flow ----
  const handlePinTap = (digit: string) => {
    if (pinEntry.length >= 4) return;
    const next = pinEntry + digit;
    if (next.length === 4) {
      verifyPin(next);
    } else {
      setPinEntry(next);
    }
  };

  const handleDelete = () => {
    setPinEntry((p) => p.slice(0, -1));
  };

  const verifyPin = async (pin: string) => {
    try {
      const savedPin = await getParentPin();
      if (!savedPin || savedPin !== pin) {
        const newCount = failCount + 1;
        setFailCount(newCount);
        setPinEntry('');
        if (newCount >= 3) {
          setLocked(true);
          Alert.alert(t('parentPin.lockTitle'), t('parentPin.lockMsg'));
        } else {
          Alert.alert(
            t('parentPin.wrongTitle'),
            t('parentPin.wrongMsg').replace('{n}', String(newCount)),
          );
        }
        return;
      }
      // 同上：replace 掉密码门，家长模式里再返回时直接回孩子端（v94 反馈 #2）
      router.replace('/(parent)/hub');
    } catch {
      Alert.alert(t('parentPin.wrongTitle'), t('parentPin.verifyFail'));
    }
  };

  // Numeric keypad layout
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  /**
   * 竖屏 / 横屏共用的「居中面板」：
   * 之前内容直接铺在 ScrollView 里，标题、提示、输入框全部左对齐，
   * 在 iPad 横屏（1024~1366pt 宽）上会贴着左边缘，视觉重心严重偏左。
   * 现在外面套一层 maxWidth 420 的容器并居中，输入框内文字也居中。
   */
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/*
        ⚠️ 这个 ScrollView 必须带 flex:1（见 styles.scroll）。
        之前只有 contentContainerStyle，没有 style，ScrollView 会按内容高度撑开、
        溢出父容器却又滚不动 —— 竖屏刚好装得下所以没人发现，
        一横屏（高度只剩 ~390pt）第二个密码框就永远在屏幕外，也上划不出来。
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, compact && styles.scrollContentCompact]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
      >
        <View style={styles.panel}>
          {/* v91 #3：家长模式原来一旦进来只能输密码，没有「回孩子端」的出口。
              放在面板最上方，不影响 PIN 的安全语义（只是退回孩子界面）。 */}
          <TouchableOpacity
            style={styles.exitBtn}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            activeOpacity={0.75}
          >
            <Text style={styles.exitBtnText}>← {t('common.back')}</Text>
          </TouchableOpacity>
          {/* 进门页用可爱浣熊，睡姿 + 呼吸 + 飘 Z 动画（比静态表情更亲切） */}
          <View style={styles.racco}>
            <Racco state="sleeping" size={raccoSize} />
          </View>
          <Text style={[styles.title, compact && styles.titleCompact]}>{t('parentPin.title')}</Text>

          {locked ? (
            <Text style={styles.lockedText}>{t('parentPin.locked')}</Text>
          ) : mode === 'setup' ? (
            <>
              <Text style={styles.label}>{t('parentPin.setupLabel')}</Text>
              <TextInput
                style={styles.input}
                placeholder={t('parentPin.setupPh1')}
                placeholderTextColor="#B9AFA6"
                keyboardType="number-pad"
                maxLength={4}
                value={digits1}
                onChangeText={setDigits1}
                secureTextEntry
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
                placeholder={t('parentPin.setupPh2')}
                placeholderTextColor="#B9AFA6"
                keyboardType="number-pad"
                maxLength={4}
                value={digits2}
                onChangeText={setDigits2}
                secureTextEntry
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.btn} onPress={handleSetupNext}>
                <Text style={styles.btnText}>{t('parentPin.setupDone')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>{t('parentPin.unlockLabel')}</Text>
              {/* Pin dots */}
              <View style={styles.dotsRow}>
                {[0,1,2,3].map(i => (
                  <View key={i} style={i < pinEntry.length ? styles.dotFilled : styles.dot} />
                ))}
              </View>
              {/* Number pad */}
              <View style={styles.keypad}>
                {keys.map((k, i) => (
                  k === '' ? (
                    <View key={`e${i}`} style={styles.keyEmpty} />
                  ) : k === '⌫' ? (
                    <TouchableOpacity key="del" style={styles.key} onPress={handleDelete}>
                      <Text style={styles.keyText}>⌫</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity key={k} style={styles.key} onPress={() => handlePinTap(k)}>
                      <Text style={styles.keyText}>{k}</Text>
                    </TouchableOpacity>
                  )
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5E6',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  /** 必须 flex:1：否则横屏内容溢出父容器却无法滚动 */
  scroll: { flex: 1, width: '100%' },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
  },
  /** 横屏：可用高度小，压缩上下留白 */
  scrollContentCompact: { paddingVertical: 10, justifyContent: 'flex-start' },
  /** 居中面板：竖屏横屏都只占中间一条，不贴左 */
  panel: {
    width: '100%',
    maxWidth: PANEL_MAX_WIDTH,
    alignItems: 'center',
  },
  // 回孩子端的出口（家长面板是 column + 居中，这里靠左单独对齐）
  exitBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.9)',
    marginBottom: 6,
  },
  exitBtnText: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  racco: { alignItems: 'center', marginBottom: 4 },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 32,
    color: '#3D3229',
    textAlign: 'center',
    fontFamily: FONT.rounded,
  },
  titleCompact: { fontSize: 20, marginBottom: 12 },
  label: { fontSize: 16, color: '#7A6A5E', marginBottom: 12, textAlign: 'center' },
  input: {
    width: '100%',
    height: 54,
    borderWidth: 1.5,
    borderColor: '#E8DCD2',
    borderRadius: 18,
    paddingHorizontal: 16,
    fontSize: 20,
    marginBottom: 12,
    backgroundColor: '#fff',
    textAlign: 'center',
    letterSpacing: 6,
    color: '#3D3229',
  },
  btn: {
    marginTop: 16,
    backgroundColor: COLORS.orangeDeep,
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 999,
    minWidth: 200,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  lockedText: { color: '#c0392b', fontSize: 16, textAlign: 'center' },
  dotsRow: { flexDirection: 'row', gap: 16, marginBottom: 24, justifyContent: 'center' },
  dot: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: '#C9BBAF', backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: COLORS.orangeDeep, borderColor: COLORS.orangeDeep },
  keypad: {
    flexDirection: 'row', flexWrap: 'wrap', width: 260,
    justifyContent: 'center', gap: 12,
  },
  key: {
    width: 66, height: 56, borderRadius: 28,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
    elevation: 2,
  },
  keyEmpty: { width: 66, height: 56 },
  keyText: { fontSize: 22, color: '#3D3229' },
});

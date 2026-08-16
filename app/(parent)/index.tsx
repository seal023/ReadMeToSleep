import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, Alert, TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { getSensitiveWords, saveSensitiveWords } from '@/services/storage';

const RACCO_SLEEPING = '🦝💤';
const RACCO_IDLE = '🦝';

export default function ParentIndex() {
  const [mode, setMode] = useState<'setup' | 'unlock'>('setup');
  const [digits1, setDigits1] = useState('');
  const [digits2, setDigits2] = useState('');
  const [pinEntry, setPinEntry] = useState('');
  const [failCount, setFailCount] = useState(0);
  const [locked, setLocked] = useState(false);

  // Check if password already set on mount
  useEffect(() => {
    (async () => {
      const data = await getSensitiveWords();
      setMode(data && data.hasSetup ? 'unlock' : 'setup');
    })();
  }, []);

  // Lockout timer
  useEffect(() => {
    if (!locked || failCount < 3) return;
    const t = setTimeout(() => {
      setLocked(false);
      setFailCount(0);
    }, 30_000);
    return () => clearTimeout(t);
  }, [locked, failCount]);

  // ---- Setup flow ----
  const handleSetupNext = async () => {
    if (digits1.length !== 4 || digits2.length !== 4) {
      Alert.alert('提示', '请输入完整的 4 位数字密码');
      return;
    }
    if (digits1 !== digits2) {
      Alert.alert('提示', '两次输入的密码不一致，请重新输入');
      setDigits1('');
      setDigits2('');
      return;
    }
    await saveSensitiveWords({ words: [], phrases: [], hasSetup: true, pin: digits1 });
    router.push('/(parent)/hub');
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
      const data = await getSensitiveWords();
      if (!data || data.pin !== pin) {
        const newCount = failCount + 1;
        setFailCount(newCount);
        setPinEntry('');
        if (newCount >= 3) {
          setLocked(true);
          Alert.alert('锁定', '密码错误次数过多，请等待 30 秒后重试');
        } else {
          Alert.alert('错误', `密码错误 (${newCount}/3)`);
        }
        return;
      }
      router.push('/(parent)/hub');
    } catch {
      Alert.alert('错误', '验证失败，请重试');
    }
  };

  // Numeric keypad layout
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  return (
    <View style={styles.container}>
      <Text style={styles.racco}>{RACCO_SLEEPING}</Text>
      <Text style={styles.title}>家长模式</Text>

      {locked ? (
        <Text style={styles.lockedText}>⏳ 已锁定，请稍后再试</Text>
      ) : mode === 'setup' ? (
        <>
          <Text style={styles.label}>设置 4 位数字密码</Text>
          <TextInput
            style={styles.input}
            placeholder="第一次输入密码"
            keyboardType="number-pad"
            maxLength={4}
            value={digits1}
            onChangeText={setDigits1}
            secureTextEntry
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="再次输入密码"
            keyboardType="number-pad"
            maxLength={4}
            value={digits2}
            onChangeText={setDigits2}
            secureTextEntry
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.btn} onPress={handleSetupNext}>
            <Text style={styles.btnText}>完成设置</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>输入密码解锁</Text>
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5E6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  racco: { fontSize: 140, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 32, color: '#333' },
  label: { fontSize: 16, color: '#555', marginBottom: 12 },
  input: {
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 18,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  btn: {
    marginTop: 16,
    backgroundColor: '#FF6B6B',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  lockedText: { color: '#c00', fontSize: 16, textAlign: 'center' },
  dotsRow: { flexDirection: 'row', gap: 16, marginBottom: 24 },
  dot: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: '#aaa', backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: '#FF6B6B', borderColor: '#FF6B6B' },
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
  keyText: { fontSize: 22, color: '#333' },
});

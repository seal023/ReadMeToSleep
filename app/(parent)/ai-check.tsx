import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { COLORS, FONT } from '../../constants/theme';
import { useLanguage } from '../../hooks/useLanguage';
import { runAiDiagnosis, type AiDiagResult } from '../../services/aiDiag';

/**
 * AI 连接自检（家长端）
 *
 * 存在的理由：EXPO_PUBLIC_* 是构建期内联的，打包后在电脑上完全看不到真机里到底是哪个值。
 * 而 Key 失效的表现是「故事照常出来，只是变成 4 篇本地兜底故事」，肉眼极难分辨。
 * 这一页把 key 长度、实际地址、HTTP 状态码原样摊开，一次截图就能定位问题在 Key、地址还是构建注入。
 */
export default function AiCheckScreen() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<AiDiagResult | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await runAiDiagnosis());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  const verdict = result?.verdict ?? 'unknown';
  const tone =
    verdict === 'ok'
      ? { bg: '#E8F7EC', border: '#8FD3A3', text: '#1E6B36', icon: '✅' }
      : verdict === 'network' || verdict === 'missing_key' || verdict === 'invalid_key'
        ? { bg: '#FDECEC', border: '#F2A9A9', text: '#9B2C2C', icon: '❌' }
        : { bg: '#FFF6E5', border: '#F0C987', text: '#8A5A00', icon: '⚠️' };

  return (
    <CartoonScreen gradient="day" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('aicheck.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <Text style={styles.desc}>{t('aicheck.subtitle')}</Text>

        {loading && (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={COLORS.orange} />
            <Text style={styles.loadingText}>{t('aicheck.running')}</Text>
          </View>
        )}

        {!loading && result && (
          <>
            <View style={[styles.verdictCard, { backgroundColor: tone.bg, borderColor: tone.border }]}>
              <Text style={styles.verdictIcon}>{tone.icon}</Text>
              <Text style={[styles.verdictText, { color: tone.text }]}>
                {t(`aicheck.verdict.${verdict}`)}
              </Text>
            </View>

            <View style={styles.card}>
              <Row
                label={t('aicheck.key')}
                value={
                  result.keyPresent
                    ? t('aicheck.keyPresent')
                        .replace('{n}', String(result.keyLength))
                        .replace('{p}', result.keyPrefix)
                    : t('aicheck.keyAbsent')
                }
                highlight={!result.keyPresent}
              />
              {result.keyPresent && result.keyHasWhitespace && (
                <Text style={styles.warn}>{t('aicheck.keyWhitespace')}</Text>
              )}
              {result.keyPresent && !result.keyStandard && (
                <Text style={styles.warn}>{t('aicheck.keyNonStandard')}</Text>
              )}
              <Row label={t('aicheck.baseUrl')} value={result.baseUrl} small />
              <Row
                label={t('aicheck.originSource')}
                value={t(`aicheck.origin.${result.originSource}`)}
                highlight={result.originSource === 'env-corrected' || result.originSource === 'none'}
              />
              <Row
                label={t('aicheck.workspaceId')}
                value={result.workspaceId || t('aicheck.workspaceAbsent')}
                highlight={!result.workspaceId}
              />
              <Row label={t('aicheck.model')} value={result.model} />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('aicheck.probes')}</Text>
              {result.probes.map((p, i) => (
                <View key={i} style={styles.probeRow}>
                  <Text style={styles.probeLabel}>{t(`aicheck.probe.${p.label}`)}</Text>
                  <Text style={[styles.probeStatus, { color: p.ok ? '#1E6B36' : '#9B2C2C' }]}>
                    {p.ok
                      ? `✅ ${t('aicheck.probe.ok')} · ${p.status} · ${p.ms}ms`
                      : `❌ ${t('aicheck.probe.fail')} · ${p.status ?? '—'}${p.code ? ` · ${p.code}` : ''}`}
                  </Text>
                  {!p.ok && !!p.message && (
                    <Text style={styles.probeMsg} numberOfLines={3}>{p.message}</Text>
                  )}
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.againBtn} onPress={run}>
              <Text style={styles.againBtnText}>{t('aicheck.again')}</Text>
            </TouchableOpacity>

            <Text style={styles.hint}>{t('aicheck.hint')}</Text>
          </>
        )}
      </ScrollView>
    </CartoonScreen>
  );
}

function Row({
  label, value, small, highlight,
}: { label: string; value: string; small?: boolean; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          small && styles.rowValueSmall,
          highlight && styles.rowValueBad,
        ]}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20, paddingBottom: 40,
    width: '100%', maxWidth: 760, alignSelf: 'center',
  },
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
  desc: { fontSize: 13, color: COLORS.textSub, lineHeight: 20, marginBottom: 16 },

  loadingCard: {
    backgroundColor: COLORS.card, borderRadius: 20, padding: 24,
    alignItems: 'center', gap: 12,
  },
  loadingText: { fontSize: 14, color: COLORS.textSub },

  verdictCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 20, borderWidth: 1.5, padding: 16, marginBottom: 14,
  },
  verdictIcon: { fontSize: 24 },
  verdictText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600' },

  card: {
    backgroundColor: COLORS.card, borderRadius: 20, padding: 16, marginBottom: 14, gap: 10,
  },
  cardTitle: { fontSize: 14, color: COLORS.textSub, marginBottom: 2 },

  row: { gap: 4 },
  rowLabel: { fontSize: 12, color: COLORS.textSub },
  rowValue: { fontSize: 14, color: COLORS.text, lineHeight: 20 },
  rowValueSmall: { fontSize: 12, color: COLORS.textSub },
  rowValueBad: { color: '#9B2C2C' },
  warn: { fontSize: 12, color: '#B45309' },

  probeRow: { gap: 3, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EEE' },
  probeLabel: { fontSize: 13, color: COLORS.text },
  probeStatus: { fontSize: 13, fontWeight: '600' },
  probeMsg: { fontSize: 11, color: COLORS.textSub, lineHeight: 16 },

  againBtn: {
    backgroundColor: COLORS.orange, borderRadius: 24, paddingVertical: 14,
    alignItems: 'center', marginTop: 4,
  },
  againBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12, color: COLORS.textSub, textAlign: 'center', marginTop: 14 },
});

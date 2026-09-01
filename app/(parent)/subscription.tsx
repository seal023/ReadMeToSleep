import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import {
  FALLBACK_PRICES,
  isIapSupported,
  loadOffers,
  openManageSubscriptions,
  purchasePlan,
  refreshEntitlement,
  restorePurchasesAsync,
  type Entitlement,
  type PaidPlan,
  type Plan,
  type PlanOffer,
} from '@/services/iap';

// ---------------------------------------------------------------------------
// ⚠️ 上架前必须替换为真实可访问的 URL（Apple 对订阅类 App 的硬性要求 3.1.2）
//    建议托管到 GitHub Pages / Vercel 等静态站点
// ---------------------------------------------------------------------------
const TERMS_URL = 'https://example.com/readmetosleep/terms.html';
const PRIVACY_URL = 'https://example.com/readmetosleep/privacy.html';

type FeatureRow = {
  feature: string;
  free: boolean | string;
  monthly: boolean | string;
  yearly: boolean | string;
};

const FEATURES: FeatureRow[] = [
  { feature: '每日故事数', free: '1个', monthly: '无限', yearly: '无限' },
  { feature: '克隆声音', free: false, monthly: true, yearly: true },
  { feature: '旅行打卡', free: '3次', monthly: '无限', yearly: '无限' },
  { feature: '离线下载', free: false, monthly: true, yearly: true },
  { feature: '自定义角色皮肤', free: false, monthly: false, yearly: true },
  { feature: '家长控制面板', free: true, monthly: true, yearly: true },
];

const STATUS_MAP: Record<Plan, { label: string; color: string }> = {
  free: { label: '免费版', color: '#95a5a6' },
  monthly: { label: '月度会员', color: '#6c5ce7' },
  yearly: { label: '年度会员', color: '#00b894' },
};

function Cell({ val }: { val: boolean | string }) {
  if (val === true) return <Text style={styles.td}>✅</Text>;
  if (val === false) return <Text style={styles.td}>❌</Text>;
  return <Text style={styles.td}>{String(val)}</Text>;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function SubscriptionPage() {
  /** 用户当前实际拥有的方案（来自 App Store 校验） */
  const [activePlan, setActivePlan] = useState<Plan>('free');
  /** 用户在卡片上选中的方案（尚未购买） */
  const [selected, setSelected] = useState<PaidPlan>('yearly');
  const [offers, setOffers] = useState<PlanOffer[] | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // 进入页面时：拉取真实价格 + 校验订阅状态
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!isIapSupported) {
        if (alive) setInitializing(false);
        return;
      }
      try {
        const [loadedOffers, current] = await Promise.all([
          loadOffers(),
          refreshEntitlement(),
        ]);
        if (!alive) return;
        setOffers(loadedOffers);
        setEntitlement(current);
        if (current && current.expiryMs > Date.now()) setActivePlan(current.plan);
      } catch (err) {
        console.warn('[Subscription] init failed:', err);
      } finally {
        if (alive) setInitializing(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const priceOf = useCallback(
    (plan: PaidPlan, suffix: string) => {
      const offer = offers?.find((o) => o.plan === plan);
      const price = offer?.displayPrice || FALLBACK_PRICES[plan];
      return `${price}${suffix}`;
    },
    [offers]
  );

  const handlePurchase = async () => {
    if (!isIapSupported) {
      Alert.alert('提示', '此功能需要使用正式构建版本，开发环境暂不支持购买。');
      return;
    }
    if (busy) return;

    setBusy(true);
    try {
      const result = await purchasePlan(selected);
      setEntitlement(result);
      setActivePlan(result.plan);
      Alert.alert('订阅成功 🎉', '感谢你的支持，会员权益已生效。');
    } catch (err) {
      const cancelled = (err as { userCancelled?: boolean } | null)?.userCancelled;
      if (!cancelled) {
        Alert.alert('购买未完成', (err as Error)?.message || '请稍后重试');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!isIapSupported) {
      Alert.alert('提示', '此功能需要使用正式构建版本，开发环境暂不支持恢复购买。');
      return;
    }
    if (busy) return;

    setBusy(true);
    try {
      const restored = await restorePurchasesAsync();
      if (restored && restored.expiryMs > Date.now()) {
        setEntitlement(restored);
        setActivePlan(restored.plan);
        Alert.alert(
          '恢复成功 ✅',
          `已恢复「${STATUS_MAP[restored.plan].label}」，有效期至 ${formatDate(restored.expiryMs)}。`
        );
      } else {
        setEntitlement(null);
        setActivePlan('free');
        Alert.alert('未找到订阅', '当前 Apple ID 下没有有效的订阅记录。');
      }
    } catch (err) {
      Alert.alert('恢复失败', (err as Error)?.message || '请检查网络后重试');
    } finally {
      setBusy(false);
    }
  };

  const handleManage = async () => {
    const opened = await openManageSubscriptions();
    if (!opened) {
      Alert.alert('提示', '无法打开订阅管理，请在 iOS「设置 → Apple ID → 订阅」中管理。');
    }
  };

  const openLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('提示', '无法打开链接，请稍后重试。');
    }
  };

  const status = STATUS_MAP[activePlan];
  const isSubscribed = activePlan !== 'free' && !!entitlement && entitlement.expiryMs > Date.now();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 当前订阅状态 */}
      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>当前订阅</Text>
        <View style={[styles.badge, { backgroundColor: status.color }]}>
          <Text style={styles.badgeText}>{status.label}</Text>
        </View>
        {isSubscribed && entitlement ? (
          <Text style={styles.expiryText}>
            {entitlement.autoRenewing ? '自动续订中' : '到期后不再续订'} · 有效期至{' '}
            {formatDate(entitlement.expiryMs)}
          </Text>
        ) : (
          <Text style={styles.upgradePrompt}>升级享受更多功能 ✨</Text>
        )}
        {initializing && <ActivityIndicator style={{ marginTop: 10 }} color="#6c5ce7" />}
      </View>

      {/* 功能对比 */}
      <Text style={styles.sectionTitle}>功能对比</Text>
      <View style={styles.tableOuter}>
        <View style={styles.tableHeader}>
          <Text style={[styles.th, { flex: 2 }]}>功能</Text>
          <Text style={[styles.th, { flex: 1 }]}>免费</Text>
          <Text style={[styles.th, { flex: 1 }]}>月度</Text>
          <Text style={[styles.th, { flex: 1 }]}>年度</Text>
        </View>
        {FEATURES.map((row, i) => (
          <View key={i} style={[styles.tableRow, i % 2 === 0 && styles.rowEven]}>
            <Text style={[styles.td, { flex: 2 }]}>{row.feature}</Text>
            <Cell val={row.free} />
            <Cell val={row.monthly} />
            <Cell val={row.yearly} />
          </View>
        ))}
      </View>

      {/* 选择方案 */}
      <Text style={styles.sectionTitle}>选择方案</Text>
      <View style={styles.planCards}>
        <TouchableOpacity
          style={[styles.planCard, selected === 'monthly' && styles.planActive]}
          onPress={() => setSelected('monthly')}
          disabled={busy}
        >
          <Text style={styles.planName}>月度会员</Text>
          <Text style={styles.planPrice}>{priceOf('monthly', '/月')}</Text>
          <Text style={styles.planDesc}>灵活订阅，随时取消</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.planCard, styles.yearBest, selected === 'yearly' && styles.planActive]}
          onPress={() => setSelected('yearly')}
          disabled={busy}
        >
          <View style={styles.bestBadge}>
            <Text style={styles.bestText}>省 40%</Text>
          </View>
          <Text style={styles.planName}>年度会员</Text>
          <Text style={styles.planPrice}>{priceOf('yearly', '/年')}</Text>
          <Text style={styles.planDesc}>约 ¥14/月，最划算</Text>
        </TouchableOpacity>
      </View>

      {/* 购买 */}
      <TouchableOpacity
        style={[styles.buyBtn, busy && styles.btnDisabled]}
        onPress={handlePurchase}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buyBtnText}>
            {isSubscribed ? '更换方案' : '🚀 开始订阅'}
          </Text>
        )}
      </TouchableOpacity>

      {/* 恢复 / 管理 */}
      <View style={styles.linkRow}>
        <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} disabled={busy}>
          <Text style={styles.restoreText}>恢复购买</Text>
        </TouchableOpacity>
        {isSubscribed && (
          <TouchableOpacity style={styles.restoreBtn} onPress={handleManage} disabled={busy}>
            <Text style={styles.restoreText}>管理订阅</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 订阅条款说明（Apple 3.1.2 要求） */}
      <View style={styles.legalBox}>
        <Text style={styles.legalText}>
          · 确认购买后，费用将从你的 Apple ID 账户扣除。{'\n'}·
          订阅会在当前周期结束前 24 小时内自动续订，除非提前至少 24 小时关闭自动续订。
          {'\n'}· 可在 Apple ID 账户设置中管理或取消订阅。
        </Text>
        <View style={styles.legalLinks}>
          <TouchableOpacity onPress={() => openLink(TERMS_URL)}>
            <Text style={styles.legalLink}>服务条款</Text>
          </TouchableOpacity>
          <Text style={styles.dot}>·</Text>
          <TouchableOpacity onPress={() => openLink(PRIVACY_URL)}>
            <Text style={styles.legalLink}>隐私政策</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f0ff' },
  content: { padding: 20, paddingBottom: 40 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#4a3080', marginVertical: 8 },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  statusLabel: { fontSize: 14, color: '#999' },
  badge: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, marginTop: 8 },
  badgeText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  upgradePrompt: { fontSize: 13, color: '#e67e22', marginTop: 10 },
  expiryText: { fontSize: 12, color: '#888', marginTop: 10 },
  tableOuter: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 20,
  },
  tableHeader: { flexDirection: 'row', backgroundColor: '#6c5ce7', paddingVertical: 10 },
  th: { color: '#fff', fontWeight: '600', textAlign: 'center', fontSize: 13 },
  tableRow: { flexDirection: 'row', paddingVertical: 10 },
  rowEven: { backgroundColor: '#faf8ff' },
  td: { flex: 1, textAlign: 'center', fontSize: 13, color: '#333' },
  planCards: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  planCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0d6eb',
  },
  planActive: { borderColor: '#6c5ce7', backgroundColor: '#f0edff' },
  yearBest: { position: 'relative' },
  bestBadge: {
    position: 'absolute',
    top: -8,
    left: '50%',
    transform: [{ translateX: -36 }],
    backgroundColor: '#e74c3c',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  bestText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  planName: { fontSize: 16, fontWeight: '600', color: '#2d1b69', marginTop: 6 },
  planPrice: { fontSize: 22, fontWeight: 'bold', color: '#6c5ce7', marginVertical: 6 },
  planDesc: { fontSize: 12, color: '#999', textAlign: 'center' },
  buyBtn: {
    backgroundColor: '#6c5ce7',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  buyBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 14,
  },
  restoreBtn: { alignItems: 'center' },
  restoreText: { color: '#6c5ce7', fontSize: 14 },
  legalBox: {
    marginTop: 22,
    padding: 14,
    backgroundColor: '#efeaff',
    borderRadius: 12,
  },
  legalText: { fontSize: 11, color: '#6b5b95', lineHeight: 18 },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  legalLink: { fontSize: 12, color: '#6c5ce7', textDecorationLine: 'underline' },
  dot: { color: '#6b5b95', fontSize: 12 },
});

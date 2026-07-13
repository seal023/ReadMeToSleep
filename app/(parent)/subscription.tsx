import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

type Plan = 'free' | 'monthly' | 'yearly';

interface FeatureRow {
  feature: string;
  free: boolean | string;
  monthly: boolean | string;
  yearly: boolean | string;
}

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

export default function SubscriptionPage() {
  const [plan, setPlan] = useState<Plan>('free');

  const handlePurchase = async (p: Plan) => {
    // TODO: 接入 IAP (react-native-iap / expo-in-app-purchases)
    // const productId = p === 'monthly' ? 'com.readmesleep.monthly' : 'com.readmesleep.yearly';
    // const purchase = await purchaseAsync(productId);
    // if (purchase.transactionReceipt) {
    //   const verified = await verifyReceipt(purchase);
    //   if (verified.valid) { setPlan(p); }
    // }
  };

  const handleRestore = async () => {
    // TODO: 恢复购买 - getAvailablePurchases() → restore transactions
    try {
      // const purchases = await getAvailablePurchases();
      // for (const p of purchases) { /* match productId → update plan */ }
    } catch (err) {
      console.error('Restore Error:', err);
    }
  };

  const status = STATUS_MAP[plan];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Current Status */}
      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>当前订阅</Text>
        <View style={[styles.badge, { backgroundColor: status.color }]}>
          <Text style={styles.badgeText}>{status.label}</Text>
        </View>
        {plan === 'free' && <Text style={styles.upgradePrompt}>升级享受更多功能 ✨</Text>}
      </View>

      {/* Comparison Table */}
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

      {/* Purchase Cards */}
      <Text style={styles.sectionTitle}>选择方案</Text>
      <View style={styles.planCards}>
        <TouchableOpacity
          style={[styles.planCard, plan === 'monthly' && styles.planActive]}
          onPress={() => setPlan('monthly')}
        >
          <Text style={styles.planName}>月度会员</Text>
          <Text style={styles.planPrice}>¥28{plan === 'monthly' ? '/月' : ''}</Text>
          {plan === 'monthly' && <Text style={styles.planDesc}>灵活订阅，随时取消</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.planCard, styles.yearBest, plan === 'yearly' && styles.planActive]}
          onPress={() => setPlan('yearly')}
        >
          <View style={styles.bestBadge}><Text style={styles.bestText}>省 40%</Text></View>
          <Text style={styles.planName}>年度会员</Text>
          <Text style={styles.planPrice}>¥168{plan === 'yearly' ? '/年' : ''}</Text>
          {plan === 'yearly' && <Text style={styles.planDesc}>约 ¥14/月，最划算</Text>}
        </TouchableOpacity>
      </View>

      {/* Buy Buttons */}
      <TouchableOpacity style={styles.buyBtn} onPress={() => handlePurchase(plan === 'free' ? 'monthly' : plan === 'monthly' ? 'yearly' : 'yearly')}>
        <Text style={styles.buyBtnText}>
          {plan === 'free' ? '🚀 开始订阅' : '确认更换方案'}
        </Text>
      </TouchableOpacity>

      {/* Restore Purchase */}
      <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore}>
        <Text style={styles.restoreText}>恢复购买</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f0ff' },
  content: { padding: 20, paddingBottom: 40 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#4a3080', marginVertical: 8 },
  statusCard: { backgroundColor: '#fff', borderRadius: 14, padding: 20, alignItems: 'center', marginBottom: 20 },
  statusLabel: { fontSize: 14, color: '#999' },
  badge: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, marginTop: 8 },
  badgeText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  upgradePrompt: { fontSize: 13, color: '#e67e22', marginTop: 10 },
  tableOuter: { backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden', marginBottom: 20 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#6c5ce7', paddingVertical: 10 },
  th: { color: '#fff', fontWeight: '600', textAlign: 'center', fontSize: 13 },
  tableRow: { flexDirection: 'row', paddingVertical: 10 },
  rowEven: { backgroundColor: '#faf8ff' },
  td: { flex: 1, textAlign: 'center', fontSize: 13, color: '#333' },
  planCards: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  planCard: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 2, borderColor: '#e0d6eb' },
  planActive: { borderColor: '#6c5ce7', backgroundColor: '#f0edff' },
  yearBest: { position: 'relative' },
  bestBadge: { position: 'absolute', top: -8, left: '50%', transform: [{ translateX: -36 }], backgroundColor: '#e74c3c', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  bestText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  planName: { fontSize: 16, fontWeight: '600', color: '#2d1b69', marginTop: 6 },
  planPrice: { fontSize: 22, fontWeight: 'bold', color: '#6c5ce7', marginVertical: 6 },
  planDesc: { fontSize: 12, color: '#999' },
  buyBtn: { backgroundColor: '#6c5ce7', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  buyBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  restoreBtn: { marginTop: 12, alignItems: 'center' },
  restoreText: { color: '#6c5ce7', fontSize: 14 },
});

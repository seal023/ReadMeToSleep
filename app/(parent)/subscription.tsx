import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { useIAP } from '@/hooks/useIAP';
import { useAuth } from '@/hooks/useAuth';
import Racco from '@/components/common/Racco';
import { CartoonScreen } from '@/components/ui/CartoonScreen';
import { COLORS, FONT } from '@/constants/theme';
import type { PaidPlan, Plan } from '@/services/iap';

// ---------------------------------------------------------------------------
// ⚠️ 上架前必须替换为真实可访问的 URL（Apple 对订阅类 App 的硬性要求 3.1.2）
//    建议托管到 GitHub Pages / Vercel 等静态站点
// ---------------------------------------------------------------------------
const TERMS_URL = 'https://seal023.github.io/ReadMeToSleep/terms.html';
const PRIVACY_URL = 'https://seal023.github.io/ReadMeToSleep/privacy.html';

// ---------------------------------------------------------------------------
// 定价文案（与 App Store Connect 商品一致：月度 $4.99 / 年度 $24.99 预付）
//   年度折算：$24.99 / 12 ≈ $2.08 每月
//   相比按月订阅：$4.99 × 12 = $59.88 → 省 (59.88-24.99)/59.88 ≈ 58%
// ---------------------------------------------------------------------------
const MONTHLY_EQUIVALENT = '$2.08';
const YEARLY_SAVING = '省 58%';

type FeatureRow = {
  feature: string;
  free: boolean | string;
  monthly: boolean | string;
  yearly: boolean | string;
};

/**
 * ⚠️ 这张表必须与代码实际行为严格一致——Apple 会按 Guideline 2.3.1
 *    （描述与实际不符）抽查。之前表里的「离线下载」「自定义角色皮肤」
 *    在项目中根本不存在实现，属不实描述，已移除。
 *
 *    额度常量定义在 services/entitlement.ts：
 *      FREE_DAILY_STORY_LIMIT = 1、FREE_TOTAL_CHECKIN_LIMIT = 3
 */
const FEATURES: FeatureRow[] = [
  { feature: '每日故事数', free: '1个', monthly: '无限', yearly: '无限' },
  { feature: '克隆声音', free: false, monthly: true, yearly: true },
  { feature: '旅行打卡', free: '3次', monthly: '无限', yearly: '无限' },
  { feature: '家长控制面板', free: true, monthly: true, yearly: true },
];

const STATUS_MAP: Record<Plan, { label: string; color: string }> = {
  free: { label: '免费版', color: '#B9AFA6' },
  monthly: { label: '月度会员', color: '#9B7EDE' },
  yearly: { label: '年度会员', color: '#5FC3A4' },
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

/** 凭证里的一行「标签 —— 值」 */
function ReceiptRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={[styles.receiptValue, mono && styles.receiptMono]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function SubscriptionPage() {
  /** 用户在卡片上选中的方案（尚未购买） */
  const [selected, setSelected] = useState<PaidPlan>('yearly');
  /** 用户是否手动点过方案卡；没点过就跟随「当前订阅」自动定位 */
  const pickedRef = useRef(false);

  const router = useRouter();
  // 会员权益要绑在账号上：未登录就购买，换手机将无法证明"是本人付的费"
  const { isSignedIn, email: accountEmail, displayName } = useAuth();

  const {
    initializing,
    busy,
    offers,
    entitlement,
    isSubscribed,
    activePlan,
    supported,
    priceOf,
    purchase,
    restore,
    manage,
    refresh,
  } = useIAP();

  // 从登录页返回后必须重新读一次权益：登录会触发静默找回会员，
  // 但本页一直在导航栈里、不会重新挂载，不刷新就会显示旧状态。
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  /**
   * 默认选中项跟随「当前订阅」。
   *
   * 构建 73 反馈「顶部写月度会员、下面年度卡却高亮」的根源就在这里：
   * selected 默认写死 'yearly'，而「选中态」与「当前方案」用的是同一套紫色边框，
   * 一个页面里两处信息互相打架，看起来像显示错了。
   * 现在：用户没手动点过 → 选中项自动对齐真实订阅；手动点过 → 尊重用户选择，
   * 并在卡片上加「当前」角标，把「正在生效的方案」和「准备购买的方案」区分开。
   */
  useEffect(() => {
    if (pickedRef.current) return;
    if (isSubscribed && (activePlan === 'monthly' || activePlan === 'yearly')) {
      setSelected(activePlan);
    }
  }, [isSubscribed, activePlan]);

  /** 已订阅但选中的是另一个方案 = 准备更换方案 */
  const switching = isSubscribed && activePlan !== 'free' && selected !== activePlan;

  const handlePurchase = async () => {
    if (!supported) {
      Alert.alert('提示', '此功能需要使用正式构建版本，开发环境暂不支持购买。');
      return;
    }
    // 购买前先登录：缴费凭证必须挂在一个明确账号上，否则客户换手机后无从证明
    if (!isSignedIn) {
      router.push('/auth/perks');
      return;
    }
    try {
      const result = await purchase(selected);
      if (!result) return; // 用户取消，不打扰
      Alert.alert(
        '订阅成功 🎉',
        `已开通「${STATUS_MAP[result.plan].label}」，有效期至 ${formatDate(result.expiryMs)}。\n\n` +
          `这笔订阅已记在你的账号 ${accountEmail || displayName} 名下，换手机用同一账号登录即可找回。`
      );
    } catch (err) {
      Alert.alert('购买未完成', (err as Error)?.message || '请稍后重试');
    }
  };

  const handleRestore = async () => {
    if (!supported) {
      Alert.alert('提示', '此功能需要使用正式构建版本，开发环境暂不支持恢复购买。');
      return;
    }
    try {
      const restored = await restore();
      if (restored) {
        Alert.alert(
          '恢复成功 ✅',
          `已恢复「${STATUS_MAP[restored.plan].label}」，有效期至 ${formatDate(restored.expiryMs)}。`
        );
      } else {
        Alert.alert(
          '未找到订阅',
          '当前 App Store 登录的 Apple ID 下没有有效订阅。\n\n请确认：\n· 用的是当初购买时那个 Apple ID\n· 在「设置 → Apple ID → 媒体与购买项目」里查看当前登录的账号'
        );
      }
    } catch (err) {
      Alert.alert('恢复失败', (err as Error)?.message || '请检查网络后重试');
    }
  };

  const handleManage = async () => {
    const opened = await manage();
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
  const usingShopPrice = !!offers;

  return (
    <CartoonScreen gradient="candy" decor>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Racco 吉祥物 */}
      <View style={styles.raccoTop}>
        <Racco state="happy" size={90} />
      </View>

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
        {switching && (
          <Text style={styles.switchHint}>
            已选「{STATUS_MAP[selected].label}」，确认购买后按 App Store 提示生效
          </Text>
        )}
        {initializing && <ActivityIndicator style={{ marginTop: 10 }} color="#6c5ce7" />}
      </View>

      {/* 账号归属：让家长一眼看到"这笔会员是记在谁名下的" */}
      <TouchableOpacity
        style={styles.accountRow}
        activeOpacity={0.85}
        onPress={() => router.push(isSignedIn ? '/(parent)/account' : '/auth/login')}
      >
        <Text style={styles.accountEmoji}>{isSignedIn ? '👤' : '🔑'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.accountTitle} numberOfLines={1}>
            {isSignedIn ? `已登录：${accountEmail || displayName}` : '尚未登录'}
          </Text>
          <Text style={styles.accountSub}>
            {isSignedIn
              ? '会员记在这个账号上，换手机登录后可找回'
              : '登录后才能开通会员，缴费凭证会记在账号上'}
          </Text>
        </View>
        {!isSignedIn && <Text style={styles.accountArrow}>去登录</Text>}
      </TouchableOpacity>

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
      {!usingShopPrice && supported && (
        <Text style={styles.priceHint}>暂时无法获取商店价格，以下为参考价</Text>
      )}
      <View style={styles.planCards}>
        <TouchableOpacity
          style={[styles.planCard, selected === 'monthly' && styles.planActive]}
          onPress={() => {
            pickedRef.current = true;
            setSelected('monthly');
          }}
          disabled={busy}
        >
          {activePlan === 'monthly' && (
            <View style={styles.currentBadge}>
              <Text style={styles.currentText}>当前</Text>
            </View>
          )}
          <Text style={styles.planName}>月度会员</Text>
          <Text style={styles.planPrice}>{priceOf('monthly')}</Text>
          <Text style={styles.planUnit}>每月</Text>
          <Text style={styles.planDesc}>自动续订，随时取消</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.planCard, styles.yearBest, selected === 'yearly' && styles.planActive]}
          onPress={() => {
            pickedRef.current = true;
            setSelected('yearly');
          }}
          disabled={busy}
        >
          {activePlan === 'yearly' && (
            <View style={styles.currentBadge}>
              <Text style={styles.currentText}>当前</Text>
            </View>
          )}
          <View style={styles.bestBadge}>
            <Text style={styles.bestText}>{YEARLY_SAVING}</Text>
          </View>
          <Text style={styles.planName}>年度会员</Text>
          <Text style={styles.planPrice}>{priceOf('yearly')}</Text>
          <Text style={styles.planUnit}>每年</Text>
          <Text style={styles.planDesc}>约 {MONTHLY_EQUIVALENT}/月，一次性预付</Text>
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

      {/* 订阅凭证：客户缴费后要能自己核对/截图留存的凭据 */}
      {isSubscribed && entitlement && (
        <View style={styles.receiptCard}>
          <Text style={styles.receiptTitle}>🧾 订阅凭证</Text>
          <ReceiptRow label="订阅方案" value={STATUS_MAP[entitlement.plan].label} />
          <ReceiptRow
            label="购买账号"
            value={accountEmail || (isSignedIn ? displayName : '未登录（建议登录后绑定）')}
          />
          {!!entitlement.purchasedAtMs && (
            <ReceiptRow label="购买日期" value={formatDate(entitlement.purchasedAtMs)} />
          )}
          <ReceiptRow label="有效期至" value={formatDate(entitlement.expiryMs)} />
          <ReceiptRow
            label="续订状态"
            value={entitlement.autoRenewing ? '自动续订中' : '到期后不再续订'}
          />
          {!!entitlement.transactionId && (
            <ReceiptRow label="交易号" value={entitlement.transactionId} mono />
          )}
          <TouchableOpacity
            onPress={() => openLink('https://apps.apple.com/account/subscriptions')}
            hitSlop={6}
          >
            <Text style={styles.receiptLink}>在 App Store 查看官方购买记录 ›</Text>
          </TouchableOpacity>
          <Text style={styles.receiptHint}>
            App Store 会把收据邮件发到你 Apple ID 的邮箱，那是可用于报销的正式凭据。
          </Text>
        </View>
      )}

      {/* 订阅条款说明（Apple 3.1.2 要求） */}
      <View style={styles.legalBox}>
        <Text style={styles.legalText}>
          · 确认购买后，费用将从你的 Apple ID 账户扣除。{'\n'}·
          月度订阅会在当前周期结束前 24 小时内自动续订，除非提前至少 24 小时关闭自动续订。
          {'\n'}· 年度订阅为一次性预付，到期后不会自动续订。{'\n'}·
          可在 Apple ID 账户设置中管理或取消订阅。
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
    </CartoonScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  raccoTop: { alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 17, color: COLORS.purple, marginVertical: 8, fontFamily: FONT.rounded },
  priceHint: { fontSize: 11, color: '#A8988A', marginBottom: 8, textAlign: 'center' },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  statusLabel: { fontSize: 14, color: '#A8988A' },
  badge: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 24, marginTop: 8 },
  badgeText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  upgradePrompt: { fontSize: 13, color: '#e67e22', marginTop: 10 },
  expiryText: { fontSize: 12, color: '#A8988A', marginTop: 10 },
  switchHint: {
    fontSize: 12,
    color: '#9B7EDE',
    marginTop: 8,
    textAlign: 'center',
    backgroundColor: '#F0EAFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  tableOuter: {
    backgroundColor: '#fff',
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 20,
  },
  tableHeader: { flexDirection: 'row', backgroundColor: '#9B7EDE', paddingVertical: 10 },
  th: { color: '#fff', fontWeight: '600', textAlign: 'center', fontSize: 13 },
  tableRow: { flexDirection: 'row', paddingVertical: 10 },
  rowEven: { backgroundColor: '#faf8ff' },
  td: { flex: 1, textAlign: 'center', fontSize: 13, color: '#3D3229' },
  planCards: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  planCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0d6eb',
  },
  planActive: { borderColor: '#9B7EDE', backgroundColor: '#f0edff' },
  yearBest: { position: 'relative' },
  // 角标：区分「正在生效的方案」与「准备购买的方案」
  currentBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#5FC3A4',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  currentText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  bestBadge: {
    position: 'absolute',
    top: -8,
    left: '50%',
    transform: [{ translateX: -36 }],
    backgroundColor: '#F2827F',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 18,
  },
  bestText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  planName: { fontSize: 16, fontWeight: '600', color: '#3D3229', marginTop: 6 },
  planPrice: { fontSize: 22, fontWeight: 'bold', color: '#9B7EDE', marginVertical: 2 },
  planUnit: { fontSize: 12, color: '#A8988A' },
  planDesc: { fontSize: 12, color: '#A8988A', textAlign: 'center', marginTop: 6 },
  buyBtn: {
    backgroundColor: '#9B7EDE',
    borderRadius: 22,
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
  restoreText: { color: '#9B7EDE', fontSize: 14 },

  // —— 账号归属行 ——
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#E8DDF7',
  },
  accountEmoji: { fontSize: 22, marginRight: 10 },
  accountTitle: { fontSize: 14, fontWeight: '700', color: '#3D3229' },
  accountSub: { fontSize: 11.5, color: '#9C8579', marginTop: 3, lineHeight: 16 },
  accountArrow: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#9B7EDE',
    marginLeft: 8,
    backgroundColor: '#F0EAFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },

  // —— 订阅凭证 ——
  receiptCard: {
    backgroundColor: '#FFFDF7',
    borderRadius: 24,
    padding: 16,
    marginTop: 6,
    borderWidth: 1.5,
    borderColor: '#F0E0C0',
  },
  receiptTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#3D3229',
    marginBottom: 10,
  },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  receiptLabel: { fontSize: 12.5, color: '#9C8579' },
  receiptValue: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#3D3229',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  receiptMono: { fontFamily: undefined, letterSpacing: 0.2 },
  receiptLink: {
    fontSize: 12.5,
    color: '#9B7EDE',
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginTop: 12,
  },
  receiptHint: {
    fontSize: 11,
    color: '#B9A79C',
    lineHeight: 16,
    marginTop: 8,
  },
  legalBox: {
    marginTop: 22,
    padding: 14,
    backgroundColor: '#efeaff',
    borderRadius: 18,
  },
  legalText: { fontSize: 11, color: '#6b5b95', lineHeight: 18 },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  legalLink: { fontSize: 12, color: '#9B7EDE', textDecorationLine: 'underline' },
  dot: { color: '#6b5b95', fontSize: 12 },
});

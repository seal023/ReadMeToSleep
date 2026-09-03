# App Store Connect 内购配置核对清单

> **当前状态：内购商品已在 ASC 后台创建完成。** 本文档从「创建步骤」转为「核对清单」——请逐项确认与代码一致，避免拉不到价格或审核被卡。
>
> 代码里写死的三个关键值（**必须一字不差**）：
> - 月度商品 ID：`com.seal023.ReadMeToSleep.mor`
> - 年度商品 ID：`com.seal023.ReadMeToSleep.yea`
> - 订阅群组 ID：`22351191`（仅 ASC 后台使用，代码无需引用）

代码位置：`services/iap.ts` 的 `PRODUCT_IDS` 与 `FALLBACK_PRICES`。

---

## ✅ 第 1 项：产品 ID 核对（最关键）

进入 **我的 App → Read Me To Sleep → 订阅**，逐字核对：

| 项 | ASC 后台实际值 | 代码值 | 状态 |
|---|---|---|---|
| 月度产品 ID | `com.seal023.ReadMeToSleep.mor` | 同左 | 待你核对 |
| 年度产品 ID | `com.seal023.ReadMeToSleep.yea` | 同左 | 待你核对 |
| 订阅群组 ID | `22351191` | 代码不引用 | — |

> ⚠️ 产品 ID 在 ASC 里是**一次性设定，创建后不可修改**。若发现不一致，只能废弃该商品重建（ID 后加后缀），同时改 `services/iap.ts`。

---

## ✅ 第 2 项：价格与订阅时长

| 商品 | 订阅时长 | 价格 | 计费模式 |
|---|---|---|---|
| `.mor` | 1 个月 | $4.99 | 自动续订 |
| `.yea` | 1 年 | $24.99 | **预付（Prepaid）** |

**App 内展示的文案已按此计算**（`app/(parent)/subscription.tsx`）：

- 年度折算：`$24.99 ÷ 12 ≈ $2.08/月`
- 省钱角标：`(4.99×12 − 24.99) ÷ (4.99×12) ≈ 省 58%`
- 条款说明已区分两种模式：月度「自动续订」、年度「一次性预付，到期不自动续订」

> ⚠️ 若你在 ASC 里改了价格档，请同步改代码里的 `FALLBACK_PRICES` 与 `MONTHLY_EQUIVALENT` / `YEARLY_SAVING` 两个常量，否则兜底展示与实际扣款会不一致。

---

## ✅ 第 3 项：两项付费协议（否则内购无法提交审核）

登录 https://appstoreconnect.apple.com → **业务 → 协议、税务和银行业务**：

1. 《付费应用协议》（Paid Apps Agreement）状态为「有效」
2. 联系人、银行、税务信息三处均为「有效 / 已批准」

---

## ✅ 第 4 项：商品元数据（状态需为「已批准」或「准备提交」）

两个商品都要填全，否则 `fetchProducts` 拉不到（「元数据缺失」状态下商店不返回）：

| 字段 | 月度 `.mor` | 年度 `.yea` |
|---|---|---|
| 订阅显示名称 | 月度会员 | 年度会员 |
| 描述 | 解锁无限故事生成、声音克隆、离线下载 | 解锁全部会员权益，约 $2.08/月 |
| 订阅图标 | 1024×1024（建议上传） | 同左 |

---

## ✅ 第 5 项：关联到待提交的版本

**App Store → Read Me To Sleep → 准备提交** 的版本页面，滚到「App 内购买项目和订阅」区块：

1. 点 **+** 添加
2. 勾选 `.mor` 和 `.yea`
3. 保存

> 漏了这步，审核员在版本里看不到内购商品，会以「订阅功能不完整」拒审。

---

## ✅ 第 6 项：替换两个占位链接（P0）

同在版本页面填写，并替换代码里的占位符：

`app/(parent)/subscription.tsx` 顶部：
```ts
const TERMS_URL = 'https://example.com/readmetosleep/terms.html';   // ← 必须换
const PRIVACY_URL = 'https://example.com/readmetosleep/privacy.html'; // ← 必须换
```

- 隐私政策 URL：必填，草案见 `submission/隐私政策草案.md`
- 服务条款链接（EULA）：订阅类 App 必填，没有自定义 EULA 可用 Apple 默认条款

---

## ✅ 第 7 项：沙盒测试（强烈建议，别跳过）

内购不实测，上架后出问题只能靠发版修。

1. **App Store Connect → 用户和访问 → 沙盒测试员**，创建沙盒账号（用未注册过 Apple ID 的邮箱）
2. iPhone 上：**设置 → App Store → 沙盒账户** 登录
3. 用 TestFlight 或 Xcode Cloud 构建包安装，进入订阅页验证：
   - ✅ 价格显示为商店真实价格（沙盒下可能带 Sandbox 标记）
   - ✅ 点购买 → 弹出 Apple 支付确认 → 显示「订阅成功」并带有效期
   - ✅ 杀掉 App 重进 → 仍显示会员身份（`refreshEntitlement` 生效）
   - ✅ 点「恢复购买」→ 提示已恢复
   - ✅ 点「管理订阅」→ 能跳转系统订阅页（Apple 3.1.2 硬性要求）
4. 沙盒下订阅周期会大幅加速（1 个月 ≈ 5 分钟），可顺带验证过期逻辑

---

## 常见问题

**Q：App 里拉不到价格（UI 显示兜底价 $4.99 / $24.99）？**
按顺序排查：
1. 产品 ID 与代码**完全一致**（含大小写）——最常见原因
2. 内购商品状态是否为「已批准」或「准备提交」（「元数据缺失」下拉不到）
3. 是否用**真机构建**（Expo Go 无原生模块，`isIapSupported` 返回 false，页面会提示需正式构建）
4. 设备是否登录了可用的 Apple ID / 沙盒账号
5. 付费协议是否签完

**Q：商品状态一直是「等待审核」？**
正常。建议**先单独提交内购商品审核**，通过后再提 App 版本，这样 App 送审时内购已是「已批准」，被卡概率更低。

**Q：`pod install` 报 NitroIap 相关错误？**
已修复——`react-native-nitro-modules` 曾漏写在 package.json，现为 `^0.36.5`（commit `fed1c19`）。若仍报错，确认 Xcode Cloud 用的是最新 main 分支。

**Q：年度是预付模式，代码要特殊处理吗？**
不需要。`fetchProducts({ type: 'subs' })` 与 `requestPurchase({ type: 'subs' })` 对预付订阅同样适用，StoreKit 会自行处理。代码里已把「预付不自动续订」写进条款说明，避免审核员认为文案误导。

---

## 代码侧实现要点（供排查参考）

- `services/iap.ts` — 命令式 API：连接、拉价、购买、恢复、启动校验、权益持久化
- `hooks/useIAP.ts` — React 封装：初始化、loading、忙碌态、卸载竞态保护
- `app/(parent)/subscription.tsx` — UI 层，只消费 Hook

`react-native-iap v16` 是 OpenIAP / Nitro 重写，API 与 v12 完全不同：
- `requestPurchase` 是**事件驱动**的，返回值不可信，结果必须走 `purchaseUpdatedListener`
- 拿到购买结果后必须 `finishTransaction`，否则未完成交易会在每次启动重放
- 用户取消会抛 `ErrorCode.UserCancelled`，Hook 层已转成返回 `null`，UI 不弹错误

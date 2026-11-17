# Read Me To Sleep · 去 Supabase 化改动清单

> 目标：彻底移除 Supabase 依赖，App 变为「本地 AsyncStorage + StoreKit 2 + 阿里云百炼」。
> 以后不再因任何账号后端被暂停/删除而登录全挂。
> 生成日期：2026-11-17。状态：✅ **已于 2026-11-17 按「按建议全干」全部执行**（D1 删邮件 / D2 克隆免登录 / D3-A 本地 Apple 登录）。
> 执行记录见文末「9. 执行结果」。

---

## 0. 先拍板的 3 个产品决策（影响具体改法）

| # | 决策点 | 建议 | 影响文件 |
|---|---|---|---|
| D1 | 邮件登录是否彻底删除 | **删**（当前 `EMAIL_LOGIN_ENABLED=false` 本就隐藏，且 Supabase 免费邮件限流 2封/小时、只能发给组织成员，真实用户根本收不到，等于不可用） | login.tsx / featureFlags.ts / auth-callback 路由 |
| D2 | "免费用户 1 次克隆体验"归属 | 资格本来就本地存（`rms_free_clone_used`），改为**纯本地、不要求登录**：去掉 `checkVoiceCloneGate` 里的"必须先登录"拦截 | entitlement.ts |
| D3 | Apple 登录按钮是否保留 | 二选一：<br>**A 推荐**——保留但纯本地：点一下走 `expo-apple-authentication` 拿 `user`+email 存本地当显示名，不发服务器（保留"用 Apple 登录"的观感与账号删除合规性）<br>B 彻底删登录入口，账号页改为"会员/数据管理" | auth.ts / useAuth.ts / account.tsx / settings.tsx / login.tsx |

> 下文按 **D1 删邮件、D2 纯本地克隆、D3-A 保留本地 Apple 登录** 展开。

---

## 1. 核心服务层

### 1.1 `services/supabase.ts` —— 【重写或删除】
- 删除 `createClient` / `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `isAuthConfigured` / `supabase` 导出。
- 若走 D3-A：本文件可改为一个极简的**本地会话**模块（见 1.2）；若走 D3-B：整文件删除。
- 影响面：`@supabase/supabase-js` 依赖全部消失。

### 1.2 `services/auth.ts` —— 【重写】
- 删除所有 `supabase.auth.*` 调用：`signInWithIdToken` / `signInWithOtp` / `verifyOtp` / `setSession` / `exchangeCodeForSession` / `getSession` / `onAuthStateChange` / `signOut` / `rpc('delete_me')`。
- 删除：`sendEmailCode` / `verifyEmailCode` / `handleAuthUrl` / `parseUrlParams` / `isAuthCallbackUrl` / `friendlyAuthError` / `AUTH_NOT_CONFIGURED` / `client()`。
- 保留并改造：
  - `isAppleSignInAvailable()`（原样，纯原生）。
  - `signInWithApple()` —— 改为：调 `AppleAuthentication.signInAsync` → 只取 `credential.user`（稳定 ID）、`credential.email`、首次 `fullName` → 写入本地 AsyncStorage 会话 → 返回本地 session 对象。
  - 新增本地会话读写：`getSession()` 读 AsyncStorage；`signOutAsync()` 清；`deleteAccountAsync()` → 改为**清本地全部账号/权益/音频缓存**（见 3.1）。
  - `onAuthStateChange()` —— 本地会话没有跨标签订阅需求，可返回一个 no-op subscription，或让 useAuth 不再依赖它。
- 类型：`Session`/`User` 不再来自 `@supabase/supabase-js`，改为自定义极简接口（`{ user: { id, email?, fullName? } }`）。

### 1.3 `services/generationLog.ts` —— 【删除或空实现】
- 这是纯埋点（fire-and-forget、失败不影响功能）。移除 Supabase 后没有上报目标。
- 方案 A（推荐）：保留文件但 `logGeneration()` 改为 no-op（避免改所有调用点），保留类型导出。
- 方案 B：删除文件 + 删除 `entitlement.ts` 的 import 与调用。
- 若要保留统计能力：后续接自有 HTTP 端点（如 Cloudflare Worker），与本清单无关。

### 1.4 `services/receiptLog.ts` —— 【删除或空实现】
- 纯服务端留痕，注释已写明"不是服务端校验"。移除后不影响权益。
- 同 1.3：`logReceipt()` 改 no-op 或删文件 + 删 `iap.ts` 调用点。

### 1.5 `services/serverQuota.ts` —— 【重写为纯本地】
- 当前作用：防"改系统时间刷额度"、防"重装重置免费克隆"。所有 RPC 已有 5s 超时→降级本地的逻辑，**Supabase 挂掉时本来就在走降级**。
- 移除 Supabase 后：删除所有 `sb.rpc(...)` / `hasSession()` / `supabase` 引用，仅保留本地 `readMirror` / 本地日期判断。
- 保留本地镜像里"最后确认日期"的防作弊逻辑（用本地存储实现，无需服务端）。
- 代价：越狱用户改系统时间可刷额度；普通用户无感。可接受。

### 1.6 `services/cloudFetch.ts` —— 【保留但简化】
- 代理模式（`USE_AI_PROXY`）当前默认关闭（`EXPO_PUBLIC_AI_PROXY_URL` 未配），本就没走 Supabase JWT。
- 删除 `import { getSession } from './auth'` 和 `import { supabase }`，把 `proxyAuthHeaders()` 改为读本地会话 token（现在没有 token 了 → 代理模式实际不可用）。
- 建议：**直接删除代理模式相关代码**，`cloudFetch` 退化为 `fetch` 别名。注释里"将来接 Cloudflare Worker 藏 Key"属未来工作。
- ⚠️ AI Key 现在仍以 `EXPO_PUBLIC_AI_API_KEY` 明文打进包——这是现状，移除 Supabase 不使其变差。要藏 Key 另起项目。

---

## 2. 状态层

### 2.1 `hooks/useAuth.tsx` —— 【重写为本地会话 Provider】
- 删除：`isAuthConfigured` / `handleAuthUrl` / `isAuthCallbackUrl` / `Linking` 深链监听 / `onAuthStateChange` 订阅 / `linkLoginSeq` / 冷启动 `getSession` 的 Supabase 版。
- 保留对外接口签名（`configured` / `loading` / `session` / `user` / `isSignedIn` / `email` / `displayName` / `signInApple` / `sendCode` / `verifyCode` / `signOut` / `deleteAccount`），**尽量不改调用方**：
  - `configured` 恒为 true（或删除该字段，见 3.x UI 调整）。
  - `loading`：冷启动读一次 AsyncStorage 会话即可，很快。
  - `sendCode` / `verifyCode`：D1 删邮件后删除，或保留空实现。
  - `deleteAccount`：改为纯本地清理链路。
- 目标：让 `app/_layout.tsx` 等调用方**零改动或极小改动**。

---

## 3. UI / 路由层

### 3.1 `app/(parent)/account.tsx` —— 【改造】
- 注销链路 `deleteAccount()` 内部已做本地清理（`clearEntitlement` / `clearAccountScopedData` / `clearAllClonedAudioCache`），保持调用即可。
- `configured=false` 的"账号服务未配置"警告分支（116-120 行）删除。
- 未登录态（184-199 行）：D3-A 下保留"用 Apple 登录"按钮；D3-B 下改为数据管理页。
- 账号删除入口**必须保留**——Apple 5.1.1(v) 要求。本地账号删除 = 清本地数据，文案相应调整。

### 3.2 `app/auth/login.tsx` —— 【简化或删除】
- D1：删除邮件相关 UI（`EMAIL_LOGIN_ENABLED` 分支、邮箱表单、发送验证码）。
- D3-A：保留 Apple 登录按钮。
- 删除 `EMAIL_LOGIN_ENABLED` import。

### 3.3 `app/auth/perks.tsx` —— 【改造】
- 依赖 `isSignedIn` 的登录引导逻辑（61-75 行）按新会话调整。
- 删除 `EMAIL_LOGIN_ENABLED` 条件文案。

### 3.4 `app/auth-callback.tsx` + 根路由 —— 【删除】
- D1 删邮件深链后，此页无用途。
- 删除文件 + `app/_layout.tsx` 第 328 行 `<Stack.Screen name="auth-callback" ... />`。
- 顺带：`isAuthCallbackUrl` 过滤逻辑消失，但**上次修的 `+not-found.tsx` 兜底要保留**（它同时处理空深链，与 Supabase 无关）。

### 3.5 `app/_layout.tsx` —— 【小改】
- `EntitlementSyncOnLogin`（234-245 行）：其作用是"登录成功后静默 restore 会员"。本地登录后仍可用（StoreKit 静默恢复不依赖 Supabase），保留；若 useAuth 接口变了则同步适配 `isSignedIn`/`loading`。
- 删除 `auth-callback` Stack.Screen（见 3.4）。

### 3.6 `app/(parent)/subscription.tsx` / `app/(tabs)/settings.tsx` —— 【小改】
- 仅当 useAuth 接口变化时适配 `isSignedIn` / `email` / `displayName` 用法。若接口保持不变则零改动。

### 3.7 `constants/featureFlags.ts` —— 【删除或改注释】
- `EMAIL_LOGIN_ENABLED` 删除（D1），同步删除所有引用点（account / login / perks / auth-callback）。

---

## 4. 权益与资格

### 4.1 `services/entitlement.ts` —— 【改免费克隆门禁】
- `checkVoiceCloneGate()`（293-323 行）：删除"必须先登录"拦截（D2），保留"会员无限 / 免费 1 次"逻辑。
- 删除 `logGeneration` import 与调用（若 1.3 选删文件）。
- Pro 判定完全不动（`isPremium` 来自 StoreKit + AsyncStorage）。

### 4.2 `services/iap.ts` —— 【小改】
- 若 1.4 选删 receiptLog：删除 `logReceipt` import 与调用（约 354-363 行 `applyPurchase` 内）。
- 其余权益逻辑（购买/恢复/静默恢复/本地存储）**完全不动**。

### 4.3 `services/storage.ts` —— 【小改】
- `getFreeCloneUsed` / `setFreeCloneUsed` / `getFreeCloneStoryId` / `setFreeCloneStoryId` / `getFreeCloneTarget` / `setFreeCloneTarget` 里对 `claimFreeCloneOnServer` / `getRightsFromServer` 等服务端调用（来自 serverQuota）改为纯本地读写。
- `clearAccountScopedData()`（810 行）保持，作为本地注销清理的一部分。

---

## 5. 依赖与配置清理

### 5.1 `package.json`
- 删除依赖 `"@supabase/supabase-js"`。
- 保留 `"expo-apple-authentication"`（D3-A 需要）。
- 执行 `npm install` 更新 lock 文件。

### 5.2 `app.json`
- 保留 `"expo-apple-authentication"` plugin 与 `ios.usesAppleSignIn: true`（D3-A）。
- 删除任何 Supabase 相关配置（当前 app.json 无显式 Supabase 项，主要是 .env）。

### 5.3 `.env` / `.env.production` / Xcode Cloud 环境变量
- 删除：`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_AI_PROXY_URL`（若弃用代理）。
- **Xcode Cloud 工作流里的同名 Secret 也要删**（否则残留但无害）。
- 保留 AI 相关 Key。

### 5.4 `supabase/migrations/*.sql` —— 【归档，不删】
- 4 个 SQL 文件保留在仓库作历史记录（不参与构建），或移入 `archive/` 目录。不删除，避免破坏 git 历史可追溯性。

---

## 6. 隐私/合规文案（重要，别漏）

- **隐私政策**（`https://seal023.github.io/ReadMeToSleep/privacy.html`，在 seal023/ReadMeToSleep 仓库）：移除"账号信息存于 Supabase 云服务""邮箱/用户 ID 上传"等描述，改为"Apple 登录信息仅存本机，不上传"。这是 App Privacy 营养标签与审核 5.1.1 的一致性要求。
- **app.json 的 `description` / NSMicrophoneUsageDescription**：当前已如实写录音上传云端 AI，与账号无关，保持。
- **ASC App Privacy 问卷**：如果当前申报了"用户 ID / 邮箱 / 购买记录"等关联到 Third-Party（Supabase）的数据收集，需改为仅 Apple / 本地，或删除对应数据类别。**提审前务必核对**，否则隐私标签与实际不符会被拒。
- **i18n `locales/{en,zh}.json`**：删除/调整 `auth.*`（登录错误、未配置）、`account.*` 中账号云端相关、`login.*`、`perks.*`、`cb.*`、`gate.cloneLoginTitle/Msg`（不再需要"请先登录"提示）等键；保持中英同步。

---

## 7. 验证清单（改完逐条测）

1. 冷启动不白屏；无 Supabase 环境变量也能正常启动（本地模式）。
2. Apple 登录：点按钮→系统授权→本地会话写入→设置/账号页显示昵称/邮箱；杀进程重开仍登录。
3. 退出登录 / 注销：本地数据按范围清除；注销后家长门锁定、回首屏。
4. Pro 会员：已购用户启动即会员；"恢复购买"能找回；换机（同 Apple ID）能恢复。
5. AI 生成 / 克隆 / 打卡：额度扣减与每日重置正常；改系统日期的防作弊（本地镜像）生效。
6. 免费克隆 1 次体验：未登录也能用一次，第二次被拦截。
7. 锁屏重开：`+not-found.tsx` 兜底仍在（上次修复），不再进错误页 / Sitemap 不崩。
8. 切语言：小浣熊气泡即时跟随（上次修复）。
9. 全局搜索确认无 `supabase` / `SUPABASE` / `from('generation_logs')` / `rpc('delete_me')` 残留。
10. `tsc --noEmit`：无新增类型错误（历史预存错误基线约 16 个）。

---

## 8. 工作量与风险小结

- **涉及文件约 20 个**，核心重写 3 个（auth.ts / useAuth.tsx / supabase.ts），其余为删调用点/改文案。
- **最大风险**：登录态相关 UI 连锁（3.x），需保证 useAuth 接口兼容以最小化改动。
- **审核风险点**：账号删除入口必须保留；隐私政策/App Privacy 标签必须同步更新。
- **功能损失**（已确认可接受）：邮件登录、生成统计/收据留痕、服务端防作弊。
- **出包**：改完 bump buildNumber（当前 115 → 116），SSH 推送触发 Xcode Cloud。

---

## 9. 执行结果（2026-11-17）

**已全部完成**，决策按建议：D1 删邮件登录 / D2 免费克隆免登录纯本地 / D3-A 保留本地 Apple 登录。

### 核心服务层
- `auth.ts` 重写：Apple 登录只取稳定 id + 邮箱存本地 AsyncStorage（`rms_local_session`），删全部 supabase 调用/邮件/深链/删除函数。
- `supabase.ts` **删除**；`@supabase/supabase-js` 依赖从 package.json + package-lock.json 移除（lock 已重算，supabase 计数 0）。
- `generationLog.ts` / `receiptLog.ts` → no-op（签名保留，调用方零改动）。
- `serverQuota.ts` → 本地兼容层：所有函数恒返回 null/false（调用方自动走本地降级）；`readMirror()` 恒 null **刻意停用以免旧 mirror 导致额度永久锁死**。
- `cloudFetch.ts` → 退化为 fetch 别名，`USE_AI_PROXY` 恒 false（代理模式本就未启用）。

### 状态层 / UI / 路由
- `useAuth.tsx` 重写为本地会话 Provider，**对外接口兼容**（删 sendCode/verifyCode/linkLoginSeq）；configured 恒 true。
- `entitlement.ts`：`checkVoiceCloneGate()` 删登录拦截（D2）。
- `useEntitlement.ts`：删死掉的 `reason==='login'` 付费墙分支。
- `login.tsx` 简化为纯 Apple 登录；`account.tsx` / `perks.tsx` 删邮件开关与未配置警告；删 `auth-callback.tsx` + 路由注册；删 `featureFlags.ts`。

### 配置 / 合规
- `.env` / `.env.example` / `ios/ci_scripts/ci_post_clone.sh` 删 Supabase 变量与检查；app.json 无 Supabase 配置（保留 Apple 登录插件）。
- i18n 中英各删 **48 个死键**（47 + gate.goLogin），JSON 合法、diff 仅删除行。
- 隐私政策 3 份（`privacy.html` / `docs/privacy.html` / `submission/legal/privacy.html`）改 v2.1：账号信息仅存本机、删 Supabase 第三方行/邮箱验证码/服务端会话/RLS 表述。
- `supabase/migrations/*.sql` 与 functions 归档保留（不参与构建）。
- buildNumber **115 → 116**。

### 验证
- `tsc --noEmit`：**16 个错误 = 历史基线**，本轮改动零新增（中途 readMirror 返回类型引发的 4 个已修）。
- 全局残留扫描：源码/配置/CI/i18n 均无有效 supabase 引用（仅剩刻意的"去 Supabase 化"说明注释）。

### 待用户侧处理（非代码）
- **ASC App Privacy 问卷**：核对是否仍申报 Supabase 为数据第三方；现在应无账号服务端收集，仅需申报 Apple（登录）+ 阿里云百炼（AI）。
- **线上隐私政策**：线上托管于 `seal023.github.io`（独立仓库），需把本项目改好的 `privacy.html` 同步发布到该 Pages 仓库才会生效。
- build 116 出包后真机验证清单第 7 节 10 条。

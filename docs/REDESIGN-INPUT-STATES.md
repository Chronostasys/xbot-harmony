# REDESIGN-INPUT-STATES —— 空态 / 加载态 / 错误态 / 首屏引导：设计输入

> **读者**：`design-lead`（新设计系统重构负责人）。
> **状态**：本文是**设计输入台账**，不含代码改动（本轮只调研 + 写文档）。
> **起因**：用户方向已变 —— 「不是只调整样式，要做**大的重构重新设计**」「这样才能超过苹果」。
> **基准**：功能面仍以 web（`/Users/bobli/src/xbot/web`）为权威；视觉不再逐像素对齐（见 `docs/REDESIGN.md` §10、
> `docs/WEB-ALIGNMENT.md §16`）。原生令牌层：`core/design.ets`（939 行，123 断言）。
>
> **一句话结论**：这些状态**不是"没有好看的样式"，而是"没有状态面这个抽象"** ——
> 6 类状态里，只有 **1 类（loading/skeleton/busy/jump）**的判据收敛进了 `core/indicators.ets`，
> 其余全部**内联在 `pages/Index.ets` 的 `build()` 里**（`Index.ets` 已 6419 行 / 24 个 `@Builder`）；
> 空态插图/骨架/横幅**各自硬编码**（52fp 星形、26×26 圆、10 高灰条、16 内距、10 圆角、1400/900ms 动效）；
> 且**已有 1 处真静默**（会话抽屉空 = 什么都不显示）。要继续贴近"苹果级干净"，需要
> **一个"状态面"组件族 + 一组状态语义 token**，而不是再往 `Index.ets` 的 `if` 里塞值。

---

## A. 为什么"调样式救不了"（逐条 file:line）

### A1. 结构根因：状态**没有面**，判据散在 6419 行的页面 `build()` 里

六类状态的实现位置：

| # | 状态 | 判据在哪 | 渲染在哪 | 是否单源 |
|---|---|---|---|---|
| 1 | 抽屉空 | **不存在** | **不存在** | ⛔ 缺失 |
| 2 | 消息流空 | `pages/Index.ets:3022-3024`（**内联**） | `pages/Index.ets:3025-3052` | ⛔ 内联 |
| 3 | 消息行空/失败 | `components/MessageRow.ets:273`（`showsEmptyNotice`）+ `:872` | `components/MessageRow.ets:1009-1043`（`EmptyNotice`） | ✅ 单源 |
| 4 | 骨架屏 | `core/indicators.ets:78`（`showsHistorySkeleton`） | `pages/Index.ets:3057-3075` | ✅ 单源 |
| 5 | busy 占位 | `core/indicators.ets:56`（`showsBusyPlaceholder`） | `pages/Index.ets:3131/3159` | ✅ 单源 |
| 6 | 拉取失败 | `core/autherr.ets:18/29/43/61` | `pages/Index.ets:2995-3017` | ✅ 单源 |
| 7 | 流式失败/重连 | `core/sse.ets:175-191`（终态判据） | `pages/Index.ets:3246-3256` | ⚠️ 部分（页面只看 `connState`，**不消费终态**） |
| 8 | 超时 | `core/sse.ets:62-435`（watchdog）/ `core/aboutops.ets:259-306` | `pages/Index.ets:3247` / `components/SettingsAbout.ets:470-538` | ⚠️ 两套（SSE 与"重启服务"各一套） |

**含义**：状态判据已经形成**两种范式**——`core/indicators.ets` 那条线（可脱机单测、单一真源）与
`Index.ets` 内联那条线（不可测、与渲染同处）。**任何一个新状态（如抽屉空）都会先被写进页面的 `if`**，
这就是"越改越乱"的机制。

### A2. 硬编码清单（都不在 token 里；`core/tokens.ets` / `core/design.ets` 无对应刻度）

| 值 | 位置 | 说明 |
|---|---|---|
| `SymbolGlyph(...).fontSize(52)` | `pages/Index.ets:3041` | 空态主插图（星形）尺寸 —— **插图尺寸无 token** |
| `STAR_GLOW_SIZE`（径向光辉直径） | `pages/Index.ets:3033,3036,3043` | 插图光晕尺寸常量 |
| `.animation({ duration: 1400, curve: Curve.EaseInOut })` | `pages/Index.ets:3040` | 空态插图呼吸时长（**不在 `D_*` / `MOTION_*` 刻度里**） |
| `.opacity(this.pulseOn ? 1 : 0.4)` | `pages/Index.ets:3039` | 呼吸幅度字面量 |
| `Circle({ width: 26, height: 26 })` | `pages/Index.ets:3061` | 骨架头像圆 |
| `.height(10)` / `.borderRadius(5)` | `pages/Index.ets:3063-3066` | 骨架文字条高度 / 圆角 |
| `.animation({ duration: 900 })` / `opacity 0.85 \| 0.45` | `pages/Index.ets:3068,3067` | 骨架脉动时长 / 幅度 |
| `.padding(16)` / `.borderRadius(10)` / `.margin({left:12,right:12,top:12})` | `pages/Index.ets:3015-3016` | 失败卡内距 / 圆角（**10 不在 `RADIUS_*`**）/ 外边距 |
| `.fontSize(14) / (12) / (11)` | `pages/Index.ets:2998-3002` | 失败卡三级文字（**未走 `type.*` 角色**） |
| `.constraintSize({ minHeight: 38 })` | `pages/Index.ets:3005` | 失败卡按钮高（**低于 HIG 44 命中区**；`core/design.ets:575` 已有 `MIN_HIT` 概念） |
| `LoadingProgress().width(14).height(14)` | `pages/Index.ets:3085,3249,5356` | 小 spinner（14/16 两处不同） |
| `.fontSize(11) / (10) / (12)` | `pages/Index.ets:5421,5428,5431,5391,5358` | 抽屉组头 / 筛选项（与设置行字号各写一份） |
| `LoadingProgress().width(48).height(48)` + `.fontSize(18)` | `pages/Index.ets:2730-2731` | 启动页（LoadingView）—— 与空态/骨架**三套尺寸各自为政** |

> ⇒ 同一"加载中"在 3 处有 3 套视觉：启动页 48×48、骨架脉动圆 26×26、行内 spinner 14×14。

### A3. 交互反馈缺口（⛔ 不许静默）

| 状态 | 缺什么 | 证据 |
|---|---|---|
| **会话抽屉空** | ⛔ **完全静默**：`DrawerSheet` 的 `List` 直接 `ForEach(drawerGroups())`，**没有空分支** ⇒ 抽屉里只剩顶部筛选器 + 空白 | `pages/Index.ets:5415-5416`（无 `length === 0` 分支） |
| 消息流空 | 有文案 + 引导，但**引导语硬编码**、无"新建会话"入口（用户在空会话里只能靠输入框） | `pages/Index.ets:3044-3048` |
| 拉取失败 | ✅ 有标题/建议/重试三件套（已单源） | `pages/Index.ets:2995-3013` |
| 流式**终态**（服务端拒绝，重连无意义） | ⚠️ 页面只判 `connState==='reconnecting'` ⇒ 终态下可能显示"正在重连…"（**误导**：它永不成功）；`core/sse.ets:177` 注释自己承认"页面若要显示终态文案需加一个分支" | `pages/Index.ets:3247` vs `core/sse.ets:169-191` |
| 发送失败 | ✅ 有"上次发送失败 / 重试" | `pages/Index.ets:3258-3264` |
| 超时（SSE 长时间无帧） | ✅ watchdog 主动拆连重连；但**用户看不到"在等什么"**（只有笼统"正在重连…"） | `core/sse.ets:343-435` |
| 离线 | ⚠️ **无独立判据**：离线被折叠进"重连中"，用户读不到"网络本身断了"（web 有 `navigator.onLine` 语义） | `core/sse.ets:597,639` |

---

## B. 状态矩阵（重构后必须逐格覆盖）

图例：✅ 现有一致 / ⚠️ 现存但不一致 / ⛔ 缺失。

| 场景 | 状态 | 现有表现 | 必须有的反馈 | 交互要求 |
|---|---|---|---|---|
| 会话抽屉 | 加载中（首次拉列表） | ⛔ 无（直接空列表） | 骨架或 spinner | 自动完成，不阻塞 |
| 会话抽屉 | **空**（真的没有会话） | ⛔ **静默空白** | 插图 + 文案 + **「新建会话」CTA** | 一击即中；不许静默 |
| 会话抽屉 | 筛选后为空（有会话但不匹配渠道/搜索） | ⛔ 静默 | "无匹配结果" + 清除筛选 | 可恢复 |
| 会话抽屉 | 拉取失败 | ⚠️ 复用消息区失败卡？**未验证** | 明确失败 + 重试 | 不许静默 |
| 消息流 | 加载中（拉历史） | ✅ 骨架（4 行灰条） | 骨架 | 不阻塞输入 |
| 消息流 | **空**（会话无消息） | ✅ 星形 + 「开始对话」 | 插图 + 起始引导 | 引导可跳过（= 直接打字） |
| 消息流 | 行空（回合无产出） | ✅ `EmptyNotice(empty)` | 弱文案 | 静态 |
| 消息流 | 行失败（服务端异常响应） | ✅ `EmptyNotice(failed)` | 图标 + 文案（升一档色） | 静态、可复制原文 |
| 消息流 | busy（思考/压缩） | ✅ 占位符 + 文案（`busyLabel`） | 心跳/呼吸（唯一动效 = 光球） | 不可点 |
| 消息流 | 拉取失败 | ✅ 失败卡（标题+建议+CTA） | 分类 CTA（重新登录/刷新会话/重试） | 一击即中 |
| 消息流 | 流式失败（终态） | ⚠️ 与"重连中"同形 | **可解释终态**（不再假装会好） | 给"重试/新建会话"出口 |
| 消息流 | 弱网重连 | ✅ warn 横幅 | 横幅 + 自动补齐说明 | 不打断输入 |
| 消息流 | 离线 | ⚠️ 折叠进重连 | 明确"离线"+ 恢复自动继续 | 不静默 |
| 消息流 | 超时 | ⚠️ 折叠进重连 | 说明"正在等待服务端" | 不静默 |
| 发送 | 失败 | ✅ "上次发送失败 / 重试" | 重试 + 保留原文 | 一击即中 |
| 首屏 | 冷启动 | ✅ 启动页（48 spinner + xbot） | 品牌启动 | 不阻塞 |
| 首屏 | 未登录 | ✅ 登录页（玻璃卡） | 应用徽标 + 表单 | 可操作 |
| 首屏 | 已登录 | ✅ 直接进聊天页 | — | — |

---

## C. 新设计系统需要哪些语义 token

> 原则沿用 `docs/REDESIGN.md` / `core/design.ets`：**判据进 `core/`、数值进 token、组件只画**。
> 下面只列**当前缺失**的角色（已存在的 `space.* / radius.* / type.* / surface.* / shadow.*` 不重复）。

### C1. 插图 / 图标（**完全缺失的一组**）

| 需要的 token | 用途 | 现状 |
|---|---|---|
| `art.hero`（插图边长，建议 48–56） | 空态主插图（星形 52fp、启动页 48） | 52 / 48 / 26 **各写一份** |
| `art.glow`（光晕直径倍数） | 空态插图径向光晕 | `STAR_GLOW_SIZE` 常量 |
| `icon.state`（状态图标边长） | 失败/成功/空的符号图标 | `FS_CAPTION` 复用（语义错位） |
| `art.stroke` | 插图描边宽度 | 无 |

### C2. 状态面与反馈（**半缺失**）

| 需要的 token / 角色 | 用途 | 现状 |
|---|---|---|
| `surface.empty`（空态承载面） | 空态/失败卡底色 | 失败卡用 `surfaceAlt`（`Index.ets:3016`）、空态无底 |
| `surface.banner.*`（弱网/离线横幅） | 顶部状态横幅 | 用 `warnBg`（`Index.ets:3255`）—— 只有"警告"一档 |
| `state.info / warn / error / offline`（**状态语义档**） | 四态横幅/图标/文字的**统一取色** | 现在只有 `warn / dangerText`；无 `info` / `offline` |
| `feedback.retry / feedback.cancel`（交互件角色） | 重试/取消按钮 | 失败卡按钮 `minHeight:38` 硬编码 |
| `motion.state.*`（状态动效档） | 骨架脉动 / 空态呼吸 / 横幅进入 | `1400 / 900` 硬编码，**不在 `MOTION_*` 刻度**（违反了"一个心跳"纪律） |

### C3. 文字层级（**已有 `type.*`，但状态面没走**）

`core/design.ets` 已定义 `type.*` 角色（`:165-213`）。但状态面**全部用原始 `fontSize`**：
`Index.ets:2998-3002`（14/12/11）、`:3044,3047`（FS_HERO/FS_CAPTION）、`:5428,5431`（10）。
⇒ 需要的是**消费纪律**（状态组件只准用 `type.state.*` 角色），不是新 token。

### C4. 命中区 / 可点性

`core/design.ets:575` 已有 `MIN_HIT`（44）概念，但失败卡按钮写 `minHeight:38`（`Index.ets:3005`）、
重连横幅**不可点**、`EmptyNotice` 无操作。⇒ 状态面的**可点元素**需统一走 `MIN_HIT`/`HIT_TARGET_MIN`（**真实 ≥44 布局盒承载 `onClick`**；
⛔ **不用 `responseRegion` 外扩** —— 2026-10-11 真机实测其负偏移外扩**无效**）。

---

## D. 重构后归属（判据 / token / 组件）

```
core/statefaces.ets（新增，纯逻辑，可脱机单测）
  ├─ EmptyKind / FailKind 枚举 + 文案（单一真源，禁止组件自造）
  ├─ emptyFace(signals) → 该显示哪种空态（无会话 / 无消息 / 筛选为空 / 行空 / 行失败）
  ├─ retryActionOf(err) → 已有 core/autherr 的 needsRelogin/needsSessionRefresh 复用
  └─ bannerOf(connState, sseTerminal) → {kind: info|warn|error|offline, text}（终态与重连**分开**）
core/design.ets（**只由 design-lead 改**）新增 §C1/C2 的 art./state./surface.banner token
components/StateFace.ets（新增）—— 唯一"状态面"组件：插图 + 标题 + 副文 + CTA 槽
components/StateBanner.ets（新增）—— 顶部横幅（info/warn/error/offline 四档，取色走 state.*）
pages/Index.ets 只消费上面的产物：`if (f = emptyFace(sig)) { StateFace({face: f}) }`
```

**关键纪律**：`Index.ets` 从现在起**不再写状态 `if` + 文案**（只做"把 signals 交给 core、把结果渲染"）。

---

## E. 风险

1. **`Index.ets` 是热区**：6419 行、24 个 `@Builder`，且多条并行线正在改 ⇒ 状态面抽离必须**先加组件、
   后搬判据**（strangler，见 `docs/REDESIGN-STRUCTURE.md`），不能一次性替换。
2. **空态动效与"唯一在飞动效 = 光球"冲突**：现有空态/骨架**都有脉动**（`Index.ets:3040,3068`）。
   按 `docs/DESIGN-SYSTEM.md §8`「同一时刻只允许一个在飞动效」，骨架/空态应改为**静态**或走
   全局降级开关（`reduceMotion`）。**这是重构必须拍板的点**（§G2）。
3. **`EmptyNotice` 刻意不加 `export`**（`MessageRow.ets:1004-1007`）：抽离时会触发 lint 的孤儿组件规则 ⇒
   ⛔ **订正（2026-10-11）**：**不必改脚本** —— 该脚本只扫描 `^export struct`，「刻意不加 `export`」的 struct 本来就不在它的判据里；且自 2026-10-11 起判据已改为**文件级可达性**（文件里任一导出有跨文件消费者 ⇒ 整个文件被编译 ⇒ 文件内所有 struct 都被类型检查），详见 `docs/ARKTS-GOTCHAS.md` 批次 16b。**此条已过时。**
4. **终态文案 vs 自动恢复**：把"终态"和"重连"分开后，终态**不许**再自动重试（否则回到无限重连），
   需要显式"重试"入口 + 不得静默。

---

## F. ⚠️ 应立即收敛项（真实第二套判据；请派单）

> 这几条是"同一信息两处判"，不是审美问题。**每条都带 file:line。**

| # | 项 | 证据 | 危害 | 建议 |
|---|---|---|---|---|
| **F1** | **抽屉空态完全缺失**（无判据、无渲染） | `pages/Index.ets:5415-5416`（`List` 直接 `ForEach(drawerGroups())`，无 `length===0` 分支） | 用户看到"空白抽屉"，不知道是没会话还是没加载出来 | 判据进 `core/`，渲染进 `StateFace` |
| **F2** | **两个 `busy` 语义同屏并用** | 空态判据用原始 `!this.busy`（`pages/Index.ets:3022`）；busy 占位符用 `busyNow` 四路或（`core/indicators.ets:46`，注释 `:14-18` 明确记载这是**已修过的 P0**） | 服务端已 running 但本地事件未到 ⇒ 空态与占位符**都可能不显示**（不变量被破坏） | 空态判据也改用 `busyNow(o)` |
| **F3** | **空态判据内联在页面**（与同族 4 条判据不同源） | 内联 `pages/Index.ets:3022-3024` vs 已收敛的 `core/indicators.ets:56/64/78` | 不可单测；下次改动无人守护 | 抽 `core/statefaces.ets:emptyFace(...)` |
| **F4** | **SSE 终态判据存在但页面不消费** | 判据 `core/sse.ets:169-191`；页面只判 `connState==='reconnecting'/'connecting'`（`pages/Index.ets:3247`）；`core/sse.ets:177` 注释自认"需加分支" | 终态下显示"正在重连…"= **误导性静默**（它永远不会成功） | 页面消费终态，横幅分档 |
| **F5** | **"加载中"三套视觉** | 启动页 48×48（`Index.ets:2730`）、骨架脉动圆 26×26（`:3061`）、行内 spinner 14×14（`:3085,3249,5356`） | 同一语义三种尺寸，无 token 可统一 | 收进 `art.hero` / `icon.state` |

---

## G. 首屏 / 引导（onboarding）

### G1. 现状（首启到底发生什么）

1. **冷启动**：`@State booted=false`（`pages/Index.ets:301`）⇒ 渲染 `LoadingView()`
   （`Index.ets:2401-2402`）；`LoadingView` = 居中 `LoadingProgress 48×48` + `Text('xbot') 18fp`
   （`Index.ets:2728-2733`）。启动流程在 `:748 / :816` 置 `booted=true`；
   `:794` 有一处**显式防御**："若让异常抛到 bootstrap 外层 ⇒ `booted` 永不置位 ⇒ **无限启动页**（真机实测过）"。
2. **有本地 cookie**（`core/config.ets` 持久化）⇒ `loggedIn=true`（`:791`）⇒ **直接进聊天页**。
3  **无 cookie / 未配置地址** ⇒ `!loggedIn` ⇒ `LoginView()`（`Index.ets:2403-2404`）——
   深空渐变底 + 620px 径向光晕 + 玻璃表单卡 + 108×108 渐变徽标（`:2736-2769`）。
4. **有没有引导/教程**？**没有**。全仓搜 `onboarding / guide / welcome / 首次 / 欢迎 / intro` **零命中**
   （只有 `index.ets:1202` 一句注册提示文案）。
5. **未登录/未配置时能做什么**：只能填「服务器地址 + 账号密码」登录/注册 + 测试连接
   （`doLogin` `Index.ets:1442-1473`；账号注册提示 `:1202`）。**没有"跳过/先看看"路径**（登录是硬门）。
6. 已登录但 store 为空时，设置面板显示 `未连接服务端` 占位（`Index.ets:2683`）。

### G2. web 有无对应物？

- **有"登录门"，无"onboarding 引导"**：web 有 `components/auth/AuthGuard.tsx`
  （未登录 `Navigate to="/login"`，初始化时居中 `Loader2` spinner）+ `App.tsx:49-61` 包住受保护路由。
- **web 没有首次引导/教程/欢迎页**（搜 `onboarding/WelcomeScreen` 只命中 i18n 词条，无组件）。
- ⇒ **结论**：**原生"登录门"已对齐 web；"onboarding 引导"web 无对应物 ⇒ 属原生新增**。

### G3. 最小方案（给 design-lead 的约束，不是设计稿）

因为它**web 无对应**，必须遵守三条硬约束（否则就是把"引导"变成"阻塞"）：

1. **不阻塞使用**：不得新增"必须先看完"的门；引导只能是**覆盖层/可点名区域的高亮**，随时可直接开始打字。
2. **可跳过**：必须有一眼可见的"跳过"；跳过与"I've seen it"只写一个持久化标记。
3. **只在首次出现**：用**一条** preference（如 `native:ui:onboarded`，**服务端不感知**）门控；
   已登录用户**不重复出现**（登录页与引导互斥）。
4. **不新增在飞动效**：引导的强调必须复用 `components/anim.ets` 的**一次性**过渡（`animFast/animBase`），
   ⛔ 不许循环动效（否则与"唯一在飞动效 = 光球"冲突，见 `docs/DESIGN-SYSTEM.md §8`）。
5. **可回放**：设置里给「重看引导」（放 `SettingsAbout` 或 `Developer`）—— 否则跳过后无法再看。

> 需要用户/设计拍板的点：**引导的落点**（是"登录页旁的小提示"，还是"首次进聊天页的 3 点覆盖"，还是**不做**）。
> 我的建议：**先不做**，只补 G4 的"登录页/空态自解释"；引导的收益 < 阻塞风险（用户要的是"干净"，不是"教程"）。

### G4. 首屏真正的缺口（比引导更值钱）

- **登录页无"这是什么/连哪个服务端"的自解释**：只有地址+账号+密码（`Index.ets:2736+`）。
  web 有同构登录页可参照，但原生**少了 web 侧的错误分类展示**（`core/autherr` 的逻辑尚未用到登录页）。
- **启动页与空态是两套视觉**（48 spinner vs 星形 52）：应统一到 `art.hero`（§C1）。

---

## H. 交付归属小结

| 产物 | 归属 |
|---|---|
| 状态判据（空/失败/横幅分档） | 新增 `core/statefaces.ets`（纯逻辑）+ 复用 `core/{indicators,autherr,sse}` |
| 状态面 / 横幅组件 | 新增 `components/StateFace.ets` / `StateBanner.ets` |
| 插图 / 状态色 / 动效档 token | `core/design.ets`（**design-lead 改**） |
| `pages/Index.ets` | 只消费：判据经 core、渲染经组件；**删除内联 `if` + 硬编码值** |
| 首屏引导 | 若做：preference 门控 + 可跳过 + 只在首次；原生新增（web 无） |

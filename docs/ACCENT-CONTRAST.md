# ACCENT-CONTRAST —— `theme_contrast` a11y 失败拆解与候选值（纯分析，2026-10-11）

> **用途**：把 `tools/tests/theme_contrast.test.ts` 当前的红**拆清楚**，并对**真实 UI 组合**
> 给出可拍板的、**保持色相家族**的最小候选值。⛔ 本文只做分析与候选 —— 未改任何测试、任何 `.ets`、
> 任何色值。复算脚本见 §8（自校过 WCAG 参考值）。
>
> **判据基准**：`tools/tests/theme_contrast.test.ts`（下文简称"测试"）。

---

## 0. TL;DR（先看这个）

1. **测试真正红的只有 2 条断言**，且**两条都是"字符串级脆弱"，不是色值缺陷**：
   - `✗ 主按钮字重 = FontWeight.Medium` ⇒ 迁移把**字面量**换成了语义 token `typeOf('type.subhead').weight`
     （**取值仍是 500，观感未变**）。见 §5。
   - `✗ 判定的角色 sunken 确有生产调用点` ⇒ 在途重构把 `.sunken` 换成了 `wellOf(this.pal())`
     （**返回值同为 `surfacesOf(p).sunken`，像素未变**）。见 §4。
2. 用户列的「多组不达 4.5」的 `onAccent` 对，**全部已在测试的台账（`LEDGER`）里** ⇒ 它们
   **不判红**（台账是"已知欠债白名单"）。台账里 `onAccent` 相关共 **9 对**，其中**只有 1 对是真实 UI 组合**：
   | 定性 | 对 | 数量 |
   |---|---|---|
   | **(a) 真实同屏组合** | `dark · onAccent 压 accent`（= 主按钮 = 4.35） | **1** |
   | **(b) 叉乘出来、UI 里根本不同屏** | `onAccent 压 accentDeep`（4 主题）+ `onAccent 压 surfaceHi`（4 主题） | **8** |
3. ⇒ **唯一需要拍板的真实 a11y 缺口 = 主按钮「白字 `#FFFFFF` 叠紫 `#7C5CFF`」= 4.35:1**（差 0.15）。
   候选见 §6（含"最小压深保持色相"=`#795AFA`，及一个**重要警告**：测试只建模**纯色** `accent`，
   而主按钮真实底色是**渐变** `accent → accentSoft`，最亮端白字只有 **2.09** ⇒ 只压 `accent`
   **能让测试变绿、但不能让真按钮达标**）。

---

## 1. 测试怎么判（先讲清判定面，才知道哪些对是"叉乘"）

`theme_contrast.test.ts` 的判定面 = **`CANVAS_ROLES` × `CANVAS_FACES`**（叉乘）**∪** `FILL_PAIRS`
（逐条列、每条给生产证据）。关键行：

- `CANVAS_ROLES`（`theme_contrast.test.ts:119-137`）：画布面上的文字角色（`textPrimary` … `statusRunning`）。
- `CANVAS_FACES`（`:143-147`）：`appBg` / `surface` / `surfaceAlt` / `surfaceHi` / `glassBg/*` / `sunken`。
- `FILL_PAIRS`（`:155-167`）：**"文字压在有色填充上"** —— 测试自己声明**只在有真实调用点时才成立**，
  每条带 `{fg, bg, tier, where: '<生产 file:line>'} `证据。
- 分级阈值（`:114-116`）：正文/承载文字 **4.5**、次要/语义文字 **3.0**、最弱一档 2.0。
- 台账 `LEDGER`（`:276-329`）：**已知不达标对**的**白名单**；在台账里 ⇒ 判 pass（不红）；
  **不在台账**的不达标 ⇒ 立刻红。脚本头（`:267-274`）明说宗旨：本轮**不许改色值**（UI 决策交回主 agent），
  故把已知欠债登记为白名单，"只准删不准加"。

> ⚠️ `onAccent` **不在** `CANVAS_ROLES` 里 —— 它只经由 `FILL_PAIRS` 进入判定，即**"它压在什么填充上"是逐条声明的**。
> 这正是判断 (a)/(b) 的关键：`FILL_PAIRS` 声称的证据若已失效（行号漂移/调用点没了），那对就是**空对**。

---

## 2. 失败对清单表（`onAccent` 相关 9 对，实测值）

实测（复算脚本 §8，与测试的 `contrastRatio` 同公式；`onAccent` 压 3 种填充 × 5 主题）：

| # | 主题 | 前景 `onAccent` | 背景 | 实测 | 阈值 | 在台账 | 定性 |
|---|---|---|---|---|---|---|---|
| 1 | dark | `#FFFFFF` | `accent` `#7C5CFF` | **4.3461** | 4.5 | ✅ | **(a) 真实** |
| 2 | light | `#FFFFFF` | `accentDeep` `#EDE9FE` | **1.1873** | 4.5 | ✅ | (b) 空对 |
| 3 | porcelain | `#FFFFFF` | `accentDeep` `#E8F1FD` | **1.1393** | 4.5 | ✅ | (b) 空对 |
| 4 | aurora | `#04150f` | `accentDeep` `#04473a` | **1.7578** | 4.5 | ✅ | (b) 空对（护栏） |
| 5 | nebula | `#150a2b` | `accentDeep` `#4a1998` | **1.6967** | 4.5 | ✅ | (b) 空对（护栏） |
| 6 | light | `#FFFFFF` | `surfaceHi` `#E2E8F0` | **1.2328** | 4.5 | ✅ | (b) 空对 |
| 7 | aurora | `#04150f` | `surfaceHi` `#17253c` | **1.2207** | 4.5 | ✅ | (b) 空对 |
| 8 | nebula | `#150a2b` | `surfaceHi` `#221642` | **1.1363** | 4.5 | ✅ | (b) 空对 |
| 9 | porcelain | `#FFFFFF` | `surfaceHi` `#EDEDEF` | **1.1692** | 4.5 | ✅ | (b) 空对 |

对照（同族但**达标**、故不在上表）：
- `dark · onAccent 压 accentDeep` = **14.49** ✓ / `surfaceHi` = **16.68** ✓（dark 的 onAccent 是白字，压深色面天然高对比）。
- `light · onAccent 压 accent` = **7.10** ✓、`aurora · onAccent 压 accent` = **9.94** ✓、
  `nebula · onAccent 压 accent` = **6.95** ✓、`porcelain · onAccent 压 accent` = **4.70** ✓。
  ⇒ 只有 **dark** 的 `accent` 压白字差一点点（4.35）；其余主题实心 accent 都过 4.5。

---

## 3. 逐对定性（每条给证据）

### 3.1 `dark · onAccent 压 accent` = 4.35 —— **(a) 真实同屏组合** ✅ 最高频
生产证据（**同一元素**上 `fontColor(onAccent)` + `backgroundColor(accent)`），当前实测 **≥18 处**：

| 位置 | 元素 | 证据（anchor；行号随并发漂移） |
|---|---|---|
| `pages/Index.ets` 主 CTA「登录」 | `Button('登录')`：`fontSize(FS_TITLE)` + `fontWeight(...)` + `fontColor(onAccent)` + `backgroundColor(accent)` + **渐变** | `Index.ets:2933-2941`（`Button('登录')` → `.fontColor(this.pal().onAccent)` `:2936` → `.backgroundColor(this.pal().accent)` `:2937`） |
| `pages/Index.ets` 面板 Tab | `.fontColor(panelTab===tab ? onAccent : textSecondary)` + `.backgroundColor(... ? accent : surface)` | `Index.ets:4960` + `:4962` |
| `pages/Index.ets` 应用徽标 chip「应用」 | `Text('应用').fontColor(onAccent)` + `.backgroundColor(accent)` | `Index.ets:5699` + `:5700` |
| `components/*` 设置面板选中态（≥14 处） | `SettingsRows.ets:327+329`、`SettingsPanel.ets:276+278`、`SettingsLlm.ets:1006+1008 / 1067+1069 / 1233+1235`、`SettingsAbout.ets:295+298 / 383+385`、`SettingsChannels.ets:269+271 / 473+475 / 495+497`、`SettingsStorage.ets:342+344`、`SettingsWebUsers.ets:170+172`、`SettingsPlugins.ets:157+159 / 172+175`、`SettingsAgent.ets:240+242`、`SettingsDeveloper.ets:311+312`、`AskUserSheet.ets:248+249` | 引用文件锚点 |
| 发送键（composer） | 三元**一致**：`fontColor(runningNow() ? textSecondary : onAccent)` + `backgroundColor(runningNow() ? surfaceHi : accent)` | `Index.ets:3593` + `:3605`（⚠️ 两个三元同向 ⇒ `onAccent` **只**与 `accent` 同屏，**不**与 `surfaceHi` 同屏） |

⇒ **结论**：这是**真实、高频、且当前唯一未修**的 a11y 缺口（用户手机上一眼可见的主按钮/选中态/发送键）。

### 3.2 `onAccent 压 accentDeep`（4 主题，1.14–1.76）—— **(b) 叉乘出来的空对**
- **测试自己就说它没有调用点**：`theme_contrast.test.ts:300-309`（台账根因 C 残余）明写
  "`onAccent|accentDeep` … **该组合当前无生产调用点**（唯一曾用它的一处已改用 `accentText`）,
  台账保留当**回归护栏**"；`core/theme.ets:201-204` 同述，并解释**窗口为空（压暗无解）**：
  `onAccent` 是"压在**实心** accent 上的字"（aurora `#04150f` / nebula `#150a2b` 是**深色字**），
  它要求 `accentDeep` **够亮**；而 `accentText`/`textMuted` 这些**浅色字**要求它**够暗** ⇒ 无交集。
- **实测复核（当前源码）**：`onAccent` 与 `accentDeep` **无任何同元素共现**（±8 行窗口全仓扫描 = 0 命中）。
  原本承重的"选中会话标签"今用 **`accentText`**（`pages/Index.ets:3410`，注释即写"见对比度台账 B"）；
  `accentDeep` 的其余消费点用的是 `textPrimary`（`Index.ets:3259`「回到最新」pill）、
  `accentText`（`SettingsRows.ets:449`）、或纯底（`ToolPopover.ets:359` diff 卡头）。
- ⇒ **判定面过宽**：`FILL_PAIRS`（`:157`）的 `where` 还写着 `Index.ets:2687+2699`，**该证据已失效**（调用点已改）。
  **应如何收窄**：按测试自己的 §D 原则（"只判有生产调用点的对，避免造一批没人用的对"），
  **把 `onAccent|accentDeep` 从 `FILL_PAIRS` 移除**；若仍想留"语义误用护栏"，应**另立一档**
  （如 `GUARD_PAIRS`，显式标注"0 调用点·仅防回归"），**不并入 a11y 判定表**。

### 3.3 `onAccent 压 surfaceHi`（4 主题，1.14–1.23）—— **(b) 叉乘出来的空对（且证据已死）**
- **测试声称的证据**：`theme_contrast.test.ts:158`：`where: 'Index.ets:3942+3943 sendKeyLabel 发送键标签（同一 Text）'`。
  **已失效**：当前 `Index.ets:3942` 是 `setWindowSystemBarProperties(...)`（系统栏代码，与字体无关）；
  且 `sendKeyLabel` 在 `Index.ets` 里**只剩 import**（`:44`），**无任何调用**（= 渲染点已挪走/改名）。
- **实测复核**：`onAccent` 与 `surfaceHi` **全仓无同元素共现**（±8 行扫描 = 0）；发送键三元同向（§3.1）。
- ⇒ **判定面过宽**：这与测试自己的 §D 原则（`:449-455`"声明'无调用点'的角色必须真的是 0"）**直接冲突**——
  `surfaceHi` 作为**面**确实被用（`Index.ets:3125/3128/3130/3605`），但"`onAccent` 压 `surfaceHi`"这个**对**
  没人用。**应如何收窄**：从 `FILL_PAIRS` 与 `LEDGER` **移除**这 4 条（其 `where` 是死引用）。
  台账注释（`:277-284`）说"该处改用 textPrimary 或把底换成 accent"—— 若已改完，即为**已修复**，正该移除。

---

## 4. `✗ 判定的角色 sunken 确有生产调用点` —— **测试脆弱（在途重构），非缺陷**

- 断言在 `theme_contrast.test.ts:446`：`ok('判定的角色 sunken 确有生产调用点（非空对）', roleUses['sunken'] > 0)`。
  `roleUses` 由 `countRoleUses(src, role)`（`:394-410`）生成：**数源码里 `.sunken` 这个字面串**出现几次。
- **根因**：一条**在途**改动（`components/ToolPopover.ets`，`git status` 显示 M）把
  `.backgroundColor(this.surf().sunken)` 改成了 `.backgroundColor(wellOf(this.pal()))`
  （`HEAD` 版 `ToolPopover.ets` 有 **5 处** `.sunken` 消费：`:293/317/350/384/435`，另 `:186` 是注释；
  今版剩下 **4 处** `wellOf(this.pal())`（`:284/308/341/375`），第 5 处 `:435` 改成了
  `surfaceFillOf(this.pal(), SURFACE_CHIP)`）。
  而 `wellOf(p)` 的返回**就是** `surfacesOf(p).sunken`（`core/design.ets:366` 的 `wellOf`）——
  **像素完全不变**，只是"引用点"从 `.sunken` 字符串换成了 helper。
- ⇒ **这是"字面量计数"判据看不见 token/helper 间接层**导致的**假红**（与 §5 的字重问题**同一类**）。
  **修法（交回持有者，不在本文范围）**：`countRoleUses` 应同时认 `wellOf(` / `surfacesOf(...).sunken`
  等**语义等价引用**，或该断言改为"`sunken` 面被**任一**语义出口消费"。

---

## 5. `✗ 主按钮字重 = FontWeight.Medium` —— **字符串脆弱（迁移等值），非观感变更**

### 5.1 考古（只读；回答"是这次迁移顺带改观感，还是本来如此"）
- **改动提交**：`bce3dcf`（`refactor(design): 页面可见面从"原始刻度"迁到语义设计层（字号/字重/圆角/间距/动效）`，
  2026-10-11 11:33）。
- **改动前后原文**（`git show bce3dcf -- entry/src/main/ets/pages/Index.ets`，登录主 CTA 那段）：
  ```
  -          .fontSize(FS_TITLE).fontWeight(FontWeight.Medium)      ← 迁移前
  +          .fontSize(FS_TITLE).fontWeight(typeOf('type.subhead').weight)  ← 迁移后
  ```
  （`bce3dcf^` 版 `Index.ets:2903` 起：`Button('登录')…` → `.fontSize(FS_TITLE).fontWeight(FontWeight.Medium)`）
- **取值核对**：`typeOf('type.subhead').weight` = `WEIGHT_MEDIUM` = **500**（`core/design.ets:206` 定义
  `new TypeRole('type.subhead', FS_BODY-1, WEIGHT_MEDIUM, …)`；`WEIGHT_MEDIUM = 500` 在 `:163`）。
  **⇒ 前后都是 500 —— 值没变、观感没变**，迁移是**等值迁移**（提交通知也写"多数值不变 ⇒ 观感不动"）。
- ⇒ 断言红**不是**因为观感被改，而是因为断言 `loginBlock.indexOf('FontWeight.Medium') >= 0`
  （`theme_contrast.test.ts:822-823`）**只认字面量**，读不懂 token 间接 ⇒ **假红**。
  **修法（交回持有者）**：断言改核"字重数值 = 500"（经 `typeOf('type.subhead').weight` 解析），
  而非匹配 `FontWeight.Medium` 字面串。

### 5.2 顺带确证：它**仍是**"非大字" ⇒ 4.5 阈值**有效**
- `FS_TITLE = 16`（`core/tokens.ets:39`），字重 500 ⇒ **非大字**（见 §7 权威定义）⇒ 主按钮阈值**仍 4.5**，
  4.35 确实不达标（不是"用大字豁免蒙过去"）。

---

## 6. 候选值（**只针对唯一真实缺口** `dark · onAccent 压 accent` = 4.35）

> ⛔ 本节全是**候选**，不落地；改哪个都要**用户拍板**（改品牌主色 = 改品牌，见 `docs/DESIGN-SYSTEM.md:478-482`）。

### 6.1 关键事实：测试只建模**纯色**，主按钮真实底是**渐变**
- 测试的模特对 = `onAccent on accent`（纯 `#7C5CFF`）= 4.3461。
- 主按钮**真实**底色 = `.linearGradient({ colors: [[gradientFrom, 0], [gradientTo, 1]] })`，
  而 `gradientFrom = accent`（`#7C5CFF`）、`gradientTo = accentSoft`（`#B9A7FF`）（`core/theme.ets:577-578`）。
- **最亮端** `#B9A7FF` 上白字 = **2.09**（测试 `:837-838` 亦钉此值）⇒ **连"大字"的 3:1 都过不了**。
- ⇒ **只压 `accent` ⇒ 测试会变绿，但真按钮不会达标**（承重约束在渐变**最亮端**）。
  这是"判据（纯色）≠ 渲染（渐变）"的缺口，须与"判据与渲染同源"纪律一起处理。

### 6.2 候选表

| 方案 | 具体值 | 白字实测 | 与原色 ΔRGB / ΔL | 触及面 | 评价 |
|---|---|---|---|---|---|
| **①a 最小压深·保色相** | `accent`: `#7C5CFF` → **`#795AFA`** | **4.5104** ✓ | ΔRGB `(-3,-2,-5)` / ΔL `0.00880` | `theme.ets darkPalette.accent` + 其派生（见 6.3）+ `theme.test.ts:30` 快照 | **最小改动**；但**贴线**（余量仅 0.0104）⇒ 相邻微调易再破线 |
| **①b 稳妥档·保色相** | → **`#6B4AE6`**（测试台账建议值） | **5.6040** ✓ | ΔL `0.05422` | 同上 | 余量足；但主色**明显变深**（观感差异可感知） |
| **② 改渐变最亮端** | `accentSoft`: `#B9A7FF` → **`#7B6EAB`** | **4.5058** ✓ | ΔRGB 大（k≈0.41） | `theme.ets darkPalette.accentSoft`（+ `accentSoftFade`） | **才治真按钮的根**；但紫会**压灰**（饱和度大幅下降），品牌观感变化大 |
| **③ 只改字色** | `onAccent` → `#F5F5FF` | **4.0124** ❌ **更低** | — | `theme.ets onAccent` | ⛔ **反效果**：白（`#FFFFFF`）已是该底色上**最亮**字，再"提亮"反而更差。台账原话"按钮字色用 #F5F5FF"是**错的**。要经字色达标只能压**暗**（如 `#241A5C`=3.51、纯黑=4.83）—— 会翻转品牌观感，不推荐 |
| **④ 大字豁免** | ≥18.66px **且** bold(≥700)，或 ≥24px 常规 | 阈降至 3:1 | — | 字号/字重（`FS_TITLE` / weight） | 只解**模特对**（4.35 > 3 ⇒ 过）；**不解真按钮**（渐变最亮端 2.09 < 3）⇒ 单独用治不了根 |

> "保色相"的算法 = 在**线性空间**把三通道**等比**缩放（hue 不变，仅压亮度）——与 `theme.ets` 里
> aurora/nebula `accentDeep` 的取值口径**同一手法**（`core/theme.ets:200`"色相不变 = 原值在线性空间同比压深"）。

### 6.3 改 `accent` 的**波及面**（拍板前必须知道）
`accent` 是**派生源**：`accentDeep` / `glow` / `gradientFrom` / `accentHover` 等都由它派生，
且 `dark.accent #7C5CFF` 被 `tools/tests/theme.test.ts:30` 的**色值快照**钉死（改它要同步该快照 ——
那是**测试文件**，本波**不在允许改动范围**）。⇒ 方案 ① 的落地成本 = 改 `theme.ets` **且**改 `theme.test.ts` 快照
（或让快照改走派生断言）。这也是 `docs/DESIGN-SYSTEM.md:478-482` 判"超出本波范围、需用户拍板"的原因。

### 6.4 建议（三选一，按代价从低到高）
1. **【推荐·最小真实修复】② + ①b 一起**：把 **渐变两端**都压到白字 ≥4.5（`accent`→`#6B4AE6`、
   `accentSoft`→ 需同步压暗）。理由：只有这样才能让**真按钮**达标；单压 `accent` 是"让测试变绿"。
2. **【若坚持不动品牌紫】④ 大字豁免 + ②**：把主按钮升到 `≥18.66px + bold(700)`（阈值降 3:1），
   **同时**把渐变最亮端压到 ≥3.0（`accentSoft`→`#9A8AD5` 左右，白字 ≈3.01）。缺点：字重变 bold 改观感。
   ⚠️ 只做 ④ 不做 ② ⇒ 真按钮仍 2.09 **不达标**。
3. **【若只求门禁绿、暂不动色】**：仅方案 ①a（`#795AFA`）可让**测试**转绿，但**必须同时**在 §7 记录
   "真按钮渐变最亮端 2.09 仍不达标"的**明账**，否则就是"用纯色模特对假装达标"。

---

## 7. 权威依据

### 7.1 WCAG 2.1 —— **SC 1.4.3 Contrast (Minimum)**
- 正文阈值 **4.5:1**；**大字号文本**阈值 **3:1**。
- **"大字号文本"定义**（WCAG 2.1，`18 point` ≈ **18.66px**）：
  - **≥ 18.66px（≈14pt）且 bold（≥700）**，或
  - **≥ 24px（≈18pt）常规**。
- 本仓用法一致：`tools/tests/theme_contrast.test.ts:809`（§G6 注释）逐字复述该定义；
  `:822-829` 断言主按钮 `FS_TITLE(16) < 18.66` 且 `< 24` ⇒ **非大字 ⇒ 阈值 4.5**。
- 度量自校（测试 §A `:55-70`，复算脚本 §8 已复现）：黑白 = 21.00、`#767676/白` = 4.54、
  `#0000FF/白` = 8.59、`#808080` 相对亮度 = 0.2159。

### 7.2 本仓 `docs/DESIGN-SYSTEM.md` 既有约定（**给行号**）
| 内容 | 行号 |
|---|---|
| §11 霓虹 `accentDeep` 与「主按钮白字」取证 | `docs/DESIGN-SYSTEM.md:433-490` |
| §11.2 残余 `onAccent|accentDeep`（窗口为空、压暗无解、**无生产调用点**） | `:466-469` |
| §11.3 主按钮白字叠 `#7C5CFF` = 4.35 ⇒ **本波不改 + 不放宽阈值**；大字定义；渐变最亮端 2.09 | `:471-482` |
| §11.4 纪律：`dark|onAccent|accent` 台账条目**不许删**（= 不许拿大字当借口放宽阈值） | `:490` |
| 主按钮真实底色是**渐变**（`accent → accentSoft`） | `:479-481` |

### 7.3 关键色值真源（`core/theme.ets`）
| 角色 | dark | light | aurora | nebula | porcelain |
|---|---|---|---|---|---|
| `accent` | `#7C5CFF`(`:118`) | `#6D28D9`(`:154`) | `#34d3b4`(`:226`) | `#a78bfa`(`:265`) | `#0071E3`(`:326`) |
| `accentDeep` | `#2A1F5C`(`:122`) | `#EDE9FE`(`:158`) | `#04473a`(`:230`) | `#4a1998`(`:269`) | `#E8F1FD`(`:330`) |
| `accentSoft` | `#B9A7FF`(`:120`) | `#1D4ED8`(`:156`) | `#63e6c8`(`:228`) | `#d68bff`(`:267`) | `#0066CC`(`:328`) |
| `onAccent` | `#FFFFFF`(`:124`) | `#FFFFFF`(`:160`) | `#04150f`(`:232`) | `#150a2b`(`:271`) | `#FFFFFF`(`:332`) |
| `surfaceHi` | `#1D1D28`(`:113`) | `#E2E8F0`(`:149`) | `#17253c`(`:221`) | `#221642`(`:260`) | `#EDEDEF`(`:321`) |

`gradientFrom = accent` / `gradientTo = accentSoft`（`core/theme.ets:577-578`，`effectsOf`）。

---

## 8. 复算方法（可复核，自校过）

复算沿用测试 `§A` 的同一把尺：WCAG 相对亮度 `L = 0.2126·f(R) + 0.7152·f(G) + 0.0722·f(B)`
（`f(c)=c/255≤0.04045 ? c/255/12.92 : ((c/255+0.055)/1.055)^2.4`），
对比度 `= (L_hi + 0.05) / (L_lo + 0.05)`。自校：`#767676/白 = 4.54`、`#0000FF/白 = 8.59`、
`#7C5CFF/白 = 4.3461`（与 `theme_contrast.test.ts:830-831` 的 `4.3461` 一致）。

"最小压深候选"的求法：把源色的**线性三通道等比缩放** k，取满足 `白字对比 ≥ 目标` 的**最大 k**
（= 最小压深），再转回 sRGB 取整 ⇒ `#795AFA`（4.5）/ `#7B6EAB` for `accentSoft`（4.5）。

---

## 9. 明账（本文未做 / 待拍板）

- ⛔ 本文**未改**任何测试、`.ets`、色值（遵守"纯分析"）。
- **待持有者修（各归各的线，不在本文）**：
  1. `theme_contrast.test.ts:822-823` 的**字面量字重断言**（§5）—— 改核数值 500。
  2. `theme_contrast.test.ts:446` 的**字面量角色计数**（§4）—— 认 `wellOf(...)`/语义等价引用。
  3. `FILL_PAIRS` 的 **2 条死证据**（`onAccent|accentDeep`、`onAccent|surfaceHi`，§3.2/§3.3）—— 收窄判定面。
- **待用户拍板**：§6.4 三选一（是否动品牌紫 / 是否升大字）。
- **行号会漂移**：本文行号基于 `10aae43` 当时工作树；`Index.ets`/`ToolPopover.ets` 正被多线并发改，
  **以文中给的锚点文本为准**。

---

## 10. 已决策并落地（2026-10-11 ②，用户拍板）—— 改**派生端色**，不动 `accent`/`accentSoft`

**决策**：§6.4 的方案 **②（治真按钮的根）** 被采纳，但**不按"改 `accent` 字段"落地**，理由：`accent`
是派生源（`glow` = `accent@45%` / `gradientFrom` / `accentDeep` / `brandAccent()` = `darkPalette().accent`），
改它会**牵连品牌主色与发光 token**（与同波"① 深色品牌主色 #7C5CFF 不动"、"▲ 深色 glow 逐字节不变"
两条硬约束冲突），且被 `tools/tests/theme.test.ts:30` 快照钉死。

**落地**：`core/theme.ets` 的 `buildEffects()` 只改**派生** `gradientFrom/gradientTo` —— 经
`gradientEndOf(color, onAccent)`（新增；`GRADIENT_TEXT_MIN_RATIO = 4.5`）：

| 主题 | gradientFrom | 白字实测 | gradientTo | 白字实测 | 处理 |
|---|---|---|---|---|---|
| **dark** | `#7C5CFF` → **`#795AFA`** | 4.3461 → **4.5104** | `#B9A7FF` → **`#7B6EAB`** | 2.0928 → **4.5058** | `deepenToRatio` 最小压深 |
| light | `#6D28D9` | 7.1049 | `#1D4ED8` | 6.7016 | 达标 ⇒ 逐字节不动 |
| aurora | `#34d3b4` | 9.9370 | `#63e6c8` | 12.2246 | 达标 ⇒ 不动 |
| nebula | `#a78bfa` | 6.9507 | `#d68bff` | 8.1034 | 达标 ⇒ 不动 |
| porcelain | `#0071E3` | 4.6967 | `#0066CC` | 5.5666 | 达标 ⇒ 不动 |

- **算法**：沿用 §8 的"线性空间三通道等比缩放"——已在 `core/theme.ets:deepenToRatio`（闭式，无搜索），
  取满足目标的**最小**压深 ⇒ `#795AFA`(4.5104) / `#7B6EAB`(4.5058)，与 §6.2 的候选值**逐字节一致**。
- **零回归**：`dark.accent`（4.3461 → 不变）、`dark.accentSoft`（`#B9A7FF` 不变）、`dark.glow` 不变
  ⇒ 品牌标记、图标、发光全部不受牵连。
- **门禁**：`theme_contrast.test.ts` 新增 **§I**（把渐变两端纳入判定，阈值仍 4.5）；`theme_tokens.test.ts`
  的 `gradientFrom = accent` 不变量 → "端色对 `onAccent` ≥4.5 + 已达标的端逐字节不动"。
  `dark|onAccent|accent` 台账**保留**（§G6 断言不许删 —— 不放宽阈值、不删断言）。
- **ΔL（相对原色，线性空间等比缩放）**：from `k≈0.957`（ΔL ≈ 0.0088）；to `k≈0.405`（ΔL ≈ 0.20）。

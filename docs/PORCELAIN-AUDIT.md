# PORCELAIN-AUDIT.md —— 白主题（porcelain）"所有细节都做好"完整性审计

> **用户原话**：「配合一套特制的、**原生独享的应用白色主题**……**所有细节都做好**」。
> **本文性质**：**只读审计**（不修一行代码）。目的是把"白主题在**每一个面**上都成立"变成**可判据**的事。
> **样张**：`docs/mockups/porcelain.html`（逐面，porcelain vs dark 并排）。
> **审计日期**：2026-10-11｜**审计基线**：`ecf48a9`（工作树）。
>
> **判据（4 条，机器可查）**：
> 1. **取色是否只走语义出口**：`colorOf` / `surfaceFillOf` / `hairlineOf` / `elevationColorOf` / `inflightHaloOf`
>    —— 有没有**直取** `pal().xxx` / `effectsOf()` / `surfacesOf()`；
> 2. **有没有主题名硬判**（`isDarkThemeName`）—— 铁律：深浅**只**走 `isLightPalette(paletteOf(theme))`；
> 3. **有没有把"深色假设"写死**（彩色发光 / 强对比描边 / 白字压在浅色变量上 / 阴影·玻璃按深色配）；
> 4. **对比度**：文本元素 `contrastRatio()` **实调** ≥4.5（弱一档 ≥2.0；大字/非文本 3:1）。
>
> 取色/对比度全部**实调**（把 `core/*.ets` 当纯 TS 编译后 `node` 直调 `colorOf(paletteOf('porcelain'), role)` /
> `surfaceFillOf` / `surfacesOf` / `effectsOf` / `contrastRatio`），**非手抄**。

---

## 0. 一句话结论

**porcelain 的"底子"是成立的**（发丝 1.3308 ≥ 1.3201、四阶文字全套达标、弹层阴影/在飞柔影/光球都已有浅色分支）。

### 0.1 ⚠️ 复核订正（2026-10-11，main agent；原结论已过期，留档见下）

**原文结论（基线 `ecf48a9`）**：唯一的系统性缺陷 = `Effects.glow`/`glowSoft` 不分深浅 + 6 个直取调用点 ⇒ 白底彩色发光。

**现状（复核于 `baaa456`）**：
1. ✅ **已修**：`core/theme.ets:815` 浅色臂 `e.glow = p.transparent`（E2，`2b1fc5f`，判据=「中心对底 ≥1.5 **且** chroma>0」，浅色旧值 1.383:1/chroma=0 ⇒ 判为"脏灰团"不是"光"）。
   ⇒ **那 6 个直取调用点在浅色下已不再出彩色发光**；宪法 `REDESIGN §3.1`「浅色系一律禁彩色发光」**已满足**。
2. 🟡 **仍在**：`e.glowSoft = alphaHex(p.textPrimary, 0.10)`（`theme.ets:817`）**浅色臂未改** —— V6 冻结（等真机截图定夺"灰团"是否要调）；它同样零 chroma。
3. ✅ **已修（2026-10-11 收口）**：`glow` 在 `pages/Index.ets` 被当**投影(shadow)**用的 **4 处**
   （登录徽标 ×2 / 登录 CTA / 发送钮；旧行号 `:3176/:3191/:3283/:3949` ⇒ 现 `:3417/:3432/:3524/:4220`）
   ⇒ 浅色下 `glow = transparent` ⇒ **这些点变成"无投影"**（层次丢失）。
   - **修法（已落）**：`core/theme.ets: shadowColorOf(p, tier)`（口径 `fdb1054`，调用点 `1e3856f`）
     —— 深色 = `glow` **逐字节不变**、浅色 = `elev2`/`elev3` **真投影档**（非透明 + chroma 近中性）。
     ⚠️ **不是** `elevationColorOf`：其深色臂返回 `elev2`（`docs/DESIGN-SYSTEM.md §4.4` 抬升档）⇒ 会**改变深色观感**；
     `shadowColorOf` 深色臂 = `glow` ⇒ **只有它在深色下等价**（且避开 `theme → design` 反向 import 成环）。
   - **逐处判语义（⛔ 不批量替换）**：
     · **(b) 真投影 4 处**（上述）⇒ 改走 `shadowColorOf(p,'raised')`（浅色柔影 / 深色 `glow` 原样）；
     · **(a) 装饰性光晕 2 处** —— 登录顶光晕（`glowSoft` 径向）/ 空态星形圆光（`glow` 径向）**保持 `radialGradient`**、
       浅色下**不出**（正是 E2 要它们透明的两处；宪法 §3.1 禁浅色彩色发光）。
   - **判据**：`tools/tests/porcelain_shadow_sites.test.ts`（21 passed）—— ★ 逐**调用片段**断言"无一处 `.shadow` 引 `glow`"
     + ≥4 处走 `shadowColorOf(this.pal(),'raised')` + 浅色非透明/深色逐字节；**零扫描判红**；
     两层 mutation 实测打红（改回 `glow` ⇒ 红；浅色投影改 `transparent` ⇒ 红）。

---

## 0.2 原文留档（基线 `ecf48a9`，**已过期，勿据此改代码**）

**唯一的系统性缺陷是一条**：`Effects.glow` / `Effects.glowSoft` **不分深浅**（`core/theme.ets` 的 `buildEffects`），
而**有 6 个调用点直取它们** ⇒ 在纯白底上出现**彩色发光/渐变**（宪法 `docs/REDESIGN.md §3.1` 明禁"浅色系一律禁彩色发光"）。

---

## 0.3 本轮修复（porcelain ⚠️-1 / ⚠️-2 / ⚠️-5，2026-10-11；⚠️-3/⚠️-4 只出方案）

> 落点**只在 `core/theme.ets` + `tools/tests/theme_contrast.test.ts`**（⛔ 未碰 `core/design.ets`、未碰任何组件/页面）。
> 判据实算（与 `theme.ets` 的 WCAG 实现同源，非手抄）；mutation 自证见各行。

### ⚠️-1 `warn`/`success`/`statusWaiting` 作小号正文 < AA 4.5 —— ✅ 已修（压深，保色相）

真实落点 13 处均为 `.fontColor(pal().warn|pal().success)`，压在 porcelain 的浅面上。

| 角色 | 旧值 | 新值 | 对 surface | 对 appBg | 对 surfaceHi（最紧面） | 判 |
|---|---|---|---|---|---|---|
| `warn` | `#B26A00` | **`#9C5900`** | 4.238 → **5.465** | 3.959 → **5.105** | 3.625 → **4.674** | ✅ ≥4.5 |
| `success` | `#1E8E3E` | **`#1B7A34`** | 4.205 → **5.412** | 3.928 → **5.055** | 3.597 → **4.629** | ✅ ≥4.5 |
| `statusWaiting` | `#B26A00` | **`#9C5900`**（与 `warn` 同值） | 4.238 → **5.465** | 3.959 → **5.105** | 3.625 → **4.674** | ✅ ≥4.5 |

- **取值口径** = 原值在线性空间**三通道同比压深**（保色相、只改明度；与 neon `accentDeep` 同一手法）——
  目标 = porcelain 白底族**六个面**（appBg/surface/surfaceAlt/surfaceHi/sunken/accentDeep）全 ≥4.5。
- ⛔ 未碰 `successText`(7.13) / `dangerText`(6.57)（已达标，别改浅）；⛔ 阈值一个没放宽（T_BODY 仍 4.5）。
- 判据：`theme_contrast.test.ts` **§J**（新增，含**零扫描判红** + **mutation 自证**：把值改回旧值 ⇒ **18 红**）。
- ⚠️ 影响面（无判据覆盖，需真机连拍核对）：`success` 亦作 goal 徽标 **tint**（`design.ets:635` 的 `withAlpha(p.success, α)`）
  ⇒ 徽标浅绿底略深一档；`statusWaiting` 为**点色**（0 生产文本落点 ⇒ 零像素影响）。

### ⚠️-2 `glassBaseOf`「同色回退」失效 —— ✅ 已修（改成**显式活规则**，⛔ 但**否掉**审计处方）

- **事实核对**：旧判据 `p.surface === p.appBg` 对现有 5 套主题**全为假** ⇒ 死分支（确认）。
- ⛔ **审计处方「浅色一律 `surfaceAlt`」被实测否掉**：那会让 porcelain 玻璃底对画布 **1.0616 → 1.0088**
  —— **跌破**门禁 §E5 地板 **1.02** ⇒ 是**更不可见**，与"恢复分层感"目标相反；且会把 light 主题也改坏。
- **实际修法**（同名函数/同签名，仅换判据）：浅色系 `surface` 对画布 ≥ `GLASS_BASE_MIN_RATIO`(1.02) ⇒ 就用它；
  否则（真退化 `surface≈appBg`）退 `surfaceAlt`，**且仅当它确实更可辨**。porcelain/light 实测 1.0616/1.0380
  ⇒ 都走 `surface` ⇒ **零像素变化**，但判据从"死分支"变成"真在算的活规则"。
- 判据：`theme_contrast.test.ts` **§E5**（+新增 §E5b 合成退化板：**活分支自证** + **mutation 自证**：改回旧 `==` 判据 ⇒ **§E5b 红**）。

### ⚠️-5 `foreground3` 0 消费点 —— ✅ 已登记（**预留角色**，非死代码，⛔ 不删）

- 全仓仅 `core/theme.ets`（声明/5 套色板赋值/`withAccent` 拷贝/`paletteValues`），**0 个 UI 消费点**。
- 定性 = **预留角色**（为对齐 web 权威 `--foreground-3` 的**四阶文字契约**而保留；删了会破
  `paletteValues` 穷尽性 / 五套色板四阶阶梯 / web parity）。
- **登记**：`theme_contrast.test.ts` 的 `ZERO_USE_ROLES` 已机械核实其 0 引用（一旦有组件用 `.foreground3` ⇒ 那段红）；
  `core/theme.ets` 的 `Palette.foreground3` 字段注释已补"预留/已登记"说明。

### ⚠️-3 / ⚠️-4 —— 只出方案（`core/design.ets` 被 `motion-source` 持有，本波不碰）

- **⚠️-3**：`colorOf` 的 `contrastReqs()` 缺 **`textSecondary`/`accent` × `surfaceHi`** 两格
  （实算 `textSecondary #6E6E73` on `surfaceHi #EDEDEF` = **4.337**、`accent #0071E3` on `surfaceHi` = **4.017**，<4.5）。
  方案：在 `design.ets:contrastReqs()` 增两行 `new ContrastReq('textSecondary','surfaceHi',AA_TEXT,…)` /
  `('accent','surfaceHi',AA_TEXT,…)`；**但**修这两格要么压深 `textSecondary`/`accent`（会牵动全站浅色文字/品牌蓝，
  ⛔ 跨主题），要么改选中 pill 的底（组件侧）。⇒ **交回主 agent 派单**（见报告 §方案）。
- **⚠️-4**：`colorOf` 未暴露 6 角色（`foreground3`/`accentHover`/`accentSoftFade`/`bubbleUser`/`borderStrong`/`success`）
  ⇒ 只能 `pal()` 直取、绕过 ⑥b role 门禁。方案：在 `design.ets:colorOf` 补 6 条 `if (role === …) return p.…;` +
  在 `contrastReqs()` 给能压底的补判定；⛔ 跨域（design.ets）。

> **判据基线**：`run.sh` **654/0（theme_contrast）** 全绿（全套 ✅）；`guard.sh --static` **15/0**；
> `hvigorw assembleHap`（clean 后）**BUILD SUCCESSFUL**。观感**待真机连拍**（⛔ 离线数字 ≠ 已验证好看）。

---

## 1. 汇总表（逐面）

| # | 面 | ① 语义出口 | ② 主题名硬判 | ③ 深色假设写死 | ④ 对比度 | 结论 |
|---|---|---|---|---|---|---|
| 1 | **设置面板**（分区切换条 / 各分区 / 单选列表 / 开关行） | 🟡 直取 `pal().xxx` 多（SettingsLlm 18 处 textMuted 等） | ✅ 无 | ✅ 无 | ✅ 全部达标 | **✅ 成立**（① 为纪律欠账） |
| 2 | **插件目录 / widget**（`PluginHost` / `PluginWidgets` / `SettingsPlugins`） | 🟡 直取 `pal().xxx` | ✅ 无 | ✅ 无（chip 底恒 `surface.chip`） | ✅ 达标 | **✅ 成立** |
| 3 | **弹层**（`AskUserSheet` / `StatusSheet` / `QueueSheet` / `MenuSheets`） | ✅ 走 `surfaceFillOf` / `elevationColorOf` | ✅ 无 | ✅ 无（阴影走 `elevationColorOf` ⇒ 浅色 = 中性柔影） | ✅ 达标 | **✅ 成立** |
| 4 | **抽屉 / 会话列表**（含筛选态、渠道 chip、空态） | 🟡 直取 `pal().xxx`（Index 32+32+29…） | ✅ 无 | ✅ 无 | ✅ 达标 | **✅ 成立** |
| 5 | **聊天流 · 用户气泡** | ✅ `userBubbleFace()`（accent@15% + textPrimary） | ✅ 无 | ✅ 无（**无渐变无阴影**，已收敛） | ✅（textPrimary on accent@15% ≈ 14.5） | **✅ 成立** |
| 6 | **聊天流 · 助手正文 / 思考行** | 🟡 直取（`ThinkingLine` 用 `surfacesOf().hairline` 走栅栏色） | ✅ 无 | ✅ 无 | ✅ 达标（textMuted 2.54 ≥ 2.0 弱档） | **✅ 成立** |
| 7 | **聊天流 · 工具 pill 两态** | ✅ `pillBgOf` / `chipBgOf` / `glowColorOf`（浅色 → `elev2` 中性） | ✅ 无 | ✅ 无 | ✅ 达标 | **✅ 成立** |
| 8 | **聊天流 · 代码块（`surface.well`）** | ✅ `wellOf` / `hairlineOf` | ✅ 无 | ✅ 无 | ✅ 达标 | **✅ 成立** |
| 9 | **聊天流 · diff** | ✅ `wellOf`（diff 行底） | ✅ 无 | ✅ 无 | ✅（增删走 successText/dangerText，6.57/7.13） | **✅ 成立** |
| 10 | **聊天流 · 折叠组（工具组）** | ✅ `ToolPill` + `surfaceFillOf` | ✅ 无 | 🟡 **扫光**为彩色渐变（见 §3-🟡-3） | ✅ 达标 | **🟡 需调（装饰）** |
| 11 | **空态 · 失败态** | ✅ `colorOf`（`textMuted` / `dangerText`） | ✅ 无 | ✅ 无 | ✅ 达标 | **✅ 成立** |
| 12 | **加载态**（光球 / `LoadingProgress`） | ✅ `inflightHaloOf`（浅色 = `elev2` 中性） | ✅ 无（`isLightPalette` 分支） | ✅ 无 ✅ | — | **✅ 成立** |
| 13 | **空态插图（星形圆光）** | ✅ 走 `eff()`（但见 ③） | ✅ 无 | ❌ **白底彩色径向辉光**（`Index.ets:3103`） | — | **❌ 坏** |
| 14 | **登录页**（渐变底 / 徽标 / CTA / 顶部辉光） | ✅ 走 `eff()`（但见 ③） | ✅ 无 | ❌ **3 处彩色发光 + 2 处渐变**（§3） | ✅ 文本达标；CTA 蓝底白字 4.70 ✅ | **❌ 坏** |
| 15 | **开屏（T1/T2）** | ✅ `splashCanvasOf` / `colorOf` / `brandAccent` | ✅ 无（`isLightPalette` 在 `splashMarkLevelOf` 内） | ✅ 无（标记 SOLID **零发光**） | 标记（非文本）4.3461 ≥3 ✅ | **✅ 成立**（见 `docs/SPLASH-SPEC.md`） |
| 16 | **通知示意**（`core/notify.ets` 的文案/图标） | — 不进 UI 渲染（系统绘制） | — | — | — | **N/A**（系统通知由系统主题决定，本仓不可控） |

**计数**：✅ **12** 面成立 ｜ 🟡 **2** 面需调（#10 装饰、#1–4 的 ① 纪律欠账）｜ ❌ **2** 面坏（#13 空态插图、#14 登录页）。

---

## 2. 根因（单一，可修）

`core/theme.ets: buildEffects()` 里：

| token | 是否分深浅 | porcelain 实调值 | 后果 |
|---|---|---|---|
| `glassBg` / `glassBorder` | ✅ 分（`glassBaseOf`） | `#9EF6F6F7` / `#8CD8D8DC` | ✅ |
| `sheen` | ✅ 分（浅色 = 黑@6%） | `#0F000000` | ✅ |
| `elev1/2/3` | ✅ 分（浅色 = `textPrimary`@6/10/16%） | `#0F1D1D1F` / `#1A1D1D1F` / `#291D1D1F` | ✅ |
| **`glow`** | ❌ **不分** | **`#730071E3`（accent@45%）** | ❌ 白底彩色发光 |
| **`glowSoft`** | ❌ **不分** | **`#380071E3`（accent@22%）** | ❌ 白底彩色光晕 |

**已有正解**（本仓已有、而 6 个点没用）：
- `core/design.ets: inflightHaloOf(p)` —— 深色 → `glow`（accent@45%）／**浅色 → `elev2`（中性柔影）**；
- `core/toolvisual.ets: glowColorOf(kind, live, theme)` —— 同上口径（`isLightPalette` 判，**不按主题名**）；
- `components/AssistantOrb.ets` 的 `paint` 分支 —— 浅色：光晕 `inflightHaloOf`、核/环 `pal().accent`、细环 `hairlineOf(pal)`。

⇒ **修法（三选一，属 `design-lead`/`theme` 领地，本波不动）**：
(a) 把 `glow`/`glowSoft` 也按 `isLightPalette` 分叉（浅色 → 中性 `elev2`/`elev3`）——**改一处，6 个点全好**；
(b) 把 6 个调用点改成 `inflightHaloOf(p)` / `elevationColorOf(p, …)`；
(c) 登录页/空态按宪法 §3.1 换掉"靠发光立住"的表达（实心/负形/描边）。

> **✅ 已修（2026-10-11 ▲，用户拍板采纳 (a)）**：`core/theme.ets:buildEffects()` 的**浅色分支**新增
> `glow = textPrimary@16%`（= `elev3`）、`glowSoft = textPrimary@10%`（= `elev2`）——**中性柔影**，
> 与 `elev3/elev2` 同族、强弱序保持（16% > 10% 同深色 45% > 22% 同向），并与既有出口
> `inflightHaloOf` 的浅色档（`elev2`）同源。**深色分支逐字节不变**（`accent@45%/22%` 仍是观感来源）。
> ⇒ 本表 6 个调用点（`:2824` 顶部辉光 / `:2846` 徽标 / `:2851`+`:2942` 外发光 / `:3097` 空态圆光）
> **未改一行代码**即变干净（`Index.ets` 正被 `brand-impl` 用于开屏接线，故不动它）。
> 门禁：`tools/tests/orb_porcelain_motion.test.ts` 新增 B2 组（浅色 ⇒ 中性柔影 / 深色 ⇒ 逐字节），
> mutation（浅色分支改回 accent@45%/22%）= 20 passed / 10 failed。

---

## 3. ❌ / 🟡 明细（逐处 `file:line`）

### ❌ #14 登录页（4 处）

| 位置 | 代码 | porcelain 下的实际效果 | 判据 |
|---|---|---|---|
| `entry/src/main/ets/pages/Index.ets:2824-2831` | `.radialGradient colors:[[this.eff().glowSoft,…],[transparent,…]]`（620² 顶部辉光） | `#380071E3` **蓝色径向光晕压纯白** = 脏 | 宪法 `docs/REDESIGN.md §3.1`「浅色系一律禁彩色发光」 |
| `entry/src/main/ets/pages/Index.ets:2846-2849` | 徽标 `.linearGradient(gradientFrom→gradientTo)` = `accent → accentSoft` | `#0071E3 → #0066CC` 蓝渐变方块 | 宪法 §3.1（白主题禁渐变立层次）+ `BRAND.md §2.6` |
| `entry/src/main/ets/pages/Index.ets:2851` | `.shadow({ radius: 26, color: this.eff().glow })` | `#730071E3` 蓝色外发光 | 同上 |
| `entry/src/main/ets/pages/Index.ets:2942` | 登录 CTA `.shadow({ radius: 18, color: this.eff().glow })` | 同上 | 同上 |

### ❌ #13 空态插图

| 位置 | 代码 | 效果 | 判据 |
|---|---|---|---|
| `entry/src/main/ets/pages/Index.ets:3097-3104` | `radialGradient([[this.eff().glow,…],[transparent,…]])` 裁圆（星形背后的"圆光"） | `#730071E3` **蓝色圆光压白底** | 同上 |

### 🟡 #10 折叠组扫光 / 登录页底（装饰性渐变）

| 位置 | 代码 | 效果 | 判据 |
|---|---|---|---|
| `entry/src/main/ets/components/MessageRow.ets:732-736` | 运行中 pill 扫光 `linearGradient(accentSoftFade→accentSoft→sheen→…)` | porcelain 下**蓝色扫光**（可辨，非"发光"） | 🟡 宪法精神（白主题少彩色装饰）；可留待 design-lead 裁决 |
| `entry/src/main/ets/pages/Index.ets:2817-2822` | 登录页底 `linearGradient(appBg→surfaceAlt→appBg)` | porcelain 下 `#FFFFFF→#F6F6F7→#FFFFFF`（**几乎不可见**） | 🟡 白主题不该靠渐变立层次 |

### 🟡 ② 主题名硬判（4 处，均**与 `isLightPalette` 等价** ⇒ 非坏，属纪律欠账）

| 位置 | 用途 | 风险 |
|---|---|---|
| `entry/src/main/ets/pages/Index.ets:3883` | `withAccent(base, a, isDarkThemeName(this.themeName))` —— 强调色覆盖的 hover 方向 | 🟡 若将来"主题名 ↔ appBg 亮度"脱钩则错 |
| `entry/src/main/ets/pages/Index.ets:3901` | `glassMode()` → `ThemeColorMode`（`backgroundBlurStyle` 的 `colorMode`） | 🟡 同上（系统表面 API 只收 ThemeColorMode） |
| `entry/src/main/ets/pages/Index.ets:3925` | `syncSystemTheme` 的 `dark` 判定 | 🟡 同上 |
| `entry/src/main/ets/entryability/EntryAbility.ets:36` | cold start 的 `setColorMode` | 🟡 同上（此处无 Palette，可 `isLightPalette(paletteOf(t))` 替代） |

> **已核**：对**全部 5 个内置主题**，`isDarkThemeName(t)` 与 `isLightPalette(paletteOf(t))` **同值**
> ⇒ 当前**不产生错色**；但违"深浅只走 `isLightPalette`"。建议统一（`core/theme.ets` 领地）。

### 🟡 ① 直取 `pal().xxx`（纪律欠账，按文件计数 Top）

`Index.ets` 32×`textSecondary` / 32×`textMuted` / 29×`textPrimary` / 22×`accent`；`SettingsLlm` 18×`textMuted` / 18×`surfaceAlt` / 15×`border`；`SettingsChannels` 13×`textMuted`；`MessageRow` 13×`textMuted` / `ToolPopover` 13×`textMuted`；…… 
**性质**：`colorOf(p,'textPrimary')` 与 `pal().textPrimary` **取值相同** ⇒ **不产生错色**；但它**绕过 ⑥b 的 role 合法性门禁**（`tools/lint/color-roles.sh` 只扫 `colorOf` 调用）⇒ 拼错角色名不会被抓。**建议**：不强制一次性迁移，但**新增**代码一律走 `colorOf`。

**直取 `effectsOf()` / `surfacesOf()`（真·绕过派生出口）—— 10 处**：
`AssistantOrb.ets:344`（已内部分支 ✅）、`ContextRing.ets:80`（`surfacesOf().hairline` 作轨道 ✅ 值正确）、
`LiveTailView.ets:101`、`MarkdownView.ets:179/227`（`surfacesOf().hairline` 作分隔线 ✅）、
`MessageNav.ets:297`、`MessageRow.ets:234`、`ThinkingLine.ets:131`（`hairline` 作栅栏 ✅）、`Index.ets:3888`。

---

## 3b. 🟡 A 类补充：**弱交互图标**用 `textMuted`（本波新发现，2026-10-11 收口）

- **现象**：chevron（展开/收起）、关闭 ✕、拖拽把手等**交互指示图标**此前用 `textMuted`。
  porcelain 下 `textMuted` 压纯白仅 **2.54:1** —— 它自己的 tier 是 **2.0**（"几乎不该被读到"的**元信息**），
  但**图标**受 WCAG 2.1 §1.4.11「非文本内容」约束，须 ≥ **3:1** ⇒ 浅色系不达标（且白底上"糊"）。
- **修法**：新增语义 role **`iconMuted`**（`core/design.ets: iconMutedOf`）——
  浅色系（`isLightPalette`）⇒ `textSecondary`（porcelain **5.07:1** ✅）；**深色系逐字节不变** ⇒ `textMuted`。
  ⛔ 只用于**图标**；**文字**仍走 `textMuted`（文字档位是另一项设计决定）。
- **已接入**（自由文件）：`GoalBanner.ets`（编辑/关闭 ✕）、`StatusSheet.ets`（chevron）、
  `TodoPanel.ets`（chevron ×2）、`ThinkingLine.ets`（灯泡，非 live 态）、`LlmErrorNotice.ets`（chevron）。
- **待接入（文件被占）**：`MessageRow.ets` 的"更早的 N 个区域/迭代块"展开 chevron（**chat-surface-ux 在途**）⇒ 只出 spec。
- **判据**：`tools/tests/porcelain_icon_contrast.test.ts`（纯对比度 + 深色逐字节 + 组件源码形态；
  mutation：`iconMutedOf` 改回恒 `p.textMuted` ⇒ 红）。

---

## 4. ④ 对比度实调（porcelain，`contrastRatio()`）

**底**：`appBg #FFFFFF` · `surface #FFFFFF` · `surfaceAlt #F6F6F7` · `surfaceHi #EDEDEF` · `sunken #F2F2F2` · `accentDeep #E8F1FD`

| 前景 | vs appBg | vs surfaceAlt | vs surfaceHi | vs sunken | 门槛 | 判 |
|---|---|---|---|---|---|---|
| `textPrimary #1D1D1F` | 16.83 | 15.58 | 14.39 | 15.03 | 4.5 | ✅ |
| `textSecondary #6E6E73` | 5.07 | 4.70 | 4.34 | 4.53 | 4.5 | 🟡（vs `surfaceHi` 4.34 略欠 ⇒ 选中 pill 上的次要字） |
| `textMuted #A2A2A7` | 2.54 | 2.35 | 2.17 | 2.27 | 2.0（弱档） | ✅ |
| `accentSoft #0066CC` | 5.57 | 5.15 | 4.76 | 4.97 | 4.5 | ✅ |
| `accentText #0057B8` | 6.87 | 6.36 | 5.88 | 6.14 | 4.5 | ✅ |
| `dangerText #B42318` | 6.57 | 6.09 | 5.62 | 5.87 | 4.5 | ✅ |
| `successText #166534` | 7.13 | 6.60 | 6.10 | 6.37 | 4.5 | ✅ |
| `statusRunning #0071E3` | 4.70 | 4.35 | 4.02 | 4.20 | 4.5 | 🟡（`surfaceHi` 上 4.02） |
| `statusError #D70015` | 5.38 | 4.99 | 4.61 | 4.81 | 4.5 | ✅ |
| `statusWaiting #B26A00` | 4.24 | 3.92 | 3.63 | 3.79 | 4.5 | 🟡 |
| `statusIdle #8E8E93` | 3.26 | 3.02 | 2.79 | 2.91 | 4.5 | 🟡（更弱一档，等同 `textMuted` 角色） |
| `onAccent #FFFFFF` | **1.00** ⛔ | 1.08 | 1.17 | 1.12 | 4.5 | ⛔ **只能压 `accent`**（4.70 ✅）/`dangerBg`（4.83） |

**发丝可见度**：`hairline #DFDFE1` vs `appBg` = **1.3308** ≥ 门槛 **1.3201** ✅（白底"立得住"的关键）；`border #ECECEE` = 1.1798（**装饰性**，✅ 但**不得承载信息**）。

**结论**：文本对比度**整体成立**；🟡 三处（`textSecondary`/`statusRunning` on `surfaceHi`、`statusWaiting`、`statusIdle`）**当前无已知文本落点**（已 grep 确认 `statusIdle`/`statusWaiting` 未作前景色使用）⇒ 记为**护栏**而非缺陷。

---

## 5. 最影响"白主题成立"的 3 个问题（按用户可感程度）

1. **登录页的彩色发光 + 渐变**（`Index.ets:2824-2831` 顶部蓝辉光 · `:2851` 徽标蓝发光 · `:2942` CTA 蓝发光 · `:2846` 蓝渐变）。
   —— 这是用户在**白主题下第一眼**看到的东西；45%/22% 的 Apple Blue 压纯白 = 明显的"脏光圈"，正是用户要的"干净"的反面。
2. **空态插图的蓝色圆光**（`Index.ets:3097-3104`）。—— 空态是高频面（每个新会话都见），白底圆光观感同上。
3. **根因单点**：`Effects.glow/glowSoft` 不分深浅（`core/theme.ets: buildEffects`）⇒ 这两条**不是个别笔误**，而是"白主题没有发光可用"这一事实**没有在 token 层被表达**。

---

## 6. 仍待拍板 / 建议

| # | 事项 | 建议 |
|---|---|---|
| 1 | 修 `glow`/`glowSoft` 分深浅（§2 的 a 案，改一处修 6 点） | 属 `theme`/`design-lead` 领地，本波**只上报** |
| 2 | 登录页改"不靠发光"的表达（§2 的 c 案：实心/负形/描边） | 与 `docs/REDESIGN.md §3.3` 的三档建议一致 |
| 3 | `isDarkThemeName` 4 处是否统一到 `isLightPalette(paletteOf(t))` | 当前等价 ⇒ 低优先；建议**新增代码**不再用主题名判深浅 |
| 4 | `pal().xxx` 直取是否强制迁移到 `colorOf` | 建议"新增必走、存量渐进" |
| 5 | `MessageRow.ets:732` 扫光在白主题是否保留 | 🟡 装饰性；留待 design-lead |

---

## 7. 审计方法（可复现）

```bash
# 取色/对比度全部实调（与门禁同源）：
W=$(mktemp -d); for m in theme design tokens motion bubble orb; do cp entry/src/main/ets/core/$m.ets "$W/$m.ts"; done
tsc "$W"/*.ts --module commonjs --target ES2021 --strict --skipLibCheck --outDir "$W/js"
node -e 'const t=require("'$W'/js/theme.js"),d=require("'$W'/js/design.js");
  const p=t.paletteOf("porcelain");
  console.log(t.contrastRatio(p.textPrimary,p.appBg), d.surfacesOf(p).hairline, t.effectsOf(p).glow);'
# 逐类 grep（① 直取 / ② 主题名硬判 / ③ 彩色发光·渐变·白字）
grep -rnE "pal\(\)\.[a-zA-Z]+|effectsOf\(|surfacesOf\(" entry/src/main/ets/{components,pages}
grep -rnE "isDarkThemeName|isLightThemeName" entry/src/main/ets
grep -rn "glow\|linearGradient\|radialGradient" entry/src/main/ets/{components,pages}
```

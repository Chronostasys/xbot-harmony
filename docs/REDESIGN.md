# REDESIGN.md —— 原生端重新设计：设计语言宪法

> **地位**：本文件是 xbot-harmony 的**视觉宪法**。任何 UI 改动先读它；与它冲突的既有实现，
> 视为"待迁移"而非"另一套正确"。
> **⚠️ 唯一权威**：旧文 [`docs/DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md)（"深空仪表盘"）**已降级为
> 历史实现说明 + 本文的索引**；**与本文冲突时，一律以本文为准**。
> （该旧文仅保留 SDK 事实清单 §4、光球/在飞/`Surfaces`/空失败/`accentDeep` 的实现取证 §7–§11，
> 以及被门禁与 `ARKTS-GOTCHAS` 直接引用的 **§8 锚点**，且**不再新增规则**。）
> **可执行部分**：`core/design.ets`（语义令牌层）+ `tools/tests/design.test.ts`（123 条断言）。
> **可执行附录**：`docs/mockups/`（静态样张，浏览器直接打开）。
> **权威基准**：功能面仍以 web（`/Users/bobli/src/xbot/web`）为准；**视觉不再逐像素对齐 web**
> ——见 §10 与 `docs/WEB-ALIGNMENT.md §16`（有意分歧登记）。

---

## 0. 为什么要"重做"而不是"调样式"

用户 2026-10-11 明令「**不是只调整样式，要做大的重构重新设计**」「极简、苹果科技感、干净、
交互爽」「比 Siri 好看」「一套特制、原生独享的应用白色主题」「性能也要非常好」。

四份设计输入（`docs/REDESIGN-INPUT-{BUBBLE,PILL,MARKDOWN,BRAND}.md`）逐条证明：
**当前的问题不是"某几个值不好看"，而是"结构上就没有承载新设计的空间"**。四条结构性缺陷：

| # | 缺陷 | 病根（file:line） | 本宪法怎么解 |
|---|---|---|---|
| 1 | **表面层级根本不存在** | pill 底/chip 底/浮层底**共用** `surfaceAlt`/`surfaceHi`/`sunken`（`core/toolvisual.ets:74,86`、`ToolPopover.ets:435`）⇒ "chip 与选中 pill 同色 ⇒ 视觉消失"只是症状 | §3 **分层语义面**：每个面绑定"深度层级"，嵌套面结构性不可能撞色 |
| 2 | **"在飞"用阴影 API，且深浅必须换物理量** | 深色自发光 `glow` / 浅色中性投影 `elev2`（`core/toolvisual.ets:89-100`）；形态是 **5 个 `if` 分支**（`ToolVisual.ets:64-87`） | §4 明确"一次性过渡 vs 在飞"；§3 用**填充层级**表达"在飞"（静态），不再借阴影 |
| 3 | **判据与渲染分居两处** | 目标条视觉判据散在 5 个本地 `const`，含 web 没有的"浅色 ×0.5 描边"**自造第二判据**；真判据在 `core/statusfmt.ets` | §7 判据唯一源；§11 单一"状态→视图"管线 |
| 4 | **散落值**（字面量） | 圆角 17/16/14/12/…、字号 10/11/13、透明度 0.45、发光半径 12、扫光宽 46 | §2/§3 全部进 token；测试设**棘轮**（只减不增） |

> **一句话**：苹果的"高级感"来自**克制的层级**（字号/字重/灰阶/留白），不是来自更多颜色、
> 更多描边、更多发光。本宪法只做三件事：**建层级、收敛值、把判据变成门禁**。

---

## 1. 层级语言 —— 不用装饰建立层次

### 1.1 五把尺子（按优先级）

1. **字号 + 字重**（第一把手，Apple 的层级几乎全靠它）
2. **灰阶**（四阶文字色 `textPrimary/secondary/muted/foreground3`）
3. **留白**（同组内 4/8，组间 12/16/24）
4. **填充层级**（§3：面与面的一档明度差）
5. ~~描边~~ / ~~阴影~~ / ~~发光~~ ← **最后手段**，且**只在有结构理由时**（§3.4）

### 1.2 排版阶梯（`core/design.ets: typeRoles()`）

| 角色 | 字号 | 字重 | 行高 | 字距 | 语义色 | 用在哪 |
|---|---|---|---|---|---|---|
| `type.display` | 28 | 600 | 1.20 | −0.4 | `textPrimary` | 品牌/空态主标题 |
| `type.title` | 21 | 600 | 1.25 | −0.2 | `textPrimary` | 页面/卡片标题 |
| `type.headline` | 17 | 600 | 1.30 | 0 | `textPrimary` | Sheet 头 / 分组标题 |
| `type.body` | **15** | 400 | **1.55** | 0 | `textPrimary` | **消息正文（主角）** |
| `type.callout` | 14 | 400 | 1.50 | 0 | `textSecondary` | 设置说明 / 辅助正文 |
| `type.subhead` | 13 | 500 | 1.40 | 0 | `textPrimary` | 工具名 / 设置行标题 |
| `type.caption` | 12 | 400 | 1.35 | +0.1 | `textSecondary` | 思考行 / 时间戳 / 状态 |
| `type.micro` | **10** | 500 | 1.20 | +0.2 | `textSecondary` | chip / 徽标 / 角标 |

**为什么这样才像苹果**：
- 只用了 **3 个字重**（400/500/600）。Apple 的 SF 系统正文几乎只用 regular/medium/semibold；
  600 只给"标题级"，500 只给"标签级" ⇒ 一眼能读出"这块是标题还是内容"。
- 字号阶梯**严格递减且无重复**（测试 `type.dup` / `type.monotonic` 断言）——重复档 = 层级塌陷。
- **行高显式**（旧 `MarkdownView.ets` 全文**无一处** `.lineHeight()` ⇒ "呼吸"完全不可控）。
  正文 1.55、标题 1.28、代码 1.50（`MD_BODY_LEADING` / `MD_HEADING_LEADING` / `MD_CODE_LEADING`）。
- `type.micro = 10` 是**新档**，专为消灭散落的 `fontSize(10)`/`fontSize(11)`（输入 PILL §A4）。

### 1.3 正文与"大块"的节奏

| 语义 | token | 值 | 依据 |
|---|---|---|---|
| 段落之间 | `GAP_PARAGRAPH` / `MD_BLOCK_GAP` | 8 | 旧为凹口 6（`MarkdownView.ets:160`）|
| 迭代块内（思考/正文/工具） | `GAP_BLOCK` | 4 | web `.iter-block` / `gap-1` |
| 消息条带 | `GAP_ROW_Y` | 6 | web `.virt-row py-1.5` |
| 章节 | `GAP_SECTION` | 12 | — |

---

## 2. 空间与形状 —— 4pt 网格 + 语义档

### 2.1 空间（`spaceRoles()`）

```
space.hair = 2   ← 唯一"光学半档"（只做图标-文字对齐，不作布局步长）
space.xxs  = 4   space.xs = 8    space.sm = 12
space.md   = 16  space.lg = 20   space.xl = 24   space.xxl = 32
```

**规则**：除 `space.hair` 外**一律 4 的倍数**（`designIssues() → space.grid` 断言）。
8pt 网格在触屏上太粗；4pt 起才是 Apple HIG 的实际排版节奏，也正好对齐 web（Tailwind 1 单位 = 4px）。

**语义位置 → 档位**（组件只许引用左列，不许写数字）：

| 语义 token | 值 | 用在哪 |
|---|---|---|
| `INSET_CARD_X/Y` | 12 | 卡片 / 面板内边距 |
| `INSET_ROW_X/Y` | 12 / 8 | 设置行 / 列表行 |
| `INSET_CHIP_X/Y` | 4 / 2 | chip / 徽标 |
| `GUTTER_SCREEN` | 16 | 列表容器左右安全边距 |
| `INSET_BUBBLE_X/Y` | 14 / 8 | 用户气泡内边距（对齐 web `px-3.5 py-2`）|

### 2.2 形状（`radiusRoles()`）

| 语义 token | 值 | 用在哪 |
|---|---|---|
| `RADIUS_CHIP` | 6 | chip / 徽标 / 小填充 |
| `RADIUS_PILL` | 8 | 工具 pill / 小按钮 / 思考行 |
| `RADIUS_CARD` | 12 | 输入框 / 卡片 / 浮层 / 目标条 |
| `RADIUS_SHEET` | 16 | 底部抽屉 / 气泡 / 大容器 |
| `STROKE_HAIRLINE` | 1 | 结构性发丝 |
| `STROKE_RAIL` | 2 | 引用块 / 思考展开体的左栅栏 |

**规则**：圆角阶梯**非递减**，且每个语义档必须落在既有 `core/tokens.ets` 的 `RADII` 上
（禁止再出现 17 / 14 / 5 / 310 这类"拍出来的"值 —— 现在有 70 处 `borderRadius(<数字>)`，测试设棘轮）。

---

## 3. 材质 —— 白色主题的层次（浅色最容易糊）

### 3.1 分层语义面（`surfaceRoles()`）—— 本宪法最重要的一条

根因（输入 PILL §A1）：**三个面共用一个 token** ⇒ 任何"底里有底"必然撞色。
修法：把"面"按**深度层级**编号（`rung`），每个**语义面**绑定到一个层级：

| 语义面 | rung | 填充（深色系） | 填充（浅色系） | 用在哪 |
|---|---|---|---|---|
| `surface.canvas` | 0 | `appBg` | `appBg` | 页面底 |
| `surface.card` | 1 | `surface` | `surface` | 卡片 / 气泡容器 / 浮层面板 |
| `surface.overlay` | 1 | `surface` | `surface`（+ 发丝 + 柔影）| Sheet / 菜单面板 |
| `surface.overlayRow` | 2 | `surfaceAlt` | `surfaceAlt` | 浮层内的行 |
| `surface.overlayRowHover` | 3 | `surfaceHi` | `surfaceHi` | 行悬停 / 选中 |
| `surface.pill` | 2 | `surfaceAlt` | `surfaceAlt` | 工具 pill（普通）|
| `surface.pillSelected` | 3 | `surfaceHi` | `surfaceHi` | 浮层打开的那一枚 |
| `surface.chip` | **4** | **`sunken`** | **`sunken`** | chip（**内嵌凹槽**）|
| `surface.well` | 4 | `sunken` | `sunken` | 代码块 / 终端 / diff 行底 |
| `surface.input` | 1 | `surface` | `surface`（+ 发丝）| 输入框 |

**两个关键决定**：

1. **chip 恒为"内嵌凹槽"（`sunken`），与 pill 是否选中无关**。
   历史 bug：chip 与"选中 pill"曾是同一个 `surfaceHi` ⇒ chip 消失（只剩彩色文字）；
   上一波用"选中时把 chip 与 pill 的色对调"打了补丁 —— 那是**症状修复**。
   本宪法：chip 是 pill **内部**的下沉面，与 pill 的填充**结构上不可能同色**
   （`sunken ≠ surfaceAlt` 且 `sunken ≠ surfaceHi`，逐主题断言）。选中只改 pill 自己的一层。
2. **深浅两套的"升/降"语义不同，但规则同一**：
   - 深色系：**越靠上越亮**（canvas < card < raised < active）⇒ 填充亮度就是层级。
   - 浅色系：白面**无法再变亮** ⇒ "浮起"用 **发丝 + 柔影**；"往里嵌"用**更深的填充**。
   `ladderDirectionOk()` 按 `isLightPalette(色板)` 分别断言，**不按主题名硬判**。

### 3.2 边界的唯一出口

`hairlineOf(p)` = 结构性发丝（**唯一**），必须真的看得见：
- 浅色族：压深到 `HAIRLINE_TARGET_RATIO = 1.3201`（web 权威基线，`docs/DESIGN-SYSTEM.md §9.2`）
- 深色族：`hairline ≡ border`（逐字节，观感已批准，下限 1.20）

⛔ 组件**不得**直接 `pal().border` 当结构边界（那是装饰性描边）。判据见 `hairlineIssue(p)`。

### 3.3 白底"三层"怎么立住（porcelain 实测）

| 层 | 填充 | 与画布的对比度 | 立层次的手段 |
|---|---|---|---|
| 画布 | `#FFFFFF` | 1.000 | — |
| 卡片 | `#FFFFFF` | 1.000 | **发丝**（1.3308）+ **柔影**（`effectsOf` 浅色分支）|
| 浮层 | `#FFFFFF` | 1.000 | 发丝 + `elev3` 柔影 |
| 行/悬停 | `#F6F6F7` / `#EDEDEF` | 1.080 / 1.083 | 填充一档 |
| 凹槽 | `#F2F2F2` | 1.119 | 填充一档（**内嵌**）|

**用户口令里的"干净"= 画布/卡片同白**（不出现 slate 蓝灰底），层次靠**发丝 + 柔影**。
这解释了为什么 `HAIRLINE_TARGET_RATIO` 是"白底不糊"的关键常量。

### 3.4 什么时候可以用描边 / 阴影 / 发光

| 手段 | 允许 | 禁止 |
|---|---|---|
| 发丝 | 结构边界、分组、承载信息的边界 | 装饰性围边（设置页卡片不要到处描边）|
| 阴影 | 浮层（Sheet/菜单）、需要"浮起"的整卡 | 用阴影当"在飞"（§4）|
| 发光（彩色光晕） | **仅深色系**，且**仅光球** | 浅色系一律禁（45% 饱和色晕压白底 = 脏）|

---

## 4. 动效原则

### 4.1 ⛔ 铁律：同一时刻**只有一个"在飞动效"= 光球**

`core/design.ets` 把它变成**可判定**：`motionRoles()` 中 `inFlight=true` 的两个角色
（`motion.breath` 光球呼吸 / `motion.beat` 打字机光标）**owner 必须都是 `orb`**；
`designIssues() → motion.inflightOwner` 断言 **owner 唯一**。
⇒ 任何第二套"呼吸/脉冲/旋转"的归属都会立即变红。

### 4.2 一次性过渡 vs 在飞（**必须分清**）

| 类别 | 定义 | 时长/曲线 | 允许 |
|---|---|---|---|
| **一次性过渡** | 状态变化时**播一次**就停 | `motion.press` 180 / `enterRow` 200 / `enterBlock` 220 / `transition` 320，曲线 spring | 入场、按压、开合、Sheet 弹出 |
| **在飞** | 持续**循环**、直到内容停止前进 | 主呼吸 `2560`（= 8×`D_SLOW`）及其整数分/倍 | **只有光球子系统** |

**时长纪律**：任何动效时长必须 ∈ `allowedDurations()` = `{180, 200, 220, 320, 640, 1280, 2560}`
（= 既有底座取值 + 主呼吸的整数分/倍）。⛔ 不许新造时长（`motion.duration` 断言）。

**曲线纪律**：只走 `components/anim.ets`（全仓唯一 `@ohos.curves` 出口）。
⛔ 组件里不许出现 `Curve.*` / 自算贝塞尔。

### 4.3 什么时候"不做动效"

1. `reduceMotion = true` ⇒ **直接静态呈现**（唯一开关：`LiveTailView.reduceMotion()`，
   一处取值、三处生效：光球停表 / 思考行静态 / 光标常亮）。
   ⚠️ 系统来源 `accessibility.isAnimationReduceEnabledSync()` 是 **@since 23**，
   本工程 pin `compatibleSdkVersion 21` ⇒ 暂时恒 `false`，接线点已预留。
2. App 在后台 / 不可见 ⇒ 停表（不累积相位）。
3. 低端机 / 冷启动预算紧张 ⇒ 降级为**零动效**。

### 4.4 待裁决：排队态的 `ScaleSymbolEffect` 存废

现状 `components/ToolVisual.ets:82` 在 `pending` 档给虚线圆加了一记**符号缩放呼吸**。
**设计裁决：移除**，理由三条：
1. **语义相反**：周期性缩放表达"活的/在跑"，而 `pending` 的语义恰恰是"**还没开始**"
   （后端 `status=pending` ⇒ chip 文案「排队」，语义词是"安静"）；
2. **无法纳入统一节奏**：系统 `SymbolGlyph.symbolEffect` 的节奏**不受 token 控制**
   （输入 PILL §A5.4），必然形成**第二套节拍**——正是 §4.1 铁律要消灭的东西；
3. **极简要求静态**：`pending` 的表达已由"虚线空心圆 + 「排队」文案"两个**非颜色维度**承担（§8.2），
   不需要动效。
**替代**：静态虚线圆（`marker` 形状档）+ 「排队」chip（`type.micro`）。
若用户坚持要"生命感"，**唯一**可接受的形态是**一次性** `motion.enterRow` 淡入（播一次），
⛔ 不得循环。→ 见 §12 未决 #2。

---

## 5. 交互反馈 —— "爽"的判据

| 维度 | 规范 | 判据（可验收） |
|---|---|---|
| **命中区** | `HIT_TARGET_MIN = 44` vp（Apple HIG）| 图标视觉可更小，用 `responseRegion` 外扩；实测 ≥44×44 |
| **即时反馈** | 按压**同帧**变化（不等待动画） | `PRESS_OPACITY = 0.6`（全站唯一，取代散落的 0.75/0.7/0.6）|
| **按压形态** | 文本行**只改透明度**；卡片/大按钮可 `PRESS_SCALE = 0.97` | 只缩卡片，⛔ 文本行不缩放（避免抖动）|
| **长按** | `LONG_PRESS_MS = 400` | 复制/菜单 |
| **加载** | 统一由**光球**表达（唯一在飞） | 组件不自造 spinner 作为"整机状态" |
| **失败** | **一行小字 + 中性色 + 一枚图标**，无填充/无边框/无发光 | 见 `docs/DESIGN-SYSTEM.md §10`（`EmptyNotice`）|
| **无抖动** | 状态切换不引起布局跳动（尺寸不随状态变） | pill 的 marker 槽**恒定 14vp**（`PILL_MARKER_SLOT`）|
| **禁用** | `DISABLED_OPACITY = 0.4` | — |

---

## 6. 白色主题定义（**原生独享** `porcelain`）

### 6.1 语义色表（`Palette` 角色 → 实测值）

| 语义角色 | porcelain | 深色对应（`dark`） | 对比度（vs 白画布/卡）|
|---|---|---|---|
| 画布 `appBg` | `#FFFFFF` | `#0B0B0E` | — |
| 卡片 `surface` | `#FFFFFF` | `#0E0E14` | — |
| 次级面 `surfaceAlt` | `#F6F6F7` | `#14141C` | — |
| 选中面 `surfaceHi` | `#EDEDEF` | `#1D1D28` | — |
| 凹槽 `sunken` | `#F2F2F2` | `#0B0B0F` | — |
| 正文 `textPrimary` | `#1D1D1F` | `#EDEDF2` | **16.830** |
| 次要 `textSecondary` | `#6E6E73` | `#9A9AAB` | **5.071** |
| 更弱 `textMuted` | `#A2A2A7` | `#63636F` | 2.542 |
| 强调 `accent` | `#0071E3` | `#7C5CFF` | CTA 白字 **4.697** |
| 链接/可点 `accentSoft` | `#0066CC` | `#B9A7FF` | **5.567** |
| 强调文字 `accentText` | `#0057B8` | `#C9BCFF` | **6.873** |
| 危险文字 `dangerText` | `#B42318` | `#FF7B7B` | **6.574** |
| 成功文字 `successText` | `#166534` | `#86EFC4` | **7.130** |
| 发丝 `hairline` | `#DFDFE1` | ≡ `border` `#20202B` | 1.3308 / 1.2197 |

### 6.2 对比度要求（**WCAG AA，实测已过**）

| 要求 | 阈值 | porcelain 实测 | 结果 |
|---|---|---|---|
| 正文 / 画布 | 4.5 | 16.830 | ✅ |
| 正文 / 卡片 | 4.5 | 16.830 | ✅ |
| 次要正文 / 卡片 | 4.5 | 5.071 | ✅ |
| **关键 CTA 白字 / 主色** | **4.5** | **4.697** | ✅ |
| 链接 / 卡片 | 4.5 | 5.567 | ✅ |
| 强调文字 / 卡片 | 4.5 | 6.873 | ✅ |
| chip 文字 / 凹槽 | 4.5 | 4.530 | ✅（最紧，余量 0.7%）|
| pill 名称 / pill | 4.5 | 15.583 | ✅ |
| 最弱文字 `textMuted` / 卡片 | 2.0 | 2.542 | ✅ |
| 在飞标记（非文本）/ pill | 3.0 | 5.154 | ✅ |
| 发丝 / 画布（浅色族） | 1.3201 | 1.3308 | ✅ |

> **唯一的已知缺口**（不在 porcelain，在 `dark`）：主按钮白字压在品牌紫上 = **4.346**（差 0.154）。
> 台账条目 `dark|onAccent|accent`，**不许删**（删 = 放宽阈值）。修法需用户拍板品牌主色，见 §12 未决 #1。
> 台账之外任何新缺口都会让 `design.test.ts` 变红。

**为什么 porcelain 能"特制且不割裂"**：四阶文字是**中性灰阶**（`#1D1D1F/#6E6E73/#A2A2A7/#C7C7CC`，
Apple label 家族），`accentSoft/accentText` 用**更饱和的实体色**（不是浅色玻璃），
层次全部靠**发丝 + 柔影**——白底上零发光。

---

## 7. 组件规范

> 每个组件给出「该长什么样 + 状态矩阵 + 禁止事项」。所有数值必须在 `core/design.ets` 找得到。

### 7.1 用户气泡 `UserBubble`

| 项 | 规范 | token |
|---|---|---|
| 形态 | **有面**（着色底 + 圆角 + 右对齐 + 右下小角"尾巴"）| `RADIUS_BUBBLE` / `RADIUS_BUBBLE_TAIL` |
| 内边距 | 水平 14 / 垂直 8 | `INSET_BUBBLE_X/Y` |
| 最大宽 | 85% | `BUBBLE.userMaxWidthPct` |
| 文字 | **正文档 15fp + regular**，色 = `textPrimary`（**不是** `onAccent`）| `type.body` |
| 底色 | **单一来源**：`accent @15%` 透底（⛔ 不许再叠一层不透明 accent 渐变）| `userBubbleBg(p)` |
| 内容 | **必须走 Markdown 渲染**（代码块/表格/链接/列表）| §7.9 |
| 对比度 | 正文 15fp 压在 accent@15% 底上需 ≥4.5（浅色底自动成立）| — |

**状态矩阵**（web 权威，全部待接线）：

| 状态 | 形态 |
|---|---|
| 普通 | 上述 |
| `sending` | 气泡内一行 spinner（**一次性/短时**，不是常驻在飞）|
| `queued` | 气泡 + 「排队」chip（`type.micro`）|
| 通知消息 | 图标 + **发丝**边框（非着色）|
| 含代码块/表格 | 走 §7.9 的 `well` 面 |
| 超长不可断（URL/hash）| 断行策略见 §12 未决 #3 |

⛔ 禁止：`onAccent` 做正文色；不透明渐变做底；`BREAK_ALL` 劈词（见未决 #3）；行内写 `fontSize(15)`。

### 7.2 工具 pill `ToolPill` + 浮层（六档 × 深浅 × 选中 × 溢出）

**判据唯一源**：`core/toolstatus.ets`（`toolStatusKind` / `statusColorRole` / `statusChip` / `isInFlight`）。
**视觉解析唯一源**：`core/toolvisual.ets`（`pillVisual`）。组件**只画**。

| 档 | marker（形状） | 状态色角色 | chip 文案 | 在飞 |
|---|---|---|---|---|
| `done` | 描边勾 | `success` | （无 —— 成功要安静）| 否 |
| `running` | 系统 spinner | `accent` | `执行中`（+时长）| **是** |
| `generating` | 系统 spinner | `accent` | `生成中 N 字` / `生成中…` | **是** |
| `pending` | **静态**虚线空心圆 | `muted` | `排队` | 否（committed）/ 是（live 块）|
| `error` | 实心叉 | `danger` | `失败`（+`exit N`）| 否 |
| `killed` | 减号 | `muted` | `已终止` | 否 |

**表面**（修 A1 根因）：

| 部件 | 面 | 说明 |
|---|---|---|
| pill（普通/选中）| `surface.pill` / `surface.pillSelected` | 选中**只**提亮自己一层 |
| chip | `surface.chip`（= 凹槽）| **恒 ≠ pill 的任何状态** |
| 名称文字 | `textPrimary`（失败 = `dangerText`）| `type.subhead` |
| chip 文字 | `textSecondary`（失败 = `dangerText`）| `type.micro` |
| marker 槽 | 恒定 14vp（`PILL_MARKER_SLOT`）| 所有 pill 左对齐的前提 |

**"在飞"的静态表达**（⛔ 不含动画）：`surface.pill` **提升一层**（到 `pillSelected` 的层级）
或用**静态**色调；扫光由调用方以 `transform`（无新定时器）提供。

⛔ 禁止：pill 内新增呼吸/旋转/脉冲（§4.1）；chip 与 pill 同面；`loadingProgress` 当"整机状态"。

**令牌收编（2026-10-11，工具/状态面实测清单 `docs/mockups/03-tool-states.html` 的 7 条缺口）**：

| 部件 | token | 值 |
|---|---|---|
| pill 内距 | `INSET_PILL_X` / `INSET_PILL_Y` | 8 / **5**（5 是**光学档**，白名单 `opticalValues()`；取 8 会让 pill 长到 30vp）|
| 标记槽 | `MARKER_SLOT` | 14（恒定 ⇒ 左对齐前提）|
| 标记 glyph | `MARKER_GLYPH` / `MARKER_GLYPH_DASHED` / `MARKER_SPINNER` | 13 / 12 / 13 |
| pill 最大宽 / 外边距 | `PILL_MAX_W` / `GAP_PILL` | 240 / 3 |
| 在飞表面 | `INFLIGHT_PILL_SURFACE` | `surface.pillSelected`（**静态**提升一档）|
| 在飞柔影 | `inflightPillShadowOf(p)` + `INFLIGHT_PILL_GLOW_RADIUS` | 深色 `glow` / 浅色 `elev2`；半径 12（**静态色**，⛔ 不含动画）|
| 浮层阴影 | `ELEV_CARD` / `ELEV_RAISED` / `ELEV_OVERLAY` + `elevationColorOf/LevelOf` | 语义出口，组件不再直接 `effectsOf()` |

**★ 裁决：chip 的唯一语义 = `surface.chip`（= 内嵌凹槽 `sunken`），不随选中变化。**
⇒ `core/toolvisual.chipBgOf` 里"选中时把 chip 与 pill 对调"是**旧补丁**，迁移时
**删除**，改为 `surfaceFillOf(p, 'surface.chip')`（一处、可测）。
理由：chip 是 pill **内部**的下沉面，与"pill 是否被选中"是**正交**的两件事；
把两者耦合起来才会产生"chip 与选中 pill 同色 ⇒ 消失"的整类 bug。

**纯白主题的层级下限**：任一可嵌套面的对比度 ≥ `MIN_LEVEL_DELTA = 1.025`；
低于 `HAIRLINE_ASSIST_BELOW = 1.05` 时该面**必须补一条结构性发丝**
（porcelain 的 pill↔chip = 1.037 ⇒ **落在此区，须补发丝**；`chipNeedsHairline(p)` 可判）。

**★ 排队态 `ScaleSymbolEffect`：移除**（裁决，见 §4.4）—— 静态度 = 虚线空心圆 + 「排队」chip。

### 7.3 思考行 `ThinkingLine`

- 头部 = 图标（光球关闭时）+ 标签，`type.caption`，`w-fit`（热区只覆盖图标+文字）。
- **恒静态**：⛔ 不呼吸、不脉冲（第二处脉动源 = 用户报的「两个思考 spinner」）。
  `live` 时**只改色**（`accentSoft`）。
- 展开体：`type.caption` + `textMuted` + `opacity 0.75`；左栅栏 `STROKE_RAIL` + `hairline`。
- 光球开启时以**光球作前导图元**（读作"这一行在飞"，而不是"行上方另飘一个 spinner"）。

### 7.4 上下文环 `ContextRing`

- `ProgressType.Ring`，20vp 环 + 28vp 热区；`STROKE` = 2；轨道 = `hairline`（**不是** `border`）。
- 弧色：`ctxLevel ≥ 80` ⇒ `statusError`，否则 `accent`。
- 点击弹浮层（`type.micro` 等宽）；**无中心数字**（parity）。
- ⛔ 无数据**不挂载**（不显 0% 假值）。

### 7.5 导航 `MessageNav`

- **无硬边框**（1px 描边在整条流里是唯一的"遗留 box"，实测像素证据见 `minimal_chrome.test.ts`）。
- 底纹仅用于内容滚到底下时的可读性（Δ1 亮度）；`RADIUS_PILL`；按压 `PRESS_OPACITY`。
- 命中区：视觉 32，`responseRegion` 外扩到 **44**（`HIT_TARGET_MIN`）。
- `< 2` 个用户锚点 ⇒ 零渲染（判据 `core/msgindex.ets:shouldShowNav`）。

### 7.6 设置行 `SettingsRows`

- 统一"标题 + 说明 + 控件"三件套；标题 `type.subhead`、说明 `type.callout`。
- 行内 `INSET_ROW_X/Y`；分组头 `type.caption`。
- **不描边**（¥ 极简：设置页从"到处描边"滑走一次，见 `DESIGN-SYSTEM §9.6`）；分组靠**发丝**。
- ⛔ 成员名不得用基类黑名单（`enabled` ⇒ `isOn`）。

### 7.7 待办条 `TodoPanel`

- 收起态一行 28vp：展开箭头 + 进度条（48×6）+ `done/total` + 当前任务（`type.caption`）。
- 状态图标：done→✓`success` / doing→◐`accent` / pending→○`muted`。
- `total === 0` ⇒ **整个面板不存在**。
- 进度条用 `RADIUS_CHIP` 级别的小圆角；满/空对比 ≥3:1。

### 7.8 目标横幅 `GoalBanner`

| 项 | 规范 | 替换掉 |
|---|---|---|
| 底 | `surface.card`（**单一来源**）| 5 个本地 const |
| 描边 | 进行中 = `accent @30%`；完成 = `success @30%`（**各自一套**，⛔ 不许"浅色 ×0.5"临时系数）| 自造第二判据 |
| 文字 | `type.caption`，`textPrimary`；完成 ⇒ `textMuted` + 删除线 | — |
| 徽标 | `surface.chip` 底 + 状态色文字，`type.micro`，`RADIUS_CHIP` | `BADGE_FS`/内联 padding |
| 图标 | `sys.symbol.dart_target` / 完成态勾 | — |
| 间距 | `INSET_CARD_X/Y`（12/8），外边距 `GAP_SECTION` | `PAD_X=10/PAD_Y=6` |
| 命中区 | 编辑/清除按钮 ≥44（触屏常显）| 图标 12fp 无热区 |

⛔ 禁止：`display()` 调 10+ 次每次重建对象（改为**一次**取 VM，见 §11）；呼吸点（铁律：一次性过渡才允许）。

### 7.9 Markdown 正文面（**"单一状态→视图"的范例**）

- **单轴配色**：主题深浅是**唯一**的明暗轴。⛔ 不许再有 `isLightPalette × isLightMdTheme` **两条轴交叉**
  （现状 `inlineCodeFg` / `codeChromeOnTone` / `codeStripBg` / `codeStripAction` **4 份判据**）。
  md 主题**降级为"代码高亮覆盖项"**，未选则完全跟随色板。
- 排版尺度：`MD_*` 组（§1.2/§1.3）替换全部凹口值。
- 表面：代码块/终端/diff 行底 = `surface.well`（`sunken`）；行内码胶囊底 = `surface.well`；
  引用块底 = 浅色系 `glassFillOf`（玻璃不可见时回落 `surfaceAlt`）+ 左栅栏 `accent` `STROKE_RAIL`；
  表头底 = `surface.overlayRow`；分隔线 = `hairline`。
- 代码高亮**复用** `core/highlight.ets`（Prism4j，与 `ToolPopover` **同一个**高亮器）。
- 溢出：词内折行（正文）；代码"不换行"与宽表 ⇒ **横向 `Scroll`**（⛔ 不许静默裁剪丢数据）。

---

## 8. 可验证（把可访问性写成门禁）

以下四条**必须**是可自动化断言（已落地 `tools/tests/design.test.ts`；工具面部分见 §11 待接线）：

### 8.1 六档状态色**两两不同**（色盲可辨的第一维）
`statusColorRole(kind)` 六档映射到主题色后**两两不同**：`pending≠running`、`done≠killed`…
（断言锚点：`core/toolvisual.statusColorOf` 对六档的返回值集合 size = 6 中可区分者）

### 8.2 **把颜色抹掉**后仍可辨（第二维）
`(marker, chip)` 六组合**互不相同** ⇒ 断言"无颜色信息仍能区分六档"。
（`done` 无 chip 但 marker=勾；`running`/`generating` 同 marker 但 chip 文案不同。）

### 8.3 每档文字-底色**对比度 ≥ 阈值**
复用仓内 WCAG 口径（`core/theme.ets:contrastRatio`，本设计层 `contrastAudit(theme)`）：
- chip 文字（`textSecondary`）/ chip 底（`sunken`）≥ **4.5**；失败档 `dangerText`/`sunken` ≥ 4.5；
- pill 名称（`textPrimary`/`dangerText`）/ pill 底（`surface.pill`、`surface.pillSelected`）≥ **4.5**；
- 在飞标记（非文本）/ pill 底 ≥ **3.0**。

### 8.4 `chipBg ≠ pillBg`（全主题、含选中）
已由 `nestingPairsDistinct(p)` + `surface.chip = sunken` **结构性保证**（逐主题断言）。

> **mutation 自证**（提交信息已写明）：改坏任一锚点即红 —— 例：把 `surface.chip` 的 rung
> 从 `SUNKEN` 改成 `RAISED` ⇒ `surface.nesting` 红（这正是历史 bug 的根因）；
> 把 `motion.beat` 的 owner 改成 `pill` ⇒ `motion.inflightOwner` 红。

---

## 9. 品牌与开屏

### 9.1 需要的语义角色（并入本宪法，落地待接线）

| 角色 | 语义 | 现状 |
|---|---|---|
| `brand.primary` | **品牌主色角色**（≠ `accent`；启动器/开屏/徽标共用）| 现为启动器/开屏的紫（`core/brand.ets`）|
| `brand.onPrimary` | 标记反色 | `#FFFFFF` |
| `brand.mark.foreground` / `brand.mark.background` | **分层图标**前景/背景 | 新增（为 layered 做准备）|
| `splash.canvas.light` / `.dark` | 开屏底 | 现为字面量（`resources/.../color.json:3`）|
| `splash.mark.surface` | 开屏标记承载面（**与主界面同源**）| 新增（消除 §9.2 断层）|

### 9.2 四条断层 → 本宪法的处置

1. **开屏色在资源层取不到 token** ⇒ 冷启动"跳色"。**处置**：`splash.canvas.*` 必须在
   冷启动色与首帧色之间**逐字节一致**；改任一画布 token 时 `color.json` 必须同步（人工纪律 + 门禁）。
2. **开屏跟系统深浅、不跟应用主题** ⇒ 白主题必跳色。**处置**：启用 `startWindow` →
   `FOLLOW_APPLICATION`（配置面 patch，见 §12 未决 #5）。
3. **图标静态、单层、尾巴超安全区**（实算 393.9 > 313）。**处置**：`brand.mark.*` 分层图标 +
   建议标记最大半径 ≤ 0.8×512 ≈ 410 且前景安全区 ≤ 313；降级链见 §9.3。
4. **品牌紫 ≠ porcelain 的 Apple Blue** ⇒ 紫图标 + 蓝界面。**处置**：`brand.primary` 是
   **独立角色**；白色主题下品牌标记**统一到 `brand.primary`**（不与 `accent` 强绑）——
   是否与 Apple Blue 合并见 §12 未决 #4。

### 9.3 白色主题下的开屏（⛔ 不靠发光）+ 降级链

| 档 | 形态 |
|---|---|
| 1. 满幅品牌色（深色底/启动器）| 反色 glyph 压在 `brand.primary` 上 |
| 2. **实心标记 on 中性白**（白主题/浅色底）| `brand.primary` glyph 压 `splash.canvas.light`，**零发光** |
| 3. 单色轮廓（极端降级/无障碍）| `brand.primary` 描边 glyph，零填充、零发光 |
| 4. 纯文字 wordmark | 最后的兜底 |

**对比度下限**：品牌图形 ≥ **3:1**（非文本）；品牌文字 ≥ **4.5:1**。

### 9.4 "开屏 → 主界面"的**一次性过渡**

| 阶段 | 内容 | 时长 |
|---|---|---|
| A. 系统开屏 | 静态标记 + `startWindowBackground` | 系统 |
| B. 标记入场 | `scale 0.92→1` + `opacity 0→1`，**一次** | `motion.enterBlock` = 220ms |
| C. 让位主界面 | `opacity 1→0` 上移消隐 | `motion.transition` = 320ms |

⛔ **不得与"在飞=光球"并存**（一次性过渡，播完即停）；⛔ 不得阻塞 `bootstrap()`；
`reduceMotion` ⇒ 直接静态呈现（§4.3）。

---

## 10. 与 web 的关系：**视觉不再逐像素对齐**

- **功能面**：仍以 web 为**权威**（状态机、判据、文案、交互语义）。
- **视觉面**：本宪法是**新权威**。凡与 web 视觉冲突处，按本宪法执行并**登记**为有意分歧
  （`docs/WEB-ALIGNMENT.md §16`，追加文本块见交付）。
- 已确认的有意分歧（不止视觉）：① 用户气泡 `BREAK_ALL` vs web `anywhere`；
  ② 空/失败用"一行小字"而非 web 的填充红盒；③ 目标条呼吸点不做；④ 排队态符号呼吸移除（§4.4）。

---

## 11. 单一"状态 → 视图"管线（禁止第二套判据）

```
core/store（唯一状态）
   │
   ├─ core/toolstatus   （工具：raw status → kind / chip / 在飞 / 色角色）   [纯, 可测]
   ├─ core/streammerge  （行/迭代合并，终态优先）                          [纯, 可测]
   ├─ core/statusfmt    （goal / todos / usage 的显示判据）                 [纯, 可测]
   ├─ core/msgindex     （导航锚点 / 最近序号）                            [纯, 可测]
   ├─ core/ctxring      （环档位 / 文案）                                  [纯, 可测]
   └─ core/mdview（新增）（MdBlock[] → MdBlockVM[]，含行内样式 + 溢出策略） [纯, 可测]
   │
   ▼
core/design（本宪法：语义令牌 —— 尺度/层级/材质/动效/对比度）              [纯, 可测]
   │
   ▼
components/*（**只画**：把 VM + token 赋给属性；零字面量、零判据、零分支式状态映射）
   │
   ▼
pages/Index（**只做组合与数据接线**；所有 @Builder 的"会变内容"下沉为真 @Component）
```

**铁律**：
1. **一个状态、一份判据、一处渲染**。任何"组件里再判一次"都是回归（§0 缺陷 3）。
2. 判据必须住 `core/`（组件不进离线 harness ⇒ 判据写进组件 = **不可测**）。
3. 视觉取值只经 `core/design` 的 token（§2/§3）。
4. 拆解分阶段方案见 `docs/REDESIGN-STRUCTURE.md`。

---

## 12. 未决问题（需用户拍板）

| # | 决策 | 选项 | 影响 / 现状 |
|---|---|---|---|
| 1 | **品牌主色是否改** | (a) 保留 `#7C5CFF`；(b) 加深到能过 AA 的一档（需实算）；(c) 白色主题直接用 `accent`（Apple Blue）| 唯一杠杆是品牌主色；现状 `dark` 主按钮白字 4.346（差 0.154）。改它影响启动器/开屏 + `dark/aurora/nebula` 主色 + web 对齐 |
| 2 | **排队态符号呼吸** | (a) **移除**（本宪法裁决，推荐）；(b) 保留为"唯一登记的例外"；(c) 改为**一次性**淡入 | §4.4；影响 `ToolVisual.ets:82` |
| 3 | **用户气泡断行策略** | (a) 保持 `BREAK_ALL`（不溢出但劈词）；(b) `BREAK_WORD` + 气泡 maxWidth 折中；(c) 用 `Text` + 手动插入零宽断点 | ArkUI 无 `anywhere` 等价物；web 明确必须 `anywhere` |
| 4 | **白色主题品牌标记色** | (a) 品牌紫（与界面 Apple Blue 不一致）；(b) 统一到 Apple Blue；(c) 白色主题专用品牌色 | §9.2 断层 4 |
| 5 | **是否启用 `startWindow` FOLLOW_APPLICATION** | (a) 启用（消冷启动跳色）；(b) 维持 FOLLOW_SYSTEM | 改 `module.json5`（配置面，需 patch）|
| 6 | **是否采用分层图标** | (a) 采用（foreground/background + `layered_image.json`）；(b) 维持单层 | 需改 `app.json5` |
| 7 | **是否引入 App 内品牌开屏页** | (a) 引入（真动效载体）；(b) 用首帧标记入场即可 | §9.4；新增页面/路由 |
| 8 | **横向 Scroll 手势** | 需真机验证（代码块/宽表横滑嵌在纵向 List 内）| 影响 §7.9 溢出策略落地 |
| 9 | **chip 文字档** | (a) `textSecondary`（porcelain 余量仅 0.7%）；(b) `textPrimary`（更稳但更重）| §7.2；影响"安静"读数 |
| 10 | **灰阶可辨性够不够**（排队灰 vs 执行中蓝在去色后趋近）| (a) **默认：靠形态+文案两维**（当前已满足 §8.2）；(b) 再给失败/终止加 1px 边框差（`danger@30%`）| 推荐 (a)；(b) 只在用户实测色盲不可辨时启用，代价是"多一条边"|
| 11 | **纯白三层"面"的层次够不够**（pill↔chip 只差 1.037）| (a) **默认：给 chip 补发丝**（`chipNeedsHairline` 已判，porcelain 命中）；(b) 加深 chip 填充；(c) 接受现状 | 推荐 (a)：不动色值、只加一条安静的结构线，最"苹果" |
| 12 | **排队态删除呼吸后的静态度** | (a) **默认：静态虚线空心圆 + 「排队」chip**（§4.4）；(b) 换成实心灰点（更"重"）；(c) 保留一次性淡入 | 推荐 (a)；⛔ 任何选项都**不能**是循环动效 |

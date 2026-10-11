# REDESIGN-INPUT-BUBBLE —— 用户气泡 & 目标横幅 的重构输入

> 给 `design-lead`（新设计系统负责人）的设计输入。
> 起因：用户 2026-10-11 明令「**不是只调整样式，要做大的重构重新设计**」「这样才能超过苹果」
> ⇒ 原始「精修两处样式」的任务被**终止**（对外观微调的半成品已放弃，见文末「本轮收口」）。
> 本文只做一件事：**证明"调样式救不了"，并把新设计系统需要的东西列清**。
>
> 事实基准：web 权威 `/Users/bobli/src/xbot/web`；原生 `/Users/bobli/src/xbot-harmony`。
> 所有引用均为**已读代码**的 file:line（本次逐条核对过）。

---

## 0. 一句话结论

这两个面**当前不是"样式参数不对"，而是"结构上就没有承载新设计的空间"**：

- **用户气泡**把「底色 + 文字色 + 换行 + 内容渲染」四件事分别用了**三套互相打架的来源**
  （映射表 `core/bubble.ets` / 主题 `Effects` 渐变 / 硬编码 15fp·`onAccent`），且**完全不解析 Markdown**
  —— 圆角/内边距再怎么调，都改变不了"用户发的代码块在原生里是一坨纯文本、宽表格/长 URL 会溢出"这件事。
- **目标横幅**的视觉判据散落在 **5 个本地 `const`**（含一条 web 没有的"浅色 0.5 描边"**自造第二判据**），
  而真正的"显示什么"判据在 `core/statusfmt.ets` —— **判据与渲染分居两处**，正是本仓被反复咬的
  「同一信息两处判据」病根（`docs/WEB-ALIGNMENT.md §16` #5）。

---

## 1. ① 用户气泡 `components/UserBubble.ets` 现状解剖

### 1.1 硬编码值台账（逐条 file:line）

| # | 位置 | 值 | 性质 | web 权威 |
|---|---|---|---|---|
| 1 | `UserBubble.ets:44` | `.fontSize(15)` | **字面量**（未走 `core/tokens.ets` 的 `FS_BODY=14`） | web 用户气泡走 `MarkdownRenderer`，正文 `text-sm`=14 |
| 2 | `UserBubble.ets:44` | `.fontColor(this.pal().onAccent)` | **"实心 accent 上的文字"角色**，却被用在 **accent@15% 透底**上 | `UserMessage.tsx:272` `text-text-primary` |
| 3 | `UserBubble.ets:43` | `.wordBreak(WordBreak.BREAK_ALL)` | 断行策略**字面量**（等于 CSS `word-break:break-all`） | `UserMessage.tsx:266` `wrap-anywhere`（`overflow-wrap:anywhere`，**有意不同**，见 §1.3） |
| 4 | `UserBubble.ets:52-55` | `.linearGradient({angle:135, colors:[[eff.gradientFrom,0],[eff.gradientTo,1]]})` | **第二个底色来源**，且两端色是 `accent`/`accentSoft`（**全不透明**）⇒ 盖住下面的 `backgroundColor` | web 只有 `bg-accent/15`（`UserMessage.tsx:272`），**没有渐变** |
| 5 | `UserBubble.ets:61` | `.shadow({radius:12, elev1, offsetX:0, offsetY:2})` | `radius=12` / `offsetY=2` **字面量**（阴影口径未进 token） | web 气泡**无阴影** |
| 6 | `UserBubble.ets:41` | `Row(){ Blank() … }` | 用 `Blank()` 撑开做右对齐（结构性 hack） | `UserMessage.tsx:234` `flex justify-end px-1` |
| 7 | `UserBubble.ets:24-28` | `@Prop text` + `onLongPress` | **只有 3 个入参、无内容模型** | web 有 `isEditing/sending/queued/isNotification/content/onRewind/…`（`UserMessage.tsx:28-47`） |

映射表本身（`core/bubble.ets:32-56` 的 `BUBBLE`：#1 之外的圆角 16/16/16/2、内边距 14/8、maxWidth 85%、
行距 4/6）是**干净且可测**的（`tools/tests/bubble_style.test.ts:39-56` 逐值钉死）。**问题不在它**，在于
它在 `UserBubble.ets` 里被**渐变叠层 + 硬编码字号/字色**旁路。

### 1.2 自造的第二套判据（本仓最敏感的一类）

- **底色有两个来源**：`UserBubble.ets:51` `.backgroundColor(userBubbleBg(pal))`（= `core/bubble.ets:74`
  accent@15%，**对齐 web**）与 `UserBubble.ets:52-55` 的不透明渐变（**web 没有**）。
  真机实测（本次只读截图采样）：深色下气泡渲成 **饱和紫渐变**（≈ `#7C5CFF→#B9A7FF`），
  即 **`bg-accent/15` 被完全盖住** —— 等价于"映射表写的是 web，屏幕上跑的是另一方"。
- **文字色与底色不配对**：底色最终是**不透明 accent 渐变**时 `onAccent` 可读；一旦任何一处把渐变
  去掉、只剩 accent@15% 透底，`onAccent`（porcelain/light = `#FFFFFF`）就变成**白字压极浅蓝底**。
  **同一个字段，随"渐变在不在"两种相反语义** —— 这就是"改一处崩另一处"的根源。

### 1.3 换行表现：web 与原生**有意不同**，且原生当前未登记

- web `UserMessage.tsx:257-265` 明确：**必须** `overflow-wrap:anywhere`，**不能** `break-word`
  （因为 `break-word` 不计入 min-content，会让 85% 约束失效、手机上左右被裁）。
- 原生 `WordBreak.BREAK_ALL`（`UserBubble.ets:43`）是另一个极端：它会在**任意字符间断行**，
  正常英文单词也会被劈开（`hello wor|ld`）。ArkUI 无 `anywhere` 的等价物
  （只有 `BREAK_WORD`/`BREAK_ALL`/`BREAK_HYPHEN`）。
- ⇒ 当前是"**保住了不溢出，牺牲了正常词换行**"的妥协，**未在 `docs/WEB-ALIGNMENT.md §16` 登记**
  （违反"有意分歧必须登记"的纪律）。新设计必须给这一档一个明确决策，而不是继续靠 `BREAK_ALL` 蒙。

### 1.4 结构性/功能缺口（"调样式"根本够不到）

- **完全不解析 Markdown**（`UserBubble.ets:43` 直接 `Text(this.text)`）：用户输入的 `**粗体**`、
  反引号行内码、```代码块```、列表、链接、表格，全部**按原样字符显示**。而 web 明确
  **用同一个 `MarkdownRenderer` 渲染用户消息**（`UserMessage.tsx:283`，文件头注释也写"ensuring identical
  markdown rendering"）。这是"长文与代码块的换行表现"问题的**真因**：代码块在原生里没有"代码块"这个盒子，
  自然无从谈换行。
- **入参模型缺一半**：web 气泡还承载 `sending`（转圈行 `:286-291`）、`queued`（排队行 `:292-297`）、
  `isNotification`（🔔 + muted 边框态 `:270-272,236-238`）、compaction 折叠占位（`:212-231`）、
  行尾 copy/rewind 按钮（`:300-335`，触屏 44px 命中区）。原生 `UserBubbleView`（`UserBubble.ets:24-28`）
  **一个都没有** —— 这些是"内容层次/可交互性"的一部分，属于要重构的范围，不是补俩 padding 能解决的。

---

## 2. ② 目标横幅 `components/GoalBanner.ets` 现状解剖

### 2.1 硬编码值台账（逐条 file:line）

| # | 位置 | 值 | 性质 | web 权威 |
|---|---|---|---|---|
| 1 | `GoalBanner.ets:38-40` | `PAD_X=10` / `PAD_Y=6` | 本地 `const`（未走 `core/tokens.ets`） | `GoalBanner.tsx:75` `px-2.5 py-1.5` |
| 2 | `GoalBanner.ets:42` | `ICON=14` | 本地 `const` | `GoalBanner.tsx:79,82` `size-3.5` |
| 3 | `GoalBanner.ets:44` | `BADGE_FS=10` | 本地 `const`（`text-[10px]`） | `GoalBanner.tsx:135` |
| 4 | `GoalBanner.ets:46-47` | `BORDER_ALPHA_DARK=0.3` / `BORDER_ALPHA_LIGHT=0.5` | **自造第二判据**：web 只有单一 `border-accent/30` | `GoalBanner.tsx:69-71`（无浅色分支） |
| 5 | `GoalBanner.ets:49` | `BADGE_TINT=0.15` | 本地 `const` | `GoalBanner.tsx:137-138` `/15` |
| 6 | `GoalBanner.ets:186` | `.padding({left:6,right:6,top:2,bottom:2})` | **内联字面量**（徽标内边距） | `GoalBanner.tsx:135` `px-1.5 py-0.5` |
| 7 | `GoalBanner.ets:190,200` | `.fontSize(12)` | **内联字面量**（编辑/清除图标） | `GoalBanner.tsx:152,165` `size-3` |
| 8 | `GoalBanner.ets:211` | `.backgroundColor(this.pal().surface)` | 用**全不透**的 `surface` | `GoalBanner.tsx:68-71` `bg-bg-primary/92`（**92% 半透**，`surface` 口径不同） |
| 9 | `GoalBanner.ets:159-176` | `Text` + `maxLines(1)` + `BREAK_ALL` + `layoutWeight(1)` + `onClick` | 用**一个 Text 同时承载**文本/截断/点击编辑三种职责 | `GoalBanner.tsx:117-129` 用 `<button>`（语义 + `cursor-text` + hover 变色） |

### 2.2 判据与渲染分居两处

- "显示什么"的**唯一判据**在 `core/statusfmt.ets`：`goalDisplay()`（`:136-149`）、`goalEditCommit()`（`:156-162`）、
  `goalEditable()`（`:165-167`）、徽标文案 `GOAL_BADGE_ACTIVE/DONE`（`:112-114`）—— 这部分**设计良好、可单测**
  （`tools/tests/goal.test.ts` 已覆盖）。
- 但"长什么样"的判据却另起炉灶散在组件里（上表 #4 的浅色描边、#8 的 surface 口径、#2/#6/#7 的尺寸）。
  ⇒ 组件**调用 `this.display()` 多达 10+ 次**（`GoalBanner.ets:78-79,110,119-123,159-164,172,179-184,189`），
  每次重建一个 `GoalDisplay` 对象；新设计若继续这个结构，状态一多必失控。

### 2.3 与 web 的有效差异（需登记/重估）

- **呼吸点**：web `GoalBanner.tsx:83` 有 `animate-ping`（2s 循环）的进行中呼吸点。原生**刻意不加**
  （`GoalBanner.ets:112-113` 注释）—— 符合"全仓只允许一个在飞动效 = 光球"的铁律。**这是有据的分歧，
  正确，应保留并登记**。
- **图标**：web 用 lucide `Target`；原生用 `sys.symbol.dart_target`（`GoalBanner.ets:119-121`），
  已对 `id_defined.json` 核实存在（`circle_badge_checkmark` 曾不存在，见 `GoalBanner.ets:114-117`）。
- **已完成卡底**：web `border-green-500/30 bg-bg-primary/92`；原生走 `pal().success` + `pal().surface`，
  色相正确但**透明度口径不同**（#8）。

---

## 3. 结构约束（"被什么限制了"——重构必须先解开这些）

1. **接线点在带参 `@Builder` 内**：用户气泡在 `pages/Index.ets:5144-5153`
   （`@Builder ChatRowBody(row: ChatRow)` → `UserBubbleView({...})`）。⛔ 本仓铁律：**带参全局 `@Builder`
   的子树不随参数重建**（`docs/ARKTS-GOTCHAS.md` 头项）⇒ 新气泡若要**响应式**（如 streaming 态、
   展开/折叠），必须走**真 `@Component` + `@Prop`/`@Link`**，不能加在 `ChatRowBody` 里靠参数刷新。
2. **`@Reusable` 是雷区**：`UserBubble.ets:2-10` 记着历史事故 —— 早前 `@Reusable` 复用未在
   `aboutToReuse` 更新数据 ⇒ **跨会话串内容**（提交 `be677da`「所有会话都渲染了第一个会话的迭代」）。
   新气泡若引入展开态/附件/状态，**复用契约要先想清楚**（`@Reusable` + `@Prop` 深拷贝语义）。
3. **目标态来自页面 `@State` 中转**：`GoalBanner` 的 `objective/status` 由 `pages/Index.ets:474-475`
   的 `@State goalObjective/goalStatus` 喂入（`:3282-3285`），上游同步在 `:1107-1113`
   （`progress.goal.objective/.status` 对账）。⚠️ 另有**跨文件缺陷**：`core/store.ets:127` 的 `goal` 字段
   **从未被赋值**（全仓无写入点），`core/types.ets` 的 `GoalInfo{text?}` 与 `core/chattypes.ts:9`
   的 `{objective,status}` **同名不同字段** ⇒ 目标文案的**唯一可靠来源是 `Index.ets` 的两个 `@State` 字符串**
   （`core/statusfmt.ets:104-109` 已注明要绕开）。新设计动 goal 前必须先修这条数据链，否则任何 UI 都是空中楼阁。
4. **`core/*.ets` 不能 import ArkUI**：`core/bubble.ets`、`core/statusfmt.ets` 会被 `tools/tests/run.sh`
   当**纯 TS** 编译 ⇒ 任何新的"判据纯函数"（如 `core/bubbleview.ets`）必须保持无 ArkUI 依赖，只能在
   `components/*.ets` 落地样式。

---

## 4. 新设计系统的需求（语义 token + 状态矩阵）

### 4.1 用户气泡需要的语义 token

| 类别 | 需要的新语义角色 | 现状（file:line） |
|---|---|---|
| 表面层级 | `bubble.userBg`（用户气泡底，**与助手的"无 chrome"形成对比**）；`bubble.userBorder`（可选发丝）；`bubble.elev`（第几档阴影，**必须进 `Effects`，不许组件内写 radius**） | 底散在 `UserBubble.ets:51`+`:52-55` 两处；阴影 `UserBubble.ets:61` 硬编码 radius 12 |
| 文字层级 | `bubble.userText`（**必须与 userBg 配对**，不许再用"实心 accent 上的字" `onAccent`） | `UserBubble.ets:44` 误用 `onAccent` |
| 间距/形状档 | `bubble.padX/padY`、`bubble.radius(四角/右下)`、`bubble.maxWidthPct`、`bubble.rowPadY`（**已在 `core/bubble.ets`，保留**） | ✅ 已有且可测 |
| 字阶/字重 | 气泡正文**字号档 + 字重档**（当前 `15` 字面量、无字重） | `UserBubble.ets:44` |
| 内容面 | `codeBlock.onBubble.bg/fg`（用户消息里的代码块底色 —— 与助手消息的代码块**可能需不同底**，因为气泡底已着色） | **完全缺失**（原生不渲染用户 markdown） |

### 4.2 目标横幅需要的语义 token

| 类别 | 需要的新语义角色 | 现状 |
|---|---|---|
| 表面 | `goal.surface`（口径与 web `bg-bg-primary/92` 对齐，还是全不透，要拍板） | `GoalBanner.ets:211` |
| 描边 | `goal.borderActive` / `goal.borderDone`（**各自一套**，不许再用"浅色 ×0.5"临时系数） | `GoalBanner.ets:46-47,89-92` |
| 文字 | `goal.text` / `goal.textDone`（删除线色） | `GoalBanner.ets:161-164` |
| 徽标 | `goal.badge.bg/fg`（进行中/已完成两态） | `GoalBanner.ets:179-186` |
| 图标 | `goal.iconActive` / `goal.iconDone` + 尺寸档 | `GoalBanner.ets:119-123` |
| 间距/形状 | `goal.padX/padY`、`goal.radius`、`goal.margin` | `GoalBanner.ets:38-40,208-215` |
| 命中区 | `touch.minHit`（触屏 ≥44vp，web `:149` `isTouch` 常显 44px） | **组件未做**（图标 12fp，无命中区扩展） |

### 4.3 完整状态矩阵（新设计必须逐一给出形态）

**用户气泡**（web 权威行号见 §1.4）：
| 状态 | web 依据 | 原生现状 |
|---|---|---|
| 普通单行 | `UserMessage.tsx:233-299` | ✅ |
| 长文多行 | 同上 | ⚠️ `BREAK_ALL` 劈词 |
| 含代码块 | `MarkdownRenderer`（`:283`） | ❌ 纯文本 |
| 含行内码/粗体/链接/列表/表格 | 同上 | ❌ 纯文本 |
| 超长不可断 token（URL/hash） | `wrap-anywhere`（`:257-265`） | ⚠️ 能断但劈词 |
| 含图片 | AuthImage（页面回调） | ❌ 无 |
| 含附件 | composer 的 `AttachItem` 体系 | ❌ 气泡无 |
| `sending` / `queued` | `:286-297` | ❌ 无 |
| 通知消息（`isNotification`） | `:236-238,270-272` | ❌ 无 |
| compaction 折叠占位 | `:212-231` | ❌ 无 |
| 行尾 copy / rewind（触屏常显 + 44px） | `:300-335` | ❌ 无（只有长按菜单 `UserBubble.ets:70-72`） |

**目标横幅**：
| 状态 | web 依据 | 原生现状 |
|---|---|---|
| 无目标 ⇒ 零渲染 | 父级条件挂载 | ✅ `GoalBanner.ets:110` |
| 进行中 | `:66-86` | ✅ |
| 已完成（删除线 + 绿） | `:117-128` | ✅ |
| 就地编辑（桌面 inline / 触屏底部 sheet） | `:91-115` / `:172-219` | ⚠️ 只做了 inline，**触屏 sheet 未做** |
| 长目标单行截断 | `:122` `truncate` | ✅ |
| 触屏（按钮常显、44px 命中） | `:149` | ❌ 命中区小 |

### 4.4 "浅色下不靠发光取胜"的具体做法（建议）

1. **层次靠"面 + 发丝"而非"发光"**：`porcelain` 的画布/卡片同白（`theme.ets:318-319`），
   分层只能靠 `border`(#ECECEE) 发丝 + `effectsOf` 的浅色柔影（`theme.ets:541-547`）。
   用户气泡在浅色下**应被设计成"有色面"还是"白面 + 发丝"**，是新设计的核心决策 ——
   **当前"不透明 accent 渐变"让浅色气泡变成实心蓝块，谈不上"干净/极简"**，且与 web 的
   `bg-accent/15` 透底是两种语言。
2. **文字层级用四阶（`textPrimary/Secondary/Muted/foreground3`）代替亮度**：`goal.textDone` 用
   `textMuted`+删除线、`badge.fg` 用 `success/accent` —— 都是**颜色差异**，不依赖任何 glow。
3. **状态色只做"点/描边/徽标底"，绝不做整块发光**：进行中 = accent 描边 + accent 徽标；
   已完成 = success 描边 + success 徽标（现状 `GoalBanner.ets:89-92,179-186` 已接近，只差 token 化）。
4. **禁止新增在飞动效**：呼吸点这类"循环"归光球独占（铁律）。目标条的"进行中"若要有生命感，
   只能是一次性过渡（走 `components/anim.ets`），不能常驻。

---

## 5. 信息层次建议（用户消息 vs 助手消息 / 目标条不抢主内容）

- **一眼区分用户/助手**（现在最弱的一环）：
  - 用户 **有面**（着色底 + 圆角 + 右对齐 + 右下小圆角"尾巴"）、助手 **无面**（`AssistantMessage` 只有
    `px-1`，见 `core/bubble.ets:24-27` 与 `bubble_style.test.ts:87-91` 的守护）。
  - 建议把这条"有面/无面"的对比**作为设计系统的显式规则**（而不是"用户气泡恰好有底色"），
    并在**浅色**下重新决定"用户面"的强度（透底 tint vs 实心块）。
  - 字重维度当前**完全没用**（`UserBubble.ets:44` 无 `fontWeight`）：可用"用户 medium / 助手 regular"
    或用色阶，作为浅色下的**补充**层次（不靠亮度差）。
- **目标条不抢主内容**：
  - 它是**输入框上方的辅助条**，字号应 ≤ 正文（当前 `FS_CAPTION=12` 方向对）、单行截断、
    配色以"描边 + 徽标"表达状态，**主文本保持 `textPrimary`**，避免整块着色。
  - "可交互性"要靠**可点区域的可见性**表达（编辑=铅笔、清除=×，触屏常显 + 44px），
    而不是靠发光/抖动吸引注意。

---

## 6. 重构归属与风险

- **归属建议**：
  - 纯判据/结构 → `core/`（`core/bubble.ets` 已有；可**新增** `core/bubbleview.ets`，⛔ 禁改
    `core/{theme,orb,brand,toolvisual,toolstatus,listfollow,streammerge,motion}.ets`）。
  - 样式落地 → `components/UserBubble.ets` / `components/GoalBanner.ets`。
  - 新语义 token → `core/theme.ets`（`Palette`/`Effects` 已是"全应用唯一颜色来源"）+
    `core/tokens.ets`（尺度档）。
- **风险清单**：
  1. **`@Reusable` 复用串内容**（历史 P0，`UserBubble.ets:2-10`、提交 `be677da`）—— 加状态前先定复用契约。
  2. **带参 `@Builder` 冻结**（`Index.ets:5144`）—— 响应式内容必须真 `@Component`。
  3. **基类成员名黑名单**（`size/width/height/position/…/on*`）—— `GoalBanner.ets:81-88` 已踩过一次
     （`borderColor` → `bannerBorderColor`），新组件的 `@Prop` 名先查 `docs/ARKTS-GOTCHAS.md`。
  4. **`$r('sys.symbol.*')` 编译期校验** —— 新增符号先查 `id_defined.json`（`GoalBanner.ets:114-117` 血的教训）。
  5. **用户气泡 markdown 化的性能**：`MarkdownView` 在 `LazyForEach` 行内是全量解析（`core/markdown.ets`
     有缓存 `parseMarkdownCached`），需评估长历史下的开销（参考 `docs/RENDER-LOAD-MEASUREMENT.md`）。
  6. **浅色主题门禁**：`porcelain` 的 `textMuted` 取值由 `tools/tests/theme_contrast.test.ts §G` 两条约束锁死
     （`theme.ets:304-314`）—— 新 token 必须过同一矩阵，不能靠放宽阈值。

---

## 7. 本轮收口（delivery discipline）

- 收到用户方向变更后**立即停止外观微调**；此前**未产出任何半成品代码改动** ⇒ 无需回滚。
- 两处组件**均不改一行代码**，只交本文档作为设计输入。
- 未做项及原因：① 用户气泡 markdown 化 —— 属重构，等新设计系统；② 目标条触屏 sheet —— 属重构；
  ③ 换行策略 `BREAK_ALL` 的 web `anywhere` 差异 —— 需新设计拍板后一次性处理（避免二次返工）。

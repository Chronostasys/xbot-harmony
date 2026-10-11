# REDESIGN-INPUT — 签名微时刻（思考行 / 上下文环 / 子代理树 / 待办面板）

> 提交人：`explore` 线（原任务5「签名微时刻精修」）。**方向已变更**：用户原话
> 「目前这些问题不是只调整样式就做好的，我希望你能进行**大的重构重新设计**」「这样才能超过苹果」。
> ⇒ 本文件**不是**样式清单，而是**结构性证据 + 设计系统需求**，供设计负责人 `design-lead` 收敛。
>
> 覆盖面（我负责的文件）：`components/ThinkingLine.ets` · `components/ContextRing.ets` ·
> `components/SubAgentTree.ets` · `components/TodoPanel.ets`。
> 所有 `file:line` 均为本仓当前实际行号（未含我本轮的小改；行号以 `git show HEAD:<file>` 为准时
> 我逐条核过）。

---

## 0. 一句话结论

这四个面**不是"配色/圆角没调好"，而是"缺一层设计系统"**：
① **判据与视觉散在组件里**（同一个状态在组件内被 3 段 if 链各判一次）；
② **数值是组件私有字面量**（圆角/间距/字号/透明度/图标尺寸直接写死，跨组件各写一份、深浅族再各分一次叉）；
③ **受 ArkUI 结构倒逼**（`@Component` 不能递归 ⇒ 树被展平；带参 `@Builder` 会冻结 ⇒ 组件只能吃 @Prop 投递；
`ForEach` 无 diff ⇒ key 必须编进内容）。
⇒ 换任何一套"更好看的数值"都只是在同一副骨架外面刷漆。**要超过苹果，得先把"状态→视觉"抽成一套
唯一真源 + 语义 token，再让组件只做"照着画"。**

---

## 1. 为什么"调样式救不了"——证据（逐条 file:line）

### 1.1 硬编码值（组件私有字面量，跨组件重复、深浅族再分叉）

| 面 | file:line | 写死的值 | web 出处 | 问题 |
|---|---|---|---|---|
| ThinkingLine | `components/ThinkingLine.ets:111` | `padding({ top: 2, bottom: 2 })` | 无（web `py-0.5`=2） | `2` 非 token |
| ThinkingLine | `:113` | `stateStyles.pressed.opacity(0.6)` | 无 | `0.6` 非 token |
| ThinkingLine | `:122` | `.opacity(0.75)` | `ThinkingLine.tsx:72` `opacity-75` | 非 token |
| ThinkingLine | `:127` | `padding({ left: 10, ... })` | `ThinkingLine.tsx:72` `pl-2.5` | `10` 非 token |
| ThinkingLine | `:130` | `border({ width: { left: 2 } })` | `border-l-2` | `2` 非 token |
| ContextRing | `:41` | `CTX_POP_W = 200` | web tooltip 自适应 | 组件私有宽度 |
| ContextRing | `:88` | `pressed.opacity(0.75)` | 无 | 非 token |
| SubAgentTree | `:32-48` | `CARD_PAD_L/R/Y=10/8/6`、`CARD_BORDER_ALPHA=0.5`、`CARD_BG_ALPHA=0.5`、`BAR_W=2`、`BAR_DONE_ALPHA=0.3`、`CHILD_INDENT=12`、`ICON_TOP=14`、`ICON_CHILD=12`、`ROW_GAP=6`、`ICON_GAP=6` | `SubAgentProgressTree.tsx:108-118`（`py-1.5 pl-2.5 pr-2`、`border/50`、`bg-secondary/50`、`w-[2px]`、`accent 30%`、`ml-3 pl-3`、`size-3.5/3`、`gap-1.5`） | **12 个字面量**，逐条对 web class |
| SubAgentTree | `:135` | `padding({ ... top: 2, bottom: 2 })` | — | 非 token |
| SubAgentTree | `:158` | `pressed.opacity(0.75)` | — | 非 token |
| TodoPanel | `:35-48` | `HEADER_H=28`、`BAR_W=48`、`BAR_H=6`、`LIST_MAX_H=240`、`ICON=14`、`GOAL_TINT_DARK=0.07`、`GOAL_TINT_LIGHT=0.14`、`PRESS_OPACITY=0.7` | `TodoPullOut.tsx:88-126`（`h-7 w-12 h-1.5 max-h-[240px]` 等） | **8 个字面量** |
| TodoPanel | `:166-172` | goal 徽标 `fontSize(9)`、`padding({ left:6,right:6,top:1,bottom:1 })`、`withAlpha(accent, 0.18/0.15)` | `TodoPullOut.tsx` goal badge | **字号 9 不在字阶里** + 3 处字面量 |
| TodoPanel | `:197` | `padding({ ... top: 5, bottom: 5 })` | — | `5` 非 token |
| TodoPanel | `:226` | `.width(120)` | — | 组件私有宽度 |

⇒ **同一个"卡片内边距"在 SubAgentTree、TodoPanel 各写一份、深浅族再各分一次叉**。改一处不改另一处，
就是"看起来哪哪都对不齐"的根因。

### 1.2 自造了第二套判据（同一状态在组件内被多次判断）

| 面 | file:line | 重复形态 | 唯一真值点（应在此判断） |
|---|---|---|---|
| SubAgentTree | `barColor()`、`iconRes()`、`iconColor()`（原 `:73-103`） | ~~同一 `kind` 被 3 段独立 if 链各判一次（颜色 / 图标 / 图标色）~~ **✅ 已收敛 `65ebc78`**：改为只消费 `core/statusvisual.ets:subagentVisual(kind)` | `core/statusvisual.ets`（新增，唯一真源） |
| TodoPanel | `iconColor()`、`iconRes()`、字色/字重/删除线（原 `:92-151`） | ~~同一 `kind` 被 5 处分散判断~~ **✅ 已收敛 `65ebc78`**：改为只消费 `core/statusvisual.ets:todoVisual(kind)` | `core/statusvisual.ets`（新增，唯一真源） |
| ThinkingLine | `:97-99`（图标色）与 `:101-103`（文字色） | `live ? accentSoft : textMuted` 表达式**逐字重复两遍** | 无（应抽一个 `leadColor(live)`） |
| ThinkingLine | `:59 live` / `:66 orbMode` / `:68 orbBeat` | 领读身份由调用方 `LiveTailView.thinkingIsPrimary()`/`orbMode()` 算，**与 `core/streammerge` 的在飞判据是两条链** | 唯一真源在页面侧方法（`LiveTailView.ets`），组件只被动接收 |
| ContextRing | `:69-71 arcColor()` | 档位→角色→色 只有**这一处**（好）；但**角色语义**在 `core/ctxring.ets:40-43` 与组件注释之间曾**写出两种角色名**（`dangerText` vs `statusError`）——角色这套"语言"本身没有单一台账 | `core/ctxring.ets` + `core/theme.ets`（角色名应只在一处定义） |

⇒ 这**正是** `tools/lint/criteria-single-source.sh` 规则 B 想抓的形态（同文件 ≥2 段"状态字面量→颜色"）。
现在靠"人肉 + 一段链"躲过，说明**缺一个 `statusVisual(status) → {icon, role, textStyle}` 的唯一真源**。

### 1.3 受制于结构（ArkUI 的硬约束，改样式绕不过）

| 面 | 结构约束 | 证据 |
|---|---|---|
| ThinkingLine | **必须**是真 `@Component + @Prop`（带参全局 `@Builder` 的子树会冻在首帧：字数卡住 / 打字机不动 / 点不开） | 文件头 `components/ThinkingLine.ets:4-11`；落地坑 `docs/ARKTS-GOTCHAS.md §4` |
| ThinkingLine | 组件不能自持状态 ⇒ 一次要接 **10 个 @Prop**（`label/body/open/theme/live/orb/orbMode/orbBeat/paused/reduceMotion/onToggle`） | `:46-75` |
| ContextRing | 被钉在 SDK 的 `Progress(ProgressType.Ring)` 上 —— **没有 `strokeLinecap`**，无法复刻 web 的圆头弧（`ContextRing.tsx:66 strokeLinecap="round"`）；也没有独立轨道节点 | `components/ContextRing.ets:76-80` vs `web/.../ContextRing.tsx:53-75` |
| ContextRing | 挂载与否由**调用方**决定（无数据不挂出，免得出现假 "0%"） | `pages/Index.ets:3113-3121`（`ctxHasUsage` 守卫） |
| SubAgentTree | `@Component.build()` **不能递归** ⇒ 树被 `core/subagent.ets:164-212 flattenSubAgents` **预展平**成一维 `SubAgentRow[]`（带 `depth`），组件只做一维 `ForEach` | `core/subagent.ets:110-212`；`components/SubAgentTree.ets:189-204` |
| SubAgentTree | 层级 = **渲染出来的**（缩进 + 虚线左边框），不是数据结构 ⇒ 无法做真嵌套布局/折叠分组 | `:137`（`margin left=CHILD_INDENT`）、`:141-147`（虚线边框） |
| SubAgentTree | `ForEach` **无 diff** ⇒ key 必须编进内容指纹（`rowKeyOf = id#kind#desc`），于是状态一变就**销毁重建**节点 | `core/subagent.ets:143-154`；`docs/ARKTS-GOTCHAS.md §11` |
| TodoPanel | 编辑态 `editingIndex/draft` 在**父**（@State）、`TextInput` 在**子**（@Prop）⇒ key 必须编进 `editing` 才能切换 | `components/TodoPanel.ets:264-267`、`:357-389` |
| TodoPanel | `⋯` 菜单**只能挂在行内** SymbolGlyph 上（"自定义组件调用链上的 `.bindPopup` 在 ForEach 里不可靠"）⇒ 行内持 @State | `:83-85`、`:182-192` |
| TodoPanel | key 必须含内容（勾选/改名/进编辑都要刷新）⇒ 门禁规则 A 命中（结构性、非误报） | `:385-389`（本轮已收敛到 `core/todos.ets:todoRowKey`） |

---

## 2. 我对新设计系统的需求（语义 token）

> 原则：**判据进 `core/`（纯函数、可脱机单测），数值进 token，组件只"照着画"。**
> 下列命名是**需求描述**，不是最终命名。

### 2.1 一个唯一真源：`statusVisual(status) → StatusVisual`

```
StatusVisual = { icon: Resource, role: 'accent'|'success'|'muted'|'danger', emphasis: 'normal'|'medium', struck: boolean }
```
- 服务 SubAgentTree（`running/done/error/other`）、TodoPanel（`pending/doing/done`）、
  ThinkingLine（`live/committed`）**三处共用**，替掉现在的 8+ 段分散 if 链（§1.2）。
- 角色名（`accent/success/muted/danger/statusError`…）需 **一处定义**（现在是注释里出现两种名字）。

### 2.2 思考行需要的 token

| 需求 | 语义 | 现状（散落处） |
|---|---|---|
| 三级文字层级 | 行标题（weight/色）· 展开正文（weight/色+透明度）· 提示 | ThinkingLine `:99/:103`（标题）、`:121-122`（正文）；靠 3 个内联三元 |
| 领读色 | "这一行在领读"的**唯一**颜色表达（只改色、不动效） | `:99/:103` 两处重复 |
| 结构性左栅栏 | 展开体左栅栏（宽 + 色） | `:130`（`hairline` + 写死 `2`） |
| 折叠行几何 | 内边距（含 top/bottom `2`）、圆角、图标-文字间距、行高 | `:80/:111/:112` |
| 前导图元 | 光球尺寸 + 相位种子（与 `LiveTailView` 冷启动同值） | `:39-42` |

### 2.3 上下文环需要的 token

| 需求 | 语义 | 现状 |
|---|---|---|
| 环几何 | 直径 / 描边宽 / 点击热区 | `:77/:82`（`SP_5/SP_7`）、`core/ctxring.ets:33 CTX_RING_STROKE` |
| 弧语义色 | **正常 = accent / 告警 = statusError**；**阈值 80%** | `core/ctxring.ets:27/40-43/95-97`（判据齐），组件 `:69-71` 映射 |
| 轨道 | 弧占多少的**参照系**（必须可见） | `:78`（`Surfaces.hairline`） |
| 浮层 | 宽度 / 底色 / 圆角 / 等宽文案 | `:41`（私有 200）、`:92-103` |
| ⚠️ 缺口 | web 的**圆头弧**（`strokeLinecap=round`）在 ArkUI `Progress.Ring` 上**无对应** ⇒ 需设计决策：接受方头 / 自绘 Canvas（代价见 `ContextRing.ets:4-12`） | `:76-80` |

### 2.4 子代理树 / 待办面板需要的 token

| 需求 | 语义 | 现状（散落处） |
|---|---|---|
| 卡片几何 | 内边距（x/y）、圆角、描边、状态竖条宽 | SubAgentTree `:32-40`；TodoPanel 无卡片（行式） |
| 结构性边界 | 卡片描边 + 子行虚线连接线（浅色族需 `hairline`） | SubAgentTree `:153-156`、`:145` |
| 层级步进 | 缩进步长（`CHILD_INDENT`）、行间距 | SubAgentTree `:42/:46` |
| 状态竖条色 | running=accent / done=accent@30% / error=statusError | SubAgentTree `:73-82`（**手写 if 链**，进 §2.1） |
| 进度条 | 尺寸 / 轨道 / 填充 / 平滑 | TodoPanel `:36-38`、`:316-321` |
| 徽标 | 字号（**现为 9，不在字阶**）/ 底色透明度 / 内边距 | TodoPanel `:166-172` |
| 菜单 | 宽度 / 行内边距 / 危险项色 | TodoPanel `:206-227` |

---

## 3. 状态矩阵（各面 × 正常/在飞/完成/失败/空）

> 铁律：**同一时刻只有一个"在飞动效" = 光球**（`docs/DESIGN-SYSTEM.md §8`）。下表"在飞"一列
> 一律标注**动效归谁**与**是否允许一次性过渡**。

### ThinkingLine（思考行）
| 态 | 触发 | 呈现 | 动效 |
|---|---|---|---|
| 空 | `reasoning` 为空 | **不渲染**（`LiveTailView.ets:432`） | — |
| committed | 历史迭代 | 图标 + `思考 N 字`（muted，静态）+ 可展开 | 仅展开/收起 一次性过渡（`animFast`/`animBase`） |
| live·领读 | 只有思考、无正文、无工具（`thinkingIsPrimary()`） | 文字转 `accentSoft`（**只改色**） | **无**（动效让给光球） |
| live·光球开 | 设置开 | 光球作**行首前导图元**（取代灯泡） | **光球**（唯一在飞动效） |
| live·光球关 | 设置关 | 回落灯泡图标，行仍静态 | — |

### ContextRing（上下文环）
| 态 | 触发 | 呈现 | 动效 |
|---|---|---|---|
| 无数据 | `!ctxHasUsage` | **不挂载**（web 画空轨道；原生整环不出现） | — |
| 正常 | `pct < 80` | 弧 = `accent` | 弧长 300ms 平滑（`enableSmoothEffect`，**一次性**） |
| 告警 | `pct ≥ 80`（**原始值**判） | 弧 = `statusError` | 同上 |
| 浮层开 | 点击 | 等宽文案浮层 | 一次性弹出 |

### SubAgentTree（子代理树）
| 态 | 触发 | 呈现 | 动效 |
|---|---|---|---|
| 空 | 无 running/pending 根 | **零节点**（web `:57 return null`） | — |
| 根·在飞 | `running/pending`（**`active` 不算根**） | 卡片：2px accent 竖条 + `lightbulb`(accent) + accent 标签 | 原生**无**（web 有 `SweepText` 扫光 ⇒ 本仓按"一个动效"砍掉） |
| 子·完成 | `done/completed` | 竖条 accent@30% + `checkmark`(muted) + muted | — |
| 子·失败 | `error/failed` | 竖条 `statusError` + `xmark_circle_fill`(error) | — |
| 其它 | 未知档 | 竖条 accent + `lightbulb`(muted) | — |

### TodoPanel（待办面板）
| 态 | 触发 | 呈现 | 动效 |
|---|---|---|---|
| 空 | `total === 0` | **整个面板不产出**（web `:56`） | — |
| 收起 | 默认 | 28vp 行：箭头 + 进度条 + `done/total` + 当前任务 | 箭头旋转 一次性（`animFast`）+ 进度 300ms 平滑 |
| 展开 | 点击 | 清单（≤240vp 滚动） | 一次性 |
| 行·pending/doing/done | `status` | `circle`/`circle_dashed`(accent)/`checkmark_circle_fill`(success)；doing 加粗、done 删除线 | — |
| 行·编辑 | 点文本 | 行内 `TextInput` | — |
| 行·菜单 | 点 `⋯` | 编辑/删除浮层 | 一次性 |
| goal 行 | 文本 == goal | 行底 accent 底纹（深 7% / 浅 14%）+ `goal` 徽标 | — |

---

## 4. 重构后的归属建议 + 风险

### 4.1 归属
- **判据（该显示什么）→ `core/`**：
  - `statusVisual` 唯一真源（§2.1）——取代 SubAgentTree 的 3 段、TodoPanel 的 5 段 if 链；
  - 现有 `core/{subagent,todos,ctxring}.ets` 保留"归一/统计"，**新增"档→视觉角色"映射**（角色是纯字符串，
    颜色取值仍留 `core/theme.ets`，判据与渲染保持同源且可脱机单测）。
- **数值 → token**：`core/tokens.ets`（尺度）或新 `core/design.ets`（组件级组合 token，如
  `CARD_PAD`/`RING_SIZE`/`PROGRESS_H`）。**禁止**再在组件里写圆角/间距/字号/透明度字面量（§1.1 全表）。
- **组件 → 只画**：`components/` 下三个组件瘦身成"读 view-model → 赋值"。

### 4.2 拆分/落地的风险
1. **不能把树递归搬进组件**（ArkUI `build()` 不自引用）⇒ 展平必须留在 `core/subagent.ets`；
   重构只能改"展平产物的形状"（把视觉决定也前移到展平里），**不能**改成递归组件。
2. **不能去掉"内容指纹进 key"**（`ForEach` 无 diff）⇒ 重构后仍会有"内容变→节点重建"；
   若新设计要做"行内持久浮层/长按"，**必须**把该状态提到 key 之外（或用 `@ObjectLink` 可观察模型）。
3. **带参 `@Builder` 冻结**的坑仍在 ⇒ 新组件一律"真 `@Component` + `@Prop`（值变化通道）"。
   这条对"新设计里的每一块可变的 UI"都成立（含未来的渐变/呼吸/骨架屏）。
4. **只有一个在飞动效**：新设计若要给思考行/子代理行加任何"在飞"表达，**必须**是
   **一次性过渡**（进入/状态切换，走 `components/anim.ets`）；循环/呼吸一律归光球。
5. **白底（porcelain）是"原生独享、无 web 对应"**：所有"靠灰底分层"的 web 写法在白底会整块消失；
   浅色族必须走**发丝（`Surfaces.hairline`）+ 柔影**。深色族要**逐字节保留**既有观感
   （本轮 §1.1 的深色值即"已批准观感"，重构时请当作回归基线）。
6. **字号缺口**：字阶最小档 `FS_CAPTION=12`，而 web 思考行标题是 **10px**、goal 徽标是 **9px**。
   原生要么扩字阶（加一档 ~10），要么用**字重/色**补层次 —— 这是新设计系统必须先拍板的。

---

## 5. 我本轮已收口的改动（结构/正确性，不含纯外观）

| 文件 | 改动 | 性质 |
|---|---|---|
| `components/ContextRing.ets` | 文件头弧色角色 `dangerText` → **`statusError`**（与代码/`§ContextRing.tsx:70-73` 一致）；去掉静息态 `normal.opacity` 隐患 | 正确性（角色混淆陷阱） |
| `components/SubAgentTree.ets` | 卡片描边 + 子行虚线在**浅色族**改走 `Surfaces.hairline`（深色族逐字节不变）；统一按压纪律 | 结构性（白底可读） |
| `components/TodoPanel.ets` + `core/todos.ets` | 行 `ForEach` key 收敛到唯一真源纯函数 `todoRowKey`（门禁规则 A 命中清零） | 结构性（判据单一性门禁） |

> **已放弃**：`ThinkingLine` 的标题字重调整（纯外观，按新方向不做）。

---

## 6. 本波追加：状态→视觉「唯一真源」收敛（`65ebc78`）

§1.2 的两条（SubAgentTree 3 段 if 链 / TodoPanel 5 处分散判）**已收口**：

- 新增 `core/statusvisual.ets`（纯逻辑、可脱机单测）：
  - `subagentVisual(kind)` / `todoVisual(kind)` → `StatusVisual`
    `{ marker, toneRole, iconRole, labelRole, markerAlpha, emphasis, struck }`；
  - `roleColorOf(role, pal)` = 本族 role→色的**唯一**解析；
  - 角色词汇**复用** `core/toolstatus` 的 `ROLE_*`（不新造）；只补本族缺的 `ROLE_PRIMARY/SECONDARY`；
  - 形态档 `MARK_*`（core 不能持 `Resource` ⇒ "档 → `sys.symbol`"留在组件一处）。
- `components/SubAgentTree.ets` / `components/TodoPanel.ets` **只消费** `StatusVisual`，
  组件里已无"裸 kind if 链"（断言读源码钉死，回退即红）。
- 契约 `tools/tests/statusvisual.test.ts`（64 条）；mutation 自证见提交信息。

### 6.1 仍缺的 token（本波**未**动数值 —— 观感不变优先；请 design-lead 定名定值）

> 这些现在是**组件内具名常量**（非散落字面量）；下表中"已有"指 `core/design.ets` 里**同名语义**的 token
> （⚠️ 值/语义与场景不完全对齐 ⇒ 本波不敢擅自接线，怕改观感）。

| 面 | 现常量（值） | `core/design.ets` 里是否有 | 备注 |
|---|---|---|---|
| SubAgentTree | `CARD_PAD_L=10` / `CARD_PAD_R=8` / `CARD_PAD_Y=6` | 部分：`INSET_CARD_X/Y=12`、`SPACE_XS=8`、`GAP_ROW_Y=6` | **无"卡片内边距"语义 token**；web `py-1.5 pl-2.5 pr-2` |
| SubAgentTree | `CARD_BORDER_ALPHA=0.5` / `CARD_BG_ALPHA=0.5` | ❌ 无 | **缺"卡片描边/底色不透明度"token**（web `border-border/50`、`bg-secondary/50`） |
| SubAgentTree | `BAR_W=2` | ✅ `STROKE_RAIL=2` | 值同；语义是"状态竖条" ⇒ 建议专属 token |
| SubAgentTree | `CHILD_INDENT=12` | ✅ `SPACE_SM=12` | **缺"层级步进"语义 token** |
| SubAgentTree | `ICON_TOP=14` / `ICON_CHILD=12` | 部分：`MARKER_SLOT=14`、`MARKER_GLYPH_DASHED=12` | **缺"树图标尺寸（顶/子两档）"token** |
| SubAgentTree | `ROW_GAP=6` / `ICON_GAP=6` | ✅ `GAP_ROW_Y=6` | 语义是"树的层间距/图标-文字间距" ⇒ 建议专属 |
| SubAgentTree | 子行 `padding top/bottom=2` | ✅ `SPACE_HAIR=2` | |
| 两组件 | `FontWeight.Medium`（doing/标签） | ❌ 无（`WEIGHT_MEDIUM=500` 是数值，非 ArkUI 枚举） | **缺"强调档 → FontWeight"的解析 helper** |
| TodoPanel | `HEADER_H=28` | ❌ 无 | **缺"控件行高"token**（web `h-7`） |
| TodoPanel | `BAR_W=48` / `BAR_H=6` | ❌ 无 | **缺"进度条尺寸"token**（web `h-1.5 w-12`） |
| TodoPanel | `LIST_MAX_H=240` | ❌ 无 | **缺"清单最大高"token**（web `max-h-[240px]`） |
| TodoPanel | `ICON=14` | ✅ `MARKER_SLOT=14` | |
| TodoPanel | `GOAL_TINT_DARK=0.07` / `GOAL_TINT_LIGHT=0.14` | ❌ 无 | **缺"目标底纹"token**（含深浅分叉；web `bg-accent/[0.07]`） |
| TodoPanel | `PRESS_OPACITY=0.7` | ⚠️ **冲突**：`design.PRESS_OPACITY=0.6` | **需裁决**：统一 0.6 还是保留 0.7（改值 = 改观感） |
| TodoPanel | goal 徽标 `fontSize(9)` | ❌ 无（字阶最小 12） | **缺 micro 字号档**（web goal badge） |
| TodoPanel | goal 徽标 `padding 6/6/1/1`、行 `padding top/bottom=5` | 部分：`INSET_PILL_Y=5` | |
| TodoPanel | `⋯` 菜单 `width(120)` | ❌ 无 | **缺"菜单宽度"token** |

### 6.2 待统一（跨族，需 design-lead 拍板）

- **role→色 解析有两份**：`core/toolvisual.statusColorOf`（工具族，`danger→dangerText`）与本波
  `core/statusvisual.roleColorOf`（子代理/待办族，`danger→statusError`）。语义角色同名、取色不同。
  本波**未擅自统一**（会改观感 + `toolvisual` 禁改）。⇒ 建议：建**一张角色台账**，
  两族共用同一个 `roleColorOf(role, pal)`（dossier 见 §2.1）。
- **`markerShape` 词汇有两套**：`core/toolvisual.SHAPE_*`（勾/叉/减/环/spinner）与本波 `MARK_*`
  （bulb/勾/叉/圆/虚圆/圈勾）。是否合并成一套"全局形态词汇"由 design-lead 定。

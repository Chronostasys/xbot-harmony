# REDESIGN-INPUT：Markdown 渲染面（正文）—— 为什么「调样式」救不了 + 新设计系统需求

> 面向 `design-lead`（设计负责人）与重构执行者。
> 作者：explore 线（任务5 · Markdown 渲染面）。
> 用户口令：「**不是只调整样式，要做大的重构重新设计**」「极简、苹果科技感、干净、交互爽」「比 Siri 好看」。
>
> 全部结论带 `file:line`。web 仓库 `/Users/bobli/src/xbot/web` 仍是**权威基准**。
> 性能数字来自可复现 harness（见 §D，脚本 `core/markdown.ets` 脱机真跑）。

---

## 0. 一句话结论

`MarkdownView.ets` 的问题**不是"某几个值不够好看"**，而是三层结构性缺陷叠加：

1. **排版尺度是"逐处硬编码"的凹口值**（15/20/18/16/13/11、6/8/2/3/4/11/84…），没有尺度体系 ⇒ 任何"精修"都是往凹口里再打补丁；
2. **同一份"颜色/明暗"判据被复制成 3+ 份**（全局色板轴 × Markdown 主题轴 两条独立明暗轴交叉），组件被迫层层分叉；
3. **渲染管线是"一次性全量构建 + 每 render 全量重算"**（96KB 文档 = 1152 块同帧构建；流式期间实测 **0 命中 / 22 次全量重解析**；行内样式**每 build 全量重算、不进缓存**）。

⇒ 在这三条之上做 CSS 级微调，**边际收益趋零**。需要的是：**尺度 token 化 + 单轴配色 + 单一"状态→视图模型"管线**。

---

## A. 为什么「调样式救不了」——逐条证据

### A1. 硬编码排版值清单（全部在 `entry/src/main/ets/components/MarkdownView.ets`）

| 类别 | 值（字面量） | 位置 | 问题 |
|---|---|---|---|
| 行内默认字号 | `size = 15` | `:72`（`MdInlineStyle` 默认） | 与 `fontScale` 相乘的**基数**散落 |
| 行内码字号 | `st.size = 13` | `:108` | 硬凹；web 是 `0.85em`**相对**正文（`MarkdownRenderer.tsx:192`）⇒ 本端改了正文字号行内码不跟 |
| 行内码"内边距" | `` st.text = ` ${sp.text} ` `` | `:106` | **用空格字符冒充 padding**（web 是 `px-1.5`=6px，`:192`）—— 不是可调样式 |
| 标题阶梯 | `20 / 18 / 16 / 15` | `:462-473` | 硬编码；web 用 `1.4/1.25/1.1/1em` **相对**正文（`index.css:544-547`） |
| 标题外边距 | `top: level<=2 ? 8 : 4, bottom: 2` | `:183` | 硬编码；web `margin: 1em 0 0.5em`（`:541`）换算应为 15/7.5，此处 8/4/2 是拍出来的 |
| **行高** | **无**（全文没有一处 `.lineHeight()`） | 全文件 | web 正文是 `leading-relaxed` = **1.625**（`MarkdownRenderer.tsx:648`），标题 `line-height:1.3`（`index.css:540`）⇒ 本端行高交给 ArkUI 默认，**排版"呼吸"完全不可控** |
| 列表项间距/缩进 | `space:3` / `space:6` / `margin top:2` / `indent = level*12` | `:217,219,223,228` | 4 个硬编码；web 是 `li{margin:.2em 0}` + `padding-left:1.5em`（`index.css:549,556`） |
| 代码块字号/内边距 | `fontSize(13)` / `padding(SP_3)` | `:348,357` | 13 硬编码；web `text-[13px]`+`p-3`（`MarkdownRenderer.tsx:223`） |
| 代码语言条 | `fontSize(11)` + `padding SP_3/SP_3/SP_2/SP_1` | `:319,339` | 硬编码 |
| 表格字号/单元格 | `13` / `padding(6)` | `:392,409,396,412` | 硬编码；web `padding:.35em .6em`（`index.css:579`） |
| 堆叠表格 | 标题 `11`、label `12`/`minWidth 84`、value `13`、`padding 8/8/6/6` | `:425,436,438,441,450` | 硬编码（**原生自创形态**，web 无对应） |
| 分隔线外边距 | `SP_2 / SP_2` | `:194` | 硬编码（web `1em`，`:583`） |
| 引用块内边距 | `left:11, right:SP_3, top:SP_1, bottom:SP_1` | `:209` | `11` 硬编码（web `0 0.75em`=12，`:566`） |
| 根块间距 | `Column({ space: 6 })` | `:160` | 唯一"全局正文节奏"值，硬编码 |

**圆角**：`R_SM`（引用 `:214`、行内码 `:264`）、`R_MD`（代码 `:341,368`）、`R_LG`（表格 `:401,457`）—— 已 token 化，但**同一"代码/参数块"族用了 R_MD、表格用了 R_LG，缺少层级依据**（仅靠注释说明）。

### A2. 重复实现 / 重复判据（"两条明暗轴"是根因）

| 判据 | 位置 | 说明 |
|---|---|---|
| 全局轴 `isLightPalette(pal)` | `core/theme.ets:396` | 按 `appBg` 亮度 |
| Markdown 主题轴 `isLightMdTheme(mdTheme)` | `core/mdtheme.ets:117` | 按 `MARKDOWN_THEMES.mode` |
| **两轴交叉分叉** | `MarkdownView.ets:295-297`（`codeChromeOnTone`） | 语言条/复制键要判 `isLightPalette !== isLightMdTheme` |
| 行内码前景的**第二份判据** | `:56-61`（`inlineCodeFg`） | `contrastRatio(accentText, inlineBg) >= 4.5` 才用 accentText，否则回落 `tone.fg` |
| 语言条底色/动作色**第三、第四份分叉** | `:300-302`（`codeStripBg`）、`:308-310`（`codeStripAction`） | 各自再判明暗 + 取 md 主题色 |
| 代码底/字来自**另一套主题** | `:367,349`（`codeBgOf/codeFgOf`） | 代码块配色**不跟随全局色板**，来自 23 套 md 主题（`core/mdtheme.ets:88-114`） |
| 引用块底色用"玻璃 token" | `:211`（`eff().glassBg`） | 语义错位：玻璃底是"浮层面板"，被当**内容面**用 |
| 表格表头底 | `:400`（`pal.surfaceAlt`） | **已登记**背离 web（web 用 `surface`，`index.css:582` 会与本端卡片底撞色）——见 `WEB-ALIGNMENT.md §15` |

> 结论：**一个"行内码是什么颜色"要跨 2 条明暗轴 + 1 次对比度兜底**；一个"代码块长什么样"要 4 处分叉。任何全局配色改动都要同步这 4-5 处 —— 这就是"调一个样式牵动全身"的成因。

### A3. 未接线的能力（重复劳动 / 功能缺口）

| 能力 | 现状 | 证据 |
|---|---|---|
| **语法高亮** | `core/highlight.ets`（Prism4j）**已存在**，`ToolPopover.ets:243` 在**真用**；但 `MarkdownView` 代码块**完全没接**，只渲染纯等宽文本 | `MarkdownView.ets:345-362` vs `ToolPopover.ets:243` |
| **链接可点性** | 链接仅渲染为**带下划线 + accentSoft 的 `Span`**，**没有 onClick** ⇒ **链接根本点不开**（全文件唯一 `onClick` 是复制键 `:327`） | `:113-116`（link 分支）；`Index.ets:4543`（`openUrl`）已有能力但无回调入口 |
| **表格横向滚动** | web `table{display:block;overflow-x:auto}`（`index.css:574-575`）；本端网格用 `layoutWeight(1)` 等分（`:395,411`）⇒ **无法横向滚动**，只能压缩列 | `:395,411` |
| **代码块不换行 = 裁剪丢数据** | `wrapCode=false` 时 `WordBreak.NORMAL + maxLines(1000) + TextOverflow.Clip`（`:346,361-362`）⇒ **超长行被静默裁掉**，而非 web 的横向滚动（`MarkdownRenderer.tsx:226` `overflow-x-auto whitespace-pre`） | `:346,361-362` |
| 图片 src 扫描 | `imagesIn()` 对每个段落**再**调一次 `parseInlineCached`（`:27`）做第二遍扫描 | `:27` |

### A4. 结构性瓶颈（容器/布局层面，改样式无法触及）

1. **一次性全量构建**：根是 `Column({space:6}){ ForEach(parseMarkdownCached(text)) }`（`:160-165`）——**没有虚拟化**。96KB 文档 = **1152 个块同帧构建**（实测）。超长代码块更极端：8000 行 = **单个 `Text()` 承载 583KB**（实测 §D）。
2. **每 render 全量重解析**：解析缓存以**整段源串**为 key（`core/markdown.ets:370-403`）。流式期间 `text` 是**逐拍增长的前缀**（`LiveTailView.ets:304-309` 的 `clipRunes`）⇒ **每个前缀都是新 key ⇒ 全 miss**（实测 0 命中/22 次）。
3. **行内样式每 build 重算且不缓存**：`inlineStyles()`（`:96`）在 `@Builder Inline`（`:254`）里于 **build 期**调用，每次 `new MdInlineStyle[]` + `codeTone()`（`:99`）—— **不进任何缓存**。96KB 文档单次 build = **960 次** `parseInline` 调用 + 960 组对象分配（实测）。web 侧用 `React.memo` + `useMemo` 严格避免这种重算（`MarkdownRenderer.tsx:8-13,165-170`）。
4. **两条明暗轴不可收敛**：只要"代码块配色"来自 md 主题、而"页面/文字"来自全局色板，就**永远需要交叉分叉**（A2）——这是**架构级**而非样式级问题。

---

## B. 新设计系统需要哪些语义 token

> 原则（沿用 `DESIGN-SYSTEM.md §9`）：**新角色一律进"派生结构"（如 `Surfaces`），不进 `Palette` 字段**（`withAccent` 逐字段复制会让换色后出现空字段）。颜色一律 **token，禁字面量**。

### B1. 排版尺度（typography scale）——目前完全缺失，必须先建

| token 组 | 需要的条目 | 用途（元素） |
|---|---|---|
| `FS_*` 正文族 | `mdBody` / `mdBodyLeading`（**行高**，建议 1.5–1.625） | 段落、列表项 |
| `FS_*` 标题族 | `mdH1..mdH4`（**相对正文的比例**，非绝对凹口） + `mdHeadingLeading`（1.3） | 标题 |
| 代码族 | `mdCode.size`（rel 0.85em 或绝对 13）、`mdCode.leading`、`mdInlineCode.size` | 代码块 / 行内码 |
| 表格族 | `mdTable.size` / `mdTable.cellPadX/Y` | 表格 |
| 节奏 | `mdBlockGap`（块间距，现 `:160` 的 6）、`mdHeadingMarginTop/Bottom`、`mdParagraphGap`、`mdListIndentStep`、`mdListItemGap`、`mdSectionGap`（分隔线上下） | 全部块级 |

### B2. 表面层级（surface ladder）——浅色主题"层次不靠发光"的关键

现结构只有 `appBg / surface / surfaceAlt / surfaceHi`（`theme.ets:32-39`）+ 派生 `sunken / glassBase`（`:674-683`）。Markdown 需要**明确的"内容面"角色**：

| 需要的角色 | 语义 | 落点 |
|---|---|---|
| `mdCodeSurface` | 代码块底（**必须来自与页面同一轴**，或显式派生；不再来自 md 主题） | 代码块 `:367` |
| `mdCodeBorder` | 代码块描边 | `:369` |
| `mdCodeStrip`（语言条） | 语言条底/分隔 | `:340,343` |
| `mdInlineCodeSurface` | 行内码胶囊底 | `:112` |
| `mdQuoteSurface` + `mdQuoteRail` | 引用块底 + 左侧 3px 竖条（**不是 glass**） | `:211,215` |
| `mdTableHeaderSurface` + `mdTableBorder` | 表头底 + 单元格线 | `:400,416,451,456` |
| `mdHairline` | 分隔线/分段发丝（已有 `Surfaces.hairline`，`:190` 已用 ✓） | `:190` |

**浅色层次的策略（用户白底专项）**：层级只能用**两把尺子**——① 表面亮度阶梯（canvas → card → content/sunken，方向固定）② `hairline` 结构性发丝（`HAIRLINE_TARGET_RATIO=1.3201`，`theme.ets:693`）。
⛔ **不许用发光/彩色光晕**（`DESIGN-SYSTEM.md §7.2`：45% 饱和色晕压白底=脏）。白色主题上代码块/引用块"糊成一团"的根因就是当前**没有 `mdCodeSurface` 这类角色**，只能借用 glass（`:211`）或 md 主题底（`:367`）⇒ 白底时二者都失效（`theme.ets:469` 已记录 `glassBg` 白底对比度 1.0000）。

### B3. 文字色角色（text roles）

| 元素 | 需要的角色 | 现状 |
|---|---|---|
| 正文 | `mdText`（= `textPrimary`） | `:236` ✓ |
| 标题 | `mdHeading`（= `textPrimary`） | `:178` ✓ |
| 引用 | `mdQuoteText`（= `textSecondary`） | `:203` ✓（已对齐 web） |
| 行内码 | `mdInlineCodeText`（**单一定义**，取消 `inlineCodeFg` 兜底） | `:56-61` ⚠️ 两份判据 |
| 链接 | `mdLink` + **`mdLinkPressed`（按压反馈色！）** | `:115`（**无按压色**） |
| 代码 | `mdCodeText`（**单一定义**，取消 md 主题轴） | `:349` ⚠️ |
| 语言标签/次要 | `mdLangText`（= `textMuted`） | `:322` ✓ |
| 表格 label | `mdTableLabel`（= `textSecondary`） | `:437` ✓ |

### B4. 交互 token（链接"一击即中"）

`MarkdownView` 当前**没有任何点击反馈基建**。新系统需要：
- 链接 **`onLink(href)` 回调接口**（页面已有 `Index.ets:4543 openUrl` + `core/msgops.ets:102 resolveOpenable` 可复用）；
- 链接 **pressed 态颜色/下划线 token**（web 用 `:active` 过渡，`index.css` 链接态）；
- 统一**最小点击热区**（链接 Span 在 `Text` 内，热区即字形本身，小字号下难命中 —— 需评估 `Text`+`Span` 的可点区间方案）。

---

## C. 建议的重构方向（"单一状态 → 视图管线"）

### C1. 管线位置

```
core/store(状态) ──▶ core/mdview.ets（纯函数：MdBlock[] ─▶ MdBlockVM[]）──▶ MarkdownView（哑渲染器）
                          ▲ 判据唯一出口（可脱机单测）                        ▲ 只做属性赋值
```

- **`core/mdview.ets`（新增，纯 TS）**：输入 `MdBlock[]` + `Palette` + `mdTheme` + `fontScale`，输出**视图模型** `MdBlockVM`（每块：`fontSize/lineHeight/margins/radius/surfaceRole/borderRole/overflowPolicy/markerText/…`），并**同时**输出行内样式数组。
  - 好处：① "判据与渲染同源"（本仓铁律）——字号/行高/配色只有**一处**；② 可脱机测试（`run.sh` 把 `core/**` 当纯 TS 编译）；③ 组件变成纯渲染，`@Builder` 冻结/基类成员名等 ArkTS 坑被隔离在薄渲染层。
  - ⛔ 铁律：`core/*.ets` **禁止 import ArkUI/`@ohos.*`**（`AGENTS.md`），本文件必须零依赖。
- **配色收敛为单轴**：新增派生 `MdSurfaces`（同 `Surfaces` 纪律）：由 `paletteOf(theme)` 派生 `mdCodeSurface/mdQuoteSurface/mdTableHeader…`；**md 主题只作为"用户显式选择的代码高亮"覆盖项**（保留 23 套主题的可见差异），未选则完全跟随色板 ⇒ 取消 `codeChromeOnTone`/`codeStripBg`/`inlineCodeFg` 三处交叉分叉。
- **高亮走既有引擎**：代码块交给 `core/highlight.ets`（Prism4j），与 `ToolPopover` 共用**同一个**高亮器 ⇒ 全 App"代码"只有一种长相。

### C2. 溢出策略（统一为一个策略对象，而非各自 `wordBreak`）

| 块 | 建议策略 | 修掉 |
|---|---|---|
| 正文/标题/列表/引用 | 词内折行（`BREAK_ALL`，保持） | — |
| 代码块·换行模式 | 折行（保持） | — |
| 代码块·不换行模式 | **`Scroll(Axis.Horizontal)`**（在气泡宽度内横滑） | 现"静默裁剪丢数据" `:361-362` |
| 表格 ≤N 列 | 等分网格（保持） | — |
| 表格 >N 列 / 宽表 | **横向 `Scroll`**（替代"堆叠换形态"）或保留堆叠但**加横滑** | 现"无法横滑只能压列" `:395,411` |

⚠️ 横向 `Scroll` 嵌在纵向 `List` 内的**手势冲突**需真机验证（见 §E 风险）。

### C3. 性能（可测目标）

| 指标 | 现状（实测 §D） | 目标 |
|---|---|---|
| 流式期块解析缓存命中率 | **0 / 22（全 miss）** | 复用前缀解析结果（前缀文档 ≈ 完整文档）或 web 式"打字机追平才重解析"（`MarkdownRenderer.tsx:538-584`） |
| 行内样式重算 | **每 build 960 次、无缓存** | 进 `core/mdview.ets` 的缓存（key = 文本） |
| 单条超长代码块 | 583KB 单 `Text()` | 代码块内**行级/窗口化**或交给横向 Scroll + 分块 |
| 长文档块数 | 1152 块同帧 | 块窗口化 / `LazyForEach` |
| 单次整篇 parseMarkdown | **≈15–19 ms**（Mac；真机更慢） | 消除"每次前缀全量重解析" |

内置计数器已就绪：`core/markdown.ets:427 mdCacheStats()`（hits/misses/chars/entries）——可作为门禁断言"流式期命中率"。

---

## D. 性能实测证据（可复现）

**方法**：把 `core/markdown.ets` 当纯 TS 编译，忠实复刻 `LiveTailView` 的打字机时序（`advanceVisible` + `renderEvery = ceil(len/300)`），对 96KB 混合文档跑完整流式过程。
**脚本**：`/tmp/mdmeasure/{measure.ts,markdown.ts}`（临时，不提交）。

| 指标 | 实测值 |
|---|---|
| 文档长度 | 98,807 字符 |
| 流式期渲染次数（前缀增长） | **22** |
| 块解析缓存 **hits / misses** | **0 / 22**（每次都是全量重解析） |
| 缓存残留 chars / entries | **335,097 / 22**（**每个前缀一条，永不复用**，纯内存churn） |
| 喂入解析器的字符总量 | **335,097** ≈ 文档长度 × 3.4（前缀求和 ⇒ 近二次增长） |
| 单次整篇块数 | **1,152**（同帧构建） |
| 单次整篇 build 的 `parseInline` 调用 | **960 次**（`inlineStyles` 每 build 全量重算） |
| 单次整篇 `parseMarkdown` 耗时 | **15–19 ms**（本机；真机更慢） |
| 场景 B：8000 行单代码块 | 源码 582,901 字符 ⇒ **580KB 进单个 `Text()`**、无高亮 |

> 说明：22 次是"源已收全后打字机追赶"的乐观档；**真实 SSE 断续到达**时，每次"追平"都触发一次新前缀解析，次数更多。**唯一确定的结论**：缓存命中率为 0，且行内样式每 build 重算 —— 两者都**与"是否切主题/是否好看"无关**，是纯结构开销。

---

## E. 风险（重构前必须知道）

1. **容器换型 = 高回归风险**：`Column`(全量) → `List/LazyForEach`(窗口化) 会改动滚动与"跟随到底部"链路（`core/listfollow.ets`、`MessageRow` 的 scroll 逻辑、`Index.ets` 的自动滚底）。**建议**：先做 `core/mdview.ets` 抽离（零 UI 结构变化，纯收益），虚拟化作为独立第二波。
2. **横向 `Scroll` 手势冲突**：代码块/表格横向滚动嵌在纵向 `List` 内，触屏滑动方向仲裁可能"抢手势"；必须先真机验证再全量铺开。
3. **md 主题不可删**：23 套主题是**用户可见功能**（`web:ui:md-theme` 与 web 共享，`core/mdtheme.ets`）。重构只能把 md 主题**降级为"代码高亮覆盖项"**，不能移除；且需保留"未选主题时跟随色板"的默认分支。
4. **`@Builder` 冻结坑**：视图模型里"会变的内容"必须经**真 `@Component` + `@Prop`**（`AGENTS.md` GOTCHA #1）；`@Builder` 只用于静态片段。
5. **基类成员名黑名单**：渲染层新增组件成员不得用 `size/width/height/position/offset/scale/opacity/visibility/clip/zIndex/id/key/on*`（`ARKTS-GOTCHAS`）。
6. **门禁真实性**：组件不进离线 harness（`run.sh` 只编 `core/**`）；`core/mdview.ets` 是纯 TS ⇒ **可以**被 `run.sh` 单测覆盖 —— 这也是把它做成纯函数的核心动机（判据可测、渲染层靠 `bash tools/gate.sh` 真编译把关）。
7. **浅色层次不许发光**：见 `DESIGN-SYSTEM.md §7.2/§9`；白底只能靠亮度阶梯 + `hairline`，任何"彩色光晕"都要打回。

---

## F. 交接清单（给重构执行者）

- [ ] 建 `core/mdview.ets`（纯 TS）：`MdBlock[] + Palette + mdTheme + fontScale → MdBlockVM[]`，含行内样式与溢出策略；**禁止 import ArkUI**。
- [ ] 建派生 `MdSurfaces`（或并入 `core/mdview.ets`）：由色板派生 `mdCodeSurface/mdQuoteSurface/mdTableHeader/hairline…`；md 主题降级为代码高亮覆盖。
- [ ] `MarkdownView.ets` 改为**哑渲染器**：只消费 `MdBlockVM`；删掉 `inlineCodeFg/codeChromeOnTone/codeStripBg/codeStripAction` 四处分叉。
- [ ] 接入 `core/highlight.ets`（Prism4j）到代码块；接入链接 `onLink` 回调（复用 `Index.ets:4543`）。
- [ ] 溢出：代码"不换行"与宽表改横向 `Scroll`（真机验证手势）。
- [ ] 性能：行内样式缓存 + 前缀解析复用/打字机门控；`mdCacheStats()` 加命中率门禁。
- [ ] 补充 token 到 `core/tokens.ets`（排版尺度组，标注 web `file:line` 依据）。
- [ ] 契约测试：`tools/tests/*.test.ts` 钉住 `core/mdview.ets` 的每个尺度值（回退即红）+ mutation 自证。

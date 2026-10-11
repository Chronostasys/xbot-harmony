# 重设计输入 · 消息导航器（MessageNav）

> 提交给设计负责人 `design-lead`（用户 2026-10-11 指令：「不是只调整样式，要做**大的重构重新设计**」）。
> 本文件是**输入台账**，不是设计稿。**纯样式精修已停**（本轮只收口已绿的改动）。
> 归属：`components/MessageNav.ets`（本仓「用户消息导航」）。web 权威基准
> `web/src/components/agent/MessageUserNav.tsx`。

## 0. 一句话

MessageNav 现在是「右上角一枚 32px 悬浮按钮 + 一个 popup 列表」的**局部样式单元**，
但用户的诉求（极简 / 苹果科技感 / 交互爽 / 性能非常好）在**现有结构下已到天花板**：
它的输入是每帧逐值深拷贝的大数组（`@Prop`），它的浮层是 ArkUI `bindPopup`（样式自由度低、
无法参与设计系统），它的"位置感"只有一个淡底纹。**要突破需要动结构，不是调数值。**

---

## 1. 结构性缺陷台账（file:line）

### A. 输入通道：每帧 `O(n)` 深拷贝（性能天花板）
- `components/MessageNav.ets:182` `@Prop @Watch('syncRows') anchors: NavAnchor[] = []`
- 页面 `pages/Index.ets:3099` 每次 build 都 `anchors: this.navAnchors()`（**新建数组**，
  `Index.ets:2145` = `buildAnchors(rows, userAnchorRows(rows))`）。
- ⇒ `@Prop` 对数组是**按值深拷贝**：页面每重建一次（流式期可达 ≤20Hz），组件就收到一份新数组
  ⇒ `@Watch` 触发 ⇒ 组件必须**逐位比较**才能判断"其实没变"（`sameStructure()`，
  `MessageNav.ets:249-262`，O(n)）。
- **为什么本波只能缓解**：没有"版本号/rev"可依赖 ⇒ 快路径仍要做 O(n) 比较
  （本波把"重建数组 + `ForEach` 全量重跑"这一块 O(n) 分配省掉了，微基准 n=800 锚点 0.49ms→0.026ms，
  但**输入侧的深拷贝 O(n) 是页面 `@Prop` 语义，组件侧改不掉**）。
- **需要的新机制（非 token）**：页面传**稳定引用**（`@ObjectLink`/`@State` 承载 + 就地改）或传
  `navRev: number`（内容指纹）⇒ 组件 O(1) 判"变没变"。**这是导航器能否"性能非常好"的关键**。

### B. 浮层 = `bindPopup`（设计系统无法介入）
- `components/MessageNav.ets:339-350` `bindPopup(this.open, { builder, placement, popupColor, radius, ... })`。
- 问题：popup 的**底/边/影/圆角**由 ArkUI popup 系统绘制，**不读 `pal()/eff()` 的层级 token**
  （只有 `popupColor` 一个色值口子，`:344`；`radius`，`:345`）。设计系统的 `Surfaces.hairline` /
  `Effects.elev*` **接不进来**。
- 浅色（尤其 `porcelain`，`surface`=`#FFFFFF` = 页面 `#FFFFFF`，`theme.ets:318-319`）下，
  面板与页面**仅靠系统阴影**分离 ⇒ "干净"能靠运气，不能靠设计。
- **需要的新机制**：要么改用**自绘浮层**（`Stack` + 定位 + `Surfaces/Effects` 可介入），
  要么给 popup 补一条**主题感知的发丝/柔影**。见 §2 的新 token 需求。

### C. 按钮 = 半透明底 + `backdropBlur(18)`（浅色"脏" + 每帧模糊成本）
- `components/MessageNav.ets:317-320`：底 = `surface@0.8`，`.backdropBlur(this.eff().glassBlur)`（=18）。
- 深色下 OK（上一波像素取证过）；**浅色下**：`surface@0.8` 白 + 18 模糊 = 内容滚过时一块雾状白斑；
  且 `backdropBlur` 是**逐帧模糊**（无 `colorMode` 锁定，`DESIGN-SYSTEM §2.6` 的"玻璃锁深色"纪律**未适用**于此）。
- **需要的新 token/机制**：给"悬浮小控件"一个**主题感知的实体 chip 底**（浅色=实心白/中性 + 发丝，
  深色=半透明+模糊），而不是全局共用一条 `backdropBlur`。

### D. 静息存在感 = `opacity 0.4`（浅色下对比不足）
- `components/MessageNav.ets:50` `BTN_IDLE_ALPHA = 0.4`（对齐 web `opacity-40`，`:321`）。
- 浅色：图标 `textSecondary #475569` 再 ×0.4 合成到 `#F8FAFC` 上 ⇒ 对比约 **1.9:1**（远低于 4.5）。
  web 的 `opacity-40` 是为 hover 语言设计；**触屏无 hover** ⇒ "很淡"在触屏上读作"找不到入口"。
- **需要的新 token**：静息态在触屏上的**最低可见度**（或一个"静息 = 中性实心 chip"的形态），
  与 web 的 hover 语义**解耦**。

### E. 位置感弱（用户可见）
- `components/MessageNav.ets:159` 当前项高亮仅 `bg-accent/10`；浅色主题下 accent@10% 压在纯白上**很淡**。
- 本波加了"当前条目序号走 accent"（`:129-130`）作**最小**位置指示；但**没有** "3 / 12" 这类
  **绝对位置**文本，也没有"上一个/下一个"（web 亦无 —— 不自己造形态）。
- **需要设计决策**：导航器要不要**绝对位置**（第 N 条 / 共 M 条）？这决定它是否从
  "跳转列表"升级为"阅读进度器"。

### F. 面板滚动是"尽力而为"
- `components/MessageNav.ets:380-386` `onAppear` 里 `scrollToIndex(activeSeq-1, CENTER)` ——
  浮层刚创建时条目**尚未完成布局** ⇒ 真机可能滚不到位（代码注释已自认）。
- **需要的新机制**：`onDidBuild`/下一帧回调，或 `List` 的 `onScrollIndex` 兜底。

### G. 触摸目标（本波已缓解）
- 按钮视觉 32×32（`MessageNav.ets:37`），本波用**真实 44 布局盒**包住（⛔ **不再用 `responseRegion` 外扩** —— 2026-10-11 真机实测其负偏移外扩**无效**），
  **布局/视觉尺寸未变**。⚠️ 既有的 `HIT_PAD` 外扩常量口径**已废止**（判据须改钉"自身布局盒 ≥ `HIT_TARGET_MIN`"，见 `docs/UI-AUDIT-CHECKLIST.md` §热区）。

---

## 2. 对**新 token / 机制**的需求（给 design-lead + tokens 负责人）

| # | 需求 | 现状 | 建议落点 |
|---|---|---|---|
| T1 | **最小触摸目标** token（`TOUCH_MIN = 44`） | 硬编码 `HIT_PAD=6`（`MessageNav.ets:42`） | `core/tokens.ets` |
| T2 | **触屏静息可见度** token（图标/文本的最低存在感，替代直接借 web `opacity-40`） | 硬编码 `BTN_IDLE_ALPHA=0.4`（`:50`） | `core/tokens.ets` + 设计系统 §2 |
| T3 | **主题感知的发丝** 供**浮层/弹层**用（`Surfaces.hairline` 已存在，但 `bindPopup` 不读） | 浮层无发丝（`:339-350`） | 需自绘浮层或给 popup 补口子 |
| T4 | **悬浮 chip 底** 的主题分叉（浅=实体+发丝 / 深=半透明+模糊），替代共用 `backdropBlur(18)` | `:317-320` | `core/theme.ets`（Effects/Surfaces） |
| T5 | **按压反馈** 的统一刻度（§4 只说了 `opacity+scale`，**无 scale 数值 token**） | 各文件各写 0.9~0.985（`Index.ets` 多处） | `core/tokens.ets` |
| T6 | **导航"位置指示"** 的形态规格（点/序号/进度条？绝对位置要不要？） | 仅 `bg-accent/10` + 序号变色 | 设计系统新增一节 |
| T7 | **输入通道 rev/fingerprint** 机制（让组件 O(1) 判"变没变"，不靠 `@Prop` 深拷贝 + O(n) 比较） | 见 §1.A —— **最大性能瓶颈** | 页面↔组件契约（非 token，属架构） |

---

## 3. 本轮已收口（不阻塞重设计）

- `26f56dd` feat(nav)：MessageNav 精修（44×44 命中区 / 去 `normal` / 序号 accent 位置指示 /
  `syncRows` 快路径）。**key 仍恒为 `rowIndex#seq`（不含 active），高亮仍走 `@Observed+@ObjectLink`**。
- `39e0a78` feat(nav)：新增 `tools/tests/msgnav_polish.test.ts` 结构契约（防这两条前提被弄回去）。
- `8ef3e86` test(minimal-chrome)：工具 pill 底分层改**行为断言**（下沉 `core/toolvisual` 后的假红修复）。

## 4. 明确**不做**（等重设计）

- ❌ 继续调 MessageNav 的圆角/阴影/不透明度数值（用户要的是**重设计**，不是调参）。
- ❌ 改 `pages/Index.ets`（导航器的输入通道，属别的线）—— 只在 §1.A 记需求。

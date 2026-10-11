# REDESIGN-STRUCTURE.md —— 骨架重构方案（strangler，分阶段、可回滚）

> **配套**：`docs/REDESIGN.md`（设计语言宪法）、`core/design.ets`（语义令牌层）、
> `tools/tests/design.test.ts`（123 断言 + mutation 自证）。
> **环境实况**（2026-10-11 实测）：`pages/Index.ets` = **6419 行**、**24 个 `@Builder`**；
> `components/` 20 个 `.ets`；`components+pages` 里 `borderRadius(<数字>)` **70 处**、
> `this.pal()` 调用点 **≤1250**（`tools/perf/guard.sh --static` 的上限）。
> **纪律**：⛔ 不改服务端；⛔ 配置/权限面只给 patch；⛔ 不在设备上 force-stop/重装；
> 每阶段**门禁必绿**（`bash tools/gate.sh`）+ **可回滚**（每阶段 = 一个/一组可 `git revert` 的提交）。

---

## 0. 为什么是"骨架"问题（不是样式问题）

现状的三种"结构性反模式"（各自的 file:line 台账见 `docs/REDESIGN-INPUT-*.md`）：

| 反模式 | 症状 | 结构根因 |
|---|---|---|
| **A. 视觉与判据混杂** | 一个"长什么样"要引用 5 个本地 const + 10 次 `display()`；判据与渲染分居两处 | 组件既判又画（`GoalBanner.ets`、`ToolVisual.ets`） |
| **B. 行内表达式拼视觉** | 6419 行的大文件里到处 `padding({left:6,right:6,...})`、`fontSize(10)` | 无 token 层 ⇒ 只能就地写数字（§2 的 70 处圆角字面量） |
| **C. `@Builder` 当组件用** | 会变内容卡在首帧（`ChatRowBody(row)` 冻结）| 带参全局 `@Builder` 的参数是"调用那一刻的快照"（`ARKTS-GOTCHAS §4`） |

**strangler 策略**：不重写，而是**在旧结构上逐块替换**，每块替换后旧块删除、门禁绿。

---

## 1. 目标拓扑（拆完后）

```
entry/src/main/ets/
├── core/                        # 纯逻辑（可脱机单测；⛔ 禁 import ArkUI/@ohos.*）
│   ├── design.ets               ← 【P0 已交付】语义令牌层（尺度/层级/材质/动效/对比度）
│   ├── toolstatus.ets           # 工具状态唯一判据（已有，勿动）
│   ├── toolvisual.ets           # 工具状态→渲染 token（已有；P2 扩为完整解析）
│   ├── bubble.ets / statusfmt.ets / msgindex.ets / ctxring.ets / todos.ets   # 判据（已有）
│   └── mdview.ets               ← 【P2 新增】Markdown 视图模型（MdBlock[] → MdBlockVM[]）
├── components/                  # 只画：读 VM + token，零字面量、零判据
│   ├── chat/
│   │   ├── ChatList.ets         ← 【P3 从 Index.ChatView 拆出】
│   │   ├── UserBubbleView.ets   # 已有（P2 接 token）
│   │   ├── AssistantBlock.ets   ← 【P3 从 Index.ChatRowBody 拆出】
│   │   ├── ToolPill.ets         # 已有（P2 接 token）
│   │   ├── ThinkingLine.ets     # 已有
│   │   ├── TodoPanel.ets / GoalBanner.ets / ContextRing.ets / MessageNav.ets  # 已有
│   │   └── LiveTailView.ets     # 已有
│   ├── sheets/                  ← 【P3】把 Index 的 16 个 @Builder 迁出为真组件
│   │   ├── PrefsSheet.ets / PanelsSheet.ets / SessSheet.ets / ContextSheet.ets
│   │   ├── SettingsSheet.ets / ModelSheet.ets / StatusSheet.ets / QueueSheet.ets
│   │   ├── PluginsSheet.ets / AskUserSheet.ets / ImageViewer.ets / SearchHitsSheet.ets
│   │   └── DrawerSheet.ets
│   ├── settings/                # 已有 Settings*
│   └── anim.ets                 # 唯一 @ohos.curves 出口（勿动）
└── pages/Index.ets              # 最终只剩：引导 + 状态接线 + 弹出层的组合（目标 < 1500 行）
```

---

## 2. 单一"状态 → 视图"管线（**禁止第二套判据**）

```
core/store（唯一状态）
   │
   ├─ core/toolstatus    raw status → kind / chip / 在飞 / 色角色         [纯, 可测]
   ├─ core/streammerge   行/迭代合并（终态优先）                          [纯, 可测]
   ├─ core/statusfmt     goal / todos / usage 的显示判据                  [纯, 可测]
   ├─ core/msgindex      导航锚点 / 最近序号                              [纯, 可测]
   ├─ core/ctxring       环档位 / 文案                                    [纯, 可测]
   └─ core/mdview（新）  MdBlock[] → MdBlockVM[]（含行内样式 + 溢出策略）  [纯, 可测]
   │
   ▼  （判据 + 语义令牌 ⇒ 渲染 token 集合）
core/design（尺度/层级/材质/动效/对比度）                                 [纯, 可测]
core/toolvisual（kind+live+selected+theme → PillVisual）                  [纯, 可测]
   │
   ▼
components/*（**只画**：把 VM + token 赋给属性；零字面量、零判据、零 if 式状态映射）
   │
   ▼
pages/Index（只做组合与数据接线）
```

**四条铁律**：
1. **一个状态、一份判据、一处渲染**。组件里再判一次 = 回归。
2. 判据必须住 `core/`（`run.sh` 不编译 `components/` ⇒ 判据写进组件 = **不可测**）。
3. 视觉取值只经 `core/design`（⛔ 组件里不出现 `#RRGGBB` / `borderRadius(数字)` / `fontSize(10)`）。
4. "会变的内容"必须真 `@Component + @Prop/@Link`（⛔ 带参 `@Builder`）。

### 2.1 Markdown 面 = 本管线的**范例**（其余面照抄）

```
core/mdview.ets（纯 TS，新增）
  输入：MdBlock[] + Palette + mdTheme(可空) + fontScale
  输出：MdBlockVM[]（每块：fontSize / lineHeight / margins / radius / surfaceRole /
                       borderRole / overflowPolicy / markerText / inlineStyles[]）
  判据：唯一出口（可脱机单测）
        │
        ▼
components/MarkdownView.ets（**哑渲染器**：只消费 MdBlockVM，删掉 4 份分叉）
```

**它示范的四件事**：
1. **判据/视图模型住 `core/`**（可测）——组件退化为哑渲染；
2. **配色单轴**（主题深浅是唯一明暗轴）——删掉 `inlineCodeFg` / `codeChromeOnTone` /
   `codeStripBg` / `codeStripAction` **4 份判据**；md 主题降级为"代码高亮覆盖项"；
3. **高亮复用既有引擎** `core/highlight.ets`（Prism4j，与 `ToolPopover` 同一个）；
4. **溢出 = 策略对象**（正文折行 / 代码·宽表横向 `Scroll`），⛔ 不再静默裁剪。

---

## 3. 分阶段 strangler 方案

> 每阶段**独立提交**、门禁绿、可 `git revert <该阶段提交>` 回滚。
> 阶段内按"一次一个文件、改完立刻严格 pathspec 提交"推进。

### P0 ✅ 已交付：令牌层 + 宪法（零 UI 变化）

- `core/design.ets`（新增）、`tools/tests/design.test.ts`（123 断言）、`docs/REDESIGN.md`、
  `docs/mockups/`。
- **回滚**：直接 revert（无生产影响）。
- **门禁**：`bash tools/tests/run-one.sh design` 绿；`bash tools/typecheck/check.sh` 绿。

### P1 纯视图模型抽离（**零 UI 变化**，只新增 `core/`）

为每个面建纯函数 VM（**只新增文件，不动组件**）：

| 新增 `core/` | 输入 → 输出 | 覆盖的"判据分散" |
|---|---|---|
| `bubbleview.ets` | `(row 字段, BubbleMetrics, Palette, token) → BubbleVM` | 气泡底色/文字色/换行策略（当前 3 套来源）|
| `goalview.ets` | `(objective, status, Palette, token) → GoalVM` | 目标条 5 个本地 const + 自造第二判据 |
| `todoview.ets` | `(TodoItem[], Palette, token) → TodoVM` | 待办条状态→图标/色 |
| `navview.ets` | `(anchors, activeSeq, token) → NavVM` | 导航高亮/命中区 |
| `ctxview.ets` | `(percent, token) → CtxVM` | 环档位→色（已有 `ctxring`，补 token）|
| `mdview.ets` | `(MdBlock[], Palette, mdTheme, fontScale) → MdBlockVM[]` | §2.1（**范例**）|

- **验收**：`run.sh` 绿 + 每个新模块配判别力测试（回退即红）。
- **回滚**：删除新增文件即可（零生产影响）。
- **为什么先做 P1**：它**零风险**（不改任何组件），却把"判据唯一源"先钉死 ⇒ P2/P3 才有安全的落点。

### P2 令牌接线（**逐组件、视觉可验证**）

**方法**（必须先做样板再批量）：
1. **挑一个面做样板** ⇒ 建议 `ToolPill`（已有 `core/toolvisual` 的纯解析，收益最大）；
2. 改完 **装机截图**，与样张 `docs/mockups/chat-flow.html` 的对应块对比（观感不变或更好）；
3. 样板获批后，**逐组件**照抄，每个组件一个提交；
4. 每次替换后**下调** `design.test.ts` 里的圆角字面量棘轮上限（`RADIUS_LITERAL_MAX`）。

**迁移明细**（哪些散落值 → 哪个 token；全部有 file:line 台账）：

| 组件 | 现在的散落值 | 换成 |
|---|---|---|
| `ToolVisual.ets` | `fontSize 10` / `top,bottom:5` / `13×13` / `RADIUS_SM` / `PILL_LIVE_GLOW_RADIUS 12` | `type.micro` / `INSET_CHIP_Y`·`INSET_ROW_Y` / marker 槽 `PILL_MARKER_SLOT` / `RADIUS_CHIP` / `surface.pill` 层级提升（去 `.shadow`）|
| `UserBubble.ets` | `fontSize(15)` / `onAccent` / `radius 12 shadow` / 双底色 | `type.body` / `textPrimary` / `elev1`(@token) / 单一 `surface.bubble` |
| `GoalBanner.ets` | `PAD_X=10` `PAD_Y=6` `ICON=14` `BADGE_FS=10` `BORDER_ALPHA_LIGHT` | `INSET_CARD_X/Y` / `type.caption` / `type.micro` / `surface.card` + `accent@30%` |
| `MessageNav.ets` | `BTN=32` / `borderRadius` | `HIT_TARGET_MIN`(44) / `RADIUS_PILL` |
| `TodoPanel.ets` | `HEADER_H=28` `BAR_W=48` `BAR_H=6` `GOAL_TINT_LIGHT` | `space` 档 / `RADIUS_CHIP` / `surface.chip` |
| `MessageRow.ets` | 扫光 `width 46` / `opacity 0.45` | `surface.pill` 静态在飞（去字面量）|
| `ToolPopover.ets` | `BODY_MAX_H 260` / `LN_W 30` / `Circle(8)` / `fontSize 10..12` | `overlay.*` 语义档 / `type.micro|subhead` |
| `ContextRing.ets` | `CTX_POP_W=200` / `RADIUS_MD` | `overlay.width` 语义 / `RADIUS_CHIP` |
| Settings* | 各组 `const X = 44/96` | `space` 档 |

**"观感不变"怎么保证**：
- 每个替换都是**等值映射**（如 `fontSize(10)` → `type.micro.size` = 10）或**明确的设计变更**（如 chip 底色 → `sunken`）；
- 等值映射者**截图逐像素对比**（`tools/brand/png_probe.py` 的思路可复用）；
- 设计变更者以 `docs/mockups/` 为"目标态"参照。

**可测的收益信号**（`bash tools/perf/guard.sh --static`，上限只减不增）：
- `this.pal()` 调用点 ≤1250 → 每迁一个组件应**下降**（palette 走 `design` 出口 / 记忆化）；
- `borderRadius(<数字>)` 70 → 0（`design.test.ts` 的棘轮保证只减不增）；
- 新增：`grep -c 'fontSize(1[0-3])'`、`'surfaceHi'`（组件直取通用面）应逐波下降。

### P3 Index.ets strangler（把 24 个 `@Builder` 变成真组件）

**顺序（先叶子、后主干；每次拆一个）**：

| 波 | 拆什么 | 为什么安全 |
|---|---|---|
| P3.1 | `LoadingView` / `LoginView` | 静态、无状态依赖 |
| P3.2 | 12 个 Sheet（`PrefsSheet`…`ImageViewer`）| 各自独立，只依赖 props/回调 |
| P3.3 | `ChatRowBody` / `LiveRowBody` | **必须改真组件**（当前解析冻结风险）|
| P3.4 | `ChatView`（大块）| 最后拆，风险最高 |

**每波的验收**：
1. `bash tools/gate.sh` ⇒ `✅ 真门禁全绿`（④ 十几秒级真编译）；
2. `Index.ets` 行数**单调下降**（`wc -l` 作为收益信号）；
3. 拆出的组件**立即接线**（否则是"孤儿组件"⇒ ArkTS 不检查 ⇒ 假绿，见 `GOTCHAS`）。

### P4 性能（独立波，可延后）

- Markdown：`mdview` 行内样式缓存 + 前缀解析复用 + 分块/窗口化；
- 长列表：`LazyForEach` 窗口化（风险高，先真机验证手势，见 `REDESIGN-INPUT-MARKDOWN §E`）；
- 收益信号：`core/markdown.ets:mdCacheStats()` 命中率、`tools/perf/guard.sh` 的 `paletteOf/surfacesOf` µs。

### P5 品牌 / 开屏（配置面，需用户拍板）

- `brand.*` / `splash.*` 语义角色（`REDESIGN.md §9`）；
- 开屏 → 主界面**一次性过渡**（`motion.enterBlock` + `motion.transition`）；
- `startWindow` FOLLOW_APPLICATION / 分层图标 / 品牌主色 —— **配置面只给 patch**（见 `REDESIGN.md §12`）。

---

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| **带参 `@Builder` 冻结** | 会变内容一律真 `@Component + @Prop/@Link`；P3 专治 |
| **`@Reusable` 跨会话串内容**（历史 P0）| 加状态前先定复用契约（`aboutToReuse` 必须刷新）|
| **基类成员名黑名单**（`size/position/id/enabled/on*`）| 新组件 `@Prop` 名先查 `ARKTS-GOTCHAS` |
| **`$r('sys.symbol.*')` 编译期校验** | 新增符号先查 `id_techned.json`；`brain` 不存在 → 用 `lightbulb` |
| **孤儿组件 = 假绿** | 拆出后**立即接线**，再跑 `gate.sh` |
| **`core/*.ets` 全量编译** | 任何新 `core/` 文件必须始终**可编译**（注释里别写 `星号斜杠`）|
| **并发写同一工作树** | 提交一律 `git commit -m ... -- <严格 pathspec>`，提交前核 `git diff --cached --name-only` |
| **浅色层次不许发光** | 白底只用填充阶梯 + `hairline`；`theme_contrast.test.ts` 守护 |

---

## 5. 交接清单

- [ ] P1：新增 6 个 `core/*view.ets`（纯 TS，零 ArkUI）+ 各自判别力测试。
- [ ] P2：样板 `ToolPill` → 截图对比 → 批量；每组件一提交 + 棘轮下调。
- [ ] P3：按 P3.1→P3.4 拆 `Index.ets`；每波 `gate.sh` 绿 + 行数下降。
- [ ] P4：`mdview` 缓存 + 列表窗口化（真机验证）。
- [ ] P5：`brand.*`/`splash.*` + 一次性过渡 + 配置 patch。
- [ ] 每阶段更新 `docs/WEB-ALIGNMENT.md §16`（有意分歧）与本文件。

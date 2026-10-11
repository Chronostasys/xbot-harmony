# REDESIGN-INPUT-SETTINGS —— 设置面板"皮肤"统一：设计输入

> **读者**：`design-lead`（新设计系统重构负责人）。
> **状态**：设计输入台账，**不含代码改动**（本轮只调研 + 写文档）。
> **范围**：`entry/src/main/ets/components/Settings*.ets`（12 个文件）+ `core/settings*.ets`。
> **基准**：视觉不再逐像素对齐 web（`docs/REDESIGN.md §10`）；令牌层 = `core/design.ets`（123 断言）。
>
> **一句话结论**：设置面**已经有一层共享原子**（`SettingsRows.ets` 8 个组件），但**只覆盖了 7/12 个分区**
> ⇒ 现在是"**半统一**"：`SettingsPanelHeader` 全用（✅），`SettingsToolRow` 只 7/12，`SettingsErrorBar` 10/12；
> 而**最要紧的"危险操作二次确认"有 5 套状态机 + 4 种取色**、且判据全在组件 `@State` 里（不在 `core/`）。
> ⇒ "再调几个 `padding`"不会让它变干净；需要**一个行状态模型 + 一个行组件**。

---

## A. 为什么"调样式救不了"（逐条 file:line）

### A1. 已有共享原子，但**覆盖不全** —— "统一"是局部的

`components/SettingsRows.ets` 导出 8 个原子组件：

| 原子 | 定义 | 消费者数 |
|---|---|---|
| `SettingsPanelHeader` | `SettingsRows.ets:454` | **12/12**（全部）✅ |
| `SettingsErrorBar` | `SettingsRows.ets:483` | 10/12 |
| `SettingsToolRow`（标题+说明+开关） | `SettingsRows.ets:29` | **7/12** |
| `SettingsMcpHead` / `SettingsNumberRow` / `SettingsChipRow` / `SettingsTextFieldRow` / `SettingsSubCard` | `:90 / :136 / :210 / :281 / :332` | 各 1–2 |

**未复用 `SettingsToolRow` 的 5 个分区**（各自写"标题+说明+控件"行）：
`SettingsAbout.ets` · `SettingsAccount.ets` · `SettingsLlm.ets` · `SettingsPlugins.ets` · `SettingsWebUsers.ets`。

**未复用 `SettingsErrorBar` 的 2 个分区**（自写错误显示）：
- `SettingsAccount.ets:82-83`（`if (this.error.length>0) Text(this.error)...`）
- `SettingsDeveloper.ets:267`（自写 `dangerText` 行）

> ⇒ 结论：**同一"设置行"存在 2 套实现路径**（共享原子 / 分区自写），下一波只有先收敛成 1 套，token 才有落点。

### A2. ⛔ **危险二次确认**：5 套状态机 + **4 种取色**（最严重）

| 分区 | 状态变量 | 确认态取色 | 位置 |
|---|---|---|---|
| `SettingsAccount` | `@State confirming` | `dangerText`（字） | `:42,107,155` / `:85,127,149` |
| `SettingsLlm` | `@State deleteId` | `statusError`（底）+ `onAccent`（字） | `:118,367-375` / `:1073,1075,1077` |
| `SettingsPlugins` | `@State confirmReload` | **`warnBg`（底）** ← **警告色用在危险操作** | `:221,410-420` / `:414` |
| `SettingsWebUsers` | `@State confirmDelete` | `dangerBg`（底）+ `dangerText`（边框） | `:51,216-231` / `:222-223` |
| `SettingsAbout` | 两步确认（注释自述） | `dangerText`（字 + **边框**） | `:20,394` / `:398,414,418,501,517,521,542` |

**含义**：同一件"不可逆操作要先确认"，有 5 份各自为政的 `@State` + 4 种视觉手段（红字 / 红底+白字 /
警告底 / 红字+红边）。**没有一份在 core 里**（不可单测），也没有"确认态"的语义 token。
`SettingsWebUsers.ets:48-49` 的注释甚至写着"与 `SettingsAccount.ets` 的 `confirming` 同款"——
**靠注释维持一致**，正是"第二套判据"的教科书形态。

### A3. 硬编码清单（token 里没有对应刻度）

| 值 | 位置 | 说明 |
|---|---|---|
| `.fontSize(10)` ×4 | `SettingsDeveloper.ets:214,218,223,266` | **低于 token 最小档** `FS_CAPTION=12`；设计系统最小字阶被绕过 |
| `.height(32)` / `.height(34)` | `SettingsDeveloper.ets:305,314` / `SettingsLlm.ets:590,1091` | 输入/选择框高 **32 vs 34**（同一种控件两种高） |
| `HEAD_H = 44` | `SettingsRows.ets:20` | MCP 组头高（**恰好 = HIG 命中区 44**，但语义是"行高"不是"命中区"） |
| `INPUT_W = 96` | `SettingsRows.ets:22` | 数字输入框宽（唯一给足 5 位数的依据） |
| `top:1, bottom:1` ×4 | `SettingsAbout.ets:297` / `SettingsLlm.ets:980` / `SettingsRows.ets:369` / `SettingsStorage.ets:302` | chip 竖向内距 —— **token 是 `SPACE_HAIR=2`（`core/design.ets:48`）**，这里一律写 1 |
| `FS_CAPTION` + `padding top/bottom SP_2` | `SettingsPanel.ets:199-201` | tab 标签（未走 `type.*` 角色） |
| `.padding(SP_4)` / `.padding(SP_3)` / `.padding(SP_2)` | `SettingsRows.ets:445`（卡片）/ `:496`（错误条）/ `SettingsToolRow:79-84`（行） | 三档内距**没有语义名**（`INSET_CARD_*` / `INSET_ROW_*` 在 `core/design.ets:59-75` **已存在但设置面没用**） |

> ⇒ `core/design.ets` 已经定义了 `INSET_ROW_X/Y`、`INSET_CHIP_X/Y`、`SPACE_HAIR`，
> 但设置面**几乎全部仍在写原始 `SP_*` 与字面量** ⇒ 需要的是"消费纪律 + 行规格 token"，不是新造刻度。

### A4. 判据不在 `core/` —— 行状态散在各组件 `@State`

- `core/settingsplugins.ets` 只负责 **tab 可见性**（`visibleTabs` / `fallbackTabId`，`SettingsPanel.ets:26` 消费）；
  **其余一切**（危险 / 忙碌 / 确认 / 禁用 / 副标题）都是各组件自己的 `@State` + 内联 `if`。
- 极端例子：`SettingsLlm.ets:1171` 的 `ForEach` key 里**手工拼了 6 个状态位**
  （`sub.active` / `enabled` / `manageSubId` / `deleteId` / `busy` / `subModelSig`）——
  行复用完全依赖"把状态编进 key"，**没有行状态模型**。任何新增状态 ➜ 改 key 字符串（易漏 → 复用错位）。

---

## B. 设置行状态矩阵（重构后必须逐格覆盖）

图例：✅ 已有且一致 / ⚠️ 有但不一致 / ⛔ 缺失。

| 行态 | 应表达 | 现状 | 缺口 |
|---|---|---|---|
| **普通**（标题 + 说明） | 标题 `type.body` + 说明 `type.caption`/`textMuted` | ✅ `SettingsToolRow:57-72`（但仅 7/12 分区用） | 5 个分区自写 |
| **开关·开** | Toggle 选中色 = `accent` | ⚠️ 用框架默认（`Toggle({isOn})`，无 `.selectedColor`） | 取色未 token 化 |
| **开关·关** | Toggle Track | ⚠️ 同上 | — |
| **副标题** | 第二个 `Text`，`FS_CAPTION`/`textMuted` | ✅ `SettingsToolRow:65-72` | — |
| **禁用** | 整行降不透明度 + 不可点 | ⚠️ 仅 Toggle `.enabled(!busy)`（`SettingsToolRow:53`）；行文字**不降级** | 行级禁用态缺失 |
| **忙碌** | spinner 或降级 | ⚠️ 与"禁用"混用同一个 `busy`（`:53`） | busy 与 disabled 未区分 |
| **危险（静息）** | 红字（`dangerText`） | ⚠️ 4 种取色混用（§A2） | 无 `state.danger` 三件套 |
| **危险（确认态/武装）** | 底 + 字 + 边框一套 | ⚠️ 5 套状态机（§A2） | 无 `state.dangerArmed` |
| **危险·禁用** | 危险 + 禁用组合 | ⛔ 无 | 组合态未定义 |
| **可点控件（按钮/链接行）** | 命中区 ≥ 44（HIG） | ⚠️ `SettingsAbout` 的按钮未保证；行本身无 `MIN_HIT` | 命中区未统一 |

---

## C. 新设计系统需要哪些语义 token

> 只列**当前缺失**；`core/design.ets` 已有的 `space.* / radius.* / type.* / surface.*` 不重复。
> ⚠️ 括号内是"今天用的是什么"，说明为什么必须收进 token。

### C1. 行规格（**缺失**）

| token | 用途 | 现状 |
|---|---|---|
| `row.minHeight`（建议 44） | 设置行最小高（= HIG 命中区） | 无；`HEAD_H=44` 只是 MCP 组头的偶然值（`SettingsRows.ets:20`） |
| `row.padX` / `row.padY` | 行内距（= 已有 `INSET_ROW_X/Y`，但设置面未消费） | 手写 `SP_2`/`SP_6`（`SettingsRows.ets:79-84`） |
| `row.gap`（标题↔说明） | 行内两行间距 | 手写 `space: 2`（`SettingsRows.ets:57`） |
| `row.indent` | 组内缩进（MCP 成员） | 手写 `SP_6`（`SettingsRows.ets:80`） |

### C2. 控件规格（**缺失**）

| token | 用途 | 现状 |
|---|---|---|
| `control.input.height` | 输入/选择框统一高 | **32 vs 34**（`SettingsDeveloper.ets:305,314` / `SettingsLlm.ets:590,1091`） |
| `control.input.width.num` | 数字输入宽 | `INPUT_W=96`（`SettingsRows.ets:22`） |
| `control.toggle.track` / `.thumb` / `.selected` | 开关尺寸与取色 | 全用框架默认 |
| `control.chip.padY` | chip 竖向内距 | 字面 `1`（4 处）；token `SPACE_HAIR=2` |

### C3. 状态档（**缺失** —— §A2 的根因）

| token | 用途 | 现状 |
|---|---|---|
| `state.danger.bg` / `.fg` / `.border` | 危险项**静息**三件套 | 混用 `dangerText` / `dangerBg` / `dangerText`-当边框 |
| `state.dangerArmed.bg` / `.fg` / `.border` | 危险项**确认态**三件套 | 5 套自造（含 `warnBg`、`statusError`+`onAccent`） |
| `state.busy.opacity` / `state.disabled.opacity` | 忙碌 / 禁用**分开** | 混用同一个 `busy`（`SettingsToolRow:53`）；`core/design.ets:579` 已有 `disabled` 不透明度但未被设置面用 |
| `state.error.row`（= `SettingsErrorBar` 的语义面） | 错误行 | `surfaceAlt` + `dangerText` + `SP_3` 手写（`SettingsRows.ets:492-498`） |

### C4. 文字层级（**已有角色，未消费**）

`core/design.ets:165-213` 的 `type.*` 已存在；设置面部分用 `FS_BODY/FS_CAPTION`（好），
但 `SettingsDeveloper.ets` 写 `fontSize(10)`（**绕过最小档**）⇒ 需要**"最低字阶"约束**（不得 < `FS_CAPTION`）。

---

## D. 重构后归属（判据 / token / 组件）

```
core/settingsrow.ets（新增，纯逻辑，可脱机单测）
  ├─ enum RowTone { normal, danger, dangerArmed }
  ├─ class RowState { tone; isOn; busy; disabled; hasSubtitle; armed }
  ├─ rowVisualOf(state, pal) → { bg, fg, border, toggleColor, opacity }   // 唯一取色表
  └─ armNextRow(prevArmedKey, clickedKey) → nextArmedKey                  // 二次确认的**唯一状态机**
core/design.ets（**只由 design-lead 改**）新增 §C1/C2/C3 的 row./control./state token
components/SettingsRow.ets（新增，替代 SettingsToolRow + 5 处自写行）
  └─ 只画：标题/说明/副标题 + 右槽（Toggle | 按钮 | 值）
各 Settings<Area>.ets
  └─ 只声明"行描述数组 + 回调"；**不再写 @State 确认态、不再自写 Row**
```

**关键纪律**：确认态从"每分区一个 `@State`"变成**一个 `armedKey`**（`core/settingsrow.ets` 的纯函数推进）
⇒ 5 套状态机 → 1 套；4 种取色 → 1 个 `rowVisualOf`。

---

## E. 风险

1. **12 个 Settings 文件在多条并行线上被改**（`SettingsPanel.ets` / `SettingsLlm.ets` / `SettingsPlugins.ets`
   当前工作树里有他人在途改动）⇒ 收敛必须**先加 `SettingsRow`、逐个分区替换**，不能一次性重写。
2. **孤儿组件规则**（`tools/lint/orphan-components.sh`）：`SettingsRows.ets` 的原子靠"跨文件真实实例化"进入
   依赖图才被真编译（⛔ **2026-10-11 判据已收紧为"文件级可达性"**：文件里**任一**导出有跨文件消费者 ⇒ **整个文件**被编译 ⇒ 文件内所有 struct 都被类型检查；因此"某个原子失去消费者"**不再必然**导致它不被编译，但只要**全文件**都没了跨文件消费者就整体失去检查。见 `docs/ARKTS-GOTCHAS.md` 批次 16b）。新增 `SettingsRow.ets` 后若旧原子失去消费者，会**不再被编译**（假绿风险）⇒ 需同步清理。
3. **`ForEach` key 里的 6 个状态位**（`SettingsLlm.ets:1171`）：换成行状态模型时，key 必须**同步**改成
   "内容 + armedKey"，否则复用错位（ArkUI 复用错位 = 渲染错乱，见 `docs/ARKTS-GOTCHAS.md`）。
4. **基类成员名黑名单**：新行组件的 `@Prop` 不得叫 `enabled`（已有此坑，`SettingsRows.ets:13/32-33` 注释）⇒ 用 `isOn`。
5. **`warnBg` 被当危险色**（`SettingsPlugins.ets:414`）：收敛时若直接映射会"平白变红"，需与 design-lead 确认
   "重载插件"到底算危险还是警告（**语义需拍板**，见 §F）。

---

## F. ⚠️ 应立即收敛项（真实第二套判据；请派单）

> 每条都带 file:line，且都是"同一语义多处实现"，不是审美问题。

| # | 项 | 证据 | 危害 | 建议 |
|---|---|---|---|---|
| **F1** | **危险二次确认：5 套状态机 + 4 种取色** | `SettingsAccount:42` / `SettingsLlm:118` / `SettingsPlugins:221` / `SettingsWebUsers:51` / `SettingsAbout:394`；取色 `:85` vs `:1077` vs `:414` vs `:222` | 同一动作 5 种反馈；新增分区必再造一套；`SettingsWebUsers:48-49` 只能靠**注释**维持一致 | 抽 `core/settingsrow.ets` 的 `armedKey` 状态机 + `state.dangerArmed.*` token |
| **F2** | **错误显示两套**（`SettingsErrorBar` 未全覆盖） | 共享 `SettingsRows.ets:483` vs 自写 `SettingsAccount.ets:82-83`、`SettingsDeveloper.ets:267` | 错误条的底/字/圆角三处分叉 | 强制复用 `SettingsErrorBar` |
| **F3** | **设置行两套**（`SettingsToolRow` 只 7/12） | `SettingsRows.ets:29` 消费者 vs 自写行（About/Account/Llm/Plugins/WebUsers） | 行高/内距/字号在 5 个分区各自为政 | 抽 `components/SettingsRow.ets` 统一 |
| **F4** | **字阶低于最小档** | `SettingsDeveloper.ets:214,218,223,266`（`fontSize(10)`） | 绕过 `core/design.ets` 的最小字阶（12）| 加"最低字阶"门禁 |
| **F5** | **输入框高不一**（32 vs 34） | `SettingsDeveloper.ets:305,314` vs `SettingsLlm.ets:590,1091` | 同控件两种高 | `control.input.height` token |
| **F6** | **chip 内距字面量 `1`（应为 `SPACE_HAIR=2`）** | `SettingsAbout:297`·`SettingsLlm:980`·`SettingsRows:369`·`SettingsStorage:302` | token 被绕过（4 处复制） | 收 `control.chip.padY` |

> **需要用户/设计拍板的点**：`SettingsPlugins.ets:414` 的「重载插件」用的是 `warnBg`（警告色）而不是危险色 ——
> 它是**危险**（不可逆、写入后回读）还是**警告**？这个语义决定 F1 的映射方向，**请 design-lead 定**。

---

## G. 归属小结

| 产物 | 归属 |
|---|---|
| 行状态模型 + 确认态推进 + 取色表 | 新增 `core/settingsrow.ets`（纯逻辑，可脱机单测） |
| 统一设置行组件 | 新增 `components/SettingsRow.ets`（替代 `SettingsToolRow` + 5 处自写行） |
| row./control./state.* token | `core/design.ets`（**design-lead 改**） |
| 各 `Settings<Area>.ets` | 只声明行描述 + 回调；删 `@State` 确认态与自写 Row |

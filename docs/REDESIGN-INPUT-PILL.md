# REDESIGN-INPUT-PILL —— 工具 pill / 浮层：设计输入（交给 `design-lead`）

> **范围**：工具 pill（`components/ToolVisual.ets` + `core/toolvisual.ets`）与其浮层
> （`components/ToolPopover.ets`）、以及它们在两个调用点（`components/MessageRow.ets`、
> `components/LiveTailView.ets`）里的**在飞/扫光/折叠**表现。
> **结论先行**：当前视觉不是"再调几个值就能好看"的问题 —— 它是一个**没有表面层级 token 的
> 系统**：pill 底 / chip 底 / 浮层底 **共用同一组 3 个通用面**（`surface/surfaceAlt/surfaceHi`），
> "在飞"用**阴影 API** 表达、且深浅主题**必须换物理量**。要继续贴近"苹果级干净"，需要**新增一层
> 语义 token + 一个状态→视图的单向管线**，而不是更多的 `fontSize/opacity` 微调。
> **本轮不改任何代码**（除本文档）；`fa9f87d` 已把"判据/视觉映射"下沉可测、消除第二套判据。

---

## A. 为什么"调样式救不了"（逐条 file:line）

### A1. 表面层级 token **不存在**（结构性根因）

`core/theme.ets` 只有三档**通用**面，pill / chip / 浮层**全部复用它**：

| 用途 | 现在用的 token | 位置 |
|---|---|---|
| pill 底（普通） | `surfaceAlt` | `core/toolvisual.ets:74` |
| pill 底（选中/浮层打开的那一枚） | `surfaceHi` | `core/toolvisual.ets:74` |
| chip 底（普通） | `surfaceHi` | `core/toolvisual.ets:86` |
| chip 底（选中） | `surfaceAlt` | `core/toolvisual.ets:86` |
| 浮层行底 / 悬停 | `surfaceHi` | `components/MessageRow.ets:712`（`+N` 徽标） |
| 浮层状态 chip 底 | `surfaces.sunken` | `components/ToolPopover.ets:435` |

**证据性后果（已发生的真 bug）**：chip 底与"选中 pill 底"曾经**是同一个 `surfaceHi`**
⇒ 浮层打开时 chip 与 pill 同色 ⇒ **chip 消失**（只剩彩色文字）。本轮在
`core/toolvisual.ets:84-87` 用 `selected ? surfaceAlt : surfaceHi` 打了补丁，但这是**症状**：
只要"面层级"仍挤在 3 个通用 token 里，任何"底里有底"（chip、浮层行、标记槽）都会再撞色。
系统层面需要的是**层级化表面 token**（见 §C1）。

### A2. "在飞"用**阴影 API** 表达，且深浅主题必须换**物理量**

```
core/toolvisual.ets:89-100   glowColorOf(kind, live, theme)
  live=false            → transparent
  live=true && 深色系    → effectsOf().glow      // accent@45% 的**彩色外发光**
  live=true && 浅色系    → effectsOf().elev2     // 正文色相@10% 的**中性投影**
components/ToolVisual.ets:118-122  .shadow({ radius, color, offsetX:0, offsetY:0 })
```

- **同一"在飞"语义，两种不可通的物理量**：深色用"发光（自发光）"、浅色用"投影（受光）"。
  这不是审美选择，是 45% 饱和色晕在**白底上读作"脏"**（`core/toolvisual.ets:92-94` 注释）；
  ⇒ 一个 `glow` token 无法覆盖两主题，**结构性必须分叉**（判据是 `isLightPalette`，
  `core/theme.ets:475` 按 `appBg` 感知亮度）。
- "在飞"借用 `.shadow()` ⇒ 与"卡片浮起/表面层级"**共用一个 API**，语义混淆：改层级会动到在飞、
  改在飞会动到层级。
- 发光半径 `PILL_LIVE_GLOW_RADIUS = 12`（`core/toolvisual.ets:23`）是**单一常数**，不随主题/密度变。

### A3. 形态是**代码分支**，不是 token

`components/ToolVisual.ets:64-87`：marker 槽里 5 个 `if/else if` 分支（勾 / 叉 / 减号 / 虚线圆 /
`LoadingProgress`），字号硬编码 **13 / 12**、spinner 写死 `13×13`。**新增一档状态 = 改组件**；
"形状档"无法由设计系统单独演进。

### A4. 硬编码清单（都不在 token 里；`core/tokens.ets` 无对应刻度）

| 值 | 位置 | 说明 |
|---|---|---|
| `top/bottom: 5` | `components/ToolVisual.ets:114` | pill 竖向内距（token 只有 4 的倍数） |
| `fontSize 10` | `components/ToolVisual.ets:102` | chip 字号（web 是 9.5px；token 最小 12） |
| `top/bottom: 1` | `components/ToolVisual.ets:106` | chip 竖向内距 |
| `fontSize 13 / 12`，`13×13` | `components/ToolVisual.ets:68,71,74,81,85` | marker 字号 / spinner 尺寸 |
| `width 46`,`opacity 0.45` | `components/MessageRow.ets:662,667` | **扫光**带宽度 / 透明度 |
| `linearGradient` 5 色停 | `components/MessageRow.ets:663-666` | 扫光渐变（`accentSoftFade/accentSoft/sheen`） |
| `margin 3` / `maxWidth 240` | `components/MessageRow.ets:672,674`（同 `LiveTailView:550,549`） | pill 外边距 / 宽度上限 |
| `opacity 0.75`（按压） | `components/MessageRow.ets:676`（同 `LiveTailView:552`） | 交互层 |
| `BODY_MAX_H 260`/`MAX_LINES 200`/`MAX_DIFF_LINES 240`/`LN_W 30` | `components/ToolPopover.ets:30,32,34,36` | 浮层尺寸 |
| `fontSize 10/11/12` 散落 12 处 | `components/ToolPopover.ets:219,247,262,331,332,338,342,359,362,378,380,381,433,438,469` | 浮层字阶 |
| `Circle(8)` | `components/ToolPopover.ets:426,534` | 状态点 |
| `maxHeight BODY_MAX_H+150` | `components/ToolPopover.ets:480` | 详情卡总高 |

### A5. 结构性限制（改样式也绕不过）

1. **`@Prop` 快照铁律**：pill 必须 `@Component + @Prop`，⛔ 不能带参 `@Builder`
   （`docs/ARKTS-GOTCHAS.md` 的"带参 Builder 按值快照"，实例见 `components/ToolVisual.ets:4-9`）。
   ⇒ 视觉输入必须是**值**、每帧重建；性能上禁止"每帧重算样式对象"。
2. **`build()` 内无局部语句**：本仓组件 `build()` **不以 `const` 开头**（实测 40 个组件无此形态）
   ⇒ 不能在 build 里缓存解析结果（本波用 `core/toolvisual` 的**主题记忆化**绕过：
   `core/toolvisual.ets:28-48`）。
3. **`stateStyles` 接管动态属性**：调用方用 `.stateStyles({pressed:{.opacity(0.75)}, normal:{.opacity(1)}})`
   （`MessageRow.ets:676`）做按压 ⇒ 若在 pill 内再加 `stateStyles`，必须逐态重声明
   `backgroundColor/shadow/…`，否则被接管清空。
4. **系统组件不可 token 化**：`LoadingProgress`（`ToolVisual.ets:85`）与 `SymbolGlyph` 的
   `symbolEffect`（`:82`）由系统绘制 ⇒ token 只能覆盖**外围**（尺寸/色/槽位），不能覆盖内部动效。
5. **第二套实现仍未收敛**（属 `pill-scroll-p0` 的拆分计划，⛔ 本波不动）：
   `components/LiveTailView.ets:319`（`badge()`）/`:337`（`color()`）/`:351`（`label()` 死副本）
   仍在自持 raw-status 分支；`:568` 的 ForEach key 含 `t.status` ⇒ 流式期销毁重建 pill。
6. **溢出折叠**判据在 core（`core/streammerge.ets:448-449,465` `foldPills`，阈值 8/7），
   但 `+N` 徽标是**另一套视觉**（`MessageRow.ets:712` / `LiveTailView` 的 `OverflowBadge`）。

---

## B. 状态矩阵（6 档语义 × 深浅主题 × 选中 / 未选中 / 溢出折叠）

语义档由 `core/toolstatus.ets:68`（`toolStatusKind`）唯一判定；视觉现状由
`core/toolvisual.ets:123-136`（`pillVisual`）解析。**每个格子必须由 token 决定，不允许再出现字面量。**

| 档（`kind`） | 形态 marker | 状态色角色 | 名称色 | chip 文案 | 在飞 |
|---|---|---|---|---|---|
| `done` | 描边勾 | `success` | 中性 | **（无）** | 否 |
| `running` | 原生 spinner | `accent` | 中性 | `执行中`（+` 1.2s`） | **是** |
| `generating` | 原生 spinner | `accent` | 中性 | `生成中 N 字` / `生成中…` | **是** |
| `pending` | 虚线空心圆(+呼吸) | `muted` | 中性 | `排队` | committed 否 / **live 是** |
| `error` | 实心叉 | `danger` | **红** | `失败` / `失败 exit N` | 否 |
| `killed` | 减号 | `muted` | 中性 | `已终止` | 否 |

**`kind × 主题` 的解析**：`statusColorRole`（`toolstatus:130`）→ `statusColorOf`
（`toolvisual:57-64`，`danger/success/muted/accent` → 主题色）。**深浅两套色板必须都给出这 4 个角色**
（现散在 `core/theme.ets` 的 `dangerText/successText/textMuted/accentSoft`）。

**`× 选中 / 未选中`**：只允许影响**表面层级**（pill 底提亮一档 `toolvisual:74`；chip 底随之
`toolvisual:86` ⇒ 两者**恒不同色**，这是本波修的不变量）。**不允许**选中改变形态/文案/状态色。

**`× 溢出折叠`**（> 8 枚：`streammerge:448-449`）：直出 ≤7 枚 + `+N` 徽标。徽标需与 pill
**同一套表面/圆角/按压 token**（现 `MessageRow.ets:712` 用 `surfaceHi/surfaceAlt/R_LG`，
`LiveTailView` 另一份）—— 建议 `+N` 视为 pill 的 **compact 变体**（同一 token 集）。

**必须交付给设计的三张矩阵**：① 6 档 × 4 角色色（深/浅）② 3 层表面 × (普通/选中/悬停/按压)（深/浅）
③ 在飞的**静态**表达档（见 §D）。

---

## C. 对新设计系统的需求

### C1. 需要的**语义 token**（建议命名；值由 design-lead 定）

| 类别 | token | 当前替代物（→ 要消灭的） |
|---|---|---|
| 表面层级 | `surface.pill` / `surface.pillSelected` / `surface.pillPressed` | `surfaceAlt/surfaceHi`（`toolvisual:74`、`MessageRow:676`） |
| 表面层级 | `surface.chip` / `surface.chipSelected` | `surfaceHi/surfaceAlt`（`toolvisual:86`） |
| 表面层级 | `surface.overlay` / `surface.overlayRow` / `surface.overlayRowHover` | `surface/surfaceAlt/surfaceHi/sunken`（`ToolPopover:435`、`MessageRow:712`） |
| 文字层级 | `text.pillName`（中性）/ `text.pillNameError` / `text.chip` | `textPrimary/dangerText`（`toolvisual:67-69`） |
| 形状 | `shape.pill` / `shape.chip` / `shape.overlay` / `shape.markerSlot(=14)` | `R_LG/R_SM` + 常量（`ToolVisual:107,116`、`toolvisual:26`） |
| 状态色角色 | `status.danger/success/muted/accent`（**每套主题 4 个**） | `dangerText/successText/textMuted/accentSoft`（`toolvisual:60-63`） |
| 在飞 | `inflight.pill.surface`（表面层级提升）+ `inflight.pill.tint`（仅**静态**色调） | `.shadow` glow/elev2（`toolvisual:96-100`） |
| 间距/字阶 | `space.pillY / space.chipY`、`font.chip` | `5/1`（`ToolVisual:114,106`）、`10`（`:102`） |
| 浮层 | `overlay.maxHeight / overlay.lineCap / overlay.gutter` | `BODY_MAX_H/MAX_LINES/LN_W`（`ToolPopover:30,32,36`） |

> **关键**：`surface.*` 必须**分层**（pill > chip > overlay 有明确明度序），否则"底里有底"必然撞色
> （A1 的真 bug 就是没有层级）。`inflight.*` 必须**不含动画**（见 §D）。

### C2. 状态矩阵（见 §B）—— 需要 design-lead 逐格填"深/浅 × 4 角色"的确切值。

### C3. 在飞表现（**铁律：同一时刻只有一个在飞动效 = 光球**）

依据 `docs/DESIGN-SYSTEM.md:184,188,201`：光球是**唯一主高亮源**；pill 的"在飞"只表达
**工具身份 + 状态色**，"不重复表达'整机在跑'"。⇒ **允许的静态维度**：

1. 状态色（`accent`）—— 已有；
2. marker 的**系统 spinner**（`ToolVisual:85`）—— 归"工具身份"，不是"整机状态"；
3. **表面层级提升**（当前借用 `.shadow` → 应改成 `inflight.pill.surface` 语义 token）；
4. **扫光**（`MessageRow:660-670`）：纯 `transform`（`translate(x)`），**无新定时器**（`sweepX`
   由页面统一推进 `MessageRow:85`）—— 这是**被允许**的在飞静态手段之一。

**⛔ 不允许**：pill 内新增第二个"呼吸/旋转/脉冲"。**待裁决项**：排队态的 `ScaleSymbolEffect`
（`ToolVisual:82`）是一记**符号呼吸**，且位于**非在飞**档 —— 严格解读"一个在飞动效"并不冲突，
但若新系统要"极简"，建议 design-lead 明确**保留 or 移除**（我倾向：**保留可，但需登记为唯一例外**）。
另注：`build()` 内 5 个分支里的 spinner 与光球**同屏**时，需确认不产生"两个在飞主角"的观感。

---

## D. 重构后归属建议（单一"状态→视图"管线）

```
raw status/exit/genChars/elapsed  ──▶  core/toolstatus  (判据：kind / 文案 / 在飞 / 色角色)   [纯, 可测]
                                        │
                                        ▼
                          core/toolvisual  (kind + live + selected + theme ──▶ 渲染 token 集合) [纯, 可测]
                                        │  （PillVisual：marker/accent/textColor/pillBg/chipBg/glow…）
                                        ▼
                          components/ToolVisual  (只读 token 画；**零字面量/零判据**)
                                        │
                                        ▼
             components/{MessageRow,LiveTailView}  (布局 + 交互 + 浮层开合；**不含视觉判定**)
```

- **判据住 `core/toolstatus`**（已就位，勿动）。
- **视觉映射住 `core/toolvisual`**（已就位；重构时**扩为完整 token 解析**，把 §A4 的字面量全部外提）。
- **组件只画**：`ToolPill` 读 token 上色/上形；`stateStyles` 的按压交由调用方（约定分工，避免接管）。
- **浮层**：`ToolPopover` 的**视觉**同样下沉 `core/toolvisual`（现在 `fontSize/Circle(8)/sunken` 散落）。
- **风险**：① `run.sh` **不编译 `components/`** ⇒ 任何**可判定**逻辑必须住 `core/`（否则不可测）；
  ② `@Prop` 快照 + 无 build 局部变量 ⇒ token 解析必须在 core 侧**记忆化**（已用主题 memo）；
  ③ `stateStyles` 接管 ⇒ 交互/视觉职责要在管线里写死边界；④ 系统 `LoadingProgress/SymbolGlyph`
  不可 token 化 ⇒ 设计需接受"外围 token + 系统内部自绘"。

---

## E. 可访问性（色盲 / 低对比）—— 做法 + **怎么测**

**现状风险**：状态的主表达是**颜色**（`statusColorRole` → 4 个角色色）。`muted`（pending/killed）
在深色主题里对比度本就低；`danger`(红)/`success`(绿) 对红绿色盲不可分；`running`(accent)/`pending`(muted)
仅靠明暗差。⇒ **必须保证"不看颜色也能分辨 6 档"**。

### E1. 至少**二维冗余**（每一档都有"非颜色"的可辨维度）

| 档 | 维度①形态（marker） | 维度②文字（chip） | 维度③填充 | 现状 |
|---|---|---|---|---|
| done | 描边勾 | （无 chip，安静） | 描边（非实心） | ✓ |
| running | 系统 spinner | `执行中`(+时长) | 无 | ✓ |
| generating | 系统 spinner | `生成中…` | 无 | ✓ |
| pending | 虚线空心圆 | `排队` | 无 | ✓ |
| error | **实心**叉 | `失败`(+exit) | **实心** | ✓（建议再加 1px danger 边框坐实） |
| killed | 减号 | `已终止` | 描边 | ✓ |

> 结论：**文字（chip）是最强冗余**（语义词），已具备；形态是第二维（形状档 = f(kind)）。
> 缺口：`error` 与 `killed` 在低对比主题里仅靠"实心红 vs 描边灰" —— 建议 error **加边框**、
> `muted` 档**提高对比度下限**（新 token 需规定 `text.chip` 对 `surface.chip` 的**最低对比度**）。

### E2. **可测**的不变量（可直接写成 `tools/tests/toolvisual.test.ts` 的断言）

1. **色盲可辨性**：`statusColorRole(kind)` 六档**两两可分**；且映射到主题色后
   **两两不同**（`pending ≠ running`、`done ≠ killed`…）。
2. **非颜色维度可辨**：`marker`（形状档）与 `chip`（文案）在 **6 档上各自两两不同**
   ⇒ 断言"把颜色信息全部抹掉后仍能区分 6 档"（把 (marker, chip) 当成一个二元组，6 个组合互不相同）。
3. **对比度**：对每档断言 `contrast(chipText, chipBg) ≥ 阈值` 与
   `contrast(pillName, pillBg) ≥ 阈值`（**复用仓内已有的 WCAG 计算** ——
   `tools/tests/theme_contrast.test.ts` 已实现该口径与台账）。
4. **层级不撞色**：`chipBg ≠ pillBg`（选中/未选中，全主题）—— **已落地**（`toolvisual.test.ts`）。
5. **状态色不串档**：`accent` 只属于 running/generating；`done` 无 chip；`error` 才红名 ——
   均可枚举断言（已部分落地）。

> 落地建议：把 (1)~(3) 作为**新设计系统 token 的"验收门禁"**：设计师给任何新配色，
> CI 都能自动判定"6 档可辨 + 对比度达标"，而不是靠肉眼。

---

## F. 一句话交底

**不是样式问题，是"表面层级"缺一层 token、"在飞"用错了 API（阴影）、形态写成代码分支**。
请给：① 分层 `surface.*`（pill/chip/overlay，深/浅各一套，含选中/悬停/按压）
② `status.*` 4 角色 × 深/浅（带**最低对比度**约束）③ 形状/间距/字阶 token（消灭 §A4 全部字面量）
④ 一个**不含动画**的 `inflight.pill.*` 语义（静态色 + 层级提升，动效唯一归光球）
⑤ 确认"排队态符号呼吸"的存废。**验收门禁**：6 档在"无颜色"下仍可辨 + 每档对比度达阈（可自动化）。

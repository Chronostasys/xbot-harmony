# 工具 pill 浮层（ToolPopover）设计规格

> 先设计、后实现。任何对浮层的改动都先改这份规格，再动代码。
> 上一轮的病：**无卡片内边距**（内容贴死边框）、`BREAK_ALL` 从词中间劈代码、JSON 死灰一坨、
> 弹层身份不唯一导致**一次弹两个**、限高过大导致**被状态栏裁掉**。

## 1. 尺寸与间距（全部用 `core/tokens.ets` 的刻度，禁止魔数）

| 位置 | 值 | 理由 |
|---|---|---|
| 浮层宽度 | `340vp` | 屏宽 ≈391vp，两侧各留 ≥24vp 露底，才能看出"这是浮层" |
| **卡片内边距** | **`SP_3`(12)** | ⛔ 本轮漏项：无内边距 ⇒ 内容贴边框，观感"抠图" |
| 区块间距 | `SP_2`(8) | 标题/摘要/参数/输出之间 |
| 代码块内边距 | `SP_2`(8) | 代码与块底之间 |
| 代码块圆角 | `R_MD`(6) | 与全局一致 |
| 卡片圆角 | `R_XL`(12) | 由 `bindPopup.radius` 提供 |
| **内容区最大高** | **`260vp`** | 屏 ≈844vp；限制在 1/3 内 ⇒ 浮层**朝上朝下都放得下**（太大时 ArkUI 会贴顶被状态栏裁） |
| 整卡最大高 | `400vp` | 内容区 + 头/尾；同样为了必然放得下 |
| 单块最多行 | `200` | 超出只留**尾部**（输出"最后出错"，尾部信息量最大） |

## 2. 层次（靠留白与亮度，不靠描边）

```
┌─ 卡片 底色 surfaceAlt / radius 12 / padding 12 ─────────────┐
│  ● Shell: cd /Users/…                        513ms          │ ← 状态点(语义色) + 名字(正文色/Medium) + 耗时(muted)
│  一句话摘要（可选，muted 系）                                │
│                                                             │
│  参数                                            [复制]      │ ← 段头：10px muted + 图标按钮
│  ┌─ elev1 底 / radius 6 / padding 8 ─────────────────────┐  │
│  │ {                                                    │  │ ← 等宽 11px，逐 token 着色
│  │   "command": "…",        ← 键=紫 / 值=绿 / 数字=琥珀  │  │
│  │   "timeout": 300                                     │  │
│  │ }                                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  输出                                            [复制]      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Command executed successfully (no output)   ← 成功=绿  │  │
│  └──────────────────────────────────────────────────────┘  │
│  退出码 0                                                   │
└─────────────────────────────────────────────────────────────┘
```

**配色纪律**（与本项目设计系统一致，见 `DESIGN-SYSTEM.md`）：
- 状态点/标题/状态徽标**同色**（一处语义一处颜色）
- JSON：键 `accentText` / 字符串 `successText` / 数字 `warn` / 标点 `textMuted` / 其它 `textSecondary`
- 输出：错误行 `dangerText` / 成功行 `successText` / 标题提示行 `accentSoft` / 普通 `textSecondary`
- **不用描边**：代码块靠 `elev1` 底与卡片 `surfaceAlt` 底的亮度差分层

## 3. 折行与溢出（硬约束）

- ⛔ **禁止 `WordBreak.BREAK_ALL`**：会把 `"command": "cd /Users/…` 从词中间劈成乱码墙。
  用 `BREAK_WORD`（优先词边界；单个超长 token 才迫不得已断开）。
- 代码块外层 `Scroll` + `constraintSize({maxHeight: BODY_MAX_H})`：内容再长也不出屏。
- 整卡 `constraintSize({maxHeight: 400})`：与内层滚组成"卡内滚动"。
- 长行必须能选中复制（`copyOption(LocalDevice)`），复制按钮在段头。

## 5. 语法高亮：**用现成的高亮器，不自己造**（待你拍板）

### 5.1 为什么不能自己写

web 端聊天区用 **`components/agent/CodeView.tsx` → highlight.js**（`highlight.ts` 懒加载 + 精选语言子集），
**diff 只是它的一个语言**。按格式分别写着色器（JSON 一套、diff 一套、终端一套）是**造轮子且必然覆盖不全**。

### 5.2 ohpm 候选（已实测元数据）

| 包 | 要求 compatibleSdkVersion | 技术栈 | 说明 |
|---|---|---|---|
| `@qiplat/sweetline` | **19** | C++17 引擎 + ArkTS 绑定 | 全量/增量分析；**非 Java**（你不喜欢 Java 血统） |
| `@hxa-atpc/noties_prism4j` | 21 | ArkTS 移植（血统名带 j，**实为 ArkTS**，编译产物是 `ets/modules.abc`） | Prism4j：**纯分词**，输出 `Text`/`Syntax` 节点树，25 语言 + 全量定位器；**不负责配色**（配色归我们） |
| `@hxa-atpc/highlight_codeview` | 21 | ArkTS | 现成的高亮代码视图组件 |
| `@tangs/markdown` | 23 | ArkTS | Markdown + 17 语言高亮 |

⚠️ **实测**：本工程 `compatibleSdkVersion: "5.0.0(12)"`，装入 `noties_prism4j` 后构建**直接失败**：
```
00306004 Specification Limit Violation
The project's compatibleSdkVersion: 12 cannot be lower than the minimum compatible version 21
```
⇒ 用任何包都必须先抬 `compatibleSdkVersion`（最低 19 ⇒ 最低支持从 HarmonyOS 5.0 抬到 6.0），
**这是产品决策（放弃 5.x 设备），必须由你拍板**。

### 5.3 三条路（按"与本工程架构一致性"排序）

| 方案 | 做法 | 代价 | 收益 |
|---|---|---|---|
| **A. 复用 ArkWeb 逃生舱**（**推荐**） | 用工程**已有**的 `components/WebSurface.ets`（ArkWeb）承载一个"代码/diff 渲染页"，内部直接用 **web 端同一份 highlight.js + 同一套主题 CSS** | 浮层里多一个轻量 WebView；需一条传参桥 | **零新依赖、不动 SDK、与 web 逐像素一致、hljs 全语言 + diff 全覆盖**；完全符合本工程"对齐 web / 复用逃生舱"的既定架构 |
| B. 装 ohpm 高亮包 | 抬 `compatibleSdkVersion` 到 ≥19（sweetline）或 ≥21 | 放弃 HarmonyOS 5.x 设备；浮层内需自己把 `Syntax` 节点映射成 ArkUI `Span` | 原生性能好、无 WebView |
| C. 保留现有轻量着色 | 维持 `core/jsontok.ets` + 行语义着色 | **就是你说的"造轮子"**，语言覆盖必然不全 | 无依赖、无 SDK 变更 |

> 现状（**已定案 = 方案 B**）：装 `@hxa-atpc/noties_prism4j`，`compatibleSdkVersion` 抬到 **21**
> （用户用 HarmonyOS 7.0，放弃 5.x 已获批准），并把 `useNormalizedOHMUrl` 置 `true`
> （bytecode HAR 的硬要求）。
> **diff 的解析逻辑逐字移植 web `parseUnifiedDiff` / `extractDiffSource`** ——
> 它是**本工程自己的代码**（不是第三方轮子），移植它属于"对齐"而非"重造"。

### 5.4 最终方案（已实现）

- **分词**：`Prism4j`（`core/highlight.ets`）—— 上百种语言，`diff` 只是其中一种语法。
  我们**只消费分词结果**，把 token 类型映射成**语义色键**（`comment`/`string`/`keyword`…），
  **颜色仍由 `Palette` 决定** ⇒ 换主题/换强调色自动一致（视觉统一不破）。
- **零丢失不变量**：`highlightCode()` 摊平后必须与原串**逐字相等**，否则退回纯文本；
  超长（>20000 字符）/未知语言/异常一律退化为纯文本（绝不吞内容、绝不卡 UI）。
- **diff**：`core/diffparse.ets`（移植严格保真，含"末尾换行 ⇒ 一行尾 ctx"这个 web 原生行为），
  `core/highlight.ets` 的 `K_DIFF_ADD`/`K_DIFF_DEL` 映射 Prism 的 `inserted`/`deleted`。
- **弃用**：`core/jsontok.ets`（自写 JSON 分词器）**已删除** —— 它正是"造轮子"的遗留物，
  其能力被 Prism4j 完整覆盖（且 Prism4j 还免费带来全部语言）。
- **可测性**：Prism4j 是 bytecode HAR，脱机由 `tools/tests/mocks/prism4j.js` 提供 stub
  （`grammar()` 恒 null）⇒ 单测覆盖**映射表 + 退化路径**；真实着色由真机验收。


- **弹层身份 = 唯一键**：`pillKeyOf(iter, tool, idx) = turnID:iter:name#(call_id | idx)`。
  ⛔ 不能用 `(迭代号, 工具名)`：同迭代内同一工具可多次调用（一轮两次 `FileReplace`）
  ⇒ 两枚 pill 判据同时成立 ⇒ **点一下弹两个**。
- 点击行为：开/关同一枚；`onWillDismiss`（返回键/点外部）关闭。
- 关闭即清空 `popKey`（单一真值来源，不再有 `popIter + popName` 两个状态）。

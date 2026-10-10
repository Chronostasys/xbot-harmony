# 与官方 webui 的功能对齐（native ↔ web）

> 本文件记录**原生端与官方 webui 的功能/设置对齐关系**，以及哪些是刻意不做。
> 新增共享功能前请先读这里，避免造出"只在客户端生效、与 web 各说各话"的孤岛设置。

## 1. 共享设置键（**两端必须同 id**）

映射表在 `core/settings.ets` 的 `serverKey()/localKey()`，与 web `userSettings.ts` 同源：

| 本地键 | 服务端键 | 状态 |
|---|---|---|
| `xbot-app-theme` | `web:ui:app-theme` | ✅ 可改（深/浅/极光/星云） |
| `xbot-accent` | `web:ui:accent` | ✅ 可改（6 预设 + 跟随主题） |
| `xbot-md-theme` | `web:ui:md-theme` | ✅ 可改（23 套，只影响代码块/行内码） |
| `xbot-starred` | `web:session:starred` | ✅ 可改（星标 + 星标优先排序） |
| `xbot-locale` | `web:ui:locale` | ⚠️ **只读展示**（见 §3） |
| `xbot-font-scale` | `web:ui:font-scale` | ✅ 可改 |
| `xbot-code-word-wrap` | `web:ui:code-word-wrap` | ✅ 可改 |
| `xbot-reasoning-default` | `web:ui:reasoning-default` | ✅ 可改 |
| `xbot-send-key-mode` | `web:ui:send-key-mode` | ✅ 可改 |
| `xbot-surface` | `web:ui:surface` | ✅ 可改（原生 / 内嵌 ArkWeb） |

> 改了共享键 = 改了两端（含 web）。所以**写入前必须确认语义与 web 一致**。

## 2. 本轮新增的对齐实现

### 2.1 强调色 `core/accent.ets`
- 语义：`withAccent(palette, hex, isDark)` **只覆盖 accent 家族**（accent/accentHover/accentSoft/accentSoftFade/accentDeep/accentText/onAccent/bubbleUser），
  底/面/文字/边框**逐值不动** ⇒ 换色不会破坏已建立的亮度阶梯。
- hover 方向对齐 web：**深色系变亮 0.12 / 浅色系变暗 0.1**；`onAccent` 走对比前景（BT.601 亮度 >150 用深色字）。
- ⚠️ **未设置 ⇒ 不覆盖**（返回主题本色）。历史坑：曾回落 web 的 `DEFAULT_ACCENT_COLOR #3388BB`，把主题紫色顶掉，整套配色身份丢失。
- 守护：`tools/tests/accent.test.ts`（39 例，含"底色不变""accent ≠ onAccent""预设逐值与 web 一致"）。

### 2.2 Markdown 主题 `core/mdtheme.ets`
- 23 套主题的 **id 与顺序与 web `MARKDOWN_THEMES` 逐字一致**（id 不一致会导致"web 选了 monokai、客户端显示未知"）。
- 消费面：`【MdThemeItem】` + `codeTone(id)` → `{bg, fg, inlineBg}`，经
  `Messages: MarkdownView.mdTheme` 透传到代码块底/字与行内码底。
- ⚠️ 原生端**只消费这三个角色**（其余走全局色板）—— 不把 23×20 个 CSS 变量硬搬进 ArkTS。
- 守护：`tools/tests/mdtheme.test.ts`（19 例，含"id 与顺序逐字一致""不同主题配色必须不同"）。

### 2.3 会话星标 `core/stars.ets`
- 存储：逗号分隔的 chat_id（复用项目"设置项都是 string"的通道，不为此单开持久化路径）。
- 排序：`starredFirst(order, starred)` **只把星标提前**，同组内保持服务端顺序 ⇒ 不与既有置顶/上移/下移打架
  （web `sortSessions` 第一关键字就是 starred，后续才是 sortOrder/createdAt）。
- 守护：`tools/tests/stars.test.ts`（23 例，含脏数据解析、去重保序、不丢项）。

## 3. 刻意**不做**的（附理由，避免被当成遗漏）

| 项 | 为什么不做 |
|---|---|
| **i18n 语言切换** | 原生端 UI 文案是中文硬编码在 ~100 处（Index.ets / components）。抽表是**独立重构**；只做选择器却不变文案 = 假功能。故 `KEY_LOCALE` **只读展示**，见 `core/i18n.ets` 顶部说明。 |
| **原生终端 / 编辑器 / 文件浏览器** | 架构性差异：这些由 ArkWeb 逃生舱承载（`WebSurface`），不在原生重写。 |
| **Dockview 工作区布局** | 原生用标签栏替代。 |
| **23 套 md 主题的完整 20+ 变量** | 只取最有辨识度的 3 个角色，见 §2.2。 |

## 4. 图标规范（本轮踩过的坑）

用 `SymbolGlyph($r('sys.symbol.<name>'))`，符号名**必须**在
`toolchains/id_defined.json` 的 `record[type=="symbol"].name` 里核实存在（编错名 = 编译失败）。

⚠️ **不是所有字形都该换成符号**：
- 必须换：`✳ ✦ ✕ ☰ ⊞ ⚙ ＋ ▣ ↑ ■`（emoji 变体或字形差）。
- **不要换**：`⋯`(U+22EF) —— 鸿蒙符号集里的 `more` 是**四宫格**（与顶栏 ⊞ 面板按钮撞脸、语义错），
  而 `ellipsis` 只作为消息气泡类图标存在。`⋯` 无 emoji 变体，纯文本字形就是最合适的。
  ⇒ 教训：**替换要先验证目标符号的真实长相**，别按名字想当然。

已核实可用且在用：`line_3_horizontal` `square_grid_2x2` `gearshape` `paperclip` `picture`
`paperplane_fill` `square_fill` `xmark` `chevron_right` `chevron_down` `star` `star_fill`
`checkmark` `arrow_counterclockwise` `more`。**不存在**：`sparkles` `ellipsis` `globe` `language`。

## 5. 启动健壮性（对齐 web 的语义）

`bootstrap()` 的自动登录**必须区分两类失败**：
- **401** ⇒ `handleAuthExpired()`（清凭证 + 回登录页 + "登录已过期"）。
- **其它（连接被拒/超时/服务端抖动/端口转发未就绪）** ⇒ **退避重试**（`AUTO_LOGIN_ATTEMPTS=3`），
  失败时**保留凭证**并给出可读原因。
  ⛔ 绝不能像旧实现那样 `catch { loggedIn = false }` 静默掉回登录页 —— 用户会以为"又被登出了"，
  而 cookie 其实完全有效。
- ⛔ 打开首个会话（`openSession`，含网络等待）**必须单独 try/catch**：让它抛到 `bootstrap()` 外层
  会让 `booted` 永不置位 ⇒ **无限启动页**（本轮真实踩过并修复）。

## 6. 会话池（历史重拉的根因）

`poolMax()` **不能太小**：驱逐 = 下次切回来要 `openSession()` ⇒ 重新拉一次 `/api/history`。
曾是 3（会话数 >3 就来回重拉），现为 **8**。

> `sse.onState==='open'` 时的 `loadSessions()` 是**必要的对账**（断线期间可能错过 `idle` 事件，
> 错过就会永远显示"运行中"），且只发**会话树**请求、不重拉历史 —— 不要把它当冗余删掉。

## 7. 自检清单

```bash
source ~/ohos-cli/env.sh; cd ~/src/xbot-harmony
bash tools/tests/run.sh          # 991 断言（含 accent/mdtheme/stars/locale）
bash tools/lint/render-path.sh
bash tools/typecheck/check.sh
~/ohos-cli/deploy.sh             # 构建 → 装机 → 启动 → 截图
```

## 8. 插件系统 parity（2026-10-11 调研，任务2）

### 8.1 web 的机制（权威）

- **一个插件 = 可选的后端 Go 进程（工具/hooks/频道）+ 可选的前端 ESM bundle（UI）**，
  由 `plugin.json` 的一个 id 绑定。
- 加载路径：清单走 **RPC `web_plugin_list`**（服务端 `rpc_table.go`），模块走**静态**
  `/plugins/<id>/web/<entry>`，前端 `await import(...)`（`web/src/plugin-runtime/loader.ts`）。
  **不是** iframe、**不是** `/api/plugins` REST。
- 贡献点 = `plugin-public` 判别联合（`manifest.ts` 的 `contributes`）；**前端是唯一权威门控**
  （后端只做传输层检查）。
- 面板体系 = `panelRegistry`「**一切皆面板**」；内置插件随主 bundle（`entry: 'builtin:*'`），
  第三方按 URL 动态加载。

### 8.2 原生的现状与**真问题**

| 项 | 现状 | 证据 |
|---|---|---|
| `ui_mode` / `ui_libs` | **零渲染消费**（死字段） | `core/render.ets`、`core/types.ets` |
| `ui_surface` | 原生**不落点** | 同上 |
| `WebSurface`（ArkWeb 逃生舱） | **已存在可用**，但**无 JS 桥** | `components/WebSurface.ets`；grep `javaScriptProxy`/`runJavaScript` 零命中 |
| **插件面板打开的是"裸 ESM .js"** | ⛔ 能力面板点某插件 → ArkWeb 显示 **`index.js` 源码** | `core/store.ets` 的 `PluginPanelInfo.url = module_url ?? ${base}/plugins/<id>/web/<entry>`；`pages/Index.ets` 消费 |

> 结论：真问题不是"缺 WebSurface"，而是 **URL 语义错位**（把"模块 URL"当"可导航页面"）+ **无桥**。

### 8.3 落地方案（分波）

1. **波1**：`PluginPanelInfo.url` 语义改为**可导航的插件宿主 URL**（最小实现：`${baseUrl}/`，
   由 web 的 plugin runtime 渲染全部插件面板）。
2. **波2**：`WebSurface` 加 `javaScriptProxy` 桥（原生能力/事件注入宿主页）。
3. **波3**：`web_widgets` / `plugin_widgets` 事件**至少不静默丢**（现状直接忽略）；
   原生 L1 声明式组件渲染为可选增强。

### 8.4 刻意**不由原生实现**的（走 ArkWeb 逃生舱）

GenUI（LLM 生成 TSX 需 `sucrase` + `new Function` ⇒ ArkTS 禁动态求值）、终端（xterm.js）、
文件树 / Monaco / Markdown 预览、Dockview 多面板布局 —— 均在"完整 Web UI"里承载。


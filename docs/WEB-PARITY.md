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
| `WebSurface`（ArkWeb 逃生舱） | **已存在可用**；**协议层 + 原生端 JS 桥已落地**（2026-10-11 波1a），**页面侧待接线** | `components/WebSurface.ets`（`.javaScriptProxy` 注入 `window.xbotNative.postMessage`）；协议层 `core/webbridge.ets`（信封/解析/编码/白名单，可脱机单测 `tools/tests/webbridge.test.ts`） |
| **插件面板打开的是"裸 ESM .js"** | ⛔ 能力面板点某插件 → ArkWeb 显示 **`index.js` 源码** | `core/store.ets` 的 `PluginPanelInfo.url = module_url ?? ${base}/plugins/<id>/web/<entry>`；`pages/Index.ets` 消费 |

> 结论：真问题不是"缺 WebSurface"，而是 **URL 语义错位**（把"模块 URL"当"可导航页面"）+ **无桥**。

### 8.3 落地方案（分波）

1. **波1**：`PluginPanelInfo.url` 语义改为**可导航的插件宿主 URL**（最小实现：`${baseUrl}/`，
   由 web 的 plugin runtime 渲染全部插件面板）。
2. **波2**：`WebSurface` 加 `javaScriptProxy` 桥（原生能力/事件注入宿主页）。
   —— **波1a 已完成原生端 + 协议层**（`core/webbridge.ets` + `components/WebSurface.ets`）；
   **波1b 待办**：① 页面侧监听 `window 'xbot:bridge'` 事件、`JSON.parse(e.detail)`，
   并调用 `xbotNative.postMessage(json)`；② 修 `PluginPanelInfo.url` 的裸 `.js` 语义错位。
   协议契约（信封 / 白名单 / 上限）见 `core/webbridge.ets` 头注释。
3. **波3**：`web_widgets` / `plugin_widgets` 事件**至少不静默丢**（现状直接忽略）；
   原生 L1 声明式组件渲染为可选增强。

### 8.4 刻意**不由原生实现**的（走 ArkWeb 逃生舱）

GenUI（LLM 生成 TSX 需 `sucrase` + `new Function` ⇒ ArkTS 禁动态求值）、终端（xterm.js）、
文件树 / Monaco / Markdown 预览、Dockview 多面板布局 —— 均在"完整 Web UI"里承载。

## 9. 设置「服务端配置面」parity（2026-10-11 调研，任务3 波2）

web 设置弹窗 14 分区中，**偏好层**（appearance/interaction/language）已对齐（§1、任务3 波1）；
余下 **agent / tools / llm / channels / storage / webusers** 是**服务端 RPC 配置面**，原生此前**全无**。

### 9.1 通道结论（决定实现成本）

- 全部走 **`post('/api/rpc', {method, params})`**（web `lib/api.ts`；服务端 `rpc_table.go`）。
- ⚠️ 原生 `core/reqbody.ets` 的 `RpcReq` **只有 `method`、没有 `params`**，且现有两处消费
  （`store.ets:448` `runner_list`、`store.ets:979` `web_plugin_list`）都是**无参** RPC
  ⇒ 必须先加「带 params 的 RPC 请求体 + 统一封装」（本会话新增 `core/rpc.ets`）。

### 9.2 分区 → RPC 速查

| 分区 | 关键 RPC | 权限 | 成本 |
|---|---|---|---|
| `tools` | `get_tools_settings` / `set_tool_enabled` | admin | **S** |
| `llm`（读+启停+默认） | `list_subscriptions` / `list_all_model_entries` / `set_subscription_enabled` / `set_default_subscription` | — | **M** |
| `llm`（完整 CRUD/导入导出） | `add/update/remove_subscription` / `upsert_model` / `remove_model` / `export/import_subscriptions` | — | **L** |
| `agent` | `get_settings` / `set_setting`（namespace `cli`） | — | **S** |
| `storage` | `get_storage_config` / `set_storage_config`（schema 驱动表单） | admin | **M** |
| `channels` | `get_channel_config` / `set_channel_config`（+飞书绑定三件套） | admin | **M~L** |
| `webusers` | `list/create/delete_web_user` | admin | **S**（手机端价值低） |

### 9.2.1 参数契约（**已逐条核对服务端 `serverapp/rpc_table.go`**，勿凭记忆）

| method | params（服务端 struct json tag） | 证据 |
|---|---|---|
| `get_tools_settings` | **无参**，`requireAdmin` 包裹 | `rpc_table.go:699` |
| `set_tool_enabled` | `{name, enabled}`，`requireAdmin` 包裹 | `rpc_table.go:702` |
| `list_subscriptions` | 无参 | `rpc_table.go:815` |
| `list_all_model_entries` | 无参 | `rpc_table.go:754` |
| `set_subscription_enabled` | `{sub_id, enabled}` | `rpc_table.go:672-675` |
| `set_default_subscription` | ⚠️ **`{id, chat_id, channel}`** —— 字段是 **`id`**，**不是** `sub_id`（`chat_id` 为会话；`channel` 缺省回落 `"cli"`，**web 会话必须传 `"web"`**，否则 per-session tenant 映射写到错的 channel 行） | `rpc_table.go:2696-2705`；web 调用点 `web/src/components/agent/api.ts:752` |
| `get_settings` | `{namespace, sender_id}`（原生固定 `namespace='cli'`、`sender_id=''`）→ `Record<string,string>`；服务端会**注入 config 默认值**（如 `allow_self_compact` ← `Cfg.Agent.AllowSelfCompact`） | `rpc_table.go:450-505`（注入默认值 `:501-502`）；web `agent/api.ts:836-841` |
| `set_setting` | `{namespace, sender_id, key, value}` —— **逐键写**。⚠️ 普通 user 级键**无白名单/范围校验**（直接落 `user_settings`）⇒ **取值范围只在客户端把关** | `rpc_table.go:506-544`（落库 `:537`）；web `agent/api.ts:843-845` |

⚠️ **tools 的 MCP 分组坑**：后端字段是 `server_name`，web 曾因 snake/camel 错位导致**分组静默失效**
（`SettingsTools.tsx:44-46` 注释）⇒ 原生必须归一 `server_name → serverName`。

### 9.3 🔴 敏感面（凭据）—— 含一处**服务端疑似遗漏**

| 凭据 | web 回显 | 服务端证据 | 原生要求 |
|---|---|---|---|
| LLM `api_key` | **掩码** `abcd****` | `rpc_table.go:2983` `maskAPIKey` | 只读展示；提交掩码值时发空串 |
| storage secret | **掩码** | `storage_config.go:33-45,75-79` | 同上 |
| Web 账号密码 | **一次性明文**（仅 create 返回） | `rpc_table.go:1935-1943` | 只展示一次，不入日志/偏好 |
| 🔴 **飞书 `app_secret`/`encrypt_key`/`verification_token`** | 明文（仅靠 `type=password` 遮显） | **`channel_config.go:32-39` 未打码** | ⚠️ 原生拉 `get_channel_config` 会拿到**真实 secret**；渲染必须自带遮罩、**绝不**落日志/偏好。**建议向服务端确认这是否为遗漏**（若是，修服务端比客户端绕更划算） |

### 9.4 落地顺序（建议）

`core/rpc.ets`（地基） → `tools` → `llm`（读+启停+默认） → `agent` → `storage` →
`channels`（飞书一键绑定可延后） → `webusers` → `llm` 完整 CRUD/导入导出（最后）。

**进度（2026-10-11）**：
- 已落地：`core/rpc.ets`（`{method,params}` 地基 + method 常量表 + `rpc<T>()`）、
  `tools`（`components/SettingsTools.ets`）、`llm` 读+启停+默认（`components/SettingsLlm.ets`）、
  `agent`（`components/SettingsAgent.ets`，5 个键：`allow_self_compact` + 4 个 `vision_*`）。
- 共用原子在 `components/SettingsRows.ets`（`SettingsToolRow`/`SettingsMcpHead`/`SettingsSubCard`/
  `SettingsNumberRow`/`SettingsChipRow`/`SettingsPanelHeader`/`SettingsErrorBar`）——
  **三个面板跨文件真实引用**它们 ⇒ 进依赖图、被 ArkTS 真编译覆盖（不是孤儿）。
- **唯一待接线**：`components/SettingsPanel.ets`（三面板 tab 聚合，**唯一注入点**）。
  `pages/Index.ets` 注入一行即可：`SettingsPanel({ http: store.http, theme: this.theme })`。

⚠️ 这些面板若都塞进 `pages/Index.ets`（5200 行、**热文件**）会锁死并行度 ⇒ 应各自独立成
`components/Settings*.ets`，`Index.ets` 只做入口注入。

## 10. 用户可见功能面 **差距清单**（2026-10-11 全量调研，任务4 波5）

> 判据：每条都能 `grep` 复核。**已迁移的不重复登记**（通知链路 / JS 桥地基 / 压缩分隔行 /
> 用量环 / 消息导航 / 设置 tools·llm·agent / 强调色·md 主题·星标 / 区域窗口 / 键盘 inset）。
> 状态口径：**已迁** = 有真实实现；**部分** = 有同类能力但缺 web 的形态/交互；**未迁** = 无。
> 「需动哪个文件」列写的是**落地该功能必须碰的**文件（`Index.ets` = 必须接线）。

| web 功能 | 入口 file:line | 现状 | 依赖 | 需动哪个文件 |
|---|---|---|---|---|
| **SubAgent 进度树** | `components/agent/SubAgentProgressTree.tsx:27` | **未迁（数据已全、零渲染）** ⚠️ | 无 | ✅ 已交付 `core/subagent.ets` + `components/SubAgentTree.ets`；接线 `components/MessageRow.ets` |
| Todo 拉出面板 | `components/agent/TodoPullOut.tsx:28` | **已交付纯逻辑+组件（待接线）** —— `core/todos.ets` + `components/TodoPanel.ets`（`dae96fe` 之后的波6）；原状态：只有状态**文本** `core/statusfmt.ets:43,57` | 无 | 接线 `pages/Index.ets`（`@Prop` 契约见 `core/todos.ets` 头注释） |
| Goal 横幅 | `components/agent/GoalBanner.tsx:30` | 部分（`core/statusfmt.ets:72` 的状态行） | 无 | 新增 `components/GoalBanner.ets` + `Index.ets` |
| 消息操作菜单（复制变体/编辑/回退） | `components/agent/MessageActions.tsx:31` | 部分（只有长按整条复制 `core/msgops.ets:11`） | 无 | 扩 `core/msgops.ets` + `Index.ets` 长按菜单 |
| 消息注释/高亮 | `components/agent/MessageAnnotations.tsx:47`、`lib/messageAnnotations.ts:32` | 未迁 | 本地存储 | 新增 `core/msgannot.ets` + 组件 |
| 选区工具条 | `components/agent/SelectionToolbar.tsx:40` | 部分（依赖 tiptap 编辑器） | 无 | **存疑**（原生系统选区是否已够用需真机判断） |
| 图片灯箱 | `components/agent/Lightbox.tsx:21` | **已迁**（`pages/Index.ets:5244` `ImageViewer`） | — | — |
| Mermaid 图 | `components/agent/MermaidDiagram.tsx:54` | 未迁 | mermaid.js | ⛔ **架构不适用** ⇒ ArkWeb |
| GenUI 面板 | `components/agent/GenUIPanel.tsx:36` | 未迁 | `sucrase`+`new Function` | ⛔ **架构不适用**（ArkTS 禁动态求值）⇒ ArkWeb |
| StagingTray（待发暂存区） | `components/agent/StagingTray.tsx:314` | 未迁 | 无 | 新增组件 + `Index.ets` |
| 会话视图条 | `components/session/SessionViewBar.tsx:34` | 未迁 | 无 | 新增 `core/sessionview.ets` + 组件 |
| 新建会话对话框 | `components/session/NewSessionDialog.tsx:34` | 部分 | REST/RPC | `Index.ets` |
| 渠道选择 | `components/session/ChannelPicker.tsx:53` | 部分（`core/sendmode.ets`/`sessiongroup.ets`） | — | **存疑**（手机端是否需要渠道切换） |
| 路径选择（cwd） | `components/session/PathPicker.tsx:36` | 部分（cwd 在 `core/store.ets`，无选择器） | fs RPC | 新增组件 + `Index.ets` |
| 会话搜索 | `components/session/SessionSearch.tsx:36` | **部分**（`core/sessionops.ets:72 sessionMatches` + 命中行 `Store.search` + `Index` 的 `SearchHitsSheet`） | REST | 已够用？待核 |
| 会话项（fork/星标/等待态） | `components/session/SessionItem.tsx:66` | 部分（`core/sessionops.ets` 重排/`stars.ets` 星标） | RPC | — |
| 多标签（tabs） | `lib/sessionTabs.ts`、`hooks/useTabManager.ts` | 未迁 | 无 | **存疑**（手机端价值低） |
| 文件树 / Monaco / Markdown 预览 | `components/sidebar/FileExplorer.tsx:34`、`components/file/MonacoEditor.tsx:138`、`components/file/MarkdownPreview.tsx:86` | 未迁 | fs RPC | ⛔ **架构不适用** ⇒ ArkWeb（`docs/WEB-PARITY.md` §8.4） |
| 终端 | `components/sidebar/TerminalList.tsx`、`lib/terminalWS.ts` | 未迁 | WS | ⛔ **架构不适用**（xterm.js）⇒ ArkWeb |
| 任务面板 | `components/sidebar/TasksPanel.tsx:26` | 未迁 | RPC | 待定（需服务端能力确认） |
| 会话信息面板 | `components/sidebar/SessionInfo.tsx` | 部分（`Index` 的 `StatusSheet`） | — | — |
| Dockview 多面板布局 | `workspace/DockviewContainer.tsx:1` | 未迁 | — | ⛔ **架构不适用** ⇒ ArkWeb |
| 设置 About | `components/settings/SettingsAbout.tsx:92` | 未迁 | 版本号 | 新增 `components/SettingsAbout.ets` + `SettingsPanel.ets`（**S**） |
| 设置 General | `components/settings/SettingsGeneral.tsx:32` | 部分（`Index` 的 `PrefsSheet`） | — | — |
| 设置 Layout | `components/settings/SettingsLayout.tsx:39` | 未迁 | 本地偏好 | **存疑**（原生是否有「面板布局」概念） |
| 设置 Developer | `components/settings/SettingsDeveloper.tsx:20` | 未迁 | — | 新增组件（**S**） |
| 设置 Plugins | `components/settings/SettingsPlugins.tsx:60` | 未迁 | `web_plugin_list` | 等 PluginHost 接线后 |
| 设置 Channels | `components/settings/SettingsChannels.tsx:118` | 未迁 | RPC（admin） | 新增组件（**M**，契约见 §9.2.1） |
| 设置 Storage / WebUsers | `SettingsStorage.tsx:57` / `SettingsWebUsers.tsx:31` | **他人线进行中** | RPC（admin） | — |
| LLM 完整 CRUD / 导入导出 | `components/settings/SettingsLLM.tsx`、`llm-console.tsx` | 未迁（只做了读+启停+默认） | RPC | 新增组件（**L**） |
| 插件面板体系 / 贡献点 | `plugin-api/`、`plugin-runtime/panelRegistry.ts` | 地基已迁（`core/pluginhost.ets` + `core/webbridge.ets`） | RPC+ArkWeb | `pages/Index.ets` 接线 + 修 `PluginPanelInfo.url` 语义（§8.3） |
| 内置插件（git-fancy/git-info/iteration-stats/session-stats/ssh-runner/ambience/skill-manager） | `plugins/*` | 未迁 | — | ArkWeb（`plugins/` 随 web bundle） |
| `web_widgets`/`plugin_widgets` 事件 | `plugins/WidgetZone.tsx` | 未迁，**现状直接忽略** | — | `core/store.ets`（至少不静默丢） |
| Ambience 壁纸/主题 | `ambience/AmbienceRoot.tsx:40` | 未迁 | 本地偏好 | 新增 `core/ambience.ets` + 组件 |
| **命令路由 / 深链**（`xbot://settings.open?section=llm`） | `lib/commandRouter.ts:61` | 未迁 | 无 | 新增 `core/commandrouter.ets`（**纯逻辑、S**） |
| **最近工作目录** | `lib/recent-workdirs.ts:12` | 未迁 | 本地偏好 | 新增 `core/recentdirs.ets`（**纯逻辑、S**） |
| 移动端导航状态 | `lib/mobileNav.ts:26` | 未迁 | — | **存疑**（原生有独立外壳） |
| Web 缓存（TTL） | `lib/webCache.ts:4` | 部分（`core/config.ets` 偏好缓存） | — | **存疑** |
| i18n 文案表（zh/en/ja） | `i18n/index.ts` | 部分（`core/i18n.ets` **只**做 locale 读取；UI 文案硬编码中文） | — | 大重构（100+ 处字符串） |
| PWA / SW 更新提示 | `components/PWAUpdatePrompt.tsx:13`、`UpdateReminder.tsx:27`、`SWUpdateButton.tsx` | ⛔ **不适用** | — | —（无 Service Worker） |
| 注册页 | `pages/RegisterPage.tsx` | 未迁 | REST | **存疑**（登录已迁 `Index.LoginView`） |
| 分享页 | `pages/SharePage.tsx:33` | 未迁 | REST token | 待定（手机端价值待判） |

**结论（给调度用）**：
- 「⛔ 架构不适用」共 6 类（GenUI / Mermaid / 文件树·Monaco·预览 / 终端 / Dockview）——
  **不是遗漏**，应走 ArkWeb 逃生舱（§8.4）。
- 「纯逻辑可独立落地（不碰 `pages/`）」的**现成候补**：`命令路由/深链`、`最近工作目录`、
  `消息注释`、`会话视图条`、`Todo 面板逻辑`、`Goal 逻辑` —— 都是 S 级、可单测。
- 「必须动 `pages/Index.ets` 才能落地」的：Todo/Goal 面板、StagingTray、PathPicker、
  插件接线、设置剩余分区 —— **全部要等 `Index.ets` 释放**。
- 已本波交付的 `SubAgentTree` + `core/subagent.ets` 属**数据已就绪、只差接线**的最高性价比项。

**进度更新（2026-10-11 波6）**：
- ✅ **已交付（纯逻辑 + 组件，待接线）**：`Todo 拉出面板` —— `core/todos.ets`（状态归一 /
  `TodoState` 统计 / toggle·rename·remove / goal 判定 / `set_todos` 载荷）+ `components/TodoPanel.ets`。
- 🔴 **本波发现的原生 bug（未修，不在我的文件范围）**：`core/statusfmt.ets:50` 用
  `status === 'completed'`、`:62` 用 `status === 'in_progress'` 判 todo 状态，**而服务端权威词汇是
  `"pending" | "doing" | "done"`**（`xbot/tools/todo.go:15`、`xbot/protocol/events.go:19`；
  web 侧同为 `done`/`doing`，见 `web/src/hooks/useTodos.ts:37-41`）
  ⇒ 原生「todos N/M」**恒为 `0/N`**、`currentTodo` **恒为空串**（状态行永远不显示当前任务）。
  修法：把 `'completed'`→`'done'`、`'in_progress'`→`'doing'`（或直接复用 `core/todos.ets:todoStatusKind`）。
- 其余未迁项按上表「需动哪个文件」列各自排队；**必须动 `pages/Index.ets` 的都等它释放**。



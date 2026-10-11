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

### 8.5 真实服务器复核（2026-10-11 波1c 后）—— 结论：**目录模型无缺陷，仅图标名差一处**

验证场：`https://xbot.pivotlang.tech`（`plugins.enabled:true`，与本地"插件关闭 ⇒ 目录恒空"对照）。
真实 `web_plugin_list` 快照存 `tools/tests/plugin_remote_payload.ts`，门禁
`tools/tests/plugin_remote_parity.test.ts`（把下面每条钉成回归断言）。

| parity 点 | web 取证 | 原生取证 | 结论 |
|---|---|---|---|
| **① i18n key 必须查表解析** | `plugin-runtime/i18n.ts:98-106`（`resolvePluginText`）+ 回退链 `:38-62`；消费点 `plugins/manager/PluginManagerPanel.tsx:226`、`plugin-runtime/usePluginViewPanels.ts:60` | `core/pluginhost.ets` `resolvePluginText`/`resolveManifestKey`（回退链逐条同构）；`buildPluginCatalog` 对 `name`/`description`/`title` 都调用 | ✅ **已实现**（giver 怀疑的缺陷**不成立**）。真实 payload 的 `name:"manifest.name"` 解析为 `Git 面板`/`GenUI（display_html）`/… |
| **② 只列带 web 的插件** | 服务端 `rpc_table.go:2294-2296` 已过滤；web 消费 `web_plugin_list` | 原生只消费 `web_plugin_list`（`core/store.ets:1042`） | ✅ 一致。真实 6 active 里 `xbot.ambience`/`xbot.qq` 无 web ⇒ 不下发 ⇒ 目录只有 4 |
| **③ module_url 相对 ⇒ 绝对** | `channel/web/web.go:2086-2089` 契约；`module_url` 是 ESM **资源**不是网页 | `absoluteAssetUrl`（拼 `store.http.baseUrl`）；"可打开 URL"恒为 `pluginPanelUrl` = 宿主页根 | ✅ 一致。`module_url` 仅元数据展示，**永不**交给 WebView |
| **④ 图标名解析** | `plugin-runtime/pluginIcons.ts:61-77`：**查表前 `name.toLowerCase()`**（`:63`），未知 ⇒ `Puzzle`（`:76`） | 原先 `components/PluginHost.ets` 直接串比较（**大小写敏感**） | ⚠️ **真实差异**：web 小写化、原生不小写化 ⇒ 清单写 `"Server"` 在 web 命中、在原生降级。**已修**：新增纯函数 `normalizePluginIcon`/`isKnownPluginIcon`（`core/pluginhost.ets`），目录构建即归一化，组件消费归一化值；映射扩到 web `ICON_MAP` 19 键中的 14 键 |

- **`dynamic` 视图**：web `usePluginViewPanels.ts:54` **过滤掉** `view.dynamic`（无静态入口）；
  原生目录**保留**并以"按需"徽标标注（`components/PluginHost.ets:183-188`）—— 这是**有意的**差异
  （目录是"索引"，应让用户看见"存在哪些视图"；诚实标注其不可直开）。
- **`permissions`/`enabled`/`state`**：web 仅在管理面板呈现（`PluginManagerPanel.tsx:223` 状态点）；
  原生目录**只读展示** `state`（非 `active` 才标，`:132-142`），`permissions` **不参与门控**（安全）。
- **RPC 鉴权**：实测该服务器 RPC **不强制** `Origin`/`Referer`（仅需 `xbot_session` Cookie）——
  giver 笔记里的"必须带 Origin 否则 unauthorized"未复现；原生 `core/http.ets:238-247` 只带
  `Cookie` 即可，无需改。

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
| 设置 About | `components/settings/SettingsAbout.tsx:92` | 已迁 | 版本号 + 更新 + 重启 | `components/SettingsAbout.ets` + `core/aboutops.ets`（含 `apply_update`/`restart_server` 两步确认 + 40s 轮询，**S**）；PWA 安装诊断未迁（原生无 PWA 概念） |
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



## 11. 用户可见功能面 **全量差距审计**（2026-10-11 波8 · 任务4 · 只审不改）

> **本节用途**：给「别的 web 功能迁移」提供一份**可排序、可复核**的权威清单（替代零散笔记）。
> 单位 = web 的**用户可见功能**（页面/面板/弹层/交互/关键动作）；基准 = `/Users/bobli/src/xbot/web`；
> 原生 = 本仓 `entry/src/main/ets`。每条都能 `grep` 复核，所有 file:line 均已实际读取。
> **已迁项不重复登记**（通知链路 / JS 桥地基 / 压缩分隔行 / 用量环 / 消息导航 / 通知行🔔 /
> 设置 tools·llm·agent·storage·webusers·about·account / 强调色·md 主题·星标 / 区域窗口 /
> 键盘避让 / SubAgent 树 / Todo 面板 / Goal 横幅 / 图片灯箱 / 会话分组·分类·折叠 / 输入附件）。
> 状态口径：**✅ 已有**（真实实现 + 已接线）| **🟡 部分**（有同类能力，缺子项/形态）|
> **❌ 缺**（原生搜不到实现，附搜索证据）| **⚪ 刻意不适用**（架构性，走 ArkWeb 逃生舱）。

### 11.1 A 域：聊天 / 消息 / Agent 呈现

| web 功能 | web file:line | 状态 | 原生 file:line / 证据 |
|---|---|---|---|
| 用户消息气泡（含编辑态） | `components/agent/UserMessage.tsx:49`（编辑态 `:170-213`） | ✅ | `components/UserBubble.ets:23`（接线 `Index.ets:4960`，长按 `:4963`） |
| 助手消息 | `components/agent/AssistantMessage.tsx:195` | ✅ | `components/MessageRow.ets:435`（空回复 `:971` EmptyNotice） |
| 消息操作菜单（复制变体/链接/复制选区） | `MessageActions.tsx:213,286-299` | ✅ | `Index.ets:4908-4938` CtxItem；入口 `UserBubble.ets:70`、`MessageRow.ets:551` |
| **消息编辑并重发/回退**（rewind） | `UserMessage.tsx:31,114,149,315`、`workspace/panels/AgentPanel.tsx:929` | ❌ | 见 11.5 证据 ① |
| **消息注释/高亮** | `MessageAnnotations.tsx:47,267`（`AgentPanel.tsx:1044`） | ❌ | 见 11.5 证据 ② |
| **选区工具条**（tiptap 富文本 B/I/链接） | `SelectionToolbar.tsx:48`（`MessageInput.tsx:845`） | ❌ | 见 11.5 证据 ③ |
| **Synthetic/Interrupt 卡** | `SyntheticToolCard.tsx:393,568` | ❌ | 见 11.5 证据 ④ |
| **ShellPromoteBar** | `ToolRender.tsx:483` | ❌ | 见 11.5 证据 ⑤ |
| **AnsiText**（ANSI SGR 终端着色） | `AnsiText.tsx:205`（3 消费点） | ❌ | 见 11.5 证据 ⑥ |
| 图片灯箱 | `Lightbox.tsx:21,31` | ✅ | `Index.ets:5979` ImageViewer + `core/imgops.ets` |
| Markdown 渲染 | `MarkdownRenderer.tsx:530` | ✅ | `components/MarkdownView.ets:101` + `core/markdown.ets` |
| 代码高亮 / CodeView | `CodeView.tsx:30`、`highlight.ts:22` | ✅ | `core/highlight.ets:136`（prism4j） |
| DiffView | `DiffView.tsx:148` | ✅ | `core/diffparse.ets:66` + `components/ToolPopover.ets:321` |
| 工具调用块（pill + 浮层） | `ToolCallBlock.tsx:77`、`ToolRender.tsx:126` | ✅ | `components/ToolVisual.ets:60` + `ToolPopover.ets:168` |
| 折叠工具组 | `FoldedToolGroup.tsx:716` | 🟡 | 有跨迭代合并 `MessageRow.ets:330`、`+N` 溢出 `:738`；**缺**组内按 kind 分组标头 |
| 迭代历史/Live/TurnBody | `IterationHistory.tsx:31`/`LiveIteration.tsx:37`/`TurnBody.tsx:969` | ✅ | `MessageRow.ets:566,607` + `core/render.ets` |
| ReasoningBlock | `ReasoningBlock.tsx:21` | ✅ | `LiveTailView.ets:49` + `ThinkingLine.ets:24` |
| ShimmerThinking | `ShimmerThinking.tsx:10` | 🟡 | 等价物=「思考中…」占位 + `AssistantOrb.ets`（形态不同，非缺失） |
| 压缩分隔行 | `CompactionDivider.tsx:30` | ✅ | `MessageRow.ets:868` + `core/compaction.ets:39` |
| 区域分隔 / 按需取回 | `RegionsDivider.tsx:42`、`useRegionWindow.ts:55` | ✅ | `MessageRow.ets:440-460` + `Index.ets:5127` |
| AskUser | `AskUserPanel.tsx:39` | ✅ | `Index.ets:5905` AskUserSheet |
| Todo 拉出面板 | `TodoPullOut.tsx:28` | ✅ | `components/TodoPanel.ets:238`（`Index.ets:3212`） |
| Goal 横幅 | `GoalBanner.tsx:30` | ✅ | `components/GoalBanner.ets:55`（`Index.ets:3165`） |
| SubAgent 进度树 | `SubAgentProgressTree.tsx:27` | ✅ | `components/SubAgentTree.ets:177`（`MessageRow.ets:591,659`） |
| StagingTray（排队消息暂存） | `StagingTray.tsx:314`（`AgentPanel.tsx:1094`） | 🟡 | `Index.ets:5795` QueueSheet；**缺** interject(插队)/clear/拖拽重排 |
| 消息导航（用户消息跳转） | `MessageUserNav.tsx:60` | ✅ | `components/MessageNav.ets:147`（`Index.ets:2964`） |
| MessageInput + 补全（`/`、`@`） | `MessageInput.tsx:173`、`CompletionPopup.tsx:21` | ✅ | `Index.ets:2725,3059` + `core/composer.ets:28-131` |
| 输入附件（文件/图片/粘贴） | `MessageInput.tsx:198-332` | ✅ | `Index.ets:1692-1802` + `core/attach.ets` |
| ModelSelector | `ModelSelector.tsx:28` | ✅ | `Index.ets:5477` ModelSheet |
| ThinkingModeControl（composer 内档位） | `ThinkingModeControl.tsx:68` | 🟡 | 四档逻辑在 `components/SettingsLlm.ets`（**设置页**，非 composer） |
| ContextRing | `ContextRing.tsx:22` | ✅ | `components/ContextRing.ets:44` + `core/ctxring.ets`（`Index.ets:2999`） |
| 消息列表虚拟化 | `MessageList.tsx:392` | ✅ | `Index.ets:2901` LazyForEach（ArkUI 自动测量，rowHeightMemory 不适用） |
| 通知行 🔔（notification turn） | `chat/reduce.ts:596-620` | ✅ | `core/reduce.ts:604-620`（`isNotification`） |
| GenUI 面板 | `GenUIPanel.tsx:36` | ⚪ | sucrase + `new Function()` 不可移植 ⇒ ArkWeb（`WebSurface.ets:52`） |
| Mermaid 图 | `MermaidDiagram.tsx:90` | ⚪ | 走 ArkWeb（`core/markdown.ets:8` 明确排除） |

### 11.2 B 域：会话管理 / 侧栏 / 面板 / 导航 / 公开页

| web 功能 | web file:line | 状态 | 原生 file:line / 证据 |
|---|---|---|---|
| 会话列表容器 | `components/session/SessionList.tsx:80` | ✅ | `Index.ets:5154` DrawerSheet（`:5213` List） |
| 会话分组（折叠/组头/计数） | `SessionGroup.tsx:43` | ✅ | `Index.ets:5215-5235` + `core/sessiongroup.ets:422` |
| 分类切换（项目/状态/时间） | `lib/session-grouping.ts` | ✅ | `core/sessiongroup.ets:38` + `Index.ets:5196` |
| 会话项（星标/运行点/渠道徽标） | `SessionItem.tsx:66`（星标 `:207`、状态点 `:181`） | ✅ | `Index.ets:5274-5303` + `core/stars.ets` |
| 会话菜单（置顶/上移/下移/改名/分支/删除） | `SessionItem.tsx:276-316` | ✅ | `Index.ets:4828` SessSheet + `:3483 runSessAction` + `core/sessionops.ets:23` |
| 会话排序（星标→sort_order→时间） | `lib/session-grouping.ts` | ✅ | `core/sessiongroup.ets:601-609` + `core/stars.ets starredFirst` |
| 空状态 | `SessionEmptyState.tsx:16` | ✅ | `Index.ets:2827-2843` |
| 会话搜索（本地筛选 + 服务端搜消息） | `SessionSearch.tsx:36` | ✅ | `Index.ets:5174`（筛选）/`:4113 runSearch`/`:4855 SearchHitsSheet` |
| 新建会话对话框（渠道 + cwd + label） | `NewSessionDialog.tsx:34` | 🟡 | 原生**无对话框**：`Index.ets:1663 newSession()` 直接 `createSession()`（默认渠道/无 cwd/无 label） |
| 渠道选择/过滤（列表按渠道过滤） | `ChannelPicker.tsx:73` | 🟡 | 徽标 ✅（`core/sessionpick.ets:34`）；**过滤 ❌** 见 11.5 证据 ⑦ |
| 路径选择 cwd（输入 + 最近目录） | `PathPicker.tsx:36` | ❌ | 见 11.5 证据 ⑦ |
| 会话视图条（+「全部折叠/展开」） | `SessionViewBar.tsx:34` | 🟡 | 分类切换 ✅ `Index.ets:5196`；**全部折叠/展开 ❌** |
| 会话信息面板（cwd 可编辑/消息数/最后活跃） | `components/sidebar/SessionInfo.tsx:40` | 🟡 | `Index.ets:5643 StatusSheet`；缺 cwd 编辑/消息数/最后活跃 |
| 任务面板（cron + 后台任务 + runner） | `components/sidebar/TasksPanel.tsx:26` | ✅ | `Index.ets:4716 PanelsSheet` + `core/panels.ets` |
| 文件树 / 文件搜索 | `sidebar/FileExplorer.tsx:34` / `FileSearch.tsx:26` | ⚪ | fs RPC + 编辑器 ⇒ ArkWeb（`WebSurface.ets:54`） |
| 终端列表 | `sidebar/TerminalList.tsx:35` | ⚪ | xterm.js ⇒ ArkWeb |
| 左右 ActivityBar / Dockview 工作区 | `sidebar/LeftActivityBar.tsx:23`、`panel/PanelLayout.tsx:439` | ⚪ | 桌面范式；原生用会话标签栏替代（`Index.ets:3101`） |
| 移动端外壳 / 多标签 | `layouts/MobileAppShell.tsx:106`、`hooks/useTabManager.ts:125` | 🟡 | 原生即移动端（抽屉 + Sheet）；多标签 = 会话池标签条 `Index.ets:3101-3132` |
| 登录页 | `pages/LoginPage.tsx:18` | ✅ | `Index.ets:2557 LoginView` |
| 注册页 | `pages/RegisterPage.tsx:26` | ✅ | `Index.ets:1438 store.http.register` |
| **分享页**（token 只读分享） | `pages/SharePage.tsx:33` | ❌ | 见 11.5 证据 ⑧ |
| **会话导出**（markdown/jsonl） | `SettingsDeveloper.tsx:60`、`agent/api.ts:332` | ❌ | 见 11.5 证据 ⑧ |

### 11.3 C 域：设置全分区 / 插件体系 / 其它

| web 功能 | web file:line | 状态 | 原生 file:line / 证据 |
|---|---|---|---|
| 设置容器（14 分区 nav） | `settings/SettingsDialog.tsx:117-131` | ✅ 等价 7-tab | `components/SettingsPanel.ets:46 settingsTabs()`（分派 `:111-127`） |
| ├ General（locale + 清除缓存） | `settings/SettingsGeneral.tsx:32` | 🟡 | `Index.ets:4508` PrefsSheet（locale **只读**；**无清缓存**） |
| ├ Appearance（主题/md/accent/UI_MODE） | `settings/SettingsAppearance.tsx:54` | 🟡 | PrefsSheet；**缺 UI_MODE 外壳切换**（`KEY_UI_MODE` 死字段） |
| ├ Interaction（发送键 / 换行） | `settings/SettingsInteraction.tsx:21` | ✅ | `Index.ets:4508` PrefsSheet |
| ├ Language | `SettingsDialog.tsx:115,177` | 🟡 | 刻意只读（文案硬编码，见 §3） |
| ├ Agent | `settings/SettingsAgent.tsx:113` | ✅ | `components/SettingsAgent.ets` |
| ├ Tools | `settings/SettingsTools.tsx:35` | ✅ | `components/SettingsTools.ets` |
| ├ LLM（读/启停/默认/CRUD/档位/思考） | `settings/SettingsLLM.tsx:78`、`llm-console.tsx` | 🟡 | `components/SettingsLlm.ets`（含 CRUD）；**缺 import/export_subscriptions** |
| ├ **Channels**（飞书/插件渠道 + 一键绑定） | `settings/SettingsChannels.tsx:118` | ❌ | 见 11.5 证据 ⑨ |
| ├ Storage | `settings/SettingsStorage.tsx:57` | ✅ | `components/SettingsStorage.ets` |
| ├ WebUsers | `settings/SettingsWebUsers.tsx:31` | ✅ | `components/SettingsWebUsers.ets` |
| ├ Account（用户名 + 登出） | `SettingsDialog.tsx:69` | ✅ | `components/SettingsAccount.ets` |
| ├ **Developer**（SSE REC + 导出） | `settings/SettingsDeveloper.tsx:20` | ❌ | 见 11.5 证据 ⑩ |
| ├ Layout（slot 配置） | `settings/SettingsLayout.tsx:39` | ⚪ | Dockview 专属 |
| ├ Plugins（配置表单 + 图标上传） | `settings/SettingsPlugins.tsx:60` | 🟡 | `components/PluginHost.ets` 只读目录；缺 `plugin_config_set` |
| └ About（版本 + update + **应用内更新/重启**） | `settings/SettingsAbout.tsx:92` | ✅ | `components/SettingsAbout.ets` + `core/aboutops.ets`（apply_update/restart_server 两步确认 + 40s 轮询；release notes 外链可点） |
| 插件目录 + 宿主页运行时 | `plugin-runtime/loader.ts` | ✅ | `components/PluginHost.ets` + `core/pluginhost.ets:573`（裸 `.js` 语义**已修**） |
| 插件管理面板（启停/配置） | `plugins/manager/PluginManagerPanel.tsx` | 🟡 | 原生只读目录 |
| **web_widgets / plugin_widgets 事件** | `plugins/PluginWidgetProvider.tsx:51` | ❌ **静默丢** | `core/types.ets:236-237` 仅两个常量，`core/store.ets onSse` 无消费（§8.3 波3） |
| **InfoBar**（插件状态条） | `plugins/InfoBar.tsx:15` | ❌ | 无对应组件 |
| **Ambience 壁纸/主题**（玻璃化） | `ambience/AmbienceRoot.tsx:53`、`store.ts` | ❌ | 见 11.5 证据 ⑪ |
| PWA / SW 更新提示 | `PWAUpdatePrompt.tsx:13`、`UpdateReminder.tsx:27` | ⚪ | 无 Service Worker |
| 内置插件（git-fancy/git-info/iteration-stats/session-stats/ssh-runner/skill-manager） | `plugins/*` | ⚪ | 随 web bundle ⇒ ArkWeb（§8.4） |

### 11.4 D 域：横切（命令路由 / 快捷键 / 通知 / 缓存 / i18n）

| web 功能 | web file:line | 状态 | 原生 file:line / 证据 |
|---|---|---|---|
| **命令路由 / 深链**（`xbot://settings.open?section=llm`） | `lib/commandRouter.ts:32,61,171` | ❌ | 见 11.5 证据 ⑫ |
| **最近工作目录** | `lib/recent-workdirs.ts:12` | ❌ | 见 11.5 证据 ⑦ |
| **SSE 录制调试工具**（REC → .ev） | `hooks/useSSERecorder.ts:30`、`workspace/panels/DebugToolbar.tsx:20` | ❌ | 见 11.5 证据 ⑩ |
| 键盘快捷键分发（keybinding） | `lib/commandRouter.ts:160` | ⚪ | 手机端无物理键盘（发送键例外，已迁 `KEY_SEND_KEY`） |
| Web 缓存（TTL） | `lib/webCache.ts:4` | 🟡 | `core/config.ets` 偏好缓存（语义近似，非同一实现） |
| i18n 文案表（zh/en/ja 切换） | `i18n/index.ts` | 🟡 | `core/i18n.ets` 只读 locale（文案硬编码 ~100 处，见 §3） |
| 主题（md 主题驱动 dark/light + accent） | `providers/theme.tsx` | ✅ | `core/theme.ets`（5 套应用色板）+ `core/accent.ets` + `core/mdtheme.ets` |
| 开发者模式（Rec 按钮显隐） | `hooks/useDeveloperMode.ts:1` | ❌ | 见 11.5 证据 ⑩ |

### 11.5 ❌ 缺项的**可证伪**证据块（搜索命令 + 结论，均在 `entry/src/main/ets` 下执行）

- ① **消息编辑/重发/回退**：`grep -rniE "onRewind|editMessage|resend|重发|编辑并" .` → 仅命中 `core/streammerge.ets`/`core/reduce.ts` 的**状态机注释**（无 UI）。结论：无编辑/回退入口。
- ② **消息注释/高亮**：`grep -rni "annotation" .` → **0 命中**。
- ③ **选区工具条**：`grep -rniE "bubblemenu|tiptap" .` → **0 命中**。（`MarkdownView.ets` 的 "Selection" 实为 AskUser 选择项，`Index.ets:107 AskSelection`。）
- ④ **Synthetic/Interrupt 卡**：`grep -rni "synthetic" .` → 仅 `core/agent_normalize.ts:166` 注释；`grep -rniE "interruptcard|打断卡" .` → **0**。
- ⑤ **ShellPromoteBar**：`grep -rni "promote" .` → **0 命中**。
- ⑥ **AnsiText**：`grep -rniE "ansi|sgr|\\\\u001b|\\\\x1b" .` → **0**（早前误报的匹配是 `transient`/`humanSize`/`statusGroupKey` 等词）。`ToolPopover.ets:96 classifyLine` 只做行级分类，**不解析 ANSI SGR**。
- ⑦ **渠道过滤 / 路径选择 / 最近工作目录**：`grep -rniE "channelpicker|availableChannels|渠道选择" .` → 0；`grep -rniE "PathPicker|pickDir|chooseDir" .` → 0；`grep -rniE "recent" .` → 8 命中**全是** `core/config.ets:117 recentServers`（服务器 URL 历史）。
- ⑧ **分享页 / 会话导出**：`grep -rniE "SharePage|分享页|shareToken|share_link" .` → 0；`grep -rniE "导出|exportSession|systemShare|shareKit" .` → 仅 `core/http.ets:150 exportSessionCookie`（cookie，**非**会话导出）。
- ⑨ **Channels 设置分区**：`grep -rn "get_channel_config\|set_channel_config\|feishu_bind" core components` → **0 命中**（`core/settings.ets:286 CONFIG_SURFACE_METHODS` 亦未含）。契约见 §9.2.1。
- ⑩ **Developer 模式 / SSE 录制**：`grep -rniE "useDeveloperMode|sseRec|录制|recorder" core components pages` → **0 命中**。
- ⑪ **Ambience**：`grep -rln "ambience\|wallpaper" .` → 仅 `core/pluginhost.ets:240` 的**注释**；无 `core/ambience.ets`、无组件。
- ⑫ **命令路由/深链**：`grep -rniE "xbot://|commandrouter|settings\.open" .` → **0 命中**。原生唯一外部入口是**通知点击**（`entryability/EntryAbility.ets:123 captureOpenChat`，仅 chatId）。

### 11.6 ⚠️ 死代码甄别（web 有、但**不算功能**，不要列为"web 有原生没有"）

| 文件 | 证据（全仓 import 扫描） | 结论 |
|---|---|---|
| `components/agent/ContextBar.tsx:32` | 仅 `ContextBar.test.tsx` 引用 | 死代码 |
| `components/agent/CollapsibleCard.tsx:39` | 全仓 0 引用（含测试） | 死代码（本轮新发现） |
| `components/sidebar/LeftActivityBar.tsx:23` | 仅自身；无对应 test | 死代码 |
| `components/sidebar/RightActivityBar.tsx:55` | 仅 `dragState.ts`/`reorder.ts` 的**注释** | 死代码 |
| `components/sidebar/SidebarSectionStack.tsx:64` | 仅注释引用 | 死代码 |
| `plugins/PluginComponentPanel.tsx`、`plugin-runtime/ViewSlot.tsx` | 无 import（仅文档注释提及） | 疑似死代码 |

> ⚠️ **反例（不是死代码）**：`plugins/*/index.tsx`（git-fancy/genui/ssh-runner/iteration-stats）无静态 import，但由 `plugin.json` 的 `entry` 字符串**动态 `import()`** 加载（`plugin-runtime/loader.ts`）⇒ 运行时引用，勿误删。

### 11.7 Top 10 推荐迁移顺序（用户价值 × 实现成本）

| # | 功能 | 为何先做（一句） | 预估改动面（文件） |
|---|---|---|---|
| 1 | **AnsiText**（ANSI 着色） | 工具/终端输出是最高频呈现面，原生现把 shell 输出当纯文本 ⇒ 颜色语义全丢；纯函数、可脱机单测 | 新增 `core/ansi.ets`（纯逻辑）+ `MessageRow.ets`/`ToolPopover.ets` 接色 |
| 2 | **消息编辑并重发/回退（rewind）** | 唯一能改写历史错字的操作；原生状态机已具备 rewind 语义，属**接线级**投入 | `core/store.ets`（rewind REST）+ `Index.ets` 长按菜单 + `UserBubble.ets` |
| 3 | **web_widgets/plugin_widgets 不静默丢** | 已连接的协议数据被**无声丢弃**（用户可见内容到达客户端却消失）⇒ 正确性缺口，S 级 | `core/store.ets onSse` + 一个只读渲染面（`PluginHost.ets` 或状态条） |
| 4 | **StagingTray interject/clear** | 排队消息高频交互；`interject`（插队）所需 WS interrupt **已存在** | `Index.ets:5795 QueueSheet` + `core/store.ets`（队列操作） |
| 5 | **渠道过滤 ChannelPicker** | 唯一「数据已就绪但无 UI」项（`core/sessionpick.ets:20/34` 现成） | `Index.ets` DrawerSheet 加筛选态 + `filteredSessions` |
| 6 | **SessionViewBar「全部折叠/展开」** | 折叠机制/组键齐备，只差批量入口，XS | `Index.ets`（`toggleGroup`/`isGroupCollapsed` 之上加一个全量切换） |
| 7 | **Developer 模式 + SSE REC** | 排障/复现 bug 的刚需（契合「真机点击是移动靶」痛点）；纯本地偏好，S 级 | 新增 `components/SettingsDeveloper.ets` + `SettingsPanel.ets` 加 tab |
| 8 | **Channels 设置分区** | web 14 分区中原生**唯一整块缺席**的服务端配置面，落地即 13/14 | 新增 `components/SettingsChannels.ets` + `SettingsPanel.ets` 加 tab（契约见 §9.2.1；⚠️ 飞书 secret 服务端未打码，见 §9.3） |
| 9 | **会话导出（markdown/jsonl）** | ❌ 缺口中通用价值最高；手机端分享/上报会话常用 | `core/`（导出纯逻辑）+ `Index.ets` 入口 + `SettingsDeveloper`/分享 |
| 10 | **最近工作目录 + PathPicker** | 新建会话选 cwd 是常规操作；`recent-workdirs` 纯逻辑 S 级 | 新增 `core/recentdirs.ets` + `NewSessionDialog` 等价弹层 |

> 次优先（形态差异，非硬缺口）：FoldedToolGroup 组内分组标头、ShimmerThinking 骨架、ThinkingModeControl 位置、
> 消息注释/高亮、选区工具条、分享页。**不建议迁**：Ambience（与「玻璃必须锁深色」及无 CSS 级联冲突）、
> panelRegistry/Dockview/Layout（桌面范式）。

### 11.8 原生**独有**资产（web 没有的 —— 用户要「比 web 更好」的家底）

| 资产 | 原生 file:line | 为什么是资产（web 无） |
|---|---|---|
| 应用图标 + 开屏（startWindow） | `resources/base/media/app_icon.svg`、`start_icon.png`、`module.json5:16-19`、`docs/BRAND.md` | web 是浏览器标签页，无应用图标/开屏 |
| **系统通知**（回合结束 / 等待回答）+ 点击回会话 + 前台抑制 + 未读角标 | `core/notify.ets`、`entryability/EntryAbility.ets:38-42,104-141` | web 无系统通知（仅会话内通知行 🔔） |
| 返回键关「最上层浮层」（= web 的 Esc） | `core/overlays.ets`、`Index.ets:901-942` | 鸿蒙返回键等价物；web 靠 Esc |
| 键盘 RESIZE 避让（不推整页、输入框常驻可见） | `entryability/EntryAbility.ets:70-75` | web 靠 viewport contract |
| 系统表面随主题（colorMode + 状态栏/导航栏前景） | `EntryAbility.ets:23-37,76-81` | 系统绘制表面的明暗，web 无此层 |
| **助手光球**（旗舰在飞指示，真实信号驱动） | `core/orb.ets` + `components/AssistantOrb.ets`（`LiveTailView.ets`） | web 只有 `ShimmerThinking` 文字扫光 |
| 图片查看器手势（捏合缩放/平移/双击）+ **存相册** | `Index.ets:5979-6065` + `core/imgops.ets` | web Lightbox 无手势、无存相册（SaveButton 系统授权） |
| 粘贴板图片**直接转附件** | `Index.ets:1768-1802` | — |
| 系统文件/图片**选择器**（Document/PhotoViewPicker） | `Index.ets:1692-1722` | web 用 `<input type=file>` |
| 多会话**池**（切换瞬时、后台进度累积） | `Index.ets` poolOrder/switchSession + `core/store.ets` | web 靠 dockview tab + SSE 重连 |
| **渲染自检面板**（逐构件隔离排查） | `Index.ets:5695 SelfCheckSheet` | web 无 |
| 应用自带 **5 套色板**（dark/light/aurora/nebula/porcelain） | `core/theme.ets:102 ALL_THEMES`、`:94-98` | web 走 md 主题的 dark/light 派生；应用级 5 色板切换为原生独有 |

### 11.9 本波结论 / 给调度

- **最高性价比的第一条（推荐下一波派）**：**AnsiText（ANSI 着色）** —— 纯逻辑、可脱机单测、
  不碰 `pages/Index.ets` 即可交付 `core/ansi.ets`，却是最高频呈现面的颜色语义补全；
  且可独立于热文件推进（`Index.ets` 当前被多条线占用）。若调度更看重「核心交互」，
  则第二条 **消息编辑/重发/回退（rewind）** 价值更高但须动 `Index.ets`。
- **必须动 `pages/Index.ets` 才能落地**的：消息编辑/回退、StagingTray 补齐、渠道过滤、
  全部折叠/展开、会话导出入口、Changelog/设置 tab 注入 —— **全部排在 `Index.ets` 释放之后**。
- **纯逻辑可先行的候补**（不碰 `pages/`）：AnsiText、最近工作目录、命令路由、消息注释。
- **§10 的两处状态已过时**（本轮复核更正）：`§10` 表把「任务面板」记为未迁，实际已由
  `Index.ets:4716 PanelsSheet` 覆盖；把「会话视图条」记为未迁，实际分类切换已迁（`Index.ets:5196`）。
  另 `§8.3 波1b②` 的「修 `PluginPanelInfo.url` 裸 `.js` 语义」**已完成**（`core/pluginhost.ets:573`）。

## 12. live 呈现面 **语义分歧审计**（2026-10-11 波9 · 只审不改）

> 沿用户亲报的两个 bug 的**三类失败模式**做审计：①同一状态被**两处判据**解释；②按**位置/键不稳定**合并；
> ③**陈旧快照覆盖新状态**。方法：**web 为权威判据**，逐条给 两侧 file:line + 可证伪复现 + 严重度。
> **不重复**已知在修项（`core/{streammerge,toolstatus}` 的 rank/generating/去重键；`LiveTailView`+`ThinkingLine` 的两处动效）。
> 严重度：**P0** 用户可见且误导 ｜ **P1** 视觉/语义不一致 ｜ **P2** 边角/结构。
> ⚠️ 本轮为**只读**审计，未改任何产品代码。

| # | 模式 | 原生 file:line | web file:line | 分歧点 | 可证伪复现 | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|---|
| A | 同一状态两处判据 | `LiveTailView.ets:319-335`(badge)/`:337-349`(color)/`:375-380`(popVM) | `FoldedToolGroup.tsx:157` + `:194-214` | live 工具**浮层**用自带 raw-status 的 `badge()/color()`，而 pill 用 canonical `statusChip`/`statusColorOf` ⇒ 同一工具两处结论相反 | `color('killed')===successText`(绿) 而 `statusColorOf(ST_KILLED)===textMuted`；`badge(running)==='1.2s'` 而 `statusChip(ST_RUNNING)==='执行中'` | **P0** | popVM 改调 `statusChip(kind,…)`+`statusColorOf`；删 `badge/color/label`（`label()` 无消费者） |
| B | 按键/位置合并 | `core/render.ets:167-173` | `LiveIteration.tsx:157-179` | live 工具列表 = `activeTools ++ streamingTools`，**未按 toolKey 去重、未剔除已完成迭代里的同名工具**（web 两步都做）⇒ 「同一工具两行」在 live 面复现 | 某工具同时在 `activeTools`(陈旧) 与 `iterationHistory` ⇒ 原生渲染 2 枚 pill，web 1 枚 | **P0** | 复用 `streammerge.toolKey/mergeTools`，并滤掉 `completedIterToolKeys` |
| C | 同一状态两处判据 | `core/toolstatus.ets:56-58`；`LiveTailView.ets:125-144` | `statusVisual.ts:20-22`；`LiveIteration.tsx:180,186`；`FoldedToolGroup.tsx:157-158` | **`pending` 的「在飞」归属相反**：web `isToolInProgress` 含 `pending`，原生 `isLiveStatus` 不含 ⇒ 思考领读/光球模式与折叠组在 pending 窗口与 web 相反 | 全工具 pending + reasoning>0 + text==='' ⇒ 原生 `thinkingIsPrimary()===true`，web `reasoningInProgress===false` | **P1** | 给「思考领读/组观感」单独一个含 pending 的判据（与 web 同源） |
| D | 陈旧/权威 | `core/store.ets:709-724` | `AssistantMessage.tsx:104-117`；`useRegionWindow.ts` | 区域取段游标**无洞检测**：原生恒取本 turn 最小迭代号，web 取「洞上边界(`gapTop`)」 | `iterations=[1..40]∪[52..90]` ⇒ web 请求 `before=52`、原生 `before=1`（拿到空段，洞永不闭合） | **P1** | `loadEarlierRegions` 增洞检测取上边界，并把 `gapTop` 透传/驱动自动追赶 |
| E | 同一状态两处判据 | `core/integrate.ts:385`；`core/reduce.ts:781`；`pages/Index.ets:2929` | `MessageList.tsx:1679-1686`；`AssistantMessage.tsx:158-163` | `phase==='compressing'` **无任何 UI 消费者** ⇒ 压缩期原生恒显示「思考中…」，web 显示「正在压缩上下文…」 | `grep -rn "compressing" entry/src/main/ets` → 仅注释；`showsBusyPlaceholder` 不看 phase | **P1** | 占位/`LiveTailView` 接 `liveProgress().phase`（web 同款） |
| F | 陈旧快照覆盖新状态 | `pages/Index.ets:1050`；`store.ets:904` | `usePendingEdit.ts:57-95`；`AgentPanel.tsx:691-692` | goal/todos **无乐观覆盖层**：用户勾选/改名后若一条旧 progress 快照先到，UI 回退旧清单（web 有 begin/commit/discard+序号防乱序） | 造 `snapshot=OLD` → `commit(NEW)` → 再喂 `OLD`：web 保 NEW；原生无该函数 | **P1** | `core/` 加 `usePendingEdit` 等价纯逻辑，Index 用覆盖值渲染 |
| G | 同一信息两处口径 | `pages/Index.ets:2200-2201` | `AskUserPanel.tsx:37,69,84` | AskUser 答案键/拼接口径不同：web 用**下标** `String(i)`、多选 `、`；原生用 `q.id`(缺省 `q{i}`)、多选 `, `、并塞 `；other` | 键集合：web `{"0":…}` vs 原生 `{"<q.id>":…}`；分隔符 `、` vs `, ` | **P1** | ⚠️ 先核 `agent` 端 `AskUserResponse.Answers` 的匹配语义（服务端单答兜底 key 竟是 `"1"`），再对齐 |
| H | 同一信息两处口径 | `pages/Index.ets:1052,1858-1860,3012,5663`；`core/statusfmt.ets`(goalText 读 `g.text`) | `MessageInput.tsx:694,730`；`GoalBanner.tsx:30` | 同一 goal 两源：状态栏/`StatusSheet` 读 `store.goal`(`.text`，**全仓无赋值点** ⇒ 恒空)，横幅读 `liveProgress().goal`(`.objective`) ⇒ 「详情」入口在只有 goal 无 todo 时**消失** | `goalText({text:'x'})===''` 而横幅正常显示 | **P1** | `goalLine/StatusSheet` 改读 `objective`；`详情` gating 同源（该缺陷已在 `statusfmt.ets` 头注记录、未修） |
| I | 键不稳定 | `components/LiveTailView.ets:568` | `FoldedToolGroup.tsx:557` | live pill 的 `ForEach` key 含 `t.status`（`lt-${i}#${name}#${status}`）⇒ 状态每翻一次 key 变、销毁重建（打开中的浮层被拆、selected 复位）；web key 与状态无关 | 仅把某枚 status `running→done` ⇒ 原生 key 变、web 不变 | **P1** | key 去掉 `status`（用 `call_id` 或 `name-i`） |
| J | 顺序/不变量 | `core/indicators.ets:56-58`；`core/streammerge.ets:394-397` | `MessageList.tsx:640-650` | 迭代边界空隙**多画一个「思考中…」**：web 用 `!tailIsLiveRow` 抑制（否则与上方「思考 N 字」自相矛盾），原生缺该项 | `showsBusyPlaceholder({tailShowsIndicator:false,localBusy:true,rowsLength:5})` 原生 `true`、web `false` | **P1** | ⚠️ **需仲裁**：原生注释称用户 2026-10-10 点名要求显示 ⇒ 与 web 判据相反，二者定一 |
| K | 状态迁移丢失 | `components/LiveTailView.ets:76,466-479`；`MessageRow.ets:591-596` | `ThinkingLine.tsx:32,49-51`；`IterationHistory.tsx:56-59` | 「思考展开态」commit 时不迁移：web 让 live↔committed 共用 `reasoningKey(turnID,iteration)`；原生 live 是无键局部 `@State`、committed 另一套键 | 展开 live 思考 → 等迭代 commit → 展开态回 `false` | **P1** | 页面持一份 `turnID:iteration → open` 共享键，live/committed 共用 |
| L | 同一信息两处口径 | `core/ctxring.ets:113-123`(K) vs `core/statusfmt.ets:26-37`(k/`.0`) | `ContextRing.tsx:12-16` | 同一 token 数两套格式：环=`50K`（大写、整千无小数），状态条=`50.0k`（小写、<100000 留 `.0`）；web 两处都是大写 K | `ctxTokensAsK(50000)==='50K'` vs `humanTokens(50000)==='50.0k'` | **P2** | 状态栏统一改走 `ctxTokensAsK`（同一数字只留一套格式化） |
| M | 同一信息两处口径 | `core/ctxring.ets:99-106` vs `core/statusfmt.ets:52-55` | `ContextRing.tsx:18-20` | 同一百分比两套算法+兜底分叉：环 3 位无兜底，状态条 1 位且缺 percent 用 used/max 兜底 | `p=80.444`→环 `"80.444"`、状态条 `"80.4"` | **P2** | 共用同一取整函数与「缺 percent 不显示」策略（web 环语义为准） |
| N | 陈旧/复位 | `components/MessageRow.ets:162`(行内 `@State regionStatus`)/`:368-378` | `useRegionWindow.ts:29,64,130` | 区域加载**失败无计数**（web `MAX_AUTO_REGION_FAILURES=2` 保守停）；且 `regionStatus` 是行内持久 `@State`，行被复用时不按 `turnID` 复位 | 行复用 + `status='error'` → 新 turn 仍显示「加载失败·重试」；弱网无限自动重试 | **P2** | 加 `regionFailStreak`（≥2 只手动重试）+ `onAppear`/key 按 `turnID` 复位 |
| O | 同一信息两处口径 | `core/subagent.ets:38-50,65-78` | `SubAgentProgressTree.tsx:56,68` | SubAgent 树**根过滤**含 `active`（原生 `SUB_RUNNING=running\|active\|pending`），web 根只 `running\|pending`（`active` 仅用于卡片图标） | `visibleRoots([{status:'active'}]).length`：原生 1、web 0 | **P2** | 根过滤收窄到 `running\|pending`（`active` 只进 `subStatusKind`） |
| P | 同一文件两口径 | `core/statusfmt.ets:107`(认 `done`) vs `:151`(只认 `completed`) | `GoalBanner.tsx:37` | goal「已完成」在**同一文件内两份口径**（`goalText` 接受幽灵值 `done`，`goalDisplay` 只认 `completed`） | `goalText({status:'done'})` 非空 而 `goalDisplay('…','done').completed===false` | **P2** | 删 `goalText` 的 `'done'` 分支（或整体改用 `goalDisplay`） |
| Q | 同一信息两处口径 | `core/statusfmt.ets:88-100`(只认 `doing`) vs `core/todos.ets`(`todoState.currentIndex` 含 pending) | `useTodos.ts:41` | 「当前任务」两套判据：状态栏 `currentTodo` 只取 `doing`，`TodoPanel` 取第一条**非 done**（含 pending） | `todos=[{pending:'A'},{doing:'B'}]` ⇒ `currentTodo`='B'、面板='A'（web 亦'A'） | **P2** | `currentTodo` 复用 `todoState().currentText`（与面板同源） |
| R | 键不稳定 | `components/MessageNav.ets:245-247`；`core/subagent.ets:124-126` | `MessageUserNav.tsx:175`；`SubAgentProgressTree.tsx:63` | ArkUI 适配手法：`ForEach` key 编入 `active`/内容指纹（web key 恒定）⇒ activeSeq/描述变化即重建。**平台被迫**（key 不变则不重估 `@Prop`） | 滚动改 `activeSeq` ⇒ 两项重建；`desc` 同长异文 ⇒ key 不变（可能不刷新） | **P2** | 有据差异，不改行为；如需减闪动改 `@Observed/@ObjectLink`。SubAgent 的 `desc.length` 建议改全文/哈希 |
| S | 文档过期 | `docs/WEB-ALIGNMENT.md:457-464` | `core/toolstatus.ets:17-19` | 文档 13.3 写「live pending 一律按执行中渲染」，已被 `toolstatus.ets`（pending 必须「排队」）推翻 ⇒ 两处必有一份过期 | 直接比读两处文本 | **P2** | 拍板后订正该段（本轮只读未改） |

**确认无分歧（防假阴性）**：done 的 chip/形态（两边都安静、描边绿勾）；pending 的 pill 色（两边都 `text-muted`）；
pill 上限 8/前 7+`+N`；`mergeToolRuns` 合并规则（head 可带文本/成员须 tool-only/保 head 迭代号/顺序=首现序/`tools_folded` 聚合）；
「是否可点」恒可点；形态 if 链各只有一处；busy 单一入口（`indicators.busyNow` 被 composer 与占位共用）；
导航项数=用户行数；`nearestSeq` 顺序累加口径；usage 陈旧清理（`available=false` 不挂载环）；
todo 词汇全仓单一口径（`pending|doing|done`）；todo 完成度/百分比；goal 横幅可见性/编辑提交守卫；
SubAgent 状态归档/展平顺序；AskUser 面板状态复位与提交后清空。

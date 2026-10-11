# 与官方 webui 的功能对齐（native ↔ web）

> 本文件记录**原生端与官方 webui 的功能/设置对齐关系**，以及哪些是刻意不做。
> 新增共享功能前请先读这里，避免造出"只在客户端生效、与 web 各说各话"的孤岛设置。

## 1. 共享设置键（**两端必须同 id**）

映射表在 `core/settings.ets` 的 `serverKey()/localKey()`。⚠️ **2026-10-11 订正**：原写"与 web `userSettings.ts` 同源"**不准确** ——
实测**只有 8 个键真共享**，其余是**本仓单方面映射**到 `web:ui:*`（web 的 `SETTING_MAP` 没有它们 ⇒ web 读到按未知键忽略，**不串味但也不跨端可见**）。
逐键归属见 `docs/WEB-ALIGNMENT.md §17.6`。

**真共享（8，两端 `SETTING_MAP` 都有 ⇒ 跨设备一致）**：`md-theme` / `accent` / `locale` / `send-key-mode` /
`code-word-wrap` / `ui-mode` / `starred` / `session-category`。

**原生独有（8，借用 `web:ui:*` 命名空间但 web 不认）**：`app-theme` / `font-scale` / `reasoning-default` /
`surface` / `assistant-orb` / `notify-ask` / `notify-turn-done` / `notify-detail`。

| 本地键 | 服务端键 | 归属 | 状态 |
|---|---|---|---|
| `xbot-app-theme` | `web:ui:app-theme` | 原生独有 | ✅ 可改（深/浅/极光/星云/极简白） |
| `xbot-accent` | `web:ui:accent` | **真共享** | ✅ 可改（6 预设 + 跟随主题） |
| `xbot-md-theme` | `web:ui:md-theme` | **真共享** | ✅ 可改（23 套，只影响代码块/行内码） |
| `xbot-starred` | `web:session:starred` | **真共享** | ✅ 可改（星标 + 星标优先排序） |
| `xbot-locale` | `web:ui:locale` | **真共享** | ⚠️ **只读展示**（web 可改；本仓无 i18n 文案表 ⇒ 见 §3 / `WEB-ALIGNMENT §17.5-1`） |
| `xbot-font-scale` | `web:ui:font-scale` | 原生独有 | ✅ 可改（web 无此设置） |
| `xbot-code-word-wrap` | `web:ui:code-word-wrap` | **真共享** | ✅ 可改 |
| `xbot-reasoning-default` | `web:ui:reasoning-default` | 原生独有 | ✅ 可改 |
| `xbot-send-key-mode` | `web:ui:send-key-mode` | **真共享** | ✅ 可改 |
| `xbot-surface` | `web:ui:surface` | 原生独有 | ✅ 可改（原生 / 内嵌 ArkWeb） |
| `xbot-assistant-orb` | `web:ui:assistant-orb` | 原生独有 | ✅ 可改（光球在飞指示） |
| `xbot-notify-ask` / `-turn-done` / `-detail` | `web:ui:notify-*` | 原生独有 | ✅ 可改（通知事件 + 正文隐私） |
| `xbot-ui-mode` | `web:ui:ui-mode` | **真共享** | ⛔ **本仓不消费**（单手机布局）—— 保留仅为 key 表一致，⛔ 勿删 |
| `xbot:session-category` | `web:session:category` | **真共享** | ✅ 可改（会话分组：path/status/time） |

> 改了**真共享**键 = 改了两端（含 web）。所以**写入前必须确认语义与 web 一致**。
> 写**原生独有**键只影响本仓（web 忽略），但**别把 web 独有键**（`leftSidebarWidth` / `layout:*` / `panel-layout*` / `recent-workdirs:v1`）
> 收进 `localKey()` 的映射表 —— 它们靠 `localKey()` 的"未收录即原样返回"**零丢键**（见 `WEB-ALIGNMENT §17.5-5`）。

## 2. 本轮新增的对齐实现

### 2.1 强调色
- 语义：`withAccent(palette, hex, isDark)` **只覆盖 accent 家族**（accent/accentHover/accentSoft/accentSoftFade/accentDeep/accentText/onAccent/bubbleUser），
  底/面/文字/边框**逐值不动** ⇒ 换色不会破坏已建立的亮度阶梯。
- hover 方向对齐 web：**深色系变亮 0.12 / 浅色系变暗 0.1**；`onAccent` 走对比前景（BT.601 亮度 >150 用深色字）。
- ⚠️ **未设置 ⇒ 不覆盖**（返回主题本色）。历史坑：曾回落 web 的 `DEFAULT_ACCENT_COLOR #3388BB`，把主题紫色顶掉，整套配色身份丢失。
- **⛔ 2026-10-11 真机实证的"全局空操作"修复**：叠加此前**只**发生在 `pages/Index.ets` 的 `pal()`，
  而 40 个组件共 80 处取色走 `paletteOf(this.theme)` ⇒ **组件（含设置面板自身）拿不到覆盖**
  （真机：标签写 `湖蓝`、同屏按钮像素 = `#7B5CF6`＝主题紫）。
  修法 = **把叠加下沉到唯一取色入口 `paletteOf`**：
  · `withAccent`/`normalizeAccent`/`parseHex`/`lighten`/`darken`/`contrastForeground`/`DEFAULT_ACCENT`
    **迁到 `core/theme.ets`**（避免 theme↔accent 循环），`core/accent.ets` **原样再导出**（既有 import 不变）；
  · `core/theme.ets` 新增应用级覆盖 `setAppAccent(hex)`/`appAccentHex()`，`paletteOf` 缓存键 = `主题|强调色`；
  · **唯一写入点** = `core/store.ets` 的 `loadSettings`/`saveSettings`（`syncAppAccent`）—— 组件不得写。
  ⇒ 未设置＝跟随主题；显式设置（含自定义 hex）＝**全站（组件也是）生效**。
- 守护：`tools/tests/accent.test.ts`（66 例，含"底色不变""accent ≠ onAccent""预设逐值与 web 一致"
  + **"覆盖经 `paletteOf` 全主题生效 / 非 accent 角色不动 / 记忆化不串味"**）。

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
| **插件面板打开的是"裸 ESM .js"** | ✅ **已修**（`74a9141`，2026-10-11）：`PluginPanelInfo.url` 语义已改为**权威宿主页**（`.js/.mjs`/`/plugins/*/web/*` 一律回落 `originOf(baseUrl)`），ESM 地址只作元数据留在 `PluginHostInfo.moduleUrl`；守护测试 `tools/tests/pluginpanel.test.ts`（121 断言） | `core/pluginhost.ets`（`pluginPanelUrl`/`isPluginModuleAsset`/`:573 item.url = pluginPanelUrl(...)`）；消费点 `PluginHost.ets:98`、`pages/Index.ets:2698/2948`、`PluginsSheet.ets:124` 全为宿主页 |

> 结论：**真瓶颈不是"缺 WebSurface"，也不是 URL 语义**（后者已由 `74a9141` 修好，且有守护测试）。
> 真正的两个缺口是：① **页面侧从未接线桥**（web `plugin-runtime` 零 `xbotNative` 调用）；
> ② **web 无"插件 URL 深链"** ⇒ 原生最多打开宿主页根，**精确落到某个插件视图只能靠 web 侧新增 URL/参数深链**（web 仓的活）。

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

### 8.6 桥接面**全量清点**（2026-10-11 只读审计）—— ⛔ **派单前提被证伪：web 侧 0 消费**

> 派单假设：「web 的插件宿主通过 `window.xbotNative`（或类似桥）调用原生能力；只要原生把 web
> 期望的桥 API 全部实现，插件就能全支持」。本波对该假设做**穷举取证** ⇒ **不成立**（证据如下，可复现）。

**A. web 侧（权威 `web/src`）—— 期望的桥方法 = `0`**

| 搜索 | 命令（`grep -o` 风格 / 剥注释 / 排除 `node_modules`） | 命中 |
|---|---|---|
| 原生桥对象 | `grep -rlI "xbotNative" web`（含 `XbotNative`/`xbot_native`，忽略大小写，全文件类型） | **0** |
| webkit / ohos 桥 | `grep -rnI "window\.webkit\|window\.ohos\|__xbotProbe" web/src web/public` | **0** |
| `postMessage` | `web/src`（非测试） | 仅 2 处，**与桥无关**：`hooks/usePwaInstall.ts:189,209`（SW `SKIP_WAITING`）；`plugins/SandboxedUI.tsx:308`（**注释**里讨论 iframe 隔离，未实现） |
| `bridge` | `web/src`（非测试） | 全是 **React 跨树桥**（`workspace/DockviewContainer.tsx`、`lib/chatInputBridge.ts`、`providers/*`），非原生桥 |

⇒ **web 当前完全不调用原生桥**。这不是"遗漏"，是 web 端的既定事实（判据 = 穷举 0 命中，**零命中即结论**）。

**B. web 插件真正依赖的"宿主面"—— 全由 web 自己 / 服务端提供，**原生无需实现**

| 依赖 | 注入/提供方 | 证据 |
|---|---|---|
| `window.React` | web 宿主（加载插件 bundle 前注入） | `plugins/*/shared.ts` 头注；全 src **10** 处读数 |
| `window.__xbot_session__` | web `plugin-runtime/usePluginRuntimeHost.ts:373,387-388` | **6** 处读数（插件取 channel/chatID） |
| `window.__xbot_i18n__` | web `plugin-runtime/iteration-render.tsx:28` | **5** 处 |
| `window.__xbot_ui__.SandboxedUI` | web `plugins/SandboxedUI.tsx:37-38` | **2** 处 |
| `window.__xbot_iteration__` / `window.__xbotChatDiag` | web `plugin-runtime/iteration-render.tsx:25-28` / 调试 | 1 / 3 处 |
| `ctx.*`（**9 权限门控**） | web `plugin-api/context.ts` + `manifest.ts:13` | `events`/`commands`/`rpc`/`state`/`ui`/`plugins`/`config`/`files`/`share` |
| RPC 通道 | web 自己的 WS/HTTP（`POST /api/rpc`；`web_ui_action`） | `plugins/api.ts`；`plugin-runtime/index.ts` `host.rpcTransport` |
| ESM 动态加载 | **服务端静态** `/plugins/<id>/web/<entry>` | `plugin-runtime/loader.ts` `await import(entryUrl)` |

⇒ 原生 ArkWeb 侧只需 `javaScriptAccess(true)` + `domStorageAccess(true)`（`WebSurface.ets:380-381`，**均已开**）；
其余全由**页面自身运行**。**不存在"原生要补实现"的宿主方法清单。**

**C. 本仓（原生）已实现的桥面 —— 1 个方法，但 web 0 消费**

| 原生实现 | file:line | 状态 |
|---|---|---|
| `window.xbotNative.postMessage(json)`（**唯一暴露方法**） | `components/WebSurface.ets:398-402`（`methodList: ['postMessage']`）+ `:48-57` `NativeBridgeProxy` | ✅ 已实现 |
| 信封协议（`{v,id,type,payload}` + 白名单 11 类 + 上限） | `core/webbridge.ets:36-72`（`BRIDGE_TYPES`） | ✅ 纯逻辑 + 测试 `tools/tests/webbridge.test.ts`（12KB） |
| 宿主 chrome 动作 `close`/`log`/`ready` | `core/webbridge.ets:255-271` `hostActionFor` | ✅ 已判定（组件执行，`WebSurface.ets:applyHostAction`） |
| 业务类型 `call`/`notify`/`result`/`event`/`theme`/`resize`/`openExternal` | `core/webbridge.ets:251-253` | ⚠️ **一律 `ignore`**（注释原文："由上层接线"；**目前无上层需要**） |
| 上层业务回调 `onBridgeMessage` | `components/WebSurface.ets:152`（默认空实现 `() => {}`） | ⚠️ **未接线**（未接线时消息安全丢弃） |

**D. 结论（判断，不是清单复制）**

1. **"web 期望哪些桥方法" = 零条** ⇒ 不存在"把 web 期望的桥 API 全实现"的清单；
   ⛔ 任何凭想象造出的"方法表"都**不可证伪、必然漂移**（web 无消费方）。
2. ⇒ **不存在可立即落地的桥方法纯逻辑**：现有 `core/webbridge.ets` 已覆盖协议/白名单/chrome 动作；
   再加"方法表"= 造契约。故本波**不新增桥代码**（有意为之，非遗漏）。
3. **"插件全支持"的真瓶颈不是桥，也不是 URL 语义**：URL 语义错位**已在 `74a9141` 修好**
   （`PluginPanelInfo.url` 恒为权威宿主页 + 守护测试 `pluginpanel.test.ts` 121 断言）。
   剩下两个真缺口是：① **页面侧从未接线桥**（web `plugin-runtime` 无 `xbotNative` 调用）；
   ② **web 无插件 URL 深链**（打开某插件视图只能走应用内 `ctx.ui.openViewTab`）⇒ 原生**最多**打开宿主页根，
   要精确落到某插件**需 web 侧新增 URL/参数深链**（web 仓的活，原生做不了）。
4. **正解顺序**：① web 端先定**页面侧桥客户端契约**（`window 'xbot:bridge'` 事件 + `xbotNative.postMessage`） →
   ② 本仓按该契约在 `WebSurface.ets` 接线 `onBridgeMessage` + 补 `applyHostAction` 的业务分支。
   ⛔ 在 ① 未定前，原生侧**不应**先造方法。

### 8.7 ArkWeb 早期注入能力：**已真机证实**（2026-10-11）

> 承 §8.6 末尾的悬念：「若原生能在**页面脚本之前**注入 JS，能不能绕过 web 侧的桥客户端契约？」
> 本波先用**只观测、不实现业务**的探针把"能力"这件事钉死（实现体 = `components/WebSurface.ets:26-35`
> 的 `PROBE_JS`，注入点 `:409`，观测链路 `:412-421` + `:436-442`）。

**结论（一句话）**：`runJavaScriptOnDocumentStart`（`@since 15`）在本机 **SDK 21 真生效**，
且注入时刻**早于 `<head>` 存在**；属性式 `javaScriptProxy` 的原生对象在**同一刻**就已就绪。
⇒ **"原生能在页面第一批脚本之前往页面注入自己的 JS"＝事实**（不是文档推断）。

**A. 真机原文**（`hdc` 取回，tag `XBOTPROBE`，2026-10-11 14:24:45–46）

```
XBOTPROBE: [XBOT-PROBE] xbotKeys=["xbotNative"]
ARKWEB-CONSOLE: [CONSOLE:1] "[XBOT-PROBE] xbotKeys=["xbotNative"]", source:  (1)
XBOTPROBE: probe "{\"t\":1791699885840,\"readyState\":\"loading\",\"hasHead\":false,\"hasBody\":false,\"nativeType\":\"object\",\"xbotKeys\":[\"xbotNative\"]}"
```
（第 1 行 = 注入脚本自己的 `console.log`，经 `onConsole` 转发；第 2 行 = 同一句在 ArkWeb 内核
自身的 console tag 下；第 3 行 = `onPageEnd` 回读 `window.__xbotProbe` 的完整对象。）

**B. 逐条判读**

| 观测 | 判读 | 性质 |
|---|---|---|
| `readyState:"loading"` **且** `hasHead:false` **且** `hasBody:false` | 注入发生在 **`<head>` 尚未解析**之时 ⇒ **严格早于页面任何脚本**（含 `<head>` 内联 `<script>`） | ✅ 已证实 |
| `nativeType:"object"` | 属性式 `javaScriptProxy` 的 `window.xbotNative` 在**文档最早期就已存在** ⇒ `WebSurface.ets:392-396` 那条"先于页面导航"的**此前未验注释成立**，页面脚本无需等 `onPageBegin` | ✅ 已证实 |
| 同一句同时出现在 `XBOTPROBE` 与 `ARKWEB-CONSOLE` | `.onConsole(...)` 转发链路通（`WebSurface.ets:412-421`） | ✅ 已证实 |
| `xbotKeys` 里**没有** `__xbotProbe` | ⚠️ **探针自身的伪影，不是注入失败**：`xbotKeys` 与 `window.__xbotProbe=` 写在**同一个对象字面量**里，`keys` 在赋值**之前**求值（`PROBE_JS` 前 4 行）⇒ 它必然只反映"注入前"的全局名。**反证**：`onPageEnd` 回读拿到了完整 `__xbotProbe`（第 3 行）⇒ 注入确实成功 | ✅ 已澄清（避免误判） |

**C. 复现命令（含一条**防假阴性**铁律）**

```bash
source ~/ohos-cli/env.sh
T=127.0.0.1:5555
# ① 装机（本波探针版）
~/ohos-cli/deploy.sh
hdc -t $T shell "hilog -r"                       # ② 先清缓冲（否则旧日志混杂）
# ③ ⛔ 铁律：清完缓冲**必须触发一次真正的导航**（冷启 App，或面板里 ⟳ 刷新/进插件面板）
#    —— 只清日志不重新导航 ⇒ 0 命中是**假阴性**（本波踩过：同一会话里导航已发生过，不再打印）
# ④ 抓取：⛔ 不要 `hdc shell hilog` 直接流（**永不返回**，会挂死脚本）
hdc -t $T shell "hilog -x > /data/local/tmp/h.txt"
hdc -t $T file recv /data/local/tmp/h.txt /tmp/h.txt
grep -E "XBOTPROBE|XBOT-PROBE|ARKWEB-CONSOLE" /tmp/h.txt
```
**期望输出**：上面 §A 的 3 行（关键字段 `readyState:"loading"` + `hasHead:false` + `nativeType:"object"`）。
**失败长相**：① 完全无 `XBOTPROBE` ⇒ 没发生导航（先做 ③）或装的是旧 hap；
② `probe null` ⇒ 注入脚本没跑（`scriptRules` 不匹配 / 该 API 未生效）；③ `probe-read fail` ⇒ controller 未绑定。

**D. 边界与纪律（改这条链路前必读）**

1. ⛔ **`scriptRules: ['*']` = 注入所有 frame / 所有来源**（`WebSurface.ets:409`）。本波只挂一个只读探针，
   无害；**但若将来注入"真桥"，必须把 `scriptRules` 收窄到可信宿主 origin**
   —— 本仓已有同一警句：`core/pluginhost.ets:105-111`（跨源 `serverUrl` 回落宿主页，理由正是
   "`window.xbotNative` 会被注入**所有 frame**，不该注给第三方页面"）。**探针不得被当成先例直接放大成桥。**
2. ⛔ **`ScriptItem.script` 是静态字符串**（`component/web.d.ts:3558`）⇒ 只能注入**常量脚本**；
   需要随运行时变化的注入内容 ⇒ 静态脚本里只放"取值函数"，动态值仍走原生桥。
   （`ScriptItem.urlRegexRules` 是 **API 23**，本工程 21 用不了，只能靠 `scriptRules` 字符串规则。）
3. ⚠️ `javaScriptOnDocumentStart`（API 11）与本 API 会**互相干扰**（SDK 原文：不建议同用，
   `component/web.d.ts:7296-7299`）⇒ 本仓**只用** `runJavaScriptOnDocumentStart` 一处，不得再加另一种。

**E. 对目标②（插件全支持）的判断 —— **能力可行 ≠ 该做桥**（详见 §8.6）**

- 本小节**只证"注入可行"**，**不改 §8.6 的结论**：`web/src` 对 `xbotNative` 的期望方法数
  = **0**（穷举 `grep -rlI "xbotNative" web` ⇒ 0 命中），插件真正依赖的宿主面
  （`React`/`__xbot_*`/`ctx.*`/RPC/ESM 加载）**全由 web 自身 + 服务端提供**（§8.6-B 表）。
- ⇒ **"能不能注入"曾被认为是目标②的闸门；现在闸门证伪**：剩下的瓶颈是**web 侧的桥客户端契约**
  与**插件 URL 深链**（§8.6-D.3），**两者都是 web 仓的活**。原生单方面注入一个"真桥"
  只会造出**没有消费方**的死代码（不可证伪、必然漂移）。
- ⇒ **最小实验（若仍要推进）**：不动 `WebSurface` 的业务路径，只在 web 仓加**一行**读探针
  （`console.log(Object.keys(window).filter(k => /xbot/i.test(k)))`）⇒ 验证"web 能看见原生注入物"；
  通过后由 web 先定 **`window 'xbot:bridge'` 事件 + `xbotNative.postMessage`** 契约，
  原生再按契约接线。**顺序反了就是造契约。**

### 8.7 插件配置字段：**形态差异裁决**（2026-10-11，避免被当缺口反复讨论）

**A. `select` 用 chips，不用下拉 —— 保留（形态差异，非缺口）**
- web 用下拉：`SettingsPlugins.tsx:611-628`（`<Select>` + `SelectTrigger/SelectContent/SelectItem`）。
- 原生用 **chips（可点标签）**（`core/settingsplugins.ets:pluginControlKind ⇒ PLUGIN_CTRL_CHIPS`）。
- **为什么保留 chips**：① 移动端 chips 命中区更大、更可点（本仓 `HIT_TARGET_MIN` 纪律）；
  ② 与 web 的**无障碍树**语义一致（都是"一组选项 + 当前选中"，原生 chip 同步 `onAccent` 选中态）；
  ③ `multiselect` 本来就是 chips（web `:668-699`），单/多选形态统一反而更好懂。
- ⇒ **裁决：保留**。以后再看到"web 是下拉"，按本条处理，别当缺口。

**B. 未知类型（`normalizeFieldType ⇒ unknown`）⇒ 对齐 web（可编辑文本框）**
- web `default` 分支（`SettingsPlugins.tsx:636-646`）对**任何**未知类型都渲染**可编辑 `<Input>`**
  ⇒ 原生此前 `static` 只读**不一致**；2026-10-11 裁决**对齐 web**（`isFieldEditable(unknown)=true`、
  `pluginControlKind(unknown)=text`、`textInputValue/displayValue` 原值原样）。
- "不猜"的价值改由**保守写入**承载：`validateValue` 不过就不发（`core/settingsplugins.ets`），
  服务端拒收只报错、**不覆盖**本地值（`components/SettingsPlugins.ets:writeValue` 既有行为）。
- ⚠️ `image` 仍是**独立一档**（`PLUGIN_CTRL_IMAGE`，有专门上传值区），**不**走 unknown/text。

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
| Todo 拉出面板 | `components/agent/TodoPullOut.tsx:28` | **已交付并已接线** —— `core/todos.ets` + `components/TodoPanel.ets`（`dae96fe` 之后的波6；由 `pages/Index.ets` 消费）；原状态：只有状态**文本** `core/statusfmt.ets:43,57` | 无 | 接线 `pages/Index.ets`（`@Prop` 契约见 `core/todos.ets` 头注释） |
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
| **AnsiText**（ANSI SGR 终端着色） | `AnsiText.tsx:205`（3 消费点） | 🟡 | **解析层 + 本仓色板映射已就绪（`core/ansi.ets`），消费点未接线** ⇒ 见 §11.10；11.5 证据 ⑥ **已过期** |
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
| MessageInput + 补全（`/`、`@`） | `MessageInput.tsx:173`、`CompletionPopup.tsx:21` | ✅ | `core/composer.ets`（`activeToken`/`matchCommands`/`matchFiles`/`applyCommand`/`applyMention`/`selNext`/`selPrev`/`completionKeyAction`）+ `Index.ets` 输入区浮层（`3955`）/ `refreshCompletion`（`4634`）/ TextArea `onKeyEvent`（`4163`）；选中态 `cmdSel` + ↑↓/Tab/Esc + `@` 文件回车接受 |
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
| 会话搜索（本地筛选 + 服务端搜消息） | `SessionSearch.tsx:36` | 🟡 **切会话已修、服务端搜索恒空** | `Index.ets:5174`（筛选）/`:4113 runSearch`/`:4855 SearchHitsSheet`；`bf9dc78` 真机证实 active session 跟随；**服务端 `/api/search` 恒空** ⇒ 见 11.5 证据 ⑧-bis |
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
| **会话导出**（`json`/`jsonl`/`txt`；⛔ **无 markdown**） | `SettingsDeveloper.tsx:60-92`、`agent/api.ts:378-582` | 🟡 **纯逻辑已交付** | `core/export.ets`（`a7e6ffc`，全形态 + 78 断言）；**UI 入口未接线**（见 11.5 证据 ⑧） |

### 11.3 C 域：设置全分区 / 插件体系 / 其它

| web 功能 | web file:line | 状态 | 原生 file:line / 证据 |
|---|---|---|---|
| 设置容器（14 分区 nav） | `settings/SettingsDialog.tsx:117-131` | ✅ 等价 7-tab | `components/SettingsPanel.ets:46 settingsTabs()`（分派 `:111-127`） |
| ├ General（locale + 清除缓存） | `settings/SettingsGeneral.tsx:32` | 🟡 | 「外观」分区（`components/SettingsAppearance.ets:186` locale **只读**；**无清缓存**）⇒ 见 §XI 判 N/A |
| ├ Appearance（主题/md/accent/UI_MODE） | `settings/SettingsAppearance.tsx:54` | 🟡 | `components/SettingsAppearance.ets`；**缺 UI_MODE 外壳切换**（`KEY_UI_MODE` 死字段，§XI 判 N/A） |
| ├ Interaction（发送键 / 换行） | `settings/SettingsInteraction.tsx:21` | ✅ | `components/SettingsAppearance.ets`（`KEY_SEND_KEY`/`KEY_CODE_WRAP`，归「界面/文字与阅读」组） |
| ├ Language | `SettingsDialog.tsx:115,177` | 🟡 | 刻意只读（文案硬编码，见 §3） |
| ├ Agent | `settings/SettingsAgent.tsx:113` | ✅ | `components/SettingsAgent.ets`（`allow_self_compact` + vision×4） |
| ├ Tools | `settings/SettingsTools.tsx:35` | ✅ | `components/SettingsTools.ets` |
| ├ LLM（读/启停/默认/CRUD/档位/思考） | `settings/SettingsLLM.tsx:78`、`llm-console.tsx` | 🟡 | `components/SettingsLlm.ets`（含 CRUD）；**缺 import/export_subscriptions**（§XI 记档待做） |
| ├ **Channels**（飞书/插件渠道 + 一键绑定） | `settings/SettingsChannels.tsx:118` | ✅（**2026-10-11 订正**：11.5 ⑨ 已过期） | `components/SettingsChannels.ets`（1151 行，逐条移植）+ 纯逻辑 `core/channelscfg.ets`；判据 `tools/tests/settings_url_overflow.test.ts` 钉 URL 折行 |
| ├ Storage | `settings/SettingsStorage.tsx:57` | ✅ | `components/SettingsStorage.ets` |
| ├ WebUsers | `settings/SettingsWebUsers.tsx:31` | ✅ | `components/SettingsWebUsers.ets` |
| ├ Account（用户名 + 登出） | `SettingsDialog.tsx:69` | ✅ | `components/SettingsAccount.ets` |
| ├ **Developer**（SSE REC + 导出） | `settings/SettingsDeveloper.tsx:20` | ✅（**2026-10-11 订正**：11.5 ⑩ 已过期） | `components/SettingsDeveloper.ets`（552 行，录制+连接状态+导出会话；已接 `SettingsPanel.ets` `SETTINGS_TAB_DEVELOPER`） |
| ├ Layout（slot 配置） | `settings/SettingsLayout.tsx:39` | ⚪ | Dockview 专属（§XI 判 N/A） |
| ├ Plugins（配置表单 + 图标上传） | `settings/SettingsPlugins.tsx:60` | 🟡 | `components/SettingsPlugins.ets`（803 行，配置读写+启停+重载，已接 tab）；缺**图标上传** |
| ├ **Notify**（原生独有，web 无此分区） | — | ✅（**波11 补齐**） | `components/SettingsPanel.ets` NotifySection：`KEY_NOTIFY_ASK`/`KEY_NOTIFY_TURN_DONE`/`KEY_NOTIFY_DETAIL` 三开关（判据 `tools/tests/settings_notify_ui.test.ts`） |
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
- ⑥ **AnsiText**：`grep -rniE "ansi|sgr|\\\\u001b|\\\\x1b" .` → **0**（早前误报的匹配是 `transient`/`humanSize`/`statusGroupKey` 等词）。`ToolPopover.ets:96 classifyLine` 只做行级分类，**不解析 ANSI SGR**。⚠️ **2026-10-11 订正：本结论已过期** —— 并行线在**当日 09:43**（`9ad6c30`）已落地 `core/ansi.ets` 的**解析层**，本波（`10aae43`）又补齐**到本仓色板的映射**（`ANSI_COLOR_ROLES`/`ansiPaletteOf`）；**消费点仍未接线**（见 §11.10）。⚠️ 教训：`grep → 0` 类判据**必须写明取证时刻**，否则会被后续协作立刻推翻。
- ⑦ **渠道过滤 / 路径选择 / 最近工作目录**：`grep -rniE "channelpicker|availableChannels|渠道选择" .` → 0；`grep -rniE "PathPicker|pickDir|chooseDir" .` → 0；`grep -rniE "recent" .` → 8 命中**全是** `core/config.ets:117 recentServers`（服务器 URL 历史）。
- ⑧ **分享页 / 会话导出**：`grep -rniE "SharePage|分享页|shareToken|share_link" .` → 0；`grep -rniE "导出|exportSession|systemShare|shareKit" .` → 仅 `core/http.ets:150 exportSessionCookie`（cookie，**非**会话导出）。
  - ⚠️ **2026-10-11 订正（会话导出形态 —— 原文"markdown/jsonl"为误标）**：web 权威 `web/src/components/agent/api.ts:378-582`（`downloadSession`）实际输出 **5 种形态 + 1 个开发者文本**：
    `native`=**json**（`:560-566`）、`openai`=**json**（`:396-422`）、`codex`=**jsonl**（`:424-462`）、`multica`=**jsonl**（`:464-558`）、`benchmark`=**jsonl**（`:383-391`）；
    mime 分别 `application/json`（前两者）/ `application/x-jsonlines`（后三者）；另加开发者 **turn+iter**=`txt`（`text/plain`，`SettingsDeveloper.tsx:60-92`）。
    ⛔ **web 无 markdown 导出**（`grep -rniE "text/markdown|\\.md['\"]"` 在 `web/src` **零导出命中**；服务端 RPC 表亦仅 `export_session`/`export_session_jsonl`，`serverapp/rpc_table.go:1539/1577`）。
    **文件名口径**（`api.ts:570-572`）：`<label>.<ext>`，`label=(chatID||'session').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,60)` —— **不含时间戳**（时间戳仅 SSE 录制器 `sse-dump-<ts>.ev` 用）。
  - **本仓落地（2026-10-11）**：纯逻辑**已交付 `a7e6ffc`** —— `core/export.ets`（native/openai=json、codex/multica/benchmark=jsonl、turn+iter=txt 全形态 + `ExportClock` 注入时间/id）+ `tools/tests/export.test.ts`（78 断言）；**UI 入口未接线**（需 `core/rpc.ets` 补 `export_session`/`export_session_jsonl` RPC 常量 + `Index.ets` 接会话菜单/设置面）。
- ⑧-bis **「搜消息」真机复验（2026-10-11，设备 `127.0.0.1:5555`，装 `adc8f81`，含 `bf9dc78`）**：
  - **结论①：切会话通知服务端 —— ✅ 生效（真机证实）**。App 的服务端是**远端** `https://xbot.pivotlang.tech`
    （设备 prefs `.../haps/entry/preferences/xbot_settings` 的 `server_url`；本机 `xbot-cli serve` **不是**它的后端，本机 `/api/history` 404）。
    用该 prefs 里的 `session_cookie` 直连远端 `POST /api/history {}`（**空 session ⇒ 服务端回落用 active session**）读"服务端认定的当前会话"，与 App 顶栏对照：
      · App 顶栏 `Agent-astute-coral` ⇒ 远端 active = `cli:/home/smith/src/xbot:Agent-astute-coral`（一致）
      · 在 App 内切到 `checkout` 会话 ⇒ 远端 active **同步**变 `cli:/home/smith/src/xbot:checkout`（一致）
    ⇒ **原生切会话确实发出了 `/api/chats/{id}/switch`、且服务端 `userCurrentSession` 跟随**。
  - **结论②：端到端「搜出结果」仍不成立，且根因在服务端（非本修复）**。绕开 App、直接 curl 该远端 `POST /api/search`，
    对**任何** query（`的`/`a`/`the`/`session`，以及 active 会话里**确实存在**的 `feedbackInfo`(assistant)/`合回去`(user)）
    一律回 `{"ok":true,"data":{},"error":null}` ⇒ **服务端搜索恒返回空**。
    · 与 App 无关：信封 `data` 被 `core/http.ets:sendJson` 正确解包（`/api/history` 同款信封能正常取到内容）。
    · 疑似 v71「每会话一个 DB」后 `handleSearch`（`channel/web/web_api.go:1094`）仍查主库 `session_messages`（本机同架构主库该表 `count=0`，行在 `~/.xbot/sessions/**`）。
    ⇒ 该行**不宜标 ✅**；需服务端排查（本仓无法修）。
  - **复验方法（可重跑）**：读设备 `xbot_settings` 的 `session_cookie` → `curl -b "$CK" -X POST <server>/api/history -d '{}'` 取 active session；
    在 App 内切一次会话后再取一次，即可判"是否跟随"。

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
| 1 | **AnsiText**（ANSI 着色） | 工具/终端输出是最高频呈现面，原生现把 shell 输出当纯文本 ⇒ 颜色语义全丢；纯函数、可脱机单测 | **✅ 已接线**（`core/ansi.ets` `9ad6c30` + 本仓色板映射 `10aae43`；消费点 `0af6ef3` `bed4672` —— 5 组件：`MessageRow`/`ToolVisual`/`SyntheticCard`/`LiveTailView`/`ToolPopover`；判据 `tools/tests/ansi_wiring.test.ts` **13 断言**）。⚠️ **原注「接色仍未做」已过时**（订正于 §11.10 的同一处）
| 2 | **消息编辑并重发/回退（rewind）** | 唯一能改写历史错字的操作；原生状态机已具备 rewind 语义，属**接线级**投入 | `core/store.ets`（rewind REST）+ `Index.ets` 长按菜单 + `UserBubble.ets` |
| 3 | **web_widgets/plugin_widgets 不静默丢** | 已连接的协议数据被**无声丢弃**（用户可见内容到达客户端却消失）⇒ 正确性缺口，S 级 | `core/store.ets onSse` + 一个只读渲染面（`PluginHost.ets` 或状态条） |
| 4 | **StagingTray interject/clear** | 排队消息高频交互；`interject`（插队）所需 WS interrupt **已存在** | `Index.ets:5795 QueueSheet` + `core/store.ets`（队列操作） |
| 5 | **渠道过滤 ChannelPicker** | 唯一「数据已就绪但无 UI」项（`core/sessionpick.ets:20/34` 现成） | `Index.ets` DrawerSheet 加筛选态 + `filteredSessions` |
| 6 | **SessionViewBar「全部折叠/展开」** | 折叠机制/组键齐备，只差批量入口，XS | `Index.ets`（`toggleGroup`/`isGroupCollapsed` 之上加一个全量切换） |
| 7 | **Developer 模式 + SSE REC** | 排障/复现 bug 的刚需（契合「真机点击是移动靶」痛点）；纯本地偏好，S 级 | 新增 `components/SettingsDeveloper.ets` + `SettingsPanel.ets` 加 tab |
| 8 | **Channels 设置分区** | web 14 分区中原生**唯一整块缺席**的服务端配置面，落地即 13/14 | 新增 `components/SettingsChannels.ets` + `SettingsPanel.ets` 加 tab（契约见 §9.2.1；⚠️ 飞书 secret 服务端未打码，见 §9.3） |
| 9 | **会话导出（`json`/`jsonl`/`txt`，⛔ 无 markdown）** | 🟡 **纯逻辑已交付 `a7e6ffc`**；UI 入口缺（手机端分享/上报会话常用） | `core/export.ets`（就绪）+ `Index.ets` 入口 + `SettingsDeveloper`/分享 |
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
- **纯逻辑可先行的候补**（不碰 `pages/`）：AnsiText、最近工作目录、命令路由、消息注释。✅ **2026-10-11：四项均已交付纯逻辑层**（提交 `10aae43` + 前置 `9ad6c30`）—— 但**都还没接进 UI**，见 §11.10。
- **§10 的两处状态已过时**（本轮复核更正）：`§10` 表把「任务面板」记为未迁，实际已由
  `Index.ets:4716 PanelsSheet` 覆盖；把「会话视图条」记为未迁，实际分类切换已迁（`Index.ets:5196`）。
  另 `§8.3 波1b②` 的「修 `PluginPanelInfo.url` 裸 `.js` 语义」**已完成**（`core/pluginhost.ets:573`）。

### 12.x 记档：`core/dangerconfirm.ets` **有意零消费**（2026-10-11 S3-a 裁决）

`core/dangerconfirm.ets`（危险操作「两段式确认」状态机 + 语义色角色）**不接线** —— 理由经只读取证：
**web 没有"两步确认"这个模式**，其破坏性动作一律是**单击直执行 + busy/错误提示**：
- 退出登录：`web/src/components/settings/SettingsDialog.tsx:66-99`（单击 `await logout()`，无 confirm）；
- 恢复默认面板布局：`web/src/components/settings/SettingsLayout.tsx:43-56`（单击清 `localStorage` + POST `user_settings`，只有 `resetting`/`resetErr`）；
- 全 web 搜 `再次点击`/`再点一次`/`click again`/`armed` **只命中无关用途**（`MessageList.tsx:571 loadMoreArmedRef` 加载哨兵、`PanelLayout.tsx:427` 占位面板语义）。

⇒ 接它 = **主动背离 web + 用户没要求**（正是本仓反复防的"自造 parity"）。本模块保留为
**纯逻辑 + 判据**（把既有 5 份各自为政的组件内实现收敛成一张表：`SettingsAccount:42` / `SettingsLlm:118` /
`SettingsPlugins:221` / `SettingsWebUsers:51` / `SettingsAbout:394`），并在
`tools/tests/orphan_core_module.test.ts` 的 `UNCONSUMED` 台账里**显式登记"有意零消费"**。
⛔ 若将来用户点名要"两步确认"，再按 S3-b 接线（届时重开）。

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
| D | 陈旧/权威 | ✅ **已修（前波）**：`core/msgops.ets:189-207 gapTopBefore` 现**有洞检测**（排序后找首个 `nums[i] > nums[i-1]+1` ⇒ 返回洞上边界），`core/store.ets:796` 已用它当 `before` | `AssistantMessage.tsx:105-116`；`useRegionWindow.ts` | ~~区域取段游标无洞检测~~ | — | **P1** | ✅ 已完成 —— 此行仅供追溯 |
| E | 同一状态两处判据 | `core/integrate.ts:385`；`core/reduce.ts:781`；`pages/Index.ets:2929` | `MessageList.tsx:1679-1686`；`AssistantMessage.tsx:158-163` | `phase==='compressing'` **无任何 UI 消费者** ⇒ 压缩期原生恒显示「思考中…」，web 显示「正在压缩上下文…」 | `grep -rn "compressing" entry/src/main/ets` → 仅注释；`showsBusyPlaceholder` 不看 phase | **P1** | 占位/`LiveTailView` 接 `liveProgress().phase`（web 同款） |
| F | 陈旧快照覆盖新状态 | `pages/Index.ets:1050`；`store.ets:904` | `usePendingEdit.ts:57-95`；`AgentPanel.tsx:691-692` | goal/todos **无乐观覆盖层**：用户勾选/改名后若一条旧 progress 快照先到，UI 回退旧清单（web 有 begin/commit/discard+序号防乱序） | 造 `snapshot=OLD` → `commit(NEW)` → 再喂 `OLD`：web 保 NEW；原生无该函数 | **P1** | `core/` 加 `usePendingEdit` 等价纯逻辑，Index 用覆盖值渲染 |
| G | 同一信息两处口径 | ✅ **已修（前波）**：键/连接符/优先级由 `core/msgops.ets:235 mergeAskAnswers` 保证（`String(i)` + `MULTI_JOIN='、'` + other>labels），`pages/Index.ets:2594` 已接线；`selectionsFor:286` 的 `q.id`/`q{i}` 是 **UI 内部句柄、不进 `answers`**，不构成缺陷 | `AskUserPanel.tsx:37,69,84` | ~~答案键/拼接口径不同~~ | — | **P1** | ✅ 已完成（2026-10-11 复核：**接线 spec 不再需要**；服务端 `protocol/ws.go:85` 契约 = index，且 `web_inbound.go:447-453` 只做 `Q<键>: <值>` 回显 ⇒ 无服务端脆弱点） |
| H | 同一信息两处口径 | `pages/Index.ets:1052,1858-1860,3012,5663`；`core/statusfmt.ets`(goalText 读 `g.text`) | `MessageInput.tsx:694,730`；`GoalBanner.tsx:30` | 同一 goal 两源：状态栏/`StatusSheet` 读 `store.goal`(`.text`，**全仓无赋值点** ⇒ 恒空)，横幅读 `liveProgress().goal`(`.objective`) ⇒ 「详情」入口在只有 goal 无 todo 时**消失** | `goalText({text:'x'})===''` 而横幅正常显示 | **P1** | `goalLine/StatusSheet` 改读 `objective`；`详情` gating 同源（该缺陷已在 `statusfmt.ets` 头注记录、未修） |
| I | 键不稳定 | `components/LiveTailView.ets:568` | `FoldedToolGroup.tsx:557` | live pill 的 `ForEach` key 含 `t.status`（`lt-${i}#${name}#${status}`）⇒ 状态每翻一次 key 变、销毁重建（打开中的浮层被拆、selected 复位）；web key 与状态无关 | 仅把某枚 status `running→done` ⇒ 原生 key 变、web 不变 | **P1** | key 去掉 `status`（用 `call_id` 或 `name-i`） |
| J | 顺序/不变量 | `core/indicators.ets:56-58`；`core/streammerge.ets:394-397` | `MessageList.tsx:640-650` | 迭代边界空隙**多画一个「思考中…」**：web 用 `!tailIsLiveRow` 抑制（否则与上方「思考 N 字」自相矛盾），原生缺该项 | `showsBusyPlaceholder({tailShowsIndicator:false,localBusy:true,rowsLength:5})` 原生 `true`、web `false` | **P1** | ✅ **裁决：保持原生行为（有意的原生差异）** —— 原生代码注释记录了**用户点名要求显示**该占位（用户明确要求优先于 web 对齐；与"executing 显示排队"同理：用户常驻要求优先）。⛔ **不要**为对齐 web 改掉它。 |
| K | 状态迁移丢失 | `components/LiveTailView.ets:76,466-479`；`MessageRow.ets:591-596` | `ThinkingLine.tsx:32,49-51`；`IterationHistory.tsx:56-59` | 「思考展开态」commit 时不迁移：web 让 live↔committed 共用 `reasoningKey(turnID,iteration)`；**原生旧态**是 live 无键局部 `@State`、committed 另一套键 | 展开 live 思考 → 等迭代 commit → 展开态回 `false` | **P1** | ✅ **已修**（`cba24ad` 接线共享 store：`LiveTailView.ets:491` / `MessageRow.ets:725` 同用 `reasoningKey(...)` 造键，`core/reasoningopen.ts` 承接跨 remount 恢复；`tools/tests/reasoning_wiring.test.ts` 钉调用点计数 + `reasoningopen.test.ts` 钉端到端往返）|
| L | 同一信息两处口径 | `core/ctxring.ets:113-123`(K) vs `core/statusfmt.ets:26-37`(k/`.0`) | `ContextRing.tsx:12-16` | 同一 token 数两套格式：环=`50K`（大写、整千无小数），状态条=`50.0k`（小写、<100000 留 `.0`）；web 两处都是大写 K | `ctxTokensAsK(50000)==='50K'` vs `humanTokens(50000)==='50.0k'` | **P2** | 状态栏统一改走 `ctxTokensAsK`（同一数字只留一套格式化） |
| M | 同一信息两处口径 | `core/ctxring.ets:99-106` vs `core/statusfmt.ets:52-55` | `ContextRing.tsx:18-20` | 同一百分比两套算法+兜底分叉：环 3 位无兜底，状态条 1 位且缺 percent 用 used/max 兜底 | `p=80.444`→环 `"80.444"`、状态条 `"80.4"` | **P2** | 共用同一取整函数与「缺 percent 不显示」策略（web 环语义为准） |
| N | 陈旧/复位 | `components/MessageRow.ets:162`(行内 `@State regionStatus`)/`:368-378` | `useRegionWindow.ts:29,64,130` | 区域加载**失败无计数**（web `MAX_AUTO_REGION_FAILURES=2` 保守停）；且 `regionStatus` 是行内持久 `@State`，行被复用时不按 `turnID` 复位 | 行复用 + `status='error'` → 新 turn 仍显示「加载失败·重试」；弱网无限自动重试 | **P2** | 加 `regionFailStreak`（≥2 只手动重试）+ `onAppear`/key 按 `turnID` 复位 |
| O | 同一信息两处口径 | ✅ **已修（前波）**：`core/subagent.ets:isRootVisible` 现只认 `running\|pending`（`active` 仅进 `subStatusKind` 卡片图标） | `SubAgentProgressTree.tsx:56,68` | ~~根过滤含 `active`~~ | — | **P2** | ✅ 已完成 —— 此行仅供追溯 |
| P | 同一文件两口径 | ✅ **已修（前波）**：`core/statusfmt.ets:goalText` 现只认 `'completed'`（幽灵 `'done'` 分支已删，注释标 H6） | `GoalBanner.tsx:37` | ~~goal「已完成」两份口径~~ | — | **P2** | ✅ 已完成（`goalText` 单点认 `completed`）—— 此行仅供追溯 |
| Q | 同一信息两处口径 | ✅ **已修（前波）**：`core/statusfmt.ets:currentTodo` 现**委托 `todoState().currentText`**（与面板同源） | `useTodos.ts:41` | ~~「当前任务」两套判据~~ | — | **P2** | ✅ 已完成（与面板同源）—— 此行仅供追溯 |
| R | 键不稳定 | `components/MessageNav.ets:245-247`；`core/subagent.ets:124-126` | `MessageUserNav.tsx:175`；`SubAgentProgressTree.tsx:63` | ArkUI 适配手法：`ForEach` key 编入 `active`/内容指纹（web key 恒定）⇒ activeSeq/描述变化即重建。**平台被迫**（key 不变则不重估 `@Prop`） | 滚动改 `activeSeq` ⇒ 两项重建；`desc` 同长异文 ⇒ key 不变（可能不刷新） | **P2** | 有据差异，不改行为；如需减闪动改 `@Observed/@ObjectLink`。SubAgent 的 `desc.length` 建议改全文/哈希 |
| S | 文档过期 | `docs/WEB-ALIGNMENT.md:457-464` | `core/toolstatus.ets:17-19` | 文档 13.3 写「live pending 一律按执行中渲染」，已被 `toolstatus.ets`（pending 必须「排队」）推翻 ⇒ 两处必有一份过期 | 直接比读两处文本 | **P2** | 拍板后订正该段（本轮只读未改） |

**确认无分歧（防假阴性）**：done 的 chip/形态（两边都安静、描边绿勾）；pending 的 pill 色（两边都 `text-muted`）；
pill 上限 8/前 7+`+N`；`mergeToolRuns` 合并规则（head 可带文本/成员须 tool-only/保 head 迭代号/顺序=首现序/`tools_folded` 聚合）；
「是否可点」恒可点；形态 if 链各只有一处；busy 单一入口（`indicators.busyNow` 被 composer 与占位共用）；
导航项数=用户行数；`nearestSeq` 顺序累加口径；usage 陈旧清理（`available=false` 不挂载环）；
todo 词汇全仓单一口径（`pending|doing|done`）；todo 完成度/百分比；goal 横幅可见性/编辑提交守卫；
SubAgent 状态归档/展平顺序；AskUser 面板状态复位与提交后清空。

---

### 11.10 波3 交付与销账（2026-10-11）—— **如实区分「已接线 / 逻辑就绪待接线」**

> ⛔ **纪律**：本表**不把"纯逻辑已就绪"记成"已有"**。判据是**用户能否在界面上真的用到**（本仓已有"纯逻辑先行、UI 待接线"的波次习惯，这正是最容易产生假进度的地方）。

| 项 | 原判 | 现判 | 证据 / 余量 |
|---|---|---|---|
| AnsiText（ANSI SGR 着色） | ❌ | ✅ **已接线**（⚠️ **2026-10-11 深晚订正**：原判「消费点未接线」**已过时**） | `core/ansi.ets`：解析 `9ad6c30`、本仓色板映射 `10aae43`；**消费点 `0af6ef3`（SyntheticCard 逐 span）+ `bed4672`（live pill 标签）** ⇒ 5 组件真消费（`MessageRow`/`ToolVisual`/`SyntheticCard`/`LiveTailView`/`ToolPopover`）；判据 `ansi_wiring.test.ts` **13 断言** + `ansi.test.ts` 钉 web 字节对齐 |
| 最近工作目录 | ❌ | 🟡 **纯逻辑就绪；UI 未接线** | `core/recentdirs.ets`（`10aae43`，键/版本/上限 5 逐字对齐 web） |
| 命令路由 / 深链 | ❌ | 🟡 **仅解析与校验就绪；派发未接线** | `core/command.ets`（`10aae43`）—— 设计上**只解析**，副作用留给页面 |
| 消息注释 / 高亮 | ❌ | 🟡 **数据面就绪；UI 未接线** | `core/annotations.ets`（`10aae43`），含**两种序列化**（草稿存储 / 出站信封） |
| 插件面（目录 / widget / 桥 / WebSurface） | 🟡❌ | ✅ **三面进设计系统 + widget 数据面 + 桥 page→native** | `f5e7163` `9bda52d` `910b420` `30069bb` `8b036aa` `5f04360`；另**消掉 `PluginWidgets` 孤儿**（恢复编译期检查，原为假绿） |
| 逐模型配置 `update_per_model_config` | ❌ | 🟡 **纯逻辑就绪；编辑器接线中** | `7d418a9`；入口唯一性需守（`REDESIGN §5`） |
| 通知：长文本形态 | ➖ 原生加值 | ✅ `notify.ets` 新增 `long_text`（≤3072B，单段长回复不再被 1024B 硬截断） | 另新建 `docs/NOTIFY.md`；**后台常驻接收平台不给三方**（明账见该文档） |
| 白主题（porcelain）/ 开屏 | ❌ | 🟡 **样张 + 规格已入档；代码落码中** | `26cd7f7` `0508d2f`；`docs/mockups/{porcelain,splash}.html`、`docs/SPLASH-SPEC.md` |

**本波暴露的两处"过期台账"（已就地订正，见上）**
1. `§11.5 证据 ⑥`「`grep ansi → 0`」→ **过期**：`core/ansi.ets` 于 **当日 09:43** 被并行线落地，**晚于**本审计（09:35）。
   ⇒ 审计没错，是**被审计对象在审计后 8 分钟就变了**。**教训：判据必须带取证时刻。**
2. `§11.9` 的"纯逻辑可先行候补四项"→ **已全部交付**（纯逻辑层）。

### 11.11 波4 候选盘点（2026-10-11 第二遍）—— 只读审计

> **目的**：`§11.9` 的"纯逻辑可先行候补"已被本波消耗完（四项纯逻辑 + 前置 + 逐模型配置 + 插件面 + 通知 + 开屏），
> 需要**下一批可派清单**。本节重过 `§11` 的**剩余项**（`§11.5` ❌ 全 12 条 + `§11.7` Top10 未结项 + `§11.2/§11.3` 的 🟡）。
> **依赖分档**：**A** = 纯逻辑可先行（不碰 `pages/`、不改 `core/` 契约）｜**B** = 需 `pages/Index.ets` 接线｜
> **C** = 需改 `core/` 契约（跨线）｜**D** = 需服务端（REST/RPC 能力）。可复合（如 `A+B`）。
> **可感度**：高（用户每天用）/ 中 / 低（边角）。⛔ 本轮**只读**，未改任何代码/测试；file:line 均在本轮工作树实测。

#### 11.11.1 ⛔ 已被本波消耗（**别重复派单**）

| 项 | 消耗证据 | 现判 |
|---|---|---|
| 四项纯逻辑（AnsiText 色板映射 / 最近目录 / 命令深链 / 消息注释） | `10aae43`（+ 前置 `9ad6c30`）；`core/{ansi,recentdirs,command,annotations}.ets` | 🟡 逻辑就绪，**UI 未接线** |
| **消息编辑并重发/回退（rewind）纯逻辑** | `core/msgops.ets:307-372`（`RewindReq`/`RewindTarget`/`rewindTargetDBID`）+ `core/store.ets:1086-1104`（`rewindTo` REST）+ `tools/tests/msgops_rewind.test.ts` | 🟡 **逻辑（含 REST）就绪，UI 未接线** ⇒ ⛔ **不算"缺失"** |
| 逐模型配置 `update_per_model_config` | `7d418a9` `22c3f01` `c16d96a`；`core/permodelcfg.ets` | 🟡 逻辑就绪（编辑器接线中） |
| 通知长文本 + 通知设置分区（含正文隐私开关） | `bb0e1e3`；`core/notify.ets` `long_text`；`SettingsPanel` tab `notify` | ✅ 已接线 |
| 插件三面 + JS 桥 + widget 数据面 + 设置分区 | `f5e7163` 等；`components/{PluginHost,SettingsPlugins}.ets`（`SettingsPanel` 已 import，tab `plugins`） | ✅ 已接线 |
| **SSE REC / Developer 模式** | `core/sserec.ets`（对齐 `useSSERecorder.ts:30`/`useDeveloperMode.ts:1`）+ `components/SettingsDeveloper.ets`（tab `developer`） | ✅ **已接线** |
| **Channels 设置分区** | `core/channelscfg.ets` + `components/SettingsChannels.ets`（tab `channels`） | ✅ **已接线**（§11.3 原记 ❌，已过时） |
| **渠道过滤 ChannelPicker** | `core/sessionpick.ets:128 availableChannels`/`:192 sessionInChannel` + `Index.ets:348 activeChannel`/`:5412` UI | ✅ **已接线**（§11.7 #5 原记"只差 UI"，已过时） |
| **StagingTray interject/clear** | `core/store.ets:1043 clearQueue`/`:1079 interjectQueued` + `Index.ets:2560/2565` + `components/QueueSheet.ets` | ✅ **已接线**（§11.7 #4 已过时） |
| **web_widgets/plugin_widgets 不静默丢** | `core/panels.ets:182+` + `core/widgetsview.ets:25-26` + `core/store.ets:119` | ✅ **已接线**（§11.7 #3 已过时） |
| **LLM import/export_subscriptions** | `core/llmcfg.ets:96+` + `components/SettingsLlm.ets:597/608`（`RPC_IMPORT/EXPORT_SUBSCRIPTIONS:67-68`） | ✅ **已接线**（§11.3 原记 🟡，已更正） |
| 开屏 | `147b412`；`core/splash.ets` + `components/SplashOverlay.ets` + `pages/Index.ets`（接线）| ✅ **已接线**（迟滞闸门：快启动不开屏、慢加载才播动画；§12.1 FOLLOW_APPLICATION 落地；T2 = `animEaseOut()`） |

#### 11.11.2 剩余候选（逐项：web → 原生 → 分档 → 可感度 → 优先级）

| # | 功能 | web 权威 `file:line` | 原生现状 `file:line` | 分档 | 可感度 | 优先级 |
|---|---|---|---|---|---|---|
| 1 | **AnsiText 接色** | `AnsiText.tsx:205`（3 消费点） | `core/ansi.ets` 就绪；`components/MessageRow.ets`/`ToolPopover.ets` **未接** | **B**（只在 `components/`，**非热文件**） | 高 | **P1** |
| 2 | **rewind 入口** | `UserMessage.tsx:31,114,149`；`AgentPanel.tsx:929` | `store.rewindTo`(`store.ets:1086`) 就绪；**无长按菜单** | **B** | 高 | **P1** |
| 3 | **会话导出（`json`/`jsonl`/`txt`；⛔ 无 markdown）** | `SettingsDeveloper.tsx:60-92`（turn+iter=txt）+ `agent/api.ts:378-582`（native/openai=json、codex/multica/benchmark=jsonl） | **纯逻辑已交付 `a7e6ffc`**（`core/export.ets`，78 断言）；**UI 入口未接线**（需 `core/rpc.ets` 补 `export_session`/`export_session_jsonl` + `Index.ets` 接菜单/设置） | **A✅ + B** | 中 | **P2** |
| 4 | PathPicker / cwd 选择 | `PathPicker.tsx:36` + `recent-workdirs.ts:12` | `core/recentdirs.ets` 就绪；无选择器（`Index.ets:1787 newSession()` 直建） | **B** | 中 | P2 |
| 5 | 命令深链**入口** | `commandRouter.ts:61,136` | `core/command.ets` 就绪；`EntryAbility.ets:123 captureOpenChat` 仅 chatId | **B**（+可能 C） | 中 | P2 |
| 6 | SessionViewBar「全部折叠/展开」 | `SessionViewBar.tsx:34` | 分类切换 ✅；批量切换 **grep 0 命中** | **B** | 中 | P3（XS） |
| 7 | NewSessionDialog（渠道 + cwd + label） | `NewSessionDialog.tsx:34` | `Index.ets:1787` 直接 `createSession()`（默认渠道/无 cwd/无 label） | **B**(+C) | 中 | P3 |
| 8 | SessionInfo（cwd 可编辑 / 消息数 / 最后活跃） | `sidebar/SessionInfo.tsx:40` | `Index` 的 `StatusSheet`；缺这 3 项 | **B** | 中 | P3 |
| 9 | Synthetic / Interrupt 卡 | `SyntheticToolCard.tsx:393,568` | **0**（仅 `core/agent_normalize.ts:166` 注释） | **A**(先定 web 语义) + **B** | 中 | P3 |
| 10 | ShellPromoteBar | `ToolRender.tsx:483` | 后端 promote-to-background RPC **已有**（`core/chattypes.ts:55`）；**UI 0** | **C**(核 RPC 契约) + **B** | 中低 | P4 |
| 11 | 设置 General「清缓存」 | `SettingsGeneral.tsx:32` | **grep 0 命中** | **B** | 低 | P4 |
| 12 | 设置 Appearance「UI_MODE」外壳切换 | `SettingsAppearance.tsx:54` | `ui_mode` 已到状态机（`core/render.ets:31`）但**无 UI 消费**（死字段） | **B**(+C) | 低 | P4 |
| 13 | 分享页（token 只读） | `SharePage.tsx:33` | **0 命中** | **A+B+D**(REST token) | 中低 | P4 |
| 14 | FoldedToolGroup 组内分组标头 | `FoldedToolGroup.tsx:716` | 有跨迭代合并/`+N`；**缺组内按 kind 分组标头** | **B** | 低 | P4 |
| 15 | InfoBar（插件状态条） | `InfoBar.tsx:15` | 仅 `core/widgetsview.ets:182` 的名称映射，**无状态条组件** | **B** | 低 | P4 |
| 16 | 选区工具条（tiptap B/I/链接） | `SelectionToolbar.tsx:48` | **0 命中** | **B** | 低 | **存疑**（tiptap 不适用，见 §3） |
| 17 | Ambience 壁纸/主题 | `AmbienceRoot.tsx:40` | **0**（仅 `core/pluginhost.ets:240` 注释） | **B** | 低 | ⛔ **不建议迁**（§11.7） |

> **A 档（纯逻辑可先行）已近枯竭**：上表唯一还剩的 A 档 = **#3 会话导出**（序列化纯逻辑，**已交付 `a7e6ffc`**）与 **#9 卡数据面**（待先定 web 语义）。
> 其余全部是 **B**（等 `pages/Index.ets` 释放）或 **C/D**。⇒ 下一波的调度瓶颈从"纯逻辑池"转为"**`Index.ets` 释放时机**"。

#### 11.11.3 专项核实：rewind 是否已有纯逻辑？—— **是（不是缺失）**

- **纯逻辑**：`core/msgops.ets:307-372` —— `RewindReq`（`POST /api/history/rewind` 请求体，字段逐字对齐服务端
  `channel/web/web_api.go:266-270`）、`RewindTarget`、`rewindTargetDBID(rows, target)`（逐字对齐 web
  `web/src/components/agent/rewind.ts:33 resolveUserMessageDBID`：`turnID>0` 精确匹配 / `turnID=0` 反向扫取**最新**同内容）。
- **REST 层**：`core/store.ets:1086-1104` `rewindTo(historyId, editedContent)`（含"`<=0` 直接拒绝 —— 服务端亦 400"）。
- **判别力测试**：`tools/tests/msgops_rewind.test.ts`（3.3KB，含重复内容/缺 dbID/请求体字段防 `DisallowUnknownFields`）。
- ⇒ **结论**：rewind 属 **🟡 逻辑就绪待接线**（缺的只是 `UserBubble.ets` 的编辑态 + `Index.ets` 长按菜单入口），
  **不计入"缺失"**；派单应写成"**接线**"而非"实现"。（本条同时订正 `§11.5 ①` 与 `§11.7 #2` 的旧判"仅无 UI/接线级"。）

#### 11.11.4 结论：**若只能再派 3 条线**（按 用户可感度 × 依赖解除难度）

1. **AnsiText 接色**（分档 B，但**不碰 `Index.ets`** —— 只改 `components/MessageRow.ets`/`ToolPopover.ets`）
   —— 可感度**最高**（工具/shell 输出是最高频呈现面），逻辑已就绪，且**能绕开当前被占用的热文件** ⇒ 最易解除。
2. **rewind 入口接线**（分档 B）—— 可感度**高**（唯一能改写历史错字的操作），**REST + 纯逻辑已全就绪**，
   剩的是 `UserBubble` 编辑态 + `Index.ets` 长按菜单（接线级）；是 `§11.7 #2` 的兑现。

> **2026-10-11 追加（用户消息菜单的 web 逐条对照，已核 `UserMessage.tsx:243-334`）**：
> · ✅ **已对齐**：`user-rewind`（编辑并重发）的**禁用态** —— web `:322 disabled={editDisabled}`
>   （灰 0.2 + 不可点）⇒ 本仓 `core/ctxmenu.userMenuItems(canRewind)` 把该菜单项**置灰**（复用
>   `MenuSheets.CtxItem` 的 `dim`：可见但派发被拒）；`copy-token`/`user-text` 恒可用。
> · 🟨 **有意收窄（记档）**：web 在气泡旁有**常显的内联图标按钮** Copy(`:301-314`) / Pencil(`:315-334`)；
>   本仓按**触屏铁律**（多个行内操作折叠成 `⋯`/长按菜单）改为**长按菜单项** —— web 自己的注释
>   `:309`/`:324` 也承认触屏需常显 44px 热区，故这是**有意不同**，非缺项。
> · 🟨 **低价值（记档）**：web 的 user 气泡包在 `CopyTarget kind="message"`(`:243`) ⇒ 长按得**消息粒度
>   4 变体**（reply/含思考/含工具/raw）；本仓 user 菜单为 **2 项**。user 消息**无思考/无工具**，
>   4 变体里 3 个是空输出 ⇒ **低价值**，暂不扩（若日后要扩，走 `ctxKind='user'` 的项集即可）。
3. **会话导出 `json`/`jsonl`/`txt`**（分档 **A+B**）—— 可感度**中高**（手机端分享/上报常用），
   **纯逻辑已交付 `a7e6ffc`（A✅）**、不占热文件；**仅剩 B 档入口**（`Index.ets` 接菜单/设置）；是 Top10 #9 且填补 §11.5 ⑧ 的一半（另一半分享页需服务端）。

> 备选（若调度只认"纯逻辑、零 `Index.ets` 依赖"）：**#3 会话导出** + **#9 卡数据面**（需先拍 web 语义）——
> 但前者仍需 B 档入口才可见，后者价值中；**当前真正的高可感项都卡在 `Index.ets` 上**。

#### 11.11.5 明账

- 本节**只读**，未改任何代码/测试；行号基于本轮工作树，`Index.ets`/`components/*` 正被多线并发改 ⇒ **以锚点文本为准**。
- 本轮**更正 5 处过期旧判**（均已在上表就地标注）：`§11.3` Channels ❌→✅、`§11.3` LLM import/export 🟡→✅、
  `§11.7 #3/#4/#5` ❌/🟡→✅、`§11.5 ①`/`§11.7 #2` rewind（已具纯逻辑）。
- ⛔ 仍未接线的高可感项 = **AnsiText 接色** + **rewind 入口**（两者均**逻辑就绪**，**只差 UI**）。

### 2.9 spec（待排期，主 agent 已裁决「原生应当消费」）——插件玻璃/壁纸/柔焦值未下沉

- **现状（不同源）**：真值来源 = 插件后端值 `plugin_config_get` 的 `glassOpacity`(0.5..1.0) /
  `wallpaperOpacity`(0.1..1.0) / `glassBlur`(0..24)（`core/settingsplugins.ets:782` 仅注释引用）；
  **原生端 0 消费点**，而 `core/theme.ets:755 e.glassBlur = 18` 是**写死**的
  ⇒ 用户在插件里调这三项，**原生玻璃面板/壁纸像素毫无变化**（只在插件自己的 Web UI 内生效）＝期望落空。
- **裁决**：原生**应当消费**（web 侧生效 ⇒ parity 要求原生也生效）。
- **建议下沉点**：`core/theme.ets` 的 `effectsOf`（与 `paletteOf` 同级 —— 与强调色修法同构：
  应用级覆盖下沉到唯一取值入口，而不是散在各消费点）。缓存键需含这三个值。
- **判据**：改插件 `glassOpacity` ⇒ 原生玻璃面板像素变（真机逐点量像素，方法见 §17.7 的像素量法）；
  纯逻辑测试 = `effectsOf` 在给定覆盖下逐值断言 + mutation。
- **归属**：`core/theme.ets` 现归 **brand-impl**（在落浅色专属参数）⇒ **排期由主 agent 串行处理**。

### 2.10 `KEY_SURFACE`（承载方式 原生 / 内嵌 ArkWeb）—— **有意"首达一次"，改了需重进页面**

- 取值 `'native' | 'web'`（`components/SettingsAppearance.ets:51-52`）；写入口 `pages/Index.ets:4808`，读入口 `:1419`。
- ⚠️ **生效时机 = 下次进入页面**（不是立即）：`Index.ets:1419` 由 `surfaceApplied` **一次性闸门**保护，
  注释明写「**只在设置首次到达时套用一次，之后尊重用户本次切换**」。
- **这是有意设计**（防"聊天进行中"被强制换面 ⇒ 丢上下文）。⛔ 不是 bug，别报障。
- 守护：`tools/tests/settings_apply_path.test.ts`（断言设置键的读取不在 `aboutToAppear`/`onPageShow`
  等一次性钩子里；`KEY_SURFACE` 在白名单内并注明本理由）。
- web 侧**无此键**（原生独有）⇒ 不涉及 parity 对齐。

### 2.11 设置分区「错误态可重试」—— 只对齐 web 给了重试的 **3 个**分区

- **web 权威取证**：`grep -rlnE "重试|Retry|retry|刷新" web/src/components/settings/*.tsx`
  ⇒ 仅 **`SettingsAbout.tsx` / `SettingsAgent.tsx` / `SettingsPlugins.tsx`**（另 2 个命中是 `.test.tsx`）。
- ⇒ 原生**只对这三对齐**：`components/SettingsAbout.ets` / `SettingsAgent.ets` / `SettingsPlugins.ets`
  把 `canRetry` / `onRetry` 透传给共享的 `SettingsErrorBar`（`SettingsRows.ets`，新增两 prop + 「重试」入口）。
- ⛔ **其余 5 个分区不报障**：`SettingsLlm` / `SettingsStorage` / `SettingsChannels` / `SettingsTools` /
  `SettingsWebUsers` —— **web 亦无重试** ⇒ 给它们加 = **超出 parity 的臆造**（判据里有反向断言钉住）。
- ⚠️ **`onRetry` 必须真的重发该分区自己的请求**（⛔ 空实现 = 假重试）。第三层（页面侧注入回调）
  归主 agent；判据 `tools/tests/settings_error_retry.test.ts` 只钉"组件侧已接线"，不替代端到端。

### 2.12 设置分区「用户可见文案」—— 白名单 + web 出处

- **`'重试'`** ≈ web `src/i18n/zh-CN.ts:16`（`retry: '重试'`）⇒ **逐字一致**。
- **`'加载中…'`**（单省略号）≈ web `zh-CN.ts:232`；⚠️ web 自身两版并存（`:14 '加载中...'` 三点 / `:232 '加载中…'`）
  ⇒ 本仓**统一取 `:232`**，⛔ 不混用三点版（判据里有反向断言）。
- ⚠️ **错误正文判"有意不同"、不改**：本仓走 **RPC 原文**（`readableRpcError`）+ 分区专属文案
  （如 Agent「设置读取失败，开关暂不可用。」），信息量 **大于** web 的固定 `'加载失败'`（`zh-CN.ts:592`）。
- 守护：`tools/tests/settings_copy_parity.test.ts`（文案常量白名单 + 逐字断言 + 三点版反向断言）。

### 2.13 设置对齐 web —— **现状报告**（2026-10-11 收口，每条附判据名）

> 口径：本节是目标③的**结论汇总**。⛔ 每条尽量挂判据；`docs_claim_evidence` 会校验 `✅` 行声称的判据文件是否存在。

#### A. 已对齐（有 web 权威 / 有判据）

| 面 | 结论 | 判据 |
|---|---|---|
| **键名 / 命名空间** | 真共享 8 键双向映射逐字正确；原生独有 8 键落 `web:` 命名空间；web 独有 6 键**不收录且原样透传（零丢键）** | `settings.test.ts`（键表 parity 守卫）、`settings_keys_consumed.test.ts`（每键必须有消费点） |
| **可选值集合** | accent 6 预设**逐值同序**；md-theme 23 套**逐 id 同序**（含首末锚点）；send-key 2 值 + **默认 `ctrl-enter`** + 历史 `mod-enter` 归一 | `settings_value_sets.test.ts` |
| **生效路径** | 每个设置键的读取都在 **build/派生方法**里（⛔ 不在 `aboutToAppear`/`onPageShow` 等一次性钩子）⇒ 改了就生效 | `settings_apply_path.test.ts`（**A~E 五种读法全覆盖**） |
| **错误态可重试** | 三个有 web 权威的分区（About / Agent / Plugins）已接线：`SettingsErrorBar` 加 `canRetry`/`onRetry`，页面注入真回调（含**假重试反面板**：Plugins 必须调 `loadPluginCatalog` 而非 `loadSettings`） | `settings_error_retry.test.ts` |
| **文案** | `'重试'` ← web `zh-CN.ts:16` **逐字一致**；`'加载中…'` ← web `:232`（统一单省略号，⛔ 不用 `:14` 三点版） | `settings_copy_parity.test.ts` |
| **主题/强调色/渐变端** | 强调色下沉到唯一取色入口 `paletteOf`（组件全生效）；渐变端护航白字 ≥4.5 | `accent.test.ts`、`theme_contrast.test.ts`、`theme_contrast_matrix.test.ts` |

#### B. 有意不同（附理由 + 出处）

| 项 | 本仓 | web | 理由 |
|---|---|---|---|
| `font-scale` / `app-theme` / `orb` / `reasoning-default` | 有（原生独有） | **无** | 平台能力（字号档 / 应用主题 5 套 / 思考光球 / 思考默认展开） |
| `KEY_SURFACE`（原生 / 内嵌 ArkWeb） | 有 | **无** | 原生独有；⚠️ **首达一次生效**（`surfaceApplied` 闸门，防聊天中被强制换面） |
| 错误正文 | **RPC 原文** + 分区专属文案 | 固定 `'加载失败'`(`zh-CN.ts:592`) | 本仓信息量更大（见 §2.12） |
| `SettingsLlm`/`Storage`/`Channels`/`Tools`/`WebUsers` 无重试 | 无重试 | **web 亦无** | 超出 parity 的臆造禁止（见 §2.11） |
| `notify` 分区 / 通知偏好 | 有（原生独有） | 无 | 系统通知权限是端能力 |

#### C. 仍未对齐 / 未做（含卡点）

| 项 | 状态 | 卡点 / 需谁 |
|---|---|---|
| **语言可写**（web 有 3 语言 select + 清除缓存） | ❌ 只读 | 需先建 **i18n 文案表**（本仓 UI 文案硬编码中文）⇒ 大重构，未排期 |
| **UI 外壳模式**（web 三档 auto/desktop/mobile） | ❌ 键在、**零消费** | 原生单手机布局 ⇒ N/A；键**保留**（删了会让 web 侧设置丢） |
| **布局 tab**（web VSCode 式面板） | ❌ 无 | 平台差异 N/A |
| **`glassOpacity`/`wallpaperOpacity`/`glassBlur`（插件值）** | ✅ **已具备消费能力**（`ae3a448`）· **待接线** | 落点已就绪：`core/theme.ets` 的 `setAmbience(v\|null)`（**覆盖式**：`null` = 未设置 ⇒ 逐字节走现状；非空 ⇒ 覆盖 glass alpha 与 `e.glassBlur`；clamp 内建）。⚠️ **值无客户端抵达路径**：`xbot.ambience` **无 `web`**（纯后端插件）⇒ 服务端 `serverapp/rpc_table.go:2293-2296`（`if e.Manifest.Web == nil \|\| Entry == "" { continue }`）**整条跳过** ⇒ 客户端收不到。⇒ **今日无调用点**（⛔ 不是死代码：一旦有客户端插件供这三个键，一处调用即生效）。**`wallpaperOpacity` 亦原生 N/A**（web 独有，`grep -rn wallpaper entry/src/main/ets/` 为空） |
| **`KEY_UI_MODE` 之外的 web 独有键**（`leftSidebarWidth`/`layout:*`/`panel-layout*`/`recent-workdirs`） | ➖ 不映射 | 桌面布局概念，原生 N/A；`localKey` 原样透传 ⇒ 零丢键（§17.5-5） |
| **notice 档分场景时长**（web 成功 5000 / 失败 4000 vs 原生单档 2560） | ⏸ **已换手** | 交 `chat-surface-ux`（本轮我连卡 3 轮；取证与补丁见交付记录，`web ToolRender.tsx:508/514`） |

### 2.14 `SettingsPanel` 分段 chip 的「非填充分界」—— **已具备，无需改动**（2026-10-11 实测）

- `brand-impl` 报 §15 同类缺口疑似在 `components/SettingsPanel.ets:294`（`surface.chip` 面）。
- **实测（读真源，不猜）**：
  · `hairlineOf(p)` = `surfacesOf(p).hairline` —— **不分深浅**（`core/design.ets:371-373`）；
  · `insetHairlineOf(p)` = 浅色 ⇒ `p.transparent`；深色 ⇒ `surfacesOf(p).hairline`（`:841-843`）；
  · ⇒ **深色下两者同值**；该 chip 的 `.border` 已用 `hairlineOf`（`SettingsPanel.ets:296-298`）
    ⇒ **深色已具备非填充分界，无需改动**；浅色下 `hairlineOf` 仍给发丝（⛔ 若改用 `insetHairlineOf`
    会把浅色变成 `transparent` ⇒ **违反"浅色逐字节不变"**，故**不改**）。
- **结论**：按"先量后改"的分流第 1 支 ⇒ **不改码**，仅本记档。若后续 §15 的度量口径另有要求，
  请以"深色净贡献 ≥1.20"的实测为准再议。

---

## §X 功能面差集审计（波11 · 2026-10-11 · 只读盘点）

**做法**：先读本文件 §3「刻意不做」+ §8.4「架构不适用 6 类」+ §11.5/§16 的既有判定 ⇒ **不重复列已判定项**；
再从 web 的 `src/components/{agent,panel,session,sidebar,settings,ui}` 逐模块名**按功能**核对原生
（⚠️ **不按名 grep** —— 本仓踩过"换个名字就报缺失"；有实现但**零消费者**也算"无"）。

**结论：模块级差集里，真正"新增项"只有 1 条**（其余要么已迁、要么已在台账、要么已判不做）。

### A. 🆕 新条目（本轮唯一新增）

| web 模块 | web 落点 | 原生现状 | 原生落点/缺 | 用户可见价值 | 建议 |
|---|---|---|---|---|---|
| **@ 提及 / 斜杠命令的候选补全** | `components/agent/CompletionPopup.tsx:1`（"floating candidate list above the message input"）+ `hooks/useCompletion.ts:137,343`（`trigger = '/' or '@'`，↑↓ 导航） | ✅ **已实现**（原判"无"**已过时**：P11 `181a6a6` 已落地 `core/composer.ets` 纯逻辑 + `Index.ets` 浮层；本波补齐两处缺口） | 缺口（本波已修）：① `matchFiles` 曾"存在且被测"但**页面零调用** ⇒ `@` 补全不按前缀过滤（现经 `Index.ets:fsMatches()` 真消费）；② 无选中态/键盘导航（现补 `cmdSel` + `selNext/selPrev/completionKeyAction` + `onKeyEvent`/`onSubmit`） | **中–高**（@提及/命令**发现性**：用户不知道有哪些命令可用） | **已做**（判据 `tools/tests/completion.test.ts`，4 个 mutation 自证） |

### B. ✅ 可**结项**（本轮把台账里"待核/存疑"按功能复核后结掉）

| 项 | 台账原状态 | 本轮复核结论 |
|---|---|---|
| **会话搜索** | §428「**部分**（`core/sessionops.ets:72 sessionMatches` + `Store.search` + `Index` 的 `SearchHitsSheet`）… 已够用？**待核**」 | **按功能已具备**（搜索匹配 + 命中行 + 弹层三件都在）⇒ **结项，不必再做**；⛔ 除非发现缺"跨会话聚合"这类语义（本轮未发现）。 |
| **选区工具条（tiptap B/I/链接）** | §16「**存疑**（tiptap 不适用，见 §3）」 | **N/A 确定**：web 的输入是 **tiptap 富文本**才有选区工具条；原生输入是**纯文本** ⇒ 语义不存在。⇒ 从"存疑"改为**不做**。 |

### C. 已在台账（⛔ 不重复列，仅索引）

- **架构不适用**（6 类，走 ArkWeb 逃生舱）：GenUI · Mermaid · 文件树/Monaco/预览 · 终端 · Dockview（+ PWA）⇒ §3 / §8.4。
- **未迁/部分**（已登记，归各线）：消息操作菜单（§417：原生只有长按整条复制）· 消息注释/高亮（§418）·
  会话视图条（§424）· 新建会话对话框（§425）· 路径选择 cwd（§427）。
- **已迁**（本轮抽查确认）：`AnsiText`→`core/ansi.ets` · 消息操作菜单入口→`Index.ets:4908-4938` + `UserBubble.ets:70`（§496）·
  `FoldedToolGroup`（7 文件）· `CompactionDivider` · `ContextRing`（11 文件）· 图/代码/Diff 高亮（既批）。

### D. 优先级（用户可见价值 × 实现成本；高价值低成本在前）

| # | 项 | 价值 | 成本 | 归属 |
|---|---|---|---|---|
| 1 | **@ 提及 / 命令候选补全**（A） | 中–高 | 低–中 | **本波已做**：`core/composer.ets` + `Index.ets` 输入区；判据 `tools/tests/completion.test.ts` |
| 2 | 路径选择 cwd（§427） | 中 | 中（需 `pages/Index.ets`） | 已登记，待排 |
| 3 | 消息注释/高亮（§418） | 中 | 中–高 | 已登记，待排 |

### E. ⛔ 明确**不做**的（一句话理由，沿用本仓裁决习惯）

| 项 | 理由 |
|---|---|
| 选区工具条（tiptap） | 原生输入是**纯文本**，富文本选区语义不存在（本轮由"存疑"结为 N/A） |
| GenUI / Mermaid / 文件树·Monaco·预览 / 终端 / Dockview / PWA | **架构不适用**，统一走 ArkWeb 逃生舱（§8.4 既有裁决） |
| 会话搜索"再做一轮" | **已有实现**（`sessionMatches` + `Store.search` + `SearchHitsSheet`）⇒ 不必重复劳动 |

---

## §XI 设置面 **key 级差集**（波11 · 目标③ · 2026-10-11）

**做法**：web 侧以**代码里的 key 表**为准（`src/lib/userSettings.ts:20-45` 的 `SETTING_MAP` + 各
`components/settings/*.tsx` 里读写的 localStorage/RPC 键），⛔ 不看截图猜；原生侧以
`entry/src/main/ets/core/settings.ets` 的 `KEY_*` 常量表 + `components/Settings*.ets` 的控件为准。
web 的**服务端 RPC 配置面**（LLM/Storage/Channels/WebUsers/About/Agent/Tools）已由 §9 / §11.3 覆盖，
本节只补 **key 级（localStorage/设置表）** 的逐键差集。

### XI.1 Web 设置面的 key 清单（按 `userSettings.ts` + `settings/*.tsx` 取证）

| web key | 控件 | 缺省 / 范围 | web 落点 |
|---|---|---|---|
| `xbot-theme`（legacy） | —（md-theme 的 mode 现由 md 主题推导） | — | `types/theme.ts:24` |
| `xbot-accent` | 6 预设色板 + 自定义 hex | `#3388BB`；`#rrggbb` | `SettingsAppearance.tsx:132-196` |
| `xbot-md-theme` | 23 个 chip | `vscode-dark`（首项） | `SettingsAppearance.tsx:106-129` |
| `xbot-ui-mode` | 3 chip（auto/desktop/mobile） | `auto` | `SettingsAppearance.tsx:73-104` |
| `xbot-code-word-wrap` | 开关 | `true` | `SettingsInteraction.tsx:29-63` |
| `xbot-send-key-mode` | 2 单选 | `ctrl-enter` | `SettingsInteraction.tsx:66-106` |
| `xbot-locale` | 下拉（zh-CN/en/ja） | `zh-CN` | `SettingsGeneral.tsx:41-54` |
| （清除缓存·按钮） | destructive 按钮 + reload | — | `SettingsGeneral.tsx:55-60` |
| `xbot:developer-mode` | 开关 | `false` | `useDeveloperMode.ts:3` |
| `xbot:ambience` | 壁纸 + 玻璃透明度/模糊 | `''` | `SettingsAppearance.tsx`（ambience 组）/ `ambience/store.ts:77` |
| `xbot-starred` | 会话星标（列表项） | `''` | `useSessionStore.ts:36` |
| `xbot:session-category` | 分类切换（path/status/time） | `path` | `useSessionStore.ts:37` |
| `xbot:session-collapsed-groups` | 折叠组（列表） | `''` | `useSessionStore.ts:43` |
| `xbot:session-unread` | 未读（列表，UI 态） | `''` | `useSessionStore.ts:44` |
| `xbot:active-channel` | 渠道过滤（UI 态） | `''` | `useSessionStore.ts:45` |
| `xbot:recent-workdirs:v1` | 最近工作目录（PathPicker） | `''` | `recent-workdirs.ts:3` |
| `xbot:layout:overrides`/`:order`/`:collapsed` | slot 拖拽/排序/折叠 | `{}` | `layoutTypes.ts:87,90,103` |
| `xbot:panel-layout` / `-v2` | Dockview per-panel 布局 | `{}` | `userSettings.ts:37,39` |
| `xbot:leftSidebarWidth`/`Collapsed`、`xbot:leftbar:section-*` | 桌面侧栏拖拽/折叠 | — | `AppShell.tsx:56,57`、`SidebarSectionStack.tsx:28,29` |
| `xbot:update-reminder:dismissed:v1` | 更新提示已忽略 | — | `UpdateReminder.tsx:16` |

> 另有**服务端 RPC 配置面**（非 localStorage）：Agent（`allow_self_compact` + `vision_*` ×4）、Tools
> （`set_tool_enabled` ×N）、LLM（订阅 CRUD + `import/export_subscriptions`）、Storage（schema 驱动）、
> Channels（逐渠道字段 + 绑定）、WebUsers（list/create/delete）、About（check/apply_update/restart）、
> Plugins（`plugin_config_set` + 图标上传）—— 归属见 §9 / §11.3，本节不重复。

### XI.2 原生设置面（`core/settings.ets` KEY 表 + `Settings*.ets` 控件）

原生 KEY 表 16 个：`KEY_MD_THEME`/`KEY_ACCENT`/`KEY_LOCALE`/`KEY_SEND_KEY`/`KEY_CODE_WRAP`/
`KEY_UI_MODE`/`KEY_STARRED`/`KEY_FONT_SCALE`/`KEY_REASONING_DEFAULT`/`KEY_APP_THEME`/`KEY_SURFACE`/
`KEY_SESSION_CATEGORY`/`KEY_ORB`/`KEY_NOTIFY_ASK`/`KEY_NOTIFY_TURN_DONE`/`KEY_NOTIFY_DETAIL`。
其中 **`KEY_FONT_SCALE`/`KEY_REASONING_DEFAULT`/`KEY_APP_THEME`/`KEY_SURFACE`/`KEY_ORB`/
`KEY_NOTIFY_*`×3 是原生独有**（web 无此设置，§1）。

### XI.3 差集（web key → 原生是否支持）

| web key | 控件 | 原生支持 | 落点 / 判据 |
|---|---|---|---|
| `xbot-accent` | 色板 + hex | ✅ | `SettingsAppearance.ets:166-173` + `core/accent.ets` |
| `xbot-md-theme` | 23 chip | ✅ | `SettingsMdTheme.ets` + `core/mdtheme.ets` |
| `xbot-code-word-wrap` | 开关 | ✅ | `SettingsAppearance.ets:207-216` |
| `xbot-send-key-mode` | 2 chip | ✅ | `SettingsAppearance.ets`（`KEY_SEND_KEY`） |
| `xbot-starred` | 星标 | ✅ | `core/stars.ets` + `Index.ets` SessSheet |
| `xbot:session-category` | 分类 | ✅ | `Index.ets:4243` + `core/sessiongroup.ets` |
| `xbot:developer-mode` | 开关 | ✅ | `SettingsDeveloper.ets:45`（本地 prefs `xbot_devtools/developer-mode`） |
| `xbot-ui-mode` | 3 chip | ⛔ **N/A** | 原生**单手机布局**（无 desktop shell）⇒ `KEY_UI_MODE` 死字段白名单（`tools/tests/settings_keys_consumed.test.ts:146`）。保留键只为与 web 共享 key 表 |
| `xbot-locale` | 下拉 | ⛔ **N/A** | 原生 UI 文案中文硬编码 ~100 处 ⇒ 只读展示（§3） |
| `xbot-theme`（legacy） | — | ⛔ **N/A** | web 的 md 主题现驱动 mode；原生用 `KEY_APP_THEME`（5 套，原生独有）替代 |
| （清除缓存） | 按钮 | ⛔ **N/A** | web 的清缓存 = `clearWebCaches()`（会话树/进度快照/注释缓存）+ `location.reload()`；原生无 Service Worker、会话树缓存由 `core/store` 内存管理、markdown 解析缓存**有界**（`MD_CACHE_MAX_CHARS` 自动淘汰）⇒ 无对应可清对象，"清缓存"会是假功能 |
| `xbot:ambience`（壁纸） | 上传 + 滑杆 | 🟡 **缺** | 玻璃 `opacity`/`blur` 的**消费**已就绪（`core/theme.ets` 消费插件环境值）；**壁纸上传 UI 缺**（需相册/文件选择）。登记待做 |
| `xbot:recent-workdirs:v1` | 路径选择 | ⛔ **N/A** | 依赖 `PathPicker`（`§11.5 ⑦` 已判 N/A 方向：无原生 cwd 编辑入口） |
| `xbot:layout:*` / `panel-layout*` / `leftSidebar*` / `leftbar:*` | 桌面布局 | ⛔ **N/A** | Dockview/桌面外壳专属（§3 / §8.4） |
| `xbot:session-collapsed-groups`/`unread`/`active-channel` | 列表 UI 态 | ⛔ **N/A** | 原生会话列表无"折叠组"三态同步需求（分组折叠是本地渲染态，不跨端）；`active-channel` 属 `ChannelPicker` 过滤（§11.2 证据 ⑦） |
| `xbot:update-reminder:dismissed:v1` | 更新提示 | ⛔ **N/A** | 无 Service Worker（§11.3 PWA 行） |

**净差集**：web key 级共 **18** 项 → 原生已支持 **7**、**N/A 9**、**缺 1**（`xbot:ambience` 壁纸 UI）+ 1 待做
（LLM `import/export_subscriptions`，属服务端面）。**无"该支持却缺"的 key 级开关**。

### XI.4 本轮**补齐**：通知分区的 ask / turn-done 开关（原生独有键的 UI 缺口）

**缺陷形态**（与"死开关"同类，但方向相反）：`KEY_NOTIFY_ASK` / `KEY_NOTIFY_TURN_DONE` 两键
**有键、有消费链、无 UI 入口** —— `settings.notifyPrefsFrom` → `notify.applyNotifyPrefs`
（`core/store.ets:453` 唯一调用点）→ `notify.notifyPrefEnabled` → `store.notifyOnSse`；
但补齐前 `SettingsPanel` 的「通知」分区**只**暴露 `KEY_NOTIFY_DETAIL` ⇒ 用户**关不掉**
「收到提问时通知 / 回合完成时通知」（默认两类都开）。

**修法**：`components/SettingsPanel.ets` 的 `NotifySection` 由 1 行扩为 3 行（复用既有
`SettingsToolRow` 原子 + `setNotifyPref(key, next)` 统一写入路径，写后**回读**）；三个开关
显示值同源于 `notifyPrefsFrom`（判据与渲染同源）。

**判据**：`tools/tests/settings_notify_ui.test.ts`（20 断言）
- ① 三键都在 `SettingsPanel.ets` 有 **`setNotifyPref(KEY_NOTIFY_*)` 调用点**（计数 ≥1，⛔ 不钉"方法体存在"）；
- ② **消费点计数**：`notifyPrefEnabled` 真读 `prefs.ask` / `prefs.turnDone`（计数 ≥1）+ 运行期同源验证；
- ③ **mutation 自证**：抽掉 `notifyPrefEnabled` 里的 `prefs.turnDone` ⇒ 消费点计数归零 ⇒ 判据②必红；
- ④ 三键显示名非空（UI 不显示裸键名）+ `notifyPrefValue` 值域 `1/0`。

### XI.5 判 N/A 的依据（一句话汇总，⛔ 不许当"遗漏"）

`ui-mode`（单手机布局）· `locale`（文案硬编码）· `clear-cache`（无可清对象，会是假功能）·
`ambience 壁纸`（需相册选择，消费层已就绪待接 UI）· `recent-workdirs` / `layout:*` /
`panel-layout*` / `leftSidebar*` / `leftbar:*`（桌面范式，走 ArkWeb 或标签栏替代）·
`session-collapsed-groups`/`unread`/`active-channel`（本地渲染态，不跨端）·
`update-reminder`（无 SW）。


## §XII 插件面功能差集（波12 · 目标②「跟 web 一样支持所有原生插件」· 2026-10-11）

> **仅本节为本轮（波12）新增**（⛔ 未改任何既有段落；§8 / §11.3 的既有结论不重复审计）。
> **做法**：web 侧只读取证（`/Users/bobli/src/xbot/web/src/plugin-runtime/*`、`plugins/*`、
> `plugin-api/*`、`components/settings/Settings{Plugins,Channels}.tsx`、`components/session/ChannelPicker.tsx`）；
> 原生侧读 `components/{PluginHost,PluginWidgets,PluginsSheet,SettingsPlugins,SettingsChannels}.ets` +
> `core/{pluginhost,pluginview,widgetsview,settingsplugins}.ets`。
> ⚠️ **本轮未装机**（设备禁令）⇒「渲染是否可见」以代码/判据为准；凡需真机的行标注**待设备验证**。

### XII.1 逐面判定（8 类面，web file:line ↔ 原生落点）

| # | 面 | web 证据 | 原生落点 | 判定 |
|---|---|---|---|---|
| ① | 插件**发现/加载**（ESM 动态 `import` + 热重载 + 内置静态视图） | `plugin-runtime/usePluginRuntimeHost.ts:216-320,58-117`；`PluginView.tsx:78-184` | 无（由**权威宿主页** `components/WebSurface.ets` 承载） | **N/A（架构性）** —— §8.2/§8.6 已立论：插件产物是**同页 ESM**（顶层读 `window.React`/`__xbot_*`）⇒ 只有 web 本体跑得起来 |
| ① | 视图**枚举 / 容器分组 / i18n 标题** | `plugin-runtime/usePluginViewPanels.ts:41-78`；`i18n.ts:98-106` | `core/pluginhost.ets:535 buildPluginCatalog` + `:297/:324 containerLabel/containerRank`；渲染 `components/PluginHost.ets:140-168` | **✅ 已支持**（§8.5 真实 payload 复核过：i18n key 解析、只列带 web 的插件、相对 URL→绝对） |
| ① | 视图**图标**（lucide 名 → 宿主图标；未知 ⇒ `Puzzle`） | `plugin-runtime/pluginIcons.ts:30-56`（`ICON_MAP` 19 键）、`:61-77`（降级 `Puzzle`） | `components/PluginHost.ets:460 pluginSymbol`（**本轮 14→19/19**）；消费点 `:291`、`:390`、`PluginsSheet.ets:177` | **✅ 已支持（本轮收口）** —— 见 XII.3 |
| ② | 插件 **API `ctx`**（9 权限：events/commands/rpc/state/ui/plugins/config/files/share） | `plugin-api/context.ts:18-48`、`manifest.ts:13` | 无 | **N/A** —— 运行在宿主页内；§8.6 已**穷举证伪**「web 期望原生桥方法」的假设（web 侧 0 消费 `xbotNative`） |
| ② | 宿主**全局注入**（`__xbot_session__`/`__xbot_i18n__`/`__xbot_iteration__`/`__xbot_ui__`/`React`） | `usePluginRuntimeHost.ts:373-388`、`iteration-render.tsx:20-28`、`SandboxedUI.tsx:37-41` | 无 | **N/A**（同上；原生无 `window`/React 运行时语义） |
| ③ | 插件 **widget**：zones（styled spans）+ 声明式组件 | `plugins/PluginWidgetProvider.tsx:41-95`、`WidgetZone.tsx:14-69`、`components.tsx:37-259` | `core/widgetsview.ets:361 widgetsView` + `components/PluginWidgets.ets`；载荷接线 `core/store.ets:121-129` → `pages/Index.ets:1480-1482,3275-3276` → `PluginHost.ets:173-183` | **✅ 声明式 7 种齐**（`badge/progress/metric/sparkline/table/list/markdown`，与 web `components.tsx:236-259` **一一对应**）；`code`/`src` 仍降级（需 iframe 沙箱）。⚠️ **2026-10-11 收口 `sparkline`/`table`**（此前显式降级）——见 XII.5 |
| ③ | widget 的**常驻落点**（`infoBar` 状态条） | `plugins/InfoBar.tsx:15-27`（**常驻**，含 `PluginPanelContainer container="info_bar"` + `WidgetZone zone="infoBar" excludePrefixes={['git:']}` + `SWUpdateButton`）· 挂载 `layouts/MobileAppShell.tsx:483-487` · 另 `git-info/GitStatusPanel.tsx:41` | `core/widgetsview.ets:640-710 widgetDockView`（纯逻辑）+ `components/WidgetDock.ets`（细条渲染）+ 接线 `pages/Index.ets`（`ChatView` 的输入框**下方**） | **✅ 2026-10-11 已落地（信息栏 zone 口径）** —— `infoBar` zone 的 spans 落在聊天页常驻细条（空态**零占位**）；⚠️ **刻意分叉**：web 恒占 24px 条（含 SW 更新按钮），原生**无 widget 时零高度**（不改变既有布局）；`git:` 前缀 span 随 web 排除（web 由 fancy `GitStatusPanel` 呈现，原生无该视图 ⇒ 不重复显示）。见 XII.6 |
| ④ | 插件管理：**启用/禁用** + **重载** | `plugins/manager/PluginManagerPanel.tsx:82-127`（`plugin_reload` / `plugin_set_enabled` + 主动同步前端 runtime） | `components/SettingsPlugins.ets`（`RPC_PLUGIN_RELOAD`/`RPC_PLUGIN_SET_ENABLED`，`core/rpc.ets:1085,1087`）；判据 `core/settingsplugins.ets` | **✅ 已支持**（原生按用户要求收严为"写后回读"，不乐观更新） |
| ④ | 插件管理：**安装 `.zip`** | `PluginManagerPanel.tsx:129-143` → `installPluginFile`（`components/agent/api.ts:644-649`，`POST /api/plugin/install-file` multipart） | **无**（`SettingsPlugins.ets:19` 明示"本期不呈现"） | **⛔ 缺** —— 需文件选择 + multipart 上传；修点 `components/Settings*.ets`（**域外**） |
| ④ | **后端插件全量**视图（含**无 web 产物**者） | `PluginManagerPanel.tsx:52-76`（`plugin_status {rescan:true}` → script/grpc 运行时插件全貌） | **无** —— 原生只消费 `web_plugin_list`（`core/store.ets:1042`） | **⛔ 缺** —— 用户**看不到/管不了**纯后端插件；需新 RPC（`core/rpc.ets`，**域外**） |
| ⑤ | **组件面板**（按 slot 过滤 + `web_ui_action` 交互 + 沙箱） | `plugins/PluginComponentPanel.tsx:24-97`、`plugins/api.ts:16-47` | `core/widgetsview.ets` + `PluginWidgets.ets`（声明式已覆盖） | **🟡 半支持** —— 交互（`web_ui_action`）与 `code`/`src` 沙箱**架构性缺**（同 ① N/A 阵营） |
| ⑥ | 设置页**插件配置表单**（schema 驱动 + 搜索 + section + 7 控件 + 图片上传） | `components/settings/SettingsPlugins.tsx:60-196,485-666,221-354` | `components/SettingsPlugins.ets` + `core/settingsplugins.ets`（`plugin_config`/`plugin_config_set`；控件/校验/掩码/滑条/分组的判据全在 core） | **✅ 已支持**（含 `image` 上传，`core/settingsplugins.ets:834-1000`） |
| ⑦ | **频道**（内置 + 插件渠道；飞书一键绑定） | `settings/SettingsChannels.tsx:118-531`、`session/ChannelPicker.tsx:53-64` | `components/SettingsChannels.ets`（`FeishuBindPanel:345`、`feishu_app_guide`/`feishu_bind_start`/`feishu_bind_status`） | **✅ 已支持**（§11.3 上一批已订正"Channels 实际已实现"） |
| ⑧ | 其它贡献点（`messageRenderer`/`shareRenderer`/`toolbar`/`contextMenu`/`command`+`keybinding`/`setting`/`theme`/`ambience`/`eventHandler`） | `plugin-api/manifest.ts:112-122` | 无（`buildPluginCatalog` **只取 `kind:'view'`**，`core/pluginhost.ets:530,580`） | **N/A** —— 宿主**行为**扩展，无等价承载面（§8.3 亦已登记 `ui_mode`/`ui_surface` 为死字段） |
| ⑨ | **深链**到某个插件视图 | web **无**（仅应用内 `ctx.ui.openViewTab`）；`ui.ts:91-115` | 原生最多打开宿主页根（`core/pluginhost.ets:118 pluginPanelUrl`） | **N/A（web 侧缺）** —— §8.6 已记为"web 仓的活" |

### XII.2 差距清单 + 优先级（价值 × 成本）

| 优先级 | 差距 | 价值 | 成本 / 阻塞 | 备注 |
|---|---|---|---|---|
| **P0** | **widget 常驻落点（`infoBar`）** | **高** —— 此前 widget 在正常使用路径**完全不可见**（插件如 `xbot.git-fancy` 的状态一直"推了但没人看"） | `pages/Index.ets`（只加落点/接线）+ `components/WidgetDock.ets` + `core/widgetsview.ets` | **✅ 2026-10-11 已落地** —— 聊天页输入框下方常驻细条消费 `infoBar` zone（空态**零占位**）；判据 `tools/tests/widget_dock.test.ts`（35 断言 + 5 mutation）。见 XII.6 |
| **P1** | `plugin_status` **全量后端插件** | 中高 —— "支持**所有**插件"的直接需求（纯后端插件现无入口） | 新 RPC（`core/rpc.ets`）+ 管理 UI（`Settings*.ets`）—— **均在域外** | 需先把 `plugin_status` 加入 `core/rpc.ets` 常量表 |
| **P1** | **`.zip` 安装** | 中 —— 自助装插件（web 用户可自助，原生不能） | 文件选择 + multipart 上传；落 `components/SettingsPlugins.ets`（**域外**） | 参考 `installPluginFile` 的端点契约 `POST /api/plugin/install-file` |
| **P2** | widget **`sparkline`/`table`** | 中低 —— 真插件用得少但存在（`iteration-stats` 类偏 metric） | `core/widgetsview.ets` + `components/PluginWidgets.ets` | **✅ 2026-10-11 已落地**（此前是**显式降级行**）——见 XII.5 |
| **P2** | 插件**图标** 19/19 + 面板/目录**同源** | 中低（视觉一致性） | 低 ⇒ **本轮已落地** | 见 XII.3 |

> **N/A 依据（一句话，⛔ 不许当"遗漏"）**：① 插件运行时/API/宿主全局注入、⑤ 沙箱交互、⑨ 深链 ——
> 均**架构性或跨仓**：插件产物是**同页 ESM**，唯一合法承载面是权威宿主页（§8.2/§8.6）；
> ⑧ 其它贡献点是**宿主行为**扩展，无等价承载面。**这 4 条不是"没做"，是"原生不该做/做不了"。**

### XII.3 本轮**落地**（波12，最小 diff）

**缺口**（真实缺陷，非凑数）：
1. `components/PluginsSheet.ets` 原 `pluginSymbolOrGrid`：**三条 return 全是 `square_grid_2x2`**（死分支）
   ⇒ 能力面板里**每个插件同一个图标**，且与目录（`PluginHost`）的逐插件图标**不一致**。
2. `pluginSymbol` 只覆盖 web `ICON_MAP` **14/19**；`search`/`info`/`puzzle` 回落方块。

**修法**：`pluginSymbol` 提升为**唯一出口**（`PluginHost.ets:460` **导出**，删掉面板副本），
补齐 3 键（`search`→`magnifyingglass` / `info`→`info_circle` / `puzzle`→`puzzle`，**逐个离线实证**：
本机 SDK 权威符号名册 `…/previewer/common/resources/entry/resources.txt` 的 `'0xF0…' '<name>'` 行），
并把**未知名回落**从 `square_grid_2x2` 改为 `sys.symbol.puzzle` —— 与 web `pluginIcons.ts:76` 的
`Puzzle` 降级**同义**。commit `bb9efe9`。

**判据** `tools/tests/plugin_icons.test.ts`（**96 断言**，零扫描判红 + **4 条 mutation 实测**）：
① 唯一出口（导出 + 消费点计数 ≥1 + 旧副本计数 = **0**）；
② 覆盖 19/19（**剥注释后**按字面量，防注释假绿）+ 与真源 `isKnownPluginIcon` 双向一致；
③ **符号名实证**（三份插件组件里每个 `sys.symbol.X` 的 `X` 必须实名册可查 —— 防"符号名写错 ⇒ 运行时静默空白"）；
⑥ **深色逐字节不变**证据（5 套主题实测 `structuralRuleOf(深) === hairlineOf(深)`）。
mutation 实测：抽 `search` 分支 → 4 红；换回本地副本 → 3 红；注释回退 → 1 红；删 `puzzle` 分支 → 2 红。

### XII.4 一句话结论

**插件面已高度 parity**（目录/宿主页/设置配置表单/启停重载/频道/飞书绑定/**声明式 widget 7/7**/**widget 常驻信息栏落点** 均已落地）；
**真缺口 2 条** —— ① `plugin_status` 全量后端插件（需新 RPC）② `.zip` 安装；
另有 **4 条 N/A**（沙箱/桥/行为扩展/深链）与 **1 条 web 侧待补**（视图深链）。
**⚠️ 无一条经过真机验证（本波设备禁令）⇒ 均标"待设备验证"。**

### XII.5 收口：声明式 widget `sparkline`/`table`（2026-10-11，目标②④）

> **缺口（真实，非凑数）**：`core/widgetsview.ets` 的 `degradeReasonForType` 曾对 `sparkline`/`table`
> **特判降级**、`SUPPORTED_KINDS` 只 5 种 ⇒ 与 web `components.tsx:236-259` 的 **7 种**不对齐。
> **判定**：两者都是 web **真有的用户可见形态**（SVG 折线/柱、可滚动表格），**非占位** ⇒ 落地。

**修法（最小 diff）**：
- **纯逻辑** `core/widgetsview.ets`：`KIND_SPARKLINE`/`KIND_TABLE` 入支持集；新增
  `sparkDataOf` / `sparkMaxOf` / `sparkLinePoints` / `sparkAreaPoints` / `sparkBarHeights` / `sparkHeightOf` /
  `tableColumnsOf` / `tableCellOf` / `tableRowsOf` / `tableMaxHeightOf`（强制/夹取/几何逐字对齐 web）。
- **渲染** `components/PluginWidgets.ets`：折线 = `Shape.viewPort(100×H)` + `Polygon`(面积 0.1) + `Polyline`(stroke 2)；
  柱 = `Row` 底对齐；表 = 表头 + `Scroll.constraintSize(maxHeight)`（单元格 tone ⇒ 语义色 chip）。

**有意偏离（诚实记账）**：
1. 插件任意色 `props.color` **忽略**，统一走语义角色 `accentSoft`（设计系统 §5「零颜色字面量」+ 5 套主题可读）。
2. `data.length === 1` 时 web 会 `i/(n-1)` **除零 ⇒ NaN**；原生**单点居中**（修正）。
3. 单元格 `action` 点击（web → `web_ui_action` RPC）**架构性缺** ⇒ **只画不点**（同 `code`/`src` 沙箱阵营）。
4. 表体 `max_height` 走 `Scroll.constraintSize`（web `overflow-auto` + `maxHeight`）；**shrink-to-fit / 嵌套滚动待设备验证**。

**判据** `tools/tests/widget_sparktable.test.ts`（**85 断言**；零扫描判红 + 形态钉**调用点计数**、⛔ 不钉方法体）
+ 既有 `widgets_view.test.ts` 的陈旧断言同步收口（`SUPPORTED_KINDS` 5→7、sparkline/table 不再降级）。
mutation 实测：删渲染层 sparkline 分支 → 2 红；把降级特判加回 → 1 红；`SUPPORTED_KINDS` 退回 5 种 → 红。
**⚠️ 未装机（设备禁令）⇒ 折线/柱/表的**视觉**与 `Shape.viewPort` 缩放**待设备验证**。**

### XII.6 收口：widget **常驻落点**（`infoBar` 信息栏，2026-10-11，目标② P0）

> **缺口（真实，非凑数）**：`components/PluginWidgets.ets` 的**唯一消费者**是
> `components/PluginHost.ets:172-186`（"插件目录"全屏浮层）⇒ 正常聊天路径下，插件推来的
> widget **一个都看不到**（`MobileAppShell.tsx:483-487` 在 `main` 下方**常驻** `<InfoBar/>`）。

**web 契约（逐条核对，⛔ 非印象）**

| 问题 | 证据 | 结论 |
|---|---|---|
| 何时出现 | `plugins/InfoBar.tsx:7-9`（原文 "ALWAYS rendered (even with no plugin content)…stable fixed-height strip"）· `MobileAppShell.tsx:487` **无条件** | web **恒渲染**固定高条 |
| 放哪 | `MobileAppShell.tsx:481-487`（`<main>` 之后、`bottomNav` 之前）· `MessageInput.test.tsx:206`（"delegates the bottom safe area to the InfoBar below"） | 屏幕**底部**，**输入框下方** |
| 哪些 widget 进 | `InfoBar.tsx:23`（`PluginPanelContainer container="info_bar"`）· `:24`（`WidgetZone zone="infoBar" excludePrefixes={['git:']}`） | ① `infoBar` **zone** 的 span 流；② 声明到 `info_bar` 容器的插件 view；③ SW 更新按钮（原生不移植） |
| 槽位标记 | `plugin/plugin/manifest.go:187,222`（`contributes.ui[].slot` 合法值含 `infoBar`）· `plugin/web_widget.go:35-37`（7 zone 名单） | 服务端按 **slot/zone** 分组推 spans（`RenderSessionWebWidgets`） |
| 消失/收起 | `plugin-runtime/plugin-runtime`→`plugins/PluginWidgetProvider.tsx:84-87`（切会话 `setZones({})`）· `WidgetZone.tsx:61`（`spans.length === 0 ⇒ empty`，InfoBar 未传 ⇒ `null` ⇒ **零节点**） | 切会话即清空；**流式不影响**；空 zone 天然零节点 |

**修法（最小 diff，3 个文件）**
- `core/widgetsview.ets:640-710`（+70 行）：新增 `DOCK_ZONE` / `DOCK_EXCLUDE_PREFIXES` /
  `dockSpanExcluded` / `WidgetDockView` / `widgetDockView(event, content)` —— **复用** `widgetsView`
  的同一份解析，只做"挑出 `infoBar` 一个 zone + 过滤 `git:` 前缀"的**投影**（**判据与渲染同源**）。
- `components/WidgetDock.ets`（新，~120 行）：24vp 细条（`height(DOCK_H)`，逐字对齐 web `1.5rem`）+
  横向 `Scroll`（`width('100%')` + `clip(true)`，门禁 H0）+ 语义色 span（`colorOf(p, s.colorRole)`）；
  整体包在 `if (this.view.visible)` 内 ⇒ **空态零节点 / 零高度**。
- `pages/Index.ets`：`import { WidgetDock }`（`:139`）+ `ChatView()` 里输入框胶囊**下方**实例化（`WidgetDock({content: this.widgetContent, event: this.widgetEvent, theme: this.themeName})`）。

**与 web 的**刻意分叉**（诚实记账）**
1. **空态不占位**：web 恒占 24px（用户明写"不要突然跳出来，一直渲染"）；原生**无内容时零高度** ——
   采取本任务口径（不改变既有聊天页布局）。⇒ **有 widget 出现时输入框会整体上移 24vp**（观感**待设备验证**）。
2. **SW 更新按钮不移植**（原生无 SW 概念）。
3. `excludePrefixes={['git:']}` **照抄**：web 侧该 span 由 fancy `git-info/GitStatusPanel.tsx:40-46`
   渲染成徽章组（同读 `zones['infoBar']`），原生**无该视图** ⇒ 排除后 git 信息在原生**不显示**
   （⛔ 不把 web 明确排除的原始文本塞回信息栏）。
4. `href`（web 渲染成 `<a>`）原生**无链接语义** ⇒ 只画文本（同 `table` 单元格 `action` 的"架构性缺"阵营）。
5. 声明式 `components`（`payload.components`）**不进**信息栏（web 里那条走 `PluginComponentPanel`，
   而原生由插件目录浮层承载）—— dock **只**消费 `infoBar` zone。

**判据** `tools/tests/widget_dock.test.ts`（**35 断言**）：① 空态零占位（空串 / `{}` / 坏 JSON /
只有别 zone / 空数组 5 种）；② 有 widget 才出现 + `git:` 排除；③ **同源**（`dock.spans`
逐项 == `widgetsView(infoBar).spans` 过滤后）；④ span 的取色 role 必须落在 `core/design.ets:colorOf`
的**合法集合**内（防"未知 role ⇒ 运行时静默不可见"）；⑤ 渲染层源码形态（`if (this.view.visible)` /
经 `widgetDockView` 取值 / 不用 `content.length > 0` / `@Watch('syncView')` / Index 真接线）。
**零扫描判红** 3 条 + **mutation 自证 5 条**（`if(true)` 常驻占位 / 改 `content.length>0` /
`visible` 恒 true / 删 Index 接线 / 去掉前缀排除 ⇒ 各自必红）。
**实测**：`run-one.sh widget_dock` **35 passed, 0 failed**；`ash tools/lint/color-roles.sh` ✅（119 处合法）、
`no-color-literals` ✅、`render-path` ✅、`core/` typecheck ✅、`horizontal_overflow_gate` 10 ✅、
`minimal_chrome` 31 ✅、`motion_budget` 10 ✅、`widgets_view` 54 ✅、`widgets_parse` ✅；
**真 ArkTS 编译 `hvigorw assembleHap` ⇒ `BUILD SUCCESSFUL in 11 s 710 ms`**。
**⚠️ 未装机（设备禁令）⇒ 信息栏的**观感**（24vp 条高 / 出现时的布局位移 / 横向滚动）**待设备验证**。**



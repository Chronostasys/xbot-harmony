# xbot-harmony

xbot 的**原生鸿蒙（HarmonyOS）客户端** —— 混合架构：**ArkUI 原生渲染聊天主链路 + ArkWeb 承载 Web 独有能力**。

> 目标：把 xbot 的 **Web 全部能力**搬到鸿蒙手机上，同时让主链路（会话 / 消息 / 迭代 / 工具 / 输入）
> 走原生渲染，摆脱纯 WebView 形态。

---

## 1. 为什么是混合架构

xbot 前端有三类能力**结构性无法用 ArkTS 表达**：

| 能力 | xbot 里的实现 | 为什么原生做不了 |
|---|---|---|
| **插件 UI** | 插件产物是**浏览器 ESM bundle**，宿主动态 `import()`（`web/src/plugin-runtime/loader.ts`） | ArkTS 没有浏览器 ESM 加载器；插件契约建立在 DOM/React 之上 |
| **GenUI（`display_html`）** | LLM 生成 TSX，运行时 `sucrase` + `new Function()` 求值（`web/src/plugins/SandboxedUI.tsx`） | ArkTS **禁止动态求值**（无 `eval` / `new Function`） |
| **终端 / 代码编辑器** | xterm.js / monaco | 无 ArkTS 等价物 |

⇒ 这三块交给 **ArkWeb（`Web` 组件，内核即 Chromium）** 承载，能力 100% 保留；
其余全部走原生 ArkUI。详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

> ⚠️ 诚实说明：ArkWeb 与系统浏览器**同引擎**，它解决的是"能力可得性"，**不是渲染性能**。

## 2. 现状（M1）

已实现（原生）：

- 登录 / 注册（`/api/auth/*`，**Cookie 会话**，持久化后续冷启动免登录）
- 会话列表（`/api/session-tree`）、新建会话（`/api/chats/create`）、切换会话
- 历史加载（`/api/history`，含 `active_progress` 恢复）
- 发送（`/api/message`）/ 取消（`/api/cancel`）
- **SSE 实时流**（`/api/sse`：`progress_structured` / `stream_content` / `text` / `session` /
  `user_echo` / `heartbeat` / `resync_required`），ArkTS 自研 SSE 客户端（无 `EventSource`）
- 迭代渲染：思考(T) / 正文(O) / 工具 pill(C)，运行中/成功/失败的视觉区分
- **ArkWeb 逃生舱**：一键打开服务端 Web UI（插件面板 / GenUI / 终端 / 编辑器）

尚未实现：见 [docs/ROADMAP.md](docs/ROADMAP.md)（M2 起：seq 水位线、窗口化、markdown 渲染、
AskUser、队列、设置、插件面板原生入口……）。

## 3. 构建

### 3.1 云端（推荐，**不需要 DevEco Studio，也不需要 Windows/macOS**）

推送到 `main` 或开 PR，`.github/workflows/build.yml` 会在 **Linux 容器**里用官方
command-line-tools 编译出未签名 HAP：

- 产物：Actions → Artifacts → `hap-unsigned`
- 滚动 Release：`nightly`（prerelease）

推 tag（`v*`）触发 `.github/workflows/sign-and-release.yml`：构建 → `hap-sign-tool.jar` 签名 →
发布带签名 HAP 的 GitHub Release（需先配置签名 Secrets，见 [docs/CI.md](docs/CI.md)）。

### 3.2 本地（任意平台，只要有 command-line-tools）

```bash
export PATH=$CMDLINE_TOOLS/bin:$PATH
export OHOS_SDK=$CMDLINE_TOOLS/sdk
ohpm install --all
hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
# 产物：entry/build/default/outputs/default/entry-default-unsigned.hap
```

也可以直接本地用 Docker 复用 CI 镜像：

```bash
docker run --rm -v "$PWD":/workspace ghcr.io/dalongzhuazi/harmonyos-ci:api26r \
  bash -lc 'cd /workspace && ohpm install --all && hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon'
```

### 3.3 安装到手机

未签名的 HAP 无法直接安装。两种办法：

1. 配好签名 Secrets 后走 `sign-and-release`，下载签名 HAP 用 `hdc install`；
2. 或在本机用 DevEco Studio 打开本工程自动签名（IDE 会在 `build-profile.json5` 写入本机签名配置，
   CI 侧已用 `strip_signing.py` 剥离，互不干扰）。

## 4. 配置

首次启动填：

- **服务端地址**：xbot Server 的地址，例如 `http://192.168.1.10:16000`
- 用户名 / 密码

> ⚠️ xbot 默认是**明文 HTTP**；HarmonyOS 6.1（API 23）起默认全局禁止明文，本工程已在
> `entry/src/main/module.json5` 显式放行 `cleartextTrafficPermitted`。公网部署请改用 HTTPS
> 并把它改回 `false`。

## 5. 目录

```
entry/src/main/ets/
├── entryability/EntryAbility.ets   UIAbility 入口（沉浸式窗口）
├── pages/Index.ets                 登录门 + 会话抽屉 + 消息列表 + 输入区
├── components/WebSurface.ets       ArkWeb 逃生舱（插件 / GenUI / 终端 / 编辑器）
└── core/
    ├── types.ets                   协议类型（镜像 xbot protocol/ws.go 等）
    ├── http.ets                    HTTP + Cookie jar + {ok,data,error} 信封
    ├── sse.ets                     SSE 客户端（requestInStream + 帧解析 + 退避重连）
    ├── store.ets                   会话/消息/实时进度状态源
    └── config.ets                  preferences 持久化（地址/用户名/会话 cookie）
```

## 6. 许可

MIT

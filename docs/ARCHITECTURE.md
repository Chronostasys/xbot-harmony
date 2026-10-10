# 架构

## 1. 一句话

**原生 ArkUI 渲染主链路 + ArkWeb 承载 Web 独有能力 + 一套通用协议客户端（HTTP/Cookie + SSE）。**

```
┌──────────────────────────────────────────────────────────────┐
│                     xbot-harmony (HAP)                       │
│                                                              │
│  ┌────────────────────────┐   ┌───────────────────────────┐  │
│  │  ArkUI 原生渲染层       │   │  ArkWeb 逃生舱             │  │
│  │  · 会话列表 / 抽屉      │   │  · 插件 UI（ESM bundle）   │  │
│  │  · 消息行 / 迭代块      │   │  · GenUI（LLM 生成 TSX）   │  │
│  │  · 工具 pill / 输入区   │   │  · 终端（xterm + PTY WS）  │  │
│  │  · 设置（M3+）          │   │  · 代码编辑器（monaco）    │  │
│  └───────────┬────────────┘   └─────────────┬─────────────┘  │
│              │                              │                │
│  ┌───────────▼──────────────────────────────▼─────────────┐  │
│  │ core/  · XbotHttp（Cookie jar + {ok,data,error} 信封）  │  │
│  │        · SseClient（requestInStream + 帧解析 + 重连）    │  │
│  │        · ChatStore（会话/消息/实时进度）                │  │
│  │        · ConfigStore（preferences：地址/cookie）        │  │
│  └───────────────────────────┬────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────┘
                               │  HTTP + SSE + WS
                     ┌─────────▼─────────┐
                     │  xbot Server      │
                     │  (web channel)    │
                     └───────────────────┘
```

## 2. 协议（客户端必须复刻的三条）

| 方向 | 协议 | 说明 |
|---|---|---|
| 请求 | `POST /api/*` JSON | 统一信封 `{ok,data,error}`；`data` 是扁平业务字段 |
| 推送 | `GET /api/sse?chat_id=` | 帧 `id:…\nevent:…\ndata:…\n\n`；15s 心跳；512 条环形缓冲；`resync_required` ⇒ 回退 `/api/history` |
| 终端 | `WS /ws/terminal`（M3） | PTY，JSON + base64（`stdin`/`stdout`/`resize`/`close`） |

**鉴权只有 Cookie**（`xbot_session`）。ArkTS 无 cookie jar ⇒ `XbotHttp` 自己维护
（解析 `Set-Cookie`、逐请求带 `Cookie` 头），并把 cookie 持久化到 preferences 以支持冷启动免登录。

**两种 seq 不可混用**（xbot 的既有约定）：
- SSE 信封的 `id` 是**传输重放**游标（per-route）；
- `ProgressEvent.seq` 是**语义水位线**（per-Run） —— 客户端用它丢弃重放事件。

## 3. 为什么 ArkWeb 不能省

见 README 表格。要点：**插件产物与 GenUI 都是"能在浏览器里跑"的代码**，
ArkTS 既无 ESM 加载器也无动态求值 ⇒ 物理上无法原生执行。

## 4. 渲染语义对齐（与 Web 版一致的形态）

| 概念 | 语义 | 本仓库实现 |
|---|---|---|
| turn | 一个 user 消息 + 其后所有迭代 | `ChatRow(turnID)`：1 user 行 + 1 assistant 行 |
| iteration | 一次 LLM 请求-响应，含 T(思考) / O(正文) / C(工具) | `HistoryIteration` → `IterationBlock` |
| live 行 | 正在跑的 turn 的未完成态 | `ChatRow(isLive=true)` + `progress_structured` |
| 工具 pill | 每个工具一个 pill，运行/成功/失败三态 | `toolLabel()`：`●/✓/✗` |

## 5. 与 Web 前端的差异（已知、刻意）

| 维度 | Web | 本仓库（M1） |
|---|---|---|
| 状态机 | `reduce.ts` 纯函数 reducer + 类型级不变量 | **已接入**：`core/reduce.ts` + `core/{normalize,derive,integrate,agent_normalize,progress_types,chat_types_full}.ts`（逐字移植），渲染行由 `deriveRows(state)` 得出，busy 用 AgentPanel 三元公式 —— 见 `docs/WEB-ALIGNMENT.md` |
| 窗口化 | 迭代级窗口化 + 虚拟列表 | 依赖 ArkUI `List` 的原生复用（M2 评估是否需要手动窗口化） |
| Markdown | react-markdown + katex + mermaid | M1 纯文本（M2 接入原生 markdown 渲染，公式/图表走 ArkWeb） |
| 离线/多标签 | Service Worker + 多 tab | 单进程（M3 考虑） |

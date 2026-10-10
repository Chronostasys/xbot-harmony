# HANDOVER · 原生鸿蒙客户端（xbot-harmony）

> 仓库：<https://github.com/Chronostasys/xbot-harmony>（public）
> 架构：**混合** —— ArkUI 原生渲染主链路（会话/消息/迭代/工具/输入），ArkWeb 承载结构性不可移植部分
> （插件 ESM UI、GenUI 的求值、终端、编辑器）。
> 最后更新：2026-10-10

---

## 一、当前状态（一句话）

**代码侧问题已全部修完并验证；已拿到真机画面（登录页渲染正常）；正在等用户对新包复测**
（飞书会话能否打开 / 长会话是否变顺 / 登录后重走查）。

最新可安装产物（未签名，需 DevEco 自动签名）：

```
dist/xbot-harmony-release-unsigned.hap   262462 B   sha256 4f259e2f07a91cf0fc91b505dfeaba3a85ffb26cbc27a6118c7eb58b86884c68
dist/xbot-harmony-debug-unsigned.hap     581184 B   sha256 a8ee383f44cd92babccf97cbba671ab9f32183316b151b6646a5a40730370361
```

---

## 二、用户报告过的问题 → 根因 → 修法（全部已修，均有守护）

| 用户原话 | 根因（真机/服务端实证） | 修法 / 守护 |
|---|---|---|
| 「渲染整个都是错乱的，完全用不了」 | **流式帧被当成结构化事件**：服务端把只带流式字段的消息改型为 `stream_content`，其 `iteration==0`、无 `tools`；客户端却读 `content`（应为 `stream_content`）并按 `iteration ?? 0` 写入 ⇒ 流式文本读不到、工具 pill 一闪就没、冒出**幽灵「迭代 0」** | `core/streammerge.ets` 分两条路：流式帧归**在飞迭代**（只增不减）、结构化帧按号 upsert 且**缺字段不清空**；44 条守护 |
| （同上） | **`SessionEvent.Action` 误读为 `state`** ⇒ 会话状态更新整条是死代码（收尾后可能停在"运行中/停止"） | `core/streammerge.ets` 的 `isIdleAction`/`isBusyAction`/`shouldReloadHistory`；7 条守护 |
| （同上） | **宽表格**：真实会话里 ≥5 列表格出现 44 次，而等宽网格在手机上把每列压成 ~40dp 竖条 | 列数决定形态：≤4 列网格、≥5 列堆叠；18 条守护 |
| （同上） | **不可断超长 token**（实测最长 823 字符）横向撑破容器 | 聊天文本全面 `wordBreak(BREAK_ALL)`（代码块仅在允许换行时） |
| 「渲染很卡、交互也很差」 | ① `List` + `ForEach` **一次性构建全部行**（单行 ≤16 迭代块 × Markdown）；② 流式期间**每个 SSE 事件都同步一次 UI** | ① 行窗口（默认 12 行 + 「显示更早的 N 条」）；② store→UI **每帧至多一次**合并调度 |
| 「有些会话打不开（非 web channel 的）」 | `channel` 被硬编码为 `'web'`，而会话列表含**飞书**会话（`oc_`/`ou_` 前缀）⇒ `/api/history` 必 404 | `openSession` 按会话自身渠道（`channelForChat`）；抽屉标注来源；20 条守护 |
| 走查上传的图全是登录页 | 走查在**未登录**状态跑 ⇒ 聊天页组件不存在，几何全 0 且无法判读 | 未登录拒绝走查；几何文本加「当前页面=」；0 尺寸显式标注 `⚠未布局`；登录页加 id |

其它已修：行 key 含 `rev`（ArkUI 按 key 复用）、行 id 全局单调计数器、`Text` 内条件渲染改 TS 侧预计算、
Markdown 块 key 内容派生、各列表 keyGenerator、ArkWeb `@Watch`、关闭沉浸式、23 处 `height()`→
`constraintSize(minHeight)`（字体缩放）、单 turn 迭代上限 16 + 展开、加载失败重试、自动滚底门控、
键盘避让 `RESIZE`、`MarkdownView` 解析缓存（渲染路径禁止裸解析，CI 门禁 + 变异自证）、
三个主按钮补品牌配色、引用块竖条改边框（父容器定高时百分比高度无参照）。

另外修了**测试基座**缺陷：6 个测试文件缺 `process.exit` ⇒ `run.sh`（`set -e` 顺序执行）**永远卡在
`regions`**，后面 5 个文件从未执行（长期被误判为"全绿"）。现套件跑完 **173 条断言**。

---

## 三、为什么本机渲染不了（三条路均已走到尽头，有证据）

| 路 | 结论 | 证据 |
|---|---|---|
| 官方 Linux 预览器 | ❌ Stage ability 未实现 | `ide_previewer/jsapp/rich/JsAppImpl.cpp:408` → `JsApp::Run ability start failed. Linux is not supported.` |
| 预览器（绕开 ability，虚拟屏取帧） | ❌ headless 与 **Xvfb + Mesa EGL** 都试过仍无画面 | `RSUIDirectory::AttachSurface not ready` + `RSRenderNode::InitRenderParams failed`；帧唯一色数=1、md5 恒定（`aebde859…`） |
| QEMU 跑鸿蒙虚拟机 | ❌ 官方无 qemu 镜像 | 镜像站 `os/` 全量目录逐个搜 `qemu/x86/vbox` 零命中；`5.1.0-Release/` 只有 dayu200/hispark 真机板；DevEco 模拟器仅 Win/macOS |

⇒ 可用通路只有**真机**。应用内已内置取证：`componentSnapshot` 截图 + `uploadBytes` 回传 +
`componentUtils.getRectangleById` 几何采集（自检页还有一段**可长按复制**的取证文本，零网络可用）。

---

## 四、下一步（按优先级）

1. **等用户复测**上述三条；若长会话仍卡 ⇒ 把 `List` 换成 `LazyForEach` + `IDataSource`
   （需把"加载更早/busy 指示器"两个非消息项移出 `List` —— LazyForEach 与普通子项混用有约束，属结构性改动）。
2. **补逐行几何**：给每行加 `xbot-row-N` id，采集行高与右边界 ⇒ 让 R5（横向溢出）/R6（高度爆炸）
   一次走查即可判读（判据表见 `docs/UI-AUDIT-CHECKLIST.md` 的 R1–R10）。
3. 走查完成后把 `Index.ets` 的 `AUTO_AUDIT_ON_LAUNCH` 改回 `false`。
4. 需签名材料（`.p12/.cer/.p7b`）才能真正分发；架构已支持 CLI 签名（`hap-sign-tool.jar` 在
   `command-line-tools/sdk/default/openharmony/toolchains/lib/`）。

## 五、知识文档（改渲染/协议前必读）

`docs/ARKTS-GOTCHAS.md`（**22 条真机坑**：rev-key、条件渲染、百分比高度、wordBreak、
流式/结构化两条路、`SessionEvent.Action`、行窗口与帧合并、诊断判别力…）、
`docs/UI-AUDIT-CHECKLIST.md`（逐页判据 + R1–R10 数值判据）、
`docs/RENDER-LOAD-MEASUREMENT.md`（渲染负载与内容形状清单实测）、
`docs/CI.md`（静态检查、渲染路径门禁、测试必须 `process.exit`）、
`tools/preview/README.md`（预览器/虚拟机三路结论，含 shim 与参数契约）。

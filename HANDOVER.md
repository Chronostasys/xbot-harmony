# HANDOVER · 真机渲染问题排查交接

> 目标（用户）：**"渲染整个都是错乱的，完全用不了" —— 彻底修好，每个页面都要截图分析。**
> 状态：**代码侧能做的已全部做完并验证；只剩"拿到真机画面"这一步需要用户配合。**
> 最后更新：2026-10-09 ｜ 仓库：[Chronostasys/xbot-harmony](https://github.com/Chronostasys/xbot-harmony)

---

## 一、当前唯一阻塞：拿不到真机画面

本机能跑鸿蒙**编译/打包/静态检查/纯逻辑测试**，但**渲染不了 Stage 应用**（三条路都走到尽头，均有证据）：

| 路 | 结论 | 证据 |
|---|---|---|
| 官方 Linux 预览器 | ❌ Stage ability 路径**未实现** | `ide_previewer/jsapp/rich/JsAppImpl.cpp:408` → `JsApp::Run ability start failed. Linux is not supported.` |
| 预览器（绕开 ability） | ❌ 无头容器渲染服务不可用 | 日志 `RSUIDirectory::AttachSurface not ready`；抓到 7 帧**恒为空白**（连最小绿色测试页一样） |
| QEMU 虚拟机 | ❌ 官方只发**真机板子镜像**（dayu200/hispark），无 qemu 镜像 | `repo.huaweicloud.com/openharmony/os/5.1.0-Release/` 目录清单 |
| DevEco 模拟器 | ❌ 仅 Win/macOS | 官方系统要求 |

> 已自建 shim（补 5 个漏发共享库）+ 反查出完整参数契约 + 帧协议（40 字节头 + JPEG）+ WS 抓帧客户端，
> 全部记录在 `tools/preview/README.md`（将来官方支持 Stage 时可直接复用）。

**唯一可行通路：真机 + `hdc`**（`hdc` 在本机工具链里）。为把"需要用户配合"降到最低，已实现
**应用内自动走查并回传**（见下），用户只需：装诊断包 → 打开 App 等十几秒。

⚠️ **当前已知的外部障碍**：用户手机**代理客户端故障**（订阅 URL 为空/规则语法错/经代理连服务端超时），
导致 App 到服务端不通 ⇒ 回传通道走不了。服务端本身实测正常（`HTTP 200`，直连 1.79s）。

---

## 二、已完成的修复（都在 master）

### 2.1 ArkUI 渲染正确性（"错乱"的直接病因）

| # | 问题 | 后果 | 修法 |
|---|---|---|---|
| 1 | **ForEach key 不变但数据原地改** | ArkUI 按 key 复用列表项 ⇒ **界面陈旧/半新半旧**（最可能主因） | `ChatRow.rev` 渲染版本号 + key = `${id}#${rev}`，8 处改动点接上 `touch(row)` |
| 2 | 行 id 可能重复（`a-<消息id>` vs `a-<turnID>`、同毫秒 `Date.now()`） | key 重复 ⇒ 组件复用错位 | 全局单调计数器 `nextRowID()` |
| 3 | `Text(){ForEach(){ if/else }}` 条件渲染 | ArkUI 的 `Text` 只收 Span 子组件，条件渲染不保证支持 | TS 侧预计算样式（`MdInlineStyle`/`inlineStyles`），构件零分支 |
| 4 | Markdown 块 key 含下标 | 流式增长 ⇒ key 漂移 ⇒ 抖动错乱 | `MdBlock.key` 内容派生 |
| 5 | 会话/队列/插件 key 无内容指纹 | 改名/重排后显示旧内容 | key 加内容指纹 |
| 6 | 标题内联 `ForEach` 缺 keyGenerator | 官方 `codelinter` 报 `foreach-args-check` | 补 keyGenerator |
| 7 | ArkWeb 面板普通成员 `url` | 插件 A→B 时组件不重建 ⇒ 停在旧页 | `@Prop @Watch` + `controller.loadUrl` |
| 8 | `setWindowLayoutFullScreen(true)` 且无安全区避让 | 顶部被状态栏压住、整体错位 | 关闭沉浸式（交系统做内边距） |

### 2.2 长会话可用性（"完全用不了"的强候选）

**单 turn 迭代渲染爆炸**：一个 turn 可能有上千迭代（每次工具调用一个），原先全部渲染（每个还带完整
Markdown）⇒ DOM 上千、卡到没法用。现：默认只渲染**最近 16 个**，上方一行「↑ 已折叠更早的 N 个迭代（点击展开全部）」。
（与 xbot Web 端 `docs/agent/gotchas-web-frontend.md` 的"迭代级窗口化"同源经验。）

### 2.3 网络故障不再表现为"一片空白"

代理/网络不通时 `loadHistory` 失败 ⇒ 聊天页空列表。现渲染一张卡片：**失败原因 + 常见成因 + 「重试」**
（`retryLoad`）。用户看到的是可读原因，而不是"什么都没有"。

---

## 三、真机画面回传通道（已实现并本地验证）

1. **应用内**：`设置 →「① 走查并上传所有页面截图」`；另有诊断开关
   `AUTO_AUDIT_ON_LAUNCH = true`（登录**与冷启动免登录**两条路径都会在数秒后自动走查）。
2. **走查内容**：依次打开 聊天 / 会话抽屉 / 设置 / 渲染自检 / 队列 / 能力面板 / 回到聊天，
   每页 `componentSnapshot.get('xbot-root')` → `image.createImagePacker().packing(PNG)`
   → `XbotHttp.uploadBytes`（手搓 multipart）上传到服务端；**逐页 try/catch**，一页失败不中断整轮。
3. **版面几何**：每页用 `componentUtils.getRectangleById()` 采集 7 个关键组件的 x/y/w/h + 屏幕尺寸，
   最后在 `finally` 中必传 `audit-layout.txt`（**不依赖图像**，图看不清时靠它定位）。
4. **接收侧**：`tools/device/collect_uploads.sh`
   - 按上传顺序推断页名（01-chat … 07-chat-back）；
   - 直接打印 `audit-layout.txt`；
   - **自动判读**：对照基线检查（根尺寸/顶栏高/列表高是否为 0/输入区是否在屏外/浮层是否出现），
     输出「无异常 ✅」或逐条异常。
5. **判读基线**：`docs/UI-AUDIT-CHECKLIST.md`（每页应有几何 + 常见异常签名 + 修复原则）。

---

## 四、当前已验证状态（可复现）

```
hvigorw assembleHap --mode module -p product=default -p buildMode=release --no-daemon   → BUILD SUCCESSFUL
tools/tests/run.sh                                                                      → 55 passed / 0 failed
bash $CMDLINE_TOOLS/codelinter/bin/codelinter entry/src/main/ets -f json -o lint.json   → 正确性告警 0
                                                                                          （仅 15 条性能提示）
git status --short                                                                      → 干净
```
产物：`dist/xbot-harmony-{release,debug}-unsigned.hap`（`minAPIVersion=50000012`，未签名 ⇒ 安装前需签名）。

---

## 五、下一步（拿到输入后立刻执行）

1. 用户**修好手机代理**（或给 `pivotlang.tech` 加直连/绕过规则）→ 装诊断包 → 打开 App 等十几秒；
   **或**用户直接发两张截图（`设置 → 渲染自检` 整页 + 出问题的聊天页）。
2. 我执行 `tools/device/collect_uploads.sh` → 拿到 7 页截图 + 几何判读。
3. 按 `docs/UI-AUDIT-CHECKLIST.md` **逐页**判读：先看几何数值定位"哪个容器约束错了"，再看图确认视觉。
4. 一次只改一处 → 让用户再走查一次 → **同页对比**，直到每页正常。
5. 排查完成后把 `AUTO_AUDIT_ON_LAUNCH` 改回 `false`。

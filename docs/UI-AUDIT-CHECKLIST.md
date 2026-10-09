# 逐页 UI 走查清单（截图 + 几何数值判读）

> 用法：装了诊断包（`AUTO_AUDIT_ON_LAUNCH=true`）打开 App 后，会自动走查 7 页并上传
> ① 每页截图（PNG）② 每页版面几何（`audit-layout.txt`）。
> 取回：`tools/device/collect_uploads.sh`（按上传顺序推断页名）。
> 判读顺序：**先看几何数值，再看图** —— 数值能直接指出"高度 0 / 跑到屏幕外 / 宽度 0"。

## 0. 基线与整体判据

| 组件 id | 期望几何（1200×2600 视口，单位 px） |
|---|---|
| `xbot-root` | `x=0 y=0 w≈1200 h≈2600`（铺满） |
| `xbot-header` | `y≈0 w≈1200 h≈56`（若 y 明显 >0 或 h≠56 ⇒ 顶栏异常） |
| `xbot-list` | `w≈1200 h≈全屏 − 56 − 输入区`（**高度必须显著大于 0**；h≈0 就是"空白/错乱"根因） |
| `xbot-composer` | 贴近屏幕底部（`y ≈ 2600 − 输入区高`） |
| `xbot-drawer` | 仅在抽屉打开时出现：`x=0 w≈0.82×1200 h≈2600` |
| `xbot-settings` | 仅设置打开时出现：居中，`w≈0.92×1200` |
| `xbot-selfcheck` | 仅自检页打开时出现：`w≈0.94×1200 h≈0.86×2600` |

**红线**：`absent` 出现在"该页本该存在"的组件上；或 `h=0`/`w=0`；或坐标远在
`[0,1200]×[0,2600]` 之外 ⇒ 该页渲染异常。

## 1. 聊天页（01-chat）

- 期望：顶栏一行（☰ + 标题/状态 + ⊞ + ⚙）；中间消息列表铺满；底部输入框 + 发送按钮。
- 常见异常签名：
  - `xbot-list h=0` → 列表没拿到高度（父容器约束问题）；
  - 消息行高度 > 视口数倍 → 单条消息把布局撑爆（Markdown/代码块未换行）；
  - 用户气泡/助手块左右错位 → `Row`+`Blank()` 与 `constraintSize` 冲突。
- 看图重点：气泡是否右对齐、文字是否溢出屏幕、迭代块是否与正文重叠。

## 2. 会话抽屉（02-drawer）

- 期望：宽约 82%、高满、左侧贴边；每行 = 标签 + chat_id + 「改名」「删除」；底部「退出登录」。
- 常见异常签名：抽屉占满全宽（`w≈1200`）⇒ 宽度百分比失效；行内按钮换行 ⇒ `min-w-0` 类收缩问题。

## 3. 设置（03-settings）

- 期望：居中卡片，标题 + 「服务端/用户名」输入 + 「显示思考过程」开关 + 三个按钮
  （走查上传 / 渲染自检 / 完整 Web UI / 退出登录）。
- 常见异常签名：卡片宽度非 92%（居中失效）；开关与文字错位。

## 4. 渲染自检（04-selfcheck）

- 期望：8 个带标签的分块（A 纯文本 … H 顶栏内联），整页可滚动。
- 用途：**这一页的截图直接告诉我哪类构件坏** —— 逐格对照：
  - A 只有一行/溢出 ⇒ 文本换行异常；
  - B 样式丢失或乱码 ⇒ `Text`+`Span` 内联渲染异常；
  - C 列表缩进错乱 ⇒ 列表项渲染；
  - D 代码块横向溢出 ⇒ 长行未换行（需 `wordBreak`）；
  - E 单元格挤压/串行 ⇒ 表格列宽（`layoutWeight`）问题；
  - F pill 挤压或一行一个 ⇒ `Flex(wrap)` 宽度传递问题；
  - G URL 把整页顶宽 ⇒ 不可断词处理缺失；
  - H 顶栏元素错位 ⇒ `layoutWeight(1)` 中间位失效。

## 5. 队列（05-queue）

- 期望：居中卡片，逐行「内容 + ↑ ↓ ✕」；空队列时只有标题。
- 异常签名：行内三个操作符号换行/挤压（触屏应折叠为「⋯」菜单，见 gotchas）。

## 6. 能力面板（06-plugins）

- 期望：居中卡片，第一项「🌐 完整 Web UI」，其后为各插件项（名单来自 RPC `web_plugin_list`）。
- 异常签名：插件清单为空（RPC 失败/未启用，不算渲染问题）；项文字溢出。

## 7. 回到聊天（07-chat-back）

- 与 01 对比：确认关闭浮层后布局**完全复原**（若有残留浮层/错位即为状态残留 bug）。

---

## 附：判读后的修复原则

1. **数值优先**：先按几何定位"哪个容器约束错了"，再谈样式；
2. 一次只改一处，改完让用户再走查一次，**同页截图对比**；
3. 任何"改了数据界面不更新"的问题，先查 **ForEach key 是否随内容变化**（本仓库约定：
   行模型带 `rev`，key = `${id}#${rev}`）。

---

## 附：当前已验证状态（2026-10-09，可复现）

| 项目 | 命令 | 结果 |
|---|---|---|
| 编译（release/debug） | `hvigorw assembleHap --mode module -p product=default -p buildMode=release --no-daemon` | **BUILD SUCCESSFUL** |
| 纯逻辑测试 | `tools/tests/run.sh` | **55 passed / 0 failed**（http 7 / keys 6 / markdown 22 / serverurl 14 / upload 6） |
| 官方静态检查 | `bash "$CMDLINE_TOOLS/codelinter/bin/codelinter" entry/src/main/ets -f json -o lint.json` | 告警 15 条，**全部**为 `@performance/hp-arkui-use-local-var-to-replace-state-var`（异步事件里写 @State 的性能提示）；**正确性相关 = 0** |
| 工作区 | `git status --short` | 干净 |

**产物**：`dist/xbot-harmony-{release,debug}-unsigned.hap`（`bundleName=com.chronostasys.xbot`，
`minAPIVersion=50000012`，未签名 ⇒ 安装前需签名）。

**待办（唯一阻塞）**：装诊断包 → 打开 App（自动走查）→ 我逐页判读截图与 `audit-layout.txt`。

## 取证的最低摩擦路径：**长按复制文本**（不必截图）

渲染自检页底部有一段合并文本（`auditText()`），**长按即可复制**，内容 = 渲染规模 + 各页实测几何：

```
===== xbot-harmony 自检取证（长按可复制）=====
[渲染规模]
rows=…  迭代总数=…  单行最多迭代=…  实际渲染块数=…（每行≤16）
带更早折叠区域的行=…  会话=…  busy=…
md缓存 命中=… 未命中=…（命中率 …%） 占用=…KB 条目=…

[各页几何 x/y/w/h]
…（登录后各页的 xbot-root/header/list/composer/drawer/settings/selfcheck 实测几何）
```

为什么优先它：截图受截图工具/传输/代理影响，**纯文本不会丢信息、零网络可用**，直接粘贴即可。

## 静态审计口径（无设备时也要跑一遍）

改动前后都用这两条自查，避免把已知 ArkUI 陷阱带进渲染层：

1. **`height('100%')` 的父容器必须是定高的**（页面根 / 定高容器）。内容定高的父容器里出现百分比高度
   ⇒ 循环测量 ⇒ 元素塌成 0（真实案例：Markdown 引用块竖条，见 ARKTS-GOTCHAS 第 12 条）。
2. **渲染路径里禁止裸调 `parseMarkdown/parseInline`**（`tools/lint/render-path.sh` 会拦；原因：ArkUI 数据一变整行重建 ⇒ 每次渲染重解析，见 ARKTS-GOTCHAS 第 11 条）。

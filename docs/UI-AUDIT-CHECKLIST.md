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
3. **自动"跟随到底部"必须门控**：`scrollEdge(Edge.Bottom)` 之类调用只能发生在"用户本就在底部"时，
   切会话例外（强制跳底）。流式期间每个事件都会同步一次，无条件跟随 = 用户读不了（见 ARKTS-GOTCHAS 第 13 条）。

## 真机基线判读（2026-10-09，用用户上传的真实截图）

素材来源：会话上传目录里用户此前发的截图。**筛图判据**（可复用，省得逐张看）：

| 判据 | 结论 |
|---|---|
| 1320×2848 + 深色（~90%）+ **饱和蓝 4–5%** | ✅ **本 App**（登录页） |
| 1179×2556 + 深色但**蓝=0%** | ✗ 小说阅读器（深色模式） |
| 1320×2848 + 浅色（~94–96% 白） | ✗ 代理 App 配置页 |
| 4032×3024 / 5712×4284 | ✗ 相机照片 |

（⚠️ 带 alpha 的 PNG 用"平均色"判明暗会**假阴性** —— 必须用**饱和色占比**判断。）

### 登录页：**渲染正常**（可排除）

14:43 / 14:47 两张（1320×2848，华为机型）实测：

- 状态栏**没有压住内容**（安全区正确）✓
- 标题 `xbot` + 副标题居中，字距正常 ✓
- 服务端 / 账号 / 密码三个输入框**等宽堆叠、左右留白一致**，无挤压/裁切/重叠 ✓
- 「测试连接」「登录」「注册」按钮**满宽圆角**，间距一致 ✓
- 错误行（红字）在按钮上方，未溢出 ✓
- 底部手势条避让正确 ✓
- 14:47 版含「测试连接」：点击后 ✅「服务端可用：仅允许已存在的账号登录」
  ⇒ **网络 + HTTP + 信封解析链路在真机可用** ✓

⇒ **"渲染整个错乱"不在登录页**；也证伪了"顶部被状态栏压住"这类猜测（真机安全区是对的）。

### 旧版遗留（已修，留档）

同图出现 `[登录请求] undefined is not callable`（旧版；`测试连接` 成功但 `登录` 失败 ⇒ 差异在
`http.post` 路径）。当前 `post()` **每一步都带产地标注**（`[body 序列化]` / `[createHttp]` /
`[发送 …]` / `[解析 Set-Cookie]` / `[解析响应]`）—— 该次事故已按"错误必须自带产地"修复。

⇒ 因此"渲染错乱"只能出现在**会话/消息页、抽屉/设置页或自检页**，仍需这些页的真机画面
（或自检页那段可复制的几何文本）。

## 几何数值的**判定规则表**（拿到取证文本后照此判，客观、不靠感觉）

输入 = 自检页那段可复制文本里的 `[各页几何 x/y/w/h]`。逐条判：

| 规则 | 期望 | 违反时的含义 |
|---|---|---|
| R1 根容器 `xbot-root` | `x≈0, y≈0, w≈屏宽, h≈屏高` | 根容器没铺满/被顶掉 ⇒ 后续全部定位不可信 |
| R2 顶栏 `xbot-header` | `y≈0`（或等于状态栏高度）、`w≈屏宽`、`h>40` | `y<0` ⇒ 被状态栏压住（安全区没避让） |
| R3 输入区 `xbot-composer` | `y + h ≈ 屏高`（贴底）、`w≈屏宽`、`h>40` | 若 `y+h` 明显小于屏高 ⇒ 底部被挡/没贴底；`h≈0` ⇒ 输入框塌了 |
| R4 消息列表 `xbot-list` | `h > 0` 且 `y≈header 底`、`h ≈ composer.y - header.h` | `h≈0` ⇒ 列表塌陷（最常见的"空白"根因） |
| R5 任何元素宽度 | `x + w ≤ 屏宽 + 1` | 超出 ⇒ **横向溢出**（长 token/宽表格未换行 ⇒ 整页被撑坏） |
| R6 任何元素高度 | `0 < h < 屏高×2` | `h≈0`=塌陷；`h` 极大（如 >20000）⇒ 单行内容爆炸（迭代/表格没受限） |
| R7 抽屉 `xbot-drawer` | `w ≈ 屏宽×0.82`、`h≈屏高` | 宽度异常 ⇒ 抽屉布局跑偏 |
| R8 自检页 `xbot-selfcheck` | `w≈屏宽×0.94`、`h≈屏高×0.86` | 明显偏离 ⇒ 弹层尺寸没生效 |
| R9 各弹层互斥 | 同一时刻只有一个弹层 `h>0` | 两个同时 >0 ⇒ 弹层没互斥（叠着画） |
| R10 行高合理性 | 该 turn 的迭代数 × 单块最小高度 ≤ 行高 ≤ 迭代数 × 上限 | 行高与迭代数严重不匹配 ⇒ 折叠/上限没生效 |

**读法**：先看 R4/R5/R6（列表塌陷、横向溢出、高度爆炸）——这三条覆盖了"渲染整个错乱、用不了"的绝大多数成因；
再看 R2/R3（安全区、贴底）。任一条违反，把**该页 + 该元素**的实测值发我，我按"一次只改一处"修。

**判读时不要凭感觉**：`w≈0` 与 `x+w>屏宽` 这类硬指标能直接区分"没渲染"与"渲染了但被顶出屏幕"，比看图可靠。

---

## 2026-10-10 交付批次 P1–P14：真机走查清单

回归证据：`tools/tests/run.sh` **35 个测试文件全通过**（含接入后的状态机 `reduce.test.ts` 78 项 +
`streammerge_row.test.ts` 2 项）、release+debug 双产物 `EXIT=0`、
`tools/lint/render-path.sh` 门禁通过。产物：`dist/xbot-harmony-{release,debug}-unsigned.hap`。

逐项在真机上确认（每项都写了"怎么判定通过"）：

| # | 功能 | 判定通过的标准 |
|---|------|----------------|
| P1 | 会话状态栏 | 输入区上方出现「模型 · 12.3k/1.0M x% · todos n/m · cwd」；点开看全量 todos/goal；**拿不到真实用量时该项不显示（绝不显示估算值）** |
| P2 | 真虚拟化 | 长会话（几百条消息）进入不卡；滚动流畅；**节点数不随消息数增长**（自检页可见） |
| P3 | 附件 | 📎 可多选文件、🖼 可相册多选；粘贴板里的图片粘贴后直接变成附件；逐条显示 ⏳/📎/⚠ 且失败可**重试**；发送后消息里图片**内联显示缩略图**（不是"查看图片"按钮） |
| P4 | 模型选择 | 状态面板 →「模型：xxx　切换 ›」→ 按订阅分组的模型列表，当前项高亮；离线项带角标、禁用项不可点；上下文上限可点预设或手输 `200k`/`1m` |
| P5 | 消息操作 | 长按用户气泡/助手消息/**迭代头部**/工具 pill 弹出不同菜单；「复制该迭代正文」只复制该迭代；有链接时菜单多出「打开链接/复制链接地址」；`javascript:` 链接点了会提示不能打开 |
| P6 | ⚡ 插话 | 回合运行中输入区出现「排队 / ⚡ 插话」切换；插话后**不产生新的用户气泡**（内容出现在当前回合内）；**回合结束后自动复位为"排队"** |
| P7 | 会话管理 | 抽屉顶部可按名字筛选；「搜消息」搜的是**当前会话**并给出命中片段；会话行只有**一个 ⋯**（不再并排改名/删除）；⋯ 里有 置顶/上移/下移（置灰时写明原因）/重命名/分支/删除（**删除需二次确认**） |
| P8 | 面板 | 抽屉「面板」→ 四个标签各带计数；定时任务可删；后台任务显示状态/时长/exit code；子代理点一条**直接切到该会话**；Runner 显示在线圆点与 mode/workspace（**不见任何凭据**） |
| P9 | 设置 | 字号四档**立即生效**（消息正文/标题/代码同步变化）；代码换行开/关生效；思考默认展开只在首次进入时套用；发送键切成「Ctrl/⌘+Enter」后 Enter 变换行；与 Web 改同一份偏好（在 Web 改 locale/accent，这里读到的值会变） |
| P10 | 多会话并行 | 打开 2–3 个会话 → 标签栏出现且带 ● 运行标记；**切回已打开的会话是瞬时的**（无 loading/无重连）；✕ 关标签后若关的是当前会话会切到另一个 |
| P11 | 输入体验 | 输入框可多行且自动增高（最高约 6 行后内部滚动）；输入 `/` 出现命令补全（前缀匹配）；输入 `@` 出现文件补全（**目录优先**、选目录继续下钻）；`a@b.com` **不会**触发补全；发送/选候选有轻微震动 |
| P12 | 图片查看器 | 双击放大到 250%（再双击复位）；双指缩放有上下限；放大后可拖动且**拖不出边界**；未放大时拖不动；`SaveButton` 保存到相册成功后有 toast |
| P13 | 动效手感 | 按钮/菜单项/pill/会话行按下有反馈；回合运行中「思考中…」有 600ms 呼吸；不在底部时出现「↓ 回到最新」 |
| P14 | 弱网 | 关掉服务端/切飞行模式 → 顶部出现「连接断开，正在重连…」；**杀掉进程重开，草稿还在**；发送失败出现「上次发送失败 / 重试 / 丢弃」，点重试直接重发 |

### 尚未交付（**已单列，不假装完成**）

- **P9b 浅色主题**：当前仅深色。实测规模 = **378 处硬编码颜色字面量**（`pages/Index.ets` +
  `components/*.ets`）。半途换色会得到"一半深一半浅"的破碎界面 ⇒ 必须先把颜色收敛成
  **语义 token**（背景/卡片/正文/次要/边框/强调/成功/警告/危险），再由主题选色板。
  这是一次独立的重构（预计把 378 处替换成 token + 双色板 + 逐屏比对），不适合与其他改动混做。

## 2026-10-11 批次：**"同一件事只能有一个判据"** —— 两次用户亲报 bug 的共同根因

这两次都是**"我们有，但做错了"**（不是缺功能），因此单列为走查**必查项**：

| 用户报的现象 | 根因模式 | 正确做法 | 证据 |
|---|---|---|---|
| 「**你搞了两个思考 spinner?!**」 | 同一件事（在飞）被**两处判据**同时表达（思考行呼吸 + 光球） | **同一时刻只有一个在飞动效**：光球是唯一"在飞"主角；思考行只做**静态**变色（`accentSoft`），不参与呼吸 | `2753031`（光球并进思考行作**前导图元**，取代灯泡） |
| 「**executing 的 tool 被当成排队，而 generating 被当作 executing**」 | ①同一状态的**文案 vs 颜色 vs 形态**走了不同判据（文案说 pending、chip 底色与圆点形态说 running）；②按 `name#label` 合并，而**标签在流式期还在增长 ⇒ 唯一键每帧都变**；③合并**后到者赢**，陈旧快照覆盖新状态 | ①**一个纯函数的同一个返回值**同时决定 上色/形态（实心·空心·虚线）/chip 文案/是否扫光；②**按身份（`call_id`）合并**，`generating` 不参与去重；③**终态优先**（`error/done=3 > running=2 > pending=1`） | web `progressStore.ts:339-370 dedupTools`；`FoldedToolGroup.tsx:201-209` 三档独立 |
| 深色空态星形外面是**圆角方盒**光晕 | 用 `.shadow` 做"圆光" ⇒ 它按**字形包围盒**渲染 | **圆光一律 `radialGradient` 裁圆**（`.borderRadius(r)` + 中心 accent、边缘透明，与登录页顶部光晕同手段） | `002f169`（真机取证：亮区 x 恒为 556..763 的矩形） |

**走查时的机械判据**（不靠感觉）：
1. 数一遍屏幕上有几个"在飞"动效（光球？呼吸？扫光？打字机光标？）——**>1 就是缺陷**；
2. 任取一个**工具行**：它的**颜色 / 形态 / 文案 / 动画**能否用一句话同时解释？**不能就是判据不同源**；
3. 任取一个**列表渲染**：它的**唯一键**在数据流式变化时会不会变？**会变 ⇒ 重复行/丢状态**；
4. 任取一个**强调 / 光晕**：它是 `.shadow` 做的吗？**是就可能被字形包围盒出卖**（改 `radialGradient`）；
5. 任取一处**"两处显示同一信息"**（抽屉卡片 vs 会话头、弹层 vs 主区）：口径是否**同一个纯函数**？

**门禁侧（同批次）**：`tools/gate.sh` 第 ④ 步会**增量空转**（打出 1 秒级 `BUILD SUCCESSFUL` 却没做 ArkTS 类型检查）⇒ 判据是「**`✅ 真门禁全绿` 且 ④ 是十几秒级真编译**」。详见 `docs/ARKTS-GOTCHAS.md` 批次 21。

### 追加判据 6–8（2026-10-11 批次 22–24）

6. **"工具"本身也要被走查** —— 判据：**它宣称的覆盖范围能被数出来吗？**
   - 实例：`tools/typecheck/check.sh` 声称检查 `core/`，打印"**51 个文件**"；而 `core/` 实为
     **51 个 `.ets` + 9 个 `.ts`**（端口件）⇒ 那 9 个**从未被检查**（假绿）。⇒ 修后 **60**。
   - 机械做法：任何"检查 N 个文件/覆盖 X"的输出，都要能用一条**独立的 `ls | wc -l`** 复核。
7. **"假红"与"假绿"同罪** —— 判据：门禁**并发跑两次**还稳定吗？
   - 实例：`check.sh` 用固定 `build/` 目录 ⇒ A 的 `rm -rf` 删掉 B 的 `cp` 目标 ⇒ 间歇性假红
     （`cp: … No such file`），会让人去追不存在的鬼。⇒ 产物目录**带 PID** + `trap` 清理。
8. **提交卫生（多线并行）** —— 判据：`git diff --cached --name-only` **恰好**等于你要提交的文件集？
   - 实例：并行时另一条线的 `git add` 把它的文件扫进**我的**提交（批次 24）。
   - 规则：只用**严格 pathspec** `git add -- <确切文件>`；提交前核一遍清单；已串入 ⇒ `reset --soft` 重提。
   - ⛔ 另外：`touch` 一律 `touch -c`（裸 `touch` 会把**已删除**的文件复活成 0 字节幽灵，批次 17）。

## 2026-10-11 批次：**浮层验收以截图为准**（我本人踩出的假阴性）

**事故**：验收「会话抽屉」时，我用 `uitest dumpLayout` + 文本匹配判定"抽屉没打开"，连试 5 个坐标全不命中，
据此报了一个**不存在的 bug**（"`☰` 点不开 ⇒ 设置入口已死"）。截图立刻自证清白：抽屉**完整打开**
（会话 / +新建 / ✕ / 筛选会话… / 搜消息 / 项目·状态·时间 / 渠道 chips / 会话列表 / 底部成组
**设置 · 面板（任务/子代理/Runner）· 退出登录(红)**）。

**根因**：抽屉所在的**浮层是独立窗口**（`dump` 里主界面节点带 `hostWindowId:185`，抽屉不在该窗口树里）
⇒ `dumpLayout` 只 dump 主窗口 ⇒ **它看不见任何浮层**，文本匹配必然 0 命中。

**判据（硬，写下来防复发）**：
1. **浮层（抽屉 / sheet / popover / 半屏面板 / 对话框）状态一律用截图判定**；⛔ **不用 `dumpLayout`**。
   `dump` 只可用于**主界面**的节点定位（找坐标），不可用于判"浮层开没开"。
2. **连拍"字节完全相同" = 状态稳定，⛔ 不等于"没有变化"**。我曾据"4 帧字节完全相同"判定"点击无反应"，
   而那 4 帧其实都是**抽屉已打开**的稳定态。判读必须**看图**，别只看哈希/文件大小。
3. **⛔ 不要对同一坐标连点做"探测"**：抽屉打开后同一坐标会落在**抽屉/scrim**上，再点即
   `closeDrawer()`（scrim 的 onClick）⇒ 探测动作**自己把状态改掉**。
   正确节奏：**一次点击 → 一次截图 → 再决定下一步**（原子、状态可追溯）。
4. 点按注入通道 `uitest uiInput click x y` 与 `uinput -T -c x y` **都可用**（点输入框即弹键盘，一次实验即可验）。
   两条通道都"无效"时 ⇒ **先怀疑判据（dump），再怀疑 App**。

---

## 2026-10-11 批次：**文字裁切/溢出**审计（"所有细节都做好"类）

**缺陷类**：文案被裁成 `…`、长串不换行撑破布局、`maxLines` 截掉关键信息 —— 用户可感的粗糙。
本批钉的是**最容易静默发生**的一种：**`.maxLines(N)` 却不配 `.textOverflow(...)`**
（ArkUI 默认 `TextOverflow.Clip` ⇒ 超出部分**直接消失、连 `…` 都没有**，用户不知道还有内容）。

**判据**：`tools/tests/text_truncation_gate.test.ts`（9 passed / 0 failed）——
**凡带 `.maxLines(` 的 `Text` 必须同时带 `.textOverflow(`**，除非属下列三类之一（各有出处）：
- `KNOWN_OK`（已确认安全，逐条理由）：**代码/diff 视图**（`ToolPopover` 的 `ln…` 两处 ——
  该视图**横向滚动**，加 `…` 反而**语义错误**；纵向 `maxLines` 只是护栏）；
- **结构性豁免·空白**：`Text(){}` 容器 / `Text(' ')` 占位 ⇒ **没有可裁的内容**（按性质放过，会打印条数）；
- `PENDING_SPEC`：`pages/Index.ets` 六处（`loadErrHint` / `attachChipText` / `cronLine` / `bgTaskLine` /
  `subagentLine` / `runnerLine`）—— **归 main agent**，本线只出 spec。
⛔ 两张表**只许缩短**：断言"实测集合 == 两表之并"⇒ 新命中必红、已修好也必须同步缩短。

**扫描器自证的教训（值得单独记）**：第一版**遇 `{` 就停** ⇒ `Text() { ... }.maxLines(1)` 的属性链
在**花括号块之后**读不到 ⇒ `maxLines` 计数**假 0**，差点据此得出"全仓没问题"的**假结论**。
⇒ 现先跳过配平的 `{...}` 块再读链，并有专门断言「`maxLines` 总数 > 0」守住这个 bug 不复发。
（同批还踩了第二个：**键不一致** —— `rel` 用全路径、台账用短路径 ⇒ 全判"未登记"。）

**本批落地（2 处，均在 `components/**`）**
| 位置 | 改动 | 为什么 |
|---|---|---|
| `components/MenuSheets.ets:250` | `+ .textOverflow({overflow: Ellipsis})` | 搜索命中行 `.maxLines(3)+BREAK_ALL`，**动态长文本**；原为第 4 行起静默消失 |
| `components/SettingsDeveloper.ets:354` | `+ .textOverflow({overflow: Ellipsis})` | 事件名 `.maxLines(1)`，**动态**；原为静默截断无提示 |

**真机清单（⛔ 本轮不占设备，留待通知后跑）**：① 极长会话名（抽屉/头部）② 极长工具输出（pill label / 浮层）
③ 极长 URL（消息内链接）④ 错误详情（`LlmErrorNotice` 展开 + `Index.ets` 的 `loadErrHint`）——
逐个看：**截得有没有提示**（`…`）、**有没有撑破布局**。

---

## 2026-10-11 批次：**命中区/热区**审计（目标⑤"交互起来很爽"）

**规范出处（⛔ 取仓内真源，不臆造）**：`core/design.ets HIT_TARGET_MIN = 44`（注释出处：Apple HIG ≥44pt）。

⛔ **2026-10-11 真机结论（推翻旧口径）**：`responseRegion` 的**负偏移外扩在真机（SDK21）上不生效**。
主 agent 装机对照实验（干净 HEAD HAP）：给 `ModelSheet` 关闭 X 加
`.responseRegion({x:-6,y:-6,width:44,height:44})` ⇒ 点 X **视觉中心**关闭 ✓、点**框外 11-15px**（仍在父 `Row` 内）**不关闭** ✗。
⇒ **可靠做法 = 让元素自己的布局盒 ≥44**（`Row/Stack().width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)`
`.justifyContent(FlexAlign.Center)` + `onClick` **落在该盒**），⛔ 不再靠 `responseRegion` 越界外扩。

✅ **2026-10-11 复验（判决性 · 阴性对照 · 主 agent 装机 `b0108f7`）** —— 证明**新做法有效**、且**不是"随便点都关"**：
`ModelSheet` 改真 44 盒后，dump 实测可点盒 = `[1062,1067][1211,1216]`（**149×149px ≈ 46vp ≥ 44** ✓），图标仍 58px；
| 点位 | 旧实现（`responseRegion` 外扩） | 新实现（真 44 盒） |
|---|---|---|
| 盒内、**图标外** 左侧 86px `(1080,1141)` | ❌ 不关闭 | ✅ **关闭** |
| **盒外** 42px `(1020,1141)`（**阴性对照**） | — | ✅ **不关闭**（证明非"任意点即关"） |
| 盒内右下角 `(1200,1200)` | — | ✅ 关闭 |
⇒ **判据只能钉"源码形态"（`responseRegion` 归零 + 布局盒 ≥44），抓不到"真机是否生效"** ⇒ 凡改热区做法，
**必须**在本清单按上表的"盒内图标外 / 盒外"两组点位做**装机对照**（⛔ 只点视觉中心不算验证 —— 那在旧实现下也过）。
本波已把 `components/**` 的 12 处旧写法全部改造（逐条见 `tools/tests/hittarget_audit.test.ts` 的 §B2 输出），
`SplashOverlay`「轻点跳过」的 `responseRegion` 删除（其**父容器已整栏 `onClick(跳过)`** ⇒ 热区天然 = 整屏，本就不需要）。
⚠️ 图标**视觉尺寸一律不变**（盒内居中）；`MessageNav` 的 32 视觉盒包在 44 外壳内（按压态底纹因会溢出 32 盒 ⇒ 只保留"提亮"）。

**判据（三条，全离线硬红）**：
- `tools/tests/hittarget_audit.test.ts`（22 passed / 0 failed）——
  **A 类**：`components/**` 内 **`responseRegion` 数必须为 0**（`RR_LEDGER` 台账，只许缩短）——
  **禁用外扩拐杖**（设备已证无效）。`pages/**` 归 main agent ⇒ 仅打印上报不判红。
  **A2 类**：`components/**` 可点小图标视觉 < 44 且**无任何补偿** ⇒ 红（台账 `GLYPH_LEDGER`，空）。
  **B 类**：浮层构件内的 `Scroll`/`List` 必须显式 `.scrollBar(...)`（默认 `Auto` 会挡右缘点击）。
- `tools/tests/hit_target_gate.test.ts`（10 passed / 0 failed）——
  可点元素若显式设了 < 44 的 `height/width/size/constraintSize` 数值、且链上**没有** `HIT_TARGET_MIN` ⇒ 红。
  ⛔ `responseRegion` **不再算补偿**（`stripResponseRegion` 先把链上的它剥掉再判）。
- `tools/tests/hit_spacing_gate.test.ts`（10 passed / 0 failed）—— 热区尺寸 ≥44 且同容器内 ≥2 热区须不重叠。
⛔ 阈值**从 `design.ets` 现场解析**（不写死），并断言 **`HIT_TARGET_MIN ≥ 44`** —— 防止"标准被悄悄下调而判据仍绿"。

**历史命中（前一批，尺寸类）**：扫 45 文件 / **200 个可点元素** ⇒ A 类命中 **6 处**（全低于 44vp）：

| 处置 | 位置 | 原值 | 改成 |
|---|---|---|---|
| ✅ 已修 | `components/SelfCheckSheet.ets:50` | `constraintSize({minHeight: 40})` | `HIT_TARGET_MIN` |
| ✅ 已修 | `components/SettingsDeveloper.ets:309/447/457` | `.height(32)` ×3 | `constraintSize({minHeight: HIT_TARGET_MIN})` |

⚠️ **`SettingsDeveloper` 的文字按钮不用 `responseRegion` 抬**：它们是 `Row({space: SP_2})` 里的**文字按钮**，
外扩会**与兄弟重叠 ⇒ 误触** ⇒ **文字/密集按钮抬高度、独立图标按钮用 44 布局盒**，按场景分派。

**仍待 main agent 处置（`pages/Index.ets`，本线只报不改）**：
| 位置 | 类型 | 说明 |
|---|---|---|
| `pages/Index.ets:3856` | A 类 `responseRegion` | 「回到最新」药丸：`responseRegion({x:-12,y:-12,width:'100%',height:44})` ⇒ 改真实 44 布局盒 |
| `pages/Index.ets:4213` | A 类 `responseRegion` | 发送/停止圆钮：视觉 32 + `responseRegion` 居中外扩 44 ⇒ 改「44 外壳包 32 视觉」 |
| `pages/Index.ets` 7 处 | A2 类 | 可点 `SymbolGlyph` 视觉 <44 且无补偿（见 `hittarget_audit` §B 的 pages 打印） |

**扫描器自证教训**：mutation 断言第一版写成 `got.length > PENDING_SPEC.length`（2）——
而基线带 `PENDING_SPEC` 后未登记命中恒为 **0**、注入后为 **1** ⇒ `1 > 2` 为假 ⇒ **判据自己假红**
（不是产品错）。正确断言是**"出现新的未登记命中"**（`> 0`）。

---

## 2026-10-11 批次：**极端字号（1.3×）+ 长文案**的布局健壮性

**前提先证，别假设**：`KEY_FONT_SCALE` 档 = `[0.9, 1, 1.15, 1.3]`（`core/settings.ets:182`），最大 **1.3**。
⚠️ **关键发现**：`fontScale` **只作用于 `MarkdownView.sz()` 一处**（`MarkdownView.ets:349 return n * this.fontScale;`），
经 MessageRow/LiveTailView 传参；设置/抽屉/sheet 走 `fs()`（**不带缩放**）
⇒ **审计面 = 消息渲染那 3 个文件，不是全仓**。这个前提很脆弱（有人加第二处缩放出口 ⇒ 审计面**静默失效**）⇒ 已加断言守住。

**可行性判定（如实说）**：⛔ **离线的"宽度估算"不可信** —— 本仓**没有任何字体度量**（字宽系数 / 系统字体
metrics 都没有），`字符数 × 系数` 是**臆造**，只会产假绿/假红。⇒ 离线**只做结构性判据**；
**定量结论必须真机 1.3 档逐面截图**（协议见下）。

**判据**：`tools/tests/font_scale_robustness_gate.test.ts`（8 passed / 0 failed）
- ① `* this.fontScale` 全仓**恰 1 处**（多一处 ⇒ 审计面漂移 ⇒ 本判据会漏）；
- ② 缩放面内：含 `sz(` 的**多 Text Row** 必须有 `layoutWeight`/`flexShrink`；
- ③ 缩放面内：`sz(` **不得**落在带**固定数值宽**的容器里。
- mutation：注入"多-Text Row 含 `sz(` 且不给收缩" ⇒ 必红；注入**第二个缩放乘子出口** ⇒ 必红。

**实测结果（否定结论，非"没扫"）**：缩放作用面 **5 文件**、`sz(` 仅 **5 处**、容器全是 `Span`（在换行 `Text` 内）、
MarkdownView **无固定数值宽容器** ⇒ **结构性命中 0**。即：**当前 1.3× 下没有可离线的挤压风险点**。

**⛔ 真机协议（设备归 `orb-ux`；等通知后跑）**
1. 装 HEAD（隔离 worktree + `deploy.sh`，`pgrep -f hvigor` 确认空闲）；设置里把 **字号档拉到 1.3**（`KEY_FONT_SCALE`）。
2. **逐面截图**（每条必须给"是否挤压/溢出/截断"的判读）：
   ① 消息正文（含**表格**：列宽是否被挤、是否横向溢出）② 消息**工具 pill 行**（长工具名 + 1.3×）
   ③ 消息**状态行**（`模型 · 上下文 · cwd`，cwd 是长路径）④ **代码块**（含超长行，是否横向滚动仍可用）
   ⑤ 头部**长会话名** ⑥ 抽屉会话行（长标题）⑦ 设置面板（tab + 行 + 开关）⑧ 各 sheet 标题/按钮
3. 判读纪律：**框与图同系**（同一次 `snapshot_display` + `dumpLayout`）；⛔ 单点像素不作判据；
   发现不达标 ⇒ 出 spec（保留条目），⛔ **不调阈值迁就**。

---

## 2026-10-11 批次：**图标资产与符号一致性**审计

**缺陷类（"廉价感"来源）**：① `SymbolGlyph`/`Image` 取色不走唯一口径（字面量 ⇒ 换主题不跟）；
② **直写符号/emoji 当图标**（`Text('↑')` / `Text('● 录制中')`）—— 图标即文本，字形随字体漂移、不参与取色/尺寸 token。

**判据**：`tools/tests/icon_consistency_gate.test.ts`（10 passed / 0 failed）
- **A（硬）**：`SymbolGlyph`/`Image` 链上 `.fontColor(...)` **不得含颜色字面量**；
- **B（硬）**：`Text(<字符串字面量>)` 的**首字符是符号/emoji** ⇒ 视为"图标即文本" ⇒ 红；
  例外台账 `KNOWN_OK`（⛔ 只许缩短）；
- **C（报告，不判红）**：图标**尺寸**清单（是否收编成 token 由设计侧定）。
- mutation（**合成源码**，⛔ 不真注入——真注入 `Text('✨')` 会破坏编译）：SymbolGlyph 用字面量色 ⇒ A 红；
  `Text('✨')`/`Text('↑')` ⇒ B 红；**反向对照**：纯文案（符号不在首位）不命中。

**实测**：SymbolGlyph **77** / Image **4**；**A 命中 0**（取色口径干净）；**B 命中 3 → 已全部修掉**：

| 位置 | 原写法 | 改成 |
|---|---|---|
| `components/QueueSheet.ets:81` | `Text('↑')` **可点按钮** | `SymbolGlyph($r('sys.symbol.chevron_up'))` |
| `components/QueueSheet.ets:84` | `Text('↓')` **可点按钮** | `SymbolGlyph($r('sys.symbol.chevron_down'))` |
| `components/SettingsDeveloper.ets:406` | `Text('● 录制中')` 状态点 | `SymbolGlyph($r('sys.symbol.circle_fill'))` + `Text('录制中')`（拆两兄弟节点，父容器本是 `Row(space:SP_2)` ⇒ 布局不变） |

⚠️ 三处都换成本仓**既有** symbol 名（别处已在用 ⇒ 命名安全）；`SymbolGlyph` 取色是**数组形态**（`fontColor([...])`），与 `Text` 的单值形态不同。
**C 报告**：图标尺寸现为字面量（`12×7` / `17×8` / `13×7` / `20×3` / `15×1` …），也有走 token 的（`ICON_MD` / `MARKER_GLYPH` / `X_GLYPH` / `FS_CAPTION`）⇒ **档位不统一**，建议设计侧收编（**只出报告，不判红**）。

**⛔ 明确不算违规的（免得后人重复判定）**：markdown **列表符/任务框**（`MarkdownView` 的 `'•'`、`liChecked` 勾选字形 —— markdown 语义要求的文本项目符）；
`ToolPopover.classifyLine()` 的 `'✗'/'✓'/'✅'`（在**检测工具输出文本**，我们不绘制它们）；日志/诊断里的 `⇒`；说明文案里的 `→`（不在首位）；密码掩码 `'••••••••'`。

**⚠️ 判据的已知边界（显式记录，不藏）**：B 按"**首字符是符号**"识别 ⇒ 若某条**正文**恰以符号开头（`'→ 说明'`），会被判红
⇒ 属**设计内**：走台账登记（写明"这是正文不是图标"），而**不放宽规则**（规则一宽就抓不到真图标）。已写成断言。

---

## 2026-10-11 批次：**C 类 spec —— 图标尺寸档收编**（供 `brand-impl`/`splash-ux` 排期）

**现状（实测，`SymbolGlyph` 77 + `Image` 4）**：**49 处不写 `fontSize`**（继承父字号 —— **最健康**的形态，
跟随文本缩放/行高，应鼓励）；其余档位**字面量与 token 混用**：

| 形态 | 值 | 次数 | 落点 |
|---|---|---|---|
| 字面量 | `12` | 6 | 多处 |
| 字面量 | `13` | 5 | 多处 |
| 字面量 | `17` | **8** | 多处 |
| 字面量 | `20` | 3 | 全在 `SelfCheckSheet`（样张 20vp） |
| 字面量 | `22` | 3 | 全在 `pages/Index.ets`（头部/按钮大字图标） |
| 字面量 | `11` / `15` / `52` | 各 1 | 一次性光学档（52 = 巨型图标） |
| token | `ICON_MD` | 2 | — |
| token | `fs('type.callout')` | 2 | 跟随文本档（合理） |

**本仓已有常量**：`MARKER_GLYPH=13`（`design.ets:494`）· `ICON_SM=12`（`:562`）· `ICON_MD=14`（`:564`）· `ICON_LG=16`（`:566`）。

**⚠️ 关键发现：已有 token 被"绕过"** —— `ICON_SM(12)` 存在却用字面量写了 **6** 次、`MARKER_GLYPH(13)` 存在却写了 **5** 次。
⇒ 这不是"缺档"，是**已有档没被用**。

**建议档位（最小改动：不动已有值，只补 1 个新档 + 1 张光学白名单）**

| 档 | 值 | 处置 | 覆盖的字面量 |
|---|---|---|---|
| `ICON_SM` | 12 | **已有，改用** | `12`×6 |
| `MARKER_GLYPH` | 13 | **已有，改用** | `13`×5 |
| `ICON_MD` | 14 | 已有（暂无散落） | — |
| `ICON_LG` | 16 | **已有，改用**；`17`×8 ⇒ **建议并入 16**（差 1vp 视觉无感，多一档不如少一档） | `17`×8 |
| **`ICON_XL`（建议新增）** | **20** | 新增；`22`×3 ⇒ **建议并入 20** | `20`×3 + `22`×3 |
| 光学档白名单 | `11` / `15` / `52` | 各 1 处，**不收编**；按 `design.ets` 既有 `opticalValues()` 先例登记（"非 4 网格的光学档"） | — |

⇒ 收编后：**字面量从 27 处降到 3 处**（全部落在光学白名单），token 化率 ≈ 89%。
⛔ **未出硬红判据**（属设计取舍，不是缺陷）：若要变成判据，先由设计侧拍板上表的档值，我再加
"图标尺寸必须来自档常量或光学白名单"的 A 类规则 + 台账。

**⚠️ 未测项（如实说）**：本轮没量**图标与相邻文本的对齐**（基线/居中是否一致）——
那需要真机像素（`SymbolGlyph` 的视觉盒随 symbol 变化），属"真机逐面"范畴，⛔ 不在离线臆测。

---

## 2026-10-11 批次：**图片/多媒体的边界与可读性**

**缺陷类**：图片**没有填充色** ⇒ 浅色下"白图压白底"、深色下"深图压深底"会**消失**。

**枚举（实测：全仓 `Image(` 仅 4 点）**

| 点 | 非图片分界手段 | 说明 |
|---|---|---|
| `components/AuthImage.ets:88 Image(this.pm)` | `.backgroundColor(surfaceFillOf(p,'surface.chip'))` + **本轮补上的发丝** | **唯一内联图片渲染器**（消息图 / 插件徽标都走它） |
| `components/Lightbox.ets:174` | ——（**全屏** `width/height 100%`） | 全屏看图：**分界就是屏幕边缘** ✓ 正常设计 |
| `pages/Index.ets:6518 Image(this.imagePixel)` | ——（**全屏**） | 同上 |
| `components/SplashOverlay.ets:164 start_icon` | —— | **自有品牌资产**（非任意用户内容）⇒ 台账（理由见判据文件） |

**最坏图数字（离线合成）**：`chip(图片卡底) vs 画布` · `纯白图 vs chip` · `纯黑图 vs chip`

| 主题 | chip vs 画布 | 纯白图 vs chip | 纯黑图 vs chip | 发丝 vs chip |
|---|---|---|---|---|
| dark | **1.0005** | 19.6446 | **1.0690** | 1.2188 |
| light | 1.0788 | 1.1288 | 18.6044 | 1.2354 |
| aurora | **1.0198** | 19.1872 | 1.0945 | 1.4160 |
| nebula | **1.0173** | 19.7864 | 1.0613 | 1.3288 |
| porcelain | 1.0456 | 1.1195 | 18.7585 | 1.2714 |

**判定（如实说）**
1. **全屏看图不需要边界** —— 图片铺满屏幕时"边界"就是屏幕边缘；⛔ 给白图硬加描边反而是**错**的（看图要沉浸，不是相框）。⇒ **不造需求**，记台账。
2. **内联图片卡（AuthImage）需要边界**，而它此前唯一的边界就是 `surface.chip` 那层填充 ⇒ 在 **dark / aurora / nebula 都 <1.03**
   ⇒ 与 `§15` 唯一残余缺口「画布→下沉」**同一个根**（图片卡在深色系等于没边界）。
3. ⚠️ **反直觉真缺陷（本轮发现并已修）**：`AuthImage` 的**失败/兜底态有发丝**，**加载成功态没有**
   ⇒ "**图片没加载出来比加载出来了边界更清楚**"，顺序颠倒 ⇒ 给成功态补上同一条结构性发丝
   （`hairline` 在 dark/aurora/nebula 对 chip ≥1.20 ⇒ 是这几个主题下**唯一**能立边的手段）。

**判据**：`tools/tests/image_boundary_gate.test.ts`（7 passed / 0 failed）——
**内联 `Image(` 必须有非图片分界手段**（`.backgroundColor(` 或 `.border(`）；**全屏**（`width/height 100%`）免判；
台账 `KNOWN_OK`（自有品牌资产，⛔ 只许缩短）。mutation：去掉内联分界 ⇒ 红；全屏 ⇒ 判为免判。

**⛔ 自证抓到扫描器一个 bug（已记进判据文件头 + 有专门断言守）**：取属性链时**起始空白只跳了 `' \t'`、漏了换行**
⇒ `Image(...)` 后紧跟换行 ⇒ **链恒为空** ⇒ 4 个点的 `backgroundColor` 全报 `False`（**假结论**：
会误判成"全仓图片都没边界"）。修法：跳过 `' \t\r\n'`。

**真机协议（设备归 `orb-ux`；等通知后跑）**：porcelain 下逐图看一遍，**必须含三类极端图** ——
① **纯白图**（白底消失？）② **纯黑图**（深色主题下与底融合？）③ **透明 PNG**（露出的 chip 底是否被读成"图的一部分"）；
外加 ④ 消息内联图在 **dark** 下与页面的边界（对上述 §15 缺口）。判读纪律同前：**框与图同系**、⛔ 单点像素不作判据。

---

## 2026-10-11 批次：**文字层级（type role）使用一致性**

**真源（⛔ 现场从 `core/design.ets` 解析，不臆造）**：`typeRoles()` **8 档，严格递减、无重复**：
`display 28 · title 21 · headline 17 · body 15 · callout 14 · subhead 13 · caption 12 · micro 10`（判据里已断言这条声明成立）。
⚠️ `type.micro` 的源码注释原文：**"替代散落的 10 / 11 字面量"** ⇒ **`11` 不在阶梯里**，这是**本仓自己写下的规矩**。

**⚠️ 一个必须分开的账**：`.fontSize(<数字>)` 全仓有 50 处，但 **`SymbolGlyph`/`Image` 的属"图标尺寸档"**
（上一轮 `icon_consistency_gate` 的 C 类报告），**不算**文字层级。
⇒ **Text/Span** 的字面量字号只有 **19 → 落地 1 处后 18 处**（混数会得出"50 处层级乱"的**假规模**）。

**判据**：`tools/tests/type_role_gate.test.ts`（10 passed / 0 failed）
- **A（硬）**：`Text`/`Span` 的 `.fontSize(<数字>)` 必须走排版档 ⇒ 除非登记在
  `KNOWN_OK`（有据可依）或 `PENDING_SPEC`（**禁改**文件，归他人）；⛔ 两表只许缩短。
- 附加不变量：阶梯**严格递减且无重复**；最小档 = `type.micro` = 10；`11` 不在阶梯里。
- mutation：`Text().fontSize(11)` ⇒ 必被枚举；`typeOf(...).size` ⇒ 不命中（**反向对照**）；
  `SymbolGlyph().fontSize(13)` ⇒ **不**计入（边界明确）。

**清单（18 处）**：
| 归属 | 处数 | 落点 | 处置 |
|---|---|---|---|
| **阶梯外**（最该改） | **11** | `MessageRow` 534/539/542/614/1049 `11` · `Index` 3293 `18` · 3339/3351 `34` · `MarkdownView` 410/415/579 `11` | 前 7 处**禁改** ⇒ spec；后 3 处**有 web 出处** ⇒ 记档 |
| 阶梯内但绕档 | 5 | `SettingsDeveloper` 314/349/353/360/412 `10`（= micro 档值） | **禁改**（`Settings*.ets`）⇒ spec |
| 有据（同浮层对齐） | 2 | `ToolPopover` 320（`ToolCallBlock.tsx:98 text-[12px]` 出处）· 405（与同浮层代码行同号） | `KNOWN_OK` |
| **本轮落地** | 1 | `MarkdownView` 590（表格字段标签，12 = caption 档值却写死） | 已改走 `typeOf('type.caption').size` |

**⚠️ 顺带发现（真缺陷，未落地）**：`MarkdownView` 的**代码条/表格标签用字面量 11/12 且不走 `sz()`**
⇒ **不随 `KEY_FONT_SCALE` 缩放**，而同一 MarkdownView 的正文走 `sz()` ⇒ **1.3× 档下同级文字大小分叉**
（与上一轮"极端字号"审计同源）。属 `MarkdownView` 可改范围，但会改变 1.3× 观感 ⇒ **留给设计侧拍板**（spec 待裁）。

**真机清单（设备归 `orb-ux`）**：porcelain 下逐屏看"**层级是否一眼可辨**、**同级是否整齐**"：
设置面板（tab / 行标题 / 行说明）· 抽屉（分组标题 vs 会话行）· 消息（正文 vs 元信息 vs 工具名）·
各 sheet（标题 vs 行）· 空态（display vs caption）—— 重点看**同一屏里同一层级的文本是否同档**。

## 滚动边界（2026-10-11 记档）

- **4 个面板 `List`（`pages/Index.ets:5617/5636/5652/5674`：bg 任务 / subagents / runners / cron）刻意不设 `edgeEffect`** ——
  裁决：**不做**。理由：web 的面板是 **DOM 容器**，`overscroll-behavior` **默认也不回弹** ⇒ 现状 **≈ web parity**；
  统一成 `EdgeEffect.Spring` 属**口味**，不是对齐。（主消息列表**已**是 `EdgeEffect.Spring`，见 `:3733` —— 那里与
  web 的浏览器原生 overscroll 同向。）
- ⏳ 待查（他域 = chat-surface-ux）：**代码块横向边界**（`MarkdownView` 的横向 `Scroll`）有无 `edgeEffect`、
  与外层纵向列表手势是否竞争。

---

## 2026-10-11 批次：**水平溢出**（用户亲报"不要让字超过屏幕范围!"）

**证据（用户截图，深色 + 一条 Markdown 回答）**：① 正文首段尾部被裁在右缘；② 代码块里"代码 + 右对齐注解"的行末被裁；
③ 底部状态行 cwd 被裁。**推断同源**：**代码块的固有宽度 > 屏宽且容器不限宽/不裁剪** ⇒ 把整条消息列撑宽。

**判据**：`tools/tests/horizontal_overflow_gate.test.ts`（9 passed / 0 failed）
- **H1（硬）**：`Row` 内**可变长内容**的 `Text` 必须能收缩（`layoutWeight`/`flexShrink`/`constraintSize` 三选一）。
- **H2（硬）**：`maxLines(N)` 必须配 `textOverflow`（**已由 `text_truncation_gate` 覆盖**，本文件不重复判）。
- **H3（硬）**：**可能含不可断长串**（URL / 绝对路径 / cwd / 错误原文 / 命令参数）必须 `wordBreak(BREAK_ALL)` 或 `textOverflow`。
- ⛔ **纯短常量（`'保存'`/`'−'`/`'搜邮件'`）一律不报**（无变长 ⇒ 不制造噪声）；mutation 含该反向对照。

**实测 27 处**，分三类（⛔ 三张表都**只许缩短**）：
| 组 | 处数 | 说明 |
|---|---|---|
| `KNOWN_OK`（已证良性） | 1 | `ToolPopover` diff 的 **`+/-` 标记列**：内容宽度**固定**（±/空格三态），且**必须**无 `layoutWeight`（要定宽才能与代码列对齐）⇒ 不可能顶出屏 |
| `PENDING_SPEC`（**他域**） | 17 | `components/Settings*.ets` ⇒ **tokens-ux**；`pages/Index.ets` ⇒ **chat-surface-ux** |
| `PENDING_FIX`（**本域待办**） | 9 | 插件卡片标题/胶囊/徽标（`PluginHost`/`PluginWidgets`，**插件提供任意长**）· 目标条徽标 · 选择项标签 · 状态行 · 子代理树/合成卡/思考行标签 · diff 正文行 |

**本轮落地（2 处，均在 `components/**` = 我域）**
| 位置 | 改动 | 为什么 |
|---|---|---|
| `components/PluginHost.ets:228` | `+ constraintSize({maxWidth: PILL_MAX_W})` `+ wordBreak(BREAK_ALL)` | 内容由**插件**提供（任意长，可能含 URL/路径等**不可断串**）⇒ 否则把宿主行**顶出屏宽** |
| `components/PluginsSheet.ets:158` | `+ wordBreak(BREAK_ALL)` | 状态行承载**失败详情/错误原文**（URL/路径/base64）⇒ `wordBreak(NORMAL)` 找不到断点 |

**⚠️ 顺带核实（结论对 `chat-surface-ux` 有用）**：`MarkdownView` 的代码块**已有**横向 `Scroll(.scrollable(Horizontal).width('100%'))`
与块体 `.width('100%')`；**但** `.clip(true)` 挂在**表格**块上、**不在代码块上**，且 `width('100%')` 在**父级无确定宽**时等于不限宽
⇒ 这正是截图里"撑宽整列"的形态。⇒ 本轮**未落地**（`MarkdownView` 在途，归 chat-surface-ux）；诊断已按口径建好，等它改完我复跑。

**真机协议（设备归 `orb-ux`）**：porcelain + dark 各一遍，用**同一条回答**（含长 cwd/代码块注解）+ **长 URL** + **长 cwd 路径** + **超长英文词** ⇒ 逐面截图，
判据：**内容右边界不得超过安全区**（⛔ 单点像素不作判据）。

### 补：**H0（硬）** —— `Scroll` 的宽度约束 + 容器 `clip`（用户截图指向的那条）

**为什么（证据）**：`Scroll` 若**没有宽度约束**（或祖先无 `clip`）⇒ 横向滚动区会**按内容撑宽父级**
⇒ 整条消息列超出屏宽 ⇒ **正文首行尾部与代码块末行都被裁在右缘**（正是用户截图）。

**分级（⛔ 按证据精确化，不一律判红）**：
- **横向** `Scroll`（`.scrollable(ScrollDirection.Horizontal)`）**才能**按内容撑宽父级 ⇒ **硬红**：必须 `width('100%'|任意 %)`/`constraintSize(maxWidth…)` **且** 自身或最近祖先块容器有 `clip(true)`；
- **纵向** `Scroll` 撑宽风险低得多（内容宽度通常受父级约束）⇒ 只**要求宽度约束**；缺 `clip` 记 **警告 + 台账**。

**实测（全仓 `Scroll` 22 处）**：**全部 22 处都有宽度约束** ✓（20×`'100%'` + 1×`'94%'`）；
**横向 3 处缺容器 `clip`** ⇒ **H0 硬红命中 3 处，全在他域**：
| 位置 | 归属 |
|---|---|
| `components/MarkdownView.ets:456`（**代码块外层 Scroll，截图证据指向的就是它**） | chat-surface-ux |
| `components/SettingsPanel.ets:283` | tokens-ux |
| `pages/Index.ets:3941` | chat-surface-ux |

**纵向缺 `clip` 15 处** ⇒ 警告级，已登记（⛔ 只许缩短）。

**⛔ 写法提示（曾让整树编译红）**：`.wordBreak` 必须写**限定名** `WordBreak.BREAK_ALL` ——
裸写 `BREAK_ALL` **不是全局名**（`SettingsChannels.ets:462/574` 曾因此让整树 `Cannot find name 'BREAK_ALL'`，已由 `ff1f371` 救火）。

### 补：**本域 `PENDING_FIX` 落地 4 处**（H1/H3）

| 位置 | 类别 | 改动 | 为什么 |
|---|---|---|---|
| `components/PluginWidgets.ets:128` | H1 | `+ constraintSize({maxWidth: PILL_MAX_W})` | 徽标文本由**插件**提供（任意长）⇒ 否则把所在 `Row` 顶出屏宽 |
| `components/GoalBanner.ets:172` | H1 | `+ constraintSize({maxWidth: PILL_MAX_W})` | 徽标文案长度不可控（模型生成） |
| `components/ThinkingLine.ets:135` | H1 | `+ layoutWeight(1)` | 与左侧图标同一 `Row`，标签长度不可控 ⇒ 必须能收缩 |
| `components/ToolPopover.ets:412` | H1 | `+ layoutWeight(1)` | 与行号列/标记列同一 `Row` ⇒ 正文取余下宽度，否则长行把整个 diff `Row` 顶出屏宽 |

⇒ `PENDING_FIX` **10 → 6**（⛔ 只许缩短；4 处已修自动变"陈旧"被拦下，这正是该机制在起作用）。
**剩余 6 处**：`AskUserSheet:177` · `PluginHost:393` · `PluginWidgets:77` · `StatusSheet:68` · `SubAgentTree:142` · `SyntheticCard:193`
（`SyntheticCard` 的等宽块已裁定归 **brand-impl**，避免撞车 ⇒ 该文件我只登记不动）。

**⚠️ 顺带改进判据（结构性消假阳性，而不是堆台账豁免）**：新增 **祖先感知** —— 若 `Text` 与最近的 `Row` 之间
**已有容器**具备收缩能力（`layoutWeight`/`flexShrink`/`constraintSize`），则该 `Text` 自身不必再设。
实测把命中从 26 降到 21，**其中 6 处是我原规则的假阳性**。
（⚠️ 同时发现：`PENDING_FIX` 里那 6 处正是此类 —— 它们靠"祖先已收缩"就已经安全；
待下一轮把祖先感知再收紧后即可继续缩短，⛔ 不靠台账堆豁免。）

**⚠️ diff 正文行（`ToolPopover:412`）现归 `KNOWN_OK`（有意）**：源码注明"不折行（web `whitespace-pre`）：
长行由 **diff 卡整体横向滚动**承担" ⇒ `wordBreak(NORMAL)` 是**对齐 web 的有意选择**，不是"忘了 `BREAK_ALL`"。

## 溢出兜底：无人认领两文件（2026-10-11）

- `AskUserSheet.ets`（6 处 `Text`）：**逐个判语义** —— 标题 `'xbot 需要你确认'` ⇒ **锁宽**
  （`constraintSize({maxWidth:'100%'})`，换行会破版）；`q.header` / `labelOf(opt)`（可能是路径/命令）
  ⇒ `wordBreak(BREAK_ALL)`；`q.question` / `opt.description`（多行正文）⇒ `wordBreak(BREAK_WORD)`；
  空态小字 ⇒ `BREAK_ALL`。⛔ 一律**不 `maxLines`**（截断=删信息）。
- `SelfCheckSheet.ets`（15 处 `Text`）：13 处**已有** `.width('100%')` ⇒ 判据把它计作"锁宽兜底"（与
  `MarkdownView` 的 `constraintSize({maxWidth:'100%'})` 同理）；补 2 处 —— 等宽**审计串** `this.auditText`
  与 `Flex(wrap)` 里的 pill 标签 ⇒ `wordBreak(BREAK_ALL)`。
- 判据 `tools/tests/overflow_guard.test.ts`：`MY_FILES` **扩到 7 文件**（先修后纳）；并修一处**盲区**——
  原先 `Text\(([^()]*)\)` 遇到**参数含嵌套括号**（`Text(this.labelOf(opt))`）会**整节点漏扫** ⇒ 正则放宽到一层嵌套。
- ✅ **已收紧（2026-10-11）**：属性链窗口改为 **(A) 链式截断**（截到下一个 `Text(`/`SymbolGlyph(` 或链尾），
  并**剔除 `width('100%')`**（只锁盒宽、不解决文本溢出）⇒ 两条 mutation（`AskUserSheet` 的 `q.header`、
  `SelfCheckSheet` 的 `auditText`）**均能打红**。原弱点留档如下：旧窗口取 Text 之后 700 字符 ⇒ 会**吃到下一个 `Text` 的兜底** ⇒
  对"相邻两节点只有后一个有兜底"的情形**可能假绿**（本轮 mutation 未打红即此因）。⇒ 下轮改成"链式截断到下一个 `Text(` 或行尾"。

## 2026-10-11 驱动与验收教训（三条）

1. **`uitest uiInput keyEvent 1` = HOME**（会把应用退到后台）⇒ 收系统 UI / 抽屉**用点背板**，或 `keyEvent 2`(BACK) 后**复核应用仍在前台**（`dumpLayout` 见 `xbot-composer` 才算数）。
2. **⛔ 驱动坐标会随布局失效** ⇒ 一律 `dumpLayout` 取**真实 `bounds`**，且 `dump → click → 抓日志` **必须在同一条 shell 命令**内原子执行；**点击无效先怀疑坐标**。真实例：`y=2633` 落在 `xbot-composer`（`[1306,1779]`）之外 ⇒ **消息从未发出** ⇒ 曾据此得出「进入发送路径=0 ⇒ UI 入口问题」的**错误结论**（**已撤回**）。发送按钮 = `xbot-composer` 内 **`(1250,1543)`**。
3. **溢出验收的机器判据**：`Text` 节点 `right > 1320`（超屏）**且** `right > 1288`（超安全区）**均须为 0**；`dump` 的 JSON **节点在 `children` 里要递归取**。

## 波12 用户亲报四项 —— 装机验收判据（2026-10-11）

> 前置：`~/ohos-cli/deploy.sh` 装机（⛔ 与门禁构建**串行**；`*-unsigned.hap` 装不上）。
> 全部用 `tools/device/ui.sh`（语义化：按文本找元素，⛔ 不写死坐标）。
> ⚠️ **一次只许一条设备线**；**严禁点「退出登录」**（前一轮误点把用户登出过）。
> ⚠️ 第 ① 项需 **LLM 后端可用**（当前 `连接被拒绝` ⇒ 该项挂起，其余不受影响）。

| # | 用户原话 | 修 commit | 步骤（语义化） | 判据（可红） |
|---|---|---|---|---|
| ① | **所有 tool 都渲染为排队**（executing 的也排队） | `102415b` | 发一条会调工具的请求 ⇒ 工具在跑时 `ui.sh dump` | 当前迭代的执行中工具 chip = 「执行中」/「生成中 N 字」，**不得**是「排队」；⛔ 过去迭代的 pending 工具**不得**出现在在飞块。判据同源：`render_inflight.test.ts ★⑤/★⑥`（mutation 4 红） |
| ② | **流式时也要能正常滚动** | `f5c3148` | 在流式中（打字机在动）手指**上滑** | 上滑后**不被拽回底部**，并出现「回到最新」⇒ `ui.sh exists 回到最新` = Y。判据同源：`listfollow.test.ts`（mutation 3 红） |
| ③ | **关闭不好点到 · 滚动栏挡住交互**（模型面板） | `cd33198` → **`1a1efd7` 真修 + 真机确认** | 打开模型面板 ⇒ 点 X **盒内、图标外**（如 X 左侧 86px）；再点**盒外**（阴性对照）；再点模型行**最右侧** | ① 点**盒内图标外** ⇒ **关得掉**（热区 = 真实 44 布局盒 ✓ 真机实测）；② 点**盒外** ⇒ **不误关**（阴性对照）；③ 点行右缘**能选中模型**（`BarState.Off`）。⛔ 旧口径「`responseRegion` 外扩到 44」**已废止**（真机证明其无效 —— 只点视觉中心会**假过**）。⚠️ **2026-10-11 深晚实测**：③ 的"行右缘可选"**当前无法验证** —— 服务端 LLM 未配置 ⇒ 模型面板恒停在「正在读取模型列表…」，**列表为空、无滚动内容**（`BarState` 行为无从判定）⇒ 待服务端配 LLM 后可验。 |
| ④ | **浅色历史白字**（切浅色后**历史**行仍白） | `light-fix3`（在飞） | 切浅色主题（porcelain/light）⇒ 打开**有历史**的会话（⛔ 不新发消息） | `bash tools/device/readability-scan.sh --pull` 逐条 `PASS`（**零扫描也是失败**）。人工复核：历史行正文对底 ≥4.5:1，且与 live 行**同色** |
| ⑤ | 模型列表「**顺序一直变**」 | 待定性 | 连续开关模型面板 3 次 + 切会话后再开 | **离线已排除四处**（服务端稳定序 `llm_factory.go:1205` · `panelTabs()` 常量 · `DEFAULT_SESSION_CATEGORY='path'` · **`groupModels` 保序**：`core/llmfmt.ets` 按 `entries` 顺序建组、组内保序 ⇒ 原生列表顺序 == 服务端 `model_entries` 顺序）⇒ 剩余嫌疑=切会话时 `llmCfg` 重取闪建（或**根本不是模型列表**）。**需截图/录屏定位是哪个列表**后再改（⛔ 不盲改） |

**还原设备（必须）**：主题回 `dark` · 关掉所有浮层/抽屉 · `draft_text` 归空 · 删自建测试会话 · 确认无通知栏/角标残留。

## 浅色「投影变无投影」（2026-10-11 复核 `PORCELAIN-AUDIT` 时发现）—— ✅ 已收口

`Effects.glow` 的浅色臂已改 `p.transparent`（`core/theme.ets:815`，E2 `2b1fc5f`）—— 这是**对的**
（宪法 `REDESIGN §3.1`：浅色系一律禁**彩色发光**）。**而** `pages/Index.ets` 曾把 `glow` 当"投影(shadow)"用的
**4 处**（登录徽标 ×2 / 登录 CTA / 发送钮；旧行号 `:3176/:3191/:3283/:3949` ⇒ 现 `:3417/:3432/:3524/:4220`）
⇒ 浅色下这些地方**从"彩色脏光"变成"完全没有投影"**，层次丢失。

- **修法（已落）**：改走投影唯一口径 `core/theme.ets: shadowColorOf(p, tier)`（口径 `fdb1054`；调用点 `1e3856f`）
  —— 深色 = `glow` **逐字节不变**、浅色 = `elev2`/`elev3`**真投影档**（非透明 + chroma 近中性）。
  ⚠️ **不是** `elevationColorOf`：其深色臂 = `elev2`（会改深色观感）；`shadowColorOf` 深色臂 = `glow` ⇒ 深色等价。
- ⛔ **没有**把 `glow` 改回彩色（那违宪法"白底彩色发光"）。
- **逐处判语义（⛔ 不批量替换）**：
  · **(b) 真投影 4 处**（上述）⇒ `shadowColorOf(p,'raised')`；
  · **(a) 装饰性光晕 2 处**（登录顶光晕 `glowSoft` / 空态星形圆光 `glow`）⇒ **保持 `radialGradient`、浅色不出**
    （正是 E2 的本意）。
- **判据**：`tools/tests/porcelain_shadow_sites.test.ts`（21 passed；逐**调用片段**形态断言 + 浅色非透明/深色逐字节；
  **零扫描判红** + 两层 mutation 实测打红）。
- 登记处：`docs/PORCELAIN-AUDIT.md §0.1`。
- **待设备验证**：浅色（porcelain/light）下登录徽标 / CTA / 发送钮**有中性柔影**、且**无彩色脏光**（本波未碰设备）。

---

## 附：2026-10-11 深晚两份**只读审计**的发现（登记待办，非"已修"）

### A. porcelain（极简白）全量审计（`porcelain-audit`，实算 WCAG 同源公式）
**结论**：**角色层 0 硬缺陷** —— 29 个角色逐条有浅色值、**无一条残留深色** ⇒ 不存在"白底黑块/白字"。
残留 5 项 ⚠️（修复线 `porcelain-fix` 在跑，域限 `core/theme.ets`）：
| # | 项 | 证据（实算） | 状态 |
|---|---|---|---|
| ⚠️-1 | `warn`/`success`/`statusWaiting` 作**小号正文** < AA 4.5 | `warn #B26A00`=**4.238**（对 `appBg` 3.959）· `success #1E8E3E`=**4.205**；**porcelain 专属**（light 主题 7.09/5.48）。真实落点 13 处（`AskUserSheet:113`/`MessageRow:563`/`QueueSheet:111`/`SelfCheckSheet:60`/`SettingsAbout:445,552,461,568`/`SettingsChannels:476,556,562,1053`/`Index.ets:3942,4053,4196`） | ✅ **已修 `ae2c9e0`**：porcelain 压深（保色相）⇒ `warn #9C5900` **4.238→5.465** / `success #1B7A34` **4.205→5.412**（最紧的 `surfaceHi` 面也 ≥4.674）；新增 `theme_contrast §J`（六面族全 ≥4.5 + 零扫描判红 + **mutation 必红**：回填旧值 ⇒ 18 红） |
| ⚠️-2 | `glassBaseOf` 的「同色回退」**已失效**（porcelain `appBg #F7F7F8` ≠ `surface #FFFFFF`）⇒ 玻璃底合成后对画布仅 **1.06**（≈不可见）；`:685-689` 注释已过期 | `core/theme.ets:691-694` | ✅ **已修 `ae2c9e0`**，但**否掉了审计的处方**（有数字）：处方"浅色一律 `surfaceAlt` 打底"会让 porcelain 玻璃 **1.0616→1.0088**，**跌破 `theme_contrast §E5` 地板 1.02** ⇒ 反而更不可见。**改为显式阈值守卫**（`surface` 对画布 ≥ `GLASS_BASE_MIN_RATIO`(1.02) 就用它）⇒ porcelain/light 都回 `surface`、≈**零像素变化**、深色臂逐字节不变；新增 `§E5b`（合成两枚退化浅色板，含"`surface≈appBg` 但不等"这种**旧 `==` 判据会漏判**的情形）+ **mutation 必红** |
| ⚠️-3 | `textSecondary`/`accent` 落 `surfaceHi` = **4.337/4.017 < 4.5**，`contrastReqs()` **未覆盖**该底 | `core/design.ets:898-925` | ✅ **已闭环**：判据侧 `38437fd`（`contrastReqs()` 补两格断言，门槛 4.5 **未放宽**）+ **落点侧全修** —— `8fbe8d2` 换底 3 处（`LiveTailView`/`MessageRow`/`SettingsLlm`）· `3f3e7d1` **别名掩盖** 3 处（`Index.ets` 重命名「取消」/「⋯」只换当前会话支 fg、`AskUserSheet` 整梯下移一档）· `e1428a2` `accent` 当**铬文本** 5 处（`GoalBanner`×2/`MessageNav`/`SettingsAbout`/`TodoPanel`）· `ed1e9a1` ⭐星标。⚠️ **L4（`Index.ets` 发送键）经复核是 `SymbolGlyph` 图标** ⇒ 3.0 达标 ⇒ **不改**；⚠️ `porcelain\|textSecondary\|surfaceHi` 台账**保留**（它是**矩阵格**欠账，与落点是否修好无关） |
| ⚠️-4 | `colorOf` **未暴露** 6 角色（`foreground3`/`accentHover`/`accentSoftFade`/`bubbleUser`/`borderStrong`/`success`）⇒ 绕过取色 role 门禁（只能 `pal()` 直取） | `core/design.ets:853-892` | ✅ **已交 `38437fd`**：6 role 全部接进 `colorOf`（取值逐字不变）；**刻意不接 `transparent`**（它是"未知 role ⇒ 兜底"**哨兵**，接成合法 role 会让"拼错 role ⇒ 静默不可见"不再被 ⑥b 抓住 ⇒ 判断正确、明确追认）。`color-roles.sh` 合法集 **33→39** 且 **未改脚本**（集合从 `colorOf` 的 `role === '…'` **派生**）⇒ 门禁仍绿。`foreground3` **仍 0 消费**（预留角色，见下） |
| ⚠️-5 | `foreground3` **0 消费点**（疑似死角色） | 仅 `core/theme.ets` | ✅ **已登记为预留角色 `ae2c9e0`**（⛔ **不删**：它是 web `--foreground-3` **四阶契约**的对齐角色，删了破 `paletteValues` 穷尽性/四阶阶梯/parity）；已在 `ZERO_USE_ROLES` **机械核实 0 引用** |

### B. 动效「单一来源」审计（`motion-audit`）
**结论**：**❌=0**（无自造曲线 / 无越权 `@ohos.curves` import / 过渡**零字面量时长**）；6 项 ⚠️ 缝隙（`motion-source` 在跑）：
`animSpring()` **0 消费者死工厂**（已删，守卫同步收缩）· `MessageRow` 就地构造过渡 · `SplashOverlay` 本地 `withTiming` ·
`core/splash.ets` 3 个"缺档"其实**底座已有**且注释过期 · 入口曲线两族（**有据**，待 `DESIGN-SYSTEM.md` 明写）· `tokens.D_BASE` 幽灵档（**已清死导入 `9627598`**）。

---

## 目标⑤ 剩余细节审计（2026-10-11 深晚 · `polish-states` 线）—— 五维度真源码走查

> 只读审计 + **低风险实现 3 处**（见下「已实现」）。逐条 `file:line` + 现状 + 为何算缺口 + 修复方向 + 风险 + **能否机器判据**。
> ⛔ 不动 `pages/Index.ets`（perf4 在途）/ `core/{render,markdown}` 等禁改域 —— 涉及它们的只登记。

### A. 静态态（空态 / 加载 / 错误）

| # | 位置 | 现状 | 为何是缺口 | 修复方向 | 风险 | 机器判据 |
|---|---|---|---|---|---|---|
| A1 | `components/QueueSheet.ets:81`（旧） | 队列被「清空」清成 0 条后面板**仍开着** ⇒ 只剩标题「待发队列 (0)」+ 300 高空白 `List` | §10「空态 = 一行小字」家族里**唯一**没有空态分支的弹层；用户点「清空」后读不出"清干净了/本就空" | 补空态分支（`type.callout`+`textMuted`，同 `SearchHitsSheet`/`AskUserSheet`/`StatusSheet`） | 低 | ✅ **已实现 + 钉住**（`polish_states_press.test.ts` A） |
| A2 | `SettingsAbout.ets:283` vs `SettingsChannels.ets:1006`/`SettingsLlm.ets:1050`/`SettingsPlugins.ets:757`/`SettingsStorage.ets:285`/`SettingsTools.ets:146`/`SettingsWebUsers.ets:186` | 同一句「加载中…」：About 走 `secondaryText()`（**light = textSecondary**），其余 6 处走 `pal().textMuted` | 三主题下次级层级不一致（同一加载行） | 收一个原子（单一色 role） | **中**（色 role 属**对比度域**，已由别线收口 ⇒ ⛔ 本线不碰） | 可（形态+色 role 计数）；但**域外**，登记 |
| A3 | `SettingsDeveloper.ets:331-334` | 「导出失败：…」内联 `Text(dangerText, FS_CAPTION)` | 全仓错误态口径 = `SettingsErrorBar`；此处不同族 | 视语义决定（动作级瞬时错误，可保留） | 低 | 可（形态）；价值低，登记 |
| A4 | `pages/Index.ets:6896-6900`（模型列表面板） | `llmCfg === undefined` ⇒ **恒**显示 spinner +「正在读取模型列表…」；**无错误分支** ⇒ 拉失败永久转圈 | "加载中"与"加载失败"不可分（§10 三态缺失） | 加错误分支（需服务端给失败信号） | **禁改域**（Index.ets 归 perf4） | 只登记 |
| A5 | 空态文案标点不统一 | 弹层空态无句号（`AskUserSheet:137`/`StatusSheet:155`/`SearchHitsSheet:229`）；设置分区空态带句号（`SettingsChannels:1009` 等） | 同一"空"两套标点 | 各自成体系（弹层/分区），可不改 | 低 | 可；价值低，登记 |

### B. 按压 / 焦点反馈（死可点区）

| # | 位置 | 现状 | 为何是缺口 | 修复方向 | 风险 | 机器判据 |
|---|---|---|---|---|---|---|
| B1 | `AskUserSheet.ets:127`（旧） | 关闭 X 的 `pressed` 值 = `DISABLED_OPACITY`(0.4) | 0.4 是**禁用态**语义；其它 4 个弹层的 X 都是 `PRESS_OPACITY`(0.6) ⇒ 同一"关闭 X"两档 | 改 `PRESS_OPACITY` | 低 | ✅ **已实现 + 钉住**（判据 C1） |
| B2 | `SplashOverlay.ets:179`（旧） | 「轻点跳过」`pressed` 写字面量 `0.6` | 与 token 同值的裸魔数（漂移风险） | 改 `PRESS_OPACITY`（零视觉） | 低 | ✅ **已实现 + 钉住**（判据 C2） |
| B3 | `QueueSheet.ets:58`（旧） | 「清空」命中区只靠 `padding` 撑（≈28~32 < 44） | 低于 Apple HIG；`hit_target_gate` 只抓**显式** height，抓不到 padding 撑高 ⇒ 规则洞 | `constraintSize({minHeight: HIT_TARGET_MIN})`（**零布局变化**） | 低 | ✅ **已实现 + 钉住**（判据 B） |
| B4 | 全仓 `Text(...).padding(...)` 撑高的可点 pill（≈40+ 处，见 `SettingsRows`/`Settings*`/`GoalBanner`/`ThinkingLine`/`ToolPopover`） | 多处靠 padding 撑高，未显式 ≥44 | 同上规则洞（面广） | 逐处判语义（有的行高已够） | **中**（面广 + 观感） | 只登记（下轮系统性做） |
| B5 | `TodoPanel.ets:134/204/371`、`MessageNav` 条目等 | 内层可点元素无自身 `stateStyles`，靠**祖先** Row 的 press | ⛔ 本仓既有判据（`interactive_feedback`）**认祖先 press** ⇒ 不算缺口 | — | — | 已覆盖，无需动 |
| B6 | `components/**` 的 `Interrupt` 等**旁路 toast**（`MarkdownView:442`/`SettingsAbout:238,246` 走系统 `promptAction.showToast`；`Index.ets` 走自绘 `Toast`） | 同一动作（复制）在**不同落点**给不同反馈（系统 toast vs 品牌 toast） | 与 `Toast.ets` 头注"取代系统 toast"的目标分叉；系统 toast 不跟设计系统 | 需把 `onToast` 逐层接到页面（**Index.ets 禁改**）⇒ 本线做不完 | 中 | 只登记（需 Index 接线） |

### C. 层级与节奏（间距/圆角/发丝线/字重/图标）

| # | 位置 | 现状 | 为何是缺口 | 修复方向 | 风险 | 机器判据 |
|---|---|---|---|---|---|---|
| C1 | `QueueSheet.ets:56` / `SelfCheckSheet.ets:37` vs `PluginsSheet.ets:107` / `AskUserSheet.ets:110` / `StatusSheet.ets:129` | 弹层标题：两个走 `FS_TITLE`(16)，三个走 `type.headline`(17)；且 `lh/tk` 有的写有的不写 | 同一弹层族标题字阶/修饰不统一 | 统一到 `type.headline` role | **中**（视觉 16→17，需真机看） | 可（形态），但**观感项 ⇒ 留真机线** |
| C2 | `SyntheticCard.ets:171`(13) / `QueueSheet.ets:122`(15) / `SettingsDeveloper.ets:410`(8) / `PluginHost.ets:292`(18),:391(16) | 图标 `fontSize` 用字面量（不走 `ICON_*` / `MARKER_GLYPH`） | 图标尺寸档不齐 | 逐处判语义后收编 | **中**（改视觉） | 可；⛔ 观感项 ⇒ 留真机线 |
| C3 | `PluginsSheet.ets:214`(h320) / `QueueSheet.ets:150`(h300) / `MenuSheets.ets:64`(420) / `AskUserSheet.ets:63`(420) / `MessageNav.ets:51`(420) | 面板/列表最大高hand-rolled：300/320/420 | 同族弹层高度无统一档 | 需**新 token**（`core/design.ets` ⛔ 禁改域） | **中** | 只登记（需 design.ets 增 token） |
| C4 | `SettingsAbout/Account/Developer/Llm` 用 `pal().border`/`pal().surfaceAlt` 直取 | 与新区组件（`hairlineOf`/`surfaceFillOf`）不同族 | 面/边语义 token 未全量收口 | 归 **surface_alias 域**（别线） | — | ⛔ 域外，不碰 |

### D. 过渡（出现过渡 + fail-safe 静息态）

| # | 位置 | 现状 | 结论 |
|---|---|---|---|
| D1 | 全仓组件的 `.transition()`/`.transition(sheetTransition())` | 门禁 ⑨（`anim-opacity-gate.sh`）已硬红 A 级 `x?1:0` 形态、警告 B 级 | ✅ 已收口；本波**未新增任何动效**（motion_budget 台账不变） |

### E. 深浅双主题 + porcelain（次级差异）

| # | 位置 | 现状 | 结论 |
|---|---|---|---|
| E1 | 角色层对比度 | `theme_contrast` / `role_surface_matrix` / `porcelain_*` 全量收口 | ✅ 已由对比度线收口；本线**只登记 A2/C4**（域外） |

### 本波「已实现」三项（`40c670c`）

1. **A1** `QueueSheet` 空态（补 §10 口径一行小字）；
2. **B3** `QueueSheet` 「清空」命中区 ≥44（**零布局变化**：同级常有 44 关闭盒）；
3. **B1+B2** 按压值一致性（`AskUserSheet` X `DISABLED_OPACITY`→`PRESS_OPACITY`；`SplashOverlay` 字面量 `0.6`→`PRESS_OPACITY`）。

判据：`tools/tests/polish_states_press.test.ts`（13 passed；形态断言 + 剥注释 + **零扫描判红** + **5 条 mutation 自证**）。
⛔ 本波**无观感项**（3 处均零视觉或纯补缺）。

### ⚠️ 只能真机验证（本波**未**装机，别当"已验好看"）

- 队列**空态**出现时机与观感（点「清空」后的一行小字）；「清空」按压/命中手感；
- 关闭 X 的按压深度（0.4→0.6，弹层间一致性）；
- **A3/A4/B6/C1/C2/C3/C4** 全部**未做**（原因见各行"修复方向/风险/域"）——其中 C1/C2 属**观感项**、A2/C4 属**对比度/surface_alias 域**、A4/B6 需改 `pages/Index.ets`（禁改域）。

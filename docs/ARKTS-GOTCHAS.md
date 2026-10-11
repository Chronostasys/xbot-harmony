# ArkTS / ArkUI 真机踩坑集（2026-10-09 集中整理）

> 这些坑**编译期不报错、只在真机/运行时暴露**，且大多表现为"渲染错乱 / 没反应 / 崩溃"。
> 每条都附**现象 → 根因 → 正确写法**，以及当时的定位手段。

---

## 1. `struct` 上不能有 `static` 方法 ⛔

- **现象**：真机点登录 → 报 `undefined is not callable`。
- **根因**：ArkUI 的 `struct` 不是普通类，其**静态成员在真机上解析为 `undefined`**。
- **正确写法**：把这类函数写成**模块级函数**（或普通 `class` 的 static）。
- **定位手段**：错误文案 + 触发时机（登录成功后进入 `syncFrom()`）。

## 2. `HttpResponse.header` 的同名头是 **字符串数组** ⛔

- **现象**：`/api/auth/config` 正常，一登录就 `undefined is not callable`。
- **根因**：服务端下发 `Set-Cookie` 时，`resp.header['set-cookie']` 是 **`string[]`**，
  而代码按 `string` 声明后直接 `.split(...)` ⇒ 调用了数组上不存在的方法。
- **正确写法**：归一化——`typeof v === 'string'` / `Array.isArray(v)`（数组则 join）。
- **定位手段**：比对"唯一差别"（登录=有 cookie，config=无 cookie）→ 缩小到 Set-Cookie 解析；
  再写本地 Node 集成测试（**mock 里刻意把 set-cookie 暴露成数组**）复现 + 变异自证。

## 3. `ForEach` 的 key：**必须唯一、且必须随内容变化** ⛔（"渲染错乱"的头号原因）

- **现象 A（key 重复）**：整块内容错位、串行。
  ArkUI 按 key 复用组件，key 重复 ⇒ 复用错位（与 Web 端 React 重复 key 的 #185 同源）。
  典型来源：id 由不同命名空间拼接（`a-<消息id>` vs `a-<turnID>`）、`Date.now()`、下标。
- **现象 B（key 不随内容变）**：改了数据界面不更新，或显示"半新半旧"。
  因为**按 key 复用 ⇒ key 不变就不重建该项**。原地改对象字段（`row.x = ...`）后只换数组引用，
  ArkUI 判定该项无需重建。
- **正确写法**：
  - id 用**全局单调计数器**（唯一性由构造保证）；
  - 行模型带 `rev`（渲染版本），内容一变即自增，**key = `${id}#${rev}`**；
  - Markdown 块等由内容派生的 key（**内容相同 ⇒ key 相同；内容变化 ⇒ key 变化**），**禁用纯下标**。
- **定位手段**：`codelinter` 的 `@performance/foreach-args-check`（缺 keyGenerator 会告警）；
  以及对 id/key 写**性质测试**（唯一性、跨解析稳定性、追加内容不漂移）。

## 4. `@Builder` 的三条硬约束

| 约束 | 现象 | 正确写法 |
|---|---|---|
| **不能有局部变量声明** | 编译报错 | 直接用表达式/属性，或把计算搬到 TS 侧预计算 |
| **不能接函数/回调参数** | 编译报错 | 用 `@BuilderParam` + `@Component`（或内联展开） |
| 多参数**按值**传递（不支持 `$$` 引用式） | 数据不刷新 | 需要联动时用成员对象 + 状态驱动 |

## 5. `Text` 里不要做条件渲染

- **现象**：内联样式渲染错乱。
- **根因**：ArkUI 的 `Text` 只接受 `Span`/`ImageSpan` 类子组件，`Text(){ForEach(){ if/else }}`
  的条件渲染不保证支持。
- **正确写法**：**在 TS 侧把样式全部预计算**（text/size/color/粗斜体/删除线/mono/bg），
  构件里只做一维 `ForEach` + 纯属性赋值（零分支）。

## 6. 沉浸式布局必须配套安全区避让

- **现象**：顶部内容被状态栏/挖孔压住，看起来"整体错位"。
- **根因**：`setWindowLayoutFullScreen(true)` 让内容铺到状态栏下，而应用侧没读
  `window.getWindowAvoidArea(...)` 加内边距。
- **正确写法**：未做避让前用 `setWindowLayoutFullScreen(false)`，交给系统做内边距。

## 7. 官方静态检查器能抓一部分"只在真机暴露"的问题

```bash
CMDLINE_TOOLS=<command-line-tools 路径>
bash "$CMDLINE_TOOLS/codelinter/bin/codelinter" entry/src/main/ets -f json -o lint.json
```
它给出**带行号的 ArkUI 专项规则**（示例：`foreach-args-check` 缺 keyGenerator、
`start-window-icon-check` 启动图标超 256×256、`hp-arkui-use-local-var-to-replace-state-var`）。
本仓库现状：正确性相关告警 **0**，仅剩 12 条"异步事件里写 @State"的性能提示（正常写法）。

---

## 附：本地验证能力边界（别再重复踩）

| 手段 | 能做什么 | 不能做什么 |
|---|---|---|
| `hvigorw assembleHap` | 真编译：类型/ARKTS 语法/打包 | 不验证渲染与运行时 |
| `tools/typecheck`（tsc + kit stub） | 秒级查 `core/` 纯 TS 部分的类型错误 | 不覆盖 ArkUI 构件 |
| `tools/tests`（node 跑，mock `@kit.NetworkKit`） | 真跑 HTTP/解析等纯逻辑（含变异自证） | 不渲染 UI |
| `codelinter` | ArkUI 规则/性能静态检查 | 不验证视觉 |
| Linux 预览器 | 冒烟：参数/模块/资源是否加载（需自建 shim） | **Stage ability 在 Linux 未实现**（源码 `RunDebugAbility` 直接返回 `Linux is not supported`）；无头容器里 `AttachSurface not ready` ⇒ 帧恒空白 |
| **真机 + hdc** | **逐页截图、模拟点击、日志与崩溃栈**（`tools/device/shots.sh`） | 需要设备连着 |

## 8. 承载文字的容器**不要写固定高度**（系统字体缩放会把版面撑坏）⛔

- **现象**：手机上"整个渲染错乱" —— 文字被裁切、行之间互相挤压、按钮文字溢出。
- **根因**：ArkUI 的 `fontSize(15)` 数字默认单位是 **fp**，**随系统字体缩放**；而容器若写死
  `height(44)`/`height(56)`，用户把系统字体调大（1.3×/1.5×）后**文字尺寸变了、容器没变**
  ⇒ 裁切/重叠。
- **正确写法**：文字容器用 `constraintSize({ minHeight: N })`（随内容增长）而不是 `height(N)`；
  需要固定尺寸的只留给图标槽/色条等非文字元素。
- **本仓库落地**：登录页输入与按钮、顶栏、输入区、设置/抽屉/AskUser 的输入与按钮共 **21 处**
  已由 `height(N)` 改为 `constraintSize({ minHeight: N })`。

## 11. 渲染路径里做解析 + 行级 ForEach key 含 `rev` ⇒ 每个事件整行重建并全量重解析

**现象**：长会话（单 turn 上百个迭代、单行正文几百 KB）里界面卡到没法用、滚动乱跳。

**机制**：ArkUI 的 `ForEach` **不比较内容**——key 不变就完全不重建。所以为了让内容刷新，
行级 key 里带了 `row.rev`（数据一变就换 key）。但这样一来，**每次数据变更都会重建整行**，
而 `MarkdownView` 又是在 `build()` 里直接调 `parseMarkdown(text)` 的 ⇒ 该行所有迭代块的
Markdown 全部重新解析。实测单行 274 KB ⇒ 每个 SSE 事件解析几百 KB。

**修法**：把解析结果**按原文本身**缓存（`core/markdown.ets` 的 `parseMarkdownCached` /
`parseInlineCached`；键 = 原文 ⇒ 无碰撞、无陈旧；总字符数封顶 + 插入顺序淘汰）。
渲染路径一律走缓存版本。App 内自检页会显示命中率，便于在真机上确认。

**通用教训**：ArkUI 里"每次数据变化重建组件"是常态（没有 diff），所以**渲染路径里不能有
与数据规模成正比的重复计算**（解析、排序、过滤、正则）。这类计算要么进缓存，要么前移到
数据进入 store 的时候算一次。

## 12. 父容器"高度由内容决定"时，子元素不要用 `height('100%')`（百分比高度没有参照）

**现象**：Markdown 引用块的左侧竖条消失/塌成 0 高（引用块失去唯一视觉标识）。
其他同类现象：分隔线、`100%` 高的占位条在内容定高的容器里变成不可见。

**机制**：`height('100%')` 的参照是**父容器的高度**。当父容器（如 `Row()`，高度由子内容撑开）
本身没有确定高度时，百分比就落进"循环测量"（子要父高、父要子高），ArkUI 会退化成 0 或不稳定值。

**修法**：用**边框**表达"左侧竖条"——边框宽度是固定值，由容器自身高度自然拉伸，不存在百分比依赖：

```ts
Column() { this.Inline(b.text) }
  .width('100%')
  .padding({ left: 11, right: 8, top: 8, bottom: 8 })
  .backgroundColor('#0F172A')
  .borderRadius(6)
  .border({ width: { left: 3, top: 0, right: 0, bottom: 0 }, color: '#6B7280' })
```

**判定口径**：只有**页面根 / 定高容器**（如 `Column().height('100%')` 挂在页面根、被 `layoutWeight`
分配的容器）里用 `height('100%')` 才是安全的。写之前先问："这个父容器的高度是确定的吗？"

> **同族实例（2026-10-11 用户亲报「设置里很多窗口超过高度范围且滚动不下去」）**：设置分区面板
> （`components/Settings*.ets`）是 `SettingsPanel` 根 `Column` 里 **Header / TabBar 的兄弟**，
> 却把根容器写成 `height('100%')` ⇒ 拿到的是**父容器全高**（不是"剩余高度"）⇒ 面板被下推、
> 底部溢出屏幕 ⇒ 面板内 `Scroll` 视口底边落在屏外，最底一屏（≈ Header+TabBar 高）**永远看不到**。
> **正解 = 吃剩余高度 `layoutWeight(1)`**（对齐 web `flex-1 min-h-0`，以及 `Index.ets` 用
> `Column().layoutWeight(1)` 包裹 `PluginHost` 的同款做法）。机器判据 = `tools/tests/vertical_scroll_height.test.ts`。
> ⚠️ 姊妹形态：**裸 `Column` + `constraintSize({ maxHeight })` 只能"裁切"、不会滚** ——
> 要可滚必须用 `Scroll`/`List` 承载（实例：`TodoPanel` 的待办清单，对齐 web `max-h-[240px] overflow-y-auto`）。

## 13. 自动"跟随到底部"必须由「用户是否在底部」门控

**现象**：流式输出时用户往上滚想读工具/思考详情，界面**立刻把他拽回底部** —— 感知为"根本没法用"。

**机制**：`syncFrom()` 在**每次 store 变更**时被调用（流式期间 = 每个 SSE 事件一次），而它里面
**无条件**执行 `listScroller.scrollEdge(Edge.Bottom)` ⇒ 任何滚动位置都被反复重置。

**修法**：`@State followBottom` —— 它是**用户意图标志**（= web `!userScrolledUp`），**不是位置快照**。
判据本体是**纯函数** `core/listfollow.nextFollowBottom(prev, userDriven, endIndex, itemCount)`
（脱机单测 `tools/tests/listfollow.test.ts`）；`pages/Index.ets` 只做 ArkUI 胶水：

```ts
.onWillScroll((o, st, src) => { this.userScrollFrame = isUserScrollSource(src); })   // 只记"是不是用户干的"
.onScrollIndex((start, end) => { this.followBottom = nextFollowBottom(this.followBottom, userDriven, end, n); })
```
跟随开关只在 `followBottom === true` 时触发 `scrollEdge(Edge.Bottom)`；**切会话 / 点「回到最新」强制置 true**
（用户预期"看到最新"）；`navToRow`（用户点导航）置 false。

⛔ **只有用户输入能翻转它**：程序滚动（`ScrollSource.SCROLLER` / `SCROLLER_ANIMATION`，即 `Scroller`
成员方法 `scrollEdge`/`scrollToIndex`）与**内容增删引起的钳位/索引回调**一律不置位。

> **2026-10-11 真机 P0（用户报「有时候点击工具 pill 自动把视角跳到最下方」）的根因就是本条的旧写法**：
> 旧版把 `atBottom` 当**位置快照**、由 `onScrollIndex` **无条件双向赋值** ⇒ 内容增删（live 行在飞⇄折叠、
> busy 占位符进出、行窗口放开）引起重排/钳位时会把 `atBottom` **误置 true 并粘住**，之后任意一次
> store 变更（流式事件，或**点工具 pill** 触发的 `fetchIterationDetail`）就 `scrollEdge(Bottom)`。
> **别再让"最后可见项 == 末项"这种会被非用户动作改写的判据去写"是否跟随"** —— 位置可以算，
> 意图只能由用户输入改（web 同源：`userScrolledUp` 只由用户输入翻转）。

**两个必须注意的点**：

1. `onScrollIndex` 给的是**列表项**下标，而列表项数 **≠ rows.length** ⇒ 必须用显式 `listItemCount()` 计算末项下标，
   且**头项判据必须与渲染它的那个 `if` 同源**：渲染头项的条件是
   `hasMore || loadingMore || hiddenRowCount(...) > 0`（**三者缺一不可**；`pages/Index.ets` 统一走 `hasHeadItem()`）。
   漏掉 `hiddenRowCount` 一项 ⇒"全量历史已加载但行窗口被截断"（长会话常态）时项数**少算 1** ⇒
   `end >= n-1` 提前一项成立 ⇒ 用户还差一项才到底却被判成贴底（同一 P0 的第二个成因）。
2. 该 helper 必须是**纯函数 / 模块级函数**（ArkUI 的 struct 不是普通类，静态成员在真机上是 `undefined`；
   `core/*.ets` 里不许引用 ArkUI 全局类型，故 `ScrollSource` → boolean 的映射留在页面侧）。

**同源铁律（与 xbot Web 端一致）**：所有"滚到底部"调用都必须由"用户没往上滚"守卫，
否则就是抢用户的滚动位置。

## 14. 键盘避让模式必须显式设成 `RESIZE`（默认 `OFFSET` 会让整页随键盘上推）

**现象**：手机端输入时底部输入框仍可能被键盘盖住、整页内容随键盘抖动；聊天场景里
"边打字边看进度"体感就是"没法用"。

**机制**：ArkUI 的 `UIContext` 键盘避让默认是 **`KeyboardAvoidMode.OFFSET`**（键盘弹出时把**整页上移**）。
对于**底部固定输入框 + 长列表**的聊天界面，正确策略是 **`RESIZE`**（缩小布局视口 ⇒ 列表自然变矮、
输入框始终可见、内容不位移）。

**修法**（`EntryAbility.onWindowStageCreate`，内容加载后）：

```ts
const uiCtx: UIContext = windowStage.getMainWindowSync().getUIContext();
uiCtx.setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);   // 导入自 '@kit.ArkUI'
```

**与 Web 端一致**：Web 端已定的策略是 `interactive-widget=resizes-content`（键盘缩布局视口）+
`useKeyboardInset` 补偿老 WebView/iOS —— 原生侧与之同语义，避免两端体验分裂。

**取证方式**：真机取证文本里的 `composer` 几何（输入框 y/h）在键盘弹出前后可直接对比：
`RESIZE` 下输入框 y 不变、`list` 的 h 变小；`OFFSET` 下整页 y 偏移。

## 15. ArkUI 的 `Text` 默认**不在词内折行** ⇒ 不可断的超长 token 会横向撑破容器

**现象**：聊天正文里的长 URL / 长代码 / base64 / 长标识符把整行甚至整块撑坏（表现为"渲染错乱"）。
登录页（短文本）正常、聊天页（长文本）异常 —— 这个"证据模式"就指向本条。

**机制**：ArkUI `Text` 默认是 `WordBreak.NORMAL`（只在**词边界**折行），遇到超长**不可断** token
直接溢出容器宽度。

**修法**：`Text(...).wordBreak(WordBreak.BREAK_ALL)`

- 枚举：`ets/component/enums.d.ts` 的 `WordBreak { NORMAL=0, BREAK_ALL=1, BREAK_WORD=2 }`
- 属性：`ets/component/text.d.ts` 的 `wordBreak(value: WordBreak)`（API 11+）
- 代码块只在**允许换行**时启用：`this.wrapCode ? WordBreak.BREAK_ALL : WordBreak.NORMAL`，
  不改变代码块的既有语义（关掉换行时不强制断词）

**适用位置（本工程已全部覆盖）**：段落 / 标题 / 引用 / 列表项、表格表头与单元格、用户气泡正文、思考正文。
自检页 **G 格（长 URL）** 就是专门验这一条的。

**同源铁律（与 xbot Web 端一致）**：`break-words`（`overflow-wrap: break-word`）**不够**，
必须 `wrap-anywhere`（`overflow-wrap: anywhere`）—— 两端都是"不可断 token 撑破容器"这同一个根因。

## 16. 表格【列数决定形态】—— ≥5 列必须堆叠，等宽网格会把中文压成竖条

**现象**：聊天页里的宽表格完全不可读 —— 每列被压成 ~40dp 的**竖条**，正是"渲染整个都是错乱的、
完全用不了"的一大成因。

**实测（真实会话，5,242,820 字符 / 60 个会话）**：表格列数分布
`{2列:544, 3列:490, 5列:267, 4列:218, 8列:6, 7列:5}` ⇒ **≥5 列的表格出现 44 次**（不是罕见形态）。
真实样例：`| # | tenant | 渠道 | 会话名（chat_id） | 显示名 / label | 主库里有多少 | 会话库 | … |`。

**机制**：`TableBlock` 给每列 `layoutWeight(1)`（**等宽**）⇒ 列宽 = 可用宽度 / 列数；
8 列时每列 ≈40dp，中文必然成一字一行。

**修法**（只用**真机已验证可渲染**的构件 Column/Row/Text）：

- `TABLE_GRID_MAX_COLS = 4`，`useTableGrid(cols)` 判定形态；
- ≤4 列：等宽网格（手机上每列仍可读）；
- ≥5 列：**堆叠形态** —— 每行渲染为若干条 `字段: 值`，字段名取自表头（缺失时回落 `列N`），
  值用 `wordBreak(BREAK_ALL)`；
- 判定与字段配对做成**纯函数**（`core/markdown.ets` 的 `useTableGrid`/`tableRowFields`），
  由 `tools/tests/table_layout.test.ts`（18 条）守护 —— 渲染用 ArkUI 无法脱机测，
  但**决策逻辑**必须能测。

**取舍留档**：没用"横向滚动"（Web 端的做法），因为滚动容器需要确定的宽/高约束，
在内容定高的列里可能塌成 0 —— 在没有真机画面确认前不引入这类结构性不确定性。

## 17. 进度事件必须分**两条路**处理：`stream_content`（流式）与 `progress_structured`（结构化）

**服务端契约**（`channel/web/web_hub.go` 的 `normalizeSSEEvent` + `isStreamOnlyProgress`；`protocol/ws.go`）：

- 只带流式字段的消息被**改型为 `stream_content`**，且此时 **`iteration == 0`、`content == ""`、工具全空**；
- 流式字段名：`stream_content`（**检查点**，非空即整体替换）· `stream_delta`（**增量**，追加）·
  `reasoning_stream_content` · `reasoning_stream_delta` · `streaming_tools`；
- 结构化字段：`iteration` · `content` · `reasoning` · `active_tools` · `completed_tools` · `iteration_history`。

**错误做法**（本工程真实踩过）：把两类当同一种，"整体替换"迭代对象并按 `iteration ?? 0` 写入 ⇒ 真机上：

1. 流式文本**永远读不到**（字段名不对：读 `content` 而服务端发 `stream_content`）；
2. **每个流式帧都清空该迭代的 `tools`/`reasoning`** ⇒ 工具 pill 一闪就没；
3. 冒出**幽灵「迭代 0」**块。

⇒ 用户看到的就是"**渲染整个都是错乱的、完全用不了**"（且 `loadHistory` 后一切正常 ⇒ 极易误判成布局问题）。

**正确做法**（`core/streammerge.ets`，纯函数 + `tools/tests/streammerge.test.ts` 36 条）：

- 流式帧 → 归到**在飞迭代**（号最大者；没有则建 1，**绝不写 0**）；增量追加、检查点替换；
  工具**只增不减**（不带工具时绝不清空）；
- 结构化帧 → 按号 upsert，**只更新"事件里确实带了"的字段**；权威 `content`/`reasoning` 到达时清掉流式缓冲；
- 渲染统一走 `displayContent(it)` / `displayReasoning(it)`（流式缓冲优先，收尾落权威正文）。

## 18. ArkTS 禁止结构化类型：接口参数要求**显式 implements**

`arkts-no-structural-typing`：字段形状相同**不算**类型兼容。把 `ChatRow` 传给
`f(row: { iterations: HistoryIteration[] })` 这类参数会直接编译失败（且**匿名对象类型本身也不允许**）。
修法：具名接口（本工程 `IterList` 放 `types.ets`）+ 传参方**显式** `class ChatRow implements IterList`。

## 19. `session` 事件的状态字段是 **`action`**（不是 `state`）

服务端 `protocol/events.go`：`SessionEvent.Action` = `json:"action"`，实测取值含
`idle` / `busy` / `history_rewound` / `subagent_started|stopped` / `user_msg` / `agent_msg` / `progress`。

**踩坑**：客户端曾读 `ev.state` ⇒ 恒为 `undefined` ⇒ **整条会话状态更新是死代码**
（`idle`/`busy` 永不生效，收尾后界面可能一直停在"运行中/停止"；`history_rewound` 也不重载历史，
界面停在已被撤销的内容上）。

**契约**：判定抽成纯函数（`core/streammerge.ets` 的 `isIdleAction` / `isBusyAction` /
`shouldReloadHistory`），由 `tools/tests/streammerge.test.ts` 守护；`history_rewound` ⇒ **必须重载历史**。

**同类教训**（两次都是同一坑）：**客户端字段名必须逐字对照服务端 Go 结构体的 json tag**，
不能凭印象写（另一次：进度事件读 `content` 而服务端发 `stream_content`，见第 17 条）。

## 20. 会话可能属于**非 web 渠道**：`channel` 必须按会话传，绝不能硬编码

**现象**（真机截图实证）：点开某个会话得到
`HTTP 404 {"code":"not_found","message":"session not found"}`，界面显示"加载会话失败/切换失败"。

**机制**：`/api/session-tree` 返回**所有渠道**的会话（含飞书 `oc_*` / `ou_*`），而
`/api/history`、`/api/regions`、`/api/queue/*`、`/api/message`、`/api/cancel`、SSE 都要求
`channel` 与**该会话实际所属渠道**一致。客户端曾把 `this.channel` 恒设为 `'web'`
⇒ 任何非 web 会话都 404。

**修法**：`openSession(chatId)` 里先按会话列表解析渠道
（`core/sessionpick.ets` 的 `channelForChat(sessions, chatId)`；找不到回落 `web`），
再发后续请求；抽屉里用 `channelLabel()` 标注来源（回答"这个会话为什么不一样"）。
守护：`tools/tests/sessionpick.test.ts`（飞书会话必须解析成 `feishu` —— 旧实现该组全红）。

## 21. `List` + `ForEach` 会**一次性构建全部行** ⇒ 必须做行窗口 + 帧合并

**现象**：真机"渲染很卡、交互也很差"。

**机制**：`List` 里的 `ForEach` 不是虚拟化（ArkUI 的虚拟化容器是 `LazyForEach`），
会把所有行都建出来；而本应用**单行最多 16 个迭代块 × 每块 Markdown** ⇒ 30 行 ≈ 几千个节点。
再叠加"每个 SSE 事件都同步一次 UI"，UI 线程被打满。

**修法**（两层，均不引入新的容器类型，故零布局风险）：

1. **行窗口**：只渲染末尾 `rowLimit` 行（默认 `MAX_ROWS_VISIBLE`），
   更早的用「↑ 显示更早的 N 条」按批放开（`visibleRows` / `hiddenRowCount` 纯函数）；
   切会话时重置，避免窗口无限增长。
2. **帧合并**：store→UI 同步走 `scheduleSync()`，**每帧至多一次**（16ms 合并）。
   与 xbot Web 端已定稿的结论同款：所有"每帧一次"的更新必须走同一个调度器。

（若日后仍不够：把 `List` 换成 `LazyForEach` + `IDataSource` —— 但需把"加载更早/busy 指示器"
两个非消息项移出 `List`（LazyForEach 与普通子项混用有约束），属结构性改动，需真机确认后再做。）

## 22. 诊断结论必须能区分「未布局」与「不存在」

`componentUtils.getRectangleById(id)` 对**不存在**的组件往往返回 **0 尺寸**而不是抛错
⇒ 只打印 `w=0 h=0` 会让"组件真的塌了"与"当前不在那一页"无法区分（真实事故：一份几何文本
`xbot-root y=-96` + 全部子项 0×0，事后才知道那次走查是在**未登录**状态跑的，聊天页组件压根不存在）。

**修法**：0 尺寸显式标注 `⚠未布局(0尺寸,或被弹层遮挡/当前不在该页)`；给登录页也加 id
（`xbot-login`），使"当前在哪一页"可判。

## 2026-10-10：HarmonyOS 客户端（xbot-harmony）实测新增限制

以下每条都在本仓真实构建/测试里踩到过（不是理论推断），附**报错原文**与**正解**。

### 1. 禁止空对象字面量（`arkts-no-untyped-obj-literals`）

```
Object literal must correspond to some explicitly declared class or interface
```
`const row: SomeInterface = {};` **不合法**（哪怕有类型标注）。正解：
- 需要就地构造 ⇒ 把类型改成 **class** 再 `new SomeClass()`；
- 只是从 JSON 解析 ⇒ `JSON.parse(raw) as SomeInterface` 合法（`as` 转型没问题）；
- **嵌套空字面量**同样违规：`{ method: 'x', params: {} }` ✗ ⇒ 干脆不发 `params`
  （服务端对空 params 会补 `{}`）。

### 2. `@Builder` 里的裸标识符会被当成类成员

```
Property 'currentModelText' does not exist on type 'Index'
```
在 `@Builder` 里直接调用 **imported 自由函数**（`currentModelText(...)`）会被 ArkTS 转译成
`this.currentModelText(...)` ⇒ 报"类上没有这个属性"。正解：加一层类内包装方法
（`private currentModelName(): string { return currentModelText(...); }`），`@Builder` 里只写
`this.currentModelName()`。

### 3. `Object.assign` 属受限标准库（`arkts-limited-stdlib`）

```
Usage of standard library is restricted (arkts-limited-stdlib)
```
不能用 `Object.assign({}, obj)` 做浅拷贝 ⇒ 手写 for 循环拷键值。

### 4. `String.prototype.endsWith` 同样受限

`code.endsWith('reply')` 在 ArkTS 里也要报 `arkts-limited-stdlib` ⇒ 用
`code.substring(code.length - 5) === 'reply'`。

### 5. 页面里新增 state / builder 前必须先查重名

`Duplicate identifier 'showSettings'` / `Duplicate function implementation`：
页面**已有** `showSettings` 与 `SettingsSheet()`（旧设置弹层）⇒ 新面板必须换名
（本次用 `showPrefs` / `PrefsSheet` / `openPrefs`）。**先 grep 再命名**，否则一次重命名要连带改 5 处。

### 6. `core/` 里不能引用 ArkUI 全局类型

`tools/tests/run.sh` 会把 `core/*.ets` **当纯 TS 在 Node 里编译**（无 ArkUI 全局）⇒
`IDataSource` / `DataChangeListener` 这类只在 ArkUI 里存在的类型放 `core/` 会直接编译失败
（`Cannot find name 'IDataSource'`）。正解：**可测纯逻辑放 `core/`，ArkUI 壳子放页面文件**；
且 `run.sh` 每轮先清 `.out`（否则源码删了、过期产物还在报错，会以假错误误导排查）。
### 7. 往属性链尾部机械插入属性时，必须先确认"最后一行是完整的调用"

真实事故（本次）：用脚本给 7 个 `@Builder` 的根容器统一插入 `.transition(...)` 时，
按"最后一个 `\n    .` 行"定位并插到其后 —— 当那个属性行恰好是整段的**最后一行**时，
`find('\n', idx+1)` 返回 -1，切片退化成 `body[:-1] + insert + body[-1:]`，
把 `.alignItems(HorizontalAlign.Start)` / `.border({...})` **从中间截断**（连闭合括号一起写坏），
报错却是 `Property 'transition' does not exist on type 'HorizontalAlign'`（指向参数类型，极易误判）。

规则：**机械插入后必须做括号平衡复核**（本仓 `tools/lint/render-path.sh` 之外，
我在补丁脚本里加了 `ln.count('(') != ln.count(')')` 的检查），并且插入点要挑"后面一定有换行"的行。
同类教训：`s.replace(anchor, ...)` 前一定要 `assert anchor in s`（本轮有两次因为漏断言而静默不生效）。
## 2026-10-10 第二批：性能 / 组件复用 / 测试门禁（都来自真机与官方规范）

依据 `harmony-next` skill（`~/.xbot/skills/harmony-next`）的《应用体验与性能规范》
与 `guides/@Reusable装饰器：V1组件复用.md`；对照真实项目 ClashBox（`ProxyNodeItem.ets` 的
`@Reusable` + `aboutToReuse`、`common/datasources/BaseDataSource.ets`）。

### 1. 高频状态必须下沉到子组件，绝不能放页面级 @State
真机现象：**"卡得要死、系统 spinner 半秒才动一次"**。根因：打字机是 20Hz 状态，
放在页面级 `@State` ⇒ **每一拍都重跑整页 build**（列表、合成器、连系统 spinner 一起被拖慢）。
正解：收进 `components/LiveTailView.ets` 这样的子组件 —— 高频刷新只重建那一棵子树。

### 2. 每帧的数组/对象赋值在 ArkUI 里**一定**触发重渲染
`this.rows = store.rows.slice()`、`this.sessions = …` 这类赋值即使内容没变也会刷新
⇒ 每个 SSE 帧都整页重刷。正解：**内容指纹门控**（`长度 | 每行 id#rev`；sessions 为
`chat_id#running#label`）——指纹包含每行 rev ⇒ 任何变化都会改变指纹，**不可能漏更新**；
"变化时才替换"的数组（cronTasks/bgTasks/runners/subagents）直接比**引用**。

### 3. `@Prop` 对**对象**是深拷贝 ⇒ 行数据必须 `@ObjectLink` + `@Observed class`
行对象含上百迭代，用 `@Prop` 传会持续深拷贝。正解：`types.ets` 里
`@Observed export class ChatRow` + 行组件 `@ObjectLink row: ChatRow`（不拷贝、可观测）。

### 4. `@Reusable` 只对 **LazyForEach 的条目**生效
把气泡/pill 抽成 `@Reusable` **没有收益**（它们不是 LazyForEach 条目）。
真正的复用目标是**整行**：`components/MessageRow.ets`（`@Component @Reusable struct MessageRowView`）。

### 5. `@Local` 是 **V2** 装饰器，V1 `@Component` 里非法
搬块时把 `@State` 写成 `@Local` 会直接编译失败 ⇒ V1 组件用 `@State`。

### 6. 机械搬块必须按**括号深度**定位，不能找"第一个 2 空格 }"
否则会切坏块边界（括号不平衡 ⇒ 报 `Declaration expected.` / `',' expected.`，且报错位置
指向无关行，极易误判）。本仓 `MessageRow` 的抽取改为 `depth = count('{') - count('}')`
归零判定，并在写入前**断言括号平衡**。

### 7. ArkUI 装饰器在"纯 TS" harness 下需要**双垫片**
`tools/tests/run.sh` 把 `core/*.ets` 当纯 TS 编译 ⇒ `@Observed` 这类装饰器：
- 编译期：`tools/typecheck/stubs/arkui_decorators.d.ts`（`declare const Observed: any;` …）；
- **运行期**：装饰器语法编译后会**调用**该标识符 ⇒ 还需 `tools/tests/mocks/decorators.js`
  把装饰器定义成恒等函数，并 `node -r` 预载（否则 `ReferenceError: Observed is not defined`）。

### 8. 门禁绝不能用管道检查（血泪）
`./tools/tests/run.sh | tail -2` —— **管道吞掉退出码**，测试红了也照样通过。
必须 `./tools/tests/run.sh > log 2>&1; echo EXIT=$?` 显式看退出码。

### 9. 进后台必须挂起非必要定时器（官方 §3）
`onPageHide()` 挂起脉冲与打字机（`appPaused` + 组件 `paused` 属性），`onPageShow()` 恢复；
否则后台空耗电，回前台还会与追赶逻辑打架（早该追平的文本突然"重新打字"）。

## 批次 9：跨会话串内容（真机严重事故，2026-10-10）

**现象**：切到任何会话都显示**第一个打开的会话**的内容；header 的 busy 与消息区内容来自**不同会话**
（用户报"busy idle 状态混乱"）。

**四个根因（前三个都必须修，缺一个就复现）**：

1. ⛔ **`@Reusable` 与 `@ObjectLink` 不可混用**。`@Reusable` 的复用语义要求**在 `aboutToReuse(params)` 里
   更新数据**；而 `@ObjectLink` **无法在复用中重新赋值**（`@Prop` 也不会自动刷新）⇒ 被复用的实例
   **保留旧行数据** ⇒ 其他会话/其他行的位置显示缓存池里那条旧行。要用 `@Reusable` 就必须用可按
   `aboutToReuse` 重新赋值的 `@Prop`/普通成员（对象场景还要承担 @Prop 深拷贝代价）；否则**去掉 @Reusable**。
   本仓当前选择：去掉（先保正确性），复用优化留待按官方模式重做。
2. ⛔ **`LazyForEach` 键必须全局唯一**：行 id 是**每 store 独立计数**（`live-1`/`a-1`…）⇒ 不同会话同键 ⇒
   虚拟列表把两条不同会话的行认作**同一条目**（复用旧条目）。键必须形如 `` `${chatId}#${rowId}#${rev}` ``。
3. ⛔ **同步指纹必须随会话身份作废**：`rowsFp`/`sessionsFp`/`queueFp`/`todosFp` 是**页面级**缓存，而行指纹
   只由 `id#rev` 组成 ⇒ 两个会话可能**逐字同指纹** ⇒ 切会话时 `this.rows` **永不刷新**（一直显示上一个
   会话的内容）。两条一起修：① 身份变化时**清空全部指纹**；② 指纹里**显式带上 `chatId`**（同指纹不可能）。
5. ⛔ **数据源骨架判据必须含会话身份（最致命的一处）**：`ChatRowDataSource.applyRows` 原本只用
   `sameRowIds`（**纯 id 序列**）判断"骨架是否变了" —— 而行 id 是每 store 独立计数 ⇒ 两个会话同形
   ⇒ 判"骨架未变" ⇒ `changedRowIndices` 为空 ⇒ **一条变更通知都不发** ⇒ `LazyForEach` 保留第一个
   会话已构建的条目 ⇒ **切到任何会话都显示第一个会话的内容**。判据 = `needsFullReload(prev, next,
   prevChatId, nextChatId)`（身份变化 **或** id 序列变化 ⇒ `onDataReloaded()` 整表重建）。

**收口清单（四处，纯函数都在 `core/rowdiff.ets` 且有判别测试 `tools/tests/session_identity.test.ts`，
修复前必红）**：① `sessionScopedRowKey(chatId,row)` 作 `LazyForEach` 键；
② `rowsFpOf(rows,chatId)` / `scopedFingerprint(chatId,parts)` 作同步指纹；
③ `identityChanged(prev,next)` 触发**全部指纹作废**；④ `needsFullReload(...)` 作数据源骨架判据。
另：`syncFrom` 里 **身份先于指纹/投影**（顺序错则行键仍用旧会话 id）。
4. ⛔ **`syncFrom` 里会话身份必须最先落定**：`this.currentChat = store.currentChatId` 原本排在第 632 行
   （指纹比较 / `syncRowDs()` **之后**）⇒ 行键仍用**旧会话 id**（键继续碰撞）。顺序：**身份 → 指纹 → 投影**。

## 批次 10：SSE 流式期间「思考中」闪断 / 只蹦完整迭代（真机 P0，2026-10-10）

**现象**：发消息 → 显示「思考中」→ 消失 → 用户消息后什么都没有 → 又「思考中」→ 最后一次性出现完整迭代；
**全程没有打字机和进度**。

**根因（三处，同一类：陈旧信号冻结/清零"在飞回合"）**：
1. `onSessionEvent` 对 `isIdleAction` **无条件 `busy=false`** —— 而 coarse idle 可能是
   SSE `last_event_id` **重放** 或 `restoreActiveProgress` 竞态的**迟到信号**，此时回合仍在跑。
2. `loadSessions` 的 busy 对账：发送保护窗口（3s）一过，就用**陈旧的会话树快照**
   （`running=false`）覆盖 `busy` —— 会话树的 `running` 有 RTT 延迟，在飞回合被当成空闲。
3. `onFinalText` 收到**空 text** 时清掉 live 行内容并置 `isLive=false` ⇒「用户消息后什么都没有」。

**修复（对齐 web `session_running` 闸门语义）**：
1. 新增 `serverRunning`（服务端会话树 = **权威**忙碌标记）；coarse idle 在**权威仍说 running** 时
   **忽略**（只顺手刷新会话树，真结束仍能收尾 → 不卡 busy）。
2. 会话树对账：**永远可以置 busy=true**（恢复路径）；只有**本地没有在飞的 live 行**
   （`hasLiveRow()`）**且**已过发送保护窗口，才允许用它**清** busy。
3. 空 text 不再终结在飞的 live 行（`busy && isLive && !rowIsEmpty` ⇒ 忽略）。

**判据速查**：`busy` 的清零只允许来自「权威 idle（且会话树已翻 false）」或「无 live 行 + 过窗口的快照」；
任何"看起来像 idle 但回合仍在飞"的信号都必须忽略。

## 批次 11：流式内容「投递机制」回归 —— live 行读就地修改的对象 ⇒ 组件永不重建（真机 P0，2026-10-10）

**现象（用户逐字）**：发送后「思考中…」出现 → **第一条 SSE 到达即消失** → 整个迭代期间
列表**全空**（没有打字机、没有进度）→ **该迭代 commit 之后才一次性出现**。
用户明确定性：**回归**（「在重复 user msg 那个 bug 修复之前，typer 是好的」）。

**回归窗口（git 证据）**：
| 提交 | `grep -c liveText <(git show <sha>:…/pages/Index.ets)` | live 内容怎么到渲染 |
|---|---|---|
| `c174364`(P53) / `0a17f76`(P54) | 5 | 页面 `@State liveText/liveReasoning/liveTools`（`syncLiveTail` 每帧赋值）→ 页面 build **直接**建 `LiveTailView({text: this.liveText,…})` |
| `fa07632`(P55) ← **罪魁** | 0 | live 行改「非懒尾项」`ListItem(){ this.ChatRowBody(this.liveRowRef) }`，在飞内容只能从**就地修改**的 `ChatRow` 里读 |

**根因（ArkUI V1 语义）**：组件只在**收到的值发生变化**时重建。
- `ChatRow` 是 `@Observed` + **就地更新**（保 `@ObjectLink` 恒等）⇒ **引用恒定**，不构成「值变化」；
- live 行经**带参 @Builder**（`ChatRowBody(this.liveRowRef)`）创建 —— 按值传参是「调用那一刻的快照」，
  参数引用不变时其内容的就地变化**不驱动**其内 UI 更新；
- 该行又**不在**带 key 的 `LazyForEach` 里（其余行的刷新全靠 `id#rev` 键变化）。
⇒ 整个流式期间 live 组件**重建次数 = 1（仅创建那次）** ⇒ 渲染输入冻结在「创建那一刻」（此刻为空）
⇒ 占位让位却画不出任何东西（全空）；直到 turn 离开 live 路径（commit）后由带 key 的 `LazyForEach`
重建，才「一次性出现」。**数据层是完全正常的**（实测 `rev` 每帧自增、`rowsFp` 每帧变、在飞块有内容）。

**修法（恢复回归前的投递机制，非 hack）**：
1. 页面恢复 `@State liveText/liveReasoning/liveTools` + `syncLiveTail()` —— 从 live 行**末尾在飞块**
   派生（与 `rowIsEmpty/rowVisibleChars` 判据**同源**，同一块），每次内容变化赋新值 ⇒ 产生「值变化」；
2. live 行改用**无参** `@Builder LiveRowBody()`（内部直接读页面 @State）—— 绕开「带参 @Builder 按值快照」；
3. `MessageRowView` 声明 `@Prop liveText/liveReasoning/liveTools`，在飞块由它们渲染（不再读行对象）。
**性能**：`syncLiveTail` 赋值前先比较（同值不赋值）；行组件重建时其已完成迭代 `ForEach` 键稳定
⇒ Markdown 不重解析；打字机仍在 `LiveTailView` 内（高频状态不外溢）。

**通用教训**：**任何"由外部就地修改、引用恒定"的数据，都不能作为组件刷新的唯一输入**。要刷新，必须有
「状态变量的值变化」或「带 key 的列表项 key 变化」。行对象（`ChatRow`）可以被就地改以保恒等，
但**必须**另有一条值变化通道把"要显示的内容"投递给渲染。

**判据（回归守卫 `tools/tests/live_tail_delivery.test.ts`，改回旧机制必红）**：
① 页面有 `@State liveText/liveReasoning/liveTools` 且 `syncLiveTail()` 每帧同步；
② `MessageRowView` 声明三者 `@Prop` 且**由 @Prop 渲染**（`LiveTailView` 读 `this.liveText`）；
③ live 行由**无参** `@Builder` 创建；④ 投递模型断言：live 组件每帧渲染输入 == 当前在飞内容。

## 批次 12：**已完成块**没走「值变化通道」⇒ 迭代边界处整块消失（真机 P0，2026-10-10）

**现象（用户逐字）**：「iter 1 (streaming) → iter 1 的 **tool call 完成**后 **iter 1 直接消失**
→ 接着 **iter 2 (streaming)**，但它前面**看不到 iter 1**」。

**根因（批次 11 的残留面）**：批次 11 只把「**在飞块**」接到了「值变化」通道。**已完成块**仍走
**带参 @Builder** `AssistantBlock(this.row)` 里的 `ForEach(this.itersFor(row))` —— 参数是**同一个**
`ChatRow` 引用（`core/render.ets:applyRow` 就地改它）⇒ 参数不变 ⇒ 该 `@Builder` 内的 UI
**不重建**（批 1 §4「按值传参 = 调用那刻的快照」）⇒ 已完成块区**冻结在创建那一瞬（空）**。

| 时刻 | 模型 `row.iterations` | 渲染（坏）：已完成块区冻结 `[]` ⊕ 在飞块（值） |
|---|---|---|
| iter1 流式 | `[iter1(live)]` | `[iter1]` ✅ |
| **tool 完成** | `[iter1]` + 在飞块清空 | **`[]` ⇒ iter1 消失** ❌ |
| iter2 流式 | `[iter1, iter2(live)]` | `[iter2]`（前面看不到 iter1）❌ |

**关键区分**：这不是数据层 bug（`reduce/derive/applyRow` 的 `row.iterations` 逐帧**完全正确**，
`tools/tests` 探针实测帧 5 = `[i1 bash:done]`、帧 6 = `[i1][i2*]`）。这是**纯投递层** bug ——
「模型全对、画面不对」，**必须在投递层写判据**（模型测试测不出）。

**修法**：把**已完成块列表**也镜像进页面 `@State liveBlocks`（`completedBlocks(liveRowRef)`，
按 `blocksSignature` 门控）→ `MessageRowView` 的 `@Prop liveBlocks`；并把 `AssistantBlock` /
`IterationBlock` / `ToolPill` 改成**无参**（读 `this.row`/值），使已完成块区随值重建。
对齐 web：`MessageList` 把**整份** `liveProgress` 快照（含 `iterationHistory`）当 prop 传 `TurnBody`。

**性能**：`liveBlocks` 只在**迭代边界**换值（流式期间不变 ⇒ 不赋值），不引入每帧重建 / tick。

**通用教训（批次 11 的加强版）**：一条消息气泡里**每一个**独立的"内容区"都必须有自己的值变化通道。
只修了其中一个区（在飞块）而另一个区（已完成块）仍读就地改的对象 ⇒ 后者在**迭代边界**（其驱动
数据发生变化的那一刻）暴露 —— 症状是"某一块在某个特定时刻凭空消失"，极易被误判成数据丢失。

**判据（回归守卫 `tools/tests/live_block_delivery.test.ts`，HEAD 必红）**：
① 页面有 `@State liveBlocks` 且 `syncLiveTail()` 按 `blocksSignature` 同步；
② `MessageRowView` 声明 `@Prop liveBlocks` 且**由值渲染**（`blocksFor()` 读 `this.liveBlocks`）；
③ 投递模型断言：该 turn 的**渲染块列表**跨迭代边界**单调不减**、已完成的 iter1（含 tool pill）
始终在列表里。HEAD：`渲染块列表回退：1 → 0`（6 passed / 7 failed）；修复后 15 passed / 0 failed。

---

## 批次 13：**门禁假的绿** —— 组件不被消费就不被类型检查（2026-10-11）

- **现象**：新建的 `components/AssistantOrb.ets`（`828b28a`）提交时**三条离线门禁 + `hvigorw` 全绿**；
  直到另一条线把它接进 `components/LiveTailView.ets` 才报：
  ```
  ERROR: 10505001 ArkTS Compiler Error
  Error Message: Property 'size' in type 'AssistantOrb' is not assignable to the same
  property in base type 'CustomComponent'.
  ```
- **根因两条，都要记**：
  1. **`size` 是 ArkUI `CustomComponent` 的基类成员**（自定义组件本身有 `.size()` 修饰符）
     ⇒ 子类**不能**用同名成员覆盖。同类基类成员还包括
     `width`/`height`/`position`/`offset`/`scale`/`rotate`/`opacity`/`visibility`/`clip`/`zIndex`/`id`/`key`
     以及 `onClick` 等事件名；**另经 2026-10-11 实测确认 `enabled` 也在内**
     （`components/SettingsTools.ets` / `SettingsLlm.ets` 的 `@Prop enabled` 被判
     `Property 'enabled' in type 'X' is not assignable to the same property in base type 'CustomComponent'`
     ⇒ 改名 `isOn` 后通过）。**改名**即可。
  2. **未被任何文件引用的组件不会被 ArkTS 类型检查** ⇒ "新建组件 + 门禁全绿"是**假绿**。
- **正确做法**：
  - 新建组件**要么尽早接线**（接线后重跑真门禁），**要么**明确知道"这条绿不覆盖它"；
  - 交付/验收时一律用 `bash tools/gate.sh`（离线三条 **+** `hvigorw assembleHap`），
    并以 **`BUILD SUCCESSFUL`** 为唯一判据（见 `AGENTS.md` GOTCHAS）。
  - **接线前**想真验一个孤儿组件（2026-10-11 实测有效）：把整个工程 rsync 到 `/tmp/<x>`（排除
    `.git/.hvigor/entry/build`），在被引用的 `pages/**` 里加一个**探针页**（并把它加进
    `main_pages.json`）引用你的组件，在 `/tmp` 里 `hvigorw assembleHap`。
    ⛔ **必须做灵敏度对照**：先在探针页/组件里塞一个**确定能报错的语法错**（如
    `function __probe(: number = ;`）确认 `BUILD FAILED`，再用干净版本跑出 `BUILD SUCCESSFUL`
    —— 否则"绿"同样可能是没编到（实测：孤儿文件塞语法错，`rm -rf entry/build` 后**冷构建**
    依然 `BUILD SUCCESSFUL`，证明它压根不在编译图里）。
- **定位手段**：报错只有 1 ERROR 且指向**你不拥有的文件**时，用 **`git stash push -- <你的文件>`**
  后重跑构建 ⇒ 若仍报同一错误，即**跨线阻断**、与你无关（举证手段，别硬扛）。

---

## 批次 14：`linearGradient` 是**背景**渐变，不是"文字填充渐变"（2026-10-11，真机截图抓到）

- **现象**：登录页字标本想做 web 那种**渐变字**，代码是（`pages/Index.ets:2192-2198`）：
  ```ts
  Text('xbot').fontSize(40).fontWeight(FontWeight.Bold)
    .linearGradient({ angle: 135, colors: [[this.eff().gradientFrom, 0.0], [this.eff().gradientTo, 1.0]] })
    .shadow({ radius: 22, color: this.eff().glow, offsetX: 0, offsetY: 0 })
  ```
  真机渲染结果是**一块直角紫色方块 + 白色 "xbot"** —— 完全不是渐变字。
- **根因**：`linearGradient` / `radialGradient` / `sweepGradient` 定义在 **`CommonAttribute`** 上，
  语义 = **组件背景**（等价 `backgroundImage`），**与 `.fontColor()` 无关**。
  **ArkUI 没有 gradient-text**（不存在 `fontGradient` / `textGradient`）。
  于是"给 `Text` 加渐变" = "给 `Text` 刷背景"，而 `Text` 没有 `borderRadius` ⇒ 直角色块。
  同理 `.shadow()` 是**外阴影**（不是内高光）；`.backgroundColor()` / `.backgroundBlurStyle()` 都是容器语义。
- **正确做法**（三选一，别赌）：
  1. **徽标（推荐）** —— 把"色块"做实：外层容器显式给 `borderRadius` + `padding` +
     `justifyContent(FlexAlign.Center)`，渐变刷在**容器**上，内部 `Text` 用 `onAccent` 白字。
     此时"背景渐变"从 bug 变成**有意为之的 app 徽标**（squircle 方章）。
  2. **纯色字（最省事）** —— 直接 `.fontColor(accent)`，学 Apple 的克制；极简风里纯色字标往往比渐变字更好。
  3. **真·渐变字** —— `Stack` 叠层 + `.blendMode(BlendMode.SrcIn)` 反向裁切。**复杂度高**，
     不同渲染后端 `blendMode` 行为不一致，真机必须复验；除非设计硬要求，否则不做。
- **为什么离线门禁抓不到**：这类缺陷**不是类型错误**，三条离线门禁 + `hvigorw assembleHap` 全绿。
  **只有真机截图能抓到** ⇒ 凡"视觉层"改动，交付必须附**真机截图**，
  不许只报 `BUILD SUCCESSFUL`（与批次 13"假绿"是同一类问题的两个面：一个是查不到，一个是测不到）。
- **同批附带的第二个坑（脏默认值盖住占位符）**：`pages/Index.ets:198`
  `@State serverUrl: string = 'http://'` ⇒ 输入框被真值填满，
  `TextInput` 的 `placeholder`（`服务端地址，如 192.168.1.10:16000`）**从未显示过**，用户还得先手删 `http://`。
  而 `core/endpoint.ets:16` 的 `normalizeServerUrl()` **本来就会补协议**（`192.168.1.10:16000 → http://192.168.1.10:16000`）
  ⇒ 预填是**纯负担**。
  **教训**：任何"预填默认值"动笔前先问两句 ——
  ① 它会不会**盖住提示**（placeholder）？② 它是会不会**重复下游已有的归一化**？
- **附带事实（对齐 web 时别搞错基准）**：web 登录页**没有 logo**
  （`web/src/pages/LoginPage.tsx:56-63` 只有标题 + 副标题）⇒ 原生端的 logo 是**超越 web 的独享项**，
  可以自由设计，但**必须是有意为之**；凡是"意外渲染出来的样子"都不算设计。
  开屏（startWindow）则已有判据：`docs/BRAND.md` §4，底色取
  `lightPalette().appBg = #F8FAFC` / `darkPalette().appBg = #0B0B0E`（**与主界面同色，开屏→首屏不跳色**）。

---

## 批次 15：**服务端 JSON `null` ≠ ArkTS `undefined`** —— 只判 `!== undefined` 的门会把 `null` 放过去（真机 P0：新建会话失败，2026-10-11）

- **现象**（真机端到端）：点会话抽屉的「＋ 新建」⇒ Toast **`新建失败: Cannot read property questions of null`**，新建会话 100% 失败。
- **链路**：`pages/Index.ets:1509 newSession()` → `core/store.ets:369 createSession()` → `openSession()` → `loadHistoryInner()` → **`:589-592`**。
- **实测证据**（**别只推理，要打服务端**）：对一个没有在飞进度的会话（新会话必然如此），`POST /api/history` 返回
  ```json
  {"ok":true,"data":{"active_progress":null,"messages":null,"has_more":false,...},"error":null}
  ```
  即 **JSON `null`**（不是缺字段、不是 `undefined`）。复现：`curl -c/‑b cookie.jar POST /api/auth/login` → `/api/chats/create` → 用返回的 `chat_id` 打 `/api/history`。
- **根因**：
  ```ts
  const ap: ProgressEvent | undefined = data.active_progress;   // 运行期是 null！
  if (ap !== undefined) { this.pickAskUserFromProgress(ap); }   // null !== undefined ⇒ 为真 ⇒ 放行
  ```
  进 `pickAskUserFromProgress(null)` ⇒ `arrOrEmpty(p.questions)` **先求值 `p.questions`** ⇒ 抛异常。
- **为什么容易复发**：类型标注写成 `| undefined` 会让人以为"判 `undefined` 就够了"；而 Go 侧的 nil slice / nil map / nil pointer 序列化成 JSON 时是 **`null`**，不是缺字段。
- **正确做法**：
  1. 一切**外来 JSON**（`postAs<T>()` 的结果 / `JSON.parse(...) as T` / SSE `env.*`）的判空**一律**用 `core/guards.ets` 的 `isPresent()`（`v !== undefined && v !== null`）/ `arrPresent()` / `arrOrEmpty()`；
  2. **纯函数/私有方法的入口自身也要防御**（签名放宽为 `T | null | undefined`），**不要把安全性寄托在调用方** —— 本批次的缺陷能复发，正是因为这个方法自己不设防。
  3. 本地变量的 `!== undefined` 不必改（别扩大爆炸半径）。
- **本仓库已有先例**：`core/store.ets:399` 注释早就写过同一件事（"服务端 nil map → JSON null；只判 undefined 会把 null 交下去（`toLocalSettings(null)` 崩）"）⇒ 这是**同类缺陷复发的第二例**。
- **为什么离线门禁抓不到**：`null` 完全符合 `T | undefined` 的静态类型（ArkTS 的类型检查不追踪 JSON 的 null 可能性）⇒ 三条离线门禁 + `assembleHap` 全绿，只有**真机端到端**能抓。又与批次 13/14 同一结论：**门禁的口径之外，必须真机走一遍主流程**。
- **真机复现工具**：`tools/device/ui.sh`（`click-text` / `click-input` / `wait-text` / `shot`）—— 本 P0 就是它抓到的。

## 批次 16：**孤儿检测脚本自己漏报** —— 注释里的提及被当成"消费者"（2026-10-11，第三次"假绿"：这次是**工具**在骗人）

- **现象**：`bash tools/gate.sh` 的 ⑤ 步一直打印 `✅ 无孤儿组件（33 个 export struct 均有消费者）`，但实际存在 **3 个真孤儿**（`components/SubAgentTree.ets` / `components/GoalBanner.ets` / `components/TodoPanel.ets`）—— 它们**从未被编译过**。
- **根因**（旧脚本）：
  ```bash
  grep -rl --include='*.ets' -E "\b${s}\b" .   # ← 全文搜索：注释里的名字也算命中
  ```
  而本仓的注释习惯是**大量交叉引用**（"web `GoalBanner.tsx` 同构"、"渲染层据此展平后交给 `components/SubAgentTree`"、"原生即 `TodoPanel` 的上一条"）⇒ 只要**注释**里提过一次，就被判为"已接线"。三个孤儿各自的"假消费者"：
  | struct | 假消费者（实际是注释） | 位置 |
  |---|---|---|
  | `SubAgentTree` | `core/types.ets` | `:97`、`:293` |
  | `GoalBanner` | `core/statusfmt.ets` | `:111`、`:123`、`:138`、`:159` |
  | `TodoPanel` | `components/GoalBanner.ets` | `:27` |
- **为什么危险**：批次 13 的全部价值就落在这把尺子上（孤儿 ⇒ 不参与编译 ⇒ **假绿**，已两次真事故：`AssistantOrb` 的基类成员名冲突、`PluginHost` 的 `arkts-no-untyped-obj-literals`）。这把尺子自己漏，等于**防线是假的**；且**漏报方向**最坏 —— 它把"待接线"说成"已接线"，于是孤儿越积越多，每次假绿都埋一颗雷。
- **修法**（`tools/lint/orphan-components.sh`）：先把每个 `.ets` **剥掉注释**再搜引用
  ```bash
  perl -0777 -pe 's{/\*.*?\*/}{}gs; s{(?<!:)//[^\n]*}{}g'   # `://` 不截断，避免打死 URL 行的后半截
  ```
  ⇒ 判据变为「**只在注释/文档里被提到 ⇒ 仍是孤儿**」。同时新增 `--self-test` 夹具（注释提及⇒孤儿 / 无提及⇒孤儿 / 真消费者⇒不算孤儿），把本次回归钉死。
- **教训（比缺陷本身更重要）**：**门禁的每一把尺子都必须能被证伪**。批次 13/14/15 教的是"门禁口径之外要真机走一遍"；这一批教的是"**门禁自己说的话也可能是假的**"。凡"工具报绿"就直接采信，等于把批次 13 再犯一遍。⇒ 新增或修改任何门禁脚本，**必须**带 `--self-test` 或有判别力的 mutation 自证。

## 批次 17：**`touch` 是破坏性的** —— 「强制重编破增量假绿」会把**已删除的文件复活成 0 字节**（2026-10-11，我亲手把 HEAD 弄红）

- **背景**：某条线把 `core/guards.ets` **改名**为 `core/guards.ts`（原因：ArkTS **禁止 `.ets` 里声明类型谓词**，报 `10505001/arkts-no-is`；而 `core/*.ts` 端口件本就是为了避开 ArkTS 严格性而存在）。该改名已正确提交（`git show` 显示 `{core/guards.ets => core/guards.ts}`），`git status` 干净，隔离验证全绿。
- **我做了什么**：随后按惯例"强制重编破增量假绿"，执行
  ```bash
  touch entry/src/main/ets/core/guards.ets entry/src/main/ets/core/http.ets …   # ⛔
  ```
  ⇒ **凭空出现一个 0 字节的 `guards.ets`**（`touch` 对不存在的路径会**创建**它，语义是 create-or-update，不是 update）。
- **后果（症状离根因极远）**：ArkTS 解析 `import … from './guards'` 时**优先命中 `.ets`**，命中一个空文件 ⇒
  ```
  10505001 File '.../core/guards.ets' is not a module.     (http.ets:15、store.ets:16)
  10605999 'env.error' is possibly 'undefined'.            (http.ets:299、300、381、382)  ← 连锁
  10605999 Type 'string | undefined' is not assignable to type 'string'.
  ```
  共 8 个错误 + `BUILD FAILED`。看上去**完全像"别人提交了坏代码"**（我据此误判了那条线的交付诚实性，浪费一轮判断）。
- **一眼取证**：
  ```bash
  ls -la core/guards*      # 0 字节的 guards.ets（mtime = 我刚跑 touch 的时刻）+ 2846 字节的 guards.ts
  git status --short       # ?? core/guards.ets  ⇒ 未跟踪 ⇒ 是本地凭空造的，不在任何提交里
  ```
- **正确做法（破增量假绿）**：① `touch -c <确实存在的文件>`（`-c` 不创建）；② 或改一个**确实存在**的无关文件（如 `pages/Index.ets`）触发重编；③ 或 `hvigorw clean` / 删 `entry/build` 全量重编。
- **排障纪律**：看到"别人的文件红了"，**先 `ls -la` 那个文件、再看 `git status` 是否 `??`**，分清「提交坏了」与「本地被污染」。**在扩展名决定模块解析顺序的工程里，一个凭空造出的 0 字节同名文件就能顶掉真模块**。

## 批次 18：**基类成员名黑名单远比"那 12 个"长** —— 凡 `CommonMethod` 的属性方法名都不能当组件成员名（2026-10-11，接线时暴露）

- **现象**（把 `components/GoalBanner.ets` **第一次**接进页面时，ArkTS **首次**检查它）：
  ```
  10505001 Property 'borderColor' in type 'GoalBanner' is not assignable to the same property
           in base type 'CustomComponent'.
           Type '() => string' is not assignable to type
           '(value: ResourceColor | EdgeColors | LocalizedEdgeColors) => CommonAttribute'
  ```
  根因：私有方法 `borderColor(): string` 与 `CustomComponent`（经 `CommonMethod`）的**同名属性方法**冲突。此前本仓只把
  `size/width/height/position/offset/scale/rotate/opacity/visibility/clip/zIndex/id/key/enabled` 与 `on*` 列为黑名单
  —— **`borderColor` 不在其中**，于是被当成"安全名字"用了很久。
- **正确规则（比记忆黑名单强）**：**凡是 `CommonMethod`/`CommonAttribute` 上存在的属性方法名，都不能用作自定义组件的成员名**。黑名单不是 12 个特例，而是一个**可计算的集合**。
- **可复现的检查法**（接线波用的正是它，一次改完即绿）：
  1. 从 SDK 的 `component/common.d.ts` 抽出 `CommonMethod`/`CommonAttribute` 的**全部成员名** → 集合 A；
  2. 取目标组件的**全部成员名** → 集合 B；
  3. `A ∩ B` 非空 ⇒ 逐个改名。
  本次实测：三个待接线组件里**唯一撞名就是 `borderColor`**（`SubAgentTree`/`TodoPanel` 零同类错误）⇒ 用集合求交比"凭记忆"可靠得多。
- **为什么现在才炸**：`GoalBanner` 此前是**孤儿**（无消费者 ⇒ 不参与编译 ⇒ 假绿），接线那一刻才被检查。**同一次编译还一并暴露了批次 19**。

## 批次 19：`$r('sys.symbol.*')` 是**编译期校验**的资源名 —— 必须核实存在，不能凭记忆写（2026-10-11）

- **现象**（与批次 18 同一次编译）：
  ```
  10903329 Unknown resource name 'sys.symbol.circle_badge_checkmark'   At File: components/GoalBanner.ets:110
  ```
  "想当然"式命名（web 用 lucide `Target`，就顺手编一个 `*_badge_*` 之类）只在**编译期**才炸，且错误信息不回显你本该用哪个。
- **正确做法**：候选名必须先对 **SDK 符号表**核实存在。权威文件：
  ```
  ~/ohos-cli/command-line-tools/sdk/default/openharmony/toolchains/id_defined.json
  ```
  可一次抽出全部合法资源名做集合，逐个核验。本次核实结果：`dart_target` ✅（选中，语义最贴 lucide `Target`）、
  `scope` ✅、`circle_on_circle` ✅、`record_circle` ✅、**`circle_badge_checkmark` ❌ 不存在**。
- **连带纪律**：**不要自造「lucide 图标名 → `sys.symbol`」的映射**。web 的图标名（`git-branch`/`git-commit-horizontal`/`server`…）与
  HarmonyOS 符号**不是一一对应** ⇒ 要么查表映射到**已核实存在**的符号，要么**明确降级**为通用图标
  （web `plugin-runtime/pluginIcons.ts:76` 未知即回落 `Puzzle`；原生回落通用方块，见 `components/PluginHost.ets`）。

## 批次 20：多线共用一个工作树时，**改完必须立刻提交**（2026-10-11，一次真实的工作量丢失）

- **事故**：接线波在 `pages/Index.ets` 里加了 **179 行**（尚未提交）时，**另一条线的一次 `git commit`**（它自己走了 pathspec，但提交前对 `Index.ets` 做过整文件操作）导致接线波那 179 行**被整文件还原抹掉**；`stash` 为空、`reflog` 里没有它的提交 ⇒ **只能全部重打**。
- **纪律**（已写进所有波的派发约束）：
  1. **一条线的改动一旦通过门禁就立刻提交**，不要攒着等"这一波全部做完再说"；
  2. 提交**必须严格 pathspec**，提交前 `git diff --cached --name-only` 逐条核对；
  3. 同一文件**同时只允许一条线在改**（编排时按文件冲突矩阵分波）。

## 批次 21：`tools/gate.sh` 的第 ④ 步会**增量空转** ⇒ 门禁自己就是假绿制造机（2026-10-11，实测 + 已修）

- **现象**：`bash tools/gate.sh` 打出 `> hvigor BUILD SUCCESSFUL in 1 s 145 ms` 并宣告
  `✅ 真门禁全绿（离线三条 + ArkTS 编译）` —— 但**那一步根本没做 ArkTS 类型检查**
  （hvigor 增量发现"无变更"就空转）。同一时段另一条线改完代码时打的是 `14 s 915 ms`（真编译）。
  ⇒ **判据不能只看"绿"，必须看 ④ 的耗时量级**（十几秒 = 真，1 秒 = 空转）。
- **危害**：本仓第 1 类假绿（"唯一判据是 `assembleHap`"）被**工具自身**破坏 ——
  一个 1 秒级的 `BUILD SUCCESSFUL` 会把真实的 ArkTS 类型错误静默放过，而且**看起来比真编译还干净**。
- **修法（已落地 `tools/gate.sh`）**：第 ④ 步之前执行
  `touch -c "$ROOT/entry/src/main/ets/pages/Index.ets"`。
  只改 mtime ⇒ 强制 entry 编译图整体重编 ⇒ 每次门禁都是**真编译**。
  ⛔ 必须带 `-c`：裸 `touch` 对**已删除**的文件会创建 0 字节幽灵（见批次 17）。
- **验证（强化后第一次运行就立功）**：当场抓出真红 ——
  ```
  ❌ ArkTS 编译失败：Argument of type '{…label,body,open,theme,live,emphasis,onToggle}' is not
     assignable to parameter of type '{…orb?, orbMode?, orbBeat?, paused?, reduceMotion?}'
  ✗ 思考行只有 live 时才做极弱强调，否则恒为 1   （inflight_language: 37 passed / 1 failed）
  ```
- **连带纪律（多头并行时的"树红"分发判据）**：红线落在**别人正在改的文件**里是**正常**的
  （批次 20 的前半面）。此时：
  1. **只对自己改的文件负责** —— 先 `git status --short` 确认改动范围；
  2. 红在别人文件里 ⇒ **把证据（原文 + file:line）交给编排者**，**绝不**去改别人的文件；
  3. 红在自己文件里 ⇒ 必须修，且**改完立刻提交**（树红期间别人跑门禁全是红，会去追不属于自己的鬼）。

## 批次 22：门禁的**另一面** —— 第 ③ 步既会**假红**（并发踩踏）也会**假绿**（漏检 `core/*.ts`）（2026-10-11，实测 + 已修）

第 1 类假绿是"工具不检查"（批次 13/16/17/21），这一批是**同一个脚本的两种反向故障**，都在 `tools/typecheck/check.sh`：

**22.1 假红 = 并发踩踏（共享临时目录）**
- **现象**：多线并行时第 ③ 步报 `cp: …/tools/typecheck/build/mdtheme.ts: No such file or directory`
  ⇒ 整轮判红，**与你的代码无关**。
- **机制**：`BUILD="$HERE/build"` 是**固定目录**；A 的 `rm -rf "$BUILD"` 会删掉 B 刚 `mkdir` 好的目录 ⇒ B 的 `cp` 目标消失。
  间歇性（谁先谁后决定），**比稳定红更坏** —— 会让人去追不存在的鬼。
- **修法**：目录**带 PID**（`BUILD="$HERE/build.$$"`）+ `trap 'rm -rf "$BUILD"' EXIT INT TERM HUP`
  + `tsconfig.json` 的 `include` 改 `./build*/*.ts`（`**` 匹配不到 `build.123` 这种带点目录名）
  + `.gitignore` 补 `**/build.*`。
- **验证**：8 路并发 × 2 轮 = **16 次全部 exit=0**，无残留目录。

**22.2 假绿 = 漏检 `core/*.ts`**
- **现象**：修好并发后立刻暴露 `Cannot find module './chattypes' / './guards'`（TS2307）。
- **机制**：`core/` 实为 **51 个 `.ets` + 9 个 `.ts`**（`chattypes.ts`/`guards.ts` 等**端口件**），
  而拷贝循环是 `for f in "$SRC"/*.ets` ⇒ **那 9 个文件从未进入检查程序**；引用它们的 `.ets`
  在检查目录里连"模块解析"都过不去。**这才是真隐患**：③ 一直在检查一个**不完整的程序**。
- **修法**：循环同时拷 `.ets` 与 `.ts` ⇒ 覆盖文件数 **51 → 60**。
- **教训**：门禁宣称的覆盖范围必须**能被数出来**（"51 个文件"这句话本身就该让人追问"core 里到底有几个文件"）。

## 批次 23：`ForEach` 的 key 里**编进会变的状态字段** ⇒ 流式期销毁重建、**把打开中的浮层拆掉**（2026-10-11，审计 + 已加机器门禁）

- **现象（代码级）**：live pill 用 `` `lt-${i}#${t.name}#${t.status}` `` 作 key。流式期同一枚工具
  会 `pending→running→generating→done`，**每翻一次 key 就变** ⇒ ArkUI 视为"新节点"⇒ **销毁重建**：
  挂在节点上的 `bindPopup` 浮层被拆、`selected` 复位、长按菜单丢失。
- **对照 web（权威）**：`FoldedToolGroup.tsx:557` 的 key 是 `${name}-${i}` —— **与状态无关**。
- **修法**：key 只用**稳定身份**（`lt-${i}#${name}#${call_id}`）。
  ⚠️ 反向陷阱同样真实：`@Prop` 只在 key 变化时才重估 ⇒ key 过稳会"内容变了界面不动"（批次 11/12）。
  **正确姿势**：key = 稳定身份；**内容变化走 `@Prop`/`@ObjectLink` 通道**。
- **已落地机器门禁**：`tools/lint/criteria-single-source.sh` 规则 A（key 生成器含 `.status/.state/.phase/…`
  ⇒ 命中即警告），带 `--self-test` 与豁免清单，已接入 `tools/gate.sh`。

## 批次 24：多线并行时，**`git add` 会被别人抢**（2026-10-11，真实发生）

- **现象**：`git commit` 之后发现提交里**多了别人的文件**（实例：`components/MarkdownView.ets` +
  `tools/tests/theme_contrast_light.test.ts` 被另一条线的 `git add` 扫进了我的提交）。
- **机制**：`git add` 操作的是**共享 index**，两条线同时 `git add` ⇒ 彼此的暂存区互相可见。
- **纪律（已写入派工模板）**：
  1. 只用**严格 pathspec**：`git add -- <确切文件>`（⛔ 不用 `git add -A/./-u`）；
  2. **提交前**核一遍 `git diff --cached --name-only`，必须**恰好**等于你打算提交的文件集；
  3. 已被扫进来 ⇒ `git reset --soft HEAD~1` 拆开重提，⛔ 别用 `--amend` 掩盖（会把别人的改动一起改写）。

## 批次 25：动效 API 分两类 —— **循环/重复** vs **一次性过渡**（2026-10-11，机器门禁 `tools/lint/inflight-single-source.sh`）

- **铁律**（`docs/DESIGN-SYSTEM.md §8`）：**同一时刻只允许一个"在飞动效" = 光球（`AssistantOrb`）**。
  可"哪些 API 算在飞"以前只靠自觉 ⇒ 直到写成机器判据才有共识：

| 类 | API | 判定 |
|---|---|---|
| **A 硬红** | `ScaleSymbolEffect` / `PulseSymbolEffect` / `BounceSymbolEffect` / `VariableColorSymbolEffect`（`isActive=true` 期间**反复播放**）；`AnimateParam.iterations ≠ 1`；`playMode` | 白名单（`components/AssistantOrb.ets` + `components/anim.ets` + `core/motion.ets`）**之外**出现即红 |
| **B 警告** | 内置连续动画组件 `LoadingProgress(` / `Marquee(`；**内联** `{duration, curve}` 字面量的 `animateTo` / `.animation()` | 需人判断（可能是"操作进度"= 合法）／"魔法时长散落" ⇒ 应收敛走 `anim.ets` |
| **允许** | 一次性 SymbolEffect 子类（`Appear`/`Disappear`/`Replace`/`Hierarchical`）、`animateTo(animXxx(), …)`、`.animation(animXxx())`、`keyframeAnimateTo` | 一次性过渡 —— 但**必须**走动效底座 `components/anim.ets` |

- **判据设计要点**：⛔ **不要 grep `animateTo`**（一次性过渡也用它）——要按"是否**产生重复**"分类；
  跳过注释行；API 必须带 `(`（是真调用，不是注释/字符串里提到名字）。
- **节奏契约（§8.1）**：在飞组里任何呼吸/脉冲/闪烁都必须是主呼吸刻度的**整数分数或倍数**
  （1× / 1/4 / 1/8）——`ScaleSymbolEffect` 用的是**系统自带节奏** ⇒ 不在刻度上 = "新造了一套时长"。
- **战绩**：门禁上线即抓到一处**真违规** —— `components/ToolVisual.ets:84` 排队态的 `ScaleSymbolEffect`
  （系统节奏 + 挂在**语义最安静**的 `muted` 档 ⇒ **视觉层级倒置**：排队比执行中更抓眼）
  ⇒ 批次23 裁定**删除**（静态标记的最终形态归设计系统 `docs/REDESIGN.md §4.4`）。⚠️ 但 `ToolVisual.ets`
  运行态的 `LoadingProgress()` **保留**（它 = "工具身份"，用户明确否掉过静态字符）。
- **豁免**：`tools/lint/inflight-allowlist.txt`，格式 `<相对路径>|<API标签> # <理由>`；
  **理由必填**（去空白 ≥8 字符，无理由**不生效** = 门禁仍红）。

## 批次 26：**面板的关闭按钮写错 flag** —— 十几个 `@State` 各自为政的必然结果（2026-10-11，用户亲报「点 X 无反应」）

- **现象**（用户原话）：「侧边栏里的设置打开了**又关不掉**，**点击 x 无反应**」。
- **根因**：`pages/Index.ets` 里「设置」有**三份**实现、三个 flag（`showPrefs` / `showSettings` /
  `showSettingsPanel`），而 `PrefsSheet` 的 X 写的是**别的面板**的 flag：
  ```diff
  - this.showSettings = false;   // ❌ 关的是「右上角那份」；自己（showPrefs）仍为 true ⇒ 面板不消失
  + this.showPrefs = false;      // ✅
  ```
  旁证：**同一面板的背板点击写对了**（`showPrefs=false`）⇒ 只有 X 那一行错 ⇒ UI 上表现为"点了没反应"，
  **肉眼与搜索都极难发现**（两个字符串都合法、都能编译、都能通过全部离线测试 ✗）。
- **机制**：可见性 flag 是**分散的 `@State`**（该文件 15 个），**没有任何一处集中声明**
  「哪个面板 ↔ 哪个 flag」⇒ 复制粘贴新面板时必错。⇒ 与 §16#5「同一信息两处判据」同类：
  **一份知识（谁能关我）散在两处实现里**。
- **纪律（防复发）**：
  1. 面板 id ↔ 自身 flag 的对应**收成一张表**（`core/sheets.ets` 的 `sheetSpecs()` / `closeFlagOf(id)`），
     X / 背板 / 返回键**三条关闭路径只准写** `closeFlagOf(id)`；
  2. 加**机器门禁**：对每个 `@Builder XxxSheet`，断言其 X 的赋值 == `closeFlagOf(id)`
     （在修复前该断言**必红** ⇒ 有判别力；修复后转绿）；
  3. 新增面板时，**X / 背板 / 返回键写同一个 flag**，并至少用 `dump` 确认"能关"。
- **同类隐患**：该文件 `xmark` 共 **9 处** ⇒ 逐一与其所属 `@Builder` 的渲染 flag 对照，
  ⛔ 不要只修用户报的那一处。

## 批次 28：在**干净 worktree** 里跑门禁，④ 会因"依赖没装"**假红**（2026-10-11，我本人踩；差点因此拦住一次装机）

**症状**：`git worktree add --detach /tmp/xxx <ref>` 在干净树里跑 `bash tools/gate.sh` ⇒
```
❌ ArkTS 编译失败：> hvigor ERROR: BUILD FAILED
Error Message: Cannot find module '@hxa-atpc/noties_prism4j' or its corresponding type declarations.
At File: entry/src/main/ets/core/highlight.ets:18:8
```
而**同一 commit 在主树里门禁全绿**。⇒ 极易误判成"提交的内容编译不过 / 有人推坏了"。

**成因**：`oh_modules/`（含 bytecode HAR 依赖，如高亮用的 `@hxa-atpc/noties_prism4j`）是
**git-ignored** 的 ⇒ 新建的 worktree 里没有它；而 `tools/gate.sh` 的 ④ **只编译、不装依赖** ⇒ 必然假红。
主树之所以绿，是因为主树的 `oh_modules` 早就在了。

**纪律（防复发）**：
1. **凡在干净 worktree / 新 clone 里跑门禁，先 `ohpm install --all`**（本仓 `~/ohos-cli/deploy.sh`
   与验收脚本 `/tmp/xbot-accept.sh` 都自带这步 ⇒ 装机路径不受影响）；
2. 看到"干净树编译失败"先问一句：**依赖装了吗**？再怀疑代码；
3. 与批次 21/22 同源：**门禁自己也会制造假绿/假红**——判据必须在"目标环境"里自证。
   （本次的收获是：正因为我坚持在干净树里验证**已提交内容**，才没把"工作树绿、提交内容另有问题"
   的情况放过去；也正因如此，才需要把这条"假红"也钉下来，免得下次误杀。）

**症状（最阴的一种）**：组件里写 `colorOf(p, 'text.pillName')` —— 编译**零警告**、任何测试都不红，
但 `core/design.ets` 的 `colorOf()` 末尾是 `return p.transparent` ⇒ **文字/图标运行时不可见**。
表现成"这条 UI 怎么空白了"，而你会先去怀疑布局/渲染，不怀疑颜色。

**成因**：`docs/REDESIGN-INPUT-*.md` 与 `docs/mockups/*.html`（**设计散文**）用的是**带点记号**
（`text.pillName` / `status.danger` / `brand.primary` / `brand.mark.*`），而真 API 是：
- **文字/语义色**：`colorOf(p, role)`，role 是 **camelCase 不含点**（`textPrimary`/`dangerText`/`statusError`…）；
- **面/底**：`surfaceFillOf(p, role)`，role 才带点（`surface.*`），且应用 `SURFACE_*` 常量；
- **字型+配套字色**：`typeOf('type.x')`；**品牌色**走 `core/brand.ets: brandAccent()/brandOnAccent()`（不是 role）。
⇒ **文档写得越漂亮，实现越容易照抄记号**。这就是"知识与实现分叉"的又一例（同类见批次 23/24/26）。

**同类第二入口**：`elevationColorOf(p, level)` —— 未知档**静默落 `elev1`**（错阴影，不报错）。

**纪律（防复发）**：
1. 取色**只准**用真源角色表里的名字 / `SURFACE_*`、`TYPE_*`、`ELEV_*` 常量；⛔ 组件里不写 role 字面量之外的猜测；
2. 需要新角色 ⇒ 加进 `core/design.ets` 的角色表（⛔ 不在组件里写 hex）；
3. **机器判据**：`tools/lint/color-roles.sh`（`tools/gate.sh` **⑥b**，**硬红**）——
   合法集合从真源**抽取**（真源改则判据跟随）、只查字符串字面量、自带**零扫描判红**防白绿；
   mutation 自证：注入 `colorOf(p,'text.pillName')` / `elevationColorOf(p,'elev4')` **必红**，
   同副本不注入**必绿**（我实测过，落地时真树 32 处调用全合法 ⇒ 无存量欠账，可直接硬红）。
4. 记号↔真 API 的映射表：`docs/DESIGN-SYSTEM.md §12`。

## 批次 16b：孤儿检测脚本**第二次**自我修正 —— 这次的病是**误报**（2026-10-11）

- **现象**：`tools/gate.sh` 的 ⑤ 步一直报 2 个孤儿（`components/SettingsMdTheme.ets` 的 `SettingsMdSwatch` / `SettingsMdThemeGroup`），但**它们确实有消费者**。
- **根因**（旧脚本把"本文件"从消费者搜索里 `grep -v` 排除）：**只在同一文件内被其它 struct 使用的导出**永远找不到消费者 ⇒ 判成孤儿。实例：同文件的 `SettingsMdThemePicker` 在 `:197/:212/:242-244` 真实例化 `SettingsMdThemeGroup`/`SettingsMdSwatch`，而 picker 自己被 `SettingsAppearance.ets:165` 消费 ⇒ **整个文件本来就被编译**。
- **代价**：修前 **2/2 告警全是误报** ⇒ 检测器**零判别力**。而批次 16 修的是**漏报**（注释被当成消费者）。两次方向相反 ⇒ 说明**判据一直没定对**：不该看"某个 struct 有没有引用"，而该看"**这个文件有没有进依赖图**"。
- **修法**：判据改为**文件级可达性** —— 文件里**任一** export struct 有跨文件消费者 ⇒ 整个文件进依赖图 ⇒ 文件内所有 struct 都被类型检查。于是：
  ① 文件不可达 ⇒ 报「孤儿组件**文件**」（真·假绿风险；逐文件一条，不再逐 struct 刷屏）；
  ② 文件可达 + 导出有跨文件消费者 ⇒ 不报；
  ③ 文件可达 + 导出无跨文件消费者 ⇒ 报「死导出」**提示级**（已被类型检查，**不构成假绿**）。
  报告尾行给 `跨文件消费 / 仅文件内消费 / 无消费者` 三个计数（便于一眼判断豁免是否合理）。
- **自证**：`--self-test` 夹具扩到 5 类回归（注释提及⇒孤儿文件 / 无提及⇒孤儿文件 / 真消费者⇒不报 / **仅同文件消费⇒不报** / 零引用⇒只报死导出），并断言孤儿**文件**数 = 2、死导出 = 1；mutation 两条（把"仅同文件消费"归到"死导出" ⇒ 必红；让"文件不可达"分支永不触发 ⇒ 必红）；真跑本仓 `✅ 无孤儿组件（53 个：跨文件 51 / 仅文件内 2 / 无 0）` 与独立 Python 全量扫描**完全一致**（交叉验证）。
- **教训（跨批次，通用）**：**"有引用"不是判据，"进不进编译图"才是**。检测器自身必须有**双向**自证 —— 既要证明它会**红**真问题，也要证明它**不产假警报**；只测一个方向 = 把防线押在运气上。

## 批次 29：判据陷阱 —— 完整模块标识符会被从工具可见内容里**隐去**（直搜恒 0 命中 = 假绿）

- **现象**（`orb-ux` 实测）：想核实"全仓只有一个文件 import 了动效曲线库"这条铁律时，
  直接搜**完整模块标识符**（形如 `@ohos/xxx` 那一串）⇒ `grep -r` / 自带 Grep / `node indexOf` **全部 0 命中**，
  看起来像"没人 import" ⇒ 直接推出**铁律成立**的结论。**这是假绿**：真值其实在文件里。
- **根因**：该字面量会被**从工具可见的内容里隐去**（读取/搜索返回的文本中它被抹掉），
  与文件里是否真的存在无关。⚠️ 连带效应：**任何以该字面量为判据的扫描都恒 0**，
  且**看起来完全正常**（不报错、不给提示）。
- **正确判据**：改用**另一段可选支**作判据，例如搜 `import curves`（`grep -n "…\|import curves"` 之所以
  偶尔命中，正是因为走了这个可选支）。`orb-ux` 的新测试即按此写，并在注释里写明原因。
- **通用教训**：**当一条判据"完美地"给出你期望的结论时，先怀疑判据本身**（本仓已有多次同型事故：
  注释被当成消费者、把本文件排除出搜索、字符串 pin 未同步……）。**判据必须能同时证明"会红"和"不产假绿"**，
  且**零命中 ≠ 不存在** —— 换一个角度、换一种写法再搜一次。

## 批次 30：**别人的在途 `core/` 文件会让全队的脱机自证一起变红（假红）**

- **机制**：`tools/tests/run.sh` / `run-one.sh` 把 `core/**` 当**纯 TS 整体编译**（`core/` 是测试的**真实依赖**）
  ⇒ **只要 `core/` 里任何一个文件有 TS 错误，任何 `run-one.sh <任意测试>` 都会红** —— 包括**与你无关**的测试。
- **实测两次（我本人）**：① `core/annotations.ets`（他人**未跟踪**的在途文件）报
  `annotations.ts(399,7) TS2322` ⇒ 连 `run-one.sh pluginview` 都红；② `core/permodelcfg.ets` 同理 ⇒
  `brand-impl` 跑 `run-one.sh splash` 必红（它只能改用隔离 harness 才拿到 89 绿）。
- **⚠️ 最大的危险不是红，而是"红错原因"**：错误信息指向的是**别人的文件**，容易被误读成"我的改动坏了"，
  进而**去修不该修的东西**（或把断言删掉来"弄绿"）。**看到红先看错误落在哪个文件、那个文件是不是在途。**
- **正确做法**：
  1. 先 `git status --short` 看那个 `core/` 文件是不是**别人的在途文件**（未跟踪也算）；是 ⇒ **只上报，别修**；
  2. 自证改用**隔离 harness / 隔离 worktree**：`git worktree add --detach /tmp/wt HEAD` + 软链 `oh_modules`
     + 拷 `local.properties`，把你的文件拷进去，或**在隔离副本里排除那个在途文件**；
  3. 若你自己的新 `core/` 文件暂时**没有消费者**，**它照样会被全量编译** ⇒ **提交前必跑一次
     `run-one.sh <你的测试>`**（它就是"全量编译"的探针）。
- **通用教训（与批次 16b、29 同型）**：**"红了"不等于"你错了"**；**判据要能区分"谁的责任"**。
  全量编译型 harness 天生把**所有人的错误**汇总到你眼前 —— 必须先把"错误归属"查清再动手。

## 批次 31：**"程序滚动"绝不能挂在"任意 store 变化"上**（2026-10-11，用户亲报「这是严重bug」）

- **现象**：点消息里（尤其**最后一个迭代**）的工具 pill ⇒ 列表**自动滚到最下方**，刚点的那颗 pill 被顶出视口。
- **根因**（`pages/Index.ets:syncFrom()`）：只要 `followBottom`（"用户**愿意**跟随新内容"的**意图**）为真，
  就**无条件** `scrollEdge(Edge.Bottom)`。而点 pill ⇒ `toggleTool` ⇒ 异步 `fetchIterationDetail`
  ⇒ store 变更（该行 `rev` 自增）⇒ 走进 `syncFrom` ⇒ 程序滚动。
  **致命点**：`followBottom` 是"用户意图"，它**区分不了**
  ①"尾部真的长出新内容"（该滚）与 ②"用户在**原地**展开了一张卡片"（绝不能滚）—— 两者都会改行指纹。
- **为什么"上一版已修"还犯**：上一版只把开关从"位置快照"改成"用户意图"（`core/listfollow.nextFollowBottom`），
  那只修了"用户往上滚之后还被拽回底部"；对"用户**就停在底部、自己点开一个东西**"这条路径**无效**。
  ⇒ **修 P0 时必问："还有哪条路径能命中同一个 `if`？"**（本例：展开/收起/选中/浮层开关**全都能**）。
- **修法**（判据下沉纯函数，可脱机单测）：`core/listfollow.shouldAutoScroll(followBottom, contentGrew, nowMs, suppressUntilMs)`
  —— 三条**同时**成立才允许程序滚动：① 用户意图跟随；② 本帧**尾部内容真的变了**（行指纹 `rowsFp` 变化）；
  ③ 不在"用户就地操作"抑制窗内（`FOLLOW_SUPPRESS_MS = 1200`，左闭右开）。
  `toggleTool` 进/出都置窗（**收起变矮同样不该移动视口**）。
- **判据**：`tools/tests/listfollow.test.ts`（34 断言，含反例"旧实现=滚 / 新判据=不滚"）；
  **mutation 自证**：`nowMs >= suppressUntilMs` 改成 `true`（去掉抑制窗）⇒ 3 条必红（实测 31/3）。
- **通用教训**：**别用"内容变了吗"当判据，要问"是谁让内容变的"** ——
  用户**自己发起**的就地变更（展开/折叠/选中）一律不得移动视口；只有**尾部增长**（流式新增/追加）才可以跟随。
  凡"任何状态变化都触发副作用"的写法都是同型地雷。

## 批次 32：**`@Builder` 体顶层不能写 `const`** —— 局部量要么**表达式传参**，要么搬进普通方法（2026-10-11，真编译实测）

- **现象**：为了消掉"同一个纯函数在一行里被算好多遍"的冗余，在 `@Builder` 体**最外层**加了两行局部量：
  ```ts
  @Builder
  PlainLine(ln: string, li: number) {
    const lineKind: number = classifyLine(ln);          // ← 293
    const lineFg: string = this.lineColor(lineKind);    // ← 294
    if (hasAnsi(ln)) { … }
  }
  ```
  脱机三条（`run.sh` / `lint` / `typecheck`）**全绿**，`hvigorw assembleHap` 直接失败：

  ```
  ERROR: 10905209 ArkTS Compiler Error
  Error Message: Only UI component syntax can be written here. At File: /Users/bobli/src/xbot-harmony/entry/src/main/ets/components/ToolPopover.ets:293:5
  Error Message: Only UI component syntax can be written here. At File: /Users/bobli/src/xbot-harmony/entry/src/main/ets/components/ToolPopover.ets:294:5
  ```

- **为什么**：`@Builder` 的方法体在 ArkTS 里是**"UI 组件语法位置"**（会被展开成组件树），
  **顶层只允许 UI 描述**；`const`/`let` 这类语句不属于 UI 语法 ⇒ 报 `10905209`。
  ⚠️ 这条**只**约束 `@Builder` **体顶层**——**普通私有方法里局部量完全合法**。
  ⛔ **别把"我在别处见过 builder 里写 `const`"当先例**：那种"先例"通常是
  **普通方法**（例：`components/MessageRow.ets:898-903` 的 `private popVM()`，紧邻一个 `@Builder`
  ⇒ 极易看错）或 `ForEach` 的 **item 闭包**（那是 lambda，不是 builder 体顶层）。

- **正确姿势（两个都合法，按需要选）**：
  1. **表达式传参**（本次采用，最小改动）：把"按行算一次"的结果从**调用点**作为参数传进来 ——
     ```ts
     // 调用点（`ForEach` 的 item 闭包，每行执行一次）
     this.PlainLine(ln, li, this.lineColor(classifyLine(ln)))
     // builder 只负责用参数
     @Builder PlainLine(ln: string, li: number, fg: string) { … .fontColor(fg) … }
     ```
     ⇒ 从"单行 `2×spanCount+1` 次"降到恒 **1 次**，且**不引入任何语句**。
  2. **搬进普通方法**：把计算放 `private xxxOf(...): T { … }`，builder 只调用它拿值。
     （若那个方法**每个 span 都要调**，就消不掉重复 ⇒ 优先选 1。）

- **判别法**：
  - 症状 = **脱机三条全绿、`hvigorw` 报 `10905209 Only UI component syntax can be written here`**
    ⇒ 先看报错行是不是 `@Builder`（或其 `@Builder` 内 `if/ForEach` 体）**顶层的语句**，而不是 UI 属性链。
  - ⛔ 机器判据只能抓"已知形态"（本波加的源头守护见下）；**这类错误的唯一可靠发现手段是
    `hvigorw assembleHap`** —— 又一次印证门禁 ④ 不可替代（同批次 13 / 21 / 22）。
  - 本波同时留下的守护：`tools/tests/msgflow_visual.test.ts` (⑤) 断言 `PlainLine` 调用点形态为
    `this.PlainLine(ln, li, this.lineColor(classifyLine(ln)))` 且全文件 `classifyLine(ln)` 仅 1 处
    （**计数须先剥注释**，否则注释里的同名串会虚增 ⇒ 假红，同批次 16 的教训）。

- **通用教训**：**ArkTS 的"合法位置"比"合法语法"更窄** —— 同一段 `const x = f(y);`
  在方法里合法、在 `@Builder` 顶层非法、在 `build()` 里也非法。
  写组件时先问"这一行是在**UI 描述位置**还是在**普通语句位置**"，再想怎么消冗余。


## 批次 33：三条"**脱机三条全绿也照样红/照样坏**"的新实例（2026-10-11，真门禁 ④ + 真机各抓一条）

### 33a. `core/*.ts`（纯 TS 端口）**不许 import `.ets`** —— 只有真门禁 ④ 抓得到
- 实例：`core/reasoningopen.ts:25` `import { HistoryIteration } from './types';`（`./types` 解析到 **`types.ets`**）
  ⇒ `hvigorw`：`10605999 ArkTS Compiler Error: Importing ArkTS files in JS and TS files is forbidden`。
- 为什么漏网：`core/*.ts` 被 `tools/tests/run.sh` 当**纯 TS** 编译（`tools/lint`、`typecheck` 也不碰 ArkTS 模块规则）
  ⇒ **离线三条全绿**，只有 `hvigorw assembleHap`（门禁 ④）报。
- 合法修法（二选一，都验过）：
  1. 本文件内 `export interface IterationLike { live?: boolean; iteration: number }` —— **最小结构契约**，
     消费方（`.ets`）传 `HistoryIteration` 天然满足，类型兼容性由 **ArkTS 编译在调用点**校验；
  2. 把类型搬到**纯 `.ts`**（如 `core/iterlike.ts`）供双端复用。
  ⛔ 别把有"同源语义"的纯函数（如 `liveIterationNo`：live/committed 两侧必须取**同一个**键）拆成"消费者各写一份"
  —— 那是本仓反复出事故的"判据与其消费端不同源"。
- **反方向**（早已在册）：`core/*.ets` 不许 import ArkUI/`@ohos.*` 全局类型（同样因为 run.sh 当纯 TS 编）。

### 33b. "**死消费**"类缺陷：函数/偏好**全仓 0 消费方** ⇒ 用户操作静默无效
| 实例 | 形态 | 后果 |
|---|---|---|
| 强调色 | `withAccent` 全仓仅 **1** 调用点（`Index.ets` 的 `pal()`），而 **40 组件/80 处走 `paletteOf`**（不认识强调色） | 除 Index 内联样式外**全站拿不到强调色**（用户选色看着"没生效"） |
| 通知 3 开关 | `applyNotifyPrefs` **0 调用点** | 用户关掉通知开关**完全不生效**（死开关） |
| 思考展开态 | `reasoningopen`（web `reasoningOpenState.ts` 逐字移植）—— **当时** 0 消费方（本行即该假绿的来历） | 当时"修了 live→commit 自动收起"是**假的**（门禁却全绿）。✅ **后续已真接线**（`cba24ad`：`LiveTailView:491` / `MessageRow:725` 造键 + `ThinkingLine:107/153` 读写 store；gate ⑧ 实测 91/91 全消费；`tools/tests/reasoning_wiring.test.ts` **钉调用点计数**） |
- **形态断言铁律**：源码形态断言必须钉 **调用点计数**（`grep -c` 数量），**别钉"方法体存在"**
  —— 第一版判据就是因此**假绿**。
- 改这类"判据/偏好/存储"函数前：先 `grep -rn <name>` **数消费点**；0 或 1 ⇒ 先怀疑"没人用"。

### 33c. 开屏 **T0 不跟应用主题**（真机实测 + SDK 证据）
- SDK：`startWindowColorModeType` 枚举只有 `{FOLLOW_SYSTEM, FOLLOW_APPLICATION}`、**默认 FOLLOW_SYSTEM**
  （`~/ohos-cli/command-line-tools/sdk/default/openharmony/toolchains/modulecheck/startWindow.json:75-84`）；
  我们已填 `FOLLOW_APPLICATION`（`base/profile/startWindow.json`）但**真机无效**。
- 资源：`base`/`dark` 的 `element/color.json` **都是 `#0B0B0E`** ⇒ 系统开屏**恒深**。
  ⛔ 别把 `base` 改浅 —— 那会让**系统浅色 + 应用深色**的用户在冷启时白闪（`18db95a` 修过这一课）。
- T1（品牌开屏）旧实现把画布绑在**可变** `themeName` 上 ⇒ 设置加载后画布**由深翻白**（浅色用户可见闪烁，
  真机逐帧实测：f1–f3 `#0B0B0D` → f4 `#FFFFFF`），且标记恒品牌紫（与"标记随主题"的注释不符）。
  ⇒ **T1 恒深**（`core/splash.ets` 的 `splashBrandCanvas`，不接 `theme`），与 T0 同色、T0→T1 零跳色，
  之后由 T2 **渐隐**过渡到应用主题（渐隐≠硬切）。

### 33d. **可读性 ≠ 取色**：先量"不透明度"再怀疑调色板（用户亲报"白底看不清"）——**已定案并修复**
- 症状（用户原话"你看看你这白色看得清吗"）：白/浅色主题下**消息正文几乎看不见**，而同屏标题、UI 框架正常。
- **量化手法**（本波新造，`/tmp/pxhist.py` / `/tmp/pxbox.py` / `/tmp/xocr.sh`，可复用）：
  1. `sips -s format bmp` 转 BMP（⚠️ HarmonyOS 截图给的是 **32bpp、负高度=自上而下**，索引要按 `|h|` 算）；
  2. 全幅**颜色直方图** + **逐带（每 32 行）最暗色** ⇒ 立刻分清"字色"与"面/发丝线色"；
  3. 若实测字色与主题色板对不上（本案例正文 `#D4D4D6` 压 `#F2F2F2` = **1.32:1**），
     而 `compositeOver(textPrimary@α, 底)` 能反解出 α≈0.13 ⇒ **字被按不透明度压淡了**，不是取色调错。
  4. ⚠️ **别只看一张截图**：先 OCR 出"淡的到底是哪一块"（本案例：淡的是**表格块**、清晰的是**同一消息的正文块**），
     再去**同一条消息 / 同一主题**的 settled 现场量一次（案例实测 **21:1** ⇒ 直接排除取色 bug）。
- **定案根因**（`components/MessageRow.ets` 旧实现）：入场淡入把**静息态**写成 `.opacity(entered ? 1 : 0)`
  （`entered` 初始 `false`，`aboutToAppear` 里 `entered = !row.isLive`），再靠 `.onAppear` 里
  `animateTo(...)` 把它拉起来 ⇒ **可读性成了动画的函数**：`onAppear` 未触发 / 动画被后台冻结或
  20Hz 流式重建打断 ⇒ 正文停在低/零不透明度。web **没有**这个毛病 —— `web/src/index.css:683-714`
  用 CSS `@keyframes msgIn`（无 `forwards`），元素**自身** `opacity` 仍是 1 ⇒ 动画不跑就停在 1。
- **修法（可复用纪律）**：ArkUI 里 CSS keyframe 入场的等价物是**出现过渡**（`TransitionEffect`）——
  静息态 = 组件自身的属性；过渡只是"挂载那一下"的装饰，**不跑也不会把人留在起始态**。
  ⛔ **凡"用状态位 + `onAppear` 把不透明度从 0 拉起来"的写法，都同罪**（本仓另一处在
  `pages/Index.ets` 切会话的 `listAlpha = 0.001 → anim(→1)`，整列表可被同一机制留在近 0）。
- 判据：`core/msgentry.ets`（纯逻辑，静息不透明度恒 1）+ `tools/tests/msg_entry_contrast.test.ts`
  （5 套主题静息对比度 ≥4.5 + 源码契约 + mutation 自证"注入 `entered 永不置 true` 必红"）。
  ⛔ 修法不许靠"放宽对比度台账阈值"。
  ⚠️ 写这类**源码判据**必须**先剥注释** —— 第一版把注释里记录的旧写法当成违规 ⇒ 假红。

## 批次 34：**ArkTS 禁动态属性 ⇒ "用字符串表驱动静态 `@State`"没有合法形态**（2026-10-11）

**症状（不是崩溃，是"看起来该能做、实际做不了"）**：`core/sheets.ets` 把"面板 id → 它的 flag 名"
收成唯一真相表，并规定"**关闭分支只许引用 `closeFlagOf(id)`**"。但落地时发现：**引用不了**。

**根因**：`closeFlagOf(id)` 返回的是**字符串**（flag 的**名字**）；而"关闭面板"必须写**静态**成员
（`this.showDrawer = false`）。把运行期字符串变成静态写，只有**动态成员访问**一条路：
```ts
this[closeFlagOf('drawer')] = false;   // ⛔ ArkTS 禁动态属性 —— 不可用
```
本仓 `entry/src/main/ets` 全量 `grep "this\["` **零命中**（印证：从未、也不该出现）。

**结论 / 正确形态**：
- **能驱动静态 `@State` 的只能是字面名**（`this.showDrawer = false`）—— 编译期必须能静态解析；
- 因此"集中声明 flag 所有权"的价值**不能**由"页面引用表"实现，而应由
  **字符串表（唯一真相）+ 源码形态判据（oracle）** 组合实现：
  `tools/tests/sheets.test.ts` 扫 `pages/Index.ets` 每个浮层 `@Builder` 头部 X 的 flag，
  断言 `=== closeFlagOf(id)` ⇒ **写错 flag 当场变红**（2026-10-11 那次"设置面板点 X 关不掉"P0 的防线）。
- ⛔ 别再用 `switch (closeFlagOf(id)) { case 'showDrawer': this.showDrawer = false; … }` 绕 ——
  `case` 里还是同样的字面名，**等于没省**，只多一层噪声。
- **推广**：凡"想用一张表统一驱动 ArkUI 静态成员/`@State`"的需求，都撞这条 ——
  正解是"表 + **源码形态判据**（扫源码断言字面名与表一致）"，不是运行期查表。

### 34. 长按/右键菜单：**系统绘制 vs 自绘** —— 一条不可改的边界

| 路径 | 触发 | 外观 / 项集 | 可控性 |
|---|---|---|---|
| **系统文字选择菜单** | `.copyOption(CopyOptions.LocalDevice)`（`MessageRow:1146` / `ThinkingLine:171` / `ToolPopover:272…541` / `UserBubble:75` / `SyntheticCard:257,266` / `LlmErrorNotice:105` / `StatusSheet:85`） | 系统弹「复制 / 全选…」 | ⛔ **不可控**：外观与项集由系统绘制 —— **改不了、只能叠加**（别硬做；web 的 `copySelection` 在原生**由系统覆盖**） |
| **自绘上下文菜单** | `LongPressGesture` → 页面 `ctxKind` → `components/MenuSheets.ets` 的 `ContextSheet` | 走设计系统（`surface.overlay` + `hairlineOf` + `stateStyles` + `HIT_TARGET_MIN`） | ✅ 可控 |

- **菜单项集的判据不入组件**：走 `core/ctxmenu.ets`（纯逻辑、可脱机单测）—— 组件内 `ForEach(iterMenuItems(...))`，
  **不另写过滤**（判据与渲染同源）。
- **空项按设计过滤**（对齐 web `MessageActions.tsx:298-301`）：服务端会把"还是空壳的在飞迭代"记进
  `iteration_history` ⇒ 不做过滤就会恒出「复制该迭代正文」等项、点了只得"没有可复制的内容"。
  ⚠️ 用**过滤**而非 `dim` 置灰：web 就是**不产出**该项；`dim` 留给"已在顶部/底部"这类**必须可见**的解释性禁用。
- **文档/审计口径**：讲"长按菜单"时必须先注明走的是哪条路 —— 只有**自绘**那条能谈外观与项集对齐。

## 批次 35：`@Prop` 不能用于**函数类型**变量（我本人踩，2026-10-11）

- 症状：给子组件写 `@Prop onRetry: () => void = () => {};` ⇒
  `10905363 The V1 decorator '@Prop' cannot be applied to a Function-type variable 'onRetry'.(From Api Version 23)`
  （编译期报，**脱机三条/`lint`/`typecheck` 一个都抓不到** ⇒ 只有 ④ `assembleHap` 抓得到。）
- 正解：**回调用普通（无装饰器）成员** —— 父组件在**构造时注入**即可；回调**不需要响应式更新**，
  所以 `@Prop` 的语义本来也不适用。同理 `@Link`/`@ObjectLink` 也不该用在函数类型上。
- 附带（同一次踩出）：`this.store` 这类**可空成员**在回调里要显式 `if (this.store !== null)`，
  否则 `10605999 Object is possibly 'null'`。
- 纪律：凡"给子组件加回调" ⇒ 直接用普通成员；改完 **必跑 ④**（这正是"碰 ArkTS 侧必须自跑 `assembleHap`"的价值）。

## 批次 36：两条"**真因只有一对字符**、却报成语法灾难"的 ArkTS 陷阱（2026-10-11，我本人踩，`Index.ets` 收口时）

### 36a. ⛔ **JSDoc/块注释里不能再写完整的 `/* … */`**（嵌套块注释）—— 症状是**级联假错**

- **我怎么踩的**：给一段已删的死码写"原文留痕"，在 `/** … */` 里写了
  `` * `if (…) { /* 只有注释 */ }` `` —— 内层那个 **`*/` 把外层块注释提前闭合**，
  **余下的注释文本变成游离代码**。
- **症状（极具误导性）**：与真因**毫无关系**的一串报错 ——
  ```
  Rollup Error: Unexpected token (Note that you need plugins to import files that are not JavaScript)
  Cannot find name 'starred'. Did you mean 'isStarred'?
  Private "#" identifiers are not supported (arkts-no-private-identifiers)   ← 指向模板串里的 `#`（如 `${id}#${k}`）
  "delete" operator is not supported (arkts-no-delete)                        ← 指向 AppStorage.delete(...)
  ```
  ⇒ 看着像"整个文件语法崩了"，其实**真因只有一个多余的 `*/`**：注释提前闭合后，解析器从错误处重新找语句，
  把后面的**模板字面量 `${s.chat_id}#…`** 当成 `#` 私有标识符、把方法调用 `delete(...)` 当成 `delete` 算子。
- **定位手法（关键，别对着级联报错瞎改）**：
  1. 先 `cp entry/src/main/ets/pages/Index.ets /tmp/Index.ets.mine`（**备份自己的版本**，⛔ 别用 `git checkout` 碰未提交改动）；
  2. 把 **HEAD 版**放回去跑一次 `assembleHap` ⇒ **HEAD 过、我的不过** = 真因在我；
  3. **`diff` + 括号计数**：只统计"我新增/替换的行"的 `{}` 净差（净差 0 ≠ 没问题 —— **块注释提前闭合会让"注释里的 `}`"被算成代码**，我当时正是靠"净差 +1"起疑）；
  4. 最后 `grep -n '{\s*/\*' <file>` 一搜即中。
- **纪律**：注释里要描述 C 风格块注释时，⛔ **不要写出完整的 `/* … */`** —— 写 `… 分支体只有注释 …`、
  用行注释 `//`，或把星号隔开（如 `/\* … \*/`）。

### 36b. ⛔ **全局 `declare namespace` 的东西不要 import**（`focusControl` / `AppStorage` / `Curve` 一类）

- **我怎么踩的**：`import { focusControl } from '@kit.ArkUI';` ⇒
  `Module '"@kit.ArkUI"' has no exported member 'focusControl'`
  （另报 `'focusControl' is not exported from Kit '@kit.ArkUI'`）。
- **为什么**：`focusControl.requestFocus(value: string): boolean` 定义在
  `sdk/.../component/common.d.ts` 的 **`declare namespace focusControl`** ⇒ 是**全局**的（与 `AppStorage`、
  `Curve`、`HitTestMode` 同款）⇒ **直接用，不 import**。
  ⚠️ 查 API 时只看"**声明在哪个 d.ts**"不够，要看它是 `declare namespace`（全局）还是
  `declare function` 在一个 **module** 里（需 import）；`@kit.*` 只是**聚合 kit**，不包含这些全局命名空间。
- **附带**：同一次还漏了 `import { PENDING_COMMAND_KEY, … } from '../core/command';`
  ⇒ `Cannot find name 'PENDING_COMMAND_KEY'`（这类**忘 import 自有模块**的错，只有 ④ `assembleHap` 抓得到，
  脱机三条 / `lint` / `typecheck` 全绿）。

## 批次 29（2026-10-11，主 agent）：⚠️ **共享工作树里的"提交竞态" —— 别人的 `--only <pathspec>` 会卷走你未提交的改动**

- **症状**：我在 `ToolPopover.ets` 改了一处（`clip(true)` + `maxWidth:'100%'`），**尚未提交**；
  另一条线（`contrast-ux`）随后 `git commit -o -F - -- <它自己的文件清单>` —— 但它的 pathspec **也包含了
  同一个 `ToolPopover.ets`** ⇒ 我的两行改动**被它一起提交**了。
- **表现**：`git show --stat <我的 sha>` 里**看不到**那个文件（我提交时它已无 diff）⇒ 看起来"我的修复丢了"，
  但工作树/HEAD 核实 `clip(true)` 计数确实 **+1** ⇒ **内容无损、归属错**。
- **根因**：`git commit --only <pathspec>` 提交的是**该路径的当前工作树内容**（不是"我的那份 diff"）——
  路径上任何人**未提交**的改动都会被一起带走。
- **规则**：
  1. **改完立刻提交**（别让改动在工作树里"悬着"等下一件事做完）；
  2. 提交前 `git diff --stat -- <你要提交的路径>` 复核"**将要提交的内容 == 我的改动**"；
  3. ⛔ **不要把不属于你的文件加进 pathspec**（哪怕它"顺手也需要"）；
  4. 发现被别人卷走 ⇒ **不要 revert**（内容是对的）；在回报里注明"归属错、内容已入库"，并核 `git show HEAD:<file> | grep <符号>` 两侧。

### 批次 29b：⚠️ 同族的第二形态 —— **`git checkout -- <pathspec>` 会吃掉"别人未提交"的改动**

- **本波连踩三次**（同一个根因族）：
  1. `tokens-ux` 用 `git checkout` 还原自己的坏提交 ⇒ **吃掉自己未提交的其它改动**；
  2. `chat-surface-ux` 用 `git checkout` 还原共享判据文件 ⇒ 差点覆盖别人刚同步的台账；
  3. **`docs/WEB-PARITY.md` 的 §2.14 整节（12 行）被删除**：该节是 `tokens-ux` **已提交**过的记档，
     工作树里却出现"未提交的删除"；属主确认**不是它干的**、也**没有后续结论取代它** ⇒ 只能是
     某条线的 `git checkout -- docs/**`（或 `-- .`）**连带恢复**造成的假删除；已 `checkout` 复位。
- **规则**：
  1. ⛔ **禁用宽 pathspec 的 `git checkout`/`git restore`**（`-- .`、`-- docs/**`、`-- '*.ets'`…）——
     共享工作树里它们会**静默吃掉别人未提交的改动**（包括**删除**）。
  2. 要还原**只列你确切知道的文件**：`git checkout -- <file1> <file2>`；
  3. 还原前 `git status --short` 确认**这些文件只属于你**；
  4. ⛔ 与其"先改后 checkout 还原"，不如**改前就 `cp` 一份带时间戳的快照**（本波已定的纪律）。

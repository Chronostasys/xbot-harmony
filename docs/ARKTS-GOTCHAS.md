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

## 13. 自动"跟随到底部"必须由「用户是否在底部」门控

**现象**：流式输出时用户往上滚想读工具/思考详情，界面**立刻把他拽回底部** —— 感知为"根本没法用"。

**机制**：`syncFrom()` 在**每次 store 变更**时被调用（流式期间 = 每个 SSE 事件一次），而它里面
**无条件**执行 `listScroller.scrollEdge(Edge.Bottom)` ⇒ 任何滚动位置都被反复重置。

**修法**：`@State atBottom`，由 `List.onScrollIndex` 维护（判据：最后可见项的**列表项下标**是否等于末项下标），
只在 `atBottom === true` 时跟随；**切会话时强制置 true**（用户预期"看到最新"）。

**两个必须注意的点**：

1. `onScrollIndex` 给的是**列表项**下标，而列表项数 **≠ rows.length**（头部可能多一项"加载更早消息"、
   尾部可能多一项 busy 指示器）⇒ 必须用显式 `listItemCount(hasMore, loadingMore, rowsLen, busy)` 计算末项下标。
2. 该 helper 必须是**模块级函数**（ArkUI 的 struct 不是普通类，静态成员在真机上是 `undefined`）。

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

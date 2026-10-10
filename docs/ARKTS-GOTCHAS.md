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

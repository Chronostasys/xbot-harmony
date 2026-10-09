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

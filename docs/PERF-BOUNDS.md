# 每帧成本上界（PERF-BOUNDS）—— 形式化成本模型与证明

> 用户硬约束（2026-10-20 原话）：「**保证任何情况性能开销有界，无论历史多长开销都和
> iter 数量无关**」「任何情况下都不能卡顿」，补充：「不能破坏正确性和线性一致性」。
>
> 本文定义成本模型 → 逐项给出上界 → 指出**唯一允许随规模增长的一次性开销** →
> 列出被测试钉死的不变量（每条都有 mutation 自证）。
>
> 结论先给：**稳态（流式/滚动）每帧成本与迭代块数 N 无关（O(1)）**；
> 打开会话/换会话那一下必须**构造 O(N) 个节点**（一次性，线性，不可避免）；
> 状态机侧每事件成本与 N 无关、与历史行数 R 同阶（实测 R=500 ⇒ 24 µs/事件）。

---

## 1. 成本模型（定义）

| 符号 | 含义 | 典型量级 |
|---|---|---|
| `N` | **单个 turn 的迭代块数**（`mergeToolRuns` 后的块数） | 1 – 340（真实会话实测；可到 600+） |
| `R` | 行数（user/assistant 行 + legacy 段） | 10 – 1000+ |
| `E` | 一次 SSE 事件（stream delta / iteration commit / session 状态） | 20 – 60 次/秒 |
| `D` | 一次**投递**（页面把在飞内容写进持有者） | ≤ 10 次/秒（100 ms 节流） |
| `K` | 一次打字机拍 | 20 次/秒（50 ms） |
| `T_frame` | 一次**组件重建**的成本 | 目标 ≤ 4 ms |

「每帧」= 一次会造成**界面重绘**的动作：`E`（若它会驱动 UI）、`D`、`K`。
「稳态」= 流式进行中 / 用户滚动中。

**判据（成本上界）**

```
T_frame(N) ≤ C₀            （C₀ 与 N 无关的常数）
T_event(N, R) ≤ C₁ + C₂·R  （与 N 无关；R 是"行数"，不是迭代数）
T_open(N)   ≤ C₃ + C₄·N    （一次性，仅发生在打开/切换会话那一下）
每秒 CPU ≈ D·T_frame + K·T_frame + E·T_event ≤ 常数（与 N 无关）
```

`T_open` 是**允许**随 N 线性增长的唯一项：要显示 N 个块，第一帧必须构造 N 个节点
（web 同样如此：DOM 全部创建，靠 `content-visibility` 只跳过绘制）。它发生在
**切会话/刷新**那一下，不是稳态每帧。

---

## 2. 状态机侧：`T_event` 与 N 无关（**实测**）

`bash tools/perf/lib_build.sh` + 临时规模基准（`reduce` + `deriveRows` + `applyRow`，每档 200–300 次取均值）：

| N（块） | R（行/turn） | reduce (ms) | derive (ms) | applyRow (ms) | 合计 (ms) |
|---|---|---|---|---|---|
| 1 | 1 | 0.0015 | 0.0022 | 0.0005 | 0.0014 |
| 10 | 1 | 0.0005 | 0.0009 | 0.0001 | 0.0009 |
| 50 | 1 | 0.0004 | 0.0010 | 0.0001 | 0.0009 |
| 108 | 1 | 0.0003 | 0.0005 | 0.0001 | 0.0008 |
| 340 | 1 | 0.0007 | 0.0028 | 0.0001 | 0.0010 |
| 600 | 1 | 0.0013 | 0.0016 | 0.0001 | 0.0017 |
| 1 | 100 | 0.0037 | 0.0118 | 0.0089 | 0.0135 |
| 340 | 500 | 0.0148 | 0.0235 | 0.0091 | 0.0243 |

**读法**：纵向（N 从 1 → 600，R=1）总成本在 **0.8–1.7 µs** 之间抖（噪声量级），
**不随 N 增长**；横向（R 从 1 → 500）线性增长（约 25 µs/事件）。
即：`T_event = O(R)`，**与 N 无关**（≈1 万次/秒的事件预算都够）。

依据（为什么与 N 无关）：
- `reduce.ts` 的 stream/结构化帧是**字段级合并**，`iterations` 数组**跨帧对象恒等**；
- `deriveRows` 对每个 Turn 用 `WeakMap` 记忆化（未改的 turn 直接复用上一帧的 `Row`）；
- `applyRow` 的 live 分支：`convertedBlocksMemo`（按源数组恒等）+ `mergeToolRuns`（按入参恒等）
  都命中 ⇒ 每帧 **0 分配、0 次 O(N) 遍历**。

---

## 3. UI 侧：`T_frame` 与 N 无关（**结构保证**）

### 3.1 三类高频写入，各自的订阅者

| 高频数据 | 载体 | 订阅者 | 变更频率 |
|---|---|---|---|
| 在飞正文/思考/工具 | `ChatRow.liveTail`（`@Observed LiveTailState`） | `LiveTailView`（`@ObjectLink tail`） | 每次投递 `D` |
| 已完成块列表 | `ChatRow.iterBlocks`（`@Observed IterBlocks`） | `IterBlocksView`（`@ObjectLink iters`） | **每次迭代提交**（≤ 1 次/N） |
| 打字机进度（`vis`） | `LiveTailView` 自己的 `@State` | 该组件 | 每拍 `K` |

**页面 `@State` 不参与高频路径**：页面只在**结构**变化时写 `rows`（`store.rowsGen`
整数比较），在飞内容与非结构内容变化一律经 `@Observed` 对象直达订阅组件。

### 3.2 上界推导

设一次组件重建的成本 = 该组件 `build()` 里被执行的节点/表达式数。

- **页面 rebuild**：只在结构变化（行增删/换序/切会话/主题/浮层开关）时发生。
  流式期 `store.rowsGen` 不变 ⇒ **`D` 与 `E` 都不触发页面 rebuild**。
  ⇒ 流式期页面 `build()` 执行次数 = O(1)（只在回合边界）。
- **`MessageRowView` rebuild**：由 `@ObjectLink row` 的字段写入驱动（`applyRow` 每事件写
  `content/iterations/liveRevision`）。其 `build()` 体里**没有**按块遍历的 `ForEach`
  （块列表已搬进 `IterBlocksView`），只有常数个 `@Builder` 调用
  ⇒ `T_frame(MessageRowView) = O(1)`（与 N 无关）。
- **`IterBlocksView` rebuild**：只由 `IterBlocks.blocks/compactions/rev` 替换驱动。
  `applyRow → syncIterBlocks` 用**引用比较**决定是否赋值（`holder.blocks !== merged`），
  而 `mergeToolRuns` / `completedBlocks` / `convertedBlocksMemo` 都按**源数组恒等**记忆化
  ⇒ 流式帧里 `blocks` **引用不变** ⇒ 该组件**零重建** ⇒ 它内部那个
  `ForEach(全部 N 块)` **一次都不重跑**。
  ⇒ `T_frame(IterBlocksView) = 0`（流式期）。
- **`LiveTailView` rebuild**：只渲染在飞的那一块（正文 Markdown + 思考行 + 工具 pill），
  与 N 无关；Markdown 解析走 `parseMarkdownCached`（按原文记忆化 + 追加型文本增量复用尾部）。
  ⇒ `T_frame(LiveTailView) = O(Δ文本)`，与 N 无关。

**合起来**：流式期每秒的界面成本 ≈ `D × O(Δ) + K × O(Δ)`，与 N 无关。
滚动期更少：滚动/触摸时页面**不写任何高频 `@State`**（`syncLiveTail` 顶部早退）。

### 3.3 边界（会变贵、但不含 N 项）

| 边界 | 成本 | 为什么可接受 |
|---|---|---|
| 打开/切到 340 块的长 turn | `O(N)` 一次性构造 | 与 web 一致（DOM 全建）；只在切换那一下 |
| 单个块正文 274 KB | Markdown 解析 3.8–10.4 ms / 块 | 与 N 无关；由 `mdCache`（2 MB LRU）+ 追加型增量解析兜住 |
| 主题切换 | 每行一次重建（`themeGen++`） | 低频用户动作 |
| 历史行增删 | `O(R)` diff | 与 N 无关 |
| 打字机长文本（>2000 码点） | 直接全量显示（停表） | 逐字解析整段会更贵；这是刻意的取舍，判据在 `LiveTailView` |

---

## 4. 被钉死的不变量（每条都有 mutation）

| # | 不变量 | 判据 | mutation（必红） |
|---|---|---|---|
| I1 | `mergeToolRuns` 的记忆化表**必须真的写** | `perf_frame_bounded_wiring §A`（`mergedRunsMemo.set(` 计数 = 1） | 删除 `set` 调用 |
| I2 | 块列表持有者**只在引用变化时**替换 | `perf_frame_bounded §A`（N=0…600：流式帧替换数 = 0） | `holder.blocks !== merged` 改成无条件赋值 |
| I3 | 迭代提交必须替换块列表（不复用陈旧） | `perf_frame_bounded §B` | 去掉 `syncIterBlocks` 的 live 分支 |
| I4 | 行组件**不得**自己遍历全部块 | `perf_frame_bounded_wiring §C`（`shownIters(`/`mergedBlocks(` 计数 = 0） | 恢复 `ForEach(this.shownIters(), …)` |
| I5 | 高频内容必须走 `@ObjectLink` 持有者（不是 `@Prop` 字符串） | `…wiring §D/§E` | `@ObjectLink` 改 `@Prop` |
| I6 | 流式期不得按"内容变了"重投 `@State rows`（页面结构判据必须 O(1) 整数） | `…wiring §F` | `contentGrew` 改回 `this.busy \|\| …` |

### 2.1 单点实测（`bash tools/perf/bench_core.sh`，min-of-N，340 块）

| 指标 | 值 | 读法 |
|---|---|---|
| `mergeToolRuns_340_us`（**未缓存内核**） | **0.900 µs/次** | 这是"如果每帧真合并一次"的成本 |
| `mergeToolRuns_cached_340_us`（生产路径，命中） | **0.008 µs/次** | 修好后同一块列表**命中记忆化** ⇒ 每帧近似 0 |
| `completedBlocks_340_us` | 0.054 µs/次 | 已完成块过滤（按源数组恒等缓存） |

⇒ 渲染路径稳态（块未变）里，O(N) 的合并/过滤都是 **≈0**；只有**块真的变了**（迭代提交）
才会付一次 0.9 µs —— 每迭代一次，不是每帧。

**2026-10-20 修的真根因（I1）**：`mergeToolRuns` 的 memo 只有 `get` 没有 `set`
⇒ 每次渲染都真的重跑 O(N) 合并，并且**每次都新建合并块对象、把 `rev` 全局自增**
⇒ 内层 `ForEach` 的 key 逐帧变化 ⇒ 整块子树逐帧销毁重建。
症状正是用户报的「某些情况极卡、切会话或重启（N 归零）后消失」——
**迭代越多越卡**，且与"历史多长"无关（只与那个 turn 的迭代数有关）。

---

## 5. 「任何情况都不卡顿」的**诚实边界**

可以形式化保证的：稳态每帧成本与 N 无关（§2、§3）。
**不能**承诺的：绝对没有任何一帧超过 16.7 ms。仍可能超过预算的**有界**情形：

1. 打开 340 块的长 turn：一次性 `O(N)` 节点构造（web 同样）；
2. 单块正文是 274 KB 的巨型文档：单次解析 4–10 ms（有 `mdCache` 兜）；
3. 系统侧 GC/调度抖动、后台回前台时的一次性权威重载（`resumeResync`，已把行重建挂起、只 rebuild 一次）。

这三项的**共同特征**：与 N 线性或常数、**不随迭代数增长而累积**、且**不是每帧**发生。
若出现"越用越卡 / 越流越卡"，按 I1–I6 的判据查 —— 它们就是为此存在的。

# 性能预算与护栏（PERF-BUDGET）

> 用户要求「**性能也要非常好 / 超级丝滑**」，而接下来要做**大重构**。
> 本文 = ①现状量化基线（每条都有**可复现命令 + 数字**）②重构后**不许越过**的预算表
> ③把预算变成可执行判据的 `tools/perf/guard.sh`（超了**就红**）。
>
> **纪律（最容易被破的三条）**
> 1. ⛔ **不要为了变绿去调大阈值**。阈值只能来自"实测基线 × 余量"，改动必须写进 §5。
> 2. 微基准取 **min-of-N**（并**跑两遍取最小**）：本机宿主同时被多条线占用时，
>    同一指标跨 run 实测可差 **10×**（`paletteOf` 0.007→0.067µs / `surfacesOf` 1.66→5.72µs）。
>    ⇒ 护栏抓的是**数量级/结构性退化**（O(N²)、多算一遍、缓存被拆、多一个常驻定时器），
>    **不是**抓 ±30% 的抖动。看到 ❌ 先跑第二遍再下结论。
> 3. **重构每个阶段（每次合并前）都跑**：`bash tools/perf/guard.sh`。

---

## 0. 三分钟上手

```bash
# ① 性能护栏（静态 + 微基准；约 1–2 分钟，含 core 编译）
bash tools/perf/guard.sh
bash tools/perf/guard.sh --static      # 只静态（秒级，无编译）
bash tools/perf/guard.sh --self-test   # 自检：证明阈值机制**能红**

# ② 单项复现
bash tools/perf/bench_core.sh          # 打印全部 METRIC（离线，不碰设备）
TARGET=127.0.0.1:5555 bash tools/perf/render_scale.sh   # 真机：当前屏渲染规模（只读 dump）
TARGET=127.0.0.1:5555 bash tools/perf/coldstart.sh 25   # 冷启动（**被动**监听，不 force-stop）
python3 tools/perf/row_scale.py /tmp/ui.json            # 逐行：块数 / 节点数
XBOT_PERF_BASE=… XBOT_PERF_USER=… XBOT_PERF_PASS=… \
  node tools/perf/blocks_model.mjs                      # 真实服务端只读：单行块数规模
```

| 脚本 | 作用 | 是否碰设备 |
|---|---|---|
| `tools/perf/guard.sh` | **护栏**：静态计数 + 微基准 vs 阈值，超了红 | 否 |
| `tools/perf/lib_build.sh` | 把 `core/**` 编成可 node 跑的 JS（口径同 `tools/tests/run.sh`） | 否 |
| `tools/perf/bench_core.sh` / `bench_core.ts` | 20 条核心微基准，输出 `METRIC name=value unit` | 否 |
| `tools/perf/render_scale.sh` + `row_scale.py` | 真机布局树节点数 / 逐行块数（**只读 dump**） | 是（只读） |
| `tools/perf/coldstart.sh` | 冷启动 `onCreate→loadContent`（被动监听 hilog） | 是（只读） |
| `tools/perf/blocks_model.mjs` | 真实服务端只读：单行块数 / 窗口化后对比 | 网络只读 |

---

## 1. 基线（现状，2026-10-11）

### 1.1 冷启动
```bash
TARGET=127.0.0.1:5555 bash tools/perf/coldstart.sh 25
```
```
样本 1: onCreate=10-13:12.189 → loadContent succeeded=10-13:13.503  ⇒ 1314 ms
（历史样本：09:24:35.224 → .392 ⇒ 168 ms）
```
- **替代指标**：真机**没有**应用侧的"首次绘制/首帧"日志 ⇒ 只能量
  `EntryAbility.onCreate → loadContent succeeded`（= 启动骨架，**不含首帧绘制**）。
  要更准需要 App 内埋点（`Index.onAppear` 打一条 hilog）——**属重构期可选改进**，见 §3-补。
- ⚠️ **方差极大**（168 ms vs 1314 ms）：后者采于宿主同时跑别的线 `hvigorw` 时。
  ⇒ 判据取**两遍最小值**，且阈值只作数量级护栏（§2）。
- ⛔ 采它**绝不能** force-stop（用户在用）：脚本只被动等一次自然冷启动。

### 1.2 流式：每事件的合并与派生（离线可复现）
```bash
bash tools/perf/bench_core.sh | grep -E 'mergeTools|rowsFromHistory'
```
| 指标 | 基线 | 含义 |
|---|---|---|
| `mergeTools_8_us` | **0.48–1.2 µs/次** | 每事件把 8 枚工具的增量并进已有列表（`core/streammerge.ets:150`） |
| `rowsFromHistory_340_ms` | **0.04–0.10 ms/事件** | 一次完整事件：`history → reduce → deriveRows → applyRow`（340 块的行） |
- 结论：**每事件的状态机/派生侧很便宜**（≤0.1ms）。流式卡顿不在这一层。

### 1.3 每帧（每次 build）与块数成正比的固定开销
| 指标（340 块的行） | 基线 | 备注 |
|---|---|---|
| `completedBlocks_340_us` | **1.9–3.4 µs** | 过滤 `live` 块 |
| `mergeToolRuns_340_us` | **2.7–4.9 µs** | 跨迭代合并工具块（`MessageRow.itersFor()` 每次 build 调） |
| `blocksSignature_340_us` | **58–110 µs** ⚠️ | **最贵的 O(块数) 操作**（字符串拼接 ×块数）；`pages/Index.ets:4253` 每次 sync 调 **2 次** |
| `签名长度比 340/24` | **15.4×** | 线性度护栏（O(N²) 会顶到几十×） |

### 1.4 大文档 / Markdown（渲染路径里唯一与文本长度成正比的计算）
```bash
bash tools/perf/bench_core.sh | grep -E 'parseMarkdown|parseInline|mdCache|streamingGrowth'
```
| 指标 | 基线 | 换算 |
|---|---|---|
| `parseMarkdown_8k_us` | **75–208 µs/次** | 一块 8K 正文 |
| `parseMarkdown_274k_ms` | **3.8–10.4 ms/次** | 文档实测的最坏单块（274 KB）⇒ 单帧预算 16.7 ms 的 **23–62%** |
| `parseInline_us` | **2.6–6 µs/次** | 每个行内片段 |
| `mdCache_repeat_hits/misses` | **999 / 1 per 1000** | 同一文本重复解析必须全命中（缓存被拆 ⇒ ❌） |
| `streamingGrowth_120ticks_ms` | **3.5–68.8 ms/120 拍** | 每拍追加 40 字符（文本持续变形 ⇒ 键变 ⇒ **结构性不命中**，这是设计使然） |
- 计数口径（渲染规模）：单行 **≤16**块是**旧的**设计上限，**现已删除**——
  `components/MessageRow.ets:344` 明确"渲染**全部**迭代"。真实服务端实测最重单行 **340 块**
  （`chat_43C84E66B106`）/ **108 块**（`chat_AAB719716889`）。
- 真机每块节点成本（实测常数）：**5.7 节点/块**（`fix-todos` 那行 23 块 ⇒ dump 132 节点）。

### 1.5 渲染规模（真机，只读）
```bash
TARGET=127.0.0.1:5555 bash tools/perf/render_scale.sh
```
| 屏幕 | 节点总数 | ListItem |
|---|---|---|
| 空态（空会话） | **63** | 0 |
| 轻会话（30 行 / 0 迭代块） | **217** | 19 |
| 块多行（23 块占屏） | **198**（该行 132 ⇒ 占屏 **67%**） | 1 |
- 折算：单行 108 块 ≈ **616 节点**；340 块 ≈ **1938 节点**（**超单行预算 600 的 3.2×**）。
- 行级虚拟化（`LazyForEach`）**已生效**；**行内**不虚拟化 ⇒ 乘法项就在这里。

### 1.6 分配热点（"每帧对象构造数"）—— ⚠️ **2026-10-11 订正：三项"无记忆化"已落地**

```bash
grep -ro 'this.pal()'  entry/src/main/ets/components entry/src/main/ets/pages | wc -l   # 1078
grep -ro 'this.eff()'  entry/src/main/ets/components entry/src/main/ets/pages | wc -l   # 35
grep -roE 'anim(Fast|Base|Slow|Spring|MsgIn)\(\)' entry/src/main/ets/{components,pages} | wc -l  # 13
```

**订正（本表的旧值留着不动，便于看趋势；"现在"以 2026-10-11 实测为准）**

| 热点 | 旧基线 | **现在（实测）** | 落地 |
|---|---|---|---|
| `paletteOf()` | 0.01 µs（"无记忆化"） | **0.009 µs/次** | ✅ **已记忆化** `PALETTE_MEMO`（`core/theme.ets:385`，容量 64）— `0c0b2e3` |
| `effectsOf()` | 2.1–3.3 µs（比 pal 贵 ~250×） | **0.028 µs/次**（**快 ~100×**） | ✅ **已记忆化** `EFFECTS_MEMO`（`:634`）— `0c0b2e3` |
| `surfacesOf()` | 1.7–5.7 µs | **0.008 µs/次** | ✅ **已记忆化** `SURFACES_MEMO`（`:855`）— `0c0b2e3` |
| `anim*()` 每次新建 `ICurve` | "未记忆化" | **已记忆化**（`springCurveMemo` / `springMotionMemo`） | ✅ `components/anim.ets:38,80` — `e60d1f6` |
| `this.pal()` 调用点 | 891 | **1078**（护栏上限 1250，✅） | — |
| `this.eff()` 调用点 | 57 | **35**（上限 80，✅） | — |
| `anim*()` 调用点 | 14 | **13**（上限 20，✅） | — |
| 常驻定时器 | `setInterval` 4 / `setTimeout` 5 | **5 / 7**（上限 6 / 7，✅ 顶格） | ⚠️ `setTimeout` **已用满 7**（见 §2 第 18 条） |

> ⛔ **订正的原因**：本表原先三条"无记忆化"的结论已被两个 perf 提交推翻（`0c0b2e3` / `e60d1f6`）。
> 留着旧值是为了**看趋势**，但**别再据此派"给 effectsOf 加缓存"的活**——那已经做完了。
> ⇒ §3 末尾"同族但量级小"里 `effectsOf/surfacesOf` 与 `anim.ets` 两条**已销账**；
> 仍未销账的只剩 **`blocksSignature`**（`pages/Index.ets:4253` 每次 sync 调 2 次，基线 33–110 µs）。

| 热点 | 基线 | 说明 |
|---|---|---|
| `blocksSignature(340 块)` | **33.3 µs/次**（护栏上限 400 ✅） | **仍是最贵的 O(块数) 操作**；`pages/Index.ets:4253` 每次 sync 调 **2 次** ⇒ 单次 sync ≈ **67 µs**。⛔ 该文件属滚动行调度者，**不在 perf 线可改域** |

| 常驻定时器 | `setInterval` **4** 处 / `setTimeout` **5** 处 | `AssistantOrb.ets` 2 / `LiveTailView.ets` 3（20Hz 打字机）/ `SettingsDeveloper` 2 / `pages/Index.ets` 6 处（含 600ms 脉冲） |
- 真机 CPU（同一台模拟器，7s 窗口，`hidumper --cpuusage <pid>`）：
  **空态（无 live 行）0.05%** vs **流式中 4.4–4.7%**（该会话只有 30 行 / 0 块）
  ⇒ 这 4.7% 是**流式地板成本**，全来自定时器驱动的重绘。

### 1.7 TURNDROP 噪声（已修，留基线防回归）
- 现状（`1cfad7a`）：逐 turn `console.debug` + burst 结束**一条** warn 汇总；`turndropSeen` 去重。
- 判别测试：`tools/tests/turndrop.test.ts`（5 passed；含 3 段 mutation 说明）。
  **同一批空壳 turn 只产出 1 行 warn 汇总**，逐条降为 debug。

---

## 2. 预算表（重构后不许越过）

阈值由 `tools/perf/guard.sh` 执行；**上限 = 跨多次 run 的实测最大值 × ~3**。

| # | 指标 | 上限 | 类别 | 抓什么 |
|---|---|---|---|---|
| 1 | `parseMarkdown(274K)` | **≤ 50 ms/次** | 微基准 | 解析复杂度回归（O(len²)） |
| 2 | `parseMarkdown(8K)` | ≤ 900 µs/次 | 微基准 | 同上 |
| 3 | `parseInline` | ≤ 40 µs/次 | 微基准 | 行内解析回归 |
| 4 | `mdCache 重复解析未命中` | **≤ 1 / 1000**（命中 ≥999） | 微基准（硬） | **缓存被拆** |
| 5 | `blocksSignature(340 块)` | ≤ 400 µs/次 | 微基准 | O(N) 指纹退化成 O(N²)/多次遍历 |
| 6 | `mergeToolRuns(340 块)` | ≤ 25 µs/次 | 微基准 | 合并算法回归 |
| 7 | `completedBlocks(340 块)` | ≤ 15 µs/次 | 微基准 | 同上 |
| 8 | `签名长度比 340/24` | ≤ 25× | 线性度 | 指纹非线性 |
| 9 | `mergeToolRuns 耗时比 340/24` | ≤ 60× | 线性度 | 合并非线性 |
| 10 | `rowsFromHistory(340 块)` | ≤ 1 ms/事件 | 微基准 | 状态机+派生+映射整链回归 |
| 11 | `mergeTools(8 工具)` | ≤ 6 µs/事件 | 微基准 | 每事件工具合并回归 |
| 12 | `effectsOf` / `surfacesOf` | ≤ 12 / 20 µs | 微基准 | 调色板构造回归 |
| 13 | `paletteOf` | ≤ 0.5 µs | 微基准 | 同上 |
| 14 | `流式增长 120 拍` | ≤ 300 ms | 微基准 | 流式重解析回归 |
| 15 | `this.pal()` 调用点 | ≤ **1250** 处 | 静态（硬） | "每帧多算几百次调色板" |
| 16 | `this.eff()` 调用点 | ≤ 80 处 | 静态 | 同上（eff 比 pal 贵 250×） |
| 17 | `setInterval` 调用点 | ≤ **6** 处 | 静态（硬） | **又加一个常驻定时器** |
| 18 | `setTimeout` 调用点 | ≤ 7 处 | 静态 | 同上 |
| 19 | `anim*()` 调用点 | ≤ 20 处 | 静态 | 每次新建曲线对象 |
| 20 | `ForEach` 处数 | ≤ 107 处 | 静态（规模指示） | 列表规模失控 |
| 21 | core 外裸 `parseMarkdown/parseInline` | **= 0** | 静态（硬） | 渲染路径里做解析（已有 lint） |
| 22 | 行内块窗口：340 块行**渲染**块数 | **≤ 24** | 静态计数（硬） | **窗口被拆/上限被取消**（TOP1 回归） |
| 23 | 行内块窗口：340 块行隐藏块数 | **≥ 1** | 静态计数（硬） | 哨兵提示被删（= 静默丢内容的先兆） |
| 24 | 行内块窗口：340 块行估算节点 | ≤ 600 | 静态计数（硬） | `MSG_BLOCK_WINDOW` 被调大失控 |

**门禁怎么自动发现退化**：
- `bash tools/perf/guard.sh` —— 21 条逐条打 ✅/❌，任一条 ❌ ⇒ **退出码 1**。
- 建议接入方式（**待你拍板**，见 §6）：把 `guard.sh --static`（秒级、零抖动）挂进
  `tools/gate.sh` 作为第 ⑦ 步（警告级起步）；`guard.sh` 全量（含编译）留给"合并前自检"。

---

## 3. 最该优先修的 3 个性能问题（**先别改，交派单**）

### ① 单行迭代块**无上限** ⇒ 一行 340 块全部进渲染 —— ✅ **已修（`6ad8477`）**
> **落地记录**：`core/rowsview.ets`（`visibleBlocks`/`hiddenBlockCount`/`widenBlocks`/`MSG_BLOCK_WINDOW=24`
> ＋`estimatedNodes`）+ `components/MessageRow.ets`（`@State blockLimit` / `shownIters()` /
> `hiddenBlocks()` / `widen()` / **恒定高哨兵行**，`onVisibleAreaChange([0,0.5])` 可见即放宽）。
> 效果（确定性计数，已进护栏）：340 块行 ⇒ 渲染 **24** 块、隐藏 **316** 块（有可见哨兵
> 「更早的 316 个迭代块」）、估算节点 **1938 → 143**（−93%）。
> 护栏：`guard.sh` 第 22~24 条（硬计数）；测试 `tools/tests/rowsview.test.ts`（28 passed，
> mutation 6 failed）与 `row_block_scale.test.ts`（16 passed，**已自动转硬**）。
> **残余**：`live` 行**不裁**（流式期 `liveBlocks` 每事件整体替换，窗口滑动会与 `atBottom`
> 自动跟随打架 ⇒ 风险大于收益；长 turn 在 `text_final` 变 committed 后被窗口覆盖）。

- **file:line**：`components/MessageRow.ets:344`（`itersFor()` = `mergeToolRuns(completedBlocks(row))`，
  注释明说"渲染全部迭代"，原 16 块上限已删）/ `:513`（`ForEach(this.itersFor(), …)`）。
- **预估收益**：单行 340 块 → 24 块 ⇒ 估算节点 **1938 → 143**（**−93%**）；
  块多行实测**占屏节点 67%** ⇒ 长会话滚动/流式的 measure/layout 成本同比例下降。
  这是"长会话卡到没法用"的**主结构项**。
- **最小修法**：`visibleBlocks(blocks, w)` + `hiddenBlockCount(n, w)` + **恒定高哨兵行**
  （`onVisibleAreaChange([0,0.5])` 可见即 `w += 24`；**绝不做"点击展开"**，纪律见 `:445-447`）。
  三候选（C 分批+哨兵 / A 视口裁剪+高度占位 / B 行内 LazyForEach）的补丁级 diff
  与风险已在上一轮交付中给出，**B 因 `List` 必须定高而结构上否决**。
- **验收**：`row_scale.py` 该行 108 → **≤25 块**、`render_scale.sh` 节点 ≤ 基线−150；
  上滚哨兵可见后**锚点 y 不变**。

### ② 流式正文的 Markdown **全量重解析**（O(len)/次，缓存结构性帮不上）
- **file:line**：`components/MarkdownView.ets:134`（`ForEach(parseMarkdownCached(this.text), …)`）
  + `components/LiveTailView.ets` 的 `shownText()`（每拍/每事件文本都变 ⇒ **键变 ⇒ 必 miss**）。
- **预估收益**：`parseMarkdown(274K) = 3.8–10.4 ms/次`（单帧预算的 **23–62%**）；
  一个 50 KB 的流式回复约 0.7–1.9 ms/次 × 每事件（+ 打字机上屏节流）。掐掉重复解析的大部分 ⇒
  流式"打字机抖动/掉帧"直接改善。
- **最小修法**（两条，先做便宜的）：(a) **增量解析**：块级缓存 + 只解析"最后一段未闭合块"
  （文本 = 旧文本 + 增量，已完成块复用上一次结果）；(b) 保底：**距上次解析 ≥80 ms 才重解析**
  （打字机继续推进，只是 Markdown 树刷新更少）——(b) 约 10 行，收益立即可见。

### ③ 流式期**常驻定时器**：30fps Canvas 光球 + 20Hz 打字机（唯一实测到的 CPU 地板）
- **file:line**：`components/AssistantOrb.ets:415`（`setInterval(() => this.draw(), ms)`，
  `ORB_FPS=30`(:68) / `ORB_IDLE_FPS=12`(:70) / `intervalFor` 下限 8ms）+ `ST_THINKING`(:173)、
  `components/LiveTailView.ets:255`（20Hz）。
- **预估收益**：真机实测 **流式 4.4–4.7% CPU vs 空态 0.05%**（会话只有 30 行/0 块 ⇒ 这 4.7% 全是定时器成本）。
- **最小修法**：`thinking`/`secondary` 态降到 20fps（或复用已有 `ORB_IDLE_FPS=12`），
  只有 `tool` 态保留 30fps —— **1 行改动**（改 `ST_THINKING.fps`）。

> **同族但量级小（已量化，列为待办，不排 TOP3）**：
> · `blocksSignature`（341 块 **58–110 µs**，`Index.ets:4253` 每次 sync 调 **2 次**）——
>   最小修法：指纹改 O(1)（块数 + 总长 + 首末块标识）或按 `row.rev` 缓存。
> · `effectsOf/surfacesOf` **无记忆化**（2.1–5.7 µs，比 `paletteOf` 贵 250×）——
>   最小修法：按 theme 记忆化一张 Map（3 行）。**注意**：`paletteOf` 本身 0.01 µs，**不必**动。
> · `anim.ets` 的 5 个工厂每次调用新建 `ICurve`——同样 3 行记忆化。

---

## 4. 已知局限（诚实声明）

1. **冷启动只有替代指标**（`onCreate→loadContent`），不含首帧绘制；且方差极大（168 vs 1314 ms）。
   要真首帧需在 `Index` 埋一条 hilog——**属重构期可选改进**，不建议为本指标单独改代码。
2. **微基准是宿主机（node）成本，不是真机 JS 引擎成本**：绝对值不可直接搬到设备上；
   它的价值是**相对/线性度护栏**（抓 O(N²)、多算一遍、缓存被拆）。
   真机侧只靠 `render_scale.sh`（节点数）与 `hidumper --cpuusage`（CPU%）。
3. **布局树节点数 ≠ 真实 GPU/绘制成本**：它是"要 measure/layout 多少节点"的代理。
4. **`row_scale.py` 的"块数"是下界代理**：= 「思考 N 字」+ 工具 pill + SubAgent 树；
   纯正文块无机械特征 ⇒ 同一口径比较有效，绝对值会低估。
5. **设备是用户在用的那台**：只许**被动 dump**；`coldstart.sh` 刻意不 force-stop。
   故"块最多的那一行"的真机节点数需要**落地者**在目标会话上现场采（命令已给）。

---

## 5. 阈值变更记录

| 日期 | 指标 | 旧 → 新 | 理由 | 谁 |
|---|---|---|---|---|
| 2026-10-11 | 全部（首次建立） | — | 用**跨多次 run 的实测最大值 × ~3** 起阈值；sub-µs 指标跨 run 可差 10× ⇒ 只做数量级护栏 | perf 线 |
| 2026-10-11 | 第 22~24 条（行内块窗口） | 新增 | **不是放宽**：`6ad8477` 落地 TOP1 后**新增**的硬计数判据（渲染块数 ≤24 / 隐藏 ≥1 / 估算节点 ≤600），阈值 = 判据本身（确定性计数，无抖动） | perf 线 |

> 规则：任何上调都必须在**本表**写明"为什么不是代码退化"（附 `bench_core.sh` 两遍输出）。

---

## 6. 待指挥者拍板（接入方式）

1. `guard.sh --static` 挂进 `tools/gate.sh` 作为第 ⑦ 步（**警告级**起步，与"孤儿组件/判据单一性"并列）？
   —— 建议**挂**：秒级、零抖动、能抓"多一个常驻定时器/多几百次调色板"这类结构性退化。
2. `guard.sh` 全量（含 core 编译，约 1–2 分钟）作为**合并前自检**（不进 gate，避免与 ArkTS 真编译争锁）。
3. 阈值当前**偏松**（抓数量级）。若你希望更早发现 20% 级退化，可加"与上次 run 的比值"对比
   （需落一份历史 baseline 文件 —— 会引入"基线漂移"治理成本，建议重构稳定后再启用）。

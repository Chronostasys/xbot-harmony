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
grep -ro 'this\.pal()'  entry/src/main/ets/components entry/src/main/ets/pages | wc -l   # A 线 = 1246（成本线：未 memo 的真分配，上限 1250）
grep -roE 'this\.pal\(\)|this\.palOnce\(\)' entry/src/main/ets/components entry/src/main/ets/pages | wc -l  # B 线 = 1268（读取总量，含缓存命中，松界 1350；口径见 §1.7）
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
| A 线·色板**分配**次数 `this.pal()`（未 memo，成本线） | 891 | **1246**（上限 1250，✅；⛔ 只许减） | — |
| B 线·色板**读取**总量 `this.pal()` ∨ `this.palOnce()` | — | **1268**（松界 1350，✅；含缓存命中，非成本线） | — |
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

### 1.7 `palOnce()` —— 记忆化色板访问器（2026-10-12 · 目标④ D/E/F 收口）

`pages/Index.ets` 新增 `palOnce()`：**与 `pal()` 同值**，但按 `主题|强调色` 记忆化。

- 动机：`pal()` **未记忆化**（每次 `withAccent(base, …)` 重分配；只有 `paletteOf` 按主题 memo）；
  且 **`@Builder` 顶层不允许声明局部变量**（ArkTS `10905209`）⇒ 一个 builder 内无法"读一次、多处用"。
- 失效：键 = `主题|强调色`（`accentHex()`）⇒ 主题/强调色变即重算（**无陈旧色**；`Palette` 只在新构造时赋值，缓存对象不被原地改）。
- 判据：`tools/tests/parity_defer.test.ts` 的 **§G**（钉失效谓词的**两项键** + 5 条 mutation：断主题键 / 断强调色键 / 恒真 / 不返回缓存 / 抽空消费点）。

**⛔ 纪律**
- **新 UI 一律走 `palOnce()`，不要直接 `this.pal()`**（省重复分配，且不抬高下面的调用点计数）。
- ⛔ **不许**把 `pal()` 本体也记忆化 —— 本契约的意义正是"`pal()` 是唯一未记忆化的构造点，`palOnce()` 在它外面兜缓存"。

**守卫口径：拆两条**（`tools/perf/guard.sh`；⛔ 不许合并成一个数 —— 两者成本**差一个量级**）

- **A 线（成本线，只许减）** = `this.pal()` 直读。`pal()` **未记忆化**（每次 `withAccent` **重新分配**调色板）
  ⇒ 计"每帧真分配次数"。**上限 1250 不变**，现状 **1246**。
- **B 线（读取总量，松界/防失控）** = `this.pal()` ∨ `this.palOnce()`（**限定名** `this\.palOnce\(\)`，
  排除 `private palOnce(` 声明行）。含**缓存命中**（几乎免费）⇒ **不是成本线**；意义 = "读取点别无限膨胀"
  + "防把读取全迁到 `palOnce` ⇒ A 线退化成白绿"。上限 **1350**，现状 **1268**。
- ⛔ **合并成一个数会稀释真成本线**（新增廉价 `palOnce()` 会吃掉"贵读取"的预算空间）。

### 1.6b live 行「每帧工作量」—— ✅ **2026-10-11 落地：按源数组记忆化**

> 口径 = **计数**（每帧真转换/分配的块数），**不是墙钟** —— 理由同 `row_signature_cost.test.ts`
> （耗时只能真机测）。判据（可复跑）：`bash tools/tests/run-one.sh perf_live_frame`
> （13 passed；mutation ⇒ **exit 1**）。

| 指标（N=108 已完成块 = 真实最重单行） | 旧写法 | **现在** | 落地 |
|---|---|---|---|
| live 行每帧**重新转换**的已完成块 | **108**（+54 个 `ToolProgress` + 108 个 tools 数组） | **0** | ✅ `core/render.ets` `liveBlocksMemo`（WeakMap，按源数组**对象恒等**）— `§5` |
| live 行已完成块对象**跨帧复用** | 0/108（每帧全新对象） | **108/108** | 同上 |
| 该转换耗时（宿主机微基准，仅量级参考） | ≈2.9 µs/帧（`toHistoryIterations(108)`） | ≈0（命中） | 同上 |

- **为什么旧写法贵**（可离线证明，非推断）：流式帧是**字段级合并**（`core/reduce.ts` 的 `{ ...prev, … }`）
  ⇒ `LiveSnapshot.iterations` 跨帧是**同一数组对象**（判据 `perf_live_frame` **§A 直接断言**），
  而 `applyRow` 的 live 分支每帧都对它整份 `toHistoryIterations(...)` ⇒ 每帧 N+K 个对象分配，
  **随 turn 长度线性增长**（真实服务端单行可达 108+ 块，见 `docs/RENDER-LOAD-MEASUREMENT.md`）。
- **语义等价**（不是"为省调用改可见行为"）：`toHistoryIteration` 是源对象的**纯函数**；只按源数组
  **对象恒等**取缓存 ⇒ ① 输出逐字节不变（`perf_live_frame` **§D** 用 oracle `toHistoryIterations` 比对）；
  ② 换源数组（commit/fold）**必重算**（**§C**）。WeakMap 键 ⇒ 源数组 GC 时条目一并回收，
  **无容量上限 / 无泄漏**（与 `core/derive.ts` 的 `assistantRowByTurn`、`core/markdown.ets` 的 mdCache 同手法）。
- ⚠️ **仍未销账**（下一步，⛔ 别在没有恒等前提处直接套缓存）：
  · `blocksSignature`（`pages/Index.ets` 每次 sync 调 **2 次**）仍是最大单项（≈6.7 µs/次 @340 块）；
  · ~~`inFlightBlock` 每帧仍重建 `completedKeys`（O(已提交工具数)，≈1.8 µs/帧 @K=54）~~ ⇒ **已销账，见 §1.6c**。

### 1.6c 流式/打字机纯逻辑热路径（✅ 2026-10-11 落地：免分配计数/裁剪 + 键集合 O(D×K)→O(D+K)）

> 口径 = `tools/perf/bench_core.sh` 的 `runeCount_8k_us` / `clipRunes_8k_half_us` /
> `inFlightBlock_K54_us` / `inFlightBlock_K54D64_us`（**本波新增度量**，min-of-N；判据
> `bash tools/tests/run-one.sh stream_perf_equiv`）。数值取跨多次 run 的**中位数**（宿主多线并发，方差大）。

| 指标 | 优化前 | **优化后** | 说明 |
|---|---|---|---|
| `runeCount(8K)` | **50.4–76.6 µs**（中位 67.9） | **17.7–34.1 µs**（中位 29.6） | `toRunes(text).length` → **纯计数不建数组**（`core/typewriter.ets`） |
| `clipRunes(8K, n=半)` | **73.5–107.1 µs**（中位 89.4） | **9.9–19.2 µs**（中位 14.9） | 建整码点数组 + 逐码点拼串 → **扫第 n 码点边界 + 单次 `substring`** |
| `inFlightBlock(K=54,D=8)` | 2.63 µs | 2.44 µs（**噪声内，无变化**） | D 小 ⇒ 旧的 O(K) 建表项本就占主导 |
| `inFlightBlock(K=54,D=64)` | **16.2 µs** | **6.9 µs** | `completedKeys` 由 `Array.indexOf` → **`Set.has`**（去掉 O(在飞数×已提交键数) 项） |

- **改动点**（均"同样输入 ⇒ 同样输出"，判据 `stream_perf_equiv` 用独立 oracle 逐字段比）：
  · `core/typewriter.ets`：`runeCount` / `clipRunes` 改**免分配**（新增 `runeWidthAt` 与 `toRunes` 同判据）；
  · `core/render.ets` `inFlightBlock`：已提交工具键容器 `string[]`+`indexOf` → `Set<string>`+`has`。
- **为什么是热路径**：`components/LiveTailView.ets` 每拍渲染调 `clipRunes`；`components/MessageRow.ets`
  每次 build 对每个块的思考文本调 `runeCount`（「思考 N 字」）；live 行**每帧**走 `inFlightBlock`。
- ⛔ **本地记录**：新增度量是**新增**（不是放宽任何门槛）；`guard.sh` 的既有阈值**一个没动**。
  诚实声明：D=8（常见档）无可见收益 —— Set 的收益只在**大在飞数**（一次派发很多工具）才显。
- **未做（诚实）**：`blocksSignature`（`+=` 拼串）试过 `Array.join` ⇒ **反而慢**（18.8→29.4 µs @340 块），**否决**；
  `parseMarkdown` 的每行正则（274K ≈1.65 ms 里的大头）与 `replace(/\s+$/,'')` 手写化，因**风险 > 收益**
  （`\s` 语义含全角空格等，改错=静默渲染差异）**未做**。

### 1.6d 第三轮（✅ 2026-10-11）：指纹记忆化 + `assignKeys` 尾部重编号（O(n²)→O(n)）+ `parseInline` 早退

> ⚠️ **口径**：宿主被多条线并发占用时 `bench_core` 跨 run 可差 3–5×（本轮实测 `streamingGrowth` 1.3–4.9 ms）。
> 故下表用**同进程交错 A/B**（OLD 复刻 vs NEW 生产，同一进程内交替跑 5 轮取中位）——不受跨 run 负载漂移影响。
> 判据：`bash tools/tests/run-one.sh stream_perf_equiv`（§7/§8/§9；37 passed）。

| 靶子 | OLD | **NEW** | 倍率 | 手法 |
|---|---|---|---|---|
| `blocksSignature` 调用点形态（340 块） | 89.4 µs | **42.1 µs** | **2.12×** | 按**源数组对象恒等**记忆化（`WeakMap`）：稳定侧命中，省一次 O(块数) 拼串 |
| `streamingGrowth` 120 拍 | 2674 µs | **1815 µs** | **1.47×** | `parseMarkdownCached` 增量路径：`assignKeys` 只对**尾部**重编号（头部 key 上一拍已按同一(内容,下标)写入 ⇒ 逐字不变） |
| `parseInline`（纯文本，无标记字符） | 0.723 µs | **0.193 µs** | **3.7×** | 廉价前置判据：无 `` ` ! [ * _ ~ `` ⇒ 直接产单 span，跳过 O(len) 分支扫描 |

- **靶子1 三候选结论**（⛔ 以实测为准）：
  · **(a) 廉价前置短路** ⇒ **不可行**：短路必须发生在**调用者**（`pages/Index.ets` 的
    `blocksSignature(liveBlocks) !== blocksSignature(blocks)`），而该文件非本线可改域；
  · **(b) 整数 hash** ⇒ **否决**：现有字符串编码在 `(迭代号, 正文长, 思考长, 工具数)` 元组序列上
    是**单射**的；`h*31+c` 折叠到 32/53-bit 后**存在碰撞** ⇒ **判别力严格下降**（不满足"判别力不降"）。
    （注：现有指纹**本就**只编码**长度**、不编码内容 ⇒ 对"仅空白差异"（`"a b"` vs `"ab"`）**早已无法区分**
    —— 这不是 hash 引入的新问题；但 hash 会新引入"长度元组不同而指纹相同"的碰撞 ⇒ 仍否决。）
  · **(c) 对象身份记忆化** ⇒ **采用**（2.12×；沿用 `core/render.ets` 的 `liveBlocksMemo` 同款 WeakMap 手法）。
- **靶子2 `streamingGrowth` 分部件取证**（复刻 `parseMarkdownCached` 打分）：`assignKeys(全体)` 占 **38.4%**（1033µs/120 拍）、
  `parseMarkdown(尾部)` 32.6%（固有）、`Map.get(增长键)` 16.7%（字符串哈希，固有）、`Map.set` 4.1%。
  ⇒ 唯一可安全去掉的是 `assignKeys(全体)` ⇒ 改为只重编号尾部（154µs）⇒ −33%（同进程实测 1.47×）。
- **新增度量**（⛔ 仅新增，**未动任何既有阈值**）：`blocksSignature_callerpat_340_us` · `parseInline_plain_us`。
  ⚠️ `blocksSignature_340_us` 的 bench **输入改为未缓存内核** `buildBlocksSignature`（导出自 `core/streammerge.ets`）
  —— 因为 `blocksSignature` 现已按对象恒等记忆化，对**同一数组**重复调用会命中缓存（≈0）；改用内核才能量到**真 build**，
  且避免 `.slice()` 每轮新数组的 GC 噪声。
- **行为不变**：判据 `stream_perf_equiv` §7（30 步增长下"增量 key/start == 全量"逐块）、§8（`blocksSignature`
  == 独立 oracle；换内容必换值）、§9（纯文本单 span；空串仍 `[]`；含标记字符仍走完整解析）。
  mutation 自证 3 处（`assignKeys` 局部下标 / `blocksSignature` 内核破坏 / `parseInline` 早退恒真 ⇒ 均红）；
  反向自证：增量路径改回 `assignKeys(blocks,0)` ⇒ **仍全绿**（证明"尾部重编号 ≡ 全量重编号"）。

### 1.6e 第四轮（✅ 2026-10-11）：`blocksSignature` **双命中** + `parseInline` 含标记快路径

> ⚠️ **口径**：同进程 A/B（OLD 复刻 vs NEW 生产/双 bundle，交替 ≥5 轮取中位），不受跨 run 负载漂移影响。
> 判据：`bash tools/tests/run-one.sh stream_perf_equiv`（三节 §10/§11；**46 passed**；2 处 mutation ⇒ 红，见下）。

| 靶子 | OLD | **NEW** | 倍率 | 手法 |
|---|---|---|---|---|
| live 行已完成块**门控**（/帧，K=24 块） | 3.31 µs | **1.42 µs** | **2.33×** | `core/render.ets` 新增 `liveBlocksSignature(row)`：指纹按**派生行源数组对象恒等**（`WeakMap`）记忆化；页面 `syncLiveTail` 只比一次 O(1) |
| 同上（K=108） | 8.36 µs | **2.01 µs** | **4.15×** | 同上（`completedBlocks` O(N) 过滤 + `buildBlocksSignature` O(N) 拼串 ⇒ 每帧 0） |
| 同上（K=340，真实最重单行） | 21.67 µs | **3.47 µs** | **6.25×** | 同上 |
| `parseInline`（含标记，短） | 0.840 µs | **0.225 µs** | **3.74×** | `core/markdown.ets`：**charCode 快路径**（只 6 个字符可能开分支）+ **run-slice**（普通文本段一次 `substring`，替代逐字符拼串） |
| `parseInline`（含标记 2560 字符） | 33.19 µs | **9.35 µs** | **3.55×** | 同上 |
| `parseInline`（含标记 8192 字符） | 108.2 µs | **26.7 µs** | **4.05×** | 同上 |

- **靶子1（双命中）三候选结论**（⛔ 以实测为准）：
  · **(a) 让 `completedBlocks` 返回共享数组** ⇒ **否决**：live 行的已完成块每帧经 `liveIterations` 的
    `.slice()`（＋可能 push 在飞块）**必然是新数组** ⇒ 按源数组恒等对 `completedBlocks` 记忆化**命中不了**；
    且把**可变数组**共享出去有 alias 风险（消费点 `MessageRow.itersFor`/页面 `liveBlocks`）。
  · **(b) 廉价前置判据（块数 + 末块身份）** ⇒ **否决**：`blocksSignature` 现编码**每块**的
    `(迭代号, 正文长, 思考长, 工具数)`；只判"块数 + 末块"会在**中间块内容变化**（同号权威覆盖、
    已提交迭代内工具完成）时**漏更新** ⇒ 判别力下降。
  · **(c) 按源数组对象恒等记忆化 + 页面侧 O(1) 比** ⇒ **采用**。**为什么能命中**：流式帧的
    **派生行** `r.iterations` 是**同一数组对象**（`perf_live_frame.test.ts` §A 直接断言）⇒ 指纹值
    （不可变字符串）可安全复用。**输出不变**由 §10 用独立 oracle `blocksSignature(completedBlocks(row))`
    逐帧逐字节比对；**不陈旧**由 §10 的 commit 帧断言守护。
- **靶子5（上轮未测）实测结论 —— 诚实**：本波量清三处，**均非纯逻辑瓶颈**：
  · **live 帧路径**：`applyRow` 的 live 分支每帧 ≈**1.06 µs** @108 已完成块（新度量 `liveRowFrame_108_us`）；
    门控（旧写法）才是每帧的大头（21.67 µs @340）—— 已由靶子1 解决。
  · **长列表 / 滚动**：行级 diff（`core/rowdiff`）+ 数据源 `applyRows` 是 **O(行数)** 的 `id#rev` 键比较
    （行数 = 窗口 `rowLimit`，非块数）⇒ µs–十µs 级；**真正的滚动成本在 ArkUI 侧**（measure/layout/绘制），
    离线测不到，且 `components/**` 本轮不在可改域。⇒ **未改**。
  · **首帧到可交互**：唯一真源是**设备侧** `coldstart.sh`（被动只读）与 App 内埋点；纯逻辑侧改不了它。⇒ **未改**。
- **新增度量**（⛔ 仅新增，**未动任何既有阈值**）：`liveRowGate_108_us`（O(1) 门控，实测 ≈0.006 µs）·
  `liveRowFrame_108_us` · `parseInline_marked_2560_us`；三者各配一条**新增** `guard.sh` 门槛
  （2 / 15 / 30 µs）。⚠️ `blocksSignature_callerpat_340_us` 是 **round3** 的调用点形态（round4 起生产
  **已不再用它**，留作趋势；生产门控 = `liveRowGate_108_us`）。
- **mutation 自证（本波 2 处，均实测红）**：
  · `core/render.ets` 把行指纹改成 `buildBlocksSignature(row.iterations)`（**误含在飞块**）⇒ §10 两条红；
  · `core/markdown.ets` 粗体判据改成"`*`/`_` 任意相邻对"（**把 `*_` 当偶对**）⇒ §11 语料 + 随机各红。
- ⚠️ **判据自身的坑（本波踩到并修正，务必记住）**：§11 最初的"随机语料"用**确定性线性公式**
  （`marks[(t*13+k*5)%n]`）生成 ⇒ 相邻字符恒隔固定步长 ⇒ **永不产生相邻标记对**（如 `*_`）⇒
  上面那条 mutation **逃逸**（假绿）。⇒ 改为**真 LCG 随机**并补 `*_*_`/`_*_*` 等语料后 mutation 才红。
  **教训：随机语料的"随机"本身必须可判别**（否则覆盖面是假的）。

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
| 15a | **A 线**：色板**分配**次数 `this.pal()`（未 memo） | ≤ **1250** 处（⛔ 成本线，只许减；现状 1246） | 静态（硬） | "每帧多算几百次调色板" |
| 15b | **B 线**：色板**读取**总量 `this.pal()` ∨ `this.palOnce()` | ≤ **1350** 处（松界/防失控；现状 1268） | 静态 | 读取点无限膨胀（口径见 §1.7） |
| 16 | `this.eff()` 调用点 | ≤ 80 处 | 静态 | 同上（eff 比 pal 贵 250×） |
| 17 | `setInterval` 调用点 | ≤ **6** 处 | 静态（硬） | **又加一个常驻定时器** |
| 18 | `setTimeout` 调用点 | ≤ 7 处 | 静态 | 同上 |
| 19 | `anim*()` 调用点 | ≤ 20 处 | 静态 | 每次新建曲线对象 |
| 20 | `ForEach` 处数 | ≤ **112** 处（规模指示；107→111 Git 面板 →112 行菜单并入纯函数项集模式） | 静态（规模指示） | 列表规模失控 |
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
| 2026-10-11 | live 行每帧已完成块转换（**新增判据，非门禁阈值**） | — | 目标⑤落地：`core/render.ets` `liveBlocksMemo`（按源数组对象恒等）把 live 行每帧对**未变化**已完成块的转换数 **N → 0**（N=108）。判据 `tools/tests/perf_live_frame.test.ts`（13 passed；mutation ⇒ exit 1）。**不是放宽任何门槛**：`guard.sh`/`bench_core` 的既有指标（含 `blocksSignature_340_us`）一律未动 | perf 线（目标⑤） |
| 2026-10-11 | `runeCount`/`clipRunes`/`inFlightBlock`（**新增度量，阈值一个没动**） | — | 目标⑤第二轮：`core/typewriter.ets` 的 `runeCount`/`clipRunes` 改**免分配**（−2.3×/−6× @8K）；`core/render.ets` `inFlightBlock` 的已提交键容器 `Array.indexOf`→`Set.has`（大在飞数档 16.2→6.9 µs）。**仅新增** `bench_core` 度量行（`runeCount_8k_us`/`clipRunes_8k_half_us`/`inFlightBlock_K54_us`/`inFlightBlock_K54D64_us`），**未动任何既有阈值**。判据 `tools/tests/stream_perf_equiv.test.ts`（26 passed；3 处 mutation ⇒ exit 1）。详见 §1.6c | perf 线（目标⑤） |
| 2026-10-11 | `blocksSignature` 记忆化 + `assignKeys` 尾部重编号 + `parseInline` 早退（**新增度量，阈值一个没动**） | — | 目标⑤第三轮：`core/streammerge.ets` `blocksSignature` 按**源数组对象恒等**记忆化（调用点形态 89.4→42.1 µs，2.12×）；`core/markdown.ets` `parseMarkdownCached` 增量路径 `assignKeys` **只重编号尾部**（`streamingGrowth` 2674→1815 µs，1.47×；去掉 O(块数)/拍 的 O(n²) 项）+ `parseInline` 纯文本早退（0.723→0.193 µs，3.7×）。**仅新增** 度量行（`blocksSignature_callerpat_340_us`/`parseInline_plain_us`）；`blocksSignature_340_us` 输入改为**未缓存内核** `buildBlocksSignature`（否则记忆化会让它测到 ≈0）—— **未动任何既有阈值**。判据 `stream_perf_equiv` §7/§8/§9（37 passed；3 mutation ⇒ exit 1；含反向自证"尾部重编号 ≡ 全量重编号"）。详见 §1.6d | perf 线（目标⑤） |
| 2026-10-11 | `liveBlocksSignature` 双命中 + `parseInline` charCode/run-slice（**新增 3 度量 + 3 新门槛，既有阈值一个没动**） | — | 目标⑤第四轮：`core/render.ets` 新增 `liveBlocksSignature(row)`（按**派生行源数组对象恒等**记忆化）+ `pages/Index.ets` 门控改 O(1) ⇒ live 行已完成块门控 **2.33×/4.15×/6.25×**（K=24/108/340，同进程 A/B）；`core/markdown.ets` `parseInline` **charCode 快路径 + run-slice** ⇒ 含标记文本 **3.74×/3.55×/4.05×**（短/2560/8192，同进程**双 bundle** A/B）。**新增**度量行 `liveRowGate_108_us`(≈0.006) / `liveRowFrame_108_us`(≈1.06) / `parseInline_marked_2560_us`(≈7.6)，并**新增** `guard.sh` 门槛 2 / 15 / 30 µs（**既有阈值一行未改**）。判据 `stream_perf_equiv` §10/§11（46 passed；2 mutation ⇒ 红）。详见 §1.6e | perf 线（目标⑤） |

> 规则：任何上调都必须在**本表**写明"为什么不是代码退化"（附 `bench_core.sh` 两遍输出）。

---

## 6. 待指挥者拍板（接入方式）

1. `guard.sh --static` 挂进 `tools/gate.sh` 作为第 ⑦ 步（**警告级**起步，与"孤儿组件/判据单一性"并列）？
   —— 建议**挂**：秒级、零抖动、能抓"多一个常驻定时器/多几百次调色板"这类结构性退化。
2. `guard.sh` 全量（含 core 编译，约 1–2 分钟）作为**合并前自检**（不进 gate，避免与 ArkTS 真编译争锁）。
3. 阈值当前**偏松**（抓数量级）。若你希望更早发现 20% 级退化，可加"与上次 run 的比值"对比
   （需落一份历史 baseline 文件 —— 会引入"基线漂移"治理成本，建议重构稳定后再启用）。

---

## 7. 已排除的嫌疑人（**否定结论** · 判据在仓内，可复跑）

> 为什么单列：`appfreeze THREAD_BLOCK_6S`（2026-10-11 11:36:28，主线程 6s 无响应）取证时，
> `rowSignature` / `applyRow` / `rebuildRows` 一度是头号嫌疑（采样快照里有它的帧）。
> **实测否掉了** —— 记在这里，省下一个人再去改它（改它只增风险）。

**链路与量级**（`pushEvents store.ets:211 → rebuildRows :230 → deriveRows derive.ts:269 → applyRow render.ets:321`）

| 每次 SSE 事件做什么 | 与什么成正比 |
|---|---|
| 事件批逐个 `reduce` | 批大小 |
| `deriveRows(state)` 全量重派生 + `sortedTurns` | turn 数 T（+ T log T 排序） |
| 逐行 `rowSignature`（**O(1)**：`.length` 聚合 + `subAgentSig`） | 行数 R |
| 逐行 `applyRow` —— **早退**（`render.ets:323`）⇒ 仅**变化行**才拷 iterations/subAgents | 变化行数 |

**实测**（`tools/tests/row_signature_cost.test.ts`，消费生产 `deriveRows`/`applyRow`，复刻 `rebuildRows` 循环）：
`T4/R4 → T64/R64` 五档，**一条 live 流式事件的变化行数恒为 `1,1,1,1,1`**（不随 R 增长）；
重复同内容帧 **0**。
⇒ **O(R) 签名比较 + O(1) 行拷贝**（早退 + `deriveRows` 的对象恒等 memo）。

**mutation 自证**：拿掉 `applyRow` 早退 ⇒ 变化行数 = `R+1`（`5,9,17,33,65`）⇒ 判据必红；还原 ⇒ 绿。

⛔ 结论：**`rowSignature` 这条链不是 6s 的主因**（它"热"但不"贵"）。
6s 拥堵的实际落点见下一节（`drawerGroups` 的 O(n²)）—— 修那里。

> 6s 主因的取证（另派单）：`faultlog/appfreeze-...xbot-*.log` 的 4 个主线程快照里，
> **3/4 停在 ArkUI build 阶段**（`FlushVsync → FlushDirtyNodeUpdate → … → drawerGroups
> → sessionById`），而 `Index.ets:4066 sessionById()` 是**线性扫描 `this.sessions`**、
> `drawerGroups()`（`:4086`）组内逐项调用它 ⇒ **O(n²)**，且每帧再付一次
> `starredIds()`=`parseStarred(...)`（JSON 解析）。`/api/session-tree` 实测
> `next_offset: 675` ⇒ n≈**675** ⇒ 单次 `drawerGroups()` ≈45 万次比较。
> ⚠️ 该文件是 `pages/Index.ets`（指挥者域）⇒ 只给配方，不在本线改。

---

## 7. 真机动态指标采集（方法 + 判读，2026-10-11）

> 为什么需要这一章：`tools/perf/guard.sh --static` 是**静态**预算（调用点数/曲线/role），
> `render_scale.sh` 是**节点规模**代理，`bench_core.sh` 是**离线纯逻辑**。三者都量不到
> "**真机滚动卡不卡 / 冷启多慢 / 内存涨不涨**" ⇒ 本章固化那三把**只读**的尺子。

### 7.1 一览（命令 → 口径 → 判读）

| 脚本 | 确切命令 | 量什么 | 判读 |
|---|---|---|---|
| `tools/perf/scroll_fps.sh` | `TARGET=127.0.0.1:5555 bash tools/perf/scroll_fps.sh 8` | 设备自带 `SP_daemon` 采 **FPS / jitters / 屏幕刷新率**（`-f`） | app FPS 应贴近屏幕刷新率；**jitters 应 ≈0**；出现个位数 FPS = 主线程被长任务阻塞 |
| 同上（内存/CPU） | `... scroll_fps.sh 5 --memory` | 进程内存 + 总内存（`-r`）+ 进程 CPU load（`-c`） | 滚动前后内存**不应单调上涨**（泄漏）；CPU load 应随滚动结束回落 |
| 同上（代滚） | `... scroll_fps.sh 8 --drive` | 脚本用 `uitest uiInput swipe` **代滚** ⚠️ 会动屏幕 | 同人工滚判读；⛔ 先确认没人在验收 |
| `tools/perf/coldstart.sh` | `TARGET=127.0.0.1:5555 bash tools/perf/coldstart.sh 60` | **被动**监听 hilog：`EntryAbility onCreate`(t1) → `loadContent succeeded`(t2) | `t2 − t1` = **启动骨架耗时**（不含首帧绘制，见 §1 局限）；只量**自然发生**的冷启 ⇒ 脚本**绝不** force-stop/重装 |
| `tools/perf/render_scale.sh` | `TARGET=127.0.0.1:5555 bash tools/perf/render_scale.sh` | `uitest dumpLayout` 的**布局节点数** | 配合 §1.5 的阈值看静息规模；只读（不点/不滑/不切） |

⛔ **三脚本共同纪律**：默认**被动、只读**；采集窗口内**不并发**别的设备操作（否则数字里混进别人的界面）；
⛔ 不为了好看调阈值 —— 它们只**输出数字**，不做判断（阈值在 `guard.sh` 与本章 §2/§5）。

### 7.2 抽屉分组基线订正 —— ⚠️ **旧值已因 `be32606` 失效**

- **旧基线（作废）**：`drawerGroups()` 对**每个分组项**调一次 `sessionById`（**线性扫描**）⇒ 复杂度 **O(n²)**；
  另每帧调 `starredIds()` = `parseStarred(settingOf(...))` **两次**（两次 JSON 解析）、重名消歧 **O(g²)**。
  ⇒ 会话数 n 大时抽屉每帧重建**超线性**变慢（faultlog 里的 **6s 主线程阻塞**嫌疑点）。
- **订正后（`be32606`）**：`sessionIndex()` O(n) 建一次 `chat_id→行` 索引 + 索引回查 O(1)（合计 **O(n+g)**）；
  `starred` **每帧一次**；消歧改 `titleCount` 计数 **O(g)**。**行为逐字不变**（判据 `tools/tests/drawer_hotpath.test.ts`，14 断言）。
- ⛔ **任何"抽屉耗时随 n² 增长"的旧观测/旧阈值一律作废**；复测请用 §7.1 的 `scroll_fps.sh`，
  在**同一 n** 下对比"开抽屉 + 滚动"的 FPS/jitters（设备排队中，首轮实测待补）。

## 2026-10-13 复测（15z4，目标「性能也要非常好」）

| 指标 | 本次实测 | 预算 | 结论 |
|---|---|---|---|
| 冷启 `onCreate→loadContent` | **303 / 319 ms**（两次自然样本） | —（历史 168 ms / 劣样本 1314 ms） | ✅ 健康，无需优化 |
| `parseMarkdown(274K)` | **1.505 ms/次** | ≤ 50 ms | ✅ 单帧预算(16.7ms)的 9% |
| `rowsFromHistory(340 块)` | **0.034 ms/事件** | ≤ 1 ms | ✅ |
| `流式增长 120 拍` | **0.938 ms** | ≤ 300 ms | ✅ |

复测命令：`bash tools/perf/bench_core.sh`；冷启 `TARGET=127.0.0.1:5555 bash tools/perf/coldstart.sh 18`
（被动监听；本次为单条命令内"起监听 → `aa force-stop` → `aa start`"以免前/后台竞态）。

⚠️ 口径：宿主并发占用时方差极大（文档已记 168↔1314 ms）⇒ 只作数量级判据。

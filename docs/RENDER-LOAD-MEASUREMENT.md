# 渲染规模实测（真实服务端，只读）

> 目的：**没有真机**时也能回答"App 到底要渲染多少东西"。这是"卡到没法用"这类问题的量化依据。
> 工具：`tools/tests/live_dump.test.ts`（**只调** `/api/auth/login`、`/api/history`、`/api/regions`，**绝不写数据**）

## 用法

```bash
XBOT_E2E_BASE=http://127.0.0.1:16000 \
XBOT_E2E_USER=adm XBOT_E2E_PASS=*** \
XBOT_E2E_CHAT=chat_XXXX \
  tools/tests/run.sh            # 或直接: node tools/tests/.out/js/live_dump.test.js
```

输出：`rows / 迭代总数 / 单行最多迭代 / App 实际渲染块数（每行 ≤16） / 正文字节 / regions_before`。

## 实测结果（2026-10-09，生产实例）

| 会话 | rows | 迭代总数 | **单行最多迭代** | regions_before | 修复前渲染块 | 修复后渲染块 |
|---|---|---|---|---|---|---|
| `chat_AAB719716889` | 6 | 112 | **108** | 489 | 112 | **20** |
| `chat_A642B1525E87` | 4 | 103 | **100** | 177 | 103 | **19** |
| `web-4` | 4 | 20 | 16 | 0 | 20 | 20 |
| `chat_BD94FA4BB469` | 8 | 19 | 10 | 0 | 19 | 19 |
| `chat_D3D036023DB7` | 8 | 16 | 4 | 0 | 16 | 16 |

- 单次 `/api/history`（limit=30）响应 ≈ **364 KB**；`/api/regions` 一段 ≈ **195 KB / 112 迭代**
- `regions_before` 可达 **489** ⇒ 服务端**折叠**生效（更早区域需按需取回，见 `docs/ARKTS-GOTCHAS.md` 与 `store.loadEarlierRegions`）
- 迭代号是**大绝对号**（如 `iteration: 565`），不是 1..N；字段无 null（但**不要**假设——Go 的 nil slice 会 marshal 成 `null`）

## 结论（驱动了哪些修复）

1. **单个 turn 上百个迭代块是常态**（实测 100/108）⇒ 必须**限制每行渲染块数**（现 `MAX_ITER_VISIBLE=16` + 点击展开）。
2. 单行正文/思考可达 **274 KB** ⇒ 不能一次性全渲染（Markdown 解析 + Span 树成本高）。
3. 服务端**已经折叠**历史（`HistoryRegionWindow=100`）⇒ 客户端必须实现 `regions_before` 的按需取回，否则"看不到更早的迭代"（能力缺口）。
4. **ForEach key 必须唯一且随内容变化**（`ChatRow.rev`）—— 上百块 × 频繁更新时，key 复用错位会直接表现为"整个渲染错乱"。

## 追加：真正的"卡到没法用"机制 —— 渲染路径里解析 × 行 key 抖动（2026-10-09 修复）

### 机制（三步相乘）

1. `MarkdownView.build()` 在**渲染路径里**调 `parseMarkdown(this.text)` / `parseInline(...)`
   —— 每次组件渲染都重新解析（ArkUI 没有"仅当文本变化才重算"的语义）。
2. 行级 `ForEach` 的 key 是 `${row.id}#${row.rev}`，而 `row.rev` 在**每次数据变更**时自增
   （`touch(row)`）—— 这是为了让 ArkUI 真正刷新该行（ArkUI 的 `ForEach` 不比较内容，
   **key 不变就不会重建**）。
3. ⇒ 两者相乘：流式期间每来一个 SSE 事件，该 turn 的**整行被重建**，于是它**全部**迭代块的
   Markdown 都要**重新解析**一遍。实测单行正文可达 **274 KB**（108 个迭代块）⇒ 每个事件
   都在解析几百 KB 文本 ⇒ 界面卡死、滚动跳、看起来"整个错乱/完全没法用"。

### 修法（纯优化，不改任何语义）

`core/markdown.ets` 增加**按原文本身做键**的解析缓存：

- `parseMarkdownCached(src)` / `parseInlineCached(text)`，渲染路径一律走它们；
- 键 = 原文（不是 hash、不是长度）⇒ ① 不可能因碰撞给出错内容；② 内容一变键就变 ⇒ 不可能陈旧；
- 容量按总字符数封顶（块缓存 2 MB + 行内缓存 2 MB），超限按插入顺序淘汰最早的；
- 流式期间只有**变化的那一个块**要重新解析，其余全部命中缓存。

### 在真机上验证它生效（自检页）

自检页的会话统计会打印一行：

```
md缓存 命中=1234 未命中=87（命中率 93%） 占用=412KB 条目=318
```

流式过程中**命中率应显著高**（未命中数只会随"新增/变化的文本"增长）。
这次截图同时带回了这条数，等于在真机上证明了优化确实命中。

### 数字小结（真实服务端实测）

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 单个 turn 渲染的迭代块数 | **108** | **≤16**（超出折叠，可手动展开） |
| 每个 SSE 事件重新解析的 Markdown 文本量 | 该行全部块（可达 **274 KB**） | 仅**变化的那块**（其余命中缓存） |

## 全量渲染负载扫描（`tools/tests/live_scale.test.ts`，只读，2026-10-09）

用法：

```bash
XBOT_E2E_BASE=http://127.0.0.1:16000 XBOT_E2E_USER=adm XBOT_E2E_PASS=123 tools/tests/run.sh
```

扫描真实服务端前 12 个会话的 `/api/history`，对每个会话报告：行数 / 迭代总数 / 单行最多迭代 /
**实际渲染块数**（应用 `MAX_ITER_VISIBLE=16` 上限后）/ **最大单块字符数** / 正文字节 / 含折叠区域的行数，
并对每行断言三条不变量（迭代号唯一、升序、渲染块数受上限约束）。

### 一次真实扫描的结果（会话总数 678，扫描 8 个）

```
chat_F64D4096DA6F rows=30 迭代=0   单行最多=0   渲染块=0  最大单块=0K  正文=1K  折叠行=0
chat_EBD3E199CA5B rows=30 迭代=0   单行最多=0   渲染块=0  最大单块=0K  正文=35K 折叠行=0
chat_D3D036023DB7 rows=8  迭代=16  单行最多=4   渲染块=16 最大单块=1K  正文=13K 折叠行=0
chat_204AFFF4F36A rows=17 迭代=16  单行最多=2   渲染块=16 最大单块=2K  正文=15K 折叠行=0
web-4             rows=4  迭代=20  单行最多=16  渲染块=20 最大单块=23K 正文=0K  折叠行=0
chat_14831C9D2A43 rows=2  迭代=102 单行最多=102 渲染块=16 最大单块=12K 正文=0K  折叠行=1
chat_A642B1525E87 rows=4  迭代=103 单行最多=100 渲染块=19 最大单块=16K 正文=1K  折叠行=1
chat_8BCC3ACDD0CB rows=2  迭代=17  单行最多=17  渲染块=16 最大单块=6K  正文=0K  折叠行=0
  → 290 条不变量断言全过（0 失败）；含折叠区域的会话=2；存在 >32K 单块的会话=**0**
```

### 三条结论（都由真实数据得出，不是推断）

1. **"单个巨大块"这条假设被否掉**：最大单块只有 23 KB（`web-4`），没有任何 >32 KB 的块
   ⇒ 单块撑爆单行不是本实例的成因；成因是**块的数量**（单行 100+ 块）。
2. **迭代确实在 `messages[].iterations` 里**（顶层字段为
   `active_progress, channel, chat_id, has_more, last_seq, messages, oldest_id, processing`，
   **没有**顶层 `iteration_history`）⇒ 客户端解析路径正确，不存在"成批读不到迭代导致空白"。
3. **那两个 `迭代=0` 的会话不是解析 bug**：30 条 message 里 0 条带迭代（服务端就没发），
   它们靠 `content`（1K / 35K）正常渲染。
4. 顺带确认客户端**已经**使用 `active_progress`（忙会话的权威在飞快照）、`processing`、
   `has_more`/`oldest_id`（向上翻页）、`last_seq`（SSE 断点续传）。

### 追加否掉的假设：「最终回复显示两遍」（行级 content 与末迭代 content 重复）

**担心**：xbot 服务端会把 turn 的收尾回复回填到 assistant 行的 `content`
（`fillAssistantContentFromIterations`），而同一段文本也在**最后一个迭代**的 `content` 里；
而客户端 `AssistantBlock` **同时**渲染 `row.content` 与全部迭代 ⇒ 最终回复可能显示两遍。

**实测（8 个会话，`live_scale.test.ts` 常驻检测）**：**没有任何一行**满足
「`row.content` 非空 且 与末个非空迭代的 content 完全相同」。

- 多迭代的 turn：行级 `content` 为 **0 字节**（正文都在迭代里）⇒ 只渲染一次 ✓
- 迭代=0 的会话：有 `content`（1K / 35K）而没有迭代 ⇒ 也只渲染一次 ✓

⇒ 该形态在本实例**不存在**；检测已留在 `live_scale.test.ts` 里（一旦某版本开始回填，跑扫描就会打印 `⚠`）。

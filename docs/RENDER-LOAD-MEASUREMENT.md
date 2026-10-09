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

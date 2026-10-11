/**
 * 「搜消息」请求契约门禁 —— `core/sessionops.ets` 的消息搜索纯逻辑。
 *
 * 为什么必须有（真 bug 复盘）：web **没有**会话内消息搜索（`grep "/api/search" web/src` 零命中）；
 *   本仓的"搜消息"是原生扩展，权威 = Go 服务端。原实现 `store.searchMessages` 发
 *   `{channel, chat_id, q}`，而服务端 `handleSearchPOST`（`web_rest.go:432-449`）**只读**
 *   `{query, limit}` 且解码器 `DisallowUnknownFields()`（`web_rest.go:35`）⇒ 每次 **400**，
 *   按钮**恒失败**。本门禁钉死"请求体只有 query/limit"这条契约。
 *
 * 服务端语义（逐字核对）：
 *   · `web.go:915`            POST /api/search → handleSearchPOST
 *   · `web_rest.go:434-436`   body `{query, limit}`
 *   · `web_rest.go:35`        DisallowUnknownFields ⇒ 多键即 400
 *   · `web_api.go:1108-1113`  limit：缺省 20，显式需 `1..100`，否则回落 20
 *   · `web_api.go:1080-1091`  响应 `{ok, results?: [searchHit{id,role,created_at,snippet}]}`
 *
 * mutation：把 `query` 改成 `q`、或往 body 里加 `channel`/`chat_id`、或把 limit 归一改错 ⇒ 必红。
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  parseSearchHits,
  searchBody,
  SearchBody,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_LIMIT_MIN,
  normalizeSearchLimit,
} from '../../entry/src/main/ets/core/sessionops';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ═══ ① 常量即服务端默认/上限 ═══════════════════════════════════════════════════════════
eq('默认 limit = 20（web_api.go:1108）', SEARCH_LIMIT_DEFAULT, 20);
eq('上限 limit = 100（web_api.go:1110-1112）', SEARCH_LIMIT_MAX, 100);
eq('下限 limit = 1', SEARCH_LIMIT_MIN, 1);

// ═══ ② limit 归一（镜像服务端"非法即用默认"，非"夹到边界"）══════════════════════════════
// mutation：把 `>MAX 回落默认` 改成 `夹到 100` ⇒ 必红。
eq('normalize：20 → 20', normalizeSearchLimit(20), 20);
eq('normalize：1 → 1', normalizeSearchLimit(1), 1);
eq('normalize：100 → 100', normalizeSearchLimit(100), 100);
eq('normalize：0 → 默认 20', normalizeSearchLimit(0), 20);
eq('normalize：负数 → 默认 20', normalizeSearchLimit(-5), 20);
eq('normalize：101 → 默认 20（⛔ 不夹到 100）', normalizeSearchLimit(101), 20);
eq('normalize：1000 → 默认 20', normalizeSearchLimit(1000), 20);
eq('normalize：非有限 → 默认 20', normalizeSearchLimit(NaN), 20);

// ═══ ③ 请求体**只含** query/limit（服务端 DisallowUnknownFields ⇒ 多键即 400）══════════
// mutation：字段名 query→q、或加 channel/chat_id ⇒ 必红。
const b: SearchBody = searchBody('hello', 20);
eq('body 字段集恰为 {query, limit}', Object.keys(b).sort(), ['limit', 'query']);
ok('body 不含 channel', Object.keys(b).indexOf('channel') < 0);
ok('body 不含 chat_id', Object.keys(b).indexOf('chat_id') < 0);
ok('body 不含 q（旧错误键）', Object.keys(b).indexOf('q') < 0);
eq('body 字面量（字段序 query,limit）', JSON.stringify(searchBody('hello', 20)), '{"query":"hello","limit":20}');
// 超界查询词经 searchBody 也被归一
eq('searchBody 归一越界 limit', JSON.stringify(searchBody('x', 999)), '{"query":"x","limit":20}');
eq('searchBody 空串查询仍成形（服务端自行 trim/短路）', JSON.stringify(searchBody('', 20)), '{"query":"","limit":20}');

// ═══ ④ 响应解析（防御 results 缺失/null/非数组）════════════════════════════════════════
// mutation：不判 Array.isArray（`results:null` 时崩/返回 null）⇒ 必红。
const hits = [{ id: 3, role: 'assistant', created_at: 'T', snippet: '…hello…' }];
eq('results 数组 ⇒ 原样返回（服务端已 id DESC 排好）', parseSearchHits({ ok: true, results: hits }), hits);
eq('无 results 键（空结果 {ok:true}）⇒ []', parseSearchHits({ ok: true }), []);
eq('results=null ⇒ []', parseSearchHits({ ok: true, results: null }), []);
eq('results 非数组 ⇒ []', parseSearchHits({ ok: true, results: 'x' }), []);
eq('data 为 null ⇒ []', parseSearchHits(null as unknown as Object), []);

console.log(fail === 0 ? `✅ search_msgs: ${pass} passed` : `❌ search_msgs: ${fail} failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);

/**
 * 会话导出 **RPC 面** 门禁 —— `core/rpc.ets` 的新增常量/类型/纯函数。
 *
 * 权威（逐字取证，web `/Users/bobli/src/xbot/web`）：
 *   · `agent/api.ts:332-337`  `method: 'export_session'`       params `sessionBody(session)`
 *   · `agent/api.ts:385-388`  `method: 'export_session_jsonl'` params `sessionBody(session)`
 *   · `agent/api.ts:585-590`  `method: 'import_session'`       params `{channel, chat_id, session}`
 *   · `agent/api.ts:663-669`  `sessionBody` = `{ channel: session.channel, chat_id: session.chatID }`
 *   · 服务端 `agent/req_types.go:83-84`（字面量）、`serverapp/rpc_table.go:1485/1542/1577/1606`（注册）。
 *
 * ⚠️ 事实更正：web 的**会话导出**只有 **2 个** RPC（`export_session` / `export_session_jsonl`），
 *    另 2 个是**导入**逆操作 ⇒ 本文件按真源断言 **4 个**方法名，不是派单设想的"三个导出"。
 *
 * mutation：把任一字面量/字段名改错 ⇒ 必红（见每条断言注释）。
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  RPC_EXPORT_SESSION,
  RPC_EXPORT_SESSION_JSONL,
  RPC_IMPORT_SESSION,
  RPC_IMPORT_SESSION_JSONL,
  RpcMethod,
  RpcParamsReq,
  SessionSelectorParams,
  exportRpcMethod,
} from '../../entry/src/main/ets/core/rpc';
import {
  EXPORT_BENCHMARK,
  EXPORT_CODEX,
  EXPORT_MULTICA,
  EXPORT_NATIVE,
  EXPORT_OPENAI,
  exportFilename,
  extForFormat,
  mimeForFormat,
} from '../../entry/src/main/ets/core/export';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ═══ ① 方法名常量与 web 逐字一致（web 真源字符串 = 期望值）════════════════════════════
// mutation：把任一字面量改错（如 'export_session ' 多空格 / 'Export_Session'）⇒ 必红。
eq('export_session 字面量（web api.ts:334）', RPC_EXPORT_SESSION, 'export_session');
eq('export_session_jsonl 字面量（web api.ts:386）', RPC_EXPORT_SESSION_JSONL, 'export_session_jsonl');
eq('import_session 字面量（web api.ts:587）', RPC_IMPORT_SESSION, 'import_session');
eq('import_session_jsonl 字面量（服务端 rpc_table.go:1606）', RPC_IMPORT_SESSION_JSONL, 'import_session_jsonl');

// RpcMethod 静态 + ALL 登记（漂移守卫；mutation：漏登记 ⇒ 必红）
eq('RpcMethod.exportSession', RpcMethod.exportSession, 'export_session');
eq('RpcMethod.exportSessionJsonl', RpcMethod.exportSessionJsonl, 'export_session_jsonl');
eq('RpcMethod.importSession', RpcMethod.importSession, 'import_session');
eq('RpcMethod.importSessionJsonl', RpcMethod.importSessionJsonl, 'import_session_jsonl');
ok('ALL 登记 export_session', RpcMethod.ALL.indexOf(RPC_EXPORT_SESSION) >= 0);
ok('ALL 登记 export_session_jsonl', RpcMethod.ALL.indexOf(RPC_EXPORT_SESSION_JSONL) >= 0);
ok('ALL 登记 import_session', RpcMethod.ALL.indexOf(RPC_IMPORT_SESSION) >= 0);
ok('ALL 登记 import_session_jsonl', RpcMethod.ALL.indexOf(RPC_IMPORT_SESSION_JSONL) >= 0);

// ═══ ② 请求参数构造（字段名/序对齐 web sessionBody）════════════════════════════════════
// mutation：把 `chat_id` 写成 `chatID`／字段顺序对调 ⇒ 必红。
eq('SessionSelectorParams 字段序/名 channel,chat_id',
  JSON.stringify(new SessionSelectorParams('web', 'c1')), '{"channel":"web","chat_id":"c1"}');
// 与 web `postAPI('/api/rpc', {method, params})` 同形状
eq('export_session 请求体', JSON.stringify(new RpcParamsReq(RPC_EXPORT_SESSION, new SessionSelectorParams('web', 'c1'))),
  '{"method":"export_session","params":{"channel":"web","chat_id":"c1"}}');
eq('export_session_jsonl 请求体', JSON.stringify(new RpcParamsReq(RPC_EXPORT_SESSION_JSONL, new SessionSelectorParams('feishu', 'x'))),
  '{"method":"export_session_jsonl","params":{"channel":"feishu","chat_id":"x"}}');

// ═══ ③ 格式 → RPC 方法分派（web api.ts:383-394）════════════════════════════════════════
// mutation：把 benchmark 指到 export_session（或反之）⇒ 必红。
eq('benchmark → export_session_jsonl', exportRpcMethod(EXPORT_BENCHMARK), 'export_session_jsonl');
eq('native → export_session', exportRpcMethod(EXPORT_NATIVE), 'export_session');
eq('openai → export_session', exportRpcMethod(EXPORT_OPENAI), 'export_session');
eq('codex → export_session', exportRpcMethod(EXPORT_CODEX), 'export_session');
eq('multica → export_session', exportRpcMethod(EXPORT_MULTICA), 'export_session');

// ═══ ④ "文件名 + 格式" 组合在三种扩展名下都正确（web api.ts:570-572）══════════════════════
// mutation：extForFormat 把 codex 归成 json / sanitize 去掉净化 ⇒ 必红。
eq('native：json + <label>.json', [extForFormat(EXPORT_NATIVE), exportFilename('chat/1', extForFormat(EXPORT_NATIVE))],
  ['json', 'chat_1.json']);
eq('openai：json + <label>.json', [extForFormat(EXPORT_OPENAI), exportFilename('sess 2', extForFormat(EXPORT_OPENAI))],
  ['json', 'sess_2.json']);
eq('codex：jsonl + <label>.jsonl', [extForFormat(EXPORT_CODEX), exportFilename('c:1', extForFormat(EXPORT_CODEX))],
  ['jsonl', 'c_1.jsonl']);
eq('multica：jsonl + <label>.jsonl', [extForFormat(EXPORT_MULTICA), exportFilename('a/b', extForFormat(EXPORT_MULTICA))],
  ['jsonl', 'a_b.jsonl']);
eq('benchmark：jsonl + <label>.jsonl', [extForFormat(EXPORT_BENCHMARK), exportFilename('x.y', extForFormat(EXPORT_BENCHMARK))],
  ['jsonl', 'x_y.jsonl']);
// mime 与扩展名同源（json→application/json；jsonl→application/x-jsonlines）
eq('mime：json 组', [mimeForFormat(EXPORT_NATIVE), mimeForFormat(EXPORT_OPENAI)],
  ['application/json', 'application/json']);
eq('mime：jsonl 组', [mimeForFormat(EXPORT_CODEX), mimeForFormat(EXPORT_MULTICA), mimeForFormat(EXPORT_BENCHMARK)],
  ['application/x-jsonlines', 'application/x-jsonlines', 'application/x-jsonlines']);

console.log(fail === 0 ? `✅ export_rpc: ${pass} passed` : `❌ export_rpc: ${fail} failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);

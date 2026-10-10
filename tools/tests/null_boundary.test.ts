/**
 * null_boundary.test.ts —— 可靠性波2「外来 JSON 判空收口」的**端到端**判别力守卫。
 *
 * 根因（已发生的 P0，`abaec53`）：Go 的零值（nil slice / nil 指针）经 encoding/json 序列化成
 * **JSON `null`**，而客户端把这类字段声明成 `T | undefined`（可选 = "可能缺失"，**不含 null 语义**）
 * ⇒ `x !== undefined` 对 `null` **为真** ⇒ 紧接着的 `.length`/成员访问抛 TypeError。
 *
 * 本文件覆盖 3 类边界（全部**直接喂真实 JSON 文本**，含字面 `null`，驱动真实函数）：
 *   ① `core/subagent.ets` —— `children:null` / `instance:null` / `desc:null` /
 *      `sessionKey:null` / `role:null`，以及**入参整块为 null**（服务端 `sub_agents:null`）。
 *   ② `core/http.ets` —— 信封 `{ok,data,error}`（实测服务端三键恒在：成功 `error:null`，
 *      失败 `data:null`）：`error:null` 不得取 `.message`；`data:null` 不得变成字符串 `"null"`。
 *   ③ `core/guards.ets` —— `isPresent` 必须是**类型谓词**：赋值 / 成员访问 / `.length` 位置可用。
 *
 * ⛔ 判别力自证（本波 mutation，见提交信息）：把三处兜底分别退回"只判 undefined"：
 *   · subagent `children`  → `kids.length` 抛 ⇒ SUBAGENT 用例红
 *   · http `env.error`     → `null.message` 抛 ⇒ ERROR 用例红
 *   · http `env.data`      → 返回字符串 `"null"` ⇒ DATA 用例红
 *   且 `isPresent` 一旦退回 `boolean`，本文件的**编译期谓词断言**直接编译失败（run.sh 整体红）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const Buffer: any;

import { XbotHttp } from '../../entry/src/main/ets/core/http';
import {
  flattenSubAgents, hasVisibleSubAgents, subAgentLabel, SubAgentRow,
  SUB_OTHER, subStatusKind, visibleRoots,
} from '../../entry/src/main/ets/core/subagent';
import { arrOrEmpty, arrPresent, isPresent } from '../../entry/src/main/ets/core/guards';
import { normalizeWebSubAgents } from '../../entry/src/main/ets/core/progress_types';

const nodeHttp = require('http');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 编译期谓词断言 —— 这是本文件**最重要**的一节。
//    `isPresent` 退回 `boolean`（非谓词）时，下面三行分别报 TS2322 / TS18049 / TS18049，
//    `tools/tests/run.sh` 的 `tsc --strict` 直接失败 ⇒ 全绿被打破（无需运行时即能判红）。
//    运行时取值另由后面的 `isPresent 语义` 一节断言。
// ══════════════════════════════════════════════════════════════════════════════
interface PredCfg { a: number; }

/** 赋值位置：非谓词时 `PredCfg | null | undefined` 不能赋给 `PredCfg`（TS2322）。 */
export function _predAssignPos(v: PredCfg | null | undefined): PredCfg {
  return isPresent(v) ? v : { a: 0 };
}

/** 成员访问位置：非谓词时 `v.a` 报 TS18049（possibly null/undefined）。 */
export function _predMemberPos(v: PredCfg | null | undefined): number {
  return isPresent(v) ? v.a : 0;
}

/** `.length` 位置：非谓词时 `v.length` 报 TS18049。 */
export function _predLengthPos(v: string[] | null | undefined): number {
  return isPresent(v) ? v.length : 0;
}

/** `arrPresent` 同步升级为谓词：真分支内可直接索引。 */
export function _predArrPresent(v: string[] | null | undefined): string {
  return arrPresent(v) ? v[0] : '';
}

// ══════════════════════════════════════════════════════════════════════════════
// ① core/subagent.ets —— 外来 JSON 边界（真实 JSON 文本驱动）
// ══════════════════════════════════════════════════════════════════════════════

/** `subagent.ets` 消费的是**客户端类型** `WebSubAgentProgress`（归一化后形态，camelCase `sessionKey`）。 */
const RAW_SUBAGENTS_ALL_NULL: string =
  '{"sub_agents":[{"role":"reviewer","instance":null,"sessionKey":null,"status":"running","desc":null,"children":null}]}';

/** 嵌套：children 数组含 null 成员（JSON `[null]`）+ 深层 children 亦为 null。 */
const RAW_SUBAGENTS_NESTED: string =
  '{"sub_agents":[{"role":"parent","status":"running","children":[null,{"role":"kid","status":"pending","children":null}]}]}';

/** 服务端**原始**下发形态（`protocol.SubAgentInfo`，snake_case）——用于全链路用例。 */
const RAW_SERVER_SUBAGENTS: string =
  '{"sub_agents":[{"role":"rev","instance":"r1","session_key":"cli:c/r1","status":"running","desc":"d","children":null}]}';

function subagentsOf(raw: string): unknown {
  const obj = JSON.parse(raw) as { sub_agents?: unknown };
  return obj.sub_agents;
}

function main_subagent(): void {
  // ── 用例 A：`children:null` / instance / desc / sessionKey 全 null ⇒ 不得抛 ──
  {
    let threw = '';
    let rows: SubAgentRow[] = [];
    try {
      const nodes = subagentsOf(RAW_SUBAGENTS_ALL_NULL) as unknown as never[];
      rows = flattenSubAgents(nodes, true);
    } catch (e) {
      const err = e as Error;
      threw = isPresent(err.message) ? err.message : `${e}`;
    }
    ok('★ children/instance/desc/sessionKey 全 null 不抛', threw === '', threw);
    ok('★ 全 null 字段归一：desc 空串', rows.length === 1 && rows[0].desc === '');
    ok('★ sessionKey:null ⇒ 不可点（openable=false）',
      rows.length === 1 && rows[0].sessionKey === '' && rows[0].openable === false);
    ok('★ children:null ⇒ hasChildren=false 且不产出子行',
      rows.length === 1 && rows[0].hasChildren === false);
    ok('★ instance:null ⇒ label 只有 role（不出 "null:xxx"）',
      rows.length === 1 && rows[0].label === 'reviewer', rows.length === 1 ? rows[0].label : '');
  }

  // ── 用例 B：嵌套 children 含 null 成员 + 深层 children:null ──
  {
    let threw = '';
    let rows: SubAgentRow[] = [];
    try {
      const nodes = subagentsOf(RAW_SUBAGENTS_NESTED) as unknown as never[];
      rows = flattenSubAgents(nodes, false);
    } catch (e) {
      const err = e as Error;
      threw = isPresent(err.message) ? err.message : `${e}`;
    }
    ok('★ 嵌套 children 含 null 成员不抛', threw === '', threw);
    // 只渲染 running/pending 顶层（parent 是 running；kid 是 pending 但它是子节点，父在即渲染）
    ok('★ null 成员被跳过，父子两行都在', rows.length === 2,
      `rows=${rows.length}`);
    ok('★ 父行 hasChildren=true（有非 null 子节点）', rows.length === 2 && rows[0].hasChildren === true);
  }

  // ── 用例 C：入参整块为 null（服务端 `sub_agents: null`）⇒ 恒返回 [] ──
  {
    let threw = '';
    let rootsLen = -1;
    let flatLen = -1;
    let has = true;
    try {
      const raw = JSON.parse('{"sub_agents":null}') as { sub_agents: null };
      // 直接喂字面 null（模拟 normalize 之外的原始载荷 / 未来接线方）
      const nodes = raw.sub_agents as unknown as null;
      rootsLen = visibleRoots(nodes).length;
      flatLen = flattenSubAgents(nodes, true).length;
      has = hasVisibleSubAgents(nodes);
    } catch (e) {
      const err = e as Error;
      threw = isPresent(err.message) ? err.message : `${e}`;
    }
    ok('★ visibleRoots(null) 不抛', threw === '', threw);
    ok('★ visibleRoots(null) = []', rootsLen === 0, `len=${rootsLen}`);
    ok('★ flattenSubAgents(null) = []', flatLen === 0, `len=${flatLen}`);
    ok('★ hasVisibleSubAgents(null) = false', has === false);
  }

  // ── 用例 D：status 为 null / 字段为 null 的标量工具函数 ──
  {
    ok('subStatusKind(null) ⇒ other', subStatusKind(null) === SUB_OTHER);
    ok('subAgentLabel(null, null) = ""', subAgentLabel(null, null) === '');
    ok('subAgentLabel("r", null) = "r"', subAgentLabel('r', null) === 'r');
  }

  // ── 用例 E：正向对照 —— 合法数据仍如实解析（守卫不能把功能一起挡掉）──
  {
    const good = JSON.parse(
      '{"role":"rev","instance":"r1","sessionKey":"cli:c/r1","status":"running","desc":"d","children":[]}',
    ) as never;
    const rows = flattenSubAgents([good], true);
    ok('正向对照：合法节点解析正确',
      rows.length === 1 && rows[0].label === 'rev:r1' && rows[0].desc === 'd'
      && rows[0].sessionKey === 'cli:c/r1' && rows[0].openable === true,
      JSON.stringify(rows));
  }

  // ── 用例 E2：**全链路** —— 服务端原始 JSON（snake_case + children:null）
  //    经 normalizeWebSubAgents 归一后再展平，整条路径不得抛。 ──
  {
    let threw = '';
    let rows: SubAgentRow[] = [];
    try {
      const raw = subagentsOf(RAW_SERVER_SUBAGENTS) as never[];
      const normalized = normalizeWebSubAgents(raw);
      rows = flattenSubAgents(normalized, true);
    } catch (e) {
      const err = e as Error;
      threw = isPresent(err.message) ? err.message : `${e}`;
    }
    ok('★ 全链路（原始 snake_case JSON → normalize → flatten）不抛', threw === '', threw);
    ok('★ 全链路 session_key 被正确映射',
      rows.length === 1 && rows[0].sessionKey === 'cli:c/r1', JSON.stringify(rows));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ② core/http.ets —— 信封解包（真跑 HTTP，服务端亲口吐出含 null 的 JSON 文本）
// ══════════════════════════════════════════════════════════════════════════════
function startMockServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = nodeHttp.createServer((req: any, res: any) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        // ⚠️ 全部返回 **HTTP 200** + 真实服务端 JSON 形态（ok=false 时 data:null；
        //    ok=true 时 error:null）—— 这样才能真正走到信封解包分支。
        const path: string = req.url;
        if (path === '/api/ok-null-error') {
          res.end('{"ok":true,"data":{"a":1},"error":null}');
          return;
        }
        if (path === '/api/ok-null-data') {
          res.end('{"ok":true,"data":null,"error":null}');
          return;
        }
        if (path === '/api/ok-no-data-key') {
          res.end('{"ok":true}');                       // 裸 encoder 形态（无 data 键）
          return;
        }
        if (path === '/api/err-null-error') {
          res.end('{"ok":false,"data":null,"error":null}'); // error 为 null（不得取 .message）
          return;
        }
        if (path === '/api/err-object') {
          res.end('{"ok":false,"data":null,"error":{"code":"x","message":"boom"}}');
          return;
        }
        if (path === '/api/err-string') {
          res.end('{"ok":false,"error":"plugin failed"}');  // error 是裸字符串（web_files.go 形态）
          return;
        }
        if (path === '/api/body-null') {
          res.end('null');                              // 字面 JSON null（JSON.parse → null）
          return;
        }
        res.statusCode = 404;
        res.end('{"ok":false,"data":null,"error":{"code":"not_found","message":"nope"}}');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}

/** 调一次回调，返回 { threw（异常消息，空=没抛）, value }。 */
async function capture<T>(fn: () => Promise<T>): Promise<{ threw: string; value: T | null }> {
  try {
    const v = await fn();
    return { threw: '', value: v };
  } catch (e) {
    const err = e as Error;
    return { threw: isPresent(err.message) ? err.message : `${e}`, value: null };
  }
}

async function main_http(): Promise<void> {
  const srv = await startMockServer();
  const h = new XbotHttp(`http://127.0.0.1:${srv.port}`);

  // ── 用例 F：成功响应里 `error:null`（服务端**每个**成功响应都长这样）不得影响正常解包 ──
  {
    const r = await capture<string>(() => h.post('/api/ok-null-error', {}));
    ok('★ 成功响应 error:null 正常解包', r.threw === '' && r.value === '{"a":1}',
      `threw=${r.threw} value=${r.value}`);
  }

  // ── 用例 G：失败响应 `error:null` ⇒ 必须降级为干净的 'request failed'（不是 TypeError）──
  {
    const r = await capture<string>(() => h.post('/api/err-null-error', {}));
    ok('★ error:null 不崩且降级为 request failed', r.threw === 'request failed',
      `threw=${r.threw}`);
  }

  // ── 用例 H：失败响应带 error 对象 ⇒ 用其 message（正向对照：不能一律降级）──
  {
    const r = await capture<string>(() => h.post('/api/err-object', {}));
    ok('★ error 对象取 message', r.threw === 'boom', `threw=${r.threw}`);
  }

  // ── 用例 I：error 是**裸字符串**（web_files.go `{"ok":false,"error":msg}`）⇒ 不得崩 ──
  {
    const r = await capture<string>(() => h.post('/api/err-string', {}));
    ok('★ error 为字符串时不崩', r.threw.length > 0 && r.threw.indexOf('Cannot read') < 0,
      `threw=${r.threw}`);
  }

  // ── 用例 J：`data:null`（成功却无载荷）⇒ 必须降级为 '{}'，**绝不**是字符串 "null" ──
  {
    const raw = await capture<string>(() => h.post('/api/ok-null-data', {}));
    ok('★ data:null 降级为 "{}"（不是字符串 "null"）',
      raw.threw === '' && raw.value === '{}', `threw=${raw.threw} value=${raw.value}`);

    // 端到端：postAs 的产物必须是**可安全取成员的对象**（旧实现会得到 null ⇒ 下游崩）
    const asObj = await capture<Record<string, Object>>(
      () => h.postAs<Record<string, Object>>('/api/ok-null-data', {}));
    ok('★ data:null ⇒ postAs 得到空对象（非 null）',
      asObj.threw === '' && asObj.value !== null && JSON.stringify(asObj.value) === '{}',
      `threw=${asObj.threw}`);
  }

  // ── 用例 K：`data` 键缺失（裸 encoder `{"ok":true}`）⇒ 同样降级为 '{}' ──
  {
    const r = await capture<string>(() => h.post('/api/ok-no-data-key', {}));
    ok('★ data 键缺失降级为 "{}"', r.threw === '' && r.value === '{}',
      `threw=${r.threw} value=${r.value}`);
  }

  // ── 用例 L：响应体整体是 JSON `null` ⇒ 给出可读错误（不是 "Cannot read property ok of null"）──
  {
    const r = await capture<string>(() => h.post('/api/body-null', {}));
    ok('★ 响应体为 JSON null 时报可读错误',
      r.threw.indexOf('信封为空') >= 0 && r.threw.indexOf('Cannot read') < 0,
      `threw=${r.threw}`);
  }

  // ── 用例 M：正向对照 —— 合法对象载荷原样返回 ──
  {
    const r = await capture<string>(() => h.post('/api/ok-null-data', {}));
    ok('正向对照：正常载荷仍是对象串', r.value === '{}');
  }

  srv.close();
}

// ══════════════════════════════════════════════════════════════════════════════
// guards 运行时语义（编译期谓词断言已在文件顶部）
// ══════════════════════════════════════════════════════════════════════════════
function main_guards(): void {
  ok('isPresent(null) = false', isPresent<object>(null) === false);
  ok('isPresent(undefined) = false', isPresent<object>(undefined) === false);
  ok('isPresent({}) = true', isPresent<object>({}) === true);
  ok('arrOrEmpty(null) = []', arrOrEmpty<string>(null).length === 0);
  ok('arrOrEmpty(undefined) = []', arrOrEmpty<string>(undefined).length === 0);
  ok('arrPresent(null) = false', arrPresent<string>(null) === false);
  ok('arrPresent([]) = false', arrPresent<string>([]) === false);
  ok('arrPresent([x]) = true', arrPresent<string>(['x']) === true);
}

async function main(): Promise<void> {
  main_guards();
  main_subagent();
  await main_http();

  if (fail > 0) {
    console.log(`  null_boundary: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`  null_boundary: ${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch((e: Error): void => {
  console.log(`  ✗ null_boundary 主流程异常：${e.message}`);
  process.exit(1);
});

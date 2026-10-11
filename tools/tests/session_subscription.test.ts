/**
 * session_subscription.test.ts —— 目标④续「会话信息面板补**订阅**行」的**三段闭合**判据。
 *
 * ── 缺陷类（为什么必须"三段闭合 + 消费点计数"）──────────────────────────────────
 *   本仓有「死消费」缺陷类（`AGENTS.md` GOTCHAS）：函数/`@Prop`/RPC **声明了却 0 消费方**
 *   ⇒ 用户操作**静默无效**（已抓 3 例：`withAccent` / `applyNotifyPrefs` / `reasoningopen`）。
 *   另有「声明存在但没接线」：`core/rpc.ets` 里加个常量（声明），可 `store` 不调用、
 *   页面不传 `@Prop`、组件不渲染 ⇒ 表面"门禁全绿"实则**死行**。
 *   ⇒ 本判据对**每个环节**同时钉三件：① 声明 ∧ ② 消费 ≥1 ∧ ③ **渲染/调用落点**。缺一 ⇒ 红。
 *
 * ── 覆盖（web 真口径 `src/components/sidebar/SessionInfo.tsx`）────────────────────
 *   · 取数：`fetchSessionSubscription` → `get_session_subscription` `{channel, chat_id}`
 *     （web `agent/api.ts:270-275` / `:803`；服务端 `rpc_table.go:817-835`）。
 *   · 渲染：`{focusedSession?.channel === 'agent' && subscription !== '—' && <InfoRow label="Subscription" … mono/>}`
 *     （web `SessionInfo.tsx:191-193`）。
 *   · ⚠️ **channel 缺省回落 `"cli"`**（`rpc_table.go:820-822`）⇒ 调用点必须**显式传本会话渠道**
 *     （同类坑先例 `docs/WEB-PARITY.md:371`）。本判据钉住 `new SessionSelectorParams(this.channel, …)`。
 *
 * ── 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`components/**`
 *    与 `pages/**` 不进 harness ⇒ 组件/页面层无法直接 import。先例：`status_sheet_wiring.test.ts`。
 *    **断言前剥注释**（组件用注释记录 web 口径，朴素匹配会假红）。
 *
 * ── mutation 自证（⛔ 不改真树即可证红）──────────────────────────────────────────
 *   四个 `*_SRC` 环境变量指向**副本**；注入一处违规（把 `'get_session_subscription'` 改名、
 *   把 `this.channel` 改成 `'cli'`、抽掉渲染行、断开 Index 传参）⇒ 必红；同副本不注入 ⇒ 必绿。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

// 只为让本文件成为**模块**（否则顶层 `pass/fail/ok/…` 落进全局作用域，与其它同类测试文件
// 冲突：TS2451/TS2393）。本文件只用 `require` ⇒ 必须显式 `export {}`。
export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}
function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 剥注释（等长替换；对字符串内的 `//` 免疫 —— 组件注释里大量出现 `file:line`）。 */
function stripComments(src: string): string {
  const out: string[] = [];
  const n: number = src.length;
  let i: number = 0;
  let inLine: boolean = false;
  let inBlock: boolean = false;
  let inStr: boolean = false;
  let quote: string = '';
  while (i < n) {
    const c: string = src[i];
    const nxt: string = i + 1 < n ? src[i + 1] : '';
    if (inLine) {
      if (c === '\n') { inLine = false; out.push(c); } else { out.push(' '); }
    } else if (inBlock) {
      if (c === '*' && nxt === '/') { out.push(' '); out.push(' '); i += 2; inBlock = false; continue; }
      out.push(c === '\n' ? '\n' : ' ');
    } else if (inStr) {
      if (c === '\\') { out.push(c); out.push(nxt); i += 2; continue; }
      if (c === quote) { inStr = false; }
      out.push(c);
    } else {
      if (c === '/' && nxt === '/') { out.push(' '); out.push(' '); i += 2; inLine = true; continue; }
      if (c === '/' && nxt === '*') { out.push(' '); out.push(' '); i += 2; inBlock = true; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c; }
      out.push(c);
    }
    i += 1;
  }
  return out.join('');
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
function srcPath(envName: string, rel: string): string {
  const v: string | undefined = process.env[envName];
  return v !== undefined && v.length > 0 ? v : pathMod.join(repoRoot, rel);
}
const rpcSrc: string = stripComments(fsMod.readFileSync(
  srcPath('SSUB_RPC_SRC', 'entry/src/main/ets/core/rpc.ets'), 'utf-8'));
const storeSrc: string = stripComments(fsMod.readFileSync(
  srcPath('SSUB_STORE_SRC', 'entry/src/main/ets/core/store.ets'), 'utf-8'));
const statusSrc: string = stripComments(fsMod.readFileSync(
  srcPath('SSUB_STATUS_SRC', 'entry/src/main/ets/components/StatusSheet.ets'), 'utf-8'));
const indexSrc: string = stripComments(fsMod.readFileSync(
  srcPath('SSUB_INDEX_SRC', 'entry/src/main/ets/pages/Index.ets'), 'utf-8'));

// ════════════════════════════════════════════════════════════════════════════
// ⓪ 零扫描判红 —— 真源必须读到、锚点必须真在（否则"绿"是假的）
// ════════════════════════════════════════════════════════════════════════════
ok(`零扫描判红：core/rpc.ets 读到源码（${rpcSrc.length} 字符）`, rpcSrc.length > 8000);
ok(`零扫描判红：core/store.ets 读到源码（${storeSrc.length} 字符）`, storeSrc.length > 10000);
ok(`零扫描判红：components/StatusSheet.ets 读到源码（${statusSrc.length} 字符）`, statusSrc.length > 800);
ok(`零扫描判红：pages/Index.ets 读到源码（${indexSrc.length} 字符）`, indexSrc.length > 10000);
has(rpcSrc, 'export class RpcMethod', '锚点：rpc.ets 的 RpcMethod 在');
has(storeSrc, 'export class ChatStore', '锚点：store.ets 的 ChatStore 在');
has(statusSrc, 'export struct StatusSheet', '锚点：StatusSheet 组件定义在');
has(indexSrc, 'StatusSheet({', '锚点：页面 StatusSheet 调用点在');

// ════════════════════════════════════════════════════════════════════════════
// ① core/rpc.ets：常量 + 回包类型 + 纯函数（三段的第一段"声明"）
// ════════════════════════════════════════════════════════════════════════════
// ⛔ 字面量只许出现 1 次（= 唯一常量定义）⇒ 调用点若新造 `'get_session_subscription'` 字符串立刻红。
eq("① `'get_session_subscription'` 字面量恰 1 处（唯一常量定义，⛔ 调用点不散落字符串）",
  count(rpcSrc, "'get_session_subscription'"), 1);
has(rpcSrc, "export const RPC_GET_SESSION_SUBSCRIPTION: string = 'get_session_subscription'",
  '① 唯一 method 常量 RPC_GET_SESSION_SUBSCRIPTION 定义在（字面量逐字对齐服务端）');
has(rpcSrc, 'export interface SessionSubscription', '① 回包类型 SessionSubscription 声明在');
has(rpcSrc, 'subscription_id?: string', '① 回包含 subscription_id（服务端 rpc_table.go:826）');
has(rpcSrc, 'export function sessionSubscriptionId', '① 纯函数 sessionSubscriptionId（判据与渲染同源）');
// 纯函数行为（反查真源：直接 import 行为断言，而非只匹配源码字符串）。
ok('① sessionSubscriptionId 可被真源消费（rpc.ets 里真调它一次）',
  count(storeSrc, 'sessionSubscriptionId(') >= 1);

// ════════════════════════════════════════════════════════════════════════════
// ② core/store.ets：字段 + 三态 loader + **显式传 channel**（三段之"消费+落点"）
// ════════════════════════════════════════════════════════════════════════════
has(storeSrc, 'RPC_GET_SESSION_SUBSCRIPTION', '② store 导入/引用 RPC 常量');
has(storeSrc, 'sessionSubscription: string', '② 显示串字段 sessionSubscription 声明在');
has(storeSrc, 'sessionSubState: string', '② 三态字段 sessionSubState 声明在（非静默吞）');
has(storeSrc, 'sessionSubError: string', '② 失败原因字段 sessionSubError 声明在');
has(storeSrc, 'async loadSessionSubscription(): Promise<void>', '② 取数入口 loadSessionSubscription 定义在');
// ⛔ 关键：**显式传本会话渠道**（服务端缺省回落 "cli" ⇒ 不传会读错租户行）。
has(storeSrc, 'new SessionSelectorParams(this.channel, this.currentChatId)',
  '② 调用点显式传 channel（new SessionSelectorParams(this.channel, …)）—— 防 channel 缺省回落 cli');
ok('② loader 真调 rpc 发 RPC_GET_SESSION_SUBSCRIPTION',
  storeSrc.indexOf('this.http, RPC_GET_SESSION_SUBSCRIPTION') >= 0);
// 三态闭合：loading / ready / error + readableRpcError（照 loadLlmConfig 的模式）。
has(storeSrc, "this.sessionSubState = 'loading'", "② 三态 loading 落点");
has(storeSrc, "this.sessionSubState = 'ready'", "② 三态 ready 落点");
has(storeSrc, "this.sessionSubState = 'error'", "② 三态 error 落点");
has(storeSrc, 'this.sessionSubError = readableRpcError(', '② 失败原因可读化（readableRpcError）');
ok('② loader 被消费（定义 + 触发点 ≥2 处）', count(storeSrc, 'loadSessionSubscription') >= 2);
// ⛔ 不新造超时/setTimeout（沿用 rpc() 既有网络语义）。
hasNot(storeSrc.substring(storeSrc.indexOf('async loadSessionSubscription'), storeSrc.indexOf('async loadSessionSubscription') + 1200),
  'setTimeout', '② ⛔ loader 内不新造 setTimeout（沿用既有网络语义）');

// ════════════════════════════════════════════════════════════════════════════
// ③ components/StatusSheet.ets：@Prop 声明 + 消费 + **渲染落点**（防"死 props"）
// ════════════════════════════════════════════════════════════════════════════
has(statusSrc, '@Prop subscription', '③ subscription：@Prop 声明存在');
ok('③ subscription：被消费（this.subscription 出现 ≥2 次：isEmpty ∪ 渲染）',
  count(statusSrc, 'this.subscription') >= 2);
has(statusSrc, 'value: this.subscription', '③ subscription：渲染落点（作为 StatusInfoRow 的 value 真传）');
has(statusSrc, 'if (this.subscription.length > 0)', '③ subscription：空串 ⇒ 不显示该行（web 空值不显示口径）');
has(statusSrc, "label: '订阅'", '③ 订阅成行（标签「订阅」；走既有 StatusInfoRow 行原语）');
// 反向：新字段必须进 `isEmpty()`（否则"点开了但什么都没有"的会话会被当非空）。
const emptyBody: string = ((): string => {
  const i: number = statusSrc.indexOf('private isEmpty(): boolean');
  return i < 0 ? '' : statusSrc.substring(i, i + 400);
})();
ok('③ isEmpty() 可定位', emptyBody.length > 40);
has(emptyBody, 'this.subscription.length === 0', '③ isEmpty 计入 subscription');

// ════════════════════════════════════════════════════════════════════════════
// ④ pages/Index.ets：调用点**逐 field 真传**（criterion：不是"字段存在"，是"真接线"）
// ════════════════════════════════════════════════════════════════════════════
has(indexSrc, 'subscription: this.store !== null ? this.store.sessionSubscription : \'\'',
  '④ 调用点真传 subscription（store.sessionSubscription，权威值）');
// 既有 4 项身份字段仍在（本波只加不改 ⇒ 反向守卫）。
has(indexSrc, 'sessionId: this.store !== null ? this.store.currentChatId : \'\'', '④ 既有 sessionId 传参保留');
has(indexSrc, 'channel: this.store !== null ? this.store.channel : \'\'', '④ 既有 channel 传参保留');
has(indexSrc, 'lastActive: this.currentLastActive()', '④ 既有 lastActive 传参保留');

if (fail > 0) {
  console.log(`  session_subscription: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  session_subscription: ${pass} passed, 0 failed`);
process.exit(0);

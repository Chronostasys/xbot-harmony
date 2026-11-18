/**
 * user_send_idempotent.test.ts —— 发消息的**一瞬间**不得出现两条 user 气泡
 * （用户 2026-11-16 P0：截图里同一句「我说用消息的方式发给我」连着两条）。
 *
 * 现场时序（单端常态）：本地乐观插入 `user_sent`（requestID = R）→ 服务端回显 `user_echo`
 *   （后端把 requestID 序列化到 `WSMessage.ID`，`normalize.normalizeUserEcho` 已按
 *   `env.request_id ?? env.id` 正确解析 ⇒ 同一 R）→ 再 `turn_started`（把 R 绑进回合）。
 *   而 `model_step.onSend` 旧实现**无条件 append** 到 `local.pending` ⇒ 同一 R 在 pending
 *   里出现**两行** ⇒ 投影出两条 user 气泡（直到 `turn_started` 才一起退役 —— 用户看到的
 *   就是"发出去的一瞬间弹出两个"）。
 *
 * 权威语义（web `chat/reduce.ts:1822-1838`，逐字同源）：
 *   ① 该 R 已绑定到某回合的 `user` ⇒ **零副作用**返回；
 *   ② pending 里已有同 R 行 ⇒ **就地替换**（清 sending、回填 dbID，保留原 `id`），绝不新增；
 *   ③ 才允许 append。
 *
 * ⛔ mutation 自证：把 `onSend` 改回无条件 append ⇒ ① 红（`got 2 want 1`）；
 *   去掉"已绑定则零副作用"⇒ ② 红；把同 R 替换改成"追加"⇒ ③ 红。
 */
export {};

declare const process: { exit: (c: number) => void };

import { ModelFeed } from './model_harness';
import type { ChatRow } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function userRows(rows: ChatRow[]): ChatRow[] {
  return rows.filter((r: ChatRow) => r.role === 'user');
}

function sent(content: string, requestID: string): unknown {
  return {
    type: 'user_sent',
    row: { id: `opt-${requestID}`, content, timestamp: 't', isNotification: false, queued: false, sending: true, requestID },
  };
}

/** `user_echo` 的 **DomainEvent** 形状（与 `normalize.normalizeUserEcho` 产物一致）。 */
function echo(content: string, requestID: string, turn: number): unknown {
  return {
    type: 'user_echo',
    row: {
      id: `echo-${requestID}`,
      content,
      timestamp: 't',
      isNotification: false,
      queued: false,
      sending: false,
      requestID,
      turnHint: turn > 0 ? turn : undefined,
      dbID: undefined,
    },
  };
}

// ── ① 乐观行 + 回显（同 R）⇒ 只有一条气泡 ─────────────────────────────────────
{
  const f = new ModelFeed('chat_send1');
  f.push(sent('我说用消息的方式发给我', 'r1'));
  eq('① 乐观行 1 条', userRows(f.rows()).length, 1);
  f.push(echo('我说用消息的方式发给我', 'r1', 0));
  eq('①b 回显到达后仍只有 1 条（不得 2 条）', userRows(f.rows()).length, 1);
}

// ── ② 已绑定回合后再来回显 ⇒ 零副作用 ────────────────────────────────────────
{
  const f = new ModelFeed('chat_send2');
  f.push(sent('hi', 'r2'));
  f.push({ type: 'turn_started', turnID: 1, requestID: 'r2', trigger: 'user', content: 'hi' });
  eq('② 绑定后 1 条', userRows(f.rows()).length, 1);
  f.push(echo('hi', 'r2', 1));
  eq('②b 迟到回显不得再造一条', userRows(f.rows()).length, 1);
}

// ── ③ 回显先到、乐观行后到 ⇒ 仍是 1 条（就地替换，不追加）────────────────────
{
  const f = new ModelFeed('chat_send3');
  f.push(echo('hi', 'r3', 0));
  eq('③ 回显 1 条', userRows(f.rows()).length, 1);
  f.push(sent('hi', 'r3'));
  eq('③b 乐观行到达后仍 1 条', userRows(f.rows()).length, 1);
}

// ── ④ 不同 requestID 的两条真消息 ⇒ 2 条（不得误合并）────────────────────────
{
  const f = new ModelFeed('chat_send4');
  f.push(sent('第一条', 'r4a'));
  f.push(sent('第二条', 'r4b'));
  eq('④ 两条真消息各一行', userRows(f.rows()).length, 2);
}

// ── ⑤ 同文重复发送（不同 R）⇒ 必须保留两条（不得按内容去重）──────────────────
{
  const f = new ModelFeed('chat_send5');
  f.push(sent('继续', 'r5a'));
  f.push(sent('继续', 'r5b'));
  eq('⑤ 同内容不同 R ⇒ 两条', userRows(f.rows()).length, 2);
}

console.log(`user_send_idempotent: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

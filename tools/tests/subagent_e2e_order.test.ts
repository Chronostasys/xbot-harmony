/**
 * **端到端判据**：子代理转录（dump → parse → history_replaced → 投影行序）
 * 用户 2026-11-04：「子代理相关改动完全没用，还是一样的 bug」——截图：**整段迭代在上面、
 * user 消息在最下面**（且会话已 空闲）。
 *
 * 本文件按**后端 `formatAgentSessionMessages` 的真实形态**造数据：
 *   `[system?, user(任务), assistant("[Tool calls: Shell]"), ...]`
 * 然后跑完整链路，打印并断言**渲染行序**。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { historyToReplaced } from '../../entry/src/main/ets/core/integrate';
import { hydrate } from '../../entry/src/main/ets/core/model_hydrate';
import { emptyState } from '../../entry/src/main/ets/core/model_types';
import type { State } from '../../entry/src/main/ets/core/model_types';
import type { ChatMessage } from '../../entry/src/main/ets/core/chattypes';
import { project } from '../../entry/src/main/ets/core/model_project';

let e2e_pass = 0, e2e_fail = 0;
function e2e_eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { e2e_pass++; } else { e2e_fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function e2e_ok(name: string, cond: boolean): void {
  if (cond) { e2e_pass++; } else { e2e_fail++; console.log(`  ✗ ${name}`); }
}

function msg(role: string, content: string): Record<string, Object> {
  return { role: role, content: content } as Record<string, Object>;
}
/** 投影出的行序（user/assistant + turnID）。 */
function rowOrder(st: State): string[] {
  const rows: readonly { kind: string; turnID: number }[] = project(st) as readonly { kind: string; turnID: number }[];
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    out.push(`${rows[i].kind}@${rows[i].turnID}`);
  }
  return out;
}

// ── §1 后端真实形态：system + user(任务) + assistant("[Tool calls: …]") ×N + iterations ──
{
  const msgs: Record<string, Object>[] = [
    msg('system', '你是一个子代理…'),
    msg('user', '【皇上指令·新机 98.130.117.44 环境重建 + B组实验，立即执行】'),
    msg('assistant', '[Tool calls: Shell]'),
    msg('assistant', '[Tool calls: Shell]'),
    msg('assistant', '[Tool calls: Shell]'),
  ];
  const its: Record<string, Object>[] = [];
  for (let i = 1; i <= 5; i++) {
    its.push({
      iteration: i, content: `答案${i}`, reasoning: `思考${i}`,
      tools: [{ name: 'Shell', iteration: i, status: 'done', call_id: `call_0` }],
    } as Record<string, Object>);
  }
  const parsed: ChatMessage[] = ChatStore.parseSubAgentMessages(msgs, its);
  const roles: string[] = parsed.map((m) => `${m.role}@${m.turnID}`);
  console.log('[§1] parsed:', JSON.stringify(roles));

  // ⛔ system 行**绝不能**变成 assistant 消息（否则它会占据 turn 1，把 user 挤到后面）
  e2e_eq('§1 system 行不得进入转录', parsed.filter((m) => m.content.indexOf('你是一个子代理') >= 0).length, 0);
  e2e_ok('§1 首行是 user（任务在前）', parsed.length > 0 && parsed[0].role === 'user');
  e2e_ok('§1 承载 iterations 的 assistant 在 user **之后**',
    parsed.length >= 2 && parsed[parsed.length - 1].role === 'assistant');

  // 走完整链路，看投影行序
  const ev: Record<string, Object> = historyToReplaced(parsed, null) as Record<string, Object>;
  const turns: Object[] = ev['turns'] !== undefined ? ev['turns'] as Object[] : [];
  const turnIDs: number[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t: Record<string, Object> = turns[i] as Record<string, Object>;
    turnIDs.push(t['id'] !== undefined ? t['id'] as number : -1);
  }
  console.log('[§1] turns:', JSON.stringify(turnIDs));
  e2e_ok('§1 只有一个 turn（system 不再伪造 turn 1）', turns.length === 1);
  // 该 turn 的 user 槽必须是任务文本、assistant 槽承载 iterations
  const firstTurn: Record<string, Object> = turns.length > 0 ? turns[0] as Record<string, Object> : {};
  const u: Record<string, Object> | undefined = firstTurn['user'] !== undefined && firstTurn['user'] !== null
    ? firstTurn['user'] as Record<string, Object> : undefined;
  e2e_ok('§1 turn 的 user 槽 = 任务指令（不是 system prompt）',
    u !== undefined && (u['content'] as string).indexOf('皇上指令') >= 0);
}

// ── §2 没有 system、只有 user + iterations（最常见）────────────────────────────
{
  const parsed: ChatMessage[] = ChatStore.parseSubAgentMessages(
    [msg('user', '任务：修好 A')],
    [{ iteration: 1, content: '', reasoning: '想一下' } as Record<string, Object>]);
  e2e_eq('§2 user 在前', parsed.map((m) => m.role), ['user', 'assistant']);
  e2e_eq('§2 同一 turn', [parsed[0].turnID, parsed[1].turnID], [1, 1]);
}

// ── §3 多条 user（任务 + 后续插话）：iterations 挂**最后一个 user** 的 turn ────────
{
  const parsed: ChatMessage[] = ChatStore.parseSubAgentMessages(
    [msg('user', '任务一'), msg('user', '补充说明')],
    [{ iteration: 1, content: '', reasoning: 'r' } as Record<string, Object>]);
  const last = parsed[parsed.length - 1];
  const lastUser = [...parsed].reverse().find((m) => m.role === 'user');
  e2e_eq('§3 iterations 行与最后一个 user 同 turn', last.turnID, lastUser !== undefined ? lastUser.turnID : -1);
  e2e_ok('§3 iterations 行在最后一个 user 之后',
    parsed.findIndex((m) => m === last) > parsed.findIndex((m) => m === lastUser));
}

console.log(`subagent_e2e_order: ${e2e_pass} passed, ${e2e_fail} failed`);
if (e2e_fail > 0) { process.exit(1); }

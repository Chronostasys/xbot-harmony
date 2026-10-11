/**
 * rewind 目标解析（`core/msgops.ets:rewindTargetDBID`）的判别力测试。
 *
 * 逐字对齐 web `web/src/components/agent/rewind.ts:33 resolveUserMessageDBID`：
 *   · turnID>0 ⇒ `turnID + content` 精确匹配（不跨 turn 猜）；
 *   · turnID=0（附件展开回声）⇒ 按 content **反向**扫，取**最新**一条同内容（否则内容重复时回退到错误位置）。
 * 另锁死 `/api/history/rewind` 请求体字段（服务端 `DisallowUnknownFields`，多一个字段就 400）。
 *
 * ⚠️ 结尾必须 process.exit（`tools/tests/run.sh` 用 set -e 且逐文件 node）。
 */
declare const process: { exit: (c: number) => void };

import { rewindTargetDBID, RewindTarget, RewindReq } from '../../entry/src/main/ets/core/msgops';
import { ChatMessage } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function row(role: string, turnID: number, content: string, dbID?: number): ChatMessage {
  return { role, turnID, content, dbID } as unknown as ChatMessage;
}

// DB id 升序的历史快照（含 assistant 行、重复内容、turnID=0 回声、缺 dbID 行）
const rows: ChatMessage[] = [
  row('user', 1, 'hello', 10),
  row('assistant', 1, 'hi', 11),
  row('user', 2, 'dup', 20),
  row('assistant', 2, 'a2', 21),
  row('user', 2, 'dup', 30),            // 同内容、更新的 DB id
  row('user', 0, 'dup', 40),            // 附件展开回声（turnID=0）
  row('assistant', 3, 'x', 50),
  row('user', 3, 'no-db', undefined),   // 缺 dbID ⇒ 不可用
];

// ① turnID 精确匹配（且必须 content 一致）
eq('turnID 精确命中', rewindTargetDBID(rows, new RewindTarget(1, 'hello', 'user')), 10);
eq('turnID 命中但 content 不符 ⇒ 0（不猜）', rewindTargetDBID(rows, new RewindTarget(1, 'HELLO', 'user')), 0);
eq('turnID 不存在 ⇒ 0', rewindTargetDBID(rows, new RewindTarget(99, 'hello', 'user')), 0);
eq('role 过滤（assistant 行不算）', rewindTargetDBID(rows, new RewindTarget(1, 'hi', 'assistant')), 0);

// ② ★ turnID=0 ⇒ 反向扫取**最新**同内容（正向扫会命中 20 ⇒ 本断言红）
eq('turnID=0 反向扫取最新同内容', rewindTargetDBID(rows, new RewindTarget(0, 'dup', 'user')), 40);

// ③ 缺 dbID 的行不可用
eq('缺 dbID 的行 ⇒ 0', rewindTargetDBID(rows, new RewindTarget(3, 'no-db', 'user')), 0);

// ④ turnID=0 且内容不在快照 ⇒ 0
eq('turnID=0 内容不存在 ⇒ 0', rewindTargetDBID(rows, new RewindTarget(0, 'nope', 'user')), 0);

// ⑤ 空快照（尚未落库）⇒ 0
eq('空快照 ⇒ 0', rewindTargetDBID([], new RewindTarget(1, 'hello', 'user')), 0);

// ⑥ 请求体逐字对齐服务端 `{channel, chat_id, history_id}`
const req = new RewindReq('web', 'chat_1', 42);
eq('rewind body 字段集', Object.keys(req).sort(), ['channel', 'chat_id', 'history_id']);
eq('rewind body 值', JSON.stringify(req),
  JSON.stringify({ channel: 'web', chat_id: 'chat_1', history_id: 42 }));

if (fail > 0) { console.log(`  msgops_rewind: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  msgops_rewind: ${pass} passed, 0 failed`);
process.exit(0);

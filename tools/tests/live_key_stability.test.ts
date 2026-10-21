/**
 * live 子树 key 生命周期（2026-10-20 用户：spinner/思考数字在无 Markdown 时也卡）。
 *
 * trace: ThinkingLine Build/Destroy≈2/frame、MarkdownView≈1/frame、ToolPill≈3/frame。
 * 根因是 `ForEach` key 含会变的 `rev`/gen_chars/status ⇒ 每 tick 销毁重建子树，spinner
 * 动画不断重启。迭代块 key 必须只含稳定身份；工具 pill 的流式 chip 另走显式 key 更新。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
const row = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/components/MessageRow.ets'), 'utf8');
const tail = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/components/LiveTailView.ets'), 'utf8');
const rowKey = row.match(/\(it: HistoryIteration\) => `\$\{this\.row\.id\}#\$\{it\.iteration\}[^`]*`/);
const keyText = rowKey ? rowKey[0] : '';
ok('迭代块 key 不含 it.rev（稳定身份）', keyText.length > 0 && !keyText.includes('it.rev'));
ok('迭代块 key 仍区分 live/committed', keyText.includes("it.live === true ? 'L' : 'C'"));
ok('ToolPill key 保留流式 chip 更新字段（status/gen_chars）',
  /t\.gen_chars/.test(tail) && /t\.status/.test(tail));
console.log(`live_key_stability: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};

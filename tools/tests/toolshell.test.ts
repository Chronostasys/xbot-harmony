/**
 * shell 工具输出语义 + 「转后台」判定门禁 —— **逐字移植** web
 * `src/components/agent/ToolRender.tsx` 的 `parseShell()`（349-394）与
 * `ShellPromoteBar`（483-551）。本文件守护 `core/toolshell.ets` 的纯函数（UI 只消费结果）。
 *
 * 判别力重点（都是"容易写错且写错了看不出来"的点）：
 *  · task id **锚定首行**（在剥头部标记之前）—— 后置/不锚定会把普通输出里的字面量误判成后台任务；
 *  · `[EXIT n] <command>` 的**命令同行剥离**只在命令一致时发生（否则会吞掉正文首行）；
 *  · `canPromote` 必须**含 pending/generating**（web 2026-09-14 亲报的 bug：「我确定是 running，
 *    没渲染转后台按钮」）；
 *  · RPC 参数**字段名逐字**对齐服务端（`session_key` / `tool_call_id`）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  NO_EXIT_CODE, PromoteShellParams, PromoteShellResult, SHELL_TOOL_NAME, ShellParsed,
  canPromoteShell, parseShellText, promoteSessionKey, shellCommandOfLabel,
} from '../../entry/src/main/ets/core/toolshell';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 常量 ─────────────────────────────────────────────────────────────────────
eq('工具名 = web case 分支（"Shell"）', SHELL_TOOL_NAME, 'Shell');
eq('无退出码哨兵 = -1', NO_EXIT_CODE, -1);

// ── parseShellText：干净输出 ─────────────────────────────────────────────────
{
  const p: ShellParsed = parseShellText('done\n');
  eq('普通输出：不误判 promoted', p.promoted, false);
  eq('普通输出：无 task id', p.bgTask, '');
  eq('普通输出：无退出码', p.exitCode, NO_EXIT_CODE);
  eq('普通输出：不误判 timeout', p.timeout, false);
  eq('普通输出：正文 trimEnd（web text.trimEnd()）', p.output, 'done');
}
{
  const p: ShellParsed = parseShellText('line1\nline2');
  eq('多行正文原样保留（绝不吞正文）', p.output, 'line1\nline2');
}

// ── parseShellText：退出码 `[EXIT n] cmd\\nout` ───────────────────────────────
{
  const p: ShellParsed = parseShellText('[EXIT 0] echo hi\nhi', 'echo hi');
  eq('[EXIT 0] 退出码', p.exitCode, 0);
  eq('[EXIT 0] **命令同一行被剥掉**（web 行为）', p.output, 'hi');
}
{
  const p: ShellParsed = parseShellText('[EXIT 1] sleep 5\nboom', 'sleep 5');
  eq('[EXIT 1] 退出码', p.exitCode, 1);
  eq('[EXIT 1] 命令一致 ⇒ 剥掉命令行', p.output, 'boom');
}
{
  const p: ShellParsed = parseShellText('[EXIT 1] other cmd\nboom', 'sleep 5');
  eq('[EXIT 1] 命令**不一致** ⇒ 保留该行（不吞正文）', p.output, 'other cmd\nboom');
}
{
  const p: ShellParsed = parseShellText('[EXIT -2] x\ny', 'x');
  eq('[EXIT -2] 负退出码可解析', p.exitCode, -2);
  eq('[EXIT -2] 命令一致 ⇒ 剥掉命令行', p.output, 'y');
}

// ── parseShellText：超时（真实服务端格式，`tools/shell.go:397`）────────────────
{
  const text: string = '[TIMEOUT after 2m0s] Command timed out. Auto-promoted to background task '
    + '[task_id: "f6695704"]\nPartial output before timeout:\nbuild...';
  const p: ShellParsed = parseShellText(text);
  eq('超时标记', p.timeout, true);
  eq('超时行的 task id 也被抽到（同样进 BgTask）', p.bgTask, 'f6695704');
  eq('超时行被剥掉、partial 正文保留', p.output, 'Partial output before timeout:\nbuild...');
}
{
  const p: ShellParsed = parseShellText('[TIMEOUT after 30s]');
  eq('只有超时行 ⇒ 正文为空', p.output, '');
}

// ── parseShellText：已转后台（真实服务端格式，`tools/shell.go:392`）────────────
{
  const text: string = '[PROMOTED to background by user] Command moved to the background '
    + '[task_id: "9adfa651"]\nPartial output so far:\nok';
  const p: ShellParsed = parseShellText(text);
  eq('promoted 标记', p.promoted, true);
  // ⛔ 关键：task id 与标题**同一行**（首行）—— 必须在剥标题**之前**提取
  eq('promoted 同行的 task id 被抽到', p.bgTask, '9adfa651');
  eq('剥标题后保留 partial 正文', p.output, 'Partial output so far:\nok');
  eq('promoted 不写退出码', p.exitCode, NO_EXIT_CODE);
}

// ── parseShellText：task id 首行锚定（web 的核心防误判） ──────────────────────
{
  const p: ShellParsed = parseShellText('[task_id: "bg-123"]\noutput');
  eq('首行 task id 被抽出', p.bgTask, 'bg-123');
}
{
  // ⛔ 反向用例：id 出现在**非首行** ⇒ 不算（普通命令输出里的字面量，web 明确要求不误判）
  const p: ShellParsed = parseShellText('command output\nsee [task_id: "bg-123"] here');
  eq('非首行 task id **不**被抽（防误判）', p.bgTask, '');
}
{
  const p: ShellParsed = parseShellText('Background task running: bg:xyz\nout');
  eq('旧格式 `Background task running: bg:xxx` 也识别', p.bgTask, 'bg:xyz');
}
{
  const p: ShellParsed = parseShellText('Background task running: not-a-bg-id\n');
  eq('旧格式但 id 不合 `bg:` 前缀 ⇒ 不识别', p.bgTask, '');
}

// ── canPromoteShell（web `ShellRender:445` × `ShellPromoteBar:489`）──────────
eq('Shell + running + callID ⇒ 可转', canPromoteShell('Shell', 'running', 'call_1'), true);
eq('Shell + **pending** + callID ⇒ 可转（web 亲报 bug 的修法）', canPromoteShell('Shell', 'pending', 'call_1'), true);
eq('Shell + **generating** + callID ⇒ 可转（同上）', canPromoteShell('Shell', 'generating', 'call_1'), true);
eq('Shell + done ⇒ 不可转', canPromoteShell('Shell', 'done', 'call_1'), false);
eq('Shell + error ⇒ 不可转', canPromoteShell('Shell', 'error', 'call_1'), false);
eq('Shell + running 但**无 callID** ⇒ 不可转（web `callID !== 空`）', canPromoteShell('Shell', 'running', ''), false);
eq('**非 Shell**（Read）+ running + callID ⇒ 不可转', canPromoteShell('Read', 'running', 'call_1'), false);
eq('空工具名 ⇒ 不可转', canPromoteShell('', 'running', 'call_1'), false);

// ── 会话键（面板所见 `channel:chatID`）─────────────────────────────────────
eq('会话键 = `channel:chatID`', promoteSessionKey('web', 'abc123'), 'web:abc123');
eq('会话键不做 trim/改写（逐字透传）', promoteSessionKey('agent', 'role/inst'), 'agent:role/inst');

// ── shellCommandOfLabel（web `shellCommand` 的标签分支）──────────────────────
eq('剥 `Shell: ` 前缀', shellCommandOfLabel('Shell: sleep 40; echo done'), 'sleep 40; echo done');
eq('无前缀 ⇒ 原样', shellCommandOfLabel('weird label'), 'weird label');
eq('空标签 ⇒ 空串', shellCommandOfLabel(''), '');
eq('只剥**前缀**（中间的不动）', shellCommandOfLabel('Shell: a Shell: b'), 'a Shell: b');

// ── RPC 参数/响应（字段名逐字对齐服务端 `rpc_table.go:1854-1868`）────────────
{
  const p: PromoteShellParams = new PromoteShellParams('web:abc', 'call_9');
  eq('PromoteShellParams 序列化 = 服务端契约', JSON.parse(JSON.stringify(p)),
    { session_key: 'web:abc', tool_call_id: 'call_9' });
}
{
  const r: PromoteShellResult = new PromoteShellResult();
  eq('PromoteShellResult 默认 ok=false（未赋值不静默成功）', r.ok, false);
  eq('PromoteShellResult 默认 task_id 空', r.task_id, '');
}

console.log(`\n  toolshell: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};

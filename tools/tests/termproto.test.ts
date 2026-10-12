/**
 * 终端线协议门禁 —— 守护 `core/termproto.ets`（终端列表行 + WS 编解码）。
 *
 * 为什么需要它：这些字符串**直接**发给服务端 PTY / 直接解释服务端帧。错一个键名、
 * 错一个 base64，终端就"连上了却什么都不发生"，且**静默**（无异常、无日志）。逐条钉死。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`）。
 */
declare const process: { exit: (c: number) => void };

import {
  TermMsg, TerminalInfo, TERM_CLOSE_MSG, TERM_CONNECTED, TERM_CONNECTING, TERM_ERROR, TERM_EXITED,
  encodeResize, encodeStdin, parseTermMsg, terminalAgeText, terminalPrimary, terminalSubText, terminalStatusRole,
  terminalStatusText, terminalTitle, termWsUrl,
} from '../../entry/src/main/ets/core/termproto';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function info(tid: string, cwd: string, createdAt: string): TerminalInfo {
  const t = new TerminalInfo();
  t.tid = tid; t.cwd = cwd; t.createdAt = createdAt;
  return t;
}

const NOW = Date.parse('2026-10-12T12:00:00Z');

// ── 标题 / 时长 / 列表行 ─────────────────────────────────────────────────────
eq('标题取 cwd 末段', terminalTitle(info('t-1', '/Users/bobli/src/xbot-harmony', '')), 'xbot-harmony');
eq('尾斜杠也取到末段', terminalTitle(info('t-1', '/Users/bobli/src/', '')), 'src');
eq('空 cwd 回退 tid', terminalTitle(info('t-9', '', '')), 't-9');
eq('根目录无末段回退原串', terminalTitle(info('t-9', '/', '')), '/');

eq('30 秒', terminalAgeText(info('t', '/x', '2026-10-12T11:59:30Z'), NOW), '30s');
eq('5 分钟', terminalAgeText(info('t', '/x', '2026-10-12T11:55:00Z'), NOW), '5m');
eq('2 小时', terminalAgeText(info('t', '/x', '2026-10-12T10:00:00Z'), NOW), '2h');
eq('3 天', terminalAgeText(info('t', '/x', '2026-10-09T12:00:00Z'), NOW), '3d');
eq('坏时间戳 ⇒ 空', terminalAgeText(info('t', '/x', 'not-a-date'), NOW), '');

eq('终端主行 = cwd 末段', terminalPrimary(info('t', '/a/proj', '2026-10-12T11:55:00Z')), 'proj');
eq('终端主行缺 cwd 回落 tid', terminalPrimary(info('t9', '', '')), 't9');
// ⛔ 批次10：副行 = **完整 cwd · 时长**（此前单行 `proj · 5m` 把标识与元信息挤在一起）
eq('终端副行 = cwd · 时长', terminalSubText(info('t', '/a/proj', '2026-10-12T11:55:00Z'), NOW), '/a/proj · 5m');
eq('终端副行缺 createdAt 只剩 cwd', terminalSubText(info('t', '/a/proj', ''), NOW), '/a/proj');
eq('终端副行缺 cwd 只剩时长', terminalSubText(info('t', '', '2026-10-12T11:55:00Z'), NOW), '5m');
eq('终端副行全空', terminalSubText(info('t', '', ''), NOW), '');

// ── 状态 ─────────────────────────────────────────────────────────────────────
eq('连接中文案', terminalStatusText(TERM_CONNECTING, -1), '连接中');
eq('已连接文案', terminalStatusText(TERM_CONNECTED, -1), '已连接');
eq('退出码浮现', terminalStatusText(TERM_EXITED, 130), '已退出（130）');
eq('无码退出', terminalStatusText(TERM_EXITED, -1), '已退出');
eq('失败文案', terminalStatusText(TERM_ERROR, -1), '连接失败');

eq('连接中 role = waiting', terminalStatusRole(TERM_CONNECTING), 'statusWaiting');
eq('已连接 role = success', terminalStatusRole(TERM_CONNECTED), 'successText');
eq('失败 role = danger', terminalStatusRole(TERM_ERROR), 'dangerText');
eq('退出/关闭 role = iconMuted', terminalStatusRole(TERM_EXITED), 'iconMuted');
eq('未知状态也落 iconMuted', terminalStatusRole('whatever'), 'iconMuted');

// ── 解析服务端帧 ────────────────────────────────────────────────────────────
{
  const m: TermMsg = parseTermMsg('{"type":"stdout","data":"TWFu"}');
  eq('stdout 帧', [m.kind, m.data], ['stdout', 'TWFu']);
}
{
  const m: TermMsg = parseTermMsg('{"type":"exit","code":130}');
  eq('exit 帧', [m.kind, m.code], ['exit', 130]);
}
{
  const m: TermMsg = parseTermMsg('{"type":"error","message":"terminal not found"}');
  eq('error 帧', [m.kind, m.message], ['error', 'terminal not found']);
}
eq('坏 JSON 不抛 ⇒ unknown', parseTermMsg('{not json').kind, 'unknown');
eq('未知 type 原样', parseTermMsg('{"type":"weird"}').kind, 'weird');

// ── 编码客户端帧（用 JSON.parse 反解，钉死结构）──────────────────────────────
{
  const o = JSON.parse(encodeStdin('Man')) as Record<string, string>;
  eq('stdin 帧 type', o['type'], 'stdin');
  eq('stdin 帧 payload = UTF-8 的 base64', o['data'], 'TWFu');
}
{
  const o = JSON.parse(encodeStdin('中')) as Record<string, string>;
  eq('stdin 中文按 UTF-8 编 base64', o['data'], '5Lit');
}
{
  const o = JSON.parse(encodeResize(120, 40)) as Record<string, number>;
  eq('resize 帧', [o['type'], o['cols'], o['rows']], ['resize', 120, 40]);
}
{
  const o = JSON.parse(TERM_CLOSE_MSG) as Record<string, string>;
  eq('close 帧', o['type'], 'close');
}

// ── WS URL ───────────────────────────────────────────────────────────────────
eq('http ⇒ ws', termWsUrl('http://localhost:8082', 't-123'), 'ws://localhost:8082/ws/terminal?tid=t-123');
eq('https ⇒ wss', termWsUrl('https://a.example', 't-9'), 'wss://a.example/ws/terminal?tid=t-9');

console.log(`termproto.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

/**
 * 命令路由 / 深链门禁 —— 守护 `core/command.ets`（web `lib/commandRouter.ts` `parseUri` 的移植）。
 *
 * 判别力自证（改动下列任一锚点 ⇒ 必红）：
 *   · 不剥前缀首斜杠（`xbot://foo` 得到 `/foo`）      ⇒ 'xbot:// 剥斜杠' 红
 *   · id 不去尾斜杠                                   ⇒ 'id 去尾斜杠' 红
 *   · 空 id 返回动作而不是 null                        ⇒ '空 id ⇒ null' 红
 *   · 不做百分号解码 / 不把 '+' 当空格                 ⇒ '参数解码' 红
 *   · `commandIdValid` 放宽到无点也算合法              ⇒ 'id 必须点号命名空间' 红
 *
 * ⚠️ 结尾必须 `process.exit(...)`。
 */
declare const process: { exit: (c: number) => void };

import {
  COMMAND_SCHEME, COMMAND_HASH_PREFIX, CommandAction,
  parseCommandUri, isCommandUri, commandNamespace, commandIdValid, commandActionValid, commandArg,
} from '../../entry/src/main/ets/core/command';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function act(a: CommandAction | null): unknown {
  return a === null ? null : { id: a.id, args: a.args };
}

// ── 常量契约 ──────────────────────────────────────────────────────────────────
eq('scheme = xbot:', COMMAND_SCHEME, 'xbot:');
eq('hash 前缀 = /command/', COMMAND_HASH_PREFIX, '/command/');

// ── 三种等价写法（web 头注明列的形态）────────────────────────────────────────
eq('xbot:// 剥斜杠 + 参数', act(parseCommandUri('xbot://settings.open?section=llm')),
  { id: 'settings.open', args: { section: 'llm' } });
eq('xbot: 单冒号', act(parseCommandUri('xbot:settings.open?section=llm')),
  { id: 'settings.open', args: { section: 'llm' } });
eq('/command/ 前缀', act(parseCommandUri('/command/settings.open?section=llm')),
  { id: 'settings.open', args: { section: 'llm' } });
eq('三形态同解析', [
  JSON.stringify(act(parseCommandUri('xbot://a.b?x=1'))),
  JSON.stringify(act(parseCommandUri('xbot:a.b?x=1'))),
  JSON.stringify(act(parseCommandUri('/command/a.b?x=1'))),
], ['{"id":"a.b","args":{"x":"1"}}', '{"id":"a.b","args":{"x":"1"}}', '{"id":"a.b","args":{"x":"1"}}']);

// ── 无参数 / 多参数 / 尾斜杠 ──────────────────────────────────────────────────
eq('无参数 ⇒ 空 args', act(parseCommandUri('xbot://panel.open')), { id: 'panel.open', args: {} });
eq('id 去尾斜杠', act(parseCommandUri('xbot://settings.open/')), { id: 'settings.open', args: {} });
eq('多参数保序', act(parseCommandUri('xbot://a.b?x=1&y=2')), { id: 'a.b', args: { x: '1', y: '2' } });

// ── 参数解码（百分号 + '+' 当空格），对齐 URLSearchParams ───────────────────────
eq('百分号解码', commandArg(parseCommandUri('xbot://a.b?path=%2Fusr%2Fbin') as CommandAction, 'path'), '/usr/bin');
eq('+ 当空格', commandArg(parseCommandUri('xbot://a.b?q=hello+world') as CommandAction, 'q'), 'hello world');
eq('中文参数解码', commandArg(parseCommandUri('xbot://a.b?name=%E8%AE%BE%E7%BD%AE') as CommandAction, 'name'), '设置');
eq('无值参数 ⇒ 空串', commandArg(parseCommandUri('xbot://a.b?flag') as CommandAction, 'flag'), '');
eq('空段忽略', act(parseCommandUri('xbot://a.b?a=1&&b=2&')), { id: 'a.b', args: { a: '1', b: '2' } });
// 非法百分号序列不抛、不吞
{
  let threw = false;
  let v = '';
  try {
    const a = parseCommandUri('xbot://a.b?bad=%E0%A4%A');
    v = a === null ? 'NULL' : commandArg(a, 'bad');
  } catch (e) { threw = true; }
  eq('非法百分号不抛', threw, false);
}

// ── null 路径（不是命令 URI / 空 id）───────────────────────────────────────────
eq('普通 URL ⇒ null', parseCommandUri('https://example.com'), null);
eq('裸路径 ⇒ null', parseCommandUri('/settings/open'), null);
eq('xbot:// 空体 ⇒ null', parseCommandUri('xbot://'), null);
eq('xbot: 空体 ⇒ null', parseCommandUri('xbot:'), null);
eq('/command/ 空体 ⇒ null', parseCommandUri('/command/'), null);
eq('xbot://?x=1 空 id ⇒ null', parseCommandUri('xbot://?x=1'), null);
eq('null 入参 ⇒ null', parseCommandUri(null as unknown as string), null);
eq('isCommandUri 真', isCommandUri('xbot://a.b'), true);
eq('isCommandUri 假', isCommandUri('https://a.b'), false);

// ── 命名空间 / id 校验 ────────────────────────────────────────────────────────
eq('命名空间', commandNamespace('settings.open'), 'settings');
eq('无点 ⇒ 空命名空间', commandNamespace('open'), '');
eq('合法 id', commandIdValid('settings.open'), true);
eq('合法 id（多段）', commandIdValid('plugin.panel.open'), true);
eq('id 必须点号命名空间', commandIdValid('open'), false);
eq('空 id 非法', commandIdValid(''), false);
eq('前导点非法', commandIdValid('.open'), false);
eq('尾点非法', commandIdValid('open.'), false);
eq('连续点非法', commandIdValid('a..b'), false);
eq('非法字符非法', commandIdValid('a.b c'), false);
eq('斜杠非法', commandIdValid('a/b.c'), false);
eq('action 校验：null 假', commandActionValid(null), false);
eq('action 校验：合法真', commandActionValid(parseCommandUri('xbot://settings.open')), true);

console.log(`  command: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

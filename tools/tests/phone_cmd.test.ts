/**
 * 手机命令纯逻辑判据（`core/phonecmd.ts`）。
 *
 * 钉死一个真实踩过的坑：`commandUrl()` 曾把 `https://host:8082` 拼成 `https://host:8791`
 * —— 命令口是**明文 HTTP**，必须强制 `http://`；这类错误在设备上只表现为"连不上"。
 *
 * mutation 自证：把 `commandUrl` 里的 `http://` 改回沿用原 scheme ⇒ §1 的 https 用例必红。
 */
declare const process: { exit: (c: number) => void };

import {
  commandUrl, parseCmd, PHONE_CMD_PORT, splitCommands,
} from '../../entry/src/main/ets/core/phonecmd';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`);
  }
}
function ok(name: string, cond: boolean): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

console.log('\n▶ §1 命令口地址推导（强制 http）');
{
  eq('§1 http 后端 → http:8791', commandUrl('http://192.168.31.8:8082'), 'http://192.168.31.8:8791');
  eq('§1 ⛔ https 后端也必须用 http（命令口是明文）',
    commandUrl('https://192.168.31.8:8443'), 'http://192.168.31.8:8791');
  eq('§1 无端口', commandUrl('http://host'), 'http://host:8791');
  eq('§1 带路径 ⇒ 丢路径', commandUrl('http://host:8082/api/x'), 'http://host:8791');
  eq('§1 空 base ⇒ 空串（调用方等待）', commandUrl(''), '');
  eq('§1 端口常量 = 8791', PHONE_CMD_PORT, 8791);
  ok('§1 结果永不含 https://', commandUrl('https://h:1').indexOf('https://') < 0);
}

console.log('\n▶ §2 /poll 响应切分');
{
  const body: string = '{"commands":[{"id":"cmd-1","tool":"phone_tap","args":{"x":10,"y":20}},'
    + '{"id":"cmd-2","tool":"phone_input_text","args":{"text":"你好,世界"}}]}';
  const items: string[] = splitCommands(body);
  eq('§2 切出两条', items.length, 2);
  ok('§2 第一条含 cmd-1', items[0].indexOf('cmd-1') >= 0);
  ok('§2 第二条含中文文本', items[1].indexOf('你好,世界') >= 0);
  eq('§2 空响应 ⇒ 0 条', splitCommands('{"commands":[]}').length, 0);
  eq('§2 非 JSON ⇒ 0 条', splitCommands('oops').length, 0);
}

console.log('\n▶ §3 命令字段解析');
{
  const raw: string = '{"id":"cmd-9","tool":"phone_swipe","args":{"x1":1,"y1":2,"x2":3,"y2":4,"text":"a\\"b"}}';
  const c = parseCmd(raw);
  eq('§3 id', c.id, 'cmd-9');
  eq('§3 tool', c.tool, 'phone_swipe');
  eq('§3 x1', c.x1, 1);
  eq('§3 y2', c.y2, 4);
  eq('§3 缺失字段 ⇒ NaN', Number.isNaN(c.code), true);
  eq('§3 转义引号', c.text, 'a"b');
}

console.log(`\n=== phone_cmd: ${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
export {};

/**
 * 通知**按会话分组**（缺口 #1）判别力测试。
 * SDK 依据：`notificationRequest.d.ts:331-340` —— 同 `groupName` 归一组，**上限 202 字节**超额截断；
 * 全文件**无** `groupSummary`/`isGroupSummary` ⇒ 系统自动分组，无需另发摘要。
 * mutation：把 `groupName: notifyGroupOf(chatId)` 改回常量直传 ⇒ 形态断言红；派生函数改成常量 ⇒ 值断言红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
import { notifyGroupOf, clampGroupName, utf8Len, GROUP_NAME_MAX_BYTES } from '../../entry/src/main/ets/core/notify';

let pass = 0, fail = 0;
function eq(n: string, g: unknown, w: unknown): void {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) { pass++; } else { fail++; console.log(`  ✗ ${n}\n      got  ${a}\n      want ${b}`); }
}
function ok(n: string, c: boolean): void { if (c) { pass++; } else { fail++; console.log(`  ✗ ${n}`); } }

eq('同 chatId ⇒ 同组（幂等）', notifyGroupOf('chat_A'), notifyGroupOf('chat_A'));
ok('⛔ 不同 chatId ⇒ 不同组（这条是"每会话一组"的全部意义）', notifyGroupOf('chat_A') !== notifyGroupOf('chat_B'));
ok('组名含 chatId（可辨识）', notifyGroupOf('chat_A').indexOf('chat_A') >= 0);
ok('前缀固定（同一应用可聚）', notifyGroupOf('chat_A').indexOf('xbot') >= 0);
eq('无 chatId ⇒ 回落旧全局组（不抛、可辨识）', notifyGroupOf(''), notifyGroupOf(''));
ok('无 chatId 时不带 # 尾巴', notifyGroupOf('').indexOf('#') < 0);
ok('⛔ 派生结果 ≤ 202 字节（SDK 硬上限）', utf8Len(notifyGroupOf('chat_0123456789ABCDEF')) <= GROUP_NAME_MAX_BYTES);
eq('utf8Len 纯 ASCII', utf8Len('abc'), 3);
eq('utf8Len 中文 3 字节/字', utf8Len('会话'), 6);
eq('clamp 不超限时原样返回', clampGroupName('abc'), 'abc');
ok('clamp 超限时截到上限内', utf8Len(clampGroupName('x'.repeat(500))) <= GROUP_NAME_MAX_BYTES);
ok('clamp 不切半分多字节字符（结果仍是合法前缀）', clampGroupName('会'.repeat(100)).length % 1 === 0
  && utf8Len(clampGroupName('会'.repeat(100))) <= GROUP_NAME_MAX_BYTES);
eq('GROUP_NAME_MAX_BYTES = 202（SDK 原文）', GROUP_NAME_MAX_BYTES, 202);

// 源码形态（剥注释后计数）：防"改回常量直传"
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const fs = require('fs'), path = require('path');
const src = stripComments(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'entry', 'src', 'main', 'ets', 'core', 'notify.ets'), 'utf-8'));
eq('⛔ publish 处必须经派生函数（`groupName: notifyGroupOf(chatId)`）',
  src.split('groupName: notifyGroupOf(chatId)').length - 1, 1);
eq('⛔ 不得再有常量直传（改回即红）', src.split('groupName: NOTIFY_GROUP_NAME').length - 1, 0);
eq('⛔ 清场不得再用 cancelGroup(全局名)（per-chat 后静默失效）',
  src.split('cancelGroup(NOTIFY_GROUP_NAME)').length - 1, 0);

if (fail > 0) { console.log(`  notify_group: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify_group: ${pass} passed, 0 failed`);
process.exit(0);
export {};

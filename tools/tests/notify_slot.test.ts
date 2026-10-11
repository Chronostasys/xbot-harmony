/**
 * 通知 **slotType 分级**判别力测试（能力审计落项 #1）。
 *
 * SDK 语义（`@ohos.notificationManager.d.ts:1059-1115` 枚举）：
 *   SOCIAL_COMMUNICATION=1（社交通信 ⇒ 系统默认给**横幅+声音**）
 *   SERVICE_INFORMATION=2 / CONTENT_INFORMATION=3（内容信息 ⇒ **默认静默**）
 *   LIVE_VIEW=4 / CUSTOMER_SERVICE=5（本仓场景不需要）
 * 本仓场景：`ask`（要用户回话）⇒ 应**醒目**；`turn_done`（只是"好了"）⇒ 应**静默**。
 * ⇒ 映射必须**集中在 `slotTagFor`**，不能在 request 处按分支各写一份（否则必然漂移）。
 *
 * mutation：① 把 `ask` 映射改到 content ⇒ 'ask 走社交通信档' 红；
 *           ② 把 request 处的 `slotTypeOf(slotTagFor(kind))` 改成内联常量 ⇒ 形态断言红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
import {
  slotTagFor, NOTIFY_SLOT_SOCIAL, NOTIFY_SLOT_CONTENT, NOTIFY_KIND_ASK,
} from '../../entry/src/main/ets/core/notify';

let pass = 0, fail = 0;
function ok(n: string, c: boolean): void { if (c) { pass++; } else { fail++; console.log(`  ✗ ${n}`); } }
function eq(n: string, g: unknown, w: unknown): void {
  const a = JSON.stringify(g), b = JSON.stringify(w);
  if (a === b) { pass++; } else { fail++; console.log(`  ✗ ${n}\n      got  ${a}\n      want ${b}`); }
}

// ── 纯逻辑：档位映射（值断言 + 默认值 + 降级）──────────────────────────────────
ok('两个档位常量互异', NOTIFY_SLOT_SOCIAL !== NOTIFY_SLOT_CONTENT);
eq('⛔ ask ⇒ 社交通信档（要横幅+声音）', slotTagFor(NOTIFY_KIND_ASK), NOTIFY_SLOT_SOCIAL);
eq('turn_done ⇒ 内容信息档（静默）', slotTagFor('turn_done'), NOTIFY_SLOT_CONTENT);
eq('⛔ 未知 kind ⇒ 降级到静默档（不许误用醒目档）', slotTagFor('nope'), NOTIFY_SLOT_CONTENT);
eq('空串 ⇒ 同样降级静默', slotTagFor(''), NOTIFY_SLOT_CONTENT);
ok('映射是**纯函数**（同输入同输出）', slotTagFor('turn_done') === slotTagFor('turn_done'));

// ── 源码形态：映射**集中一处** + request 经派生（不内联）────────────────────────
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const fs = require('fs'), path = require('path');
const src = stripComments(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', '..', 'entry', 'src', 'main', 'ets', 'core', 'notify.ets'), 'utf-8'));
eq('⛔ request 处必须经派生 `slotTypeOf(slotTagFor(kind))`（内联即漂移）',
  src.split('notificationSlotType: slotTypeOf(slotTagFor(kind))').length - 1, 1);
eq('⛔ 全文件不得再出现第二种 slotType 写法（`notificationSlotType: SlotType.` 内联）',
  src.split('notificationSlotType: notificationManager.SlotType.').length - 1, 0);
ok('SOCIAL_COMMUNICATION 只在 slotTypeOf 里出现（集中映射）',
  src.split('SlotType.SOCIAL_COMMUNICATION').length - 1 === 2);   // 常量定义 1 处 + 映射 1 处
ok('CONTENT_INFORMATION 只作**降级兜底**（else 分支）',
  src.split('SlotType.CONTENT_INFORMATION').length - 1 === 2);

if (fail > 0) { console.log(`  notify_slot: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify_slot: ${pass} passed, 0 failed`);
process.exit(0);
export {};

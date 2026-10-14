/**
 * termreconnect.test.ts —— P0-2 终端断线重连判别测试（纯逻辑 + 接线形态断言）。
 *
 * 缺陷现场（2026-10-14 装机实证）：WS 断开后终端面板 6.5s 内
 * 「已连接」→「连接失败」死态，此后再无任何自愈动作（⇒ vim/REPL 会话整个报废）。
 *
 * 修复设计（对齐 web terminalWS.ts:28-31）：
 *   · backoff：500ms×2ⁿ 封顶 15s，最多 6 次（第 6 次后放弃）——本文件纯逻辑段钉死数值；
 *   · close/error 传输断 ⇒ scheduleReconnect（幂等：close+error 常成对到达只调度一次）；
 *   · 重连前 **new VtTerm(cols,rows) 整屏复位**再吃服务端 sess 级全量重放（防双重显示）；
 *   · 服务端语义终态（exit / onData error）与用户主动关**不**重连。
 *
 * 判别力：wire 段钉**调用点计数**（⛔ 死消费防护：方法存在但 0 调用点必须红）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; dirname(p: string): string };
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

import * as tpNs from '../../entry/src/main/ets/core/termproto';
const tp = tpNs as unknown as {
  reconnectDelayMs: (attempt: number) => number;
};

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

// ── 1. reconnectDelayMs 数值（web terminalWS.ts:28-31 同款曲线）──
ok(tp.reconnectDelayMs(0) === 500, 'backoff 0 → 500ms');
ok(tp.reconnectDelayMs(1) === 1000, 'backoff 1 → 1s');
ok(tp.reconnectDelayMs(2) === 2000, 'backoff 2 → 2s');
ok(tp.reconnectDelayMs(3) === 4000, 'backoff 3 → 4s');
ok(tp.reconnectDelayMs(4) === 8000, 'backoff 4 → 8s');
ok(tp.reconnectDelayMs(5) === 15000, 'backoff 5 → 封顶 15s（8×2=16s→15s）');
ok(tp.reconnectDelayMs(6) === -1, 'backoff 6 → 放弃（-1）');
ok(tp.reconnectDelayMs(7) === -1, 'backoff 7 → 放弃（-1）');
ok(tp.reconnectDelayMs(100) === -1, 'backoff 100 → 放弃');
ok(tp.reconnectDelayMs(-1) === -1, 'backoff 负数 → 放弃（不炸）');
ok(tp.reconnectDelayMs(Number.NaN) === -1, 'backoff NaN → 放弃（不炸）');

// ── 2. wire 接线断言（TerminalSheet.ets 源码形态；钉调用点计数）──
/** 爬根 idiom（run-one 编译产物令 __dirname 漂移 ⇒ 裸 ../ 会 ENOENT，实测）。 */
function repoRoot(): string {
  let root: string = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(root, 'entry', 'src', 'main', 'ets'))) {
      break;
    }
    root = path.join(root, '..');
  }
  return root;
}
const sheet = fs.readFileSync(
  path.join(repoRoot(), 'entry', 'src', 'main', 'ets', 'components', 'TerminalSheet.ets'),
  'utf8',
);

ok(sheet.includes('reconnectDelayMs') === true, 'wire: TerminalSheet 引用 backoff 函数');
const schedCalls: number = (sheet.match(/this\.scheduleReconnect\(\);/g) || []).length;
ok(schedCalls >= 2, `wire: scheduleReconnect 调用点 ≥2（close+error 双通道；实得 ${schedCalls}）`);
ok(
  /private resetTermForReplay\(\): void \{[\s\S]{0,300}new VtTerm\(/.test(sheet) === true,
  'wire: 重连前复位 = new VtTerm 整屏重建',
);
ok(
  /private teardown\(\): void \{[\s\S]{0,160}this\.cancelReconnect\(\);/.test(sheet) === true,
  'wire: teardown 撤销挂起重连',
);
ok(
  /on\('open'[\s\S]{0,400}reconnectAttempt = 0;/.test(sheet) === true,
  'wire: 连上即清零重连计数',
);
ok(
  /private scheduleReconnect\(\): void \{[\s\S]{0,400}reconnectTimer >= 0/.test(sheet) === true,
  'wire: Ⓐ 幂等守卫（重复 close/error 只调度一次）',
);
ok(
  /private cancelReconnect\(\): void \{[\s\S]{0,200}clearTimeout/.test(sheet) === true,
  'wire: cancelReconnect 真清 timer',
);

console.log(`\ntermreconnect: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

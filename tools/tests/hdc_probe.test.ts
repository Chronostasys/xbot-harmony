/**
 * hdc 自连探针 —— 判定逻辑判据（用户 2026-11-08：「搞个临时 app 测一下试试看」）。
 *
 * 判据必红样本：本文件首次运行前 `core/hdcprobe.ts` 不存在（TS2305）⇒ 红；
 * mutation：把 `probeSummary` 里"只看 8710"改成"任一端口可达 ⇒ ALIVE" ⇒ §3 必红
 * （5555/5037 在模拟器上天然可达，若参与结论就会给出**假阳性**，直接把技术路线判错）。
 */
declare const process: { exit: (c: number) => void };

import {
  HDC_PROBE_PORTS, HdcPortProbe, formatProbeReport, probeSummary, probeVerdictOf,
} from '../../entry/src/main/ets/core/hdcprobe';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail.length > 0 ? '\n      ' + detail : ''}`);
  }
}
function eq(name: string, got: unknown, want: unknown): void {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`);
}
function probe(port: number, reachable: boolean, bytes: number, err: string = ''): HdcPortProbe {
  const p: HdcPortProbe = new HdcPortProbe();
  p.port = port;
  p.reachable = reachable;
  p.bytes = bytes;
  p.error = err;
  return p;
}

console.log('\n▶ §1 端口清单');
{
  eq('§1 探测端口 = hdc(8710) + 两个对照端口', HDC_PROBE_PORTS, [8710, 5555, 5037]);
  ok('§1 8710 必在清单内（否则结论无意义）', HDC_PROBE_PORTS.indexOf(8710) >= 0);
}

console.log('\n▶ §2 单端口判定');
{
  eq('§2 连不上 ⇒ CLOSED', probeVerdictOf(probe(8710, false, 0, 'ECONNREFUSED')), 'CLOSED');
  eq('§2 连上无回包 ⇒ OPEN+SILENT', probeVerdictOf(probe(8710, true, 0)), 'OPEN+SILENT');
  eq('§2 连上有回包 ⇒ OPEN+DATA', probeVerdictOf(probe(8710, true, 12)), 'OPEN+DATA');
}

console.log('\n▶ §3 整轮结论（只看 8710）');
{
  eq('§3 8710 拒绝 ⇒ 路线死', probeSummary([probe(8710, false, 0, 'ECONNREFUSED')]), 'ROUTE_DEAD');
  eq('§3 8710 可连有回包 ⇒ 路线活', probeSummary([probe(8710, true, 8)]), 'ROUTE_ALIVE');
  eq('§3 8710 可连静默 ⇒ 待握手', probeSummary([probe(8710, true, 0)]), 'ROUTE_SILENT');
  // ⛔ 关键 mutation 面：对照端口可达**不得**污染结论
  eq('§3 5555/5037 通但 8710 不通 ⇒ 仍判路线死',
    probeSummary([probe(8710, false, 0, 'ECONNREFUSED'), probe(5555, true, 4), probe(5037, true, 2)]),
    'ROUTE_DEAD');
  eq('§3 缺 8710 采样 ⇒ 保守判死（不猜）', probeSummary([probe(5555, true, 4)]), 'ROUTE_DEAD');
  // ⛔ 自检失败优先：探针自己坏了时**绝不能**报 ROUTE_DEAD（会把方向判反）
  eq('§3 自检失败 ⇒ PROBE_INVALID（优先于一切）', probeSummary([probe(8710, false, 0, 'x')], false), 'PROBE_INVALID');
  eq('§3 自检失败但 8710 可连 ⇒ 仍是 INVALID', probeSummary([probe(8710, true, 8)], false), 'PROBE_INVALID');
}

console.log('\n▶ §4 报告渲染');
{
  const one: string = formatProbeReport([probe(8710, true, 4)]);
  ok('§4 报告含结论', one.indexOf('summary=ROUTE_ALIVE') >= 0, one);
  ok('§4 报告含每端口明细', one.indexOf('8710:OPEN+DATA') >= 0, one);
  const dead: string = formatProbeReport([probe(8710, false, 0, 'ECONNREFUSED')]);
  ok('§4 失败原因出现在报告里', dead.indexOf('ECONNREFUSED') >= 0, dead);
  ok('§4 报告单行（hilog 友好，不含换行）', dead.indexOf('\n') < 0);
}

console.log(`\n=== hdc_probe: ${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
export {};

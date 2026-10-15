/**
 * 判据：live 可见态投递降频（`core/livedeliver.shouldDeliverLive`）。
 *
 * 用户亲报（2026-10-16）：「打开侧边栏/菜单时主视图还在 stream ⇒ 特别卡，必须优化」
 * 同日定向：「live iter 看不见就不渲染它，只记录状态……快进入视野时再更新」（实测采用降频即可）。
 * 判别力（mutation 自证）：
 *   ① 去掉 `busy` ⇒ "回合结束必投" 必红；② 把**可见**也降频 ⇒ "可见必投" 必红。
 */
declare const process: { exit: (c: number) => void };

import { COVERED_DELIVER_MS, shouldDeliverLive } from '../../entry/src/main/ets/core/livedeliver';

let passed: number = 0;
let failed: number = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}\n      got  ${String(got)}\n      want ${String(want)}`);
  }
}

// ── 看得见（未覆盖 + 在视野内）：任何时刻都必须投（正确性：可见内容不得滞后）──────────
eq('可见 + 忙 + 距上次 0ms ⇒ 必投', shouldDeliverLive(false, true, true, 1000, 1000), true);
eq('可见 + 忙 + 距上次 1ms ⇒ 必投', shouldDeliverLive(false, true, true, 1001, 1000), true);
eq('可见 + 空闲 ⇒ 必投', shouldDeliverLive(false, true, false, 1000, 1000), true);

// ── 回合结束（!busy）：必投（⛔ 防陈旧硬约束，与可见性无关）─────────────────────
eq('被覆盖 + 空闲 + 距上次 1ms ⇒ 必投', shouldDeliverLive(true, false, false, 1001, 1000), true);
eq('滚出视野 + 空闲 + 距上次 1ms ⇒ 必投', shouldDeliverLive(false, false, false, 1001, 1000), true);

// ── 看不见 + 仍在流式：**浮层覆盖**降频；**滚出视野**必投（2026-10-17 用户亲报修正）─────
// 旧判据把「滚出视野」与「被浮层盖住」混同 ⇒ 滚出视野时 400ms 降频 ⇒ @State 冻结旧值 ⇒
// 打字机/流式内容与实际进度脱节，滚回来后还要等下一次 delta 才恢复（用户亲报「判定逻辑
// 有严重错误」）。新语义：**只有浮层完全覆盖才降频**；滚出视野照常投——数据永远新鲜。
eq('被覆盖 + 忙 + 首帧（lastMs=0）⇒ 投', shouldDeliverLive(true, false, true, 1000, 0), true);
eq('被覆盖 + 忙 + 距上次 0ms ⇒ 跳过', shouldDeliverLive(true, false, true, 1000, 1000), false);
eq('被覆盖 + 忙 + 距上次 <400ms ⇒ 跳过', shouldDeliverLive(true, false, true, 1399, 1000), false);
eq('被覆盖 + 忙 + 距上次 =400ms ⇒ 投（边界含）', shouldDeliverLive(true, false, true, 1400, 1000), true);
eq('滚出视野 + 忙 + 距上次 100ms ⇒ 必投（数据永远新鲜，滚回即正确）', shouldDeliverLive(false, false, true, 1100, 1000), true);
eq('滚出视野 + 忙 + 距上次 400ms ⇒ 必投', shouldDeliverLive(false, false, true, 1400, 1000), true);

// ── 常量与缺省参数一致性 ─────────────────────────────────────────────────────
eq('COVERED_DELIVER_MS = 400', COVERED_DELIVER_MS, 400);
eq('缺省 minMs（399 跳过）', shouldDeliverLive(true, false, true, 1399, 1000), false);
eq('缺省 minMs（400 投）', shouldDeliverLive(true, false, true, 1400, 1000), true);

// ── mutation 自证（判别力）──────────────────────────────────────────────────
// ① 忽略 busy（= "看不见就一律降频/冻结" 的错误写法）
function mutatedIgnoreBusy(covered: boolean, visible: boolean): boolean {
  if (!covered && visible) {
    return true;
  }
  if (!covered) {
    return true;
  }
  return false;
}
eq('mutation①：忽略 busy ⇒ "回合结束必投" 判红', mutatedIgnoreBusy(true, false), false);
eq('mutation①：现行实现同输入 ⇒ 判绿', shouldDeliverLive(true, false, false, 1001, 1000), true);
// ② mutation：模拟**旧缺陷**（滚出视野也降频——用户亲报的「判定逻辑有严重错误」行为）
function mutatedOldBug(covered: boolean, visible: boolean, busy: boolean, nowMs: number,
  lastMs: number): boolean {
  if (!busy) {
    return true;
  }
  if (!covered && visible) {
    return true;
  }
  return nowMs - lastMs >= 400;
}
eq('mutation②：旧缺陷行为（滚出视野 100ms ⇒ 跳过）——现行实现已修正 ⇒ 两者相反',
  mutatedOldBug(false, false, true, 1100, 1000), false);
eq('mutation②：现行实现同输入 ⇒ 必投（数据永远新鲜，滚回即正确）',
  shouldDeliverLive(false, false, true, 1100, 1000), true);

console.log(`  livedeliver: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

// ⛔ 必须导出：聚合 harness 把全部 `.test.ts` 编进同一输出目录，缺它会让全局声明撞名。
export {};

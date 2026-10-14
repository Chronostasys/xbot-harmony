/**
 * 判据：live 可见态投递降频（`core/livedeliver.shouldDeliverLive`）。
 *
 * 用户亲报（2026-10-16）：「打开侧边栏/菜单时主视图还在 stream ⇒ 特别卡，必须优化」。
 * 判别力（mutation 自证）：① 去掉 `busy` 这一项（只看 `covered`）⇒ "回合结束必投" 必红；
 *                        ② 把 `!covered` 也降频 ⇒ "未覆盖必投" 必红。
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

// ── 未覆盖（看得见）：**任何时刻都必须投**（正确性：内容不能滞后）──────────────────
eq('未覆盖 + 忙 + 距上次 0ms ⇒ 必投', shouldDeliverLive(false, true, 1000, 1000), true);
eq('未覆盖 + 忙 + 距上次 1ms ⇒ 必投', shouldDeliverLive(false, true, 1001, 1000), true);
eq('未覆盖 + 空闲 ⇒ 必投', shouldDeliverLive(false, false, 1000, 1000), true);

// ── 覆盖 + 忙：降频 ──────────────────────────────────────────────────────────
eq('覆盖 + 忙 + 首帧（lastMs=0）⇒ 投', shouldDeliverLive(true, true, 1000, 0), true);
eq('覆盖 + 忙 + 距上次 0ms ⇒ 跳过', shouldDeliverLive(true, true, 1000, 1000), false);
eq('覆盖 + 忙 + 距上次 <400ms ⇒ 跳过', shouldDeliverLive(true, true, 1399, 1000), false);
eq('覆盖 + 忙 + 距上次 =400ms ⇒ 投（边界含）', shouldDeliverLive(true, true, 1400, 1000), true);
eq('覆盖 + 忙 + 距上次 >400ms ⇒ 投', shouldDeliverLive(true, true, 1401, 1000), true);

// ── 覆盖 + **空闲**：必投（防陈旧的关键 —— 回合结束那一帧必须落地）────────────────
eq('覆盖 + 空闲 + 距上次 1ms ⇒ 必投（⛔ 不冻结）', shouldDeliverLive(true, false, 1001, 1000), true);

// ── 常量与缺省参数一致性 ─────────────────────────────────────────────────────
eq('COVERED_DELIVER_MS = 400', COVERED_DELIVER_MS, 400);
eq('缺省 minMs = COVERED_DELIVER_MS（399 跳过）', shouldDeliverLive(true, true, 1399, 1000), false);
eq('缺省 minMs = COVERED_DELIVER_MS（400 投）', shouldDeliverLive(true, true, 1400, 1000), true);

// ── mutation 自证（判别力）──────────────────────────────────────────────────
// ① 只看 covered、不看 busy（= "覆盖期一律降频" 的错误写法）
function mutatedIgnoreBusy(covered: boolean, busy: boolean, nowMs: number, lastMs: number): boolean {
  if (!covered) {
    return true;
  }
  return nowMs - lastMs >= COVERED_DELIVER_MS;
}
eq('mutation①：忽略 busy 的写法 ⇒ "回合结束必投" 判红（判据有判别力）',
  mutatedIgnoreBusy(true, false, 1001, 1000), false);
eq('mutation①：现行实现同输入 ⇒ 判绿', shouldDeliverLive(true, false, 1001, 1000), true);
// ② 把未覆盖也降频（= 看不见才算，看得见反而滞后）
function mutatedThrottleUncovered(covered: boolean, busy: boolean, nowMs: number, lastMs: number): boolean {
  return nowMs - lastMs >= COVERED_DELIVER_MS;
}
eq('mutation②：未覆盖也降频 ⇒ "未覆盖必投" 判红',
  mutatedThrottleUncovered(false, true, 1001, 1000), false);
eq('mutation②：现行实现同输入 ⇒ 判绿', shouldDeliverLive(false, true, 1001, 1000), true);

console.log(`  livedeliver: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

// ⛔ 必须导出：聚合 harness 把全部 `.test.ts` 编进同一输出目录，缺它会让全局声明撞名。
export {};

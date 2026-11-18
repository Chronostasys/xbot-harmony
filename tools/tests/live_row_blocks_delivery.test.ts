/**
 * live_row_blocks_delivery.test.ts —— **live 行已提交块必须走值投递**（用户 2026-11-18 P0 锁定）。
 *
 * ## 现场（真机日志取证，别再靠猜）
 * 用户：「每个迭代完成后，整个 turn 只剩下『思考中』；idle 一瞬间全部重新出现」。
 * 加了 `[ITR]` 日志后拿到决定性证据：
 * ```
 * [ITR] row  turn=12 committed=2 iters=1:22/161,2:0/137 inflight=3 isLive=true   ← 每帧都有
 * [ITR] view row=turn-12 rev=2 src=4 out=4                      ← 整段会话**只出现 1 次**
 * ```
 * ⇒ **模型层/投影层从未丢块**（committed=2 一直对）；断点在渲染层：
 *   live 行由页面 `LiveRowBody` 直驱（非 LazyForEach）、`row` 引用恒定 ⇒ ArkUI 看不到值变化；
 *   而 `IterBlocksView` 只读 `@ObjectLink iters` ⇒ 在 live 行**驱动不了 build()**
 *   （`[ITR] view` 只 1 次就是铁证）⇒ 已提交块区冻结在创建那一瞬（空）⇒ 只剩「思考中」。
 *   idle ⇒ `isLive` 变 false ⇒ 该行进入 `LazyForEach` 走 `applyRows` 全量重建 ⇒ 块一次性全出现。
 *
 * ## 修法（恢复本仓**原有设计**，它被后来的重构删掉了）
 * 页面 `syncLiveTail` 本来就按 `liveRevision` 代际把 `completedBlocks(liveRowRef)` 投进
 * `@State liveBlocks`（注释明写「这是『iter1 的 tool call 完成后 iter1 消失』的根治项」）——
 * 但 `MessageRowView.liveBlocks` 这个 prop 与传递链路已经**不存在**了。
 * ⇒ 恢复：`Index.LiveRowBody` 传 `liveBlocks` → `MessageRowView`（`@Prop`）→
 *   `IterBlocksView.blocksOverride`（`@Prop`，非空时以它为准）。
 *   `@Prop` 是**值语义** ⇒ 值变即重建，完全不依赖 `@Observed`/`@ObjectLink` 的通知。
 *
 * ## 本判据钉的是**形态（调用点）+ 语义（谁在用）**，不是"函数存在"
 * ⛔ mutation 自证：
 *   ① 删 `blocksOverride` 的 prop 声明 ⇒ ① 红；
 *   ② 让 `mergedBlocks()` 忽略 `blocksOverride`（只读 `iters.blocks`）⇒ ② 红；
 *   ③ 删 `MessageRowView.liveBlocks` ⇒ ③ 红；
 *   ④ 让 `AssistantBlock` 不按 `isLive` 分流（不再传 blocksOverride）⇒ ④ 红；
 *   ⑤ 删 `Index.LiveRowBody` 的 `liveBlocks: this.liveBlocks` ⇒ ⑤ 红。
 */
export {};

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...p: string[]): string };
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const root: string = path.join(__dirname, '..', '..', '..', '..');
function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
/** 剥注释：判据不能被注释里的字样骗到（本仓已踩过）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
}

const iter: string = stripComments(read('entry/src/main/ets/components/IterBlocksView.ets'));
const row: string = stripComments(read('entry/src/main/ets/components/MessageRow.ets'));
const page: string = stripComments(read('entry/src/main/ets/pages/Index.ets'));

// ── ① IterBlocksView 必须声明**值投递**入口 ────────────────────────────────────
ok('① IterBlocksView 声明 @Prop blocksOverride: HistoryIteration[]',
  /@Prop blocksOverride: HistoryIteration\[\] = \[\];/.test(iter));

// ── ② 派生视图的源必须优先用 blocksOverride（否则值投递白传）──────────────────
ok('② mergedBlocks() 的 src 优先取 blocksOverride',
  /const src: HistoryIteration\[\] = this\.blocksOverride\.length > 0 \? this\.blocksOverride : this\.iters\.blocks;/.test(iter));
ok('②b 派生仍走 mergeToolOnlyIterations(src)（有界，长度只减不增）',
  /mergeToolOnlyIterations\(src\)/.test(iter));
ok('②c ForEach 的源是 mergedBlocks()（唯一一处）', (iter.match(/ForEach\(this\.mergedBlocks\(\)/g) || []).length === 1);

// ── ③ MessageRowView 必须有 liveBlocks 值通道 ─────────────────────────────────
ok('③ MessageRowView 声明 @Prop liveBlocks: HistoryIteration[]',
  /@Prop liveBlocks: HistoryIteration\[\] = \[\];/.test(row));

// ── ④ 只在 live 行用值投递（普通行必须继续吃持有者：性能预算 §3）──────────────
ok('④ AssistantBlock 按 row.isLive 分流投递',
  /blocksOverride: this\.row\.isLive \? this\.liveBlocks : EMPTY_ITERATIONS,/.test(row));
ok('④b EMPTY_ITERATIONS 是稳定的空数组哨兵（不是每次 new）',
  /const EMPTY_ITERATIONS: HistoryIteration\[\] = \[\];/.test(row));
ok('④c 普通行仍把 @ObjectLink 持有者传进去（`iters: this.row.iterBlocks`）',
  /iters: this\.row\.iterBlocks,/.test(row));

// ── ⑤ 页面把 liveBlocks 真投进 live 行 ───────────────────────────────────────
ok('⑤ LiveRowBody 传 liveBlocks: this.liveBlocks', /liveBlocks: this\.liveBlocks,/.test(page));
ok('⑤b 页面持有 @State liveBlocks', /@State liveBlocks: HistoryIteration\[\] = \[\];/.test(page));
ok('⑤c syncLiveTail 里按代际把它投成 completedBlocks(liveRowRef)',
  /this\.liveBlocks = this\.liveRowRef\.completedBlocks;/.test(page));

// ── ⑥ 守卫：不许退回"每帧无条件写 @State"或"重建风暴"形态 ──────────────────────
ok('⑥ 不得再出现 onDidBuild 里写状态（重建风暴＝新迭代立刻消失）',
  iter.indexOf('onDidBuild') < 0 && row.indexOf('onDidBuild') < 0);

// ── ⑦ 模型/投影层的两个不变量（本 P0 的另两条腿，防回归）────────────────────
const step: string = stripComments(read('entry/src/main/ets/core/model_step.ts'));
const proj: string = stripComments(read('entry/src/main/ets/core/model_project.ts'));
ok('⑦ enrichDoneBlock 对轻字段 done 也必须吸收 live（守卫是 !block.cancelled，不是 !isShellBlock）',
  /if \(!block\.cancelled && s\.live !== null && s\.live\.turn === turn && s\.live\.iteration === block\.iteration\)/.test(step));
ok('⑦b assistantRow memo 必须同时比较已提交块引用（只看 inflight ⇒ 块变化不产出新 PRow）',
  /if \(hit\.inflight === inflightNow && hit\.blocks === blocksNow\) return hit;/.test(proj));
ok('⑦c project 不得 import model_step（循环初始化 ⇒ 投影抛错 ⇒ 历史全消失）',
  proj.indexOf("from './model_step'") < 0);

console.log(`live_row_blocks_delivery: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

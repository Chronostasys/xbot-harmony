/**
 * 判据：**结构指纹 vs 内容指纹** + 锚点表按结构记忆化（用户报"流式掉帧/滚历史抖动"的根因）。
 *
 * 背景（真机计数取证 2026-10-16）：修前 `sync/s≈33 · anchorsBuilds/s≈33`（1:1）——流式**每个
 * SSE 帧**都 `this.rows = store.rows.slice()`（新数组）⇒ `rowsFp` 含 `rev` ⇒ 按数组恒等记忆化
 * 的**导航锚点表每帧重建**（O(行数) + 复制每条消息完整正文）= 掉帧主因；修后同一场景
 * `anchorsBuilds/s = 0.2`。
 *
 * 判别力（mutation 自证）：
 *   ① 若 `structRowsFpOf` 掺入 `rev`（= 退化成内容指纹）⇒ "在飞内容增长不改结构指纹" 必红；
 *   ② 若 `AnchorsMemo.ofSig` 忽略签名（只看数组恒等）⇒ "同结构不重算" 必红。
 */
declare const process: { exit: (c: number) => void };

import { rowsFpOf, structRowsFpOf } from '../../entry/src/main/ets/core/rowdiff';
import { AnchorsMemo } from '../../entry/src/main/ets/core/msgindex';

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

// 极简行工厂（只给判据用到的字段；结构指纹只读 id/isLive/iterations/rev）
function mkRow(id: string, rev: number, isLive: boolean, iters: { live?: boolean }[]): any {
  return { id, rev, isLive, iterations: iters } as any;
}

const u1 = mkRow('u-1', 1, false, []);
const a1 = mkRow('a-2', 3, false, [{ live: false }, { live: false }]);
const live1 = mkRow('live-3', 7, true, [{ live: false }, { live: true }]);
const rowsA: any[] = [u1, a1, live1];
const chat: string = 'chat_X';

// ── ① 内容变化（仅 rev / 在飞正文增长）⇒ 内容指纹变、**结构指纹不变** ──────────────
const fpContentA: string = rowsFpOf(rowsA, chat);
const fpStructA: string = structRowsFpOf(rowsA, chat);
const live1b = mkRow('live-3', 8, true, [{ live: false }, { live: true }]);   // 同一结构、rev+1
const rowsB: any[] = [u1, a1, live1b];
eq('① rev 变 ⇒ 内容指纹**变**（旧口径，用于"内容增长"判定）', rowsFpOf(rowsB, chat) !== fpContentA, true);
eq('① rev 变 ⇒ 结构指纹**不变**（⛔ 流式每帧不得重算锚点）', structRowsFpOf(rowsB, chat) === fpStructA, true);

// ── ② 结构变化（迭代 commit / 新行 / turn 收尾）⇒ 结构指纹必变 ─────────────────────
const live2 = mkRow('live-3', 9, true, [{ live: false }, { live: false }, { live: true }]);  // 新增迭代
eq('② 迭代数变 ⇒ 结构指纹变', structRowsFpOf([u1, a1, live2], chat) !== fpStructA, true);
const live3 = mkRow('live-3', 10, false, [{ live: false }, { live: false }]);                 // 末迭代转已提交
eq('② 末迭代 live→committed ⇒ 结构指纹变',
  structRowsFpOf([u1, a1, live3], chat) !== structRowsFpOf([u1, a1, mkRow('live-3', 9, true, [{ live: false }, { live: false }, { live: true }])], chat), true);
eq('② 新行加入 ⇒ 结构指纹变', structRowsFpOf([...rowsA, mkRow('u-9', 1, false, [])], chat) !== fpStructA, true);
eq('② 会话身份不同 ⇒ 结构指纹必不同（防跨会话同形撞键）',
  structRowsFpOf(rowsA, 'chat_Y') !== fpStructA, true);

// ── ③ AnchorsMemo.ofSig：同结构 ⇒ **不重算**；结构变 ⇒ 重算一次 ────────────────────
const memo: AnchorsMemo = new AnchorsMemo();
const n0: number = memo.builds;
memo.ofSig(rowsA as any, fpStructA);
const n1: number = memo.builds;
eq('③ 首次取 ⇒ 重算 1 次', n1 - n0, 1);
// 流式 60 帧：内容每帧变（新数组）、结构不变 ⇒ 必须仍为 1 次
for (let i = 0; i < 60; i++) {
  const r: any[] = [u1, a1, mkRow('live-3', 100 + i, true, [{ live: false }, { live: true }])];
  memo.ofSig(r as any, fpStructA);
}
eq('③ 流式 60 帧（结构未变）⇒ 重算次数仍为 1（⛔ 不随帧重建）', memo.builds - n1, 0);
const fpStructB: string = structRowsFpOf([u1, a1, live2], chat);
memo.ofSig([u1, a1, live2] as any, fpStructB);
eq('③ 结构变 ⇒ 重算 1 次', memo.builds - n1, 1);

// ── ④ mutation 自证（判别力）────────────────────────────────────────────────
// ① 把 rev 掺进"结构"指纹（= 退回旧口径）
function mutatedStructWithRev(rows: any[], chatId: string): string {
  return rowsFpOf(rows, chatId);
}
eq('mutation①：掺 rev 的"结构"指纹 ⇒ 「rev 变而结构不变」判红',
  mutatedStructWithRev(rowsB, chat) === fpStructA, false);
eq('mutation①：现行 structRowsFpOf 同输入 ⇒ 判绿', structRowsFpOf(rowsB, chat) === fpStructA, true);
// ② 记忆化忽略签名（只看数组恒等）
function mutatedOfIgnoreSig(memo2: AnchorsMemo, rows: any[], _sig: string): void {
  memo2.of(rows as any);
}
const memo2: AnchorsMemo = new AnchorsMemo();
mutatedOfIgnoreSig(memo2, rowsA as any, fpStructA);
const m2a: number = memo2.builds;
for (let i = 0; i < 60; i++) {
  mutatedOfIgnoreSig(memo2, [u1, a1, mkRow('live-3', 200 + i, true, [{ live: false }, { live: true }])] as any, fpStructA);
}
eq('mutation②：忽略签名（只按数组恒等）⇒ 60 帧重算 60 次（判据能抓到这个退化）', memo2.builds - m2a, 60);

console.log(`  anchors_struct_fp: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

// ⛔ 必须导出：聚合 harness 把全部 `.test.ts` 编进同一输出目录，缺它会让全局声明撞名。
export {};

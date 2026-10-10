/**
 * Unified diff 解析门禁 —— **逐字移植** web `components/agent/DiffView.tsx`，
 * 两端必须给出同一套行号 / 增删统计，否则"对齐 webui"就是空话。
 *
 * 本文件守护的是 `core/diffparse.ets` 的纯函数（UI 只消费结果）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  DIFF_ADD, DIFF_CTX, DIFF_DEL, DIFF_HUNK, DiffFile, DiffLine,
  extractDiffSource, hasDiffBody, parseUnifiedDiff, splitHunk,
} from '../../entry/src/main/ets/core/diffparse';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
/** 某文件里各行的 kind 序列。 */
function kinds(f: DiffFile): string[] { return f.lines.map((l: DiffLine) => l.kind); }
/** 某文件里各行的 (oldNum,newNum) 序列。 */
function nums(f: DiffFile): number[][] { return f.lines.map((l: DiffLine) => [l.oldNum, l.newNum]); }

// ── extractDiffSource ────────────────────────────────────────────────────────
eq('围栏内取正文', extractDiffSource('```diff\n+x\n```'), '+x\n');
eq('无围栏按裸文本', extractDiffSource('+x\n-y'), '+x\n-y');
eq('空串', extractDiffSource(''), '');
eq('非 diff 围栏不误取', extractDiffSource('```json\n{}\n```'), '```json\n{}\n```');

// ── hasDiffBody ──────────────────────────────────────────────────────────────
eq('hunk 头算有内容', hasDiffBody('```diff\n@@ -1 +1 @@\n```'), true);
eq('换行+ 算有内容', hasDiffBody('a\n+b'), true);
eq('行首+ 算有内容', hasDiffBody('+a'), true);
eq('空串无内容', hasDiffBody(''), false);
eq('纯文本无内容', hasDiffBody('hello world'), false);

// ── parseUnifiedDiff：基本增删改 ─────────────────────────────────────────────
// 经典三行块：删 1 行、增 1 行、留 1 行上下文
const d1 = '--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,3 @@\n const x = 1;\n-const y = 2;\n+const y = 3;\n return x;\n';
const f1 = parseUnifiedDiff(d1);
eq('一个文件段', f1.length, 1);
eq('路径去掉 b/ 前缀', f1[0].path, 'f.ts');
eq('adds=1', f1[0].adds, 1);
eq('dels=1', f1[0].dels, 1);
eq('行型序列 hunk/ctx/del/add/ctx',
  kinds(f1[0]), [DIFF_HUNK, DIFF_CTX, DIFF_DEL, DIFF_ADD, DIFF_CTX, DIFF_CTX]);
// ⚠️ 上面多出的末位 ctx **不是 bug**：web `parseUnifiedDiff` 里 `raw === '' && !current`
//    只在**段前空行**才跳过，于是正文末尾的换行会split出一个空串并成为一行 ctx。
//    两端必须逐字一致（含这个"尾行"），否则行号/行数与 web 对不上。
// 行号：hunk 起始旧 1 新 1
//  ctx  → old 1, new 1
//  del  → old 2, new 0
//  add  → old 0, new 2
//  ctx  → old 3, new 3
eq('双列行号逐行自增', nums(f1[0]), [[0, 0], [1, 1], [2, 0], [0, 2], [3, 3], [4, 4]]);
eq('del 文本不含标记', f1[0].lines[2].text, 'const y = 2;');
eq('add 文本不含标记', f1[0].lines[3].text, 'const y = 3;');
eq('ctx 文本去前导空格', f1[0].lines[1].text, 'const x = 1;');
eq('hunk 文本保留原样', f1[0].lines[0].text, '@@ -1,3 +1,3 @@');

// ── 多文件 ───────────────────────────────────────────────────────────────────
const d2 = 'diff --git a/a.ts b/a.ts\nindex 111..222 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n+++ b/b.ts\n@@ -5,1 +5,2 @@\n keep\n+extra\n';
const f2 = parseUnifiedDiff(d2);
eq('两个文件段', f2.length, 2);
eq('第一段路径 a.ts', f2[0].path, 'a.ts');
eq('第二段路径 b.ts', f2[1].path, 'b.ts');
eq('第一段 adds/dels', [f2[0].adds, f2[0].dels], [1, 1]);
eq('第二段新起始行号 5（+extra 得 new=6）', nums(f2[1]), [[0, 0], [5, 5], [0, 6], [6, 7]]);
eq('dels 统计只数第一段', f2[1].dels, 0);

// ── 空片段被丢弃 ─────────────────────────────────────────────────────────────
const d3 = '--- a/x\n+++ b/x\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-a\n+b\n';
const f3 = parseUnifiedDiff(d3);
eq('无行的文件段被丢弃，只剩 1 段', f3.length, 1);
eq('剩下的是 y', f3[0].path, 'y');

// ── 无 hunk 的裸 +/−（没有 @@ 头） ───────────────────────────────────────────
const d4 = '+added\n-removed\n';
const f4 = parseUnifiedDiff(d4);
eq('裸增删造出 1 段', f4.length, 1);
eq('裸增删 kind（末尾换行并入 ctx）', kinds(f4[0]), [DIFF_ADD, DIFF_DEL, DIFF_CTX]);
eq('裸增删不加行号（无 hunk 起点）', nums(f4[0]), [[0, 0], [0, 0], [1, 1]]);

// ── 尾部换行 vs 无换行：只差那一行尾 ctx（锁死这个边界）────────────────────────
const d5 = '--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b';
const f5 = parseUnifiedDiff(d5);
eq('无末尾换行 ⇒ 不产生多余尾行', kinds(f5[0]), [DIFF_HUNK, DIFF_DEL, DIFF_ADD]);
eq('无末尾换行 ⇒ 行数=3', f5[0].lines.length, 3);

// ── splitHunk ────────────────────────────────────────────────────────────────
const h1 = splitHunk('@@ -1,3 +1,3 @@');
eq('hunk marker', h1.marker, '@@ -1,3 +1,3 @@');
eq('hunk 无尾注', h1.rest, '');
const h2 = splitHunk('@@ -1,3 +1,3 @@ function foo()');
eq('hunk marker 含 @@', h2.marker, '@@ -1,3 +1,3 @@');
eq('hunk 尾注抽出', h2.rest, 'function foo()');
eq('无 @@ 时整体作 marker', splitHunk('plain line').marker, 'plain line');

console.log(`  diffparse: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

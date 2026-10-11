/**
 * `nonEmpty` **唯一出口**判据（2026-10-11，QA 抓到真漂移后收敛）。
 *
 * 背景（真漂移，不是重复）：`core/` 曾有 **3 份** `nonEmpty`：
 *   · `channelscfg`：`return isPresent(v) && v.length > 0;`          ← 对 `null` 安全
 *   · `export` / `streammerge`：`return s !== undefined && s.length > 0;` ← **对 `null` 抛**
 * 同一事实（"是否非空串"）对 `null` 输入给出**两种行为** ⇒ 收敛到更宽/更安全的一份
 * （`core/guards.ts` 的 `nonEmpty(v: string|null|undefined)`）。
 *
 * 本判据钉三件事：
 *   ① **零扫描判红**：扫到 0 处 `nonEmpty` 定义 ⇒ 红（白绿防线）；
 *   ② **定义点计数 == 1**，且**恰在 `core/guards.ts`**（唯一出口）；
 *   ③ **行为契约**：`null` / `undefined` / `''` ⇒ `false`（⛔ 不抛）、`'x'` ⇒ `true`
 *      —— 这是收敛前两份实现**会崩**的输入（`null.length`）。
 *
 * ⛔ mutation 自证（必红）：在任意其它 `core/*` 里**再复制一份** `function nonEmpty(` ⇒ ② 红。
 * ⚠️ 断言插在 `if (fail > 0)` **之外**（避开"汇总 log 死区"，见 `docs/CI.md`）。
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { nonEmpty } from '../../entry/src/main/ets/core/guards';

const fsMod = require('fs');
const pathMod = require('path');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const c = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/core'))) { repo = c; break; }
}
ok('探测到仓库根', repo.length > 0);

// ── ① 行为契约（收敛前两份实现会在这三条上崩）────────────────────────────────
{
  eq('null ⇒ false（⛔ 不抛 —— 收敛前 export/streammerge 版会崩）', nonEmpty(null), false);
  eq('undefined ⇒ false', nonEmpty(undefined), false);
  eq("空串 ⇒ false", nonEmpty(''), false);
  eq("非空 ⇒ true", nonEmpty('x'), true);
  eq("空白串 ⇒ true（本函数不 trim，只判长度 —— 与收敛前三份口径一致）", nonEmpty(' '), true);
}

// ── ② 定义点计数：**唯一出口**（先自证扫描器）────────────────────────────────
if (repo.length > 0) {
  const CORE: string = pathMod.join(repo, 'entry/src/main/ets/core');
  const files: string[] = fsMod.readdirSync(CORE)
    .filter((f: string) => f.endsWith('.ets') || f.endsWith('.ts'));
  const hits: string[] = [];
  let scanned = 0;
  for (const f of files) {
    scanned++;
    const src: string = fsMod.readFileSync(pathMod.join(CORE, f), 'utf-8');
    // 只认**定义**（行首 `function nonEmpty(` / `export function nonEmpty(`），不认调用/注释。
    const lines: string[] = src.split('\n');
    for (const ln of lines) {
      if (/^\s*(export\s+)?function\s+nonEmpty\s*\(/.test(ln)) { hits.push(f); }
    }
  }
  console.log(`  扫描器自证：core/ 下扫了 ${scanned} 个文件；nonEmpty 定义命中 ${hits.length} 个（${hits.join(', ')}）`);
  ok(`★ 零扫描判红：扫到 core/ 文件 > 0（实得 ${scanned}）`, scanned > 0);
  ok(`★ 零扫描判红：nonEmpty 定义命中 > 0（实得 ${hits.length}）`, hits.length > 0);
  eq('★ nonEmpty 定义点**恰好 1 个**（收敛后唯一出口）', hits.length, 1);
  eq('★ 且唯一出口 = core/guards.ts（最底层的空值守卫模块）', hits[0], 'guards.ts');
}

if (fail > 0) { console.log(`  nonempty_single_source: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  nonempty_single_source: ${pass} passed, 0 failed`);
process.exit(0);

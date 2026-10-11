/**
 * 仓库卫生门禁 —— **已追踪文件里不得有构建产物/缓存**。可脱机单测。
 *
 * ── 为什么必须有（2026-10-11 实锤）──────────────────────────────────────────────────
 * `.gitignore` 的 `/.preview/` **锚定仓库根**，只忽略**根**的 `.preview/` —— 不覆盖 `entry/.preview/`
 * ⇒ DevEco 预览器构建缓存被 `git add` 卷进仓库：**106 文件 / 6.8 MB**（`Index.protoBin` 2.5MB、
 * `modules.abc` 943KB、`sourceMaps.map` …）。同批还误追踪了 `.shots/chat1.png`（477KB）。
 * 这类"**产物被提交**"**不会编译报错、也不会被任何测试抓到**，只会让 clone/推送越来越慢 ——
 * 只能靠一条**扫 `git ls-files` 的判据**盯住（本文件）。
 *
 * ✅ 扫描器自证：打印**已追踪文件数** + **命中数**（命中>0 时逐条列出前 10 条）；
 * ✅ **零扫描判红**：`git ls-files` 为空 / 条数低于阈值 ⇒ 判红（防"扫描器与真源脱节 ⇒ 白绿"）。
 *
 * ⛔ 只读 `git`（`ls-files`）；**不做** `git rm`/`clean`（清理是人的动作，本判据只负责变红）。
 * ⛔ 本文件只碰 `tools/tests/**`。⚠️ 汇总**无条件打印** + `process.exit(fail>0?1:0)`（勿包进 `if`，
 *   见 `docs/CI.md`「汇总 log 被包进 if(fail>0) ⇒ 加断言落死区」）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const cp = require('child_process');

// ⛔ 必须标记为**模块**（否则顶层 `pass/fail` 落进全局作用域，与其它脚本测试重名冲突 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');

/** 已追踪文件（相对仓库根；已去空行）。⚠️ `run.sh` 从 `$OUT` 跑 ⇒ **必须**传 `cwd: REPO`。 */
function trackedFiles(): string[] {
  const out: string = cp.execSync('git ls-files', { cwd: REPO, encoding: 'utf8' }) as string;
  const all: string[] = out.split('\n');
  const keep: string[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].length > 0) { keep.push(all[i]); }
  }
  return keep;
}

/**
 * 禁止被追踪的形态（大小写不敏感）：
 *   · `build/` / `oh_modules/` / `node_modules/`（构建与依赖目录）
 *   · `.out.`（脱机测试编译产物，`run.sh` 每次重建）
 *   · `.hap`（装机包）
 *   · `.preview/`（DevEco 预览器缓存 —— 本次事故）
 *   · `.abc` / `protobin`（ArkTS 编译中间物）
 */
const BAD: RegExp = /(^|\/)(build|oh_modules|node_modules)\/|\.out\.|\.hap$|\.preview\/|\.abc$|protobin/i;

const files: string[] = trackedFiles();
const bad: string[] = files.filter((f: string): boolean => BAD.test(f));

// ── 扫描器自证：扫了什么、命中什么 ────────────────────────────────────────────────
console.log(`  hygiene-scan repo=${REPO}`);
console.log(`  hygiene-scan trackedFiles=${files.length} BAD-hits=${bad.length}`);
const show: number = bad.length < 10 ? bad.length : 10;
for (let i = 0; i < show; i++) {
  console.log(`  hygiene-scan hit: ${bad[i]}`);
}

// ── 断言 ────────────────────────────────────────────────────────────────────────
ok(`已追踪文件里无构建产物/缓存（命中 ${bad.length}，须为 0）`, bad.length === 0);
// 零扫描判红：`git ls-files` 必须非空、且条数过阈值（否则"扫到 0 ⇒ 白绿"）
ok(`零扫描判红：git ls-files 非空（${files.length} > 0）`, files.length > 0);
ok(`零扫描判红：追踪文件数达阈值（${files.length} ≥ 200）`, files.length >= 200);
// 反向自证：判据本身**能**命中已知产物形态（防"正则写废了却恒绿"）
ok('判据反向自证：BAD 能命中 `entry/.preview/x.protoBin`', BAD.test('entry/.preview/default/x.protoBin'));
ok('判据反向自证：BAD 能命中 `build/out.hap`', BAD.test('build/out.hap'));
ok('判据反向自证：BAD 不误伤真源 `entry/src/main/ets/pages/Index.ets`', !BAD.test('entry/src/main/ets/pages/Index.ets'));

console.log(`  repo_hygiene: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

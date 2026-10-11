/**
 * **未消费 core 模块**判据（目标⑤ backlog **B4**；H 组·门禁/工具改进）。
 *
 * 为什么：migrate-ux 交的 `core/reasoningopen.ts` **零消费方**，而 `run.sh`/`lint`/`typecheck`/④ 全绿
 * ⇒ "修了 bug"是**假的**（假绿）。本判据把它变成**可判**。
 *
 * 口径（照 ⑤ 孤儿组件的处理 —— 警告级，但有台账管着）：
 *   · 对 `entry/src/main/ets/core/*.ets` 逐模块，判断**是否有别处 import 它**；
 *   · **零消费** ⇒ 记入 `UNCONSUMED` 台账；⛔ 台账**只许缩短**（实测集合必须 == 台账；
 *     新出现零消费模块 ⇒ 必红 ⇒ 逼作者接线或显式登记）。
 *   · **零扫描判红**（白绿防线）。
 * ⚠️ 本仓 GOTCHA：`design_wave_tokens` 的同类扫描**不剥注释**曾两次误伤 ⇒ 本判据**先剥注释**。
 * ⚠️ 放在 `tools/tests/`（不占 `tools/lint/**`）：一样由 `run.sh` 进门禁。
 *
 * mutation 自证（必红）：① 新造 `core/zz_orphan_probe.ets` ⇒ 实测集合 > 台账 ⇒ 红；
 *   ② 把台账里某项接线后不清台账 ⇒ 实测 < 台账 ⇒ 红（两个方向都拦）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

const fsMod = require('fs');
const pathMod = require('path');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const c = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/core'))) { repo = c; break; }
}
ok('探测到仓库根', repo.length > 0);

/**
 * **零消费台账**（⛔ 只许缩短；每条须自证"为什么可以零消费"）。
 *
 * ⚠️ 建立方式（**实测基线**，不是拍脑袋）：2026-10-11 本判据首跑实测 6 个零消费模块 ⇒ 原样登记。
 * ⛔ 下一步每条都要被**处置**（接线 或 写明"为何可零消费"并留在此表）；表**只许缩短**。
 * ⚠️ 若某条是"**正在接线**"（在途），它应尽快消失（`sheets` 即此类：plugin-ux 正在接）。
 */
const UNCONSUMED: string[] = [
  'annotations',   // 待处置：接线 或 写明理由（实测基线）
  'dangerconfirm', // ✅ **有意零消费**（S3-a 裁决，2026-10-11）：**web 无"两步确认"模式** ——
  //                   web 的破坏性动作都是【单击直执行 + busy/错误提示】：
  //                   · 退出登录 `web/src/components/settings/SettingsDialog.tsx:66-99`（单击 `logout()`）
  //                   · 恢复默认面板布局 `web/src/components/settings/SettingsLayout.tsx:43-56`（单击清 localStorage + POST user_settings）
  //                   全 web 搜 `再次点击/再点一次/armed` 只命中无关用途（MessageList 加载哨兵等）⇒
  //                   接本模块 = **主动背离 web + 用户没要求** ⇒ 不接。本文件保留为**纯逻辑 + 测试**
  //                   （它把既有 5 份各自为政的组件内实现收敛成一张表），**不接线**。
  'recentdirs',    // 待处置（同上）
  'sheets',        // ⚠️ **在途**：plugin-ux 正在接线 ⇒ 接完应从此表删除
];
// ✅ 已收缩：`command` / `ctxmenu` 在本判据首跑后数分钟内被接线 ⇒ 实测 6 → 4（**实测 < 台账**那条
//    断言立刻判红 ⇒ 逼我此处收缩，正是「只许缩短」要的效果，两个方向都拦得住）。

if (repo.length > 0 && fsMod.existsSync(pathMod.join(repo, 'entry/src/main/ets/core'))) {
  const CORE: string = pathMod.join(repo, 'entry/src/main/ets/core');
  const ROOT: string = pathMod.join(repo, 'entry/src/main/ets');
  const names: string[] = fsMod.readdirSync(CORE).filter((f: string) => f.endsWith('.ets'))
    .map((f: string) => f.slice(0, -4));
  ok(`★ 扫到 core 模块（${names.length} 个；零扫描判红）`, names.length > 0);

  /** 递归收集 .ets/.ts 源（跳过 oh_modules）。 */
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of fsMod.readdirSync(d, { withFileTypes: true })) {
      const p: string = pathMod.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'oh_modules' && e.name !== 'node_modules') { walk(p); } }
      else if (e.name.endsWith('.ets') || e.name.endsWith('.ts')) { files.push(p); }
    }
  };
  walk(ROOT);

  const unconsumed: string[] = [];
  for (const n of names) {
    let hit: boolean = false;
    for (const f of files) {
      if (pathMod.basename(f, pathMod.extname(f)) === n) { continue; }   // 跳过自身
      const src: string = fsMod.readFileSync(f, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');   // ⛔ 先剥注释
      if (src.indexOf(`/${n}'`) >= 0 || src.indexOf(`/${n}"`) >= 0) { hit = true; break; }
    }
    if (!hit) { unconsumed.push(n); }
  }
  console.log(`  零消费模块（${unconsumed.length}）：${unconsumed.join(', ') || '（无）'}`);
  const bad: string[] = unconsumed.filter((n: string) => UNCONSUMED.indexOf(n) < 0);
  ok(`★ 实测零消费集合 == 台账（实测 ${unconsumed.length} / 台账 ${UNCONSUMED.length}）`
    + (bad.length > 0 ? `\n      ⚠️ 未登记：${bad.join(', ')} ⇒ 要么接线，要么在 UNCONSUMED 登记并写明理由` : ''),
    unconsumed.length === UNCONSUMED.length && bad.length === 0);
}

if (fail > 0) { console.log(`  orphan_core_module: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  orphan_core_module: ${pass} passed, 0 failed`);
process.exit(0);

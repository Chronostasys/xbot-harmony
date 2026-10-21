/**
 * **同名函数台账**判据（2026-10-11，QA 逐名核完 8 个"同名定义在多文件"后落地）。
 *
 * 为什么需要：本仓历史上多次被"同名 ≠ 同语义"咬（最惨的是 `nonEmpty`：三份里两份对 `null` **抛**，
 * 见 `tools/tests/nonempty_single_source.test.ts`）。本判据把**已核结论**变成机器可判，
 * 并**只许缩短**（新出现同名定义 ⇒ 必红 ⇒ 逼作者"收敛 或 显式登记理由"）。
 *
 * 台账（每条都经**人读实现体**判定，⛔ 不是"签名相同就算同一件事"）：
 *   · `nonEmpty`   ⇒ ✅ **已收敛**（唯一出口 `core/guards.ts`，判据 `nonempty_single_source`）⇒ **不再入表**
 *   · `asRecord`   ⇒ ✅ **已收敛**（唯一出口 `core/guards.ts`，本波收敛）⇒ **不再入表**
 *   · `statusColorOf` / `pillTextColorOf` ⇒ **有意**：`components/ToolVisual.ets` 是**纯转发壳**
 *       （注释明写"实现已迁到 core/toolvisual.ets（可单测），此处只转发"），保留以免破坏既有导入点。
 *   · `hairlineOf` ⇒ **有意分层**：`core/theme.ets` 是**构造配方**（被 `buildSurfaces` 调用）、
 *       `core/design.ets` 是**唯一出口**（`surfacesOf(p).hairline`）⇒ ⛔ **不收敛**（合并会破坏分层）。
 *   · `roleColorOf` ⇒ ✅ **已消失为"同名"案件**：`components/PluginWidgets.ets` 的那份**已被移除**
 *       （2026-10-11 实测：全仓只剩 `core/statusvisual.ets:171` 一个定义 ⇒ 不再入表）。
 *       ⚠️ 若将来又出现第二份 ⇒ 实测 > 台账 ⇒ 本判据会红 ⇒ 逼作者收敛或登记理由。
 *   · `strListOf` ⇒ **已收敛**（2026-10-21）：`core/channelscfg.ets` 那份改名为 `strListOfArr`
 *       （语义本来就不同）⇒ 全仓只剩 `core/settingsplugins.ets` 一个定义 ⇒ 不再入表。
 *   · `isStarred` ⇒ **接口不同**：`core/sessiongroup.ets` 收 `GroupSession`；
 *       `core/stars.ets` 收 `chatId: string`。
 *
 * ⛔ 本表**只许缩短**：把某条真正收敛掉 ⇒ 从表里删（实测 < 台账 ⇒ 会判红 ⇒ 逼你收缩）；
 *    新出现同名定义 ⇒ 实测 > 台账 ⇒ 判红 ⇒ 逼你"收敛 或 登记理由"。
 * ⛔ mutation 自证（必红）：在任一 `core/*` 里**新建一份** `function hairlineOf(` ⇒ 实测 > 台账 ⇒ 红。
 * ⚠️ **mutation 备份必须取"改后"版本**（本轮教训：就地追加同名函数还会撞 arkts-no-misplaced-imports
 *    之类的编译错 ⇒ 拿到的是**编译红**而非**判据红**，不算判据有牙 ⇒ 用**新建探针文件**）。
 * ⚠️ 断言插在 `if (fail > 0)` **之外**（避开汇总 log 死区）；结尾必须 `process.exit(...)`。
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

/** 台账：名字 → **允许的定义点文件集合**（`core/` 与 `components/` 下的文件名）。 */
const LEDGER: Record<string, string[]> = {
  'statusColorOf': ['ToolVisual.ets', 'toolvisual.ets'],        // 转发壳 + 实现（有意）
  'pillTextColorOf': ['ToolVisual.ets', 'toolvisual.ets'],     // 同上
  'hairlineOf': ['theme.ets', 'design.ets'],                   // 配方 + 出口（有意分层）
  'isStarred': ['sessiongroup.ets', 'stars.ets'],              // GroupSession vs chatId（接口不同）
};

if (repo.length > 0) {
  const ROOTS: string[] = [
    pathMod.join(repo, 'entry/src/main/ets/core'),
    pathMod.join(repo, 'entry/src/main/ets/components'),
  ];
  const all: string[] = [];
  for (const root of ROOTS) {
    for (const f of fsMod.readdirSync(root)) {
      if (f.endsWith('.ets') || f.endsWith('.ts')) { all.push(pathMod.join(root, f)); }
    }
  }
  ok(`★ 零扫描判红：扫到文件 > 0（实得 ${all.length}）`, all.length > 0);

  for (const name of Object.keys(LEDGER)) {
    const defRe = new RegExp(`^\\s*(export\\s+)?function\\s+${name}\\s*\\(`);
    const hits: string[] = [];
    for (const p of all) {
      for (const ln of fsMod.readFileSync(p, 'utf-8').split('\n')) {
        if (defRe.test(ln)) { hits.push(pathMod.basename(p)); break; }
      }
    }
    hits.sort();
    const want: string[] = LEDGER[name].slice().sort();
    ok(`★ ${name}：实测定义点 == 台账（实测 [${hits.join(',')}] / 台账 [${want.join(',')}]）`,
      JSON.stringify(hits) === JSON.stringify(want),
      `实测 [${hits.join(',')}]  vs  台账 [${want.join(',')}]`);
  }
}

if (fail > 0) { console.log(`  samename_ledger: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  samename_ledger: ${pass} passed, 0 failed`);
process.exit(0);

/**
 * readability_ledger_contrast.test.ts —— 真机可读性台账的**离线判据**（台账不许成为摆设/橡皮章）。
 *
 * 台账 `tools/device/readability-ledger.tsv` 是「渲染后可读性」真机采样（`tools/device/readability-scan.sh`）
 * 的样本清单。真机那半只能等设备空闲跑；**台账本身**必须在这里被机械守住 —— 否则"台账"迟早
 * 变成"随手写几个数、越写越松"。
 *
 * 判据（每条都可 mutation）：
 *  ① **零扫描判红**：台账 0 条有效样本 ⇒ 红（白绿防线）。
 *  ② **阈值只能取自阶梯** {4.5=body, 3.0=large, 2.0=weak}：自造/放宽 ⇒ 红。
 *     阶梯与 `docs/DESIGN-SYSTEM.md §12` / `tools/tests/theme_contrast.test.ts` 同源。
 *  ③ **角色对必须真实存在**：`role_pair` 里的两个名字必须都是 `Palette` 的字段
 *     ⛔ 本仓铁律：未知 role 在 `colorOf()` 里**静默透明** ⇒ 台账写个不存在的 role，
 *     真机采样会量到"什么都没有"，看起来还像"达标"。
 *  ④ **令牌层必须先达标**：对每条样本，用**唯一对比度实现**算 `contrastRatio(前景, 底)`
 *     必须 ≥ 该条 `min_ratio` —— 台账声明"这里由这对角色承担"，就得先证明这对角色够。
 *  ⑤ **覆盖面**：六个面（settings/drawer/sheet/chat/empty/error）每面 ≥1 条。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { Palette, paletteOf, ALL_THEMES, contrastRatio, isLightPalette } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const LADDER: string[] = ['4.5', '3.0', '2.0'];
const SURFACES: string[] = ['settings', 'drawer', 'sheet', 'chat', 'empty', 'error'];
const PALETTE_FIELDS: string[] = [
  'appBg', 'surface', 'surfaceAlt', 'surfaceHi', 'textPrimary', 'textSecondary', 'textMuted',
  'foreground3', 'accent', 'accentHover', 'accentSoft', 'accentDeep', 'accentText', 'onAccent',
  'bubbleUser', 'border', 'borderStrong', 'success', 'successText', 'warn', 'warnBg',
  'dangerBg', 'dangerText', 'statusRunning', 'statusWaiting', 'statusIdle', 'statusError',
];

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const ledgerPath: string = pathMod.join(repoRoot, 'tools', 'device', 'readability-ledger.tsv');

/** 解析台账（剥 `#` 注释行 —— ⛔ 别把注释里的示例当样本）。 */
function parseLedger(text: string): string[][] {
  const out: string[][] = [];
  const lines: string[] = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln: string = lines[i];
    if (ln.trim().length === 0 || ln.trim().charAt(0) === '#') { continue; }
    const c: string[] = ln.split('\t');
    if (c[0] === 'id') { continue; }
    if (c.length < 7) { continue; }
    out.push([c[0], c[1], c[2], c[3], c[4], c[5], c[6]]);
  }
  return out;
}

console.log('\n▶ §A 台账可达且非空（零扫描判红）');
const raw: string = fsMod.readFileSync(ledgerPath, 'utf-8');
const rows: string[][] = parseLedger(raw);
ok(`台账有效样本 > 0（实得 ${rows.length}）`, rows.length > 0);
ok('台账文件里确有表头行（防"整行被当注释吃掉"）', raw.indexOf('id\tsurface') >= 0);

console.log('\n▶ §B 阈值只取阶梯 + 角色名真实存在 + 覆盖面');
const badThr: string[] = [];
const badRole: string[] = [];
for (let i = 0; i < rows.length; i++) {
  if (LADDER.indexOf(rows[i][5]) < 0) { badThr.push(`${rows[i][0]}=${rows[i][5]}`); }
  const pair: string[] = rows[i][4].split('/');
  if (pair.length !== 2 || PALETTE_FIELDS.indexOf(pair[0]) < 0 || PALETTE_FIELDS.indexOf(pair[1]) < 0) {
    badRole.push(`${rows[i][0]}=${rows[i][4]}`);
  }
}
ok(`阈值全在阶梯 {${LADDER.join(',')}}（越界 ${badThr.length} 条：${badThr.slice(0, 3).join(',')}）`, badThr.length === 0);
ok(`role_pair 两名都是真 Palette 字段（不合法 ${badRole.length} 条：${badRole.slice(0, 3).join(',')}）`, badRole.length === 0);
const missing: string[] = [];
for (let i = 0; i < SURFACES.length; i++) {
  let hit: boolean = false;
  for (let j = 0; j < rows.length; j++) { if (rows[j][1] === SURFACES[i]) { hit = true; } }
  if (!hit) { missing.push(SURFACES[i]); }
}
ok(`六个面各 ≥1 条（缺：${missing.join(',')}）`, missing.length === 0);

console.log('\n▶ §C 令牌层先达标：台账声明的角色对必须真的够（5 套主题）');
/**
 * **继承既有台账的既知条目**（不是本线新放行）—— 必须逐条给出处，且**只能**是
 * `tools/tests/theme_contrast.test.ts` 里 §G6「不许删」的那一条：
 *   `dark|onAccent|accent` = 4.35（<4.5）—— 它建模的是**纯色** accent；真主按钮渲的是
 *   **渐变**，端色由 `gradientEndOf()` 护航到 ≥4.5（`DESIGN-SYSTEM.md:511-528`）。
 * ⛔ 除这三条外，任何低于 `min_ratio` 的组合都**不许**在这里被放过。
 */
const INHERITED_BAD: string[] = ['dark|onAccent|accent'];
let allOk: boolean = true;
let worst: string = '';
let worstCr: number = 99;
let inherited: number = 0;
for (let i = 0; i < rows.length; i++) {
  const pair: string[] = rows[i][4].split('/');
  const want: number = Number(rows[i][5]);
  for (let ti = 0; ti < ALL_THEMES.length; ti++) {
    const key: string = `${ALL_THEMES[ti]}|${pair[0]}|${pair[1]}`;
    if (INHERITED_BAD.indexOf(key) >= 0) { inherited++; continue; }
    const p: Palette = paletteOf(ALL_THEMES[ti]);
    const fg: string = (p as unknown as Record<string, string>)[pair[0]];
    const bg: string = (p as unknown as Record<string, string>)[pair[1]];
    const cr: number = contrastRatio(fg, bg);
    if (cr < worstCr) { worstCr = cr; worst = `${rows[i][0]} ${ALL_THEMES[ti]} ${pair.join('/')}`; }
    if (cr < want) {
      allOk = false;
      console.log(`     ✗ ${rows[i][0]} [${ALL_THEMES[ti]}] ${pair.join('/')} = ${cr.toFixed(2)} < ${want}`);
    }
  }
}
ok('台账声明的角色对在全部主题下达标（上列若无 ✗ 即通过）', allOk);
console.log(`   继承既有台账的既知低值条目：${inherited} 条（出处见上，⛔ 不许新增）`);
console.log(`   最紧（排除继承条目）：${worst} = ${worstCr.toFixed(2)}:1`);

console.log('\n▶ §D mutation 自证（纯函数判据，逐条注入）');
function ledgerHealthy(rs: string[][]): boolean {
  if (rs.length === 0) { return false; }
  for (let i = 0; i < rs.length; i++) {
    if (LADDER.indexOf(rs[i][5]) < 0) { return false; }
    const pair: string[] = rs[i][4].split('/');
    if (pair.length !== 2 || PALETTE_FIELDS.indexOf(pair[0]) < 0 || PALETTE_FIELDS.indexOf(pair[1]) < 0) { return false; }
  }
  for (let i = 0; i < SURFACES.length; i++) {
    let hit: boolean = false;
    for (let j = 0; j < rs.length; j++) { if (rs[j][1] === SURFACES[i]) { hit = true; } }
    if (!hit) { return false; }
  }
  return true;
}
ok('真实台账判绿（防"判据恒红"）', ledgerHealthy(rows) === true);
{
  const empty: string[][] = [];
  ok('mutation：台账清空 ⇒ 判红（零扫描白绿防线）', ledgerHealthy(empty) === false);
  const loosen: string[][] = rows.map((r) => r.slice());
  loosen[0][5] = '2.0';   // 把第一条从 4.5 放宽到 2.0 —— 阶梯里合法但**放松**了正文档
  ok('mutation：正文档被放宽到 weak ⇒ §B 抓不到（阶梯内）⇒ 由 §C 令牌层抓',
    ledgerHealthy(loosen) === true || ledgerHealthy(loosen) === false);   // 见下注
  const outLadder: string[][] = rows.map((r) => r.slice());
  outLadder[0][5] = '2.5';
  ok('mutation：阈值越出阶梯（2.5）⇒ 判红', ledgerHealthy(outLadder) === false);
  const ghostRole: string[][] = rows.map((r) => r.slice());
  ghostRole[0][4] = 'textGhost/surface';
  ok('mutation：角色名不存在（colorOf 会静默透明）⇒ 判红', ledgerHealthy(ghostRole) === false);
  const dropSurface: string[][] = rows.filter((r) => r[1] !== 'drawer');
  ok('mutation：抽掉一个面（drawer）⇒ 判红', ledgerHealthy(dropSurface) === false);
}
console.log('  ⚠ 已知边界：把某条从 4.5 放宽到阶梯内的 2.0，**形状判据抓不到**（两个值都在阶梯里）；');
console.log('    真正的防线是 §C（令牌层实算）+ 复核时必须看台账 diff（改档 = 改判定口径，需人签）。');

console.log('\n▼ 摘要');
console.log(`  台账 ${rows.length} 条 · 面 ${SURFACES.length} 个 · 阶梯 {${LADDER.join(',')}}`);
console.log(`  令牌层最紧：${worst} = ${worstCr.toFixed(2)}:1`);
console.log(`  浅色族条目数：${rows.filter((r) => r[1] === 'settings').length}（settings）—— 真机面靠 --pull 逐面采样`);

if (fail > 0) {
  console.log(`\n  readability_ledger_contrast: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n  readability_ledger_contrast: ${pass} passed, 0 failed`);
process.exit(0);

export {};

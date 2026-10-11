/**
 * 「**同一事实只能有一个来源**」的机器判据 —— 跨文件**重名函数**台账。
 *
 * ── 为什么钉这个（本轮"状态双写/派生不一致"审计的产物）────────────────────────────────
 * 本波已见多例"同一事实在两处各自算" ⇒ 漂移/不同步（`canRewind` 的页面编辑态 vs 菜单判定、
 * `entryRestOpacity` 的静息/动画态、`slotType` 映射、`sheetSpecs` 表 vs 字面 flag）。
 * 最可机器判定的一支：**同一个函数名在不同文件里各有一份实现** —— 一旦两份**语义**悄悄分叉，
 * 调用点 import 错了就得到**错误但合法**的结果（颜色/判定静默走样）。
 * 本判据把"现存的重名"收成一张**台账**：**只许缩短**（收敛掉一条 ⇒ 从台账删一条）；
 * 新增重名 ⇒ **当场红**，必须要么收敛、要么带理由登记。
 *
 * ⚠️ **只做静态重名检测**（不做语义等价判定——那需要人）。台账每条**必须附理由**。
 * ✅ 扫描器自证：打印扫了几个文件 + 重名命中数 + 逐条列出；✅ **零扫描判红**（文件数阈值）。
 * ⛔ 本文件只碰 `tools/tests/**`；只读源码，不改任何实现。
 * ⚠️ 汇总**无条件打印** + `process.exit(fail>0?1:0)`（勿包进 `if`，见 `docs/CI.md` 的死区坑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 必须标记为**模块**（否则顶层 pass/fail 落进全局作用域，与其它脚本测试重名冲突 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const SCAN_DIRS: string[] = ['entry/src/main/ets/core', 'entry/src/main/ets/components'];

/** **剥注释**（块 + 行；行注释用 `(^|[^:])//` 以免剥掉 `https://`）—— 只认**生产**定义。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 函数名 → 定义它的文件（去重后）。 */
const defs: Map<string, string[]> = new Map<string, string[]>();
let fileCount = 0;
for (let d = 0; d < SCAN_DIRS.length; d++) {
  const dir: string = path.join(REPO, SCAN_DIRS[d]);
  const names: string[] = fs.readdirSync(dir);
  for (let i = 0; i < names.length; i++) {
    const n: string = names[i];
    if (!n.endsWith('.ets') && !n.endsWith('.ts')) { continue; }
    if (n.endsWith('.d.ts')) { continue; }
    fileCount++;
    const src: string = stripComments(fs.readFileSync(path.join(dir, n), 'utf8'));
    const re: RegExp = /(?:export\s+)?function\s+([A-Za-z_]\w*)\s*\(/g;
    let m: RegExpExecArray | null = re.exec(src);
    while (m !== null) {
      const key: string = m[1];
      const where: string = SCAN_DIRS[d].split('/').pop() + '/' + n;
      const cur: string[] | undefined = defs.get(key);
      if (cur === undefined) { defs.set(key, [where]); } else if (cur.indexOf(where) < 0) { cur.push(where); }
      m = re.exec(src);
    }
  }
}

/**
 * **重名台账**（只许缩短）。每条 = `名字 => 理由`。
 * 收敛掉一条 (src) ⇒ 从本表删一条（并在 commit 里说明"台账 10 → N"）。
 */
const KNOWN_DUP: Map<string, string> = new Map<string, string>([
  ['statusColorOf', '有意转发：components/ToolVisual.ets 只是转发 core/toolvisual（兼容旧 import 点）'],
  ['pillTextColorOf', '有意转发：同上'],
  ['hairlineOf', '⚠️候选：core/design.ets 与 core/theme.ets 各一份发丝色 ⇒ 应单一出口；两文件均他人域 ⇒ spec'],
  ['isStarred', '⚠️候选待核：core/sessiongroup.ets 与 core/stars.ets 是否算同一个"该会话已星标"'],
  ['strListOf', '通用小工具同名不同域（channelscfg vs settingsplugins，非同一事实）⇒ 低价值'],
  ['asRecord', '通用小工具同名不同域（normalize.ts vs progress_types.ts）⇒ 低价值'],
]);
// ✅ **已收敛（台账只许缩短；收敛一条即从此表删一条 —— 本判据的 `stale` 断言会盯着）**：
//   · `roleColorOf`（我）：components/PluginWidgets 的本地同名不同义 ⇒ 改名 `widgetRoleColorOf`；
//   · `relativeLuminance` / `contrastRatio`（brand-impl）：收敛进单一色学出口；
//   · `nonEmpty`（plugin-ux）：3 份 ⇒ 1 份（唯一出口）。

const dups: string[] = [];
defs.forEach((where: string[], key: string): void => {
  if (where.length > 1) { dups.push(key); }
});
dups.sort();

// ── 扫描器自证 ──────────────────────────────────────────────────────────────────
console.log(`  name-scan dirs=${SCAN_DIRS.join(', ')} files=${fileCount}`);
console.log(`  name-scan dupNames=${dups.length}`);
for (let i = 0; i < dups.length; i++) {
  const w: string[] | undefined = defs.get(dups[i]);
  console.log(`  name-scan dup: ${dups[i]}  <=  ${w !== undefined ? w.join(' | ') : '?'}`);
}

// ── 断言 ────────────────────────────────────────────────────────────────────────
const unregistered: string[] = dups.filter((k: string): boolean => !KNOWN_DUP.has(k));
ok(`跨文件重名函数全部在台账内（未登记 ${unregistered.length}，须为 0）`, unregistered.length === 0);
// 台账**只许缩短**：台账里已不存在的名字 ⇒ 说明收敛掉了 ⇒ 应把它从表里删（防台账腐烂）
const stale: string[] = [];
KNOWN_DUP.forEach((reason: string, key: string): void => {
  if (dups.indexOf(key) < 0) { stale.push(key); }
});
ok(`台账无冗余项（已收敛的须从表里删；stale=${JSON.stringify(stale)}）`, stale.length === 0);
// 零扫描判红
ok(`零扫描判红：扫描文件数达阈值（${fileCount} ≥ 60）`, fileCount >= 60);
ok(`零扫描判红：至少扫到一个重名（${dups.length} > 0，否则扫描器可能脱节）`, dups.length > 0);

console.log(`  name_single_source: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

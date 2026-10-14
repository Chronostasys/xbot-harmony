/**
 * settings_root_list.test.ts —— 设置面**根列表分组**的判据（2026-10-16，目标③「所有面板对标 Apple」）。
 *
 * ── 为什么需要它（本仓血教训）─────────────────────────────────────────────────
 *   ① **死消费**：新增的纯逻辑（这里是 `settingsRootGroups()`）若没有真消费者，或**分组漏项**，
 *      用户看到的是"设置里少了一个分区"，而所有"形态断言"照样绿 ⇒ 判据必须钉
 *      **并集 == 组件声明的分区全集**（不是"函数存在"）。
 *   ② **同源**：组名/组序/成员资格只能有一份真源（`core/settingsplugins.ets`）；组件里再写一份
 *      映射必然漂移 ⇒ 组件侧只许出现**调用点**（`settingsRootGroups(`），⛔ 不许出现第二份 id→组 的表。
 *   ③ **反向（判别力）**：把页签条/芯片网格加回来、或把 `misc` 兜底摘掉（未知分区静默消失）⇒ 必红。
 *
 * ── 判据（零扫描判红 + mutation 自证）─────────────────────────────────────────
 *   ① 纯逻辑：并集/无重项/组序=声明序/组内保序/未知 id 落 `misc`/空组丢弃
 *   ② 跨文件一致：`SettingsPanel.ets` 里**每一个** `new SettingsTabSpec(<常量>, …)` 的常量值
 *      都被**显式**分到某个具名组（即 `settingsGroupKeyOfTab(id) !== 'misc'`）⇒ 新增分区忘登记必红
 *   ③ 组件形态：`RootList()` + `chevron_right`（钻取）+ `chevron_left`（返回）+ `active = ''`
 *   ④ 白绿防线：组件侧调用点计数 ≥ 1（扫到 0 处判红）
 *   ⑤ mutation：(a) 把 `settingsGroupKeyOfTab` 的 `misc` 兜底删掉 ⇒ ② 红；
 *      (b) 把某分区从分组表里删掉 ⇒ ①（并集）②（显式性）红；
 *      (c) 把组件里 `settingsRootGroups(` 换成组件自写映射 ⇒ ④ 红（调用点 0）。
 *
 * ⚠️ 纯 TS（`export {}`；⛔ 判据不许 import 组件 `.ets` —— 只以文本读它）；结尾 `process.exit`。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

import {
  settingsGroupKeyOfTab, settingsGroupKeys, settingsGroupTitle, settingsRootGroups, settingsRootRows,
  SettingsGroupSpec, SettingsRootRow, SettingsTabSpec,
} from '../../entry/src/main/ets/core/settingsplugins';

const fsMod = require('fs');
const pathMod = require('path');

/** 稳健定位仓库根（编译产物层级不固定 ⇒ 别写死 `..` 数量）。 */
function findRoot(start: string): string {
  let cur: string = start;
  for (let i: number = 0; i < 10; i++) {
    if (fsMod.existsSync(pathMod.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = pathMod.join(cur, '..');
  }
  return '';
}

/** 剥注释（等长替换；断言只看代码）。 */
function stripComments(src: string): string {
  const out: string[] = [];
  const n: number = src.length;
  let i: number = 0;
  while (i < n) {
    const c: string = src.charAt(i);
    if (c === '/' && i + 1 < n && src.charAt(i + 1) === '/') {
      const j: number = src.indexOf('\n', i);
      i = j < 0 ? n : j;
      continue;
    }
    if (c === '/' && i + 1 < n && src.charAt(i + 1) === '*') {
      const j: number = src.indexOf('*/', i + 2);
      const end: number = j < 0 ? n : j;
      for (let k: number = i; k < end; k++) { if (src.charAt(k) === '\n') { out.push('\n'); } }
      i = end + 2;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const ROOT: string = findRoot(__dirname);
ok('定位到仓库根', ROOT.length > 0);
const COMP: string = pathMod.join(ROOT, 'entry', 'src', 'main', 'ets', 'components');
const panelSrc: string = stripComments(fsMod.readFileSync(pathMod.join(COMP, 'SettingsPanel.ets'), 'utf-8'));

// ── ① 纯逻辑：并集 / 无重项 / 组序 / 组内保序 ───────────────────────────────────
function spec(id: string, label: string): SettingsTabSpec {
  return new SettingsTabSpec(id, label, true);
}
const all: SettingsTabSpec[] = [
  spec('appearance', '外观'), spec('tools', '工具'), spec('llm', '模型'), spec('agent', '智能体'),
  spec('plugins', '插件'), spec('channels', '消息渠道'), spec('storage', '存储'), spec('webusers', 'Web 账号'),
  spec('developer', '开发者'), spec('notify', '通知'), spec('about', '关于'), spec('account', '账号'),
];
const groups: SettingsGroupSpec[] = settingsRootGroups(all);

{
  const seen: string[] = [];
  for (let g = 0; g < groups.length; g++) {
    for (let i = 0; i < groups[g].items.length; i++) { seen.push(groups[g].items[i].id); }
  }
  ok(`① 分组并集 == 传入集合（传入 ${all.length} / 分组 ${seen.length}）`, seen.length === all.length);
  let dup: boolean = false;
  for (let i = 0; i < seen.length; i++) {
    for (let j: number = i + 1; j < seen.length; j++) { if (seen[i] === seen[j]) { dup = true; } }
  }
  ok('① 无重项（同一分区不得出现在两个组）', !dup);
  let missing: string = '';
  for (let i = 0; i < all.length; i++) {
    let hit: boolean = false;
    for (let j = 0; j < seen.length; j++) { if (seen[j] === all[i].id) { hit = true; } }
    if (!hit) { missing = all[i].id; }
  }
  ok(`① 无丢项（丢项 =「${missing}」）`, missing.length === 0);
}

{
  // 组序 = 声明序（`settingsGroupKeys()`）的**子序列**（空组丢弃后相对序不变）。
  const keys: string[] = settingsGroupKeys();
  let last: number = -1;
  let mono: boolean = true;
  for (let g = 0; g < groups.length; g++) {
    const idx: number = keys.indexOf(groups[g].key);
    if (idx < 0 || idx < last) { mono = false; }
    last = idx;
  }
  ok('① 组序 = settingsGroupKeys() 的声明序', mono && groups.length > 0);
  // 组内保序：首个成员在传入数组里的下标必须递增（同组内）。
  let inorder: boolean = true;
  for (let g = 0; g < groups.length; g++) {
    let prev: number = -1;
    for (let i = 0; i < groups[g].items.length; i++) {
      const at: number = all.findIndex((s: SettingsTabSpec) => s.id === groups[g].items[i].id);
      if (at < prev) { inorder = false; }
      prev = at;
    }
  }
  ok('① 组内顺序 = 传入顺序（不重排用户看到的次序）', inorder);
}

// ── ①b 未知 id ⇒ `misc`（fail-open：新增分区忘登记也**不消失**）────────────────
ok("①b 未知 id 落 'misc'（fail-open 兜底）", settingsGroupKeyOfTab('a-brand-new-section') === 'misc');
ok("①b 'misc' 组名为「其它」", settingsGroupTitle('misc') === '其它');
{
  const onlyUnknown: SettingsGroupSpec[] = settingsRootGroups([spec('a-brand-new-section', '新分区')]);
  ok('①b 未知分区照样出现在根列表（不会被静默吞掉）',
    onlyUnknown.length === 1 && onlyUnknown[0].key === 'misc' && onlyUnknown[0].items.length === 1);
}

// ── ①c 空组丢弃（未实现的分区被门控滤掉后，不留空组头）────────────────────────
{
  const none: SettingsGroupSpec[] = settingsRootGroups([new SettingsTabSpec('appearance', '外观', false)]);
  ok('①c 全未实现 ⇒ 无任何分组（不留空组头）', none.length === 0);
}

// ── ①d 扁平行序列（渲染侧只需**一个** `ForEach`）────────────────────────────────
//    两层 ForEach（组 × 行）会顶穿 `tools/perf/guard.sh` 的 `ForEach 处数` 预算（只许减不许增）
//    ⇒ core 直接给行序列；这里钉"组头行紧跟其成员行""成员行 last 标记正确"。
{
  const rows: SettingsRootRow[] = settingsRootRows(all);
  ok(`①d 行数 = 组头行 ${groups.length} + 成员行 ${all.length}`,
    rows.length === groups.length + all.length);
  let shapeOk: boolean = true;
  let i: number = 0;
  while (i < rows.length) {
    if (!rows[i].isHeader) { shapeOk = false; break; }
    const headKey: string = rows[i].key;
    i++;
    let members: number = 0;
    let lastFlagOk: boolean = true;
    while (i < rows.length && !rows[i].isHeader) {
      if (settingsGroupKeyOfTab(rows[i].key) !== headKey) { shapeOk = false; }
      if (rows[i].label.length === 0) { shapeOk = false; }
      members++;
      // last 标记：只有该组最后一行能为 true（且必须为 true）
      const isLastRowOfGroup: boolean = i + 1 >= rows.length || rows[i + 1].isHeader;
      if (rows[i].last !== isLastRowOfGroup) { lastFlagOk = false; }
      i++;
    }
    if (members === 0) { shapeOk = false; }
    if (!lastFlagOk) { shapeOk = false; }
  }
  ok('①d 结构：组头行 + 成员行交替、成员归属正确、组不为空、last 标记正确', shapeOk);
  // 组头行不得带 last、也不得可点（组件按 `isHeader` 分支渲染 ⇒ 结构性保证）
  let headerClean: boolean = true;
  for (let k: number = 0; k < rows.length; k++) {
    if (rows[k].isHeader && rows[k].last) { headerClean = false; }
  }
  ok('①d 组头行不带 last（组尾标记只属于成员行）', headerClean);
}

// ── ② 跨文件一致：组件声明的**每一个**分区都被显式分组（忘登记必红）───────────
{
  // 取常量真值：`export const SETTINGS_TAB_X: string = 'y'`
  const constVals: string[] = [];
  const reConst: RegExp = /export const SETTINGS_TAB_[A-Z_]+: string = '([^']+)'/g;
  let mc: any = reConst.exec(panelSrc);
  while (mc !== null) { constVals.push(String(mc[1])); mc = reConst.exec(panelSrc); }
  ok(`② 取到分区 id 常量（现 ${constVals.length} 个，应 ≥ 10）`, constVals.length >= 10);
  const declared: string[] = [];
  const reSpec: RegExp = /new SettingsTabSpec\(([^,]+),\s*'([^']*)'/g;
  let ms: any = reSpec.exec(panelSrc);
  while (ms !== null) {
    const token: string = String(ms[1]).trim();
    let id: string = '';
    if (token.indexOf('SETTINGS_TAB_') === 0) { id = token; } else if (token.indexOf("'") === 0) { id = token.replace(/'/g, ''); }
    if (id.length > 0) { declared.push(id); }
    ms = reSpec.exec(panelSrc);
  }
  ok(`② 取到组件声明的分区（现 ${declared.length} 个，应 ≥ 10）`, declared.length >= 10);
  const notPlaced: string[] = [];
  for (let i = 0; i < declared.length; i++) {
    const token: string = declared[i];
    let value: string = '';
    if (token.indexOf('SETTINGS_TAB_') === 0) {
      // 常量名 → 真值：源码里是 `export const SETTINGS_TAB_X: string = 'y'`（名字**不带引号**）。
      const reOne: RegExp = new RegExp(token + ":\\s*string\\s*=\\s*'([^']+)'");
      const m1: any = reOne.exec(panelSrc);
      value = m1 !== null ? String(m1[1]) : '';
    } else {
      value = token.replace(/'/g, '');
    }
    if (value.length === 0) { notPlaced.push(`<无法解析 ${token}>`); continue; }
    if (settingsGroupKeyOfTab(value) === 'misc') { notPlaced.push(value); }
  }
  ok(`② 每个声明的分区都被**显式**分组（未登记 = ${notPlaced.join(',')}）`, notPlaced.length === 0);
}

// ── ③ 组件形态：根列表 + 钻取/返回箭头 + 返回清态 ──────────────────────────────
ok('③ 组件有 RootList()（第一层 = 分组列表）', panelSrc.indexOf('RootList()') >= 0);
ok('③ 根列表行有钻取箭头 chevron_right', panelSrc.indexOf('sys.symbol.chevron_right') >= 0);
ok('③ 钻入后页头有返回箭头 chevron_left', panelSrc.indexOf('sys.symbol.chevron_left') >= 0);
ok("③ 返回键清空 active（回到根列表）", panelSrc.indexOf("this.active = '';") >= 0);
ok('③ 行命中盒 = HIT_TARGET_MIN（真机命中下限）',
  panelSrc.indexOf('.constraintSize({ minHeight: HIT_TARGET_MIN })') >= 0);

// ── ④ 白绿防线 + 同源 + 预算：调用点计数 / 单一 ForEach / 组件不许自写第二份映射 ──
{
  let calls: number = 0;
  let from: number = panelSrc.indexOf('settingsRootRows(');
  while (from >= 0) { calls++; from = panelSrc.indexOf('settingsRootRows(', from + 1); }
  ok(`④ 组件里 settingsRootRows( 调用点 ≥ 1（实得 ${calls}）`, calls >= 1);
  // 预算护栏（硬性）：根列表只许**一个** ForEach —— 两层会把 `guard.sh` 的 ForEach 处数顶穿
  // （2026-10-16 实测 118 > 上限 117）。这里按"RootList 区间内的 ForEach 计数"钉死。
  const rlStart: number = panelSrc.indexOf('RootList() {');
  const rlEnd: number = panelSrc.indexOf('build() {', rlStart);
  const rlBody: string = rlStart >= 0 && rlEnd > rlStart ? panelSrc.substring(rlStart, rlEnd) : '';
  let feCount: number = 0;
  let f: number = rlBody.indexOf('ForEach(');
  while (f >= 0) { feCount++; f = rlBody.indexOf('ForEach(', f + 1); }
  ok(`④ RootList 内 ForEach 恰好 1 个（实得 ${feCount}；扁平行模型是预算内唯一正解）`, feCount === 1);
  ok('④ 组件里不再有旧页签条 TabBar()', panelSrc.indexOf('TabBar()') < 0);
  ok('④ 组件里不再有分区芯片令牌 TAB_CHIP_W', panelSrc.indexOf('TAB_CHIP_W') < 0);
  // 同源：组件不许出现第二份 id→组 的映射（例如又写 'personal'/组名）
  ok('④ 组件不出现组 key 字面量（分组真源只在 core）',
    panelSrc.indexOf("'personal'") < 0 && panelSrc.indexOf("'misc'") < 0);
  ok('④ 分组标题真源在 core（组件不出现组名文案）',
    panelSrc.indexOf("'个性化'") < 0 && panelSrc.indexOf("'连接与账号'") < 0 && panelSrc.indexOf("'模型与智能体'") < 0);
  // 白绿防线：以上若**一条都没扫到**（例如区间定位失败）⇒ 必红（防"扫到 0 处"假绿）。
  ok('④ 白绿防线：RootList 区间真的取到了（长度 > 200）', rlBody.length > 200);
}

if (fail > 0) {
  console.log(`  ✗ settings_root_list: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ settings_root_list: ${pass} passed, 0 failed`);
process.exit(0);

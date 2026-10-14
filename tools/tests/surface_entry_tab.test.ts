/**
 * 能力面**入口页签**接线门禁 —— `pages/Index.openSurface` 的入口→页签映射证据。
 *
 * ── 背景（2026-10-16 装机实测，真复现）────────────────────────────────────────────
 *   底栏「任务」与「终端」共用同一个**运行面板**（页签 cron/tasks/agents/runners/term）。
 *   `openSurface` 此前：
 *     · `SURF_TERMINAL` ⇒ `switchPanelTab('term')` + `openPanels()` ✅
 *     · `SURF_TASKS`    ⇒ 只 `openPanels()` ❌ —— 而 `panelTab` 是**页面 @State**（跨开合保留）
 *   ⇒ 用户上一轮用过「终端」再点底栏「任务」，面板**直接落在终端页**（实测：点「任务」后
 *   面板文本仍是「暂无终端 / 新建终端即可在此设备上运行 shell」）⇒ 入口名实不符。
 *   修复 = 任务入口显式落 `cron`（任务面 = 定时 + 后台，权威落地页 = `cron`；`panelTab`
 *   的初值也是 `'cron'`，两处同源）。
 *
 * ── 钉什么 ────────────────────────────────────────────────────────────────────
 *   ① 零扫描判红：`Index.ets` 真读到；`openSurface` 切片非空。
 *   ② `SURF_TASKS` 分支**必须**含 `switchPanelTab('cron')` 恰 1 处（+ `openPanels()`）。
 *   ③ `SURF_TERMINAL` 分支**必须**含 `switchPanelTab('term')` 恰 1 处（不许回退）。
 *   ④ `panelTab` 初值 = `'cron'` 恰 1 处（入口语义与默认页同源）。
 *
 * ⚠️ 纪律：剥注释（注释里写这些形态是文档，不是调用点）；切片按**函数**取；计数精确。
 * ✅ 判据自证（mutation）：删掉 `SURF_TASKS` 分支里的 `switchPanelTab('cron');` ⇒ ② 红；
 *   把 `SURF_TERMINAL` 的 `'term'` 改掉 ⇒ ③ 红；还原 ⇒ 全绿。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

// ⛔ 标记为模块（顶层变量不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}`); }
}
function eq(name: string, got: number, want: number): void {
  ok(`${name}（期望 ${want}，实得 ${got}）`, got === want);
}

const REPO: string = path.resolve(__dirname, '../../../..');
function readSrc(rel: string): string {
  const raw: string = fs.readFileSync(path.join(REPO, rel), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
function count(s: string, needle: string): number {
  return s.split(needle).length - 1;
}

const idx: string = readSrc('entry/src/main/ets/pages/Index.ets');

// ── ① 零扫描判红 ────────────────────────────────────────────────────────────
ok('① Index.ets 读到', idx.length > 200000);

const start: number = idx.indexOf('private openSurface(id: string): void {');
const end: number = idx.indexOf('private openFiles()', start);
const slice: string = start >= 0 && end > start ? idx.slice(start, end) : '';
ok(`① openSurface 切片非空（实得 ${slice.length} 字符）`, slice.length > 0);

// ── ② 任务入口必须落 cron 页 ────────────────────────────────────────────────
const tIdx: number = slice.indexOf('SURF_TASKS');
const tEnd: number = tIdx >= 0 ? slice.indexOf('SURF_TERMINAL', tIdx) : -1;
const tasksBranch: string = tIdx >= 0 ? slice.slice(tIdx, tEnd > tIdx ? tEnd : slice.length) : '';
ok('② SURF_TASKS 分支取到', tasksBranch.length > 0);
eq('② 任务入口恰 1 处 switchPanelTab(cron)', count(tasksBranch, "switchPanelTab('cron')"), 1);
eq('② 任务入口仍开运行面板', count(tasksBranch, 'openPanels()'), 1);

// ── ③ 终端入口必须落 term 页（不许回退）────────────────────────────────────
const sIdx: number = slice.indexOf('SURF_TERMINAL');
const sEnd: number = sIdx >= 0 ? slice.indexOf('return;', sIdx) : -1;
const termBranch: string = sIdx >= 0 ? slice.slice(sIdx, sEnd > sIdx ? sEnd : slice.length) : '';
ok('③ SURF_TERMINAL 分支取到', termBranch.length > 0);
eq('③ 终端入口恰 1 处 switchPanelTab(term)', count(termBranch, "switchPanelTab('term')"), 1);

// ── ④ 默认页 = cron（入口语义与默认页同源）──────────────────────────────────
eq('④ panelTab 初值 = cron 恰 1 处', count(idx, "panelTab: string = 'cron'"), 1);

console.log(`  surface_entry_tab: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

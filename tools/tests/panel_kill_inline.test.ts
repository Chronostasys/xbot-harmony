/**
 * panel_kill_inline —— 「运行中的后台任务：**列表里一步可杀**」的源码形态判据。
 *
 * ── 为什么（用户口径「终端和任务管理做的很差」，2026-10-13）─────────────────────────
 * web 权威 `web/src/components/sidebar/TasksPanel.tsx:246-255`：**只有** `running` 的行在尾部
 * 渲染 `Square` 终止按钮（`kill_bg_task`）；原生此前**只能先点进详情卡**才杀得掉
 * （`TaskDetailSheet.onKill`）⇒ 手机上杀一条跑飞的任务 = 3 次操作。本笔补上行内终止。
 *
 * ── 判据（钉**调用点/字面量形态**，⛔ 不钉"方法体存在"这类假绿形态）────────────────
 *   ① `pages/Index.ets` 的任务行尾部动作 = **`bgTaskRunning(t)` 分流**
 *      （`ROW_TRAIL_STOP` : `ROW_TRAIL_CHEVRON`）—— 恰好 1 处；且 `onTrailing` 落到
 *      `killBgTaskRow(`。
 *   ② `components/PanelRows.ets`：`ROW_TRAIL_STOP` 常量在 + 渲染分支用
 *      `sys.symbol.square_fill` + a11y `终止任务` + 真实 `HIT_TARGET_MIN` 布局盒
 *      （⛔ 不许 `responseRegion` 负偏移外扩：真机实测 SDK21 无效，见 AGENTS.md GOTCHAS）。
 *   ③ **零扫描判红**：①/② 的扫描源读不到 ⇒ 直接红（白绿防线）。
 *
 * 🔬 mutation 自证：把 Index 的行改回常量 `ROW_TRAIL_CHEVRON`（去掉分流）⇒ ① 红；
 *    删掉 PanelRows 的 STOP 分支 ⇒ ② 红；把 `killBgTaskRow` 调用删掉 ⇒ ① 红。
 * ⚠️ 结尾 `process.exit`（`run.sh` 用 `set -e` 逐文件跑，不退出会挂住整套）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const fs = require('fs');
const path = require('path');
const REPO: string = path.join(__dirname, '..', '..', '..', '..');
const PAGES: string = path.join(REPO, 'entry/src/main/ets/pages');
const COMP: string = path.join(REPO, 'entry/src/main/ets/components');

/** **剥注释**（块 + 行；行注释用 `(^|[^:])//` 以免剥掉 `https://`）—— 只认**生产**代码。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readOrEmpty(p: string): string {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch (e) {
    return '';
  }
}

const IDX_SRC: string = stripComments(readOrEmpty(path.join(PAGES, 'Index.ets')));
const ROWS_SRC: string = stripComments(readOrEmpty(path.join(COMP, 'PanelRows.ets')));

console.log(`  kill-inline scan: Index.ets=${IDX_SRC.length}B PanelRows.ets=${ROWS_SRC.length}B`);

// ── ③ 白绿防线：两个源都必须读到 ────────────────────────────────────────────────
ok('③ 扫描源非空（Index.ets / PanelRows.ets 都读到）',
  IDX_SRC.length > 1000 && ROWS_SRC.length > 1000);

// ── ② PanelRows：常量 + 渲染分支（动作字形/热区/a11y）──────────────────────────
const STOP_CONST: string = "export const ROW_TRAIL_STOP: string = 'stop'";
ok('② ROW_TRAIL_STOP 常量在场（字面量 `stop`）', ROWS_SRC.indexOf(STOP_CONST) >= 0);
ok('② 渲染分支判 `this.trailing === ROW_TRAIL_STOP`',
  ROWS_SRC.indexOf('this.trailing === ROW_TRAIL_STOP') >= 0);
ok('② 终止动作字形 = sys.symbol.square_fill（与「已终止」状态字形 stop_circle 刻意区分）',
  ROWS_SRC.indexOf("$r('sys.symbol.square_fill')") >= 0);
ok("② a11y 文案 = 终止任务", ROWS_SRC.indexOf("'终止任务'") >= 0);
ok('② 热区走真实 HIT_TARGET_MIN 布局盒（⛔ 不用 responseRegion 外扩）',
  ROWS_SRC.indexOf('ROW_TRAIL_STOP') >= 0 && ROWS_SRC.indexOf('HIT_TARGET_MIN') >= 0
  && ROWS_SRC.indexOf('responseRegion') < 0);

// ── ① 页面：尾部动作按 bgTaskRunning 分流，且落到 killBgTaskRow ────────────────
const SPLIT: string = 'trailing: bgTaskRunning(t) ? ROW_TRAIL_STOP : ROW_TRAIL_CHEVRON';
let nSplit = 0;
let i = IDX_SRC.indexOf(SPLIT);
while (i >= 0) { nSplit++; i = IDX_SRC.indexOf(SPLIT, i + SPLIT.length); }
ok('① 任务行尾部动作按 `bgTaskRunning(t)` 分流（运行中 ⇒ STOP，否则 ⇒ CHEVRON），恰好 1 处',
  nSplit === 1);
ok('① 分流判据用的是既有真源 `bgTaskRunning`（⛔ 不许页面自写状态判断）',
  IDX_SRC.indexOf('bgTaskRunning(t) ? ROW_TRAIL_STOP') >= 0);
let nKillRow = 0;
i = IDX_SRC.indexOf('this.killBgTaskRow(t)');
while (i >= 0) { nKillRow++; i = IDX_SRC.indexOf('this.killBgTaskRow(t)', i + 20); }
ok('① 行尾动作落到 `this.killBgTaskRow(t)`，恰好 1 处', nKillRow === 1);
ok('① 行内终止走既有 RPC 出口 `killBgTask`（⛔ 不新写取数/接口）',
  IDX_SRC.indexOf('st.killBgTask(id)') >= 0);
// ⛔ 反向：不许再出现"任务行尾部恒为 chevron"的旧形态（那正是本笔修掉的）
ok('① 任务行的旧形态（`tone: bgTaskTone(t),\n   … ROW_TRAIL_CHEVRON` 直连）已不存在',
  IDX_SRC.indexOf('tone: bgTaskTone(t),\n                  trailing: ROW_TRAIL_CHEVRON') < 0);

if (fail > 0) {
  console.log(`  panel_kill_inline: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  panel_kill_inline: ${pass} passed, 0 failed`);
process.exit(0);

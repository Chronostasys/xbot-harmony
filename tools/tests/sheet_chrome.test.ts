/**
 * 面板/sheet 页头 chrome 统一契约测试 —— 「关闭 X 一个设计系统」（2026-10-12 目标③）。
 *
 * 动机（真实清点，不是假想）：9 个面板的"关闭 X"曾**各写各的** ——
 *   · 尺寸三族：`X_GLYPH=17`（`AskUserSheet`/`StatusSheet` **各定义一份同名魔数**）、`ICON_LG=16`、
 *     `ICON_MD=14`、还有一个裸 `15`（`QueueSheet` 行内移除 X）；
 *   · 颜色三族：`pal().textSecondary` / `palOnce().textSecondary` / `colorOf(…,'iconMuted')`。
 * 用户要求③是"**所有面板**一个设计系统、对标苹果" ⇒ 同一个"关闭"在不同面板里大小/深浅都不同，
 * 观感就是"几个产品拼起来的"。⇒ 本单钉**形态契约**（谁、用哪个出口、**站内零魔数**），
 * 与 `collapse_all_wiring` / `motion_wiring_batch2` 同款（组件/页面不进离线 harness ⇒ 读真实源码断言）。
 *
 * ⛔ 判据纪律（AGENTS.md「判据 ≠ 信号」）：
 *   · **先剥注释**（本仓用注释记录"为什么不用某做法"，朴朴素 grep 会把文档当违规 —— 本单里
 *     `AskUserSheet`/`StatusSheet` 的注释**正文明写含 `X_GLYPH`**，不剥注释必假红）；
 *   · **只取属性链片段**（从字形那一行向下，遇到不以 `.` 开头的行即止）—— 不"取整行猜"、
 *     不"取固定 500 字符"（会串到下一个字形的属性上 ⇒ 假绿）；
 *   · **零扫描判红**（读不到源 / 某文件 0 命中 ⇒ 红，白绿防线）；
 *   · **逐文件钉命中数**（少一处 = 有人删了关闭键却仍"全绿"）；
 *   · 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 *
 * **mutation 自证**（改完应各红一条）：
 *   · 把任一 sheet 的 `.fontSize(SHEET_ACTION_GLYPH)` 改回 `.fontSize(17)` ⇒ 该文件红；
 *   · 把 `.fontColor([colorOf(this.pal(), 'iconMuted')])` 改回 `[this.pal().textSecondary]` ⇒ 红；
 *   · 在任一 sheet 重新引入 `const X_GLYPH = 17;` 常量 + 使用 ⇒ 红（魔数回归）；
 *   · 删掉 `core/design.ets` 的 `SHEET_ACTION_GLYPH` 导出 ⇒ 全局红。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
// ⛔ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名（本仓已入库 GOTCHA）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

/** 剥 `//` 与 `/* *\/` 注释 —— 只判**代码**（注释里明写了 `X_GLYPH` 等文档记号）。 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    const n = i + 1 < src.length ? src.charAt(i + 1) : '';
    if (c === '/' && n === '/') {
      while (i < src.length && src.charAt(i) !== '\n') { i++; }
      if (i < src.length) { out += '\n'; i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && i + 1 < src.length && src.charAt(i + 1) === '/')) {
        if (src.charAt(i) === '\n') { out += '\n'; }
        i++;
      }
      i += 2;
    } else { out += c; i++; }
  }
  return out;
}

/** 探测仓库根（含 `entry/src/main/ets/core/design.ets` 的那层）。 */
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/core/design.ets'))) { return p; }
  }
  return '';
}

const root: string = findRoot();
ok('探测到仓库根（含 core/design.ets）', root.length > 0);
const ETS: string = path.join(root, 'entry/src/main/ets');

function read(p: string): string {
  try { return stripComments(fs.readFileSync(p, 'utf8')); } catch (e) { return ''; }
}

/** 关闭 X 字形（**非** `_fill`：`xmark_circle_fill` 是"清空/终止"等**别的**语义，不属本契约）。 */
const NEEDLE: string = "sys.symbol.xmark')";

/**
 * 取每处关闭 X 的**属性链片段**：从字形所在行起向下累积，直到遇到一行（trim 后）
 * **不以 `.` 开头**者（ArkTS 属性链每行以 `.` 起）—— ⛔ 不用固定窗口（会串到下一字形的属性 ⇒ 假绿）。
 */
function closeChains(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (true) {
    const at = src.indexOf(NEEDLE, i);
    if (at < 0) { break; }
    // 回退到该行行首
    let ls: number = at;
    while (ls > 0 && src.charAt(ls - 1) !== '\n') { ls--; }
    let cur = ls;
    const lines: string[] = [];
    let first = true;
    while (cur <= src.length && lines.length < 12) {
      const nl = src.indexOf('\n', cur);
      const line = nl < 0 ? src.substring(cur) : src.substring(cur, nl);
      const t = line.trim();
      if (!first) {
        if (t.length > 0 && t.charAt(0) !== '.') { break; }
        if (t.length === 0) { break; }
      }
      lines.push(line);
      first = false;
      if (nl < 0) { break; }
      cur = nl + 1;
    }
    out.push(lines.join('\n'));
    i = at + NEEDLE.length;
  }
  return out;
}

// ── ① design 层：单一 token 存在，且值 = ICON_LG（⛔ 防有人改成别的值而静默漂移）─────
{
  const src: string = read(path.join(ETS, 'core/design.ets'));
  ok('① core/design.ets 读到源码（零扫描判红）', src.length > 0);
  ok('① core/design.ets 导出 SHEET_ACTION_GLYPH 且值 = ICON_LG',
    /export\s+const\s+SHEET_ACTION_GLYPH\s*:\s*number\s*=\s*ICON_LG\s*;/.test(src));
}

// ── ② 9 个面板：每处关闭 X 都必须走统一 token + 弱色 role；逐文件钉命中数 ────────────
// 每文件最低命中数（少一处 = 关闭键被删却没被发现）。QueueSheet 有 2 处（头部关闭 + 行内移除）。
const SHEETS: string[] = [
  'components/AskUserSheet.ets',
  'components/StatusSheet.ets',
  'components/SessionStatsSheet.ets',
  'components/PluginsSheet.ets',
  'components/FilesSheet.ets',
  'components/TerminalSheet.ets',
  'components/QueueSheet.ets',
  'components/SelfCheckSheet.ets',
  'components/TaskDetailSheet.ets',
];
const MIN_HITS: number[] = [1, 1, 1, 1, 1, 1, 2, 1, 1];
let totalChains = 0;
for (let k = 0; k < SHEETS.length; k++) {
  const rel: string = SHEETS[k];
  const src: string = read(path.join(ETS, rel));
  ok(`② ${rel} 读到源码（零扫描判红）`, src.length > 0);
  const chains: string[] = closeChains(src);
  totalChains += chains.length;
  ok(`② ${rel} 关闭 X 命中数 ≥ ${MIN_HITS[k]}（实测 ${chains.length}）`, chains.length >= MIN_HITS[k]);
  for (let j = 0; j < chains.length; j++) {
    const c: string = chains[j];
    const tag: string = `② ${rel} 第 ${j + 1} 处关闭 X`;
    ok(`${tag} 用 \`.fontSize(SHEET_ACTION_GLYPH)\`（⛔ 站内零魔数）`,
      c.indexOf('.fontSize(SHEET_ACTION_GLYPH)') >= 0, c);
    // 弱色图标**必须**走计算型 role `iconMuted`（AGENTS.md GOTCHA）；
    // 例外：破坏性动作（QueueSheet 行内"移除"）走 `dangerText` —— **显式**才放行。
    ok(`${tag} 颜色 = \`colorOf(…,'iconMuted')\`（或破坏性 \`dangerText\`）`,
      c.indexOf("'iconMuted'") >= 0 || c.indexOf('dangerText') >= 0, c);
    // ⛔ 反面形态：旧的"文字角色当图标色"
    ok(`${tag} ⛔ 不得用 \`.textSecondary\`/裸 \`.textPrimary\` 当图标色`,
      c.indexOf('textSecondary') < 0 && c.indexOf('.textPrimary') < 0, c);
  }
}
ok(`② 9 个面板关闭 X 总数 = 10（实测 ${totalChains}；删一处即红）`, totalChains === 10);

// ── ③ 魔数回归防线：这 9 个文件里不得再有局部 `X_GLYPH` 标识符 ────────────────────
for (const rel of SHEETS) {
  const src: string = read(path.join(ETS, rel));
  ok(`③ ${rel} 无局部魔数 \`X_GLYPH\`（回归防线）`, src.indexOf('X_GLYPH') < 0);
}

if (fail > 0) { console.log(`  sheet_chrome: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  sheet_chrome: ${pass} passed, 0 failed`);
process.exit(0);

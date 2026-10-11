/**
 * 交互反馈一致性门禁（**静态源码扫描**）—— 防"点了像没反应"的回归。
 *
 * 判定口径：
 *   ① 凡可点的聊天流容器 ⇒ 必须有 `stateStyles({ pressed: … })` 的按压反馈；
 *   ② 按压不透明度只准引用 `PRESS_OPACITY`（不许写死 `.opacity(0.6)`）；
 *   ③（④/⑤ 见下）**通用判据**：`onClick` 被 flag **纯守卫**（`if(flag){动作}`、无 `else`）
 *      ⇒ 必须 `.enabled(同一 flag)`（交互死区防护）。
 *
 * ✅ **⑤ 已推广到全 `components/**`**（`fs.readdirSync` 枚举，非手写清单）—— 扫描器**自证**：
 *    打印扫描目录 + 文件数 + 文件名 + 每文件 `onClick`/守卫命中分布 + 每个命中给"修/明示豁免"；
 *    **零扫描判红**（全仓 onClick=0 ⇒ 红，防正则与真源脱节的白绿）。
 *    豁免只在 `GUARD_EXEMPT` 里**逐个附理由**（当前 2 条，均为"opacity 明示禁用 ⇒ 视觉不撒谎"）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 必须把本文件标记为**模块**（`export {}`）：否则它是全局脚本，顶层 `process/require/pass/fail`
//    会与其它同款脚本测试（如 `one_inflight_motion.test.ts`）在 `run-all` 的全量编译里**重名冲突**
//    （TS2451 / TS2393）。`run-one.sh` 单文件编译不会暴露，只有 `run.sh`/`gate` 全量编译才红。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const CDIR: string = path.join(REPO, 'entry/src/main/ets/components');

/** 聊天流交互组件（见文件头：只扫不在他人手上的）。 */
const FILES: string[] = [
  'MessageRow.ets', 'LiveTailView.ets', 'MarkdownView.ets', 'AuthImage.ets',
  'SubAgentTree.ets', 'ToolVisual.ets', 'LlmErrorNotice.ets', 'TodoPanel.ets',
];

/**
 * **按压值豁免**：大卡片有意用更柔的按压值（非 `PRESS_OPACITY` 的 0.6）——**不是**不统一。
 * `SubAgentTree` 用 `0.75`（大面卡片压到 0.6 过重），且该值**被既有测试钉死**
 * （`tools/tests/moment_polish.test.ts:78`）⇒ 此处豁免"必须引用 PRESS_OPACITY"这条。
 */
const PRESS_EXEMPT: string[] = ['SubAgentTree.ets'];

function countAll(s: string, re: RegExp): number {
  const m = s.match(re);
  return m === null ? 0 : m.length;
}

for (let i = 0; i < FILES.length; i++) {
  const f: string = FILES[i];
  const p: string = path.join(CDIR, f);
  let src: string;
  try {
    src = fs.readFileSync(p, 'utf8');
  } catch (e) {
    ok(`${f} 可读`, false, `读不到 ${p}`);
    continue;
  }
  const clicks: number = countAll(src, /\.onClick\(/g);
  const presses: number = countAll(src, /stateStyles\(/g);
  // ① 有可点元素 ⇒ 必须有按压反馈
  ok(`${f}：可点 ⇒ 有 press 反馈（onClick=${clicks}, stateStyles=${presses}）`,
    clicks === 0 || presses >= 1);
  // ② 有按压反馈 ⇒ 必须引用统一常量（不写死数值），或属**明示豁免**（大卡片柔压，见 PRESS_EXEMPT）
  ok(`${f}：press 走 PRESS_OPACITY（或明示豁免）`,
    presses === 0 || src.indexOf('PRESS_OPACITY') >= 0 || PRESS_EXEMPT.indexOf(f) >= 0);
  // ③ 不得写死按压不透明度
  ok(`${f}：无写死的 .opacity(0.6)`, src.indexOf('.opacity(0.6)') < 0);
}

// ── ④ 交互死区：**受保护的可点行必须真禁用**（否则照常有 press、点了却没反应）──────────
// SubAgentTree 行 `onClick` 被 `if (this.openable)` 守卫 ⇒ 不可点行必须 `.enabled(openable)`
// 一并关掉 press/事件（web `SubAgentProgressTree.tsx:124` 的 `disabled` 同义）。
{
  const treeSrc: string = fs.readFileSync(path.join(CDIR, 'SubAgentTree.ets'), 'utf8');
  ok('SubAgentTree：受守卫的可点行带 .enabled(openable)',
    treeSrc.indexOf('.enabled(this.openable)') >= 0 && treeSrc.indexOf('if (this.openable)') >= 0);
}

// ── ⑤ **通用判据 —— 全 `components/**`**：`onClick` 被 flag **纯守卫**（`if (flag) { 动作 }`，无
//    `else`）⇒ 必须 `.enabled(同一 flag)`（否则"能点但没用"= **交互死区**，press 反馈撒谎）。
//    · **剥注释**（行注释 `(^|:)//`，免剥掉 `https://` 里的 `//`）
//    · **只取 onClick 调用片段**（正则取体，不取整行）
//    · **零扫描判红**（全仓 onClick 总数为 0 ⇒ 红；防"正则与真源脱节 ⇒ 白绿"）
//    · `if/else` 两分支都动作的**不算**死区（如 `AuthImage` 失败重试 vs 打开）
//    · **opacity 明示禁用**的走 `GUARD_EXEMPT`（附理由 —— 视觉已表达禁用 ⇒ press 不撒谎）
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
/** 豁免：动作被 flag 守卫，但**用透明度明示了"已禁用"**（视觉不撒谎）⇒ 不算交互死区。 */
const GUARD_EXEMPT: Map<string, string> = new Map<string, string>([
  ['AskUserSheet.ets', '提交键 binding/busy 时 .opacity(DISABLED_OPACITY) 明示禁用'],
  ['SettingsChannels.ets', '绑定键 binding 时 .opacity(0.5) 明示禁用'],
]);
{
  const comps: string[] = fs.readdirSync(CDIR).filter((n: string): boolean => n.endsWith('.ets')).sort();
  // ① 扫描器自证：扫了哪些文件（绝对路径 + 数量）
  console.log(`  ⑤ scan dir=${CDIR} files=${comps.length}`);
  console.log(`  ⑤ files: ${comps.join(', ')}`);
  let onClickTotal = 0, guards = 0, matched = 0, exempt = 0, failN = 0;
  for (let i = 0; i < comps.length; i++) {
    const f: string = comps[i];
    const src: string = stripComments(fs.readFileSync(path.join(CDIR, f), 'utf8'));
    const clicks: number = countAll(src, /\.onClick\(/g);
    onClickTotal += clicks;
    const guardRe: RegExp = /\.onClick\(\(\)\s*=>\s*\{([\s\S]{0,180}?)\n\s*\}\)/g;
    let m: RegExpExecArray | null = guardRe.exec(src);
    const hits: string[] = [];
    while (m !== null) {
      const body: string = m[1];
      const g: RegExpExecArray | null = /if\s*\(!?this\.([A-Za-z_]\w*)\)/.exec(body);
      // 纯守卫 = 命中 flag 守卫 **且** 无 `else`（if/else 两分支都动作 ⇒ 非死区）
      if (g !== null && !/\}\s*else\b/.test(body)) { hits.push(g[1]); }
      m = guardRe.exec(src);
    }
    if (hits.length > 0) {
      // ② 命中分布（每文件 onClick / 守卫）
      console.log(`  ⑤ ${f}: onClick=${clicks} guards=[${hits.join(',')}]`);
    }
    for (let k = 0; k < hits.length; k++) {
      const flag: string = hits[k];
      guards++;
      const wired: boolean = src.indexOf(`.enabled(this.${flag})`) >= 0
        || src.indexOf(`.enabled(!this.${flag})`) >= 0;
      let verdict: string;
      if (wired) { matched++; verdict = '修：.enabled(' + flag + ') 在位'; }
      else if (GUARD_EXEMPT.has(f)) { exempt++; verdict = '明示豁免：' + GUARD_EXEMPT.get(f); }
      else { failN++; verdict = '**未处理（死区）**'; }
      // ③ 每个命中给"修 / 明示豁免"
      console.log(`  ⑤   ${f}: guard(${flag}) => ${verdict}`);
      ok(`${f}：守卫 onClick(${flag}) 已修 或 明示豁免`, wired || GUARD_EXEMPT.has(f));
    }
  }
  // 零扫描判红
  ok('⑤ 零扫描判红：全 components/** 的 onClick 总数 > 0', onClickTotal > 0);
  console.log(`  ⑤ SUMMARY files=${comps.length} onClick=${onClickTotal} guards=${guards}`
    + ` wired=${matched} exempt=${exempt} unhandled=${failN} (exemptions=${orgExemptList()})`);
}
function orgExemptList(): string {
  const out: string[] = [];
  GUARD_EXEMPT.forEach((v: string, k: string): void => { out.push(k); });
  return out.join('|');
}

// ── ⑥ **press 口径统一（全 `components/**`）**：凡 `.stateStyles({ pressed: { .opacity(X) } })`
//    ⇒ X 必须来自**同一常量出口** `PRESS_OPACITY`（0.6）；字面量 / 异值 ⇒ 红，除非**明示豁免（附理由）**。
//    · `.backgroundColor(...)` 型 pressed（行悬停高亮）是**另一种正当形态**，本判据只覆盖 opacity 型。
//    · 自证：打印逐文件 pressed 值分布 + **零扫描判红**。
const PRESS_VALUE_EXEMPT: Map<string, string> = new Map<string, string>([
  ['SubAgentTree.ets', '大卡片有意柔压 0.75（moment_polish.test.ts:78 钉死）'],
  ['AskUserSheet.ets', 'DISABLED_OPACITY —— 禁用档 ≠ 按压档'],
  ['SplashOverlay.ets', 'splash-ux 在跑（0.6 字面量）⇒ 只上报'],
  ['MessageNav.ets', '导航条目有意更轻的按压 0.7（msgnav_polish.test.ts:54 钉死）'],
]);
{
  const comps: string[] = fs.readdirSync(CDIR).filter((n: string): boolean => n.endsWith('.ets')).sort();
  let pressedTotal = 0, fromConst = 0, exemptP = 0, unhandled = 0, bgForm = 0;
  const dist: string[] = [];
  for (let i = 0; i < comps.length; i++) {
    const f: string = comps[i];
    const src: string = stripComments(fs.readFileSync(path.join(CDIR, f), 'utf8'));
    const vals: string[] = [];
    const re: RegExp = /pressed:\s*\{\s*\.opacity\(([^)]*)\)/g;
    let m: RegExpExecArray | null = re.exec(src);
    while (m !== null) { vals.push(m[1].trim()); m = re.exec(src); }
    const bgN: number = countAll(src, /pressed:\s*\{\s*\.backgroundColor\(/g);
    bgForm += bgN;
    if (vals.length === 0 && bgN === 0) { continue; }
    pressedTotal += vals.length;
    dist.push(`  ⑥   ${f}: ${vals.length > 0 ? vals.join(',') : '(bg-only)'}`
      + `${bgN > 0 ? ' +bg×' + bgN : ''}`);
    for (let k = 0; k < vals.length; k++) {
      const v: string = vals[k];
      if (v === 'PRESS_OPACITY') { fromConst++; }
      else if (PRESS_VALUE_EXEMPT.has(f)) { exemptP++; }
      else { unhandled++; }
      ok(`${f}：pressed.opacity(${v}) 取自 PRESS_OPACITY 或明示豁免`,
        v === 'PRESS_OPACITY' || PRESS_VALUE_EXEMPT.has(f));
    }
  }
  console.log('  ⑥ press 口径（全 components/**，pressed 块分布）：');
  for (let i = 0; i < dist.length; i++) { console.log(dist[i]); }
  ok('⑥ 零扫描判红：全仓 pressed-opacity 数 > 0', pressedTotal > 0);
  console.log(`  ⑥ SUMMARY files=${comps.length} pressedOpacity=${pressedTotal}`
    + ` fromConst=${fromConst} exempt=${exemptP} unhandled=${unhandled} bgOnlyBlocks=${bgForm}`);
}

// ── ⑦ **press 覆盖（全 `components/**`）**：凡**自定义可点元素**（`onClick` 的根不是原生控件
//    `Button/Toggle/Checkbox/Radio/Select/TextInput`，也不是 `Span`——`Span` 不能有 `stateStyles`）
//    必须**同链**有 `stateStyles`，或**被某个祖先容器**的 press 覆盖（行内子元素由整行统一反馈
//    ⇒ **不叠加双反馈**），或该文件在 `CLICK_EXEMPT`（附理由）。
//    · **只取调用片段**（沿链回溯到根）、**剥注释**、**零扫描判红**。
//    · 祖先判定：上溯最近的低缩进 `{` 块 → 花括号配对求闭合行（须**包住** onClick）→ 扫该块修饰链
//      （同缩进 `.xxx()`）是否有 `.stateStyles(`；无则继续上溯。⛔ 只是"链上/祖先有 press"，不看值。
const CLICK_EXEMPT: Map<string, string> = new Map<string, string>(); // 台账**只准删**（现已清空）
function indentOf(l: string): number { return (l.match(/^(\s*)/) as RegExpMatchArray)[1].length; }
function ancestorHasPress(lines: string[], idx: number): boolean {
  const I: number = indentOf(lines[idx]);
  for (let j = idx - 1; j >= 0; j--) {
    if (lines[j].trim() === '') { continue; }
    const ij: number = indentOf(lines[j]);
    if (ij >= I) { continue; }
    if (!/\{\s*$/.test(lines[j])) { continue; }
    let depth = 0, close = -1;
    for (let k = j; k < lines.length; k++) {
      const from: number = k === j ? lines[j].lastIndexOf('{') : 0;
      for (let c = from; c < lines[k].length; c++) {
        const ch: string = lines[k].charAt(c);
        if (ch === '{') { depth++; } else if (ch === '}') { depth--; if (depth === 0) { close = k; break; } }
      }
      if (close >= 0) { break; }
    }
    // 只认**包住** onClick 的块
    if (close > idx) {
      for (let k = close + 1; k < lines.length; k++) {
        if (lines[k].trim() === '') { continue; }
        if (indentOf(lines[k]) !== ij) { break; }
        if (!/^\s*\./.test(lines[k])) { break; }
        if (/\.stateStyles\(/.test(lines[k])) { return true; }
      }
    }
  }
  return false;
}
{
  const comps: string[] = fs.readdirSync(CDIR).filter((n: string): boolean => n.endsWith('.ets')).sort();
  const ROOT: RegExp = /^\s*([A-Z][A-Za-z0-9_.]*)\s*\(/;
  const NATIVE: RegExp = /^(Button|Toggle|Checkbox|Radio|Select|TextInput|Span)$/;
  let custom = 0, withPress = 0, ancCovered = 0, miss = 0;
  const dist: string[] = [];
  for (let i = 0; i < comps.length; i++) {
    const f: string = comps[i];
    const lines: string[] = stripComments(fs.readFileSync(path.join(CDIR, f), 'utf8')).split('\n');
    let c = 0, w = 0, a = 0, m = 0;
    for (let k = 0; k < lines.length; k++) {
      if (!/^\s*\.onClick\(/.test(lines[k])) { continue; }
      let j = k - 1;
      let root = '?';
      let hasSS = false;
      while (j >= 0) {
        if (ROOT.test(lines[j])) { root = (lines[j].match(ROOT) as RegExpMatchArray)[1]; break; }
        if (/\.stateStyles\(/.test(lines[j])) { hasSS = true; }
        j--;
      }
      if (NATIVE.test(root)) { continue; }
      c++;
      if (hasSS) { w++; }
      else if (ancestorHasPress(lines, k)) { a++; }
      else { m++; }
    }
    custom += c; withPress += w; ancCovered += a; miss += m;
    if (m > 0) {
      dist.push(`  ⑦   ${f}: custom=${c} withPress=${w} ancestorCovered=${a} missing=${m}`
        + `  => ${CLICK_EXEMPT.get(f)}`);
    }
    ok(`${f}：自定义可点元素或有 press（链上/祖先）、或明示豁免`
      + `（custom=${c} withPress=${w} ancestor=${a} missing=${m}）`,
      m === 0 || CLICK_EXEMPT.has(f));
  }
  console.log('  ⑦ press 覆盖（全 components/**，仅列尚有缺口的文件）：');
  if (dist.length === 0) { console.log('  ⑦   （无缺口）'); }
  for (let i = 0; i < dist.length; i++) { console.log(dist[i]); }
  ok('⑦ 零扫描判红：全仓自定义可点元素数 > 0', custom > 0);
  console.log(`  ⑦ SUMMARY files=${comps.length} customClickables=${custom}`
    + ` withPress=${withPress} ancestorCovered=${ancCovered} missing=${miss} exemptFiles=${CLICK_EXEMPT.size}`);
}

console.log(`  interactive_feedback: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
/**
 * vertical_scroll_height.test.ts —— 纵向 `Scroll`/`List` 必须有**可被约束的高度路径**
 * （用户亲报「设置里很多窗口超过高度范围且滚动不下去」· 2026-10-11）。
 *
 * ── 根因（本判据钉住的不变量）────────────────────────────────────────────────
 * 设置面板的每个分区（`SettingsAbout`…`SettingsWebUsers`）是 `SettingsPanel` 根 `Column` 里
 * **Header / TabBar 的兄弟**。ArkUI 里 `Column` 子元素的 `height('100%')` = **父容器全高**
 * （不是"剩余高度"）⇒ 面板整体被 Header+TabBar 下推、底部溢出屏幕 ⇒ 面板内 `Scroll` 视口底边
 * 落在屏外，最底一屏（≈ Header+TabBar 高）**永远看不到**（用户语 =「滚不下去」）。
 * 正解 = 分区根容器吃**剩余高度**（`layoutWeight(1)`；对齐 web `flex-1 min-h-0`、
 * `Index.ets` 包裹 `PluginHost` 的同款做法、以及 `SettingsAppearance` 既有形态）。
 *
 * ── 判据（硬红）──────────────────────────────────────────────────────────────
 *  · 规则 A（全部目标文件）：每个**纵向** `Scroll`/`List` 的自身或祖先块修饰链上必须有一个
 *    高度约束（`layoutWeight(` / `constraintSize({ … maxHeight` / `.height(`）；
 *  · 规则 B（各设置分区文件）：`build()` 的**根容器**修饰链必须含 `layoutWeight(1)`
 *    —— 吃剩余高度；⛔ 不许 `height('100%')`（那正是本次缺陷形态）；
 *  · **零扫描判红**：一个纵向 Scroll/List 都抽不到 ⇒ 红（防"扫描器失效变白绿"）。
 *
 * mutation 自证：抽掉 `SettingsAppearance` 根 Scroll 的 `.layoutWeight(1)` ⇒ 规则 A 红；
 * 抽掉任一分区根容器的 `.layoutWeight(1)` ⇒ 规则 B 红。
 *
 * ⚠️ 解析用**花括号配对**（不靠缩进）；先 `sanitize` 掉注释与字符串内容（保索引/换行）。
 * ⚠️ 结尾 `process.exit(...)`（`tools/tests/run.sh` 用 `set -e` 逐文件 node）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const compDir: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

// ── 目标文件（本任务域：设置分区 + 聚各弹层 sheet）────────────────────────────
const PANEL_FILES: string[] = [
  'SettingsAbout', 'SettingsAccount', 'SettingsAgent', 'SettingsAppearance',
  'SettingsChannels', 'SettingsDeveloper', 'SettingsLlm', 'SettingsPlugins',
  'SettingsStorage', 'SettingsTools', 'SettingsWebUsers',
];
const SHEET_FILES: string[] = [
  'MenuSheets', 'QueueSheet', 'AskUserSheet', 'StatusSheet', 'SelfCheckSheet',
  'TodoPanel', 'MessageNav', 'GoalBanner',
];
const SCAN_FILES: string[] = PANEL_FILES.concat(['SettingsPanel']).concat(SHEET_FILES);

/** 把注释与字符串**内容**抹成空格（保留索引与换行）—— 避免注释/字面量里的 `Scroll(`、`{}` 干扰。 */
function sanitize(src: string): string {
  const n: number = src.length;
  const a: string[] = src.split('');
  let i: number = 0;
  while (i < n) {
    const c: string = src.charAt(i);
    const c2: string = i + 1 < n ? src.charAt(i + 1) : '';
    if (c === '/' && c2 === '/') {
      while (i < n && src.charAt(i) !== '\n') { a[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      a[i] = ' '; a[i + 1] = ' '; i += 2;
      while (i < n && !(src.charAt(i) === '*' && i + 1 < n && src.charAt(i + 1) === '/')) {
        if (src.charAt(i) !== '\n') { a[i] = ' '; }
        i++;
      }
      if (i < n) { a[i] = ' '; if (i + 1 < n) { a[i + 1] = ' '; } i += 2; }
      continue;
    }
    if (c === '"' || c === '\'' || c === '`') {
      const q: string = c;
      i++;
      while (i < n) {
        const d: string = src.charAt(i);
        if (d === '\\') { a[i] = ' '; if (i + 1 < n) { a[i + 1] = ' '; } i += 2; continue; }
        if (d === q) { break; }
        if (d !== '\n') { a[i] = ' '; }
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return a.join('');
}

function lineOf(s: string, idx: number): number {
  let n: number = 1;
  for (let i = 0; i < idx && i < s.length; i++) { if (s.charAt(i) === '\n') { n++; } }
  return n;
}

/** 从 open 处的 `{` 找配对 `}`。 */
function matchBrace(s: string, open: number): number {
  let depth: number = 0;
  for (let i = open; i < s.length; i++) {
    const c: string = s.charAt(i);
    if (c === '{') { depth++; }
    else if (c === '}') { depth--; if (depth === 0) { return i; } }
  }
  return -1;
}

/** build() 的 `{` 之后、**括号深度为 0** 的第一个 `{`（跳过 `Column({…})` 的参数对象）。 */
function firstBlockAfter(s: string, from: number): number {
  let depth: number = 0;
  for (let i = from; i < s.length; i++) {
    const c: string = s.charAt(i);
    if (c === '(') { depth++; }
    else if (c === ')') { depth--; }
    else if (c === '{' && depth === 0) { return i; }
  }
  return -1;
}

/** 取 idx 起的连续 `.foo(...)` 修饰链文本（停在第一个非 `.` 语句）。 */
function chainAfter(s: string, idx: number): string {
  let i: number = idx;
  let out: string = '';
  while (true) {
    let j: number = i;
    while (j < s.length && /\s/.test(s.charAt(j))) { j++; }
    if (j >= s.length || s.charAt(j) !== '.') { break; }
    let k: number = j + 1;
    while (k < s.length && /[A-Za-z0-9_$]/.test(s.charAt(k))) { k++; }
    if (k < s.length && s.charAt(k) === '(') {
      let depth: number = 0;
      let p: number = k;
      while (p < s.length) {
        const c: string = s.charAt(p);
        if (c === '(') { depth++; }
        else if (c === ')') { depth--; if (depth === 0) { p++; break; } }
        p++;
      }
      k = p;
    }
    out += s.slice(j, k) + '\n';
    i = k;
  }
  return out;
}

/** 所有包住 [open, close] 的块（innermost 在前）的 open 索引。 */
function enclosingOpens(s: string, open: number): number[] {
  const stack: number[] = [];
  for (let i = 0; i < open; i++) {
    const c: string = s.charAt(i);
    if (c === '{') { stack.push(i); }
    else if (c === '}') { stack.pop(); }
  }
  const res: number[] = [];
  for (let x = stack.length - 1; x >= 0; x--) { res.push(stack[x]); }
  return res;
}

const CONSTRAINT_RE = /layoutWeight\(|constraintSize\(\s*\{[^}]*maxHeight|\.height\(/;

interface ScrollHit { file: string; line: number; name: string; ownChain: string; ancChain: string; }

/** 找出一个文件里所有**纵向** `Scroll`/`List` 组件调用（含自身与祖先修饰链）。 */
function findVerticalScrolls(file: string, raw: string): ScrollHit[] {
  const s: string = sanitize(raw);
  const res: ScrollHit[] = [];
  const re = /(^|[^A-Za-z0-9_$.])(Scroll|List)\s*\(/g;
  let m: RegExpExecArray | null = re.exec(s);
  while (m !== null) {
    const identStart: number = m.index + m[1].length;
    const name: string = m[2];
    const parenOpen: number = m.index + m[0].length - 1;
    // 找配对 ')'
    let depth: number = 0, p: number = parenOpen, parenClose: number = -1;
    while (p < s.length) {
      const c: string = s.charAt(p);
      if (c === '(') { depth++; }
      else if (c === ')') { depth--; if (depth === 0) { parenClose = p; break; } }
      p++;
    }
    if (parenClose >= 0) {
      let q: number = parenClose + 1;
      while (q < s.length && /\s/.test(s.charAt(q))) { q++; }
      if (q < s.length && s.charAt(q) === '{') {
        const blockClose: number = matchBrace(s, q);
        if (blockClose > 0) {
          const own: string = chainAfter(s, blockClose + 1);
          // 横向 Scroll 不是本判据对象（如 SettingsPanel 的 TabBar）
          if (own.indexOf('ScrollDirection.Horizontal') < 0) {
            let anc: string = '';
            const opens: number[] = enclosingOpens(s, q);
            for (let x = 0; x < opens.length; x++) {
              const bc: number = matchBrace(s, opens[x]);
              if (bc > 0) { anc += chainAfter(s, bc + 1); }
            }
            res.push({ file, line: lineOf(s, identStart), name, ownChain: own, ancChain: anc });
          }
        }
      }
    }
    m = re.exec(s);
  }
  return res;
}

// ════════════════════════════════════════════════════════════════════════════
const srcOf: Map<string, string> = new Map<string, string>();
for (let i = 0; i < SCAN_FILES.length; i++) {
  const f: string = SCAN_FILES[i];
  srcOf.set(f, fsMod.readFileSync(pathMod.join(compDir, `${f}.ets`), 'utf-8'));
}

const hits: ScrollHit[] = [];
for (let i = 0; i < SCAN_FILES.length; i++) {
  const f: string = SCAN_FILES[i];
  const found: ScrollHit[] = findVerticalScrolls(f, srcOf.get(f) as string);
  for (let j = 0; j < found.length; j++) { hits.push(found[j]); }
}

console.log('\n▶ §A 纵向 Scroll/List 清单（file:line）');
for (let i = 0; i < hits.length; i++) {
  console.log(`  · ${hits[i].file}.ets:${hits[i].line}  ${hits[i].name}`);
}

// ── 零扫描判红（**断言在 if (fail>0) 之外**，无条件执行）──────────────────────
ok('零扫描防线：至少抽到 1 个纵向 Scroll/List（否则判据失效 ⇒ 红）', hits.length > 0,
  `抽到 ${hits.length} 个`);

// ── 规则 A：每个纵向 Scroll/List 自身或祖先链上必须有高度约束 ─────────────────
console.log('\n▶ §B 规则 A：每个纵向 Scroll/List 有可被约束的高度路径');
for (let i = 0; i < hits.length; i++) {
  const h: ScrollHit = hits[i];
  const has: boolean = CONSTRAINT_RE.test(h.ownChain) || CONSTRAINT_RE.test(h.ancChain);
  ok(`高度约束存在：${h.file}.ets:${h.line} (${h.name})`, has);
  if (!has) { console.log(`      自身链：${JSON.stringify(h.ownChain)}`); }
}

// ── 规则 B：设置分区 build() 根容器吃剩余高度（layoutWeight(1)）───────────────
console.log('\n▶ §C 规则 B：设置分区根容器 = layoutWeight(1)（剩余高度，⛔ 非 height(\'100%\')）');
for (let i = 0; i < PANEL_FILES.length; i++) {
  const f: string = PANEL_FILES[i];
  const s: string = sanitize(srcOf.get(f) as string);
  // ⚠️ 文件里可能有 helper struct（各有自己的 `build()`）—— 必须定位到**面板本体** struct
  //    （`export struct <Name>`）的 `build()`，否则会误取 helper 的根容器。
  const sre = new RegExp('(^|[^A-Za-z0-9_$])struct\\s+' + f + '\\b');
  const sm: RegExpExecArray | null = sre.exec(s);
  let buildBrace: number = -1;
  if (sm !== null) {
    const from: number = sm.index + sm[0].length;
    const bre = /(^|[^A-Za-z0-9_$.])build\s*\(\s*\)\s*\{/g;
    bre.lastIndex = from;
    const bm: RegExpExecArray | null = bre.exec(s);
    if (bm !== null) { buildBrace = bm.index + bm[0].length - 1; }
  }
  let rootChain: string = '';
  if (buildBrace >= 0) {
    const rootOpen: number = firstBlockAfter(s, buildBrace + 1);
    if (rootOpen >= 0) {
      const rootClose: number = matchBrace(s, rootOpen);
      if (rootClose > 0) { rootChain = chainAfter(s, rootClose + 1); }
    }
  }
  const hasLw: boolean = rootChain.indexOf('layoutWeight(') >= 0;
  ok(`根容器吃剩余高度：${f}.ets`, hasLw,
    `根容器修饰链=${JSON.stringify(rootChain)}`);
}

console.log('\n▼ 摘要');
console.log(`  纵向 Scroll/List：${hits.length} 个；设置分区：${PANEL_FILES.length} 个`);
if (fail > 0) { console.log(`\n  vertical_scroll_height: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  vertical_scroll_height: ${pass} passed, 0 failed`);
process.exit(0);

export {};

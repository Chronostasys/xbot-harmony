/**
 * a11y_icon_button.test.ts —— **图标-only 可点控件的读屏文案**契约（目标⑤，Apple HIG a11y）。
 *
 * 背景：`13c8d94` 为「全部折叠/展开」按钮开了全仓首例 `.accessibilityText(...)`：
 *   **图标-only / 无可见文案的可点控件 ⇒ 必须给读屏文案**（否则对读屏用户完全不可读）。
 * 本轮把该约定**系统性铺到全仓**（components/** + pages/Index.ets），本测试是它的机器判据。
 *
 * ── 口径（本单定的定义；可执行）────────────────────────────────────────────────
 *   一个控件是「图标-only 可点控件」当且仅当（在剥注释后的源码里）命中**任一分支**：
 *     · 分支 1：它的**属性链**含 `.onClick(`（可点），且其**子节点（builder body）**渲染了
 *       `SymbolGlyph(`（或它本身就是 `SymbolGlyph`），且子节点**没有** `Text(`（无可见文案）；或
 *     · 分支 2：它是一个 `Text(`（内容为**单个符号字形**，如 `'＋'`/`'−'`/`'⋯'`，非字母数字/非中文词），
 *       且其属性链含 `.onClick(`（单符号字形 = 无异于图标的"符号字形按钮"，同样无可见文案）。
 *   ⇒ 这类控件必须带 `.accessibilityText(<非空中文动作说明>)`。
 * 说明：判不准/口径外的形态（如可点 `Text('⋯')` 字形、可点 `Image` 卡）**不判红**，只登记打印（§E）。
 *
 * ── 判据分层（⛔ 钉"计数 + 形态"，不钉"方法体存在"）───────────────────────────
 *   ① 每处图标-only 控件：有 `accessibilityText` ∧ 文案非空且含中文（无空串/占位符）∧ 链上确有 `SymbolGlyph`。
 *   ② 全局计数：**缺 `accessibilityText` 的图标-only 控件数 == 台账**（`A11Y_LEDGER`，只许缩短）。
 *   ③ 零扫描判红：扫描文件数 > 0 ∧ 图标-only 控件数 > 0（白绿防线）。
 *   ④ mutation 自证：删一处 `accessibilityText` ⇒ 命中数必增（必红）；给某处填空串 ⇒ 文案判据必红；还原 ⇒ 绿。
 *
 * ⛔ 结尾必须 `process.exit(...)`：`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; readdirSync(p: string): string[] };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 极简词法（与 `hit_target_pad.test.ts` 同款；引号感知剥注释 / 配平括号 / 取属性链）──
function stripComments(src: string): string {
  let out = ''; let i = 0; const n = src.length; let quote = '';
  while (i < n) {
    const c: string = src.charAt(i);
    if (quote !== '') {
      out += c;
      if (c === '\\' && i + 1 < n) { out += src.charAt(i + 1); i += 2; continue; }
      if (c === quote) { quote = ''; }
      i += 1; continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && i + 1 < n) {
      if (src.charAt(i + 1) === '/') { const j: number = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (src.charAt(i + 1) === '*') {
        const j: number = src.indexOf('*/', i + 2);
        if (j < 0) { break; }
        let nl = 0;
        for (let k = i; k < j; k++) { if (src.charAt(k) === '\n') { nl++; } }
        out += '\n'.repeat(nl); i = j + 2; continue;
      }
    }
    out += c; i += 1;
  }
  return out;
}
function matchPair(s: string, i: number, op: string, cl: string): number {
  let d = 0;
  while (i < s.length) {
    if (s.charAt(i) === op) { d++; }
    else if (s.charAt(i) === cl) { d--; if (d === 0) { return i; } }
    i += 1;
  }
  return -1;
}
function skipWs(s: string, i: number): number { while (i < s.length && ' \t\r\n'.indexOf(s.charAt(i)) >= 0) { i += 1; } return i; }
interface Chain2 { text: string; parts: string[][]; }
/** 取 `i` 起的属性链（`.a(..).b(..)`）；若 `i` 处是 `{...}` builder body 则先跳过它。 */
function chainAfter2(s: string, i: number): Chain2 {
  i = skipWs(s, i);
  if (i < s.length && s.charAt(i) === '{') { const k: number = matchPair(s, i, '{', '}'); i = k < 0 ? s.length : k + 1; }
  let out = ''; const parts: string[][] = []; i = skipWs(s, i);
  while (i < s.length && s.charAt(i) === '.') {
    const j: number = s.indexOf('(', i);
    if (j < 0) { break; }
    const k: number = matchPair(s, j, '(', ')');
    if (k < 0) { break; }
    parts.push([s.substring(i + 1, j), s.substring(j + 1, k)]);
    out += s.substring(i, k + 1); i = skipWs(s, k + 1);
  }
  return { text: out, parts };
}
const CLICK: RegExp = /\.onClick\s*\(/;
const GLYPH: RegExp = /SymbolGlyph\s*\(/;
const VISIBLE_TEXT: RegExp = /(?:^|[^\w.])Text\s*\(/;
const lineOf = (s: string, i: number): number => s.substring(0, i).split('\n').length;

interface IconCtl { key: string; rel: string; line: number; hasA11y: boolean; label: string; labelOk: boolean; }

/** 文案非空**且含中文**（挡住空串 / 纯符号 / 占位符 TODO/XXX/…）。 */
function labelOk(a: string): boolean {
  const t = a.trim();
  if (t.length === 0) { return false; }
  return /[\u4e00-\u9fff]/.test(t);
}

/**
 * 扫描器（纯函数，mutation 复用）：输入 {相对路径 → 源码}，输出全部**图标-only 可点控件**。
 * 口径见文件头注释。
 */
function scanIconOnly(srcByRel: Map<string, string>): IconCtl[] {
  const out: IconCtl[] = [];
  srcByRel.forEach((raw: string, rel: string): void => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      const nm: string = m[1];
      const openParen: number = src.indexOf('(', m.index);
      const closeParen: number = matchPair(src, openParen, '(', ')');
      if (closeParen > 0) {
        const j: number = skipWs(src, closeParen + 1);
        let body = '';
        let chainStart: number = closeParen + 1;
        if (j < src.length && src.charAt(j) === '{') {
          const be: number = matchPair(src, j, '{', '}');
          if (be > 0) { body = src.substring(j + 1, be); chainStart = be + 1; }
        }
        const ch: Chain2 = chainAfter2(src, chainStart);
        if (CLICK.test(ch.text)) {
          const hasGlyph: boolean = GLYPH.test(body) || nm === 'SymbolGlyph';
          const hasText: boolean = VISIBLE_TEXT.test(body);
          if (hasGlyph && !hasText) {
            let hasA11y = false; let label = '';
            for (let k = 0; k < ch.parts.length; k++) {
              if (ch.parts[k][0] === 'accessibilityText') { hasA11y = true; label = ch.parts[k][1]; }
            }
            out.push({
              key: rel + ' :: ' + nm, rel, line: lineOf(src, m.index),
              hasA11y, label, labelOk: hasA11y && labelOk(label),
            });
          }
        }
      }
      m = rx.exec(src);
    }
  });
  return out;
}
function keyOf(c: IconCtl): string { return c.key; }

// ── 口径分支 2：**单符号字形 `Text`**（如 `Text('＋')` / `Text('⋯')`）也是"无可见文案"的可点控件 ──
const ONE_SYMBOL: RegExp = /^(['"`])([^'"`])\1$/;
function isSymbolChar(c: string): boolean {
  return c.trim().length > 0 && !/[A-Za-z0-9]/.test(c) && !/[\u4e00-\u9fff]/.test(c);
}
function scanTextGlyph(srcByRel: Map<string, string>): IconCtl[] {
  const out: IconCtl[] = [];
  srcByRel.forEach((raw: string, rel: string): void => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\bText\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      const openParen: number = src.indexOf('(', m.index);
      const closeParen: number = matchPair(src, openParen, '(', ')');
      if (closeParen > 0) {
        const arg: string = src.substring(openParen + 1, closeParen).trim();
        const mm: RegExpExecArray | null = ONE_SYMBOL.exec(arg);
        if (mm !== null && isSymbolChar(mm[2])) {
          const ch: Chain2 = chainAfter2(src, closeParen + 1);
          if (CLICK.test(ch.text)) {
            let hasA11y = false; let label = '';
            for (let k = 0; k < ch.parts.length; k++) {
              if (ch.parts[k][0] === 'accessibilityText') { hasA11y = true; label = ch.parts[k][1]; }
            }
            out.push({
              key: rel + ' :: Text-glyph', rel, line: lineOf(src, m.index),
              hasA11y, label, labelOk: hasA11y && labelOk(label),
            });
          }
        }
      }
      m = rx.exec(src);
    }
  });
  return out;
}
/** 口径合并（分支1 SymbolGlyph + 分支2 单符号 Text 字形）。 */
function scanAll(m: Map<string, string>): IconCtl[] { return scanIconOnly(m).concat(scanTextGlyph(m)); }
function sameMultiset(a: string[], b: string[]): boolean {
  const x = a.slice().sort().join('|'); const y = b.slice().sort().join('|');
  return x === y;
}

// ── 读源码（零扫描判红在 §A）──────────────────────────────────────────────────
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const etsRoot: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');

const srcByRel: Map<string, string> = new Map<string, string>();
function loadDir(relDir: string): void {
  let names: string[] = [];
  try { names = fsMod.readdirSync(pathMod.join(etsRoot, relDir)); } catch (e) { names = []; }
  for (let i = 0; i < names.length; i++) {
    const nm: string = names[i];
    if (nm.length > 4 && nm.substring(nm.length - 4) === '.ets') {
      const rel: string = relDir + '/' + nm;
      try { srcByRel.set(rel, fsMod.readFileSync(pathMod.join(etsRoot, rel), 'utf-8').replace(/i18nT\(([^()]*)\)/g, '$1')); } catch (e) { /* 跳过 */ }
    }
  }
}
loadDir('components');
loadDir('pages');

// ── 台账（**只许缩短**）────────────────────────────────────────────────────────
// 本波把**全部**已确认的图标-only 可点控件补齐 ⇒ 台账为空 ⇒ 断言"缺 a11y 数 == 0"（最强形式：
// 将来新增任何图标-only 按钮却不给读屏文案 ⇒ 命中数 1 > 0 ⇒ 必红）。
const A11Y_LEDGER_CEILING = 0;
const A11Y_LEDGER: string[] = [];

// ── §A 零扫描 + 口径自证 ──────────────────────────────────────────────────────
console.log('\n▶ §A 零扫描 + 口径自证');
let totalBytes = 0;
srcByRel.forEach((v: string): void => { totalBytes += v.length; });
const flagged: IconCtl[] = scanAll(srcByRel);
console.log(`  扫描 .ets 文件：${srcByRel.size}（共 ${totalBytes} 字节）`);
console.log(`  图标-only 可点控件：${flagged.length}`);
ok('③ 零扫描判红：扫描到文件数 > 0', srcByRel.size > 0);
ok('③ 零扫描判红：图标-only 可点控件数 > 0（口径非空）', flagged.length > 0);
ok('③ 零扫描判红：读到的源码总字节 > 10000', totalBytes > 10000);

// ── §B 每处控件的读屏文案（形态）──────────────────────────────────────────────
console.log('\n▶ §B 每处图标-only 控件的 accessibilityText（形态 + 文案质量）');
const missing: IconCtl[] = flagged.filter((f: IconCtl): boolean => !f.hasA11y);
const badLabel: IconCtl[] = flagged.filter((f: IconCtl): boolean => f.hasA11y && !f.labelOk);
for (let i = 0; i < flagged.length; i++) {
  const f: IconCtl = flagged[i];
  const mark: string = f.hasA11y ? (f.labelOk ? '✓' : '✗文案') : '✗缺';
  console.log(`  ${mark}  ${f.rel}:${f.line}  <${f.key.split(' :: ')[1]}>  a11y=${f.label}`);
}
ok(`① 每处图标-only 控件都有 accessibilityText（${flagged.length} 处，缺 ${missing.length}）`, missing.length === 0);
ok(`① 每处文案非空且含中文动作说明（空串/占位符 ${badLabel.length} 处）`, badLabel.length === 0);

// ── §C 全局计数 == 台账（只许缩短）────────────────────────────────────────────
console.log('\n▶ §C 全局计数 == 台账（只许缩短）');
ok(`② 缺 a11y 的图标-only 控件数 == 台账（实测 ${missing.length} / 登记 ${A11Y_LEDGER.length}）`,
  missing.length === A11Y_LEDGER.length);
ok('② 命中集与台账集一一对应（同一多重集）', sameMultiset(missing.map(keyOf), A11Y_LEDGER));
ok(`⚠️ 台账只许缩短：登记数(${A11Y_LEDGER.length}) ≤ 本波基线 ceiling(${A11Y_LEDGER_CEILING})`,
  A11Y_LEDGER.length <= A11Y_LEDGER_CEILING);

// ── §D mutation 自证（判据必须有判别力）──────────────────────────────────────
console.log('\n▶ §D mutation 自证');
function withEdit(rel: string, re: RegExp, to: string): Map<string, string> {
  const c: Map<string, string> = new Map<string, string>(srcByRel);
  const orig: string = c.get(rel) as string;
  c.set(rel, orig.replace(re, to));
  return c;
}
// 选一个确定含 accessibilityText 的文件做注入（pages/Index.ets 有多处）。
const injRel = 'pages/Index.ets';
// a) 删一处 ⇒ 缺 a11y 数必增（必红）
const injA: IconCtl[] = scanAll(withEdit(injRel, /\.accessibilityText\([^)]*\)/, ''));
const missA: number = injA.filter((f: IconCtl): boolean => !f.hasA11y).length;
ok(`④ mutation：删一处 accessibilityText ⇒ 缺 a11y 数 ${missA} > 台账 ${A11Y_LEDGER.length}（必红）`,
  missA > A11Y_LEDGER.length);
// b) 填空串 ⇒ 文案判据必红
const injB: IconCtl[] = scanAll(withEdit(injRel, /\.accessibilityText\([^)]*\)/, '.accessibilityText(\'\')'));
const badB: number = injB.filter((f: IconCtl): boolean => f.hasA11y && !f.labelOk).length;
ok(`④ mutation：某处文案填空串 ⇒ 文案不达标数 ${badB} > 0（必红）`, badB > 0);
// c) 还原 ⇒ 绿（真实源码判绿，防"判据恒红"）
ok('④ 还原后：真实源码缺 a11y 数 == 台账（绿）', missing.length === A11Y_LEDGER.length);

// ── §E 口径外 / 待人工（**不判红**，只登记）───────────────────────────────────
console.log('\n▶ §E 口径外 / 待人工核实（不判红）');
console.log('  · AuthImage.ets 可点 `Image` 卡（无 SymbolGlyph、无 Text 字形）—— 图片自带可访问性语义，非"图标-only"。');
console.log('  · 口径分支 2（单符号 `Text` 字形按钮：Text(\'−\')/Text(\'＋\')/Text(\'⋯\')）已并入扫描与实修。');

console.log(`\n  图标-only 可点控件 ${flagged.length} 处，缺 a11y ${missing.length}，文案不达标 ${badLabel.length}；台账 ${A11Y_LEDGER.length}（ceiling ${A11Y_LEDGER_CEILING}）`);

if (fail > 0) {
  console.log(`  a11y_icon_button: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  a11y_icon_button: ${pass} passed, 0 failed`);
process.exit(0);

// 使本文件成为**模块**（module scope）——否则 `declare const process` 等落在全局，
// 与同目录其它"全局脚本"测试（run.sh 把 `*.ts` 当一个编译单元）冲突（TS2451）。
export {};

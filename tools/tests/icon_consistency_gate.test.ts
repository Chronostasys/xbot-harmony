/**
 * icon_consistency_gate.test.ts —— **图标资产与符号一致性**审计（离线 · 2026-10-11）。
 *
 * ── 缺陷类（"廉价感"来源）──────────────────────────────────────────────────────
 * ① `SymbolGlyph`/`Image` 的**取色不走唯一口径**（字面量 `'#RRGGBB'` ⇒ 换主题不跟着走）；
 * ② **直写符号/emoji 当图标**（`Text('↑')` / `Text('● 录制中')`）—— 图标即文本 ⇒ 字形随字体漂移、
 *    无法参与取色/尺寸 token、观感廉价。
 *
 * ── 判定口径（逐条给证据，⛔ 不靠感觉）───────────────────────────────────────────
 *  · **A（硬）**：`SymbolGlyph(...)` / `Image(...)` 的链上 `.fontColor(...)` **不得含颜色字面量**。
 *    实测：SymbolGlyph **74** 处 + Image **4** 处，字面量 **0** ⇒ 口径干净（本判据作**守卫**）。
 *  · **B（硬）**：`Text(<字符串字面量>)` 的**首字符是符号/emoji** ⇒ 视为"图标即文本" ⇒ 红。
 *    例外台账 `KNOWN_OK`（⛔ 只许缩短）。
 *    实测修复前 **3** 处：`QueueSheet` 的 `'↑'`/`'↓'`（**可点按钮**）+ `SettingsDeveloper` 的
 *    `'● 录制中'`（状态点）⇒ **均已改为 `SymbolGlyph`**（用本仓**既有** symbol 名，命名安全）。
 *  · **C（台账/报告）**：图标**尺寸**目前是字面量（12/17/13/20/15），**无统一档常量** ⇒
 *    只报清单（见 §C 输出），**不判红**（`brand-impl`/设计侧决定是否收编成 token）。
 *
 * ── ⛔ 明确**不算**违规的（记在这里，免得后人重复判定）─────────────────────────────
 *  · markdown 的**列表符/任务框**（`MarkdownView` 的 `'•'`、`liChecked` 的勾选字形）——
 *    那是 **markdown 语义要求**的文本项目符，不是图标；
 *  · `ToolPopover.classifyLine()` 里的 `'✗'/'✓'/'✅'` —— 它是在**检测工具输出文本**里有没有这些字符
 *    （我们**不绘制**它们），属**内容识别**不是图标；
 *  · 日志/诊断字符串里的 `⇒`（`EntryAbility`/`workreconcile`）、说明文案里的 `→`、密码掩码 `'••••••••'` ——
 *    都不是图标位。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string; relative(a: string, b: string): string };
declare const __dirname: string;

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function pad(s: string, n: number): string { return (s + ' '.repeat(n)).slice(0, n); }
const fsMod = require('fs');
const pathMod = require('path');
const repoRoot: string = pathMod.join(__dirname, '..', '..', '..', '..');
const etsRoot: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets');

function stripComments(src: string): string {
  let out: string = ''; let i: number = 0; const n: number = src.length;
  while (i < n) {
    const c: string = src.charAt(i);
    if (c === '/' && i + 1 < n) {
      if (src.charAt(i + 1) === '/') { const j: number = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (src.charAt(i + 1) === '*') {
        const j: number = src.indexOf('*/', i + 2);
        if (j < 0) { break; }
        let nl: number = 0;
        for (let k = i; k < j; k++) { if (src.charAt(k) === '\n') { nl++; } }
        out += '\n'.repeat(nl); i = j + 2; continue;
      }
    }
    out += c; i += 1;
  }
  return out;
}
function matchPair(s: string, i: number): number {
  let d: number = 0;
  while (i < s.length) {
    if (s.charAt(i) === '(') { d++; }
    else if (s.charAt(i) === ')') { d--; if (d === 0) { return i; } }
    i += 1;
  }
  return -1;
}
function skipWs(s: string, i: number): number { while (i < s.length && ' \t\r\n'.indexOf(s.charAt(i)) >= 0) { i += 1; } return i; }
function chainAfter(s: string, i: number): string {
  i = skipWs(s, i);
  if (i < s.length && s.charAt(i) === '{') { const k: number = matchPair(s, i); i = k < 0 ? s.length : k + 1; }
  let out: string = ''; i = skipWs(s, i);
  while (i < s.length && s.charAt(i) === '.') {
    const j: number = s.indexOf('(', i);
    if (j < 0) { break; }
    const k: number = matchPair(s, j);
    if (k < 0) { break; }
    out += s.substring(i, k + 1); i = skipWs(s, k + 1);
  }
  return out;
}
function lineOf(s: string, idx: number): number { let n: number = 1; for (let i = 0; i < idx; i++) { if (s.charAt(i) === '\n') { n++; } } return n; }
/** 是不是"符号/emoji"（含箭头、几何图形、装饰符；不含 CJK 与常规标点）。 */
function isSymbolChar(ch: string): boolean {
  const c: number = ch.codePointAt(0) === undefined ? 0 : (ch.codePointAt(0) as number);
  if (c >= 0x1F300 && c <= 0x1FAFF) { return true; }   // emoji
  if (c >= 0x2600 && c <= 0x27BF) { return true; }     // 杂项符号 / dingbats
  if (c >= 0x2B00 && c <= 0x2BFF) { return true; }     // 更多箭头/几何
  if (c >= 0x2190 && c <= 0x21FF) { return true; }     // 箭头
  if (c === 0x2022 || (c >= 0x25A0 && c <= 0x25FF)) { return true; } // • / ■□▲
  return false;
}

const files: string[] = [];
for (const d of ['components', 'pages']) {
  const base: string = pathMod.join(etsRoot, d);
  const walk = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walk(p); } else if (ents[i].endsWith('.ets')) { files.push(p); }
    }
  };
  walk(base);
}
const srcByRel: Map<string, string> = new Map<string, string>();
for (let i = 0; i < files.length; i++) { srcByRel.set(pathMod.relative(etsRoot, files[i]), fsMod.readFileSync(files[i], 'utf-8')); }

// ── 判据本体（纯函数，mutation 复用）──────────────────────────────────────────
function literalColorHits(m: Map<string, string>): string[] {
  const out: string[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\b(SymbolGlyph|Image)\s*\(/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j);
      if (k > 0) {
        const ch: string = chainAfter(src, k + 1);
        const rx2: RegExp = /\.fontColor\(\s*\[?([^)\]]*)\]?\s*\)/g;
        let f: RegExpExecArray | null = rx2.exec(ch);
        while (f !== null) {
          if (/'#[0-9A-Fa-f]{3,8}'/.test(f[1]) || /"#[0-9A-Fa-f]{3,8}"/.test(f[1])) {
            out.push(`${rel}:${lineOf(src, x.index)} :: ${x[1]} 字面量取色 ${f[1].substring(0, 24)}`);
          }
          f = rx2.exec(ch);
        }
      }
      x = rx.exec(src);
    }
  });
  return out;
}
function symbolAsIconHits(m: Map<string, string>, exempt: string[]): string[] {
  const out: string[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\bText\s*\(/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j);
      if (k > 0) {
        const arg: string = src.substring(j + 1, k).trim();
        const q: string = arg.charAt(0);
        if (arg.length > 2 && (q === '\'' || q === '"') && arg.charAt(arg.length - 1) === q) {
          const inner: string = arg.substring(1, arg.length - 1);
          if (inner.length > 0 && isSymbolChar(inner.charAt(0))) {
            const key: string = `${rel} :: ${arg}`;
            if (exempt.indexOf(key) < 0) { out.push(`${rel}:${lineOf(src, x.index)} :: ${arg}`); }
          }
        }
      }
      x = rx.exec(src);
    }
  });
  return out;
}

console.log('\n▶ §A 扫描器自证');
let nSg: number = 0; let nImg: number = 0; let nTextLit: number = 0;
const perFile: string[] = [];
srcByRel.forEach((raw: string, rel: string) => {
  const src: string = stripComments(raw);
  const a: number = (src.match(/\bSymbolGlyph\s*\(/g) || []).length;
  const b: number = (src.match(/\bImage\s*\(/g) || []).length;
  const c: number = (src.match(/\bText\s*\(\s*['"]/g) || []).length;
  nSg += a; nImg += b; nTextLit += c;
  if (a + b > 0) { perFile.push(`  ${pad(rel, 46)} SymbolGlyph=${a} Image=${b}`); }
});
console.log(`  扫 ${files.length} 文件；SymbolGlyph ${nSg}；Image ${nImg}；Text(字面量) ${nTextLit}`);
console.log('  逐文件分布（前 10）：');
for (let i = 0; i < perFile.length && i < 10; i++) { console.log(perFile[i]); }
ok('零扫描判红：文件数 > 0', files.length > 0);
ok('扫描器有效性：SymbolGlyph + Image 数 > 0', nSg + nImg > 0);

console.log('\n▶ §A 取色口径（硬）：SymbolGlyph/Image 不得用颜色字面量');
const aHits: string[] = literalColorHits(srcByRel);
for (let i = 0; i < aHits.length; i++) { console.log(`  ⚠ ${aHits[i]}`); }
ok(`A：无字面量取色（实测 ${aHits.length} 处）—— 74+4 个图标全走 pal()/colorOf()/tc()`, aHits.length === 0);

console.log('\n▶ §B 符号当图标（硬）：Text(字面量) 首字符是符号/emoji ⇒ 红');
/** 例外台账（⛔ 只许缩短；修复后实测为空）。 */
const KNOWN_OK: string[] = [];
const bHits: string[] = symbolAsIconHits(srcByRel, KNOWN_OK);
for (let i = 0; i < bHits.length; i++) { console.log(`  ⚠ ${bHits[i]}`); }
ok(`B：无"图标即文本"（实测 ${bHits.length} 处；修复前 3 处已改 SymbolGlyph）`, bHits.length === 0);

console.log('\n▶ §C 图标尺寸档（报告，不判红）');
const sizes: Map<string, number> = new Map<string, number>();
let noSize: number = 0;
srcByRel.forEach((raw: string, rel: string) => {
  const src: string = stripComments(raw);
  const rx: RegExp = /\bSymbolGlyph\s*\(/g;
  let x: RegExpExecArray | null = rx.exec(src);
  while (x !== null) {
    const j: number = src.indexOf('(', x.index);
    const k: number = matchPair(src, j);
    if (k > 0) {
      const ch: string = chainAfter(src, k + 1);
      const mm: RegExpExecArray | null = /\.fontSize\(\s*([^)]*)\)/.exec(ch);
      if (mm !== null) { sizes.set(mm[1], (sizes.get(mm[1]) || 0) + 1); } else { noSize += 1; }
    }
    x = rx.exec(src);
  }
});
const sizeList: string[] = [];
sizes.forEach((v: number, kk: string) => sizeList.push(`${kk}×${v}`));
console.log(`  带 fontSize 的：${sizeList.join(' · ')}；**不带**（继承）${noSize}`);
console.log('  ⇒ 尺寸目前是**字面量**、无统一档常量 ⇒ 属 C 类**报告项**（是否收编成 token 由设计侧定）。');
ok('C 报告非空（确实扫到了图标尺寸形态）', sizes.size > 0 || noSize > 0);

console.log('\n▶ §D mutation 自证');
// ⛔ mutation 用**合成源码**而不是真注入：真注入 `Text('✨')` 会破坏 ArkTS/TS 编译，
//    而判据本体只**解析文本** ⇒ 合成源码足以证明判别力，且不会污染真文件。
ok('真实源码判绿（防"判据恒红"）',
  literalColorHits(srcByRel).length === 0 && symbolAsIconHits(srcByRel, KNOWN_OK).length === 0);
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  SymbolGlyph($r('sys.symbol.star')).fontColor(['#FF00FF'])\n}\n");
  console.log(`     [mutation A] 合成样本命中 ${literalColorHits(inj).length} 条`);
  ok('mutation：SymbolGlyph 用颜色字面量 ⇒ A 必红', literalColorHits(inj).length > 0);
}
{
  const inj2: Map<string, string> = new Map<string, string>();
  inj2.set('components/Fake.ets', "build() {\n  Text('✨')\n  Text('↑')\n}\n");
  console.log(`     [mutation B] 合成样本命中 ${symbolAsIconHits(inj2, KNOWN_OK).length} 条`);
  ok("mutation：注入 `Text('✨')` / `Text('↑')`（符号当图标）⇒ B 必红",
    symbolAsIconHits(inj2, KNOWN_OK).length >= 2);
}
{
  // 反向对照：**不**以符号开头的纯文案 ⇒ 不该命中（防"凡 Text 必红"的假判据）
  const inj3: Map<string, string> = new Map<string, string>();
  inj3.set('components/Fake.ets', "build() {\n  Text('保存')\n  Text('自动（透明→PNG，其余 JPEG）')\n}\n");
  console.log(`     [反向对照] 纯文案（符号不在首位）命中 ${symbolAsIconHits(inj3, KNOWN_OK).length} 条`);
  ok('反向对照：纯文案不命中（`\'保存\'` 与"符号在中间"的说明文案都不算图标）',
    symbolAsIconHits(inj3, KNOWN_OK).length === 0);
}
{
  // ⚠️ **已知边界（显式记录，不藏）**：本判据按"**首字符是符号**"识别图标 ⇒
  //    若某条**正文**恰好以符号开头（如 `'→ 说明'`），会被判红 ⇒ 属**设计内**：
  //    走台账登记（写明"这是正文不是图标"），而**不**放宽规则（规则一宽就抓不到真图标）。
  const inj4: Map<string, string> = new Map<string, string>();
  inj4.set('components/Fake.ets', "build() {\n  Text('→ 说明文案')\n}\n");
  const got4a: number = symbolAsIconHits(inj4, KNOWN_OK).length;
  const got4b: number = symbolAsIconHits(inj4, ["components/Fake.ets :: '→ 说明文案'"]).length;
  console.log(`     [边界] 符号开头的正文：未登记=${got4a} 条，登记后=${got4b} 条`);
  ok('边界行为符合设计：符号开头 ⇒ 默认命中；登记进台账后放过（规则不因此放宽）', got4a === 1 && got4b === 0);
}

console.log('\n▼ 摘要');
console.log(`  SymbolGlyph ${nSg} / Image ${nImg}；A 命中 ${aHits.length}；B 命中 ${bHits.length}（台账 ${KNOWN_OK.length}）`);
console.log(`  ⇒ 取色口径干净（0 字面量）；"图标即文本"已清零（修复 3 处：QueueSheet ↑/↓ + SettingsDeveloper ●）`);
if (fail > 0) { console.log(`\n  icon_consistency_gate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  icon_consistency_gate: ${pass} passed, 0 failed`);
process.exit(0);

export {};

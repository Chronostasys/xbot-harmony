/**
 * text_truncation_gate.test.ts —— **文字裁切/溢出**判据（"所有细节都做好"类 · 2026-10-11 离线）。
 *
 * ── 缺陷类 ────────────────────────────────────────────────────────────────────
 * 文案被裁成 `…`、长串不换行撑破布局、`maxLines` 截掉关键信息 —— 都是**用户可感**的粗糙。
 * 本文件钉的是**最容易静默发生**的一种：**`.maxLines(N)` 却不配 `.textOverflow(...)`**
 * （ArkUI 默认 `TextOverflow.Clip` ⇒ 超出部分**直接消失、连 `…` 都没有**，用户不知道还有内容）。
 *
 * ── 判据（A 类硬红）───────────────────────────────────────────────────────────
 * **凡带 `.maxLines(` 的 `Text` 必须同时带 `.textOverflow(`** —— 除非登记在下面两张表之一：
 *   · `KNOWN_OK`：**已确认安全**的（空白占位；代码/diff 视图**横向滚动**、加省略号反而语义错误），
 *     每条必须写**理由**；
 *   · `PENDING_SPEC`：**本线改不动**、已出 spec 的（`pages/Index.ets` 归 main agent）。
 * ⛔ 两张表**只许缩短**：断言"实测集合 == 两表之并"——新命中 ⇒ 必红；有人修好了 ⇒ 也必须同步缩短。
 *
 * ── 自证（扫描器本身要能被验）────────────────────────────────────────────────
 *  · 打印**扫了哪些文件** + **逐文件命中分布**；**零扫描判红**（白绿防线）。
 *  · ⚠️ 本扫描器第一版**有 bug**：`Text() { ... }.maxLines(1)` 的属性链在**花括号块之后**，
 *    而它遇到 `{` 就停 ⇒ `maxLines` 计数**假 0**（差点据此得出"全仓没问题"的假结论）。
 *    ⇒ 现在先跳过配平的 `{...}` 块再读链；并有断言"`maxLines` 总数 > 0"专门守住这个 bug 不复发。
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

function stripComments(src: string): string {
  let out: string = ''; let i: number = 0;
  const n: number = src.length;
  while (i < n) {
    const c: string = src.charAt(i);
    if (c === '/' && i + 1 < n) {
      if (src.charAt(i + 1) === '/') { const j: number = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (src.charAt(i + 1) === '*') {
        const j: number = src.indexOf('*/', i + 2);
        if (j < 0) { break; }
        let nl: number = 0;
        for (let k = i; k < j; k++) { if (src.charAt(k) === '\n') { nl++; } }
        out += '\n'.repeat(nl);
        i = j + 2; continue;
      }
    }
    out += c; i += 1;
  }
  return out;
}
/** `s[i]` 是 opener ⇒ 返回配平 closer 的下标。 */
function matchPair(s: string, i: number, op: string, cl: string): number {
  let d: number = 0;
  while (i < s.length) {
    if (s.charAt(i) === op) { d++; }
    else if (s.charAt(i) === cl) { d--; if (d === 0) { return i; } }
    i += 1;
  }
  return -1;
}
function skipWs(s: string, i: number): number {
  while (i < s.length && ' \t\r\n'.indexOf(s.charAt(i)) >= 0) { i += 1; }
  return i;
}
/** `Text(...)` 之后的属性链：**先跳过可选的 `{...}` 块**，再读 `.attr(...)` 序列。 */
function chainAfterText(s: string, i: number): string {
  i = skipWs(s, i);
  if (i < s.length && s.charAt(i) === '{') {
    const k: number = matchPair(s, i, '{', '}');
    i = k < 0 ? s.length : k + 1;
  }
  let out: string = '';
  i = skipWs(s, i);
  while (i < s.length && s.charAt(i) === '.') {
    const j: number = s.indexOf('(', i);
    if (j < 0) { break; }
    const k: number = matchPair(s, j, '(', ')');
    if (k < 0) { break; }
    out += s.substring(i, k + 1);
    i = skipWs(s, k + 1);
  }
  return out;
}
function isLiteral(c: string): boolean {
  const t: string = c.trim();
  if (t.length < 2) { return false; }
  const q: string = t.charAt(0);
  return (q === '\'' || q === '"') && t.charAt(t.length - 1) === q;
}

class Site {
  rel: string = ''; line: number = 0; content: string = ''; dynamic: boolean = false;
}
const files: string[] = [];
const dirs: string[] = ['components', 'pages'];
for (let d = 0; d < dirs.length; d++) {
  const base: string = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', dirs[d]);
  const walk = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walk(p); }
      else if (ents[i].endsWith('.ets')) { files.push(p); }
    }
  };
  walk(base);
}
const scanned: number = files.length;
let textNodes: number = 0;
let maxLinesTotal: number = 0;
let withOverflow: number = 0;
let without: Site[] = [];
const perFile: string[] = [];
for (let f = 0; f < files.length; f++) {
  const p: string = files[f];
  const src: string = stripComments(fsMod.readFileSync(p, 'utf-8'));
  // ⛔ 键必须是**短路径**（相对 `entry/src/main/ets`），否则与台账键不一致 ⇒ 全判"未登记"（我已踩过）。
  const rel: string = pathMod.relative(pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets'), p);
  const rx: RegExp = /\bText\s*\(/g;
  let m: RegExpExecArray | null = rx.exec(src);
  let nHere: number = 0;
  while (m !== null) {
    const j: number = src.indexOf('(', m.index);
    const k: number = matchPair(src, j, '(', ')');
    if (k > 0) {
      textNodes += 1;
      const c: string = src.substring(j + 1, k).trim();
      const ch: string = chainAfterText(src, k + 1);
      if (ch.indexOf('.maxLines(') >= 0) {
        maxLinesTotal += 1;
        if (ch.indexOf('.textOverflow(') >= 0) { withOverflow += 1; }
        else {
          nHere += 1;
          const s: Site = new Site();
          s.rel = rel; s.content = c;
          let ln: number = 1;
          for (let z = 0; z < m.index; z++) { if (src.charAt(z) === '\n') { ln++; } }
          s.line = ln;
          s.dynamic = !isLiteral(c) && c.indexOf('$r(') < 0 && c.length > 0;
          without.push(s);
        }
      }
    }
    m = rx.exec(src);
  }
  if (nHere > 0) { perFile.push(`  ${pad(rel, 52)} 无溢出 maxLines=${nHere}`); }
}

console.log('\n▶ §A 扫描器自证');
console.log(`  扫到 .ets 文件 ${scanned} 个（components + pages）`);
console.log(`  Text 节点 ${textNodes}；带 maxLines 的 ${maxLinesTotal}；其**有** textOverflow ${withOverflow}；**无** ${without.length}`);
console.log('  逐文件命中分布：');
for (let i = 0; i < perFile.length; i++) { console.log(perFile[i]); }
ok('零扫描判红：扫到文件数 > 0', scanned > 0);
ok('扫描器有效性：Text 节点数 > 0', textNodes > 0);
// ⛔ 专门守第一版那个 bug：`Text() { ... }.maxLines()` 的属性链在块之后，遇 `{` 停 ⇒ 假 0。
ok('⚠️ 扫到 maxLines 总数 > 0（第一版遇 `{` 就停 ⇒ 假 0，差点得出"全仓没问题"的假结论）', maxLinesTotal > 0);

console.log('\n▶ §B A 类命中：maxLines 但无 textOverflow（超出部分静默消失、连 … 都没有）');
for (let i = 0; i < without.length; i++) {
  const s = without[i];
  console.log(`  ${pad(s.rel, 52)}:${pad(String(s.line), 5)} ${s.dynamic ? '**动态**' : '静态  '} ${s.content.substring(0, 40)}`);
}

console.log('\n▶ §C 受管台账（⛔ 只许缩短；每条给理由）');
/** 已确认安全的（理由必须逐条写）。键 = `文件 :: 内容表达式`。 */
const KNOWN_OK: string[] = [
  // 代码/diff 行：该视图**横向滚动**（`whitespace-pre` + `overflow-x-auto` 语义）⇒ 加 `…` 反而**语义错误**
  // （代码不该显示省略号；纵向 `maxLines` 只是护栏）。⛔ 不是"看着碍眼就豁免"，是语义不同。
  'components/ToolPopover.ets :: ln.length > 0 ? ln : \' \'',
  'components/ToolPopover.ets :: ln.text.length > 0 ? ln.text : \' \'',
];
/**
 * 本线**改不动**、已出 spec 的（`pages/Index.ets` 归 main agent）。
 *
 * ⚠️ 2026-10-11 `63d169b`（splash-ux）已把六处全补上 `.textOverflow({overflow: Ellipsis})`
 *    ⇒ **台账按"只许缩短"删空**（实测非空白命中 8 → 2，那 2 条是 KNOWN_OK 的代码行）。
 *    保留空数组：下一次新命中会立刻被"实测集合 == 两表之并"拦住。
 */
const PENDING_SPEC: string[] = [];
/**
 * **结构性豁免**（不是逐条放行）：文本内容**本身就是空白**（`Text(){}` 容器 / `Text(' ')` 占位）
 * ⇒ **没有可裁的内容**，配不配 `textOverflow` 都一样。判据对这类**按性质**放过，并打印条数。
 */
function isBlankContent(c: string): boolean {
  const t: string = c.trim();
  if (t.length === 0) { return true; }
  if (t.length === 2 && t.charAt(0) === '\'' && t.charAt(1) === '\'') { return true; }
  if (t.length === 3 && t.charAt(0) === '\'' && t.charAt(1) === ' ' && t.charAt(2) === '\'') { return true; }
  return false;
}
const blanks: Site[] = without.filter((s) => isBlankContent(s.content));
const nonBlank: Site[] = without.filter((s) => !isBlankContent(s.content));
const registered: string[] = KNOWN_OK.concat(PENDING_SPEC);
const measured: string[] = nonBlank.map((s) => `${s.rel} :: ${s.content}`);
let unregistered: string[] = [];
for (let i = 0; i < measured.length; i++) {
  if (registered.indexOf(measured[i]) < 0) { unregistered.push(measured[i]); }
}
let stale: string[] = [];
for (let i = 0; i < registered.length; i++) {
  if (measured.indexOf(registered[i]) < 0) { stale.push(registered[i]); }
}
ok(`无"未登记的 A 类命中"（未登记 ${unregistered.length} 条${unregistered.length > 0 ? '：' + unregistered.slice(0, 3).join(' / ') : ''}）`,
  unregistered.length === 0);
ok(`台账**只许缩短**：没有已修好却仍留在表里的条目（陈旧 ${stale.length} 条${stale.length > 0 ? '：' + stale.slice(0, 3).join(' / ') : ''}）`,
  stale.length === 0);
ok(`已知安全条目每条都有明确归属（KNOWN_OK ${KNOWN_OK.length} + PENDING_SPEC ${PENDING_SPEC.length} = 实测非空白 ${measured.length}；另结构性豁免空白 ${blanks.length} 条）`,
  KNOWN_OK.length + PENDING_SPEC.length === measured.length);
for (let i = 0; i < blanks.length; i++) {
  console.log(`     （结构性豁免·空白）${blanks[i].rel}:${blanks[i].line}  无文本内容可裁`);
}

console.log('\n▶ §D mutation 自证：拿掉某处的 textOverflow ⇒ A 类必须报出来');
/** 判据本体（纯函数）：给定各文件的源码，返回"未登记的 A 类命中"。 */
function unregisteredHits(srcByRel: Map<string, string>): string[] {
  const out: string[] = [];
  for (let f = 0; f < files.length; f++) {
    const rel: string = pathMod.relative(pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets'), files[f]);
    const raw: string | undefined = srcByRel.get(rel);
    if (raw === undefined) { continue; }
    const src: string = stripComments(raw);
    const rx: RegExp = /\bText\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      const j: number = src.indexOf('(', m.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const c: string = src.substring(j + 1, k).trim();
        const ch: string = chainAfterText(src, k + 1);
        if (ch.indexOf('.maxLines(') >= 0 && ch.indexOf('.textOverflow(') < 0 && !isBlankContent(c)) {
          const key: string = `${rel} :: ${c}`;
          if (registered.indexOf(key) < 0) { out.push(key); }
        }
      }
      m = rx.exec(src);
    }
  }
  return out;
}
const realSrc: Map<string, string> = new Map<string, string>();
for (let i = 0; i < files.length; i++) {
  realSrc.set(pathMod.relative(pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets'), files[i]), fsMod.readFileSync(files[i], 'utf-8'));
}
ok('真实源码判绿（防"判据恒红"）', unregisteredHits(realSrc).length === 0);
{
  // mutation：把 MenuSheets 刚补的 textOverflow 拿掉 ⇒ 必红
  const inj: Map<string, string> = new Map<string, string>();
  realSrc.forEach((v, k) => inj.set(k, v));
  const ms: string = 'components/MenuSheets.ets';
  const msSrc: string = inj.get(ms) as string;
  const mutated: string = msSrc.replace(
    `.maxLines(3)\n                  // ⛔ \`maxLines\` 必须配 \`textOverflow\`：不配 = 默认 \`Clip\` ⇒ 第 4 行起**静默消失**\n                  //    （连 \`…\` 都没有，用户不知道还有内容）。搜素命中行是**动态长文本**，正是这类。\n                  .textOverflow({ overflow: TextOverflow.Ellipsis })\n`,
    `.maxLines(3)\n`);
  inj.set(ms, mutated);
  ok('mutation：拿掉 MenuSheets 的 textOverflow ⇒ A 类必红', unregisteredHits(inj).length > 0);
}
{
  // mutation：把 SettingsDeveloper 刚补的拿掉 ⇒ 必红
  const inj: Map<string, string> = new Map<string, string>();
  realSrc.forEach((v, k) => inj.set(k, v));
  const sd: string = 'components/SettingsDeveloper.ets';
  const sdSrc: string = inj.get(sd) as string;
  const mutated: string = sdSrc.replace(
    `        .maxLines(1)\n        // ⛔ \`maxLines\` 必须配 \`textOverflow\`（否则默认 \`Clip\` ⇒ 事件名被**静默截断**无提示）。\n        .textOverflow({ overflow: TextOverflow.Ellipsis })\n`,
    `        .maxLines(1)\n`);
  inj.set(sd, mutated);
  ok('mutation：拿掉 SettingsDeveloper 的 textOverflow ⇒ A 类必红', unregisteredHits(inj).length > 0);
}

console.log('\n▼ 摘要');
console.log(`  扫 ${scanned} 文件 / ${textNodes} 个 Text 节点；maxLines ${maxLinesTotal}（有 overflow ${withOverflow} / 无 ${without.length}）`);
console.log(`  无 overflow 的 ${without.length} 条 = KNOWN_OK ${KNOWN_OK.length}（有理由）+ PENDING_SPEC ${PENDING_SPEC.length}（pages/Index.ets，归 main agent）`);
if (fail > 0) { console.log(`\n  text_truncation_gate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  text_truncation_gate: ${pass} passed, 0 failed`);
process.exit(0);

export {};

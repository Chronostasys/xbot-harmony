/**
 * wordbreak_policy.test.ts —— **断行策略**判据（目标③/②「正文不许劈词」，15b 定案）。
 *
 * ── 规则真源（都已登记，本判据只是把它机器化）───────────────────────────────────
 *   · `docs/REDESIGN.md:326`：⛔ **禁止** `BREAK_ALL` 劈词；
 *   · `docs/UI-AUDIT-CHECKLIST.md:639`：**多行自然语言正文** ⇒ `wordBreak(BREAK_WORD)`；
 *     **可能含不可断长串**（URL / 绝对路径 / 命令 / 错误原文）或**代码** ⇒ `BREAK_ALL`。
 *   · ArkUI 语义（SDK `component/enums.d.ts:4244-4259` 原文）：非 CJK 文本在 `BREAK_WORD` 下
 *     "preferentially wraps lines at appropriate characters (for example, spaces). If no
 *     breakpoints are found, it breaks between any two characters."（= CSS `overflow-wrap:break-word`）；
 *     `BREAK_ALL` 恒在任意两字符间断（= CSS `word-break:break-all`）⇒ 英文正文被**劈词**
 *     （装机截图实证 `co|ding` / `expl|ore` / `mar|kdown` / `decisio|n` / `Ne|ver`）。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────────
 *   ① **零扫描判红**：两个被查文件都必须真读到、真扫到 `wordBreak(` 站点（防"范围写空 = 白绿"）。
 *   ② **正文区不得出现 `BREAK_ALL`**（MarkdownView 的 Heading builder 与 Inline builder
 *      = 段落/引用/列表项共用的正文渲染器）—— ⛔ 这是本判据的主断言。
 *   ③ **正文区确实是 `BREAK_WORD`**（不是"什么都没写"⇒ 继承 ArkUI 默认 `NORMAL` 也不算通过）。
 *   ④ **台账（只许缩短）**：MarkdownView / AskUserSheet 的 `BREAK_ALL` 站点数 ≤ 台账；
 *      全仓 `components/**` + `pages/**` 的 `BREAK_ALL` 总数 ≤ 台账。**新增 ⇒ 红**（必须来登记理由）。
 *   ⑤ **代码块仍 `BREAK_ALL`**（token 流，逐字符断是对的 —— 与 web `<pre>` 一致）。
 *
 * ⛔ 纪律：**剥注释**（注释里提到 `BREAK_ALL` 是文档，不是站点 —— 13h/skills_pure 同一条坑）；
 *   **只取调用片段** `wordBreak(WordBreak.BREAK_ALL)`，不"取整行猜"。
 *   mutation：把 MarkdownView 正文区任一站点改回 `BREAK_ALL` ⇒ ② 必红。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
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
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
/** 只取**调用片段**（不取整行）⇒ 计数与"是否真有该调用"同源。 */
function countSites(src: string, call: string): number {
  let n = 0, i = 0;
  while (true) {
    const j = src.indexOf(call, i);
    if (j < 0) { break; }
    n++; i = j + call.length;
  }
  return n;
}
const ALL = 'wordBreak(WordBreak.BREAK_ALL)';
const WORD = 'wordBreak(WordBreak.BREAK_WORD)';

const HERE = __dirname;
// ⚠️ `run.sh` 把测试拷进 `.out.$$/js` 再跑 ⇒ `__dirname` **不是** `tools/tests`
//    （仓内既有范式：向上找 `entry/src/main/ets` 的祖先，见 `plugin_icons.test.ts:findRoot`）。
function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'entry', 'src', 'main', 'ets'))) { return dir; }
    const up = path.dirname(dir);
    if (up === dir) { break; }
    dir = up;
  }
  return '';
}
const ROOT = findRoot(HERE);
const ETS = ROOT.length > 0 ? path.join(ROOT, 'entry', 'src', 'main', 'ets') : '';
const MD_REL = 'components/MarkdownView.ets';
const ASK_REL = 'components/AskUserSheet.ets';

function readBody(rel: string): string {
  const p = path.join(ETS, rel);
  if (!fs.existsSync(p)) { return ''; }
  return stripComments(fs.readFileSync(p, 'utf8'));
}
function sliceBetween(src: string, a: string, b: string): string {
  const i = src.indexOf(a);
  if (i < 0) { return ''; }
  const j = src.indexOf(b, i + a.length);
  return j < 0 ? src.substring(i) : src.substring(i, j);
}

// ── 全仓扫描（components + pages）───────────────────────────────────────────────
const files: string[] = [];
for (const dir of ['components', 'pages']) {
  const d = path.join(ETS, dir);
  if (!fs.existsSync(d)) { continue; }
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.ets')) { files.push(path.join(d, f)); }
  }
}
const rel = (p: string): string => path.relative(ETS, p).split(path.sep).join('/');

let totalAll = 0;
let totalWord = 0;
const allByFile = new Map<string, number>();
for (const f of files) {
  const body = stripComments(fs.readFileSync(f, 'utf8'));
  const n = countSites(body, ALL);
  if (n > 0) { allByFile.set(rel(f), n); }
  totalAll += n;
  totalWord += countSites(body, WORD);
}

// ── ① 零扫描判红 ───────────────────────────────────────────────────────────────
{
  const md = readBody(MD_REL);
  const ask = readBody(ASK_REL);
  ok('① 真读到 MarkdownView.ets（非空）', md.length > 0);
  ok('① 真读到 AskUserSheet.ets（非空）', ask.length > 0);
  ok('① MarkdownView 真扫到 `wordBreak(` 站点（≥6）', countSites(md, 'wordBreak(') >= 6,
    `实得 ${countSites(md, 'wordBreak(')}`);
  ok('① 全仓真扫到 BREAK_ALL 站点（>0）', totalAll > 0);
  ok('① 全仓真扫到 BREAK_WORD 站点（>0）', totalWord > 0);
  console.log(`▶ 断行台账：${files.length} 个 .ets ｜ BREAK_ALL ${totalAll} 处 ｜ BREAK_WORD ${totalWord} 处`);
}

// ── ②③ MarkdownView **正文区**（Heading builder + Inline builder）─────────────────
{
  const md = readBody(MD_REL);
  // Heading builder：`MdBlockKind.Heading` → `MdBlockKind.Code`（下一个分支）。
  const heading = sliceBetween(md, 'MdBlockKind.Heading', 'MdBlockKind.Code');
  // Inline builder：`.lineHeight(this.sz(typeOf('type.body').size) * MD_BODY_LEADING)` → 下一个 `@Builder`
  //   （段落/引用/列表项都经 `this.Inline(...)`，三处共用同一个 builder）。
  const inlineFrom = md.indexOf('* MD_BODY_LEADING)');
  const inlineTo = md.indexOf('@Builder', inlineFrom + 1);
  const inline = inlineFrom < 0 ? '' : md.substring(inlineFrom, inlineTo < 0 ? md.length : inlineTo);

  ok('② 锚点命中：Heading builder 切片非空', heading.length > 0);
  ok('② 锚点命中：Inline builder 切片非空', inline.length > 0);
  ok('② Heading（标题）无 BREAK_ALL', countSites(heading, ALL) === 0, `实得 ${countSites(heading, ALL)}`);
  ok('② Inline（段落/引用/列表正文）无 BREAK_ALL', countSites(inline, ALL) === 0, `实得 ${countSites(inline, ALL)}`);
  ok('③ Heading（标题）= BREAK_WORD', countSites(heading, WORD) >= 1, `实得 ${countSites(heading, WORD)}`);
  ok('③ Inline（正文）= BREAK_WORD', countSites(inline, WORD) >= 1, `实得 ${countSites(inline, WORD)}`);
  // ⑤ 代码块 wrap 站点仍是 BREAK_ALL（CodeBlock builder 内）。
  const code = sliceBetween(md, 'CodeBlock(b: MdBlock', '@Builder');
  const codeAll = code.length > 0 ? countSites(code, ALL) : countSites(md, ALL);
  ok('⑤ 代码块（wrap 模式）仍是 BREAK_ALL（token 流逐字符断是对的）', codeAll >= 1, `实得 ${codeAll}`);
}

// ── ④ 台账（**只许缩短**；新增 ⇒ 红 ⇒ 必须来登记理由）────────────────────────────
{
  const BUDGET_ALL = 44;      // 全仓 BREAK_ALL 站点上限（15b 从 46 降到 44）
  const BUDGET_WORD_MIN = 16; // 全仓 BREAK_WORD 站点下限（15b 从 14 升到 16）
  const BUDGET_MD = 5;        // MarkdownView：代码 wrap 1 + 表格单元 4
  const BUDGET_ASK = 3;       // AskUserSheet：空态小字 + header + 选项标签（正文已是 BREAK_WORD）
  ok(`④ 全仓 BREAK_ALL ≤ ${BUDGET_ALL}（只许缩短；新增须登记理由）`, totalAll <= BUDGET_ALL, `实得 ${totalAll}`);
  ok(`④ 全仓 BREAK_WORD ≥ ${BUDGET_WORD_MIN}（正文必须显式声明，⛔ 不能靠默认 NORMAL）`,
    totalWord >= BUDGET_WORD_MIN, `实得 ${totalWord}`);
  const mdAll = countSites(readBody(MD_REL), ALL);
  ok(`④ MarkdownView BREAK_ALL ≤ ${BUDGET_MD}（= 代码 wrap + 表格单元；正文 0）`, mdAll <= BUDGET_MD, `实得 ${mdAll}`);
  const ask = readBody(ASK_REL);
  const askAll = countSites(ask, ALL);
  const askWord = countSites(ask, WORD);
  ok(`④ AskUserSheet BREAK_ALL ≤ ${BUDGET_ASK}（长串类站点）`, askAll <= BUDGET_ASK, `实得 ${askAll}`);
  ok('④ AskUserSheet 问题正文 = BREAK_WORD（多行自然语言）', askWord >= 1, `实得 ${askWord}`);
  const dist: string[] = [];
  for (const k of Array.from(allByFile.keys()).sort()) { dist.push(`${k}: ${allByFile.get(k)}`); }
  console.log(`    BREAK_ALL 分布（${Array.from(allByFile.keys()).length} 文件）：${dist.join(' · ')}`);
}

if (fail > 0) { console.log(`  wordbreak_policy: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  wordbreak_policy: ${pass} passed, 0 failed`);
process.exit(0);

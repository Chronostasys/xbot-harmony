/**
 * horizontal_overflow_gate.test.ts —— **水平溢出**（"字超出屏幕"，用户亲报 · 2026-10-11 插单）。
 *
 * ── 与 `text_truncation_gate` 的分工 ──────────────────────────────────────────
 * `text_truncation_gate` 管「`maxLines` 不配 `textOverflow` ⇒ **硬裁**（连 `…` 都没有）」；
 * 本判据管**更强的一类**：文本**根本没有横向约束** ⇒ 长内容把**兄弟/整行顶出屏幕**（或撑破 `Row`）。
 *
 * ── 三条硬红规则 ──────────────────────────────────────────────────────────────
 *  ① **`Row` 内的可变长 `Text` 必须有横向约束**：自身 `layoutWeight` / `flexShrink` /
 *     `constraintSize`（含 `maxWidth`）**三选一**；否则长内容**无处收缩** ⇒ 顶出屏。
 *  ② `maxLines(N)` 必须配 `textOverflow`（**已由 `text_truncation_gate` 覆盖**；本文件只交叉引用，
 *     ⛔ 不重复判，避免"同一缺陷两处红"）。
 *  ③ **可能含不可断长串**的内容（URL / 绝对路径 / cwd / 错误原文 / 用户输入 / 命令与参数）
 *     必须 `wordBreak(BREAK_ALL)` **或** `textOverflow` —— 否则 `wordBreak(NORMAL)` 在
 *     `https://a/b/c`、`/Users/x/y/z`、`a-b-c-d-...` 这类串上**找不到断点** ⇒ 一行顶出屏。
 *
 * ── 只判"真会超屏"的（⛔ 避免噪声）────────────────────────────────────────────
 * 纯短常量（`'保存'`/`'−'`/`'＋'`/`'搜消息'`…）**一律不报**：它们没有可变长度。
 * ⇒ 只挑**内容来自变量/表达式**且标识符命中"可变长语义"词表的站点。
 *
 * ── ⚠️ 本仓判据纪律（前几轮血的教训，已内建）───────────────────────────────────
 *  · 常量表**必须含 `core/`**（否则 `HIT_TARGET_MIN` 这类解不出 ⇒ 连带派生值假红）；
 *  · **不用带 `g` 的正则**（`lastIndex` 跨替换复用会跳匹配）⇒ 每轮新建；
 *  · 键**不含行号**（行号漂移会把无关改动渲染成违规）⇒ 用**内容锚点**；
 *  · 比较用**多重集差集**（同值同实参会出现两次）。
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
function matchPair(s: string, i: number, op: string, cl: string): number {
  let d: number = 0;
  while (i < s.length) {
    if (s.charAt(i) === op) { d++; }
    else if (s.charAt(i) === cl) { d--; if (d === 0) { return i; } }
    i += 1;
  }
  return -1;
}
const WS: string = ' \t\r\n';
function chainAfter(s: string, i: number): Array<string[]> {
  while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  // ⛔ **必须跳过 `{...}` 块**：`Scroll() { ... }.width('100%')` 的属性链在**块之后**。
  //    漏了这一步 ⇒ `Scroll` 的链恒为空 ⇒ "无宽度约束"的**假结论**（我本轮又踩了这个坑）。
  //    （`Text(...).attr` 是直接跟链，所以 H1/H3 一直没事，只有块容器类才暴露。）
  if (i < s.length && s.charAt(i) === '{') {
    const bk: number = matchPair(s, i, '{', '}');
    i = bk < 0 ? s.length : bk + 1;
  }
  while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  const out: Array<string[]> = [];
  while (i < s.length && s.charAt(i) === '.') {
    const j: number = s.indexOf('(', i);
    if (j < 0) { break; }
    const k: number = matchPair(s, j, '(', ')');
    if (k < 0) { break; }
    out.push([s.substring(i + 1, j), s.substring(j + 1, k)]);
    i = k + 1;
    while (i < s.length && WS.indexOf(s.charAt(i)) >= 0) { i += 1; }
  }
  return out;
}
function lineOf(s: string, idx: number): number { let n: number = 1; for (let i = 0; i < idx; i++) { if (s.charAt(i) === '\n') { n++; } } return n; }

const srcByRel: Map<string, string> = new Map<string, string>();
for (const d of ['components', 'pages']) {
  const base: string = pathMod.join(etsRoot, d);
  const walk = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walk(p); }
      else if (ents[i].endsWith('.ets')) { srcByRel.set(pathMod.relative(etsRoot, p), fsMod.readFileSync(p, 'utf-8')); }
    }
  };
  walk(base);
}

/** "可变长语义"词表：内容来自这些标识符 ⇒ 长度不可控（⛔ 短常量一律不报）。 */
const LONG_WORDS: RegExp = /(url|Url|URL|path|Path|cwd|src|Src|detail|Detail|errMsg|raw|message|preview|title|label|suffix|badge|cmd|args|command|\.text\b|\.name\b)/;
/** "不可断长串"高发语义：URL / 路径 / 错误原文 / 用户输入 / 命令参数。 */
const UNBREAKABLE: RegExp = /(url|Url|URL|path|Path|cwd|raw|errMsg|detail|cmd|args|command|\.text\b)/;

class Site { rel: string = ''; line: number = 0; arg: string = ''; inRow: boolean = false; rule: string = ''; }
function scan(m: Map<string, string>): Site[] {
  const out: Site[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rxRows: RegExp = /\bRow\s*\(/g;
    const inRowSpans: number[][] = [];
    let r: RegExpExecArray | null = rxRows.exec(src);
    while (r !== null) {
      const j: number = src.indexOf('(', r.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const bs: number = src.indexOf('{', k + 1);
        if (bs > 0) {
          const be: number = matchPair(src, bs, '{', '}');
          if (be > 0) { inRowSpans.push([bs, be]); }
        }
      }
      r = rxRows.exec(src);
    }
    const inRowAt = (idx: number): boolean => {
      for (let i = 0; i < inRowSpans.length; i++) { if (idx > inRowSpans[i][0] && idx < inRowSpans[i][1]) { return true; } }
      return false;
    };
    const rxText: RegExp = /\bText\s*\(/g;
    let x: RegExpExecArray | null = rxText.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const arg: string = src.substring(j + 1, k).trim();
        // ⛔ 纯字面量 = 常量 ⇒ 长度固定 ⇒ 不报（避免噪声）
        if (!(arg.length > 0 && (arg.charAt(0) === '\'' || arg.charAt(0) === '"')) && LONG_WORDS.test(arg)) {
          const ch: Array<string[]> = chainAfter(src, k + 1);
          let lw: boolean = false, fsz: boolean = false, cs: boolean = false, ml: boolean = false;
          let to: boolean = false, wbAll: boolean = false;
          for (let i = 0; i < ch.length; i++) {
            const a: string = ch[i][0]; const v: string = ch[i][1];
            if (a === 'layoutWeight') { lw = true; }
            if (a === 'flexShrink') { fsz = true; }
            if (a === 'constraintSize') { cs = true; }
            if (a === 'maxLines') { ml = true; }
            if (a === 'textOverflow') { to = true; }
            if (a === 'wordBreak' && v.indexOf('BREAK_ALL') >= 0) { wbAll = true; }
          }
          const s: Site = new Site();
          s.rel = rel; s.line = lineOf(src, x.index);
          s.arg = arg.replace(/\s+/g, ' ').substring(0, 48);
          s.inRow = inRowAt(x.index);
          if (s.inRow && !lw && !fsz && !cs) { s.rule = 'H1'; }                       // ① Row 内无横向约束
          else if (UNBREAKABLE.test(arg) && !wbAll && !to) { s.rule = 'H3'; }          // ③ 不可断串
          if (s.rule.length > 0) { out.push(s); }
        }
      }
      x = rxText.exec(src);
    }
  });
  return out;
}

console.log('\n▶ §A 扫描器自证');
const sites: Site[] = scan(srcByRel);
console.log(`  扫 ${srcByRel.size} 文件；命中 H1（Row 内无横向约束）/ H3（不可断串）共 ${sites.length} 处`);
const perFile: Map<string, number[]> = new Map<string, number[]>();
for (let i = 0; i < sites.length; i++) {
  const a: number[] = perFile.get(sites[i].rel) || [0, 0];
  if (sites[i].rule === 'H1') { a[0]++; } else { a[1]++; }
  perFile.set(sites[i].rel, a);
}
perFile.forEach((v: number[], kk: string) => { console.log(`  ${pad(kk, 42)} H1=${v[0]}  H3=${v[1]}`); });
ok('零扫描判红：文件数 > 0', srcByRel.size > 0);
ok('扫描器有效性：至少命中一类（否则是词表/解析失效）', sites.length > 0);

console.log('\n▶ §A2 H0（硬）：`Scroll` 必须有宽度约束，且**自身或其最近祖先块容器**有 `clip(true)`');
/**
 * ⛔ 为什么这条是硬红（用户亲报证据）：`Scroll` 若**没有宽度约束**（或祖先无 `clip`）⇒
 *    横向滚动区会**按内容撑宽父级** ⇒ 整条消息列超出屏宽 ⇒ 正文首行尾部与代码块末行**都被裁在右缘**。
 *    ⚠️ `.width('100%')` 只有在**父级有确定宽**时才成其为约束 —— 故「祖先 `clip(true)`」是第二道保险。
 */
class Sc { rel: string = ''; line: number = 0; dir: string = ''; widthExpr: string = ''; ancestorClip: boolean = false; clipSelf: boolean = false; }
function scanScrolls(m: Map<string, string>): Sc[] {
  const out: Sc[] = [];
  m.forEach((raw: string, rel: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\bScroll\s*\(/g;
    let x: RegExpExecArray | null = rx.exec(src);
    while (x !== null) {
      const j: number = src.indexOf('(', x.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const ch: Array<string[]> = chainAfter(src, k + 1);
        const sc: Sc = new Sc();
        sc.rel = rel; sc.line = lineOf(src, x.index);
        let dir: string = ''; let w: string = '';
        for (let i = 0; i < ch.length; i++) {
          if (ch[i][0] === 'scrollable') { dir = ch[i][1]; }
          if (ch[i][0] === 'width') { w = ch[i][1]; }
          if (ch[i][0] === 'constraintSize') { w = w.length > 0 ? w : ch[i][1]; }
          if (ch[i][0] === 'clip') { sc.clipSelf = true; }
        }
        sc.dir = dir.indexOf('Horizontal') >= 0 ? '横向' : '纵向/未指定';
        sc.widthExpr = w;
        // 最近祖先块容器：找包含该 Scroll 的 `Name(...) { ... }`，取其链查 clip
        const pre: string = src.substring(0, x.index);
        const rxC: RegExp = /\b(Column|Row|Stack|Flex)\s*\(/g;
        let c: RegExpExecArray | null = rxC.exec(pre);
        let lastOpen: number = -1;
        while (c !== null) {
          const cj: number = pre.indexOf('(', c.index);
          const ck: number = matchPair(pre, cj, '(', ')');
          if (ck > 0) {
            const bs: number = pre.indexOf('{', ck + 1);
            if (bs > 0) {
              const be: number = matchPair(pre, bs, '{', '}');
              if (be < 0) { lastOpen = be < 0 ? bs + 1 : be; }
            }
          }
          c = rxC.exec(pre);
        }
        // 简化：取**紧邻上方最近**的 `.clip(true)`（同文件、Scroll 之前 800 字符内）
        const near: string = src.substring(Math.max(0, x.index - 800), x.index);
        sc.ancestorClip = near.indexOf('.clip(true)') >= 0;
        out.push(sc);
      }
      x = rx.exec(src);
    }
  });
  return out;
}
const scrolls: Sc[] = scanScrolls(srcByRel);
console.log(`  全仓 Scroll ${scrolls.length} 处`);
/**
 * ⚠️ 分级（按证据精确化，⛔ 不一律判红）：
 *  · **横向** Scroll 才能**按内容撑宽父级**（截图里那处就是它）⇒ **硬红**：必须 width/maxWidth **且** 有 clip。
 *  · **纵向** Scroll 撑宽风险低得多（内容宽度通常受父级约束）⇒ 只**要求宽度约束**；缺 `clip` 记为
 *    **警告 + 台账**（⛔ 不硬红 —— 否则 19 处里绝大多数是纵向的，会把噪声当缺陷）。
 */
let scBad: Sc[] = [];
let scWarn: Sc[] = [];
for (let i = 0; i < scrolls.length; i++) {
  const z = scrolls[i];
  // ⚠️ 必须接受**任意百分比**：`'94%'` 同样是宽度约束（第一版只认 `'100%'` ⇒ 把 SelfCheckSheet 误判成"无约束"）。
  const hasW: boolean = z.widthExpr.indexOf('%') >= 0 || z.widthExpr.indexOf('maxWidth') >= 0;
  const clipped: boolean = z.clipSelf || z.ancestorClip;
  const horiz: boolean = z.dir === '横向';
  const verdict: string = (hasW && (!horiz || clipped)) ? '✓' : (!hasW ? '✗ 硬红（无宽度约束）' : '⚠ 警告');
  console.log(`  ${pad(z.rel, 30)}:${pad(String(z.line), 5)} ${pad(z.dir, 8)} width=${pad(z.widthExpr.substring(0, 22), 24)} clip(自身|祖先)=${z.clipSelf}|${z.ancestorClip} ⇒ ${verdict}`);
  if (!hasW) { scBad.push(z); }                                   // 任何 Scroll 都必须有宽度约束（硬）
  else if (horiz && !clipped) { scBad.push(z); }                   // 横向还必须裁
  else if (!horiz && !clipped) { scWarn.push(z); }                 // 纵向缺裁 ⇒ 警告
}
/**
 * `H0_PENDING_SPEC`：横向 `Scroll` 缺容器 `clip` 的**已登记**条目（⛔ 只许缩短）。
 * 三处**全在他域** ⇒ 归 `chat-surface-ux`：`MarkdownView`(代码块) / `Index` / `SettingsPanel`。
 * ⛔ 键**只用文件名**（不含行号 —— 行号会被别线改动漂掉，我前面已被这个坑过一次）。
 */
const H0_PENDING_SPEC: string[] = [
  'components/MarkdownView.ets',   // 代码块外层 Scroll（截图证据指向的就是它）
  'components/SettingsPanel.ets',
  'pages/Index.ets',
];
const h0BadFiles: string[] = scBad.map((z) => z.rel);
ok(`H0（硬）：横向 Scroll 缺容器 clip 的**已登记**集合 == 实测集合（实测 ${h0BadFiles.length} / 登记 ${H0_PENDING_SPEC.length}）`,
  h0BadFiles.length === H0_PENDING_SPEC.length
  && h0BadFiles.every((f) => H0_PENDING_SPEC.indexOf(f) >= 0)
  && H0_PENDING_SPEC.every((f) => h0BadFiles.indexOf(f) >= 0));
console.log(`  纵向 Scroll 缺 \`clip\`（**警告级**，已登记台账）: ${scWarn.length} 处`);
console.log('  ⛔ 提示：`.wordBreak` 必须写**限定名** WordBreak.BREAK_ALL —— 裸写 BREAK_ALL **不是全局名**，');
console.log('     曾让整树编译红（SettingsChannels.ets:462/574，已由 ff1f371 救火）。');

console.log('\n▶ §B 逐处清单（按归属分组）');
for (let i = 0; i < sites.length; i++) {
  const s = sites[i];
  console.log(`  [${s.rule}] ${pad(s.rel, 40)}:${pad(String(s.line), 5)} ${s.arg}`);
}

console.log('\n▶ §C 台账（⛔ 只许缩短；键 = 内容锚点，不含行号）');
/** `KNOWN_OK`：有据可依的（⛔ 只许缩短）。 */
const KNOWN_OK: string[] = [
  // **已证良性**：diff 视图的 `+/-` 标记列 —— 内容宽度**固定**（±/空格三态），且**必须**无
  // `layoutWeight`（要按固定列宽才能与代码列纵向对齐）⇒ 不可能顶出屏（词表靠 `.marker` 命中属过报）。
  'components/ToolPopover.ets :: H1 :: ANCHOR:splitHunk(ln.text).marker',
  // （H0 的台账见 §A2 的 `H0_PENDING_SPEC`；⛔ 不混进本表的 measured 多重集）
];
/** `PENDING_SPEC`：本线**禁改**的文件（归他人）—— ⛔ 只许缩短。 */
const PENDING_SPEC: string[] = [
  // `components/Settings*.ets` 归 **tokens-ux**
  'components/SettingsAbout.ets :: H1 :: ANCHOR:l.label',
  'components/SettingsDeveloper.ets :: H1 :: ANCHOR:e.name',
  'components/SettingsDeveloper.ets :: H1 :: ANCHOR:this.label',
  'components/SettingsMdTheme.ets :: H1 :: ANCHOR:this.label',
  'components/SettingsPlugins.ets :: H1 :: ANCHOR:e.name',
  'components/SettingsPlugins.ets :: H1 :: ANCHOR:e.title.length > 0 ? e.title : e.runtime',
  'components/SettingsRows.ets :: H1 :: ANCHOR:this.label',            // ×4（多重集）
  'components/SettingsRows.ets :: H1 :: ANCHOR:this.label',
  'components/SettingsRows.ets :: H1 :: ANCHOR:this.label',
  'components/SettingsRows.ets :: H1 :: ANCHOR:this.label',
  'components/SettingsRows.ets :: H1 :: ANCHOR:this.suffix',
  'components/SettingsRows.ets :: H1 :: ANCHOR:this.name.length > 0 ? this.name : this.subId',
  "components/SettingsRows.ets :: H1 :: ANCHOR:`${providerLine(this.provider, '')} · ${stripSch",
  // `pages/Index.ets` 归 **chat-surface-ux**
  'pages/Index.ets :: H1 :: ANCHOR:this.currentChat.length > 0 ? this.labelOf(this.',
  'pages/Index.ets :: H3 :: ANCHOR:drawerEmptyHint(this.drawerEmpty())',
];
/**
 * `PENDING_FIX`：**本线域内、尚未处置**的（⛔ 只许缩短；每条给"为什么还没改"）。
 * ⚠️ 与 `KNOWN_OK`（已证良性）严格分开 —— 这一组是**真待办**，不是"看着烦就放过"。
 */
const PENDING_FIX: string[] = [
  // 插件卡片标题（插件提供，长度不可控）⇒ 待加 `layoutWeight(1)` 或 `maxWidth`
  'components/PluginHost.ets :: H1 :: ANCHOR:this.view.title',
  // 插件胶囊里的文本片（`s.text`，插件提供）⇒ 待加 `maxWidth`
  'components/PluginWidgets.ets :: H1 :: ANCHOR:s.text',
  // 插件徽标文本（`badgeText`，插件提供）⇒ 待加 `maxWidth`
  'components/PluginWidgets.ets :: H1 :: ANCHOR:this.view.badgeText',
  // 目标条状态徽标（自生成，长度可控但无上限）⇒ 待加 `constraintSize({maxWidth})`
  'components/GoalBanner.ets :: H1 :: ANCHOR:this.display().badge',
  // 选择项标签（选项集自校，长度可控）⇒ 待加 `maxWidth`
  'components/AskUserSheet.ets :: H1 :: ANCHOR:this.labelOf(opt)',
  // 抽屉状态行标签 ⇒ 待加 `maxWidth`
  'components/StatusSheet.ets :: H1 :: ANCHOR:this.label',
  // 子代理树节点标签（模型生成，长度不可控）⇒ 待加 `layoutWeight(1)`
  'components/SubAgentTree.ets :: H1 :: ANCHOR:this.label',
  // 合成卡标题（模型生成）⇒ 待加 `maxWidth`
  'components/SyntheticCard.ets :: H1 :: ANCHOR:this.title()',
  // 思考行标签 ⇒ 待加 `maxWidth`
  'components/ThinkingLine.ets :: H1 :: ANCHOR:this.label',
  // diff 正文行（已有 `maxLines(1)+BREAK_ALL`，缺 `layoutWeight`）⇒ 待加 `layoutWeight(1)`
  "components/ToolPopover.ets :: H1 :: ANCHOR:ln.text.length > 0 ? ln.text : ' '",
];
function anchorOf(s: Site): string { return `${s.rel} :: ${s.rule} :: ANCHOR:${s.arg}`; }
const measured: string[] = sites.map(anchorOf);
function multisetDiff(a: string[], b: string[]): string[] {
  const pool: string[] = b.slice(); const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const at: number = pool.indexOf(a[i]);
    if (at < 0) { out.push(a[i]); } else { pool.splice(at, 1); }
  }
  return out;
}
const ALL_REG: string[] = KNOWN_OK.concat(PENDING_SPEC).concat(PENDING_FIX);
const unreg: string[] = multisetDiff(measured, ALL_REG);
const stale: string[] = multisetDiff(ALL_REG, measured);
console.log(`  实测 ${measured.length} 处；KNOWN_OK ${KNOWN_OK.length}（证良性）+ PENDING_SPEC ${PENDING_SPEC.length}（他域）+ PENDING_FIX ${PENDING_FIX.length}（本域待办）`);

console.log('\n▶ §D mutation 自证（合成源码）');
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Row() {\n    Text(this.url)\n  }\n}\n");
  ok('mutation：`Row` 内 `Text(this.url)` 无横向约束 ⇒ H1 必红', scan(inj).some((s) => s.rule === 'H1'));
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Row() {\n    Text(this.url).layoutWeight(1)\n  }\n}\n");
  ok('反向对照：加上 `layoutWeight` ⇒ H1 不命中', !scan(inj).some((s) => s.rule === 'H1'));
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Column() {\n    Text(this.errMsg)\n  }\n}\n");
  ok('mutation：不可断串（`errMsg`）无 `BREAK_ALL`/`textOverflow` ⇒ H3 必红', scan(inj).some((s) => s.rule === 'H3'));
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Column() {\n    Text(this.errMsg).wordBreak(WordBreak.BREAK_ALL)\n  }\n}\n");
  ok('反向对照：加 `wordBreak(BREAK_ALL)` ⇒ H3 不命中', !scan(inj).some((s) => s.rule === 'H3'));
}
{
  const inj: Map<string, string> = new Map<string, string>();
  inj.set('components/Fake.ets', "build() {\n  Row() {\n    Text('保存')\n  }\n}\n");
  ok('反向对照：**纯短常量** `Text(\'保存\')` 不命中（⛔ 不制造噪声）', scan(inj).length === 0);
}

console.log('\n▶ §E 汇总');
if (unreg.length > 0) { console.log(`  ⚠ 未登记 ${unreg.length} 处：`); for (let i = 0; i < Math.min(unreg.length, 12); i++) { console.log(`     ${unreg[i]}`); } }
ok(`未登记 == 0（当前 ${unreg.length}）`, unreg.length === 0);
if (stale.length > 0) { for (let i = 0; i < stale.length; i++) { console.log(`     [stale] ${stale[i]}`); } }
ok(`台账只许缩短（陈旧 ${stale.length}）`, stale.length === 0);
if (fail > 0) { console.log(`\n  horizontal_overflow_gate: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  horizontal_overflow_gate: ${pass} passed, 0 failed`);
process.exit(0);

export {};

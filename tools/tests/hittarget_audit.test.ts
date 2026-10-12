/**
 * hittarget_audit.test.ts —— **两类"交互不好点"缺陷**的全仓审计判据（2026-10-11 · 离线）。
 *
 * ── 缺陷类（判据的由来）────────────────────────────────────────────────────────
 * 用户亲报：「…**关闭不好点到**，**滚动栏挡住交互**」（`cd33198` 已修 `ModelSheet` 两处）。
 * 本线把**同类**做成机器判据 + 全仓清一遍，防复发。两类：
 *
 *   A. **命中区 < HIT_TARGET_MIN**：`SymbolGlyph(...).fontSize(N)` 小图标当按钮（关/清/重排/复制），
 *      视觉边长 = 字号 + 2×padding，常 **12–32 < 44**（Apple HIG）⇒ 手指点不中。
 *      与既有 `hit_target_gate.test.ts` **互补**：那条只抓"**显式** `height/width/size/constraintSize` < 44"，
 *      **抓不到**"靠 `fontSize`/`padding` 决定大小的图标"（`ModelSheet` 的 X 正是这类，故当时漏网）。
 *
 *   B. **浮层里默认 `BarState.Auto` 的滚动条挡住交互**：滚动条**叠在列表右缘并参与命中测试**
 *      ⇒ 吃掉行内右侧可点元素（图标 / 整行 `onClick`）的点击。浮层/面板内部短列表 ⇒ 显式 `BarState.Off`。
 *
 * ── 判据（硬红 A 类）────────────────────────────────────────────────────────────
 *  ⛔ **2026-10-11 真机结论（推翻旧口径）**：`responseRegion` 的**负偏移外扩在真机（SDK21）上不生效**
 *     （主 agent 装机对照实验：点 X 视觉中心 ✓ / 点框外 11-15px ✗；见 `AGENTS.md` GOTCHAS）。
 *     ⇒ 本波把 `components/**` 全部改为**真实 44×44 布局盒**（`Row().width(HIT_TARGET_MIN)`
 *     `.height(HIT_TARGET_MIN).justifyContent(FlexAlign.Center)` + `onClick` 落在该盒）。
 *
 *  A. **禁用外扩拐杖**：`components/**` 内 **`responseRegion` 数必须 == 台账**（`RR_LEDGER`，**只许缩短**，
 *     当前为空）。旧写法（把 <44 的自身靠 `responseRegion` 外扩到 44）**设备已证无效** ⇒ **静态禁止**。
 *     `pages/**` 归 main agent（在途）⇒ 仅**打印上报**、**不判红**。
 *  A2. `components/**` 里**可点 `SymbolGlyph`**：若 `fontSize`（+2×竖直 `padding`，**只取调用片段**解析
 *     真源令牌）< `HIT_TARGET_MIN`，且链上**无任何补偿**（`responseRegion` / `HIT_TARGET_MIN` 皆无）⇒ 红。
 *     例外（台账 `GLYPH_LEDGER`，**只许缩短**）——目前为空。
 *  B. **浮层构件**（文件名匹配 `Sheet|Popover|Overlay|Menu|Lightbox`）里的 `Scroll`/`List`：
 *     链上**必须有显式 `.scrollBar(...)`**（默认 `Auto` 是"静默"的 ⇒ 必须由作者显式表态）。
 *     例外 `SCROLL_LEDGER`：`PluginsSheet`（**他域** plugin-parity 在途，只报不改）。
 *
 * ── 自证（扫描器先被验）────────────────────────────────────────────────────────
 *  · **零扫描判红**：扫到的文件数 / 可点元素数 / 浮层滚动容器数 任一为 0 ⇒ 红（白绿防线）。
 *  · **剥注释**后再判（本仓 GOTCHA：注释里记尺寸/写例会误判）。
 *  · **只取调用片段**（`matchPair` 配平括号，`fs('type.x')` 这类**嵌套括号**不当成空参数）。
 *  · **mutation 自证**：把某处 `responseRegion` 注掉 ⇒ A 必红；把某处 `.scrollBar(...)` 注掉 ⇒ B 必红。
 *  · ⚠️ **误报率高的规则不进硬判**：`Text` 小按钮（文案宽度不确定、可能落在高行里）只**警告**打印。
 *
 * ⛔ 只在**离线**跑（纯源码扫描，不碰设备/SDK）。
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

// ── 真源：`HIT_TARGET_MIN`（⛔ 不新造，从 `core/design.ets` 读）────────────────────
const designSrc: string = fsMod.readFileSync(pathMod.join(etsRoot, 'core', 'design.ets'), 'utf-8');
const mMin: RegExpExecArray | null = /HIT_TARGET_MIN\s*:\s*number\s*=\s*(\d+)/.exec(designSrc);
const HIG_FLOOR: number = 44;                        // Apple HIG ≥44pt（design.ets 注释出处）
const MIN: number = mMin !== null ? Number(mMin[1]) : 0;

// ── 令牌真值（命中区估算用；⛔ 与 `core/tokens.ets` / `core/design.ets` 同源，勿分叉）──
const TOK: Map<string, number> = new Map<string, number>([
  ['SP_1', 4], ['SP_2', 8], ['SP_3', 12], ['SP_4', 16], ['SP_5', 20], ['SP_6', 24], ['SP_7', 28], ['SP_8', 32],
  ['SPACE_HAIR', 2], ['SPACE_XXS', 4], ['SPACE_XS', 8], ['SPACE_SM', 12], ['SPACE_MD', 16], ['SPACE_LG', 20], ['SPACE_XL', 24],
  ['ICON_SM', 12], ['ICON_MD', 14], ['ICON_LG', 16], ['ICON_XL', 20],
  ['FS_CAPTION', 12], ['FS_BODY', 14], ['FS_TITLE', 16], ['FS_HERO', 21], ['FS_META', 11],
  ['MARKER_GLYPH', 13], ['MARKER_GLYPH_DASHED', 12],
  ['INSET_ROW_X', 12], ['INSET_ROW_Y', 8], ['INSET_PILL_X', 8], ['INSET_PILL_Y', 5],
  ['INSET_CHIP_X', 4], ['INSET_CHIP_Y', 2],
]);
// `SHEET_ACTION_GLYPH`（`core/design.ets` 新增的"面板页头关闭 X"统一 token，值 = `ICON_LG`）。
// ⛔ 从 `ICON_LG` **取值、不分叉**（ICON_LG 改了这里自动跟）；不写死数字。
// 缺了它 ⇒ `SettingsPanel` 页头 X 的字号解析失败（只剩 padding）⇒ 被误判成 A 类小图标（假红）。
TOK.set('SHEET_ACTION_GLYPH', TOK.get('ICON_LG') as number);
const TYPE_SIZE: Map<string, number> = new Map<string, number>([
  ['type.display', 28], ['type.title', 21], ['type.headline', 17], ['type.body', 15],
  ['type.callout', 14], ['type.subhead', 13], ['type.caption', 12], ['type.micro', 10],
]);

// ── 极简词法：剥注释 / 配平括号 / 取属性链（**只取调用片段**，不"取整行第一个引号"）────
/**
 * 剥注释（**引号感知**）。
 * ⛔ 必须引号感知：否则**字符串里的 `//`（URL！）会被当成行注释** —— 本仓实锤：
 *    `SelfCheckSheet` 的 `MarkdownView({ text: '…](https://example.com)。' })` 会把该行
 *    余下的 `})` 一起吞掉 ⇒ **括号配平被破坏** ⇒ `Scroll()` 的块匹配错位 ⇒ 假红
 *    （`§C` 误报 `SelfCheckSheet` 缺 `scrollBar`）。同族坑见 `AGENTS.md`「判据 ≠ 信号」。
 */
function stripComments(src: string): string {
  let out: string = ''; let i: number = 0; const n: number = src.length;
  let quote: string = '';                                   // '' | '\'' | '"' | '`'
  while (i < n) {
    const c: string = src.charAt(i);
    if (quote !== '') {
      out += c;
      if (c === '\\' && i + 1 < n) { out += src.charAt(i + 1); i += 2; continue; }
      if (c === quote) { quote = ''; }
      i += 1; continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; out += c; i += 1; continue; }
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
function skipWs(s: string, i: number): number { while (i < s.length && ' \t\r\n'.indexOf(s.charAt(i)) >= 0) { i += 1; } return i; }
interface Chain { text: string; parts: string[][]; }   // parts[i] = [方法名, 单层实参原文]
/** 取 `Name(...)` 之后的属性链（先跳过可选 `{...}` 块 —— ⚠️ 上一轮踩过"遇 `{` 就停"的假 0）。 */
function chainAfter(s: string, i: number): Chain {
  i = skipWs(s, i);
  if (i < s.length && s.charAt(i) === '{') { const k: number = matchPair(s, i, '{', '}'); i = k < 0 ? s.length : k + 1; }
  let out: string = ''; const parts: string[][] = []; i = skipWs(s, i);
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
/** 解析"单值表达式"到数字：字面量 / 令牌 / `fs('type.x')` / `typeOf('type.x').size`；否则 null。 */
function numExpr(e: string): number | null {
  const t: string = e.trim();
  if (/^\d+(\.\d+)?$/.test(t)) { return Number(t); }
  if (TOK.has(t)) { return TOK.get(t) as number; }
  let m: RegExpExecArray | null = /^fs\(\s*'([^']+)'\s*\)$/.exec(t);
  if (m !== null && TYPE_SIZE.has(m[1])) { return TYPE_SIZE.get(m[1]) as number; }
  m = /^typeOf\(\s*'([^']+)'\s*\)\.size$/.exec(t);
  if (m !== null && TYPE_SIZE.has(m[1])) { return TYPE_SIZE.get(m[1]) as number; }
  return null;
}
/** 从 `{ top: X, bottom: Y }` 样式对象里取某字段的数字。 */
function objField(arg: string, key: string): number | null {
  const m: RegExpExecArray | null = new RegExp('\\b' + key + '\\s*:\\s*([^,}]+)').exec(arg);
  return m !== null ? numExpr(m[1]) : null;
}
const CLICK: RegExp = /\.(onClick|bindMenu|bindPopup|bindSheet|bindContextMenu|gesture|onTouch|bindTips)\s*\(/;

/** 可点 `SymbolGlyph` 的**视觉最小边长**估算：字号 + 2×竖直 padding；二者都解析不出 ⇒ null。 */
function glyphVisual(parts: string[][]): number | null {
  let fsV: number | null = null; let padV: number | null = null;
  for (let i = 0; i < parts.length; i++) {
    const call: string = parts[i][0]; const arg: string = parts[i][1];
    if (call === 'fontSize') { const v: number | null = numExpr(arg); if (v !== null) { fsV = v; } }
    else if (call === 'padding') {
      const a: string = arg.trim();
      if (a.charAt(0) === '{') {
        const t: number | null = objField(arg, 'top'); const b: number | null = objField(arg, 'bottom');
        if (t !== null && b !== null) { padV = t + b; }
        else if (objField(arg, 'left') !== null || objField(arg, 'right') !== null) { padV = 0; }
      } else { const v: number | null = numExpr(arg); if (v !== null) { padV = v * 2; } }
    }
  }
  if (fsV === null && padV === null) { return null; }
  return (fsV === null ? 0 : fsV) + (padV === null ? 0 : padV);
}

// ── 文件集 ─────────────────────────────────────────────────────────────────────
function walkEts(base: string, out: string[]): void {
  const ents: string[] = fsMod.readdirSync(base);
  for (let i = 0; i < ents.length; i++) {
    const p: string = pathMod.join(base, ents[i]);
    if (fsMod.statSync(p).isDirectory()) { walkEts(p, out); }
    else if (ents[i].endsWith('.ets')) { out.push(p); }
  }
}
const compFiles: string[] = [];
walkEts(pathMod.join(etsRoot, 'components'), compFiles);
const pageFiles: string[] = [];
walkEts(pathMod.join(etsRoot, 'pages'), pageFiles);
const rel = (p: string): string => pathMod.relative(etsRoot, p);
const baseName = (p: string): string => { const b: string = p.substring(p.lastIndexOf('/') + 1); return b.endsWith('.ets') ? b.substring(0, b.length - 4) : b; };
/** "浮层构件"：文件名语义命中（Sheet/Popover/Overlay/Menu/Lightbox）。 */
const OVERLAY: RegExp = /(Sheet|Popover|Overlay|Menu|Lightbox)/;

// ── 判据本体（纯函数，mutation 复用）─────────────────────────────────────────
interface Hit { key: string; line: number; visual: number | null; }

/** A 类：`components` 里**可点 `SymbolGlyph`**、视觉 < MIN、且无补偿（`responseRegion`/`HIT_TARGET_MIN`）。 */
function glyphHits(srcByRel: Map<string, string>): Hit[] {
  const out: Hit[] = [];
  srcByRel.forEach((raw: string, r: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      if (m[1] === 'SymbolGlyph') {
        const j: number = src.indexOf('(', m.index);
        const k: number = matchPair(src, j, '(', ')');
        if (k > 0) {
          const ch: Chain = chainAfter(src, k + 1);
          if (CLICK.test(ch.text) && ch.text.indexOf('responseRegion') < 0 && ch.text.indexOf('HIT_TARGET_MIN') < 0) {
            const v: number | null = glyphVisual(ch.parts);
            if (v !== null && v < MIN) {
              const line: number = src.slice(0, m.index).split('\n').length;
              out.push({ key: `${r} :: SymbolGlyph`, line, visual: v });
            }
          }
        }
      }
      m = rx.exec(src);
    }
  });
  return out.sort((a: Hit, b: Hit): number => a.key.localeCompare(b.key) || a.line - b.line);
}

/** A 类（新增）：扫描 `.responseRegion(...)` 调用（**剥注释后**）—— 设备已证负偏移外扩无效 ⇒ 禁用。 */
function responseRegions(srcByRel: Map<string, string>): Hit[] {
  const out: Hit[] = [];
  srcByRel.forEach((raw: string, r: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\.responseRegion\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      const j: number = src.indexOf('(', m.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const line: number = src.slice(0, m.index).split('\n').length;
        out.push({ key: `${r} :: responseRegion`, line, visual: null });
      }
      m = rx.exec(src);
    }
  });
  return out.sort((a: Hit, b: Hit): number => a.key.localeCompare(b.key) || a.line - b.line);
}

/** B 类：**浮层构件**里的 `Scroll`/`List` 未显式设 `.scrollBar(...)`。 */
function scrollHits(srcByRel: Map<string, string>): Hit[] {
  const out: Hit[] = [];
  srcByRel.forEach((raw: string, r: string) => {
    if (!OVERLAY.test(r)) { return; }
    const src: string = stripComments(raw);
    const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      const nm: string = m[1];
      if (nm === 'Scroll' || nm === 'List' || nm === 'Grid' || nm === 'WaterFlow') {
        const j: number = src.indexOf('(', m.index);
        const k: number = matchPair(src, j, '(', ')');
        if (k > 0) {
          const ch: Chain = chainAfter(src, k + 1);
          if (ch.text.indexOf('.scrollBar(') < 0) {
            const line: number = src.slice(0, m.index).split('\n').length;
            out.push({ key: `${r} :: ${nm}`, line, visual: null });
          }
        }
      }
      m = rx.exec(src);
    }
  });
  return out.sort((a: Hit, b: Hit): number => a.key.localeCompare(b.key) || a.line - b.line);
}

/** 警告级（**不判红**）：`components` 里**可点 `Text`**、视觉 < MIN、且无补偿 —— 误报率高（文案宽度不定），仅打印。 */
function textWarns(srcByRel: Map<string, string>): Hit[] {
  const out: Hit[] = [];
  srcByRel.forEach((raw: string, r: string) => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      if (m[1] === 'Text') {
        const j: number = src.indexOf('(', m.index);
        const k: number = matchPair(src, j, '(', ')');
        if (k > 0) {
          const ch: Chain = chainAfter(src, k + 1);
          if (CLICK.test(ch.text) && ch.text.indexOf('responseRegion') < 0 && ch.text.indexOf('HIT_TARGET_MIN') < 0) {
            // Text 的"高"≈ 行高 × 字号 + 2×竖直 padding（行高取 1.35 的保守档）
            let fsV: number | null = null; let padV: number = 0; let hasPad: boolean = false;
            for (let i = 0; i < ch.parts.length; i++) {
              const call: string = ch.parts[i][0]; const arg: string = ch.parts[i][1];
              if (call === 'fontSize') { const v: number | null = numExpr(arg); if (v !== null) { fsV = v; } }
              else if (call === 'padding') {
                const t: number | null = objField(arg, 'top'); const b: number | null = objField(arg, 'bottom');
                if (t !== null && b !== null) { padV = t + b; hasPad = true; }
                else { const v: number | null = numExpr(arg); if (v !== null) { padV = v * 2; hasPad = true; } }
              }
            }
            const h: number | null = fsV !== null ? fsV * 1.35 + padV : (hasPad ? padV : null);
            if (h !== null && h < MIN) {
              const line: number = src.slice(0, m.index).split('\n').length;
              out.push({ key: `${r} :: Text(h≈${Math.round(h)})`, line, visual: h });
            }
          }
        }
      }
      m = rx.exec(src);
    }
  });
  return out.sort((a: Hit, b: Hit): number => a.key.localeCompare(b.key) || a.line - b.line);
}

// ── 装载 ───────────────────────────────────────────────────────────────────────
const compSrc: Map<string, string> = new Map<string, string>();
compFiles.forEach((p: string): void => { compSrc.set(rel(p), fsMod.readFileSync(p, 'utf-8')); });
const pageSrc: Map<string, string> = new Map<string, string>();
pageFiles.forEach((p: string): void => { pageSrc.set(rel(p), fsMod.readFileSync(p, 'utf-8')); });
const allSrc: Map<string, string> = new Map<string, string>();
compSrc.forEach((v: string, k: string): void => { allSrc.set(k, v); });
pageSrc.forEach((v: string, k: string): void => { allSrc.set(k, v); });

// 台账（**只许缩短**）
const GLYPH_LEDGER: string[] = [];       // 本波已把 components 的可点小图标全部外扩 ⇒ 空
const RR_LEDGER: string[] = [];          // ⛔ 2026-10-11：设备证负偏移外扩无效 ⇒ components 内 `responseRegion` 必须清零
const SCROLL_LEDGER: string[] = [        // ⛔ 他域（plugin-parity 在途）：只报不改
  'components/PluginsSheet.ets :: List',
];

// ── §A 扫描器自证 ──────────────────────────────────────────────────────────────
console.log('\n▶ §A 扫描器自证');
const glyphCount: number = glyphHits(compSrc).length + glyphHits(pageSrc).length;
// 浮层滚动容器计数（含已显式设条者）——用于"零扫描判红"
let overlayScrollables: number = 0;
compSrc.forEach((raw: string, r: string): void => {
  if (!OVERLAY.test(r)) { return; }
  const src: string = stripComments(raw);
  const rx: RegExp = /\b(Scroll|List|Grid|WaterFlow)\s*\(/g;
  let m: RegExpExecArray | null = rx.exec(src);
  while (m !== null) { overlayScrollables += 1; m = rx.exec(src); }
});
console.log(`  阈值真源：core/design.ets \`HIT_TARGET_MIN = ${MIN}\`（出处注释：Apple HIG ≥44pt）`);
console.log(`  扫到 .ets：components ${compSrc.size} / pages ${pageSrc.size}`);
console.log(`  浮层构件里 Scroll/List 容器：${overlayScrollables}`);
ok('零扫描判红：components 文件数 > 0', compSrc.size > 0);
ok('零扫描判红：pages 文件数 > 0', pageSrc.size > 0);
ok('零扫描判红：浮层里扫到滚动容器 > 0', overlayScrollables > 0);
ok('阈值真源可读（`HIT_TARGET_MIN` 解析成功）', MIN > 0);
ok(`⚠️ 门槛本身不许被下调：HIT_TARGET_MIN(${MIN}) ≥ Apple HIG 地板 ${HIG_FLOOR}`, MIN >= HIG_FLOOR);

// ── §B A 类：小图标命中区 < 44 且无外扩 ────────────────────────────────────────
console.log('\n▶ §B A 类：可点小图标（视觉 < 阈值 且 无 responseRegion / HIT_TARGET_MIN）');
const gHits: Hit[] = glyphHits(compSrc);
gHits.forEach((h: Hit): void => { console.log(`  ${pad(h.key, 46)} :${h.line}  visual≈${h.visual}`); });
ok(`命中数 == 台账数（实测 ${gHits.length} / 登记 ${GLYPH_LEDGER.length}）`, gHits.length === GLYPH_LEDGER.length);
ok('命中集与台账集一一对应（同一集合）', ((): boolean => {
  const a: string = gHits.map((h: Hit): string => h.key).sort().join('|');
  const b: string = GLYPH_LEDGER.slice().sort().join('|');
  return a === b;
})());
const pgHits: Hit[] = glyphHits(pageSrc);
console.log(`  ⚠️ 他域 pages/**（light-fix3 在途，只报不改）：${pgHits.length} 处`);
pgHits.forEach((h: Hit): void => { console.log(`     ${pad(h.key, 44)} :${h.line}  visual≈${h.visual}`); });

// ── §B2 A 类：`responseRegion` 外扩拐杖（设备已证无效）必须清零 ────────────────────
console.log('\n▶ §B2 A 类：`components/**` 禁用 `responseRegion`（真机证负偏移外扩无效 ⇒ 改用真实布局盒）');
const compRR: Hit[] = responseRegions(compSrc);
const pageRR: Hit[] = responseRegions(pageSrc);
const allRR: Hit[] = responseRegions(allSrc);
compRR.forEach((h: Hit): void => { console.log(`  ${pad(h.key, 46)} :${h.line}`); });
console.log(`  （现存全仓 responseRegion ${allRR.length} 处 —— 13g 已清零；扫描器有效性改由下方 mutation 注入自证）`);
// ⛔ 自证改为 **mutation 注入**：全仓 responseRegion 已清零（13g 移除「回到最新」的失效外扩拐杖）
//    ⇒ 旧断言「全仓仍扫到」会**假红**。扫描器有效性必须**自带样本**证明，而非依赖生产用法。
{
  const rrSynth: Map<string, string> = new Map<string, string>();
  rrSynth.set('components/__selfcheck__.ets',
    'Xxx()\n  .responseRegion({ x: -6, y: -6, width: 40, height: 40 })\n');
  ok('零扫描判红：注入合成 `responseRegion` ⇒ 必被扫到（证明扫描器有效，不依赖生产用法）',
    responseRegions(rrSynth).length > 0);
}
ok(`components/** responseRegion 数 == 台账（实测 ${compRR.length} / 登记 ${RR_LEDGER.length}）`, compRR.length === RR_LEDGER.length);
ok('components 命中集与台账集一一对应（同一集合）', ((): boolean => {
  const a: string = compRR.map((h: Hit): string => h.key).sort().join('|');
  const b: string = RR_LEDGER.slice().sort().join('|');
  return a === b;
})());
console.log(`  ⚠️ 他域 pages/**（main agent 在途，只报不改）：${pageRR.length} 处`);
pageRR.forEach((h: Hit): void => { console.log(`     ${pad(h.key, 44)} :${h.line}`); });

// ── §C B 类：浮层里未显式设滚动条 ──────────────────────────────────────────────
console.log('\n▶ §C B 类：浮层构件的 Scroll/List 未显式设 `.scrollBar(...)`（默认 Auto 会挡右缘点击）');
const sHits: Hit[] = scrollHits(compSrc);
sHits.forEach((h: Hit): void => { console.log(`  ${pad(h.key, 46)} :${h.line}`); });
ok(`命中数 == 台账数（实测 ${sHits.length} / 登记 ${SCROLL_LEDGER.length}）`, sHits.length === SCROLL_LEDGER.length);
ok('命中集与台账集一一对应（同一集合）', ((): boolean => {
  const a: string = sHits.map((h: Hit): string => h.key).sort().join('|');
  const b: string = SCROLL_LEDGER.slice().sort().join('|');
  return a === b;
})());
ok('components 侧浮层已清零（除登记的 他域 PluginsSheet）',
  !sHits.some((h: Hit): boolean => h.key.indexOf('components/PluginsSheet.ets') !== 0));

// ── §D 警告级（不判红）：可点小 `Text`（误报率高，只登记待办）────────────────────
console.log('\n▶ §D ⚠️ 警告级（不判红）：可点小 `Text`（文案宽度不定、可能落在高行里 ⇒ 不进硬判）');
const tWarns: Hit[] = textWarns(compSrc);
tWarns.slice(0, 20).forEach((h: Hit): void => { console.log(`  ⚠️ ${pad(h.key, 52)} :${h.line}`); });
if (tWarns.length > 20) { console.log(`  ⚠️ … 共 ${tWarns.length} 处（仅列出前 20）`); }
console.log('  （处置建议：高频/破坏性动作优先抬到 ≥44 的真实布局盒；⛔ 密集相邻者勿盲目放大，会与邻座重叠、反而点错）');

// ── §E mutation 自证 ──────────────────────────────────────────────────────────
console.log('\n▶ §E mutation 自证');
const stripRR: RegExp = /\.responseRegion\([^)]*\)/;
{
  // 基线绿
  ok('基线：components responseRegion == 台账（=0）', responseRegions(compSrc).length === RR_LEDGER.length);
  ok('基线：components A2 类命中 == 台账（=0）', glyphHits(compSrc).length === GLYPH_LEDGER.length);
  // 注入：给某 components 文件塞一处 `responseRegion`（失效的负偏移外扩）⇒ A 必红
  const inj: Map<string, string> = new Map<string, string>();
  compSrc.forEach((v: string, k: string): void => { inj.set(k, v); });
  const target: string = 'components/SelfCheckSheet.ets';
  const s0: string = inj.get(target) as string;
  ok('mutation 前置：目标处**无** `responseRegion`（本波已改用真实布局盒）', !stripRR.test(s0));
  inj.set(target, s0 + '\n// mutation\nXxx().responseRegion({ x: -6, y: -6, width: HIT_TARGET_MIN, height: HIT_TARGET_MIN });\n');
  ok('mutation A：注入失效外扩 `responseRegion` ⇒ 出现未登记命中（必红）',
    responseRegions(inj).length > RR_LEDGER.length);
  // 还原 ⇒ 绿
  inj.set(target, s0);
  ok('mutation A 还原 ⇒ 恢复绿', responseRegions(inj).length === RR_LEDGER.length);
}
{
  // 注入 2：注掉 QueueSheet（已修）的 .scrollBar(...) ⇒ B 必红
  const inj: Map<string, string> = new Map<string, string>();
  compSrc.forEach((v: string, k: string): void => { inj.set(k, v); });
  const target: string = 'components/QueueSheet.ets';
  const s0: string = inj.get(target) as string;
  ok('mutation 前置：目标处确有 `.scrollBar(`', s0.indexOf('.scrollBar(') >= 0);
  inj.set(target, s0.replace('.scrollBar(BarState.Off)', ''));
  const got: Hit[] = scrollHits(inj);
  ok('mutation B：注掉 QueueSheet 的 scrollBar ⇒ 出现未登记命中（必红）', got.length > SCROLL_LEDGER.length);
  inj.set(target, s0);
  ok('mutation B 还原 ⇒ 恢复绿', scrollHits(inj).length === SCROLL_LEDGER.length);
}
ok('真实源码判绿（防"判据恒红"）',
  responseRegions(compSrc).length === RR_LEDGER.length
  && glyphHits(compSrc).length === GLYPH_LEDGER.length && scrollHits(compSrc).length === SCROLL_LEDGER.length);

// ── 摘要 ───────────────────────────────────────────────────────────────────────
console.log('\n▼ 摘要');
console.log(`  A 类（components responseRegion 外扩拐杖）命中 ${compRR.length} / 台账 ${RR_LEDGER.length}；他域 pages ${pageRR.length}`);
console.log(`  A2 类（components 可点小图标无补偿）命中 ${gHits.length} / 台账 ${GLYPH_LEDGER.length}；他域 pages ${pgHits.length}`);
console.log(`  B 类（浮层缺显式 scrollBar）命中 ${sHits.length} / 台账 ${SCROLL_LEDGER.length}`);
console.log(`  ⚠️ 警告级（可点小 Text）${tWarns.length}`);
if (fail > 0) { console.log(`\n  hittarget_audit: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  hittarget_audit: ${pass} passed, 0 failed`);
process.exit(0);

export {};

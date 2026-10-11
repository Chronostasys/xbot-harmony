/**
 * hit_target_pad.test.ts —— **命中区判据的"规则洞"补口**（"交互起来很爽"类 · 2026-10-11 离线）。
 *
 * ── 洞是什么（为什么既有两条门禁都抓不到）────────────────────────────────────────
 *  · `hit_target_gate.test.ts:129-147` 只抓**显式** `.height/.width/.size/.constraintSize(<44)`；
 *  · `hittarget_audit.test.ts:200-226`（A2）只抓**可点 `SymbolGlyph`**（字号 + 2×padding）；
 *  · `hittarget_audit.test.ts:276-312`（§D）对**可点 `Text`** 只**警告**、不判红。
 *  ⇒ **靠 `padding`(+`fontSize`) 撑高的可点 `Text` 按钮**（"保存/取消/复制/删除/刷新/复制全部…"）
 *    落在**三条判据的缝里**：无显式尺寸 ⇒ ① 不红；非 `SymbolGlyph` ⇒ ② 不红；`Text` ⇒ ③ 只警告。
 *  本波把这条缝**补成硬红**（`QueueSheet.ets:58-66` 的「清空」是这一类的样板修法：
 *  `constraintSize({ minHeight: HIT_TARGET_MIN })`）。
 *
 * ── 口径（**静态可判**，不猜布局）──────────────────────────────────────────────
 *  仅当**三者都能静态解析**时才判：
 *    ① 链上有 CLICK（`onClick`/`bindMenu`/…）；
 *    ② `Text` 的链上**没有** `height`/`constraintSize`（有 ⇒ 归 `hit_target_gate` 管，本判据让位）；
 *       链上**没有** `HIT_TARGET_MIN`（已达标）；`responseRegion` **不算补偿**（真机实测无效）。
 *    ③ `fontSize` 与竖直 `padding` 都能从**真源**解析：
 *       `fontSize` ∈ {数字字面量, `FS_*`(core/tokens.ets), `fs('type.x')`, `typeOf('type.x').size`,
 *       `typeOf(TYPE_*).size`（别名解析自 core/design.ets）}；
 *       竖直 padding = `{top,bottom}` 之和 / 单值×2 / 缺省 0。
 *  估算视觉高 = `fontSize × 1.35 + 竖直 padding`（行高系数沿用 §D 的保守档 1.35）。
 *  < `HIT_TARGET_MIN`(44) ⇒ **红**。
 *
 *  ⛔ **判不准的不进硬判**（归 §C "待人工/真机核实"清单，只打印）：
 *    · 非 `Text` 容器（`Row`/`Column`/`Stack`/`Flex`/`Button`…）—— 高度由**子节点**决定，静态判不了；
 *    · `fontSize` 解析不出（缺省按 15 低估）—— 记为 `unresolved`，**与**候选**一并打印**供人工核。
 *
 * ── 自证（扫描器先被验）──────────────────────────────────────────────────────
 *  · **零扫描判红**：扫到文件数 / 可点 `Text` 数 任一为 0 ⇒ 红。
 *  · 断言 `HIT_TARGET_MIN ≥ 44`（**门槛不许被下调**）。
 *  · **台账只许缩短**：`PAD_LEDGER.length ≤ PAD_CEILING`（冻结本波基线，后续只许减少）。
 *  · **mutation 自证**：往某文件注入一个"只靠 padding 撑高的小 `Text` 按钮"⇒ 必红；还原 ⇒ 绿。
 *  · **真实源码判绿**：`hits` 集合 == `PAD_LEDGER` 集合（防"判据恒红"）。
 *  · 注释/字符串里的 `//`（URL）会破坏括号配平 ⇒ `stripComments` **引号感知**（同 `hittarget_audit`）。
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

// ── 极简词法：剥注释（引号感知）/ 配平括号 / 取属性链（**只取调用片段**）──────────
function stripComments(src: string): string {
  let out: string = ''; let i: number = 0; const n: number = src.length;
  let quote: string = '';
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
interface Chain { text: string; parts: string[][]; }
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
const CLICK: RegExp = /\.(onClick|bindMenu|bindPopup|bindSheet|bindContextMenu|gesture|onTouch|bindTips)\s*\(/;
const SIZE: RegExp = /\.(height|width|size|constraintSize)\(\s*([^)]*)\)/g;

// ── 真源解析：数值常量（SP_/FS_/INSET_…）+ 排版角色（`typeOf`）+ 类型别名（TYPE_*）────
const tokSrc: string = fsMod.readFileSync(pathMod.join(etsRoot, 'core', 'tokens.ets'), 'utf-8');
const designSrc: string = fsMod.readFileSync(pathMod.join(etsRoot, 'core', 'design.ets'), 'utf-8');
const SRC: string[] = [tokSrc, designSrc];
const NUM: Map<string, number> = new Map<string, number>();
function parseNums(s: string): void {
  const rx: RegExp = /export const (\w+)\s*:\s*number\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null = rx.exec(s);
  while (m !== null) {
    const name: string = m[1]; const expr: string = m[2].trim();
    if (!NUM.has(name)) {
      if (/^\d+(\.\d+)?$/.test(expr)) { NUM.set(name, Number(expr)); }
      else {
        const mm: RegExpExecArray | null = /^(\w+)\s*([-+])\s*(\d+)$/.exec(expr);
        if (mm !== null && NUM.has(mm[1])) {
          const base: number = NUM.get(mm[1]) as number;
          NUM.set(name, mm[2] === '-' ? base - Number(mm[3]) : base + Number(mm[3]));
        }
      }
    }
    m = rx.exec(s);
  }
}
for (let p = 0; p < 3; p++) { for (let i = 0; i < SRC.length; i++) { parseNums(SRC[i]); } }
const ALIAS: Map<string, string> = new Map<string, string>();
{
  const rx: RegExp = /export const (TYPE_\w+)\s*:\s*string\s*=\s*'([^']+)'/g;
  let m: RegExpExecArray | null = rx.exec(designSrc);
  while (m !== null) { ALIAS.set(m[1], m[2]); m = rx.exec(designSrc); }
}
const ROLE: Map<string, number> = new Map<string, number>();
{
  const rx: RegExp = /new TypeRole\('([^']+)',\s*([^,]+),/g;
  let m: RegExpExecArray | null = rx.exec(designSrc);
  while (m !== null) {
    const e: string = m[2].trim(); let v: number | null = null;
    if (/^\d+$/.test(e)) { v = Number(e); }
    else if (NUM.has(e)) { v = NUM.get(e) as number; }
    else { const mm: RegExpExecArray | null = /^(\w+)\s*-\s*(\d+)$/.exec(e); if (mm !== null && NUM.has(mm[1])) { v = (NUM.get(mm[1]) as number) - Number(mm[2]); } }
    if (v !== null) { ROLE.set(m[1], v); }
    m = rx.exec(designSrc);
  }
}
const mMin: RegExpExecArray | null = /HIT_TARGET_MIN\s*:\s*number\s*=\s*(\d+)/.exec(designSrc);
const HIG_FLOOR: number = 44;
const MIN: number = mMin !== null ? Number(mMin[1]) : 0;

/** 单值表达式 → 数字（字面量 / 真源常量 / 排版角色）；否则 null。 */
function numExpr(e: string): number | null {
  const t: string = e.trim();
  if (/^\d+(\.\d+)?$/.test(t)) { return Number(t); }
  if (NUM.has(t)) { return NUM.get(t) as number; }
  let m: RegExpExecArray | null = /^fs\(\s*'([^']+)'\s*\)$/.exec(t);
  if (m !== null && ROLE.has(m[1])) { return ROLE.get(m[1]) as number; }
  m = /^typeOf\(\s*'([^']+)'\s*\)\.size$/.exec(t);
  if (m !== null && ROLE.has(m[1])) { return ROLE.get(m[1]) as number; }
  m = /^typeOf\(\s*(\w+)\s*\)\.size$/.exec(t);
  if (m !== null && ALIAS.has(m[1])) { const r: string = ALIAS.get(m[1]) as string; if (ROLE.has(r)) { return ROLE.get(r) as number; } }
  return null;
}
function objField(arg: string, key: string): number | null {
  const m: RegExpExecArray | null = new RegExp('\\b' + key + '\\s*:\\s*([^,}]+)').exec(arg);
  return m !== null ? numExpr(m[1]) : null;
}

// ── 判据本体（纯函数，mutation 复用）─────────────────────────────────────────
interface PadHit { key: string; line: number; est: number; }
/** 可点 `Text` 的估算视觉高（fontSize×1.35 + 竖直 padding）；任一解析不出 ⇒ 返回已解析部分（缺省 fontSize=15）。 */
function textVisual(parts: string[][]): { est: number; fsResolved: boolean } {
  let fsV: number | null = null; let padV: number | null = null;
  for (let i = 0; i < parts.length; i++) {
    const call: string = parts[i][0]; const arg: string = parts[i][1];
    if (call === 'fontSize') { const v: number | null = numExpr(arg); if (v !== null) { fsV = v; } }
    else if (call === 'padding') {
      const a: string = arg.trim();
      if (a.charAt(0) === '{') {
        const t: number | null = objField(arg, 'top'); const b: number | null = objField(arg, 'bottom');
        if (t !== null && b !== null) { padV = t + b; } else { padV = 0; }
      } else { const v: number | null = numExpr(arg); if (v !== null) { padV = v * 2; } }
    }
  }
  const est: number = (fsV === null ? 15 : fsV) * 1.35 + (padV === null ? 0 : padV);
  return { est, fsResolved: fsV !== null };
}
/** 硬的 A 类命中：可点 `Text`、无显式高/无 `HIT_TARGET_MIN`、估算 < MIN。 */
function padHits(srcByRel: Map<string, string>): PadHit[] {
  const out: PadHit[] = [];
  srcByRel.forEach((raw: string, r: string): void => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      if (m[1] === 'Text') {
        const j: number = src.indexOf('(', m.index);
        const k: number = matchPair(src, j, '(', ')');
        if (k > 0) {
          const ch: Chain = chainAfter(src, k + 1);
          if (CLICK.test(ch.text) && ch.text.indexOf('HIT_TARGET_MIN') < 0) {
            let explicit: boolean = false;
            SIZE.lastIndex = 0; let sm: RegExpExecArray | null = SIZE.exec(ch.text);
            while (sm !== null) {
              const nums: RegExpMatchArray | null = sm[2].match(/(?<![\w.])\d+(\.\d+)?/g);
              if (nums !== null && (sm[1] === 'height' || sm[1] === 'constraintSize')) { explicit = true; }
              sm = SIZE.exec(ch.text);
            }
            if (!explicit) {
              const v: { est: number; fsResolved: boolean } = textVisual(ch.parts);
              if (v.est < MIN) {
                const line: number = src.slice(0, m.index).split('\n').length;
                out.push({ key: `${r} :: Text`, line, est: Math.round(v.est) });
              }
            }
          }
        }
      }
      m = rx.exec(src);
    }
  });
  return out.sort((a: PadHit, b: PadHit): number => a.key.localeCompare(b.key) || a.line - b.line);
}
/** 待人工/真机核实：可点**非 Text 容器**、靠 padding、无显式高（高度由子节点决定 ⇒ 静态判不了）。 */
function containerCandidates(srcByRel: Map<string, string>): PadHit[] {
  const out: PadHit[] = [];
  srcByRel.forEach((raw: string, r: string): void => {
    const src: string = stripComments(raw);
    const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null = rx.exec(src);
    while (m !== null) {
      if (m[1] !== 'Text' && m[1] !== 'SymbolGlyph') {
        const j: number = src.indexOf('(', m.index);
        const k: number = matchPair(src, j, '(', ')');
        if (k > 0) {
          const ch: Chain = chainAfter(src, k + 1);
          if (CLICK.test(ch.text) && ch.text.indexOf('HIT_TARGET_MIN') < 0 && ch.text.indexOf('padding(') >= 0) {
            let explicit: boolean = false;
            SIZE.lastIndex = 0; let sm: RegExpExecArray | null = SIZE.exec(ch.text);
            while (sm !== null) {
              const nums: RegExpMatchArray | null = sm[2].match(/(?<![\w.])\d+(\.\d+)?/g);
              if (nums !== null && (sm[1] === 'height' || sm[1] === 'constraintSize')) { explicit = true; }
              sm = SIZE.exec(ch.text);
            }
            if (!explicit) {
              const line: number = src.slice(0, m.index).split('\n').length;
              out.push({ key: `${r} :: ${m[1]}`, line, est: 0 });
            }
          }
        }
      }
      m = rx.exec(src);
    }
  });
  return out.sort((a: PadHit, b: PadHit): number => a.key.localeCompare(b.key) || a.line - b.line);
}

// ── 装载（components/** 为判据域；pages/** 归 main agent，不在本判据内）──────────
const files: string[] = [];
{
  const walk = (dir: string): void => {
    const ents: string[] = fsMod.readdirSync(dir);
    for (let i = 0; i < ents.length; i++) {
      const p: string = pathMod.join(dir, ents[i]);
      if (fsMod.statSync(p).isDirectory()) { walk(p); } else if (ents[i].endsWith('.ets')) { files.push(p); }
    }
  };
  walk(pathMod.join(etsRoot, 'components'));
}
const srcByRel: Map<string, string> = new Map<string, string>();
for (let i = 0; i < files.length; i++) { srcByRel.set(pathMod.relative(etsRoot, files[i]), fsMod.readFileSync(files[i], 'utf-8')); }

// ── 台账（**只许缩短**；2026-10-12 目标⑤：57 → 5）────────────────────────────────
//  本波已修 52 处（14 文件，加 `.constraintSize({ minHeight: HIT_TARGET_MIN })`）。
//  余 5 处**登记待批**（观感风险 / 越界）：
//   · `MarkdownView.ets :: Text` ×1 —— ⛔ 该文件归别人域（本波禁碰）。
//   · `SettingsLlm.ets :: Text` ×4 —— 工具栏「刷新模型/导出/导入/新增订阅」：与 `height(34)` 的
//     TextInput **同一行**；若长到 44 会**高过输入框**（明显改变工具栏视觉密度）⇒ 待批。
const PAD_CEILING: number = 5;
const PAD_LEDGER: string[] = [
  'components/MarkdownView.ets :: Text',
  'components/SettingsLlm.ets :: Text',
  'components/SettingsLlm.ets :: Text',
  'components/SettingsLlm.ets :: Text',
  'components/SettingsLlm.ets :: Text',
];

// ── §A 扫描器自证 ──────────────────────────────────────────────────────────────
console.log('\n▶ §A 扫描器自证');
let clickableText: number = 0;
let unresolvedFs: number = 0;
srcByRel.forEach((raw: string): void => {
  const src: string = stripComments(raw);
  const rx: RegExp = /\b([A-Z][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null = rx.exec(src);
  while (m !== null) {
    if (m[1] === 'Text') {
      const j: number = src.indexOf('(', m.index);
      const k: number = matchPair(src, j, '(', ')');
      if (k > 0) {
        const ch: Chain = chainAfter(src, k + 1);
        if (CLICK.test(ch.text)) {
          clickableText += 1;
          let hasFs: boolean = false;
          for (let i = 0; i < ch.parts.length; i++) { if (ch.parts[i][0] === 'fontSize' && numExpr(ch.parts[i][1]) !== null) { hasFs = true; } }
          if (!hasFs) { unresolvedFs += 1; }
        }
      }
    }
    m = rx.exec(src);
  }
});
console.log(`  阈值真源：core/design.ets \`HIT_TARGET_MIN = ${MIN}\`（出处注释：Apple HIG ≥44pt）`);
console.log(`  扫到 .ets：${srcByRel.size}（components/**）`);
console.log(`  可点 \`Text\`：${clickableText}（其中 fontSize 解析不出 = ${unresolvedFs}，已按缺省 15 保守估算）`);
ok('零扫描判红：扫描到文件数 > 0', srcByRel.size > 0);
ok('零扫描判红：可点 `Text` 数 > 0', clickableText > 0);
ok('阈值真源可读（`HIT_TARGET_MIN` 解析成功）', MIN > 0);
ok(`⚠️ 门槛不许被下调：HIT_TARGET_MIN(${MIN}) ≥ Apple HIG 地板 ${HIG_FLOOR}`, MIN >= HIG_FLOOR);
ok('真源常量解析有效（SP_2/FS_CAPTION 已解析）', (NUM.get('SP_2') as number) === 8 && (NUM.get('FS_CAPTION') as number) === 12);

// ── §B A 类命中：padding 撑高的可点 `Text`（视觉 < 阈值、无显式高、无 HIT_TARGET_MIN）──
console.log('\n▶ §B A 类命中：可点 `Text` 视觉高 < 阈值（fontSize×1.35 + 竖直 padding）');
const hits: PadHit[] = padHits(srcByRel);
hits.forEach((h: PadHit): void => { console.log(`  ${pad(h.key, 44)} :${h.line}  est≈${h.est}`); });
ok(`命中数 == 台账数（实测 ${hits.length} / 登记 ${PAD_LEDGER.length}）`, hits.length === PAD_LEDGER.length);
ok('命中集与台账集一一对应（同一多重集）', ((): boolean => {
  const a: string = hits.map((h: PadHit): string => h.key).sort().join('|');
  const b: string = PAD_LEDGER.slice().sort().join('|');
  return a === b;
})());
ok(`⚠️ 台账只许缩短：登记数(${PAD_LEDGER.length}) ≤ 本波基线 ceiling(${PAD_CEILING})`, PAD_LEDGER.length <= PAD_CEILING);

// ── §C 待人工/真机核实（**不判红**）：可点非 Text 容器靠 padding（高度由子节点决定）──
console.log('\n▶ §C 待人工/真机核实（不判红）：可点非 Text 容器靠 padding、无显式高');
const conts: PadHit[] = containerCandidates(srcByRel);
conts.forEach((h: PadHit): void => { console.log(`  ⚠️ ${pad(h.key, 44)} :${h.line}`); });
console.log(`  （共 ${conts.length} 处；容器高度由子节点决定 ⇒ 静态判不了 ⇒ 只登记，需真机/人工核）`);

// ── §D mutation 自证 ──────────────────────────────────────────────────────────
console.log('\n▶ §D mutation 自证');
{
  const inj: Map<string, string> = new Map<string, string>();
  srcByRel.forEach((v: string, k: string): void => { inj.set(k, v); });
  const target: string = 'components/QueueSheet.ets';
  const s0: string = inj.get(target) as string;
  ok('mutation 前置：目标文件当前 0 命中（本波已修）', padHits(new Map<string, string>([[target, s0]])).length === 0);
  // 注入"只靠 padding 撑高的小 Text 按钮"（视觉 ≈ 12×1.35 + 4 = 20 < 44）
  inj.set(target, s0 + '\n// mutation\nText("m").fontSize(FS_CAPTION).padding({ top: 2, bottom: 2 }).onClick(() => {});\n');
  ok('mutation：注入小 Text 按钮 ⇒ 出现新命中（必红）', padHits(inj).length > PAD_LEDGER.length);
  inj.set(target, s0);
  ok('mutation 还原 ⇒ 恢复绿', padHits(inj).length === PAD_LEDGER.length);
}
ok('真实源码判绿（防"判据恒红"）', padHits(srcByRel).length === PAD_LEDGER.length);

// ── 摘要 ───────────────────────────────────────────────────────────────────────
console.log('\n▼ 摘要');
console.log(`  A 类（可点 Text 靠 padding 撑高 < 44）命中 ${hits.length} / 台账 ${PAD_LEDGER.length}（ceiling ${PAD_CEILING}）`);
console.log(`  待人工核实（可点非 Text 容器）${conts.length}；可点 Text 总数 ${clickableText}；阈值 HIT_TARGET_MIN = ${MIN}`);
if (fail > 0) { console.log(`\n  hit_target_pad: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  hit_target_pad: ${pass} passed, 0 failed`);
process.exit(0);

export {};

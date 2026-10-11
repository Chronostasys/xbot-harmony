/**
 * `Settings*.ets` 「URL / 不可断长串」溢出判据（2026-10-11 用户报缺陷）。
 *
 * 背景：用户报「**不要让字超过屏幕范围**」⇒ 定位到 `SettingsChannels.ets:457 Text(this.publicUrlText)`
 * 与 `:567 Text(this.bindUrl)`：**URL 无空格断点**，只 `.width('100%')` ⇒ 长 URL **顶出屏**。
 *   ⇒ 修法 `.wordBreak(BREAK_ALL)`（URL 无断点 ⇒ 必须 BREAK_ALL）。
 *
 * 判据：**URL/路径语义的可变文本**（变量名含 url/Url/path/endpoint/link）在 `Settings*.ets` 里
 *   必须带 `.wordBreak(BREAK_ALL)` **或** `maxLines(k) + textOverflow(...)` 二者之一。
 * ⚠️ 与 `contrast-ux` 的全局 `horizontal_overflow_gate` **不同文件、不同命名**（避免撞车）。
 * ⚠️ 先自证扫描器 + 逐处分布 + 零扫描判红（本波血教训：形态写错 ⇒ 假 0/假绿）。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean; readdirSync(p: string, o: { withFileTypes: boolean }): { name: string }[] };
declare function require(m: 'path'): { join(...parts: string[]): string; basename(p: string): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function findRoot(start: string): string {
  let cur: string = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = path.join(cur, '..');
  }
  return '';
}
const ROOT: string = findRoot(__dirname);
const COMP: string = path.join(ROOT, 'entry', 'src', 'main', 'ets', 'components');
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const FILES: string[] = [];
if (fs.existsSync(COMP)) {
  const es = fs.readdirSync(COMP, { withFileTypes: true }) as unknown as { name: string }[];
  for (let i = 0; i < es.length; i++) {
    if (es[i].name.indexOf('Settings') === 0 && es[i].name.endsWith('.ets')) { FILES.push(path.join(COMP, es[i].name)); }
  }
}

/** 形态穷举（每个形态都要有命中，否则判据本身就是坏的）。 */
const FORMS: string[][] = [
  ['URL 语义变量', 'url|Url|URL'],
  ['路径语义变量', 'path|Path|endpoint|Endpoint'],
  ['可断行写法 wordBreak', 'wordBreak'],
  ['截断写法 textOverflow', 'textOverflow'],
];

eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
eq('零扫描防线：扫到 ≥10 个 Settings*.ets', FILES.length >= 10, true);

let allSrc: string = '';
for (let i = 0; i < FILES.length; i++) { allSrc += stripComments(fs.readFileSync(FILES[i], 'utf-8')) + '\n'; }
console.log(`  ── 自证：扫描 ${FILES.length} 个 Settings*.ets；逐形态命中 ──`);
{
  let zero = 0;
  for (let i = 0; i < FORMS.length; i++) {
    const c = (allSrc.match(new RegExp(FORMS[i][1], 'g')) || []).length;
    console.log(`    ${FORMS[i][0].padEnd(22)} × ${c}`);
    if (c === 0) { zero++; }
  }
  eq('任一形态 0 命中 ⇒ 红（防形态写错）', zero, 0);
}

// ── 判定：URL 语义的 Text 站点必须带 wordBreak 或 (maxLines + textOverflow) ──────
{
  const bad: string[] = [];
  let sites = 0;
  for (let i = 0; i < FILES.length; i++) {
    const bn = path.basename(FILES[i]);
    const ls = stripComments(fs.readFileSync(FILES[i], 'utf-8')).split('\n');
    for (let li = 0; li < ls.length; li++) {
      // `Text(<含 url/path 语义的表达式>)`
      // ⚠️ 判别式必须排除两类假阳性（首版实测踩到，正是"判据≠信号"）：
      //   ① `valueFromText(` 里的 `Text(` 子串 ⇒ 要求 `Text(` 前**不是字母**；
      //   ② 静态文案（`Text('…URL…')`）⇒ 只认**非引号开头**的表达式（即变量/方法调用）。
      const m = ls[li].match(/(?<![A-Za-z])Text\(([^)]*)\)/);
      if (m === null) { continue; }
      const arg = m[1].trim();
      if (arg.charAt(0) === "'" || arg.charAt(0) === '"') { continue; }
      if (!/url|Url|URL|path|Path|endpoint|Endpoint/.test(arg)) { continue; }
      sites++;
      // 往后 10 行内找 wordBreak 或 textOverflow（链式属性分行写）
      let guarded = false;
      for (let k = li; k < Math.min(li + 10, ls.length); k++) {
        // ⚠️ 必须容纳**限定名** `WordBreak.BREAK_ALL`（2026-10-11：我首版写成裸 `BREAK_ALL`
        //     => 整树 assembleHap BUILD FAILED（Cannot find name 'BREAK_ALL'）。ArkTS 里该枚举
        //     需 `WordBreak.` 前缀；判据同时接受两种写法，但**推荐限定名**。）
        if (/wordBreak\s*\(/.test(ls[k]) || ls[k].indexOf('textOverflow(') >= 0) { guarded = true; break; }
      }
      if (!guarded) { bad.push(`${bn}:${li + 1}  ${ls[li].trim()}`); }
    }
  }
  console.log(`    URL/路径语义 Text 站点 ${sites} 处`);
  if (bad.length > 0) {
    console.log('  ✗ URL/路径语义 Text 缺 wordBreak / textOverflow（会顶出屏）：');
    for (let i = 0; i < bad.length; i++) { console.log(`      ${bad[i]}`); }
  }
  eq('URL/路径语义 Text 必须 wordBreak(BREAK_ALL) 或 maxLines+textOverflow', bad.length, 0);
  eq('零扫描防线：URL/路径语义站点 ≥2（首版实测基线；为 0 ⇒ 判别式失效 ⇒ 红）', sites >= 2, true);
}

// ── 回归钉：本次修复的两处必须就在位（防回退）──────────────────────────────────
{
  const ch = stripComments(fs.readFileSync(path.join(COMP, 'SettingsChannels.ets'), 'utf-8'));
  // ⛔ 回归钉用「可选限定名」模式：`wordBreak( [WordBreak.] BREAK_ALL )` —— 容纳 `WordBreak.BREAK_ALL`
  //   （**推荐写法**，ArkTS 必须带前缀）与裸 `BREAK_ALL`（会编译失败，但判据不因它而红到误导）。
  const BREAK = /wordBreak\s*\(\s*(WordBreak\.)?BREAK_ALL\s*\)/;
  eq('SettingsChannels 的 publicUrlText 已 BREAK_ALL（限定名 WordBreak.BREAK_ALL 为准）', /Text\(this\.publicUrlText\)[\s\S]{0,260}?/.test(ch) && BREAK.test(ch), true);
  eq('SettingsChannels 的 bindUrl 已 BREAK_ALL（同上）', BREAK.test(ch), true);
}

// ── H1 残留风险钉死（2026-10-11）：共享组件 SettingsDevStatLine 的 value 侧必须有宽度上限 ──
// 背景：value 是该 Row 内**唯一可变长元素**（label 为短固定文案、中间是 Blank）；此前只有
// maxLines+textOverflow、**无宽度上限** ⇒ Blank 被压到 0 后极长值仍可顶宽。
// ★ mutation 必红：抽掉 .constraintSize / .layoutWeight / 裸 maxWidth ⇒ 本组红。
{
  const dev = stripComments(fs.readFileSync(path.join(COMP, 'SettingsDeveloper.ets'), 'utf-8'));
  const i = dev.indexOf('struct SettingsDevStatLine');
  eq('① SettingsDevStatLine 定义处被定位到', i >= 0, true);
  const seg = i >= 0 ? dev.slice(i, i + 1400) : '';
  const hasCap = /constraintSize\s*\(/.test(seg) || /layoutWeight\s*\(/.test(seg) || /maxWidth/.test(seg);
  eq('② 该 Row 内必须有一个元素带宽度上限（constraintSize / layoutWeight / maxWidth）', hasCap, true);
  eq('③ value 侧必须仍保留省略（maxLines + textOverflow）', /maxLines\(1\)/.test(seg) && /textOverflow\s*\(/.test(seg), true);
  // 零扫描防线：段过短 ⇒ 定位失效 ⇒ 红
  eq('④ 零扫描防线：抽出的段长 > 300（否则定位失效）', seg.length > 300, true);
}

if (fail > 0) { console.log(`  ✗ settings_url_overflow: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ settings_url_overflow: ${pass} passed, 0 failed（${FILES.length} 个 Settings*.ets）`);
process.exit(0);

/**
 * **我域组件的溢出防线**（用户亲报"字超出屏幕"专项）—— 每个 `Text(...)` 都得有"兜底不溢出"的一手。
 *
 * 背景（`tokens-ux` 找到、用户亲报的截图）：深色下一条 Markdown 回答里 ① 正文尾部被裁 ② 代码块末行被裁
 *   ③ 底部状态行被裁 ⇒ 同源：**固有宽度 > 屏宽且容器不限宽/不裁剪**。本判据把**我域**那 5 个组件钉住：
 *   `SplashOverlay` / `Fallback` / `Lightbox` / `AuthImage` / `Toast`。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────────
 *   每个 `Text(...)` 的**属性链**必须至少命中**一手**"不溢出"兜底（四选一）：
 *     a) `maxLines(` **且** `textOverflow(`（截断——⚠️ 会删信息，仅当该处可接受）
 *     b) `wordBreak(`（换行——**保信息**，长不可断串用这个）
 *     c) `constraintSize({ maxWidth` / `maxWidth(`（限宽）
 *     d) 文本是**短字面量**（≤ 8 字，无插值）⇒ 天然不会溢出
 *   ⛔ 一条都没有 ⇒ 红。
 *
 * ⚠️ 本判据**不判**"字号/是否该截断"（那是设计的事）；只判"**有没有**兜底"。
 * ⛔ 纪律：**剥注释**（注释里提到 `textOverflow(` 是文档）；**逐处分布打印** + **零扫描判红**；
 *   断言全部落在汇总 `if (fail > 0)` **之外**（本仓 GOTCHA：写在汇总后 = **死区**）。
 * mutation：把任一 `Text` 的 `wordBreak`/`maxLines`+`textOverflow` 去掉 ⇒ 必红。
 *
 * ⚠️ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名（本仓已入库 GOTCHA）。
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
    } else { out += c; i++; }
  }
  return out;
}
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components'))) { return p; }
  }
  return '';
}
function lineAt(src: string, idx: number): number {
  let n = 1;
  for (let k = 0; k < idx && k < src.length; k++) { if (src.charAt(k) === '\n') { n++; } }
  return n;
}

/** **我域**的 5 个组件（⛔ 别扩到 chat-surface-ux / tokens-ux 的组件，避免与他们的全局 gate 撞同一文件）。 */
const MY_FILES: string[] = [
  'components/SplashOverlay.ets',
  'components/Lightbox.ets',
  'components/AuthImage.ets',
  'components/Toast.ets',
  'pages/Fallback.ets',
  // 无人认领的两文件（2026-10-11 本轮收编：先修后纳）
  'components/AskUserSheet.ets',
  'components/SelfCheckSheet.ets',
];

const root: string = findRoot();
ok('探测到仓库根', root.length > 0);
const ETS: string = path.join(root, 'entry/src/main/ets');

let total = 0;
const violations: string[] = [];
const dist: string[] = [];
for (const rel of MY_FILES) {
  const p: string = path.join(ETS, rel);
  if (!fs.existsSync(p)) { continue; }
  const raw: string = stropRaw(p);
  const src: string = stripComments(raw);
  let n = 0;
  const re = /Text\(((?:[^()]|\([^()]*\))*)\)/g;   // ⚠️ 允许**一层嵌套括号**（`Text(this.labelOf(opt))` 原先整节点漏扫 = 判据盲区）
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    n++;
    total++;
    const arg: string = m[1];
    // 属性链 = 该 Text(...) 之后到分号/换行前的连续 `.xxx(` 段（朴素取到下一个 `Text(` 或 `;`）
    // ⛔ **(A) 链式截断**（2026-10-11 收紧）：窗口 = 从该 `Text(` 之后起，**到最近的**：
    //    ① 下一个 `Text(` / `SymbolGlyph(`（节点边界）② 或链尾（首个"非 `.` 起始"的非空、非注释行）。
    //    旧实现取**固定 700 字符** ⇒ 会**吃到下一个节点的兜底** ⇒ 假绿（我上轮自报的弱点）。
    const after0: number = m.index + m[0].length;
    const nText: number = src.indexOf('Text(', after0);
    const nSym: number = src.indexOf('SymbolGlyph(', after0);
    let limit: number = src.length;
    if (nText >= 0) { limit = Math.min(limit, nText); }
    if (nSym >= 0) { limit = Math.min(limit, nSym); }
    const tailLines: string[] = src.substring(after0, limit).split('\n');
    let acc: number = after0;
    for (let li: number = 0; li < tailLines.length; li++) {
      const body: string = tailLines[li].split('//')[0].trim();
      if (body.length === 0) { acc += tailLines[li].length + 1; continue; }   // 空行/纯注释行 ⇒ 链继续
      if (body.charAt(0) === '.') { acc += tailLines[li].length + 1; continue; }  // 链元素
      break;                                                                 // 边界：链到此为止
    }
    const after: string = src.substring(m.index, Math.min(acc, limit));
    const hasMaxLines: boolean = /\.maxLines\(/.test(after);
    const hasOverflow: boolean = /\.textOverflow\(/.test(after);
    const hasWordBreak: boolean = /\.wordBreak\(/.test(after);
    const hasMaxW: boolean = /constraintSize\(\s*\{\s*maxWidth/.test(after) || /\.maxWidth\(/.test(after)
      ;   // ⛔ 2026-10-11 收紧：**不再接受 `width('100%')`** —— 它只把**盒宽**锁到父级，
          //    长不可断串照样**溢出盒外**（主 agent 与我一致：不解决文本溢出）⇒ 必须用 `wordBreak`。
    // d) 短字面量（≤8 字、无插值）
    const isShortLit: boolean = /^'[^'${}]{1,8}'$/.test(arg.trim()) || /^"[^"${}]{1,8}"$/.test(arg.trim());
    const covered: boolean = (hasMaxLines && hasOverflow) || hasWordBreak || hasMaxW || isShortLit;
    if (!covered) { violations.push(`${rel}:${lineAt(src, m.index)}`); }
    console.log(`    · ${rel}:${lineAt(src, m.index)} 窗口 [${m.index}..${Math.min(acc, limit)}] ${covered ? 'OK' : '缺兜底'}`);
    m = re.exec(src);
  }
  dist.push(`${rel}: Text ×${n}`);
}
function stropRaw(p: string): string { return fs.readFileSync(p, 'utf8').replace(/i18nT\(([^()]*)\)/g, '$1'); }

console.log('▶ 溢出防线扫描（我域 5 文件）：');
for (const d of dist) { console.log(`    · ${d}`); }
ok('零扫描判红：扫到 Text 节点 > 0', total > 0);
if (violations.length === 0) {
  ok('每个 `Text(...)` 都有"不溢出"兜底（maxLines+textOverflow / wordBreak / maxWidth / width(100%) / 短字面量）', true);
} else {
  for (const v of violations) {
    ok(`无溢出兜底：${v} —— 补 \`wordBreak(BREAK_ALL)\`（保信息）或 \`constraintSize({maxWidth})\``, false);
  }
}

if (fail > 0) { console.log(`  overflow_guard: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  overflow_guard: ${pass} passed, 0 failed`);
process.exit(0);

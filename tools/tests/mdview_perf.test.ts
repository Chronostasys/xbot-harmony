/**
 * Markdown 渲染面的**功能 + 性能**门禁（P0/P1）—— 由实测基线反向钉死。
 *
 * 覆盖（每条都能真红）：
 *  P0#1 链接可点击：`linksOf()` 产出可点击目标（纯函数）
 *  P0#2 代码"不换行"不丢数据：溢出策略 + 解析输入完整 + 组件不再 Clip
 *  P0#3 代码高亮接 Prism4j：`highlightCode` 降级不丢内容 + token 色对比度护栏
 *  P1#4 按块增量复用：流式"喂入解析器字符量 / 文档长度 ≤ 1.2"（基线 3.39）+ 重复渲染命中率
 *  P1#5 行内样式记忆化：第二次 build 不再重算（compute 只跑一次）
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { parseMarkdown, parseMarkdownCached, resetMdCache, mdCacheStats, MdBlockKind } from '../../entry/src/main/ets/core/markdown';
import {
  linksOf, codeOverflow, MdOverflow, codeTokenColor, codeRoleColor, CODE_TOKEN_MIN_RATIO,
  MdInlineMemo, MdInlineStyle, mdInlineKey,
} from '../../entry/src/main/ets/core/mdview';
import { paletteOf, contrastRatio, isLightPalette } from '../../entry/src/main/ets/core/theme';
import { wellOf } from '../../entry/src/main/ets/core/design';
import { highlightCode } from '../../entry/src/main/ets/core/highlight';

/**
 * **剥注释**（本仓约定：注释里记代码片段/色值是**允许且鼓励**的 ⇒ 判据扫源码前**必须**先剥，
 * 否则两个方向都错：禁串被注释提及 ⇒ **假红**；要求串只在注释里出现 ⇒ **假绿**）。
 * ⚠️ 保留换行（不压行）⇒ 行号不漂移（本仓已入库 GOTCHA）。
 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function has(src: string, needle: string, name: string): void { ok(name, src.indexOf(needle) >= 0); }
function hasNot(src: string, needle: string, name: string): void { ok(name, src.indexOf(needle) < 0); }

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const mdSrc: string = stripSrc(fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'MarkdownView.ets'), 'utf-8'));

// ══════════════════════════════════════════════════════════════════════════════
// P0#1 链接可点击
// ══════════════════════════════════════════════════════════════════════════════
const ls = linksOf('见 [文档](https://x.com/a/b) 与 [相对](/api/f) 以及 **粗体**');
eq('linksOf 抽出 2 个链接', ls.length, 2);
eq('链接显示文本', ls[0].text, '文档');
eq('链接可点击目标 = href', ls[0].href, 'https://x.com/a/b');
eq('相对链接同样抽出 href', ls[1].href, '/api/f');
// 纯文本不出链接
eq('纯文本无链接', linksOf('没有链接的句子').length, 0);
// 组件形态：链接 span 必须挂 onClick 且有打开逻辑
has(mdSrc, '.onClick(() => {', '组件里存在 onClick（链接点击）');
has(mdSrc, 'this.openLink(s.link)', '链接 span 点击调用 openLink');
has(mdSrc, 'resolveOpenable(href, this.linkBase)', '打开链接走协议白名单 resolveOpenable');
has(mdSrc, "action: 'ohos.want.action.viewData'", '打开手段 = 系统 viewData（对齐 web <a target=_blank>）');

// ══════════════════════════════════════════════════════════════════════════════
// P0#2 代码"不换行"不丢数据
// ══════════════════════════════════════════════════════════════════════════════
eq('wrapCode=true ⇒ Wrap', codeOverflow(true), MdOverflow.Wrap);
eq('wrapCode=false ⇒ Scroll（横向滚动，不再裁剪）', codeOverflow(false), MdOverflow.Scroll);
// 长行内容必须**完整**进入渲染输入（解析器不截断）
const longLine = 'const u = "' + 'a'.repeat(500) + '";';
const codeDoc = '```ts\n' + longLine + '\n```';
const cb = parseMarkdown(codeDoc);
eq('围栏解析为 Code 块', cb[0].kind, MdBlockKind.Code);
ok('长行**完整**保留（无截断）', cb[0].code === longLine);
ok('长行长度 >= 500', cb[0].code.length >= 500);
// 组件形态：不换行分支是横向 Scroll；且**不再**用 maxLines+Clip 静默裁切
has(mdSrc, '.scrollable(ScrollDirection.Horizontal)', '不换行分支 = 横向 Scroll');
hasNot(mdSrc, '.textOverflow({ overflow: TextOverflow.Clip })', '⛔ 旧的 textOverflow Clip 静默裁切已移除（回退即红）');
hasNot(mdSrc, '.maxLines(1000)', '⛔ 旧的 maxLines(1000) 已移除（回退即红）');

// ══════════════════════════════════════════════════════════════════════════════
// P0#3 代码高亮接 Prism4j（降级不丢内容 + token 色对比度护栏）
// ══════════════════════════════════════════════════════════════════════════════
// 脱机环境 Prism4j 为 stub（grammar 恒 null）⇒ 覆盖**降级路径**：必须原样返回整段，零丢失。
function rejoin(code: string, lang: string): string {
  const sp = highlightCode(code, lang);
  let s = '';
  for (let i = 0; i < sp.length; i++) { s += sp[i].text; }
  return s;
}
const snippet = 'export function f(x: number): number {\n  return x + 1;\n}';
eq('高亮降级：内容零丢失（shell/ts 片段）', rejoin(snippet, 'ts'), snippet);
eq('高亮降级：unknown 语言零丢失', rejoin('a\nb', 'notalang'), 'a\nb');
// token 色护栏：要么是语义角色色且对**代码块真实底**（`#13`：`surface.well`）达标，
// 要么退回**同族 palette 前景** `pal.textPrimary`（绝不出现读不出的颜色）。
const themes = ['vscode-dark', 'github-light', 'solarized-light', 'dracula'];
const pals = ['dark', 'light', 'porcelain', 'aurora'];
const keys = ['comment', 'string', 'keyword', 'number', 'func', 'prop', 'type', 'tag', 'op', 'punct', 'diff-add', 'diff-del', ''];
let guardBad = 0;
for (let ti = 0; ti < themes.length; ti++) {
  for (let pi = 0; pi < pals.length; pi++) {
    const pal = paletteOf(pals[pi]);
    const bg = wellOf(pal);              // ← `#13`：代码块底 = surface.well（不再随 md 主题）
    const base = pal.textPrimary;        // ← `#13`：回退色 = palette 同族前景
    for (let ki = 0; ki < keys.length; ki++) {
      const c = codeTokenColor(keys[ki], pal, themes[ti]);
      const isBase = c === base;
      const okRatio = contrastRatio(c, bg) >= CODE_TOKEN_MIN_RATIO;
      if (!isBase && !okRatio) { guardBad++; }
    }
  }
}
eq('所有 token×主题 组合都满足"语义色达标 或 退回默认前景"', guardBad, 0);
// 空 key 必须退默认前景（`#13`：底是 palette ⇒ 回退也是 palette）
eq('空 key ⇒ 默认前景', codeTokenColor('', paletteOf('dark'), 'vscode-dark'), paletteOf('dark').textPrimary);
// 组件形态：确实接了高亮引擎 + 用 mdview 的 token 色
has(mdSrc, 'highlightCode(b.code, b.lang)', '代码块接了 core/highlight（Prism4j）');
has(mdSrc, 'codeTokenColor(sp.key, this.pal(), this.mdTheme)', 'token 色走 core/mdview.codeTokenColor');

// ══════════════════════════════════════════════════════════════════════════════
// P1#4 按块增量复用：喂入解析器字符量 / 文档长度 ≤ 1.2（基线 3.39）
// ══════════════════════════════════════════════════════════════════════════════
function buildDoc(target: number): string {
  const parts: string[] = [];
  let n = 0, i = 0;
  while (n < target) {
    i++;
    const seg = [
      `## 第 ${i} 节`, '',
      `正文 **粗** \`code\` [链接](https://e.com/${i})，${'x'.repeat(60)}`, '',
      '- 项一', '- 项二', '', '```ts', `const v${i} = ${i};`, '```', '',
      '> 引用一行', '', '| a | b |', '| --- | --- |', `| ${i} | v |`, '',
    ].join('\n');
    parts.push(seg); n += seg.length;
  }
  return parts.join('\n');
}
function advanceVisible(v: number, t: number, skip: boolean): number {
  if (v >= t) { return t; }
  const gap = t - v, adv = Math.max(1, Math.floor(gap / 3));
  if (skip && adv <= 3 && gap <= 20) { return v; }
  return v + adv > t ? t : v + adv;
}
function stream(doc: string): void {
  let received = 0, vis = 0, skip = false, tick = 0, lastVis = -1;
  for (let t = 0; t < 500000; t++) {
    if (received < doc.length) { received = Math.min(doc.length, received + 80); } else { vis = received; }
    skip = !skip;
    if (vis < received) {
      const next = advanceVisible(vis, received, skip);
      tick++;
      const renderEvery = Math.max(1, Math.ceil(received / 300));
      if (tick >= renderEvery || next >= received) { tick = 0; vis = next; }
    }
    if (vis > 0 && vis !== lastVis) { lastVis = vis; parseMarkdownCached(doc.slice(0, vis)); }
    if (vis >= doc.length && received >= doc.length) { break; }
  }
}
const doc = buildDoc(96 * 1024);
resetMdCache();
stream(doc);
let st = mdCacheStats();
// 文档可能被 buildDoc 略微超出目标；以**实际文档长度**为准
ok(`流式喂入字符量 / 文档长度 = ${(st.parseChars / doc.length).toFixed(2)} ≤ 1.2`, st.parseChars / doc.length <= 1.2);
ok(`流式喂入字符量(${st.parseChars}) < 文档长度×1.2(${Math.ceil(doc.length * 1.2)})`, st.parseChars < doc.length * 1.2);

// 重复渲染**同一文档**必须高命中（防"重构把缓存拆了"）
resetMdCache();
const N = 20;
for (let i = 0; i < N; i++) { parseMarkdownCached(doc); }
st = mdCacheStats();
const hitRate = st.hits / (st.hits + st.misses);
ok(`同文档重复渲染命中率 = ${(hitRate * 100).toFixed(0)}% ≥ 90%`, hitRate >= 0.9);
eq('首帧 miss 恰好 1 次', st.misses, 1);

// ══════════════════════════════════════════════════════════════════════════════
// P1#5 行内样式记忆化：第二次 build 不再重算
// ══════════════════════════════════════════════════════════════════════════════
const pal = paletteOf('dark');
let computed = 0;
const memo = new MdInlineMemo();
const key = mdInlineKey('a **b** `c`', pal, 'vscode-dark', '');
const compute = (): MdInlineStyle[] => {
  computed++;
  const st0 = new MdInlineStyle();
  st0.text = 'a';
  return [st0];
};
const r1 = memo.getOrCompute(key, compute);
const r2 = memo.getOrCompute(key, compute);
const r3 = memo.getOrCompute(key, compute);
eq('同一键：compute 只跑 1 次', computed, 1);
ok('后两次返回同一实例（零重算）', r1 === r2 && r2 === r3);
const ms = memo.stats();
eq('memo misses = 1', ms.misses, 1);
eq('memo hits = 2', ms.hits, 2);
// 键必须随**主题/调色板**变化（否则换主题会命中旧色 = 陈旧）
ok('键随调色板变化', mdInlineKey('t', paletteOf('dark'), 'vscode-dark', '') !== mdInlineKey('t', paletteOf('light'), 'vscode-dark', ''));
ok('键随 md 主题变化', mdInlineKey('t', pal, 'vscode-dark', '') !== mdInlineKey('t', pal, 'github-light', ''));
ok('键随 baseColor 变化', mdInlineKey('t', pal, 'vscode-dark', '') !== mdInlineKey('t', pal, 'vscode-dark', '#fff'));
// 组件形态：确实接了这个记忆化
has(mdSrc, 'mdInlineMemo.getOrCompute(', 'inlineStyles 走记忆化容器');
has(mdSrc, 'mdInlineKey(text, pal, mdTheme, bc)', '记忆化键由 core/mdview 产出');


// ── 剥注释的**判别力自证**（防"剥注释把扫描也剥没了"这类白绿）──────────────────────
{
  ok('判别力：**注释里**的禁串被剥掉（不误红）',
    stripSrc('// .fontColor([this.pal().textMuted])').indexOf('.fontColor(') < 0);
  ok('判别力：**代码里**的同一串仍在（不误绿）',
    stripSrc('const a = 1; .fontColor([this.pal().textMuted])').indexOf('.fontColor(') >= 0);
  ok('判别力：剥注释**保留换行**（行号不漂移）',
    stripSrc('a\n// x\nb').split('\n').length === 3);
}

if (fail > 0) {
  console.log(`  mdview_perf: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  mdview_perf: ${pass} passed, 0 failed`);
process.exit(0);

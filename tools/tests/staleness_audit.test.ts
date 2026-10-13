/**
 * staleness_audit.test.ts —— 「**值只在创建时取一次、之后永不更新**」缺陷类的全仓机器判据。
 *
 * ── 为什么要有它（真实事故，2026-10-11 用户亲报）────────────────────────────────
 * 用户报「浅色主题下历史消息正文仍是白色」。根因是一个**类**、不是一个 bug：
 *   `pages/Index.ets` 用 `LazyForEach(rowDs, …)` 渲染历史行，行的主题由
 *   `ChatRowBody(row)` → `MessageRowView({ theme: this.themeName })` **投递**；
 *   而 `rowDs.applyRows()` 只按 **`id#rev`** 键发**最小变更通知** ⇒ 切主题不改任何键
 *   ⇒ **零通知 ⇒ 框架不重建已存在行** ⇒ 行的 `@Prop theme` 冻在创建那一刻的 `'dark'`。
 *   live 行在 `LazyForEach` 之外、由**无参** `@Builder` 直读页面 `@State` ⇒ 随主题重算 ⇒ 正常。
 * ⇒ 缺陷类 = 「值只在**创建时**取一次，之后永不更新」：一次性求值 / 快照投递 /
 *    缓存键漏维度 / 靠列表项重投 `@Prop`。
 *
 * ── 本判据覆盖（能**静态判**的确定式子集；对应的六类形态见 docs/ARKTS-GOTCHAS.md 批次 37）──
 *   R1「一次性求值」   : 结构体**字段初值**里算色/主题 ⇒ 构造时取一次 ⇒ 换主题不更新。（硬红）
 *   R2「键不同源」     : `@StorageProp/@StorageLink` 的字面量键**没有写入方** ⇒ 读到的恒为初值。
 *                        （`@StorageProp` 只吃字面量，靠注释锁同源 ⇒ 必须机器钉）。          （硬红）
 *   R3「缓存键漏维度」 : 记忆化缓存（行内样式 / 调色板）的键**必须含主题代表维度**，
 *                        否则换主题命中旧值（本仓正确先例 = `core/mdview.ets:147 mdInlineKey`）。（硬红）
 *   R4「全局带参 @Builder」: 文件级 `@Builder function` 带参 ⇒ 参数是"调用那刻快照"、且无 `this` 可回退。（硬红：数量必须为 0）
 *   附（**警告级**，打印不判红，供人复核）：
 *   W1 带参 `@Builder` 体里直接读 `this` 状态（快照+活值混合，需人判）；
 *   W2 `ForEach/LazyForEach` 的 item 生成器里投递 `theme:`（本轮 bug 的形态；
 *      键若不含主题维度则该项换主题不更新 —— 已在报告中逐点列明，⛔ 不硬红以免误报）；
 *   W3 静息态不透明度由状态位决定的写法（门禁⑨ 已拦 A 级，这里补 B 级与语义面）。
 *
 * ── 纪律（本仓 GOTCHA，逐条已落地）───────────────────────────────────────────────
 *   · **剥注释再判**（注释里记代码片段/色值是鼓励的 ⇒ 不剥会假红）。
 *   · 规则**只取调用/声明片段**（这里用整行正则 + 字段名捕获），⛔ 不"取整行第一个引号"。
 *   · **零扫描判红**（白绿防线）：扫到的文件数 / 条目数为 0 ⇒ 判红。
 *   · **判别力自证**（mutation 夹具）：本文件内对每个检测器做"必红样本 + 合法样本"自测。
 *   ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

const fsMod = require('fs');
const pathMod = require('path');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

/** 探测仓库根（测试从 `tools/tests/.out.$$` 运行 ⇒ 逐级上溯）。 */
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const c = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/core'))) { repo = c; break; }
}
ok('探测到仓库根', repo.length > 0);
if (repo.length === 0) {
  console.log('  staleness_audit: 0 passed, 1 failed');
  process.exit(1);
}

const ETS_ROOT: string = pathMod.join(repo, 'entry/src/main/ets');

/**
 * **剥注释**（保留换行 ⇒ 行号不漂移；`://` 不截断 URL 后半截）。
 * 与 `design.test.ts` 的 `stripSrc` 同款（本仓唯一口径）。
 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}

/** 递归收集源文件（跳过 oh_modules/node_modules/build 等）。 */
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const rec = (d: string): void => {
    let ents: any[];
    try { ents = fsMod.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p: string = pathMod.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'oh_modules' && e.name !== 'node_modules' && e.name !== 'build'
          && e.name !== '.git' && e.name !== 'oh_modules') { rec(p); }
      } else if (exts.some((x: string) => e.name.endsWith(x))) { out.push(p); }
    }
  };
  rec(dir);
  return out;
}

const ETS_ALL: string[] = walk(ETS_ROOT, ['.ets', '.ts']);
/** ArkUI 层（组件/页面/ability）—— 字段初值一次性求值的扫描面。 */
const ETS_UI: string[] = ETS_ALL.filter((f: string) =>
  f.indexOf('/components/') >= 0 || f.indexOf('/pages/') >= 0 || f.indexOf('/entryability/') >= 0);

ok(`★ 扫到 ArkTS 源文件（${ETS_ALL.length} 个；零扫描判红）`, ETS_ALL.length > 0);
ok(`★ 扫到 UI 层文件（${ETS_UI.length} 个；零扫描判红）`, ETS_UI.length > 0);

// ════════════════════════════════════════════════════════════════════════════
// R1「一次性求值」—— 结构体**字段初值**里算色/主题 ⇒ 构造时取一次、永不更新
// ════════════════════════════════════════════════════════════════════════════
//
// 合法形态（必须**不**误报）：`private pal(): Palette { return paletteOf(this.theme); }` —— 方法，
//   每次 build 调用都重算 ⇒ 安全。箭头字段（`= () => …`）同理（调用时才求值）⇒ 例外。
// 非法形态（必红）：`private pal0 = paletteOf('dark');` / `@State c: string = this.pal().textPrimary;`
//   —— 字段初值只在**构造那一次**执行 ⇒ 换主题后永久陈旧（本轮 bug 的同类）。

/** 结构体成员字段声明：2 空格缩进 + 可选装饰器/修饰符 + 无参字段名 + `=` + RHS。 */
const FIELD_DECL_RE = /^ {2}(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:private|public|protected|readonly|static)\s+)?([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.*)$/;
/** RHS 里的"一次性取色/取主题"调用（含 `this.pal()/eff()/surf()` 访问器）。 */
const COLOR_FN_RE = /\b(?:paletteOf|effectsOf|surfacesOf|colorOf|surfaceFillOf|withAccent|brandAccent|hairlineOf|wellOf|isLightPalette)\s*\(|this\.(?:pal|eff|surf)\(\)/;

/** 返回某文件里"字段初值一次性取色"的命中行。 */
function fieldInitColorHits(src: string): number[] {
  const hits: number[] = [];
  const lines: string[] = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line: string = lines[i];
    if (line.trim().length === 0) { continue; }
    const m = FIELD_DECL_RE.exec(line);
    if (m === null) { continue; }
    const rhs: string = m[2];
    if (rhs.indexOf('=>') >= 0 || rhs.trimStart().startsWith('(')) { continue; }   // 箭头/函数 ⇒ 调用时才求值
    if (COLOR_FN_RE.test(rhs)) { hits.push(i + 1); }
  }
  return hits;
}

// ── 判别力自证（夹具；自身即 mutation 证明）──────────────────────────────────
{
  const bad1: string = "  private pal0 = paletteOf('dark');";
  const bad2: string = '  @State c: string = this.pal().textPrimary;';
  const bad3: string = '  private eff0: Effects = effectsOf(this.pal());';
  const good1: string = '  private pal(): Palette {';
  const good2: string = '  @Prop theme: string = \'dark\';';
  const good3: string = '  private palFn = (): Palette => paletteOf(this.theme);';
  ok('R1 自证：字段初值 paletteOf ⇒ 命中', fieldInitColorHits(bad1).length === 1);
  ok('R1 自证：字段初值 this.pal() ⇒ 命中', fieldInitColorHits(bad2).length === 1);
  ok('R1 自证：字段初值 effectsOf(...) ⇒ 命中', fieldInitColorHits(bad3).length === 1);
  ok('R1 自证：pal() **方法**声明 ⇒ 不命中（合法）', fieldInitColorHits(good1).length === 0);
  ok('R1 自证：@Prop 字面量 ⇒ 不命中（合法）', fieldInitColorHits(good2).length === 0);
  ok('R1 自证：箭头字段 ⇒ 不命中（调用时求值，合法）', fieldInitColorHits(good3).length === 0);
}

const r1Hits: string[] = [];
for (const f of ETS_UI) {
  const src: string = stripSrc(fsMod.readFileSync(f, 'utf-8'));
  for (const ln of fieldInitColorHits(src)) {
    r1Hits.push(`${f.slice(repo.length + 1)}:${ln}`);
  }
}
ok(`R1 结构体字段初值一次性取色 == 0（实测 ${r1Hits.length}）`
  + (r1Hits.length > 0 ? `\n      ⛔ 改为 ` + '`private pal(): Palette { return paletteOf(this.theme); }`' + ` 形态：${r1Hits.join(', ')}` : ''),
  r1Hits.length === 0);

// ════════════════════════════════════════════════════════════════════════════
// R2「键不同源」—— `@StorageProp/@StorageLink` 的字面量键必须有写入方
// ════════════════════════════════════════════════════════════════════════════
//
// `@StorageProp` 的装饰器参数**只吃字面量**（不能用导入常量）⇒ 读取端写字面量、
// 写入端写常量 ⇒ 二者靠"注释 + 单测"锁同源，极易分叉（docs/ARKTS-GOTCHAS.md 批次 33b 的
// 「死开关/死消费」同族）。本规则把"读取键 ⊄ 写入键"变成可判红。
//
// 合法台账（**只许缩短**；每条写明"为何无写入方"）：
const STORAGE_ORPHAN_ALLOW: string[] = [
  'safeTopVp',    // ⚠️ 遗留键：注释称"由 EntryAbility 写入"，实为**零写入方**（沉浸式已 `setWindowLayoutFullScreen(false)`
  //                 ⇒ 安全区交系统处理 ⇒ 恒 0 是**当前正确值**）。保留读端为未来沉浸式预留；若永不接线应删除。
  'safeBottomVp', // 同上
];

const READER_RE = /@Storage(?:Prop|Link)\(\s*'([^']+)'\s*\)/g;
// ⛔ `@StorageLink('k')` **既是读取方也是写入方**（ArkUI 双向绑定：写 `this.x` 即写 AppStorage）。
//    ⇒ 必须计入 writers —— 否则「页面用 `@StorageLink` 当唯一真源」这一**正确**修法会被判成孤儿。
//    本轮实例：`0a42528` 修「浅色历史白字」正用 `@StorageLink('appTheme')` + 行组件 `@StorageProp('appTheme')`
//    （键自动创建、3 个既有写入点经 link 写回）⇒ 旧 R2 误报 **7 个 `appTheme` 孤儿**（假红，门禁级）。
const LINK_WRITER_RE = /@StorageLink\(\s*'([^']+)'\s*\)/g;
const WRITER_LIT_RE = /AppStorage\.(?:setOrCreate|set)(?:<[^>]*>)?\(\s*'([^']+)'/g;
const WRITER_ID_RE = /AppStorage\.(?:setOrCreate|set)(?:<[^>]*>)?\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g;
function collect(re: RegExp, src: string, group: number): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(src)) !== null) { out.push(m[group]); }
  return out;
}

// 常量表：`export const NAME: string = 'literal'`（全仓，供写入端标识符解析）
const constMap: { [k: string]: string } = {};
for (const f of ETS_ALL) {
  const src: string = stripSrc(fsMod.readFileSync(f, 'utf-8'));
  let m: RegExpExecArray | null;
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*:\s*string\s*=\s*'([^']+)'/g;
  while ((m = re.exec(src)) !== null) { constMap[m[1]] = m[2]; }
}

const readers: string[] = [];
const writers: string[] = [];
for (const f of ETS_ALL) {
  const src: string = stripSrc(fsMod.readFileSync(f, 'utf-8'));
  for (const k of collect(READER_RE, src, 1)) { readers.push(k); }
  for (const k of collect(WRITER_LIT_RE, src, 1)) { writers.push(k); }
  // `@StorageLink('k')` 计入写入方（见 `LINK_WRITER_RE` 注释：双向绑定 ⇒ 写 `this.x` 即写 AppStorage）
  for (const k of collect(LINK_WRITER_RE, src, 1)) { writers.push(k); }
  for (const id of collect(WRITER_ID_RE, src, 1)) {
    if (constMap[id] !== undefined) { writers.push(constMap[id]); }
  }
}

ok(`★ R2 扫到 @StorageProp/@StorageLink 读取键（${readers.length} 个；零扫描判红）`, readers.length > 0);
ok(`★ R2 扫到 AppStorage 写入键（${writers.length} 个；零扫描判红）`, writers.length > 0);

// ── 判别力自证 ───────────────────────────────────────────────────────────────
{
  ok('R2 自证：读取键正则命中', collect(READER_RE, "  @StorageProp('foo') x: number = 0;", 1).join() === 'foo');
  ok('R2 自证：字面量写入键正则命中', collect(WRITER_LIT_RE, "AppStorage.setOrCreate('foo', 1);", 1).join() === 'foo');
  ok('R2 自证：标识符写入键正则命中', collect(WRITER_ID_RE, 'AppStorage.setOrCreate(K_X, 1);', 1).join() === 'K_X');
  ok('R2 自证：`@StorageLink` 计入写入方（双向绑定）',
    collect(LINK_WRITER_RE, "  @StorageLink('bar') y: string = '';", 1).join() === 'bar');
}

const orphans: string[] = readers.filter(
  (k: string) => writers.indexOf(k) < 0 && STORAGE_ORPHAN_ALLOW.indexOf(k) < 0);
ok(`R2 读取键都有同名写入方（实测孤儿 ${orphans.length}）`
  + (orphans.length > 0 ? `\n      ⛔ 无写入方的读取键：${orphans.join(', ')} ⇒ 它的值恒为初值（死键/自相矛盾）` : ''),
  orphans.length === 0);
// 反向：台账里的键若**已接上**写入方 ⇒ 逼收缩台账（两个方向都拦，同 orphan_core_module 的手法）
const staleAllow: string[] = STORAGE_ORPHAN_ALLOW.filter((k: string) => writers.indexOf(k) >= 0);
ok(`R2 台账只许缩短（已接线却仍留台账 ${staleAllow.length}）`,
  staleAllow.length === 0, `⛔ 请从 STORAGE_ORPHAN_ALLOW 删除：${staleAllow.join(', ')}`);

// ════════════════════════════════════════════════════════════════════════════
// R3「缓存键漏维度」—— 记忆化缓存的键必须含主题代表维度
// ════════════════════════════════════════════════════════════════════════════
//
// 本仓唯一**正确先例** = `core/mdview.ets` 的 `mdInlineKey`（把 palette 代表色 + md 主题 + baseColor
// 纳入键）。这里用**行为断言**钉住它（不钉源码形态，避免脆）：同一文本在**不同调色板 / 不同 md 主题 /
// 不同 baseColor** 下必须产出**不同键** ⇒ 换主题不会命中旧色。

import { mdInlineKey } from '../../entry/src/main/ets/core/mdview';
import { paletteOf } from '../../entry/src/main/ets/core/theme';
{
  const dark = paletteOf('dark');
  const light = paletteOf('light');
  const k0: string = mdInlineKey('hello', dark, 'md-a', '#111');
  ok('R3 自证：不同调色板 ⇒ 键不同（换主题不命中旧值）',
    mdInlineKey('hello', light, 'md-a', '#111') !== k0);
  ok('R3 自证：不同 md 主题 ⇒ 键不同',
    mdInlineKey('hello', dark, 'md-b', '#111') !== k0);
  ok('R3 自证：不同 baseColor ⇒ 键不同',
    mdInlineKey('hello', dark, 'md-a', '#222') !== k0);
  ok('R3 自证：同输入 ⇒ 键相同（缓存确实命中）',
    mdInlineKey('hello', dark, 'md-a', '#111') === k0);
}

// 调色板记忆化必须按**主题**键控（`core/toolvisual.ets` + `core/theme.ets`）。
{
  const tv: string = stripSrc(fsMod.readFileSync(pathMod.join(ETS_ROOT, 'core/toolvisual.ets'), 'utf-8'));
  ok('R3 paletteMemo 以 theme 为键', /export function paletteMemo\(theme: string\)/.test(tv)
    && /PALETTE_MEMO\.set\(theme, p\)/.test(tv));
  ok('R3 effectsMemo 以 theme 为键', /export function effectsMemo\(theme: string\)/.test(tv)
    && /EFFECTS_MEMO\.set\(theme, e\)/.test(tv));
  const th: string = stripSrc(fsMod.readFileSync(pathMod.join(ETS_ROOT, 'core/theme.ets'), 'utf-8'));
  // 缓存键 = `${name}|${accent}`：**色板名 × 强调色**两维（2026-10-13：强调色改为从**渲染标识**里取，
  // 见 `renderThemeKey`/`themeInlineAccent` —— 换主题或换强调色都不会命中旧色）。
  ok('R3 theme.ets PALETTE_MEMO 键含（色板名 × 强调色）两维',
    /const PALETTE_MEMO: Map<string, Palette>/.test(th)
    && /PALETTE_MEMO\.get\(key\)/.test(th) && /PALETTE_MEMO\.set\(key,/.test(th)
    && /\$\{name\}\$\{RENDER_SEP\}\$\{accent\}/.test(th));
}

// 警示：core/ 里所有记忆化 `Map` 缓存（供人复核"键是否漏了会影响渲染的维度"）—— 非判红。
{
  const cacheSites: string[] = [];
  for (const f of ETS_ALL) {
    if (f.indexOf('/core/') < 0) { continue; }
    const src: string = stripSrc(fsMod.readFileSync(f, 'utf-8'));
    const lines: string[] = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/\b(?:new\s+Map<|:\s*Map<)/.test(lines[i])) {
        cacheSites.push(`${pathMod.basename(f)}:${i + 1}`);
      }
    }
  }
  console.log(`  ℹ️ W-core-cache：core/ 记忆化 Map 缓存 ${cacheSites.length} 处（供复核键维度）：${cacheSites.join(', ')}`);
}

// ════════════════════════════════════════════════════════════════════════════
// R4「全局带参 @Builder」—— 文件级 `@Builder function` 带参 ⇒ 数量必须为 0
// ════════════════════════════════════════════════════════════════════════════
//
// 本仓铁律（docs/ARKTS-GOTCHAS.md §4 与批次 11/12）：带参 `@Builder` 的参数是"调用那一刻的快照"、
// 子树不随参数重建。**成员** `@Builder` 至少还能读 `this` 状态兜底；**文件级/全局** `@Builder`
// 没有 `this` ⇒ 参数即唯一数据源 ⇒ 一旦承载"会变的内容"就必然冻结。
// 本仓现状：0 个文件级 `@Builder`（全部改成真 `@Component` + `@Prop`）⇒ 把它钉成不变量。

const GLOBAL_BUILDER_RE = /(^|\n)@Builder[ \t]*\r?\n\s*function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;

function globalParamBuilders(src: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  GLOBAL_BUILDER_RE.lastIndex = 0;
  while ((m = GLOBAL_BUILDER_RE.exec(src)) !== null) {
    const params: string = m[3].replace(/\/\/[^\n]*/g, '').trim();
    if (params.length > 0) { out.push(m[2]); }
  }
  return out;
}

{
  ok('R4 自证：全局带参 @Builder ⇒ 命中',
    globalParamBuilders('@Builder\nfunction Foo(x: string) {\n  Text(x)\n}').length === 1);
  ok('R4 自证：全局**无参** @Builder ⇒ 不命中（合法：读全局/常量）',
    globalParamBuilders('@Builder\nfunction Foo() {\n  Text(\'hi\')\n}').length === 0);
  ok('R4 自证：成员 @Builder（缩进）⇒ 不命中',
    globalParamBuilders('  @Builder\n  Foo(x: string) {\n    Text(x)\n  }').length === 0);
}

const globalBad: string[] = [];
for (const f of ETS_ALL) {
  const src: string = stripSrc(fsMod.readFileSync(f, 'utf-8'));
  for (const n of globalParamBuilders(src)) {
    globalBad.push(`${f.slice(repo.length + 1)}::${n}`);
  }
}
ok(`R4 文件级带参 @Builder == 0（实测 ${globalBad.length}）`
  + (globalBad.length > 0 ? `\n      ⛔ 改用真 @Component + @Prop：${globalBad.join(', ')}` : ''),
  globalBad.length === 0);

// ════════════════════════════════════════════════════════════════════════════
// 警告级（打印，不判红）—— 需人复核的形态
// ════════════════════════════════════════════════════════════════════════════

// W1：带参 `@Builder` 体里直接读 `this` 状态（快照参数 + 活值混合；是否安全取决于调用点是否重建）。
{
  const w1: string[] = [];
  for (const f of ETS_ALL) {
    if (f.indexOf('/components/') < 0 && f.indexOf('/pages/') < 0) { continue; }
    const src: string = stripSrc(fsMod.readFileSync(f, 'utf-8'));
    const lines: string[] = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*@Builder\s*$/.test(lines[i])) { continue; }
      const sig: string = i + 1 < lines.length ? lines[i + 1] : '';
      const m = /^\s*(?:private\s+|public\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(sig);
      if (m === null || m[2].trim().length === 0) { continue; }   // 只看带参
      // 在 builder 体（粗略：其后 8~80 行）找 this 状态读取
      const body: string = lines.slice(i + 1, Math.min(lines.length, i + 90)).join('\n');
      if (/this\.(?:theme|themeName|pal\(\)|liveText|liveReasoning|liveBlocks)\b/.test(body)) {
        w1.push(`${pathMod.basename(f)}:${i + 1} ${m[1]}`);
      }
    }
  }
  console.log(`  ℹ️ W1 带参 @Builder 体里读 this 状态 ${w1.length} 处（需人判是否随调用点重建）：${w1.slice(0, 24).join(' | ')}${w1.length > 24 ? ' …' : ''}`);
}

// W2（**硬红**）：`LazyForEach` 的 item 生成器里投递 `theme:` / `mdTheme:` —— 本轮「浅色历史白字」的形态。
//
// ⛔ 为什么「`LazyForEach` + 投递 theme:」**一投就是缺陷**（判别性成立，不是启发式）：
//    `LazyForEach` 的 item builder **只在行键变化时**执行（本仓键 = `id#rev`，`core/rowdiff.ets`），
//    而**主题不在键里**（门禁⑥ 也禁止把主题写进 key）⇒ 已存在行的 `@Prop theme` **永远冻结在创建那刻**。
//    ⇒ 这类"会变的全局量"必须走**组件级订阅**（`@StorageProp('appTheme')`），由行自己取
//      —— 正确先例 = `0a42528`（页面 `@StorageLink('appTheme')` + 行组件各自 `@StorageProp` + `themeId()` resolver）。
//    ⚠️ **`ForEach`（非懒）不在本规则内**：它的数组整体变化会重建全部条目 ⇒ 投递 `theme:` 是安全的。
//      （旧版规则把两者混判 ⇒ 只能"log 不硬红"；收窄到 `LazyForEach` 后判别性成立。）
//
// 台账 `W2_LEDGER`（**只许缩短**：条目与实测必须一一对应；接线/删除后不清台账 ⇒ 红）。
const W2_LEDGER: string[] = [];
{
  let lazySeen: number = 0;
  const w2: string[] = [];
  for (const f of ETS_ALL) {
    if (f.indexOf('/components/') < 0 && f.indexOf('/pages/') < 0) { continue; }
    const src: string = stripSrc(fsMod.readFileSync(f, 'utf-8'));
    const lines: string[] = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('LazyForEach(') < 0) { continue; }
      lazySeen++;
      const win: string = lines.slice(i, Math.min(lines.length, i + 14)).join('\n');
      if (/\b(theme|mdTheme)\s*:\s*this\./.test(win)) {
        w2.push(`${pathMod.basename(f)}:${i + 1}`);
      }
    }
  }
  ok(`W2 零扫描判红：扫到 LazyForEach ≥ 1（实得 ${lazySeen}）`, lazySeen >= 1);
  ok(`W2 LazyForEach item 内**不得**投递 theme:/mdTheme:（实测 ${w2.length} 处：${w2.join(', ')}）`, w2.length === 0);
  ok(`W2 台账与实测一一对应（实测 ${w2.length} / 登记 ${W2_LEDGER.length}）`,
    w2.length === W2_LEDGER.length && w2.every((h: string) => W2_LEDGER.indexOf(h) >= 0));
  // mutation 自证（规则本体）：注入"必红样本"必须命中；无投递必须不命中。
  const injBad: string = 'LazyForEach(x, (r) => { MessageRowView({ row: r, theme: this.themeName }) })';
  const injOk: string = 'LazyForEach(x, (r) => { MessageRowView({ row: r }) })';
  const hit = (s: string): boolean => {
    const at: number = s.indexOf('LazyForEach(');
    return at >= 0 && /\b(theme|mdTheme)\s*:\s*this\./.test(s.slice(at));
  };
  ok('W2 mutation 自证：`theme: this.x` 注入 ⇒ 命中（必红）', hit(injBad));
  ok('W2 mutation 自证：无投递 ⇒ 不命中（不误报）', !hit(injOk));
}

// W3：静息态不透明度由状态位决定（门禁⑨ 拦 `.opacity(x ? 1 : 0)` A 级；这里补 B 级/语义面）。
{
  const w3: string[] = [];
  for (const f of ETS_ALL) {
    if (f.indexOf('/components/') < 0 && f.indexOf('/pages/') < 0) { continue; }
    const src: string = stripSrc(fsMod.readFileSync(f, 'utf-8'));
    const lines: string[] = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/\.opacity\(/.test(lines[i]) && /(\?|:)\s*(0|0\.0|0\.001)\b/.test(lines[i])) {
        w3.push(`${pathMod.basename(f)}:${i + 1}`);
      }
    }
  }
  console.log(`  ℹ️ W3 .opacity(...?1:0/0.001...) 形态 ${w3.length} 处（静息态须恒可见）：${w3.join(', ')}`);
}

if (fail > 0) { console.log(`  staleness_audit: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  staleness_audit: ${pass} passed, 0 failed`);
process.exit(0);

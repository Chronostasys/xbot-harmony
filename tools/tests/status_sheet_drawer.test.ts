/**
 * 「会话状态弹层 + 抽屉会话列表」层次契约测试（任务5 靶子3/4）。
 *
 * 靶子3（会话状态弹层）：弹层曾整体渲染 `statusBarText()` —— 它是「模型 · 用量 · todos · cwd」
 *   四段拼接，而模型 / 工作路径在下方**各有专属行** ⇒ 同一信息两处（"不干净"）。本波改为
 *   逐项成行，排版口径 = web `SessionInfo.tsx` 的 `InfoRow`：**标签左、值右**。
 * 靶子4（抽屉）：组头此前与行内次级文字同为 regular，读不出层次 ⇒ 补半档字重（web `font-semibold`）；
 *   会话行 `[徽标] chat_id` 在"无自定义标题"时与上一行标题**同串**（如 `web-4` / `Web web-4`）
 *   ⇒ 仅当 id ≠ 标题时才补 id。
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`pages/**` 不进这套
 * harness ⇒ 页面层无法直接 import 单测。先例见 `tools/tests/inflight_language.test.ts`。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

// 让本文件成为**模块**（否则顶层 `pass/fail/ok/…` 落进全局作用域，与其它同类测试文件冲突：
// TS6200/TS2393）。有 import 的测试天然是模块；本文件只用 `require`，故显式 `export {}`。
//
// 反查真源：组头"层次"的断言要能**真正**判定"字重比正文重半档"，而不是只匹配源码字符串
// ⇒ 引入 `core/design.ets` 的 `typeOf`（`run-one.sh`/`run.sh` 会把该路径 sed 成本目录的 `./`）。
import { typeOf } from '../../entry/src/main/ets/core/design';
export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
// mutation 自证：可用 SSD_INDEX_SRC / SSD_STATUS_SRC 指向**副本**（⛔ 不改真树即可证红）。
function srcPath(envName: string, rel: string): string {
  const v: string | undefined = process.env[envName];
  return v !== undefined && v.length > 0 ? v : pathMod.join(repoRoot, rel);
}
const indexSrc: string = fsMod.readFileSync(srcPath('SSD_INDEX_SRC',
  'entry/src/main/ets/pages/Index.ets'), 'utf-8');
// ⚠️ 2026-10-11（P1 拆分后）：`StatusSheet` 已从 `pages/Index.ets` 抽为
//    `components/StatusSheet.ets`（判据留页面、组件只吃 `@Prop` 字符串 + 回调，
//    见 `docs/INDEX-SPLIT-PLAN.md` §5）⇒ 状态弹层的结构断言改读**组件源码**。
const statusSrc: string = fsMod.readFileSync(srcPath('SSD_STATUS_SRC',
  'entry/src/main/ets/components/StatusSheet.ets'), 'utf-8');

/** 从锚点 A 到锚点 B 之间的源码片段（找不到返回空串）。 */
function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a);
  if (i < 0) { return ''; }
  const j = src.indexOf(b, i);
  return j < 0 ? '' : src.substring(i, j);
}

// ── 靶子3：会话状态弹层（标签左 / 值右，每项仅一次）──────────────────────────────
// ⚠️ 旧锚点 `between(indexSrc, 'StatusSheet() {', '.transition(this.sheetTransition())')` 已失效：
//    P1 后 `StatusSheet` 不在 `Index.ets`（且页面过渡改调 `sheetTransition()`，不再有 `this.`）
//    ⇒ 旧期望（"这段源码在页面里"）不再是契约；契约改为"组件渲染逐项行 + 页面喂权威用量值"。
const sheet: string = statusSrc;
ok('StatusSheet 可定位', sheet.length > 200);
hasNot(sheet, 'statusBarText',
  '弹层不再整体渲染 statusBarText()（其含 model/cwd ⇒ 与下方专属行重复）');
// ⚠️ 2026-10-11（本波重排）：三行改成**共享行原语** `StatusInfoRow` 承载（`label:` 参数 =
//    '用量'/'模型'/'工作路径'），⛔ 不再是页内 `Text('用量')` 字面量。旧 pin 钉的是"某处出现
//    `Text('用量')`"（实现细节），已失效；改为钉**语义 + 判别力**：同一行原语承载 + 标签左/值右
//    由**渲染顺序**（label 的 Text 在 value 之前）与**值右对齐**共同保证。
has(sheet, "label: '用量'", '用量成行（走 StatusInfoRow 行原语）');
has(sheet, "label: '模型'", '模型成行（走 StatusInfoRow 行原语）');
has(sheet, "label: '工作路径'", '工作路径成行（走 StatusInfoRow 行原语）');
has(sheet, 'textAlign(TextAlign.End)', '值右对齐（web InfoRow 口径：标签左、值右）');
ok('标签左 / 值右（行内 label 先于 value 渲染）',
  sheet.indexOf('Text(this.label)') >= 0
    && sheet.indexOf('Text(this.label)') < sheet.indexOf('Text(this.value)'));
// 权威用量值契约（拆分后）＝ 组件接收 `@Prop usageText` ⊕ 页面把 `usageText(this.usage)` 喂进去。
// 两处合起来 ⇔ 旧的 `has(sheet, 'usageText(this.usage)')`（当时在同一段源码里）。
has(sheet, '@Prop usageText', '组件用量走 @Prop usageText（判据不入组件）');
has(indexSrc, 'usageText: usageText(this.usage)', '页面喂入服务端权威用量值（usageText），不本地推算');

// ── 靶子4a：组头层次（web 是 font-semibold；中文以字重补半档）────────────────────
// ⚠️ anchor 2026-10-11 更新：sidebar-ux 的 DrawerSheet 重排（`bce3dcf`）把徽标圆角 `8` 换成
//    语义令牌 `RADIUS_PILL`（= `R_LG` = 8，**同值**）⇒ 旧 anchor 失效、`between` 返回空串（假红）。
const grpHead: string = between(indexSrc, 'Text(g.title)', 'backgroundColor(this.pal().surfaceAlt).borderRadius(RADIUS_PILL)');
ok('组头块可定位', grpHead.length > 20);
// ⚠️ 字重 pin 同步为**语义出口**：`.fontWeight(typeOf('type.subhead').weight)`。
//    ⛔ **不是回归**（已核真源）：`type.subhead.weight` = `WEIGHT_MEDIUM` = **500** = 旧
//    `FontWeight.Medium` —— 同值、且从"写死字重"升级为"语义指引"（`design.ets:206`）。
//    判别力升级：不只匹配字符串，而是**反查真源角色字重 ≥ medium**（若被拉平成 regular ⇒ 红）。
const semMatch: RegExpMatchArray | null = grpHead.match(/fontWeight\(typeOf\('([^']+)'\)\.weight\)/);
const semWeight: number = semMatch !== null ? typeOf(semMatch[1]).weight : 0;
ok('组头字重走语义出口 typeOf(...).weight', semMatch !== null);
ok('组头字重 ≥ medium（读得出"上一级"层次）', semWeight >= 500);
hasNot(grpHead, 'FontWeight.Regular', '⛔ 组头不得回落 regular（层次会被拉平）');

// ── 靶子4b：次级文字去重（id == 标题时不再重复打一遍 id）────────────────────────
const rowLine2: string = between(indexSrc, 'Text(channelLabel(s.channel', "}.width('100%')");
ok('会话行第二行可定位', rowLine2.length > 50);
has(rowLine2, 'if (s.chat_id !== this.tabLabel(s.chat_id))',
  '仅当 id ≠ 标题时才补 id（消 `web-4` / `Web web-4` 同串重复）');

console.log(`  status_sheet_drawer: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

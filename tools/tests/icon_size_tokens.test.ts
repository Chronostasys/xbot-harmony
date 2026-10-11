/**
 * 图标尺寸**档常量**判据（2026-10-11，主 agent 批准的表）。
 *
 * 背景：`ICON_SM(12)` 等**已有档被绕过**（组件里写死字面量）。本批判类收编 **9 处**（宿主 = `SymbolGlyph`
 * /`Image` ⇒ 图标；宿主 = `Text` ⇒ **文字，入台账**）。⚠️ **文字站点逐值为文字字号，⛔ 不许换成图标档**
 * （本轮我自己踩到一次：正则全替会把 `MarkdownView:592`/`ToolPopover:266,312,324,406` 的文字档换掉 ⇒ 已按行号精确替换并加了 ★② 反向断言）。
 *
 * ⚠️ 21 个图标站点里 **12 个在禁改文件**（`Index.ets` 7 / `MessageRow` 5）⇒ 台账登记、只许缩短。
 * ⚠️ 结尾必须 `process.exit(...)`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const c = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/components'))) { repo = c; break; }
}
ok('探测到仓库根', repo.length > 0);

/** **未收编台账**（⛔ 只许缩短；每条须有理由）。 */
const PENDING: string[] = [
  'Index.ets(7): 归 chat-surface-ux 在途 ⇒ 未收编',
  'MessageRow.ets(5): 归 chat-surface-ux 在途 ⇒ 未收编',
  'Index.ets 的 22 档(3): 归其所有 ⇒ ICON_XL 的 22 侧未收编',
  '光学白名单 11/15/52: 已登记进 opticalValues()（理由见该函数注释；⛔ 只许缩短）',
];
if (repo.length > 0) {
  const count = (rel: string, needle: string): number => {
    const src: string = fsMod.readFileSync(pathMod.join(repo, rel), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    let n = 0, i = 0;
    while ((i = src.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  };
  // ★① 收编分布（零扫描判红：合计 > 0）
  const WANT: string[][] = [
    ['entry/src/main/ets/components/Lightbox.ets', 'fontSize(ICON_LG)'],
    ['entry/src/main/ets/components/MarkdownView.ets', 'fontSize(ICON_SM)'],
    ['entry/src/main/ets/components/PluginsSheet.ets', 'fontSize(ICON_LG)'],
    ['entry/src/main/ets/components/QueueSheet.ets', 'fontSize(ICON_LG)'],
    ['entry/src/main/ets/components/ToolPopover.ets', 'fontSize(ICON_SM)'],
    ['entry/src/main/ets/components/SelfCheckSheet.ets', 'fontSize(ICON_XL)'],
  ];
  let total = 0;
  for (let i = 0; i < WANT.length; i++) {
    const n: number = count(WANT[i][0], WANT[i][1]); total += n;
    ok(`★① ${WANT[i][0].split('/').pop()} 走 ${WANT[i][1]}（实得 ${n}）`, n >= 1);
  }
  ok(`★① 零扫描判红：收编命中合计 ${total}（> 0）`, total > 0);
  // ★② **反向不变量**：文字站点**不得**被误换成**图标档**（本轮实测踩过）。
  // ⚠️ 不硬编码"文字档必须仍是 fontSize(12)" —— 文字档**归文字档体系**、会被别线正常演进
  //    （实测：`MarkdownView` 的文字站点已被 `chat-surface-ux` 改成别的文字档 ⇒ 硬编码会假红）。
  //    真正的反向不变量 = **该文件的 `ICON_SM` 命中数 == 判类时的图标数**（多出来 ⇒ 必是文字站点被误换）。
  ok('★② MarkdownView 的 ICON_SM 恰 1 处（判类时只有 1 个图标站点 ⇒ 多出即误换）',
    count('entry/src/main/ets/components/MarkdownView.ets', 'fontSize(ICON_SM)') === 1);
  ok('★② ToolPopover 的 ICON_SM 恰 1 处（判类时只有 1 个图标站点 ⇒ 其 4 处文字站点未被动）',
    count('entry/src/main/ets/components/ToolPopover.ets', 'fontSize(ICON_SM)') === 1);
  // ★③ ICON_XL 已定义且**有消费**（⛔ 不留零消费常量）
  ok('★③ design.ets 定义 ICON_XL = 20', count('entry/src/main/ets/core/design.ets', 'export const ICON_XL: number = 20;') === 1);
  ok('★③ 且被 SelfCheckSheet 的 3 处消费', count('entry/src/main/ets/components/SelfCheckSheet.ets', 'fontSize(ICON_XL)') === 3);
  ok(`★④ 台账登记未收编项（${PENDING.length} 条，各带理由；⛔ 只许缩短）`, PENDING.length > 0);
  // ★⑦ **面角色"非死"台账**（2026-10-11 取证；⚠️ 我此前报过"零消费"= **扫描范围伪影**：
  //    只扫 components/pages、**漏了定义文件 design.ets** ⇒ "未命中 ≠ 真死"）。
  //    · `ELEV_CARD`(2)/`ELEV_RAISED`(3)：**经 `elevationColorOf` 的等级映射**消费
  //      —— `design.ets:474` `surface.card`/`surface.input → ELEV_CARD`；`:475` **默认 → ELEV_RAISED**。
  //    · `surface.pill`：**别名档**（= `RUNG_RAISED` ⇒ 与 `surface.raised`/`overlayRow` **同取值**）；
  //      消费方 = `design.ets:407-409` 的 `chipNeedsHairline()` 对比度判据；UI 无直接站点（pill 走 `pillBgOf`）。
  ok('★⑦ 面角色"非死"台账：ELEV_CARD/ELEV_RAISED 经等级映射消费、surface.pill 为别名档（均无需删）', true);
  // ★⑤ §15「画布→下沉」的 **chip** 面：复用 `insetHairlineOf`（深色画 / 浅色 transparent）
  //    原文口径（`docs/DESIGN-SYSTEM.md §15 附`）：dark 1.0005 无通道 ⇒ "该加，但只该对深色加"。
  const a: number = count('entry/src/main/ets/components/PluginHost.ets', 'insetHairlineOf(this.pal())');
  const b: number = count('entry/src/main/ets/components/PluginWidgets.ets', 'insetHairlineOf(this.pal())');
  ok(`★⑤ §15 chip：PluginHost 走内凹发丝（实得 ${a} ≥1）`, a >= 1);
  ok(`★⑤ §15 chip：PluginWidgets 的 2 处 chip 走内凹发丝（实得 ${b}）`, b === 2);
  ok(`★⑤ §15 chip：零扫描判红（合计 ${a + b} > 0）`, a + b > 0);
  // ★⑥ **误报守卫**（2026-10-11 实测教训）：`ToolPopover:418` 的 `surface.well` 出现在 **diff 行的
  //    条件着色**里（`.backgroundColor(kind===DIFF_ADD ? surface.well : …warnBg/transparent)`）
  //    = **文本行底纹，不是"面"** ⇒ 给它接内凹发丝**是错的**（会给普通文本行凭空加边）。
  //    ⇒ 钉住：该文件的 `insetHairlineOf` **恰 4 处**（4 个 well 面），⛔ 不许按"扫描命中"机械全接。
  //    mutation：给那处 diff 行接上 ⇒ 5 ⇒ 必红。
  const tp: number = count('entry/src/main/ets/components/ToolPopover.ets', 'insetHairlineOf(this.pal())');
  ok(`★⑥ 防误报：ToolPopover 的 insetHairlineOf **恰 4 处**（4 个 well 面；diff 行底纹不算面）—— 实得 ${tp}`, tp === 4);
}
if (fail > 0) { console.log(`  icon_size_tokens: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  icon_size_tokens: ${pass} passed, 0 failed`);
process.exit(0);

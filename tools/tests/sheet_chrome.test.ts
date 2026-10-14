/**
 * 面板/sheet 页头 chrome 统一契约测试 —— 「关闭 X 一个设计系统」（2026-10-12 目标③）。
 *
 * 动机（真实清点，不是假想）：9 个面板的"关闭 X"曾**各写各的** ——
 *   · 尺寸三族：`X_GLYPH=17`（`AskUserSheet`/`StatusSheet` **各定义一份同名魔数**）、`ICON_LG=16`、
 *     `ICON_MD=14`、还有一个裸 `15`（`QueueSheet` 行内移除 X）；
 *   · 颜色三族：`pal().textSecondary` / `palOnce().textSecondary` / `colorOf(…,'iconMuted')`。
 * 用户要求③是"**所有面板**一个设计系统、对标苹果" ⇒ 同一个"关闭"在不同面板里大小/深浅都不同，
 * 观感就是"几个产品拼起来的"。⇒ 本单钉**形态契约**（谁、用哪个出口、**站内零魔数**），
 * 与 `collapse_all_wiring` / `motion_wiring_batch2` 同款（组件/页面不进离线 harness ⇒ 读真实源码断言）。
 *
 * 批次 4 扩展（2026-10-12）：批次 3 只覆盖 9 个**组件文件**里的 sheet，**漏了页面级面板** ——
 * `pages/Index.ets` 里 5 个页头"关闭"（插件全屏 / 新建会话 / 运行面板 / 抽屉 / 模型选择）仍是
 * `17`/`ICON_MD`/`type.headline.size` + `textSecondary`，以及 `SettingsPanel`（偏好设置）页头。
 * ⇒ 全部收编到同一 token；并顺带修 `PluginHost` 页头 X 的命中盒（原 `17+2×SPACE_XS=33 < 44`）。
 * 页面文件里另有 4 处**行内/破坏性** xmark（标签页移除 / 最近路径移除 / 定时任务删除 / 关闭终端）
 * **语义不同** ⇒ 显式记为 `total` 里的例外、不走 token（见 SPECS 注释）。
 *
 * ⛔ 判据纪律（AGENTS.md「判据 ≠ 信号」）：
 *   · **先剥注释**（本仓用注释记录"为什么不用某做法"，朴朴素 grep 会把文档当违规 —— 本单里
 *     `AskUserSheet`/`StatusSheet` 的注释**正文明写含 `X_GLYPH`**，不剥注释必假红）；
 *   · **只取属性链片段**（从字形那一行向下，遇到不以 `.` 开头的行即止）—— 不"取整行猜"、
 *     不"取固定 500 字符"（会串到下一个字形的属性上 ⇒ 假绿）；
 *   · **零扫描判红**（读不到源 / 某文件 0 命中 ⇒ 红，白绿防线）；
 *   · **逐文件钉命中数**（少一处 = 有人删了关闭键却仍"全绿"）；
 *   · 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 *
 * **mutation 自证**（改完应各红一条）：
 *   · 把任一 sheet 的 `.fontSize(SHEET_ACTION_GLYPH)` 改回 `.fontSize(17)` ⇒ 该文件红；
 *   · 把 `.fontColor([colorOf(this.pal(), 'iconMuted')])` 改回 `[this.pal().textSecondary]` ⇒ 红；
 *   · 在任一 sheet 重新引入 `const X_GLYPH = 17;` 常量 + 使用 ⇒ 红（魔数回归）；
 *   · 删掉 `core/design.ets` 的 `SHEET_ACTION_GLYPH` 导出 ⇒ 全局红。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
// ⛔ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名（本仓已入库 GOTCHA）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

/** 剥 `//` 与 `/* *\/` 注释 —— 只判**代码**（注释里明写了 `X_GLYPH` 等文档记号）。 */
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

/** 探测仓库根（含 `entry/src/main/ets/core/design.ets` 的那层）。 */
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/core/design.ets'))) { return p; }
  }
  return '';
}

const root: string = findRoot();
ok('探测到仓库根（含 core/design.ets）', root.length > 0);
const ETS: string = path.join(root, 'entry/src/main/ets');

function read(p: string): string {
  try { return stripComments(fs.readFileSync(p, 'utf8')); } catch (e) { return ''; }
}

/**
 * 源码里是否存在**独立的** `Text('xxx')` 元素调用。
 *
 * ⛔ 必须做"前邻字符非标识符"边界判定：朴素 `indexOf("Text('刷新')")` 会被 `.accessibilityText('刷新')`
 *   **子串误匹配**（"Text(" 恰好是它的后缀）⇒ **正确实现被判红**（2026-10-14 本轮自证实测踩到）。
 */
function hasTextElement(src: string, label: string): boolean {
  const needle: string = "Text('" + label + "')";
  let from: number = 0;
  while (true) {
    const k: number = src.indexOf(needle, from);
    if (k < 0) { return false; }
    const prev: string = k > 0 ? src.charAt(k - 1) : '';
    if (!/[A-Za-z0-9_]/.test(prev)) { return true; }
    from = k + needle.length;
  }
}

/** 关闭 X 字形（**非** `_fill`：`xmark_circle_fill` 是"清空/终止"等**别的**语义，不属本契约）。 */
const NEEDLE: string = "sys.symbol.xmark')";

/**
 * 取每处关闭 X 的**属性链片段**：从字形所在行起向下累积，直到遇到一行（trim 后）
 * **不以 `.` 开头**者（ArkTS 属性链每行以 `.` 起）—— ⛔ 不用固定窗口（会串到下一字形的属性 ⇒ 假绿）。
 */
function closeChains(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (true) {
    const at = src.indexOf(NEEDLE, i);
    if (at < 0) { break; }
    // 回退到该行行首
    let ls: number = at;
    while (ls > 0 && src.charAt(ls - 1) !== '\n') { ls--; }
    let cur = ls;
    const lines: string[] = [];
    let first = true;
    while (cur <= src.length && lines.length < 12) {
      const nl = src.indexOf('\n', cur);
      const line = nl < 0 ? src.substring(cur) : src.substring(cur, nl);
      const t = line.trim();
      if (!first) {
        if (t.length > 0 && t.charAt(0) !== '.') { break; }
        if (t.length === 0) { break; }
      }
      lines.push(line);
      first = false;
      if (nl < 0) { break; }
      cur = nl + 1;
    }
    out.push(lines.join('\n'));
    i = at + NEEDLE.length;
  }
  return out;
}

// ── ① design 层：单一 token 存在，且值 = ICON_LG（⛔ 防有人改成别的值而静默漂移）─────
{
  const src: string = read(path.join(ETS, 'core/design.ets'));
  ok('① core/design.ets 读到源码（零扫描判红）', src.length > 0);
  ok('① core/design.ets 导出 SHEET_ACTION_GLYPH 且值 = ICON_LG',
    /export\s+const\s+SHEET_ACTION_GLYPH\s*:\s*number\s*=\s*ICON_LG\s*;/.test(src));
}

// ── ② 面板关闭 X：**页头关闭键**必须走统一 token + 弱色 role；逐文件钉「token 数 / 总链数」──
// 每文件给 {rel, token, total}：
//   · token = 该文件里**必须**走 `SHEET_ACTION_GLYPH` 的页头"关闭"键数；
//   · total = 该文件里 xmark 字形链总数（含**显式例外**：行内移除 / 破坏性删除 / 关闭终端）。
// **双钉**（token 与 total 同时钉）：① 少一个页头关闭键 ⇒ token 少 ⇒ 红；
//   ② 多一个页头关闭键却忘走 token ⇒ total 多 ⇒ 红。方向两侧都逮得住。
// 显式例外（**语义不同，不在收编范围**）：
//   · `pages/Index.ets` 4 处 —— 标签页移除(11) / 新建会话-最近路径移除(ICON_MD) /
//     定时任务删除(dangerText) / 关闭终端(dangerText)：都是**行内/破坏性**动作，非页头"关闭"；
//   · 本文件外：`Lightbox`（媒体遮罩上的关闭 —— 需比 `iconMuted` 更亮的 `textSecondary`
//     才在任意图像上可见）、`GoalBanner`（清除目标）、`MenuSheets`（字形工厂，非按钮）。
// 「页头关闭键」判据 = 该字形属性链里含 `.fontSize(SHEET_ACTION_GLYPH)`。
const SPECS: { rel: string; token: number; total: number }[] = [
  { rel: 'components/AskUserSheet.ets', token: 1, total: 1 },
  { rel: 'components/StatusSheet.ets', token: 1, total: 1 },
  { rel: 'components/SessionStatsSheet.ets', token: 1, total: 1 },
  { rel: 'components/PluginsSheet.ets', token: 1, total: 1 },
  { rel: 'components/FilesSheet.ets', token: 1, total: 1 },
  { rel: 'components/TerminalSheet.ets', token: 1, total: 1 },
  { rel: 'components/QueueSheet.ets', token: 2, total: 2 }, // 头部关闭 + 行内移除（后者 token+危险色）
  { rel: 'components/SelfCheckSheet.ets', token: 1, total: 1 },
  { rel: 'components/TaskDetailSheet.ets', token: 1, total: 1 },
  // 运行面板（任务管理）结构化行卡 —— 批次10（2026-10-12）**抽出**的组件：**破坏性** xmark
  // 由页面迁来（删除定时任务 / 关闭终端）。⛔ 二者**共用一个字形分支**（只有 `accessibilityText`
  // 与动作不同，DRY）⇒ 本文件链数 = **1**（旧页面里是 2 处）。
  { rel: 'components/PanelRows.ets', token: 0, total: 1 },
  // 页面级页头面板（目标③「所有面板」）：5 个页头关闭走 token；2 处行内/破坏性为例外
  // （批次10 后另 2 处已随 `PanelRowCard` 迁出页面 ⇒ 9 → 7）。
  { rel: 'pages/Index.ets', token: 5, total: 7 },
  // 偏好设置页头关闭（token + iconMuted；命中盒由 `padding(SPACE_MD)` 撑到 ≥44）。
  { rel: 'components/SettingsPanel.ets', token: 1, total: 1 },
];
const SHEETS: string[] = SPECS.map((s) => s.rel);
let totalChains = 0;
let totalTokens = 0;
for (const spec of SPECS) {
  const rel: string = spec.rel;
  const src: string = read(path.join(ETS, rel));
  ok(`② ${rel} 读到源码（零扫描判红）`, src.length > 0);
  const chains: string[] = closeChains(src);
  totalChains += chains.length;
  let tokens = 0;
  for (let j = 0; j < chains.length; j++) {
    const c: string = chains[j];
    if (c.indexOf('.fontSize(SHEET_ACTION_GLYPH)') >= 0) {
      tokens++;
      const tag: string = `② ${rel} 页头关闭 X（第 ${j + 1} 链）`;
      // 弱色图标**必须**走计算型 role `iconMuted`（AGENTS.md GOTCHA）；
      // 例外：破坏性动作（QueueSheet 行内"移除"）走 `dangerText` —— **显式**才放行。
      ok(`${tag} 颜色 = \`colorOf(…,'iconMuted')\`（或破坏性 \`dangerText\`）`,
        c.indexOf("'iconMuted'") >= 0 || c.indexOf('dangerText') >= 0, c);
      // ⛔ 反面形态：旧的"文字角色当图标色"
      ok(`${tag} ⛔ 不得用 \`.textSecondary\`/裸 \`.textPrimary\` 当图标色`,
        c.indexOf('textSecondary') < 0 && c.indexOf('.textPrimary') < 0, c);
    }
  }
  totalTokens += tokens;
  // ⛔ 零扫描判红：页头关闭键一个都不许走魔数（token 必须 = 期望值）
  ok(`② ${rel} 页头关闭 X 走 token 命中数 = ${spec.token}（实测 ${tokens}）`, tokens === spec.token);
  ok(`② ${rel} xmark 字形链总数 = ${spec.total}（实测 ${chains.length}；含显式例外）`, chains.length === spec.total);
}
ok(`② 全部面板页头关闭 X（token）总数 = 16（实测 ${totalTokens}）`, totalTokens === 16);
ok(`② 全部面板 xmark 链总数 = 19（实测 ${totalChains}）`, totalChains === 19);

// ── ③ 魔数回归防线：这 9 个文件里不得再有局部 `X_GLYPH` 标识符 ────────────────────
for (const rel of SHEETS) {
  const src: string = read(path.join(ETS, rel));
  ok(`③ ${rel} 无局部魔数 \`X_GLYPH\`（回归防线）`, src.indexOf('X_GLYPH') < 0);
}

// ── ⑥ 运行面板「终端」tab：内容区**不放计数**（tab 标签已带 `终端 N` ⇒ 永远重复）──────────────
// 真机取证（2026-10-12）：tab 标签 = `panelTabLabel('term')` = `终端${n>0?' '+n:''}`（**已带计数**），
//   而内容区又画「共 N 个终端」⇒ **双计数**；空态下更糟（「共 0 个终端」+ 空态文案都说"没有"）。
//   ⇒ 内容区**删计数**（只留「＋ 新建」右对齐）；计数由 tab 承担（其空态自动隐后缀）。
{
  const src: string = read(path.join(ETS, 'pages/Index.ets'));
  ok('⑥ pages/Index.ets 读到源码（零扫描判红）', src.length > 0);
  // 正：tab 标签**带计数**（`panelTabLabel` 的 `终端${suffix}` 分支）
  ok('⑥ 面板 tab 标签带计数（`终端${suffix}`）', src.indexOf('return `终端${suffix}`') >= 0);
  // 反：内容区**不得再有**计数（旧形态 ⇒ 与 tab 双计数 / 空态啰嗦）
  ok('⑥ ⛔ 内容区不再放「共 N 个终端」计数',
    src.indexOf('共 ${this.terminals.length} 个终端') < 0);
  // 新建入口在位（空态下仍需能开终端）
  // ⚠️ 2026-10-12（15d 判据演进）：入口已从**内容区右对齐孤按钮**上移到**表头**（仅终端 tab），
  //    ⇒ 本文件只保证"入口存在"；"在表头且唯一"由 `panel_terminal_wiring.test.ts` 钉住。
  // ⚠️ 2026-10-13（S2 判据演进）：动作键由**实心 accent 胶囊**改 **Apple 导航栏动作键形态**
  //    （`plus` 字形 + accentSoft 文字，与抽屉「新建」`DrawerSheet` 同款）⇒ 锚演进为**稳定 id**
  //    （`.id('xbot-panel-new')`，不再随文案/字形漂移）。⛔ 断言**不删除**：入口仍在位。
  ok('⑥ 终端 tab 保留「新建」入口（稳定 id 锚 xbot-panel-new）', src.indexOf('xbot-panel-new') >= 0);
  ok('⑥ 入口 = 图标 + 文字（`plus` 字形 + `新建`）',
    src.indexOf("$r('sys.symbol.plus')") >= 0 && src.indexOf("Text('新建')") >= 0);
  // 五 tab 空态在位（**逐字钉住** ⇒ 防误改/误删；措辞升级须同步改本判据）
  // ⚠️ 2026-10-13（判据演进 15z）：空态从「顶部一行小字」升级为「**大号弱化字形 + 一行说明**、
  //    且在内容区居中」⇒ 调用形态带上字形参数（`PanelEmpty($r('sys.symbol.X'), '文案')`）。
  //    ⚠️ 字形**必须已核对存在**（SDK `previewer/common/resources/entry/resources.txt` 资源表；
  //    本仓血债 =「猜字形」分类）—— 本轮实测：`clock`/`hourglass`/`person_2`/`code` ✅ 在表内，
  //    ⛔ `terminal` 在该表 9552 个字形里 **0 命中**（故终端用 `code`）。
  // ⚠️ 2026-10-13（S2 判据演进：空态**层级**）—— 由「字形 + 一行」升级为 **字形 + 主行 + 提示行**
  //    （Apple 空态三段结构：主行 `type.subhead`+`textSecondary` / 提示行 `type.caption`+`textMuted`）
  //    ⇒ 第三参 `hint` 进入调用形态。⛔ 仍是"逐字钉住"，只演进不改意图。
  const EMPTIES: string[] = [
    "PanelEmpty($r('sys.symbol.clock'), '暂无定时任务', '定时任务到点会自动执行本会话')",
    "PanelEmpty($r('sys.symbol.hourglass'), '暂无后台任务', '后台命令在服务端持续运行，不受会话切换影响')",
    "PanelEmpty($r('sys.symbol.person_2'), '暂无子代理', '派发子代理后会出现在这里')",
    // ⚠️ 15d：文案与"行内按钮"解耦（按钮已上移表头）⇒ 不再出现"点「＋ 新建」开一个"
    "PanelEmpty($r('sys.symbol.code'), '暂无终端', '新建终端即可在此设备上运行 shell')",
    // 2026-10-13：机器 tab 的裸 `Text` 也统一到 `PanelEmpty`（字形 `computer`，已核对）
    "PanelEmpty($r('sys.symbol.computer'), '暂无受管机器', '在服务端注册 Runner 后可在此查看')",
  ];
  for (const s of EMPTIES) {
    ok(`⑥ 运行面板空态在位：${s}`, src.indexOf(s) >= 0);
  }
  // 反（白绿防线）：⛔ 不得再出现「只给文案、不给字形」的旧形态 —— 否则空态退回"顶部一行小字"
  ok('⑥ ⛔ 空态必须带字形（不得有 PanelEmpty(\' 形态）', src.indexOf("PanelEmpty('") < 0);
  // 反：⛔ 不得用**不存在**的 `terminal` 字形（真机渲染空白 = 静默失败）
  ok('⑥ ⛔ 不得用不存在的 sys.symbol.terminal', src.indexOf('sys.symbol.terminal') < 0);
}

// ── ⑦「同一个动作 ⇒ 同一个控件类型」：面板动作键「刷新」（2026-10-14，要求③-2）────────────────
//   真实清点（动机）：同一个「刷新」动作在本仓有**两种控件类型** —— `SessionStatsSheet`（统计）走
//   **图标键**（`arrow_clockwise` + a11y），而 `pages/Index.ets` 的运行面板走**文字键** `Text('刷新')`
//   ⇒ 观感是"两个产品拼起来的"；用户在要求③里点名的正是「面板控件类型要自洽」（同 ③-1 抽屉两修）。
//   ⇒ 判据钉：两处都必须是**图标键**（同一字形 + 同一 a11y 文案，同一条属性链内 ≤400 字符）；
//     并**反向**钉运行面板页头区间里不得再出现**独立的 `Text('刷新')` 元素**（白绿防线）。
//   ⛔ 断言纪律（本轮自证亲手踩到）：`indexOf("Text('刷新')")` 会被 `.accessibilityText('刷新')`
//     **子串误匹配**（"Text(" 是其后缀）⇒ 正确实现被判红。⇒ 必须做"前邻字符非标识符"的**边界判定**
//     （`hasTextElement`），且**限定区间**（`PanelsSheet()` → `'关闭运行面板'`），别全文件乱扫。
//   **mutation 自证**（用 `git show HEAD:` 的旧版 Index.ets 当必红样本，实测）：旧版 ⇒ 图标键 false
//     + 独立文字键 true ⇒ ⑦ 红两条；工作树 ⇒ 两条全绿；`SessionStatsSheet` 对照 ⇒ 绿。
{
  const idxSrc: string = read(path.join(ETS, 'pages/Index.ets'));
  const statsSrc: string = read(path.join(ETS, 'components/SessionStatsSheet.ets'));
  ok('⑦ pages/Index.ets 读到源码（零扫描判红）', idxSrc.length > 0);
  ok('⑦ components/SessionStatsSheet.ets 读到源码（零扫描判红）', statsSrc.length > 0);
  const GLYPH: string = "SymbolGlyph($r('sys.symbol.arrow_clockwise'))";
  const A11Y: string = ".accessibilityText('刷新')";
  // 运行面板页头区间（含注释已剥 ⇒ 只判代码）
  const headStart: number = idxSrc.indexOf('PanelsSheet()');
  const headEnd: number = idxSrc.indexOf("accessibilityText('关闭运行面板')", headStart < 0 ? 0 : headStart);
  const head: string = headStart >= 0 && headEnd > headStart ? idxSrc.substring(headStart, headEnd) : '';
  ok('⑦ 切到运行面板页头区间（零扫描判红）', head.length > 0);
  const iIdx: number = head.indexOf(GLYPH);
  const jIdx: number = iIdx < 0 ? -1 : head.indexOf(A11Y, iIdx);
  ok('⑦ 运行面板刷新键 = 图标键（arrow_clockwise + a11y「刷新」，同链 ≤400 字符）',
    iIdx >= 0 && jIdx > iIdx && jIdx - iIdx <= 400, `glyph@${iIdx} a11y@${jIdx}`);
  ok('⑦ ⛔ 运行面板页头不得再有独立的文字键 Text(\'刷新\')（控件类型不自洽）',
    !hasTextElement(head, '刷新'));
  const iSt: number = statsSrc.indexOf(GLYPH);
  const jSt: number = iSt < 0 ? -1 : statsSrc.indexOf(A11Y, iSt);
  ok('⑦ 统计面板刷新键 = 图标键（同一契约，不许各写各的）',
    iSt >= 0 && jSt > iSt && jSt - iSt <= 400, `glyph@${iSt} a11y@${jSt}`);
}

// ── ⑧「同一个动作 ⇒ 同一个控件类型」：破坏性动作键「清空队列」（2026-10-14，要求③-2）────────────
//   真实清点（动机）：`QueueSheet` 页头的「清空」原来是**文字键** `Text('清空')`，而
//   （a）**web 权威** `src/components/agent/StagingTray.tsx:617-626` 的 `staging-clear` 明写是
//       **Trash2 图标按钮、无文字**（`aria-label = agent.staging.clearQueue`），
//   （b）本仓**所有**弹层页头的动作键（`SessionStatsSheet`/`GitPanelSheet`/`SkillsSheet`/`FilesSheet`/
//       `TaskDetailSheet`…）都是**图标键** ⇒ 文字键是"两种产品拼起来"的异类。
//   ⇒ 判据钉：清空 = **图标键**（`sys.symbol.trash` + a11y「清空队列」，同链 ≤400 字符），
//     并**反向**钉全文件不得再有**独立的 `Text('清空')` 元素**（白绿防线；`hasTextElement` 边界判定）。
//     另钉**同族对照**：`TaskDetailSheet` 的破坏性键「终止任务」也必须是图标键（同一契约，不许各写各的）。
//   **mutation 自证**（用 `git show HEAD:…QueueSheet.ets` 旧版当必红样本）：旧版 ⇒ 图标键 false
//     + 独立文字键 true ⇒ ⑧ 红两条；工作树 ⇒ 两条全绿。
{
  const qSrc: string = read(path.join(ETS, 'components/QueueSheet.ets'));
  const tdSrc: string = read(path.join(ETS, 'components/TaskDetailSheet.ets'));
  ok('⑧ components/QueueSheet.ets 读到源码（零扫描判红）', qSrc.length > 0);
  ok('⑧ components/TaskDetailSheet.ets 读到源码（零扫描判红）', tdSrc.length > 0);
  const TRASH: string = "SymbolGlyph($r('sys.symbol.trash'))";
  const QA11Y: string = ".accessibilityText('清空队列')";
  const iQ: number = qSrc.indexOf(TRASH);
  const jQ: number = iQ < 0 ? -1 : qSrc.indexOf(QA11Y, iQ);
  ok('⑧ 队列面板清空键 = 图标键（trash + a11y「清空队列」，同链 ≤400 字符）',
    iQ >= 0 && jQ > iQ && jQ - iQ <= 400, `glyph@${iQ} a11y@${jQ}`);
  ok('⑧ ⛔ 队列面板不得再有独立的文字键 Text(\'清空\')（偏离 web 权威 + 控件类型不自洽）',
    !hasTextElement(qSrc, '清空'));
  const iT: number = tdSrc.indexOf("SymbolGlyph($r('sys.symbol.xmark_circle_fill'))");
  const jT: number = iT < 0 ? -1 : tdSrc.indexOf(".accessibilityText('终止任务')", iT);
  ok('⑧ 同族对照：任务详情破坏性键「终止任务」= 图标键（同一契约）',
    iT >= 0 && jT > iT && jT - iT <= 400, `glyph@${iT} a11y@${jT}`);
}

if (fail > 0) { console.log(`  sheet_chrome: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  sheet_chrome: ${pass} passed, 0 failed`);
process.exit(0);

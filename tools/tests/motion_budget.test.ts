/**
 * 动效**预算/台账**门禁 —— "极简风格 / 苹果那种科技感且干净"⇒ **动效越少越贵**。
 *
 * 动机：本仓已有"**同一时刻只允许一个在飞动效**（光球）"的铁律（`tools/lint/inflight-single-source.sh`）；
 *   本判据守的是**另一条**：**动效总数只许减、不许增** —— 任何**新增**动画都必须**显式登记**并说明
 *   "它讲的是哪条状态/空间关系"（⛔ 纯装饰 = 廉价感，正是要砍的）。
 *   典型反例（web 对照）：`web/src/components/agent/Lightbox.tsx` 的浮层**完全无动画**（只有按钮上的
 *   `transition-colors`）⇒ 我们每加一处"为动而动"都在偏离 parity 与"干净"。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────────
 *   ① **零扫描判红**：`components/**` 与 `pages/**` 都必须真扫到文件（防"范围写空=白绿"）。
 *   ② **台账只许缩短**：每个文件的动效入口数 **≤ 台账值**（新增 ⇒ 红；删了**不必**同步改台账，
 *      下次顺手收紧即可 —— 这样"只许缩短"不制造无谓改动）。
 *   ③ **未登记文件一律红**：出现台账里没有的文件 ⇒ 说明"有人开了新的动效面"⇒ 必须来登记理由。
 *   ④ **禁循环/常驻**：全仓不得出现 `iterations`（重复动画）或 `setInterval(`（定时器动画）
 *      —— 与"唯一在飞"同源；呼吸类由光球独占（`iterations: -1` 在光球内由
 *      `tools/lint/inflight-single-source.sh` 白名单管，本判据**不重复**管它，只防**新增**）。
 *
 * ⛔ 纪律：**剥注释**（注释里提到 `.transition(` 是文档）；**只取调用片段**（不"取整行猜"）；
 *   mutation：往任一**未登记**文件加一处 `.transition(...)` ⇒ 必红。
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
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components/anim.ets'))) { return p; }
  }
  return '';
}
function walk(dir: string, out: string[]): void {
  let ents: any[] = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); }
    else if (e.name.endsWith('.ets')) { out.push(full); }
  }
}

/**
 * **动效台账**（2026-10-11 首次清点；⛔ **只许缩短**）。
 * 计分口径 = 剥注释后 `\.transition\(` + `\.animation\(` + `animateTo\(` + `withDelay\(` + `\.symbolEffect\(`
 * 的出现次数。
 * ⚠️ 2026-10-12 **口径演进（判据只许演进、不删除）**：新增第 5 项 `\.symbolEffect\(` —— 依据是
 *   `tools/lint/inflight-single-source.sh:12-15` 已把 SymbolEffect 分成两族（**循环子类** A 类 /
 *   **一次性子类** `Appear/Disappear/Replace/Hierarchical` 属"过渡"）。旧口径**数不到**一次性
 *   SymbolEffect ⇒ "新增一个符号过渡"可以**绕过**台账（= 判据盲区，正是"白绿"）。纳入后，
 *   任何新增符号过渡都必须来登记"它讲哪条状态关系"（本波 `pages/Index.ets` 即第一例）。
 * 每条都已归类（必须留 / 可合并 / 可删 见提交说明）；**新增条目必须写"它讲哪条状态/空间关系"**。
 */
const BUDGET: Map<string, number> = new Map<string, number>([
  // 工厂本体（唯一出口，⛔ 不是"站点"）。2026-10-12 +2：`drawerTransition()`（抽屉**横向**滑入
  //   —— 讲"侧栏从左边进来"的空间关系）与 `scrimTransition()`（遮罩**纯淡入** —— 讲"遮罩铺开"的层次）。
  // 2026-10-13：`animSlow()`（320ms「大块/抽屉」档）**已删** —— 全仓 0 消费者（唯 3 处引用全是注释，
  //   且都在说"T2 让位"，而 T2 实际消费 `animEaseOut()`）⇒ 与已删的 `animSpring()` 同类死工厂。
  //   ⚠️ 本台账**计不到这笔删减**：计分口径是 `.transition(`/`.animation(`/`animateTo(`/`withDelay(`/
  //   `.symbolEffect(` 的**声明数**，而 `animSlow()` 只返回 `AnimateParam` 字面量（0 个声明）⇒ 仍 8。
  ['components/anim.ets', 8],
  ['components/SplashOverlay.ets', 5], // 开屏 T1 入场 / T2 让位 / 提示延迟淡入 —— **必须留**（状态+空间）
  ['components/AssistantOrb.ets', 2],  // 光球状态切换 —— **必须留**（就是"唯一在飞"的那个）
  // 图片解码完成 ⇒ 淡入（2026-10-12）：讲的是"内容出现"的状态过渡（此前"啪"地弹出、
  //   与 skeleton 消失不同步）；影响聊天图 / 文件预览 / lightbox 全链路 ⇒ **必须留**。
  ['components/AuthImage.ets', 1],
  ['components/MessageRow.ets', 4],    // 消息入场/按压 —— ⚠️ chat-surface-ux 域（见报告）
  ['components/MenuSheets.ets', 3],    // 三个抽屉 —— **必须留**（从下滑入/滑出 = 空间关系）
  ['components/AskUserSheet.ets', 1],  // 弹层开合 —— 同上
  ['components/PluginsSheet.ets', 1],  // 同上
  // 原生 Git 面板（2026-10-13，web 内置插件 `xbot.git-fancy` 的可选增强）——
  // 唯一动效 = 弹层开合 `sheetTransition()`（与 CronDetailSheet / SessionStatsSheet 同一出口）。
  ['components/GitPanelSheet.ets', 1],
  // 文件管理面板（目标④）：唯一动效 = 弹层开合 `sheetTransition()`（与其它 L1 浮层同一条）。
  ['components/FilesSheet.ets', 1],
  // 技能面板（目标④）：唯一动效 = 侧栏开合 `drawerTransition()`（**横向**滑入 —— 讲「侧栏从左边
  //   进来」的空间关系，与 FilesSheet/DrawerSheet 同一条状态-空间关系，⛔ 不是装饰）。
  ['components/SkillsSheet.ets', 1],
  ['components/QueueSheet.ets', 1],    // 同上
  ['components/SettingsPanel.ets', 1], // 同上
  ['components/StatusSheet.ets', 1],   // 同上
  // 2026-10-12：穷举扫全仓 7 个浮层，**只有它与 `ToolPopover` 是 0 过渡**（`ToolPopover` 走
  //   `bindPopup` 系统绘制，改不到）⇒ 给它补与 StatusSheet **同一个工厂** `sheetTransition()`，
  //   不再"自检面板"独独瞬现（面板入场语言全站统一）。
  ['components/SelfCheckSheet.ets', 1],
  // 后台任务详情（目标④）：面板出场过渡，与 StatusSheet/SelfCheckSheet **同一个工厂**
  //   `sheetTransition()` —— 全站面板入场语言只有一套。
  ['components/TaskDetailSheet.ets', 1],
  // 终端面板（目标④「终端做的很差」）：① 面板出入场走 `sheetTransition()`（全站面板入场语言唯一）；
  //   ② 2026-10-13 **+1**：「回到最新」药丸的**浮现/隐去** = 纯淡入淡出 `fadeTransition()`
  //   —— 讲的是"**可回到底部**"这条状态关系的出现/消失（无空间含义 ⇒ 不滑入），与 `components/Toast`
  //   （同为「全屏透明容器 + 底对齐」的悬浮提示）**同一族**；此前"啪"地出现（`Toast` 早有过渡、此处漏了）。
  //   判据真源 `showsJumpToLatest` 不变（本行只加过渡）。
  ['components/TerminalSheet.ets', 2],
  // 会话统计面板（目标④「统计插件的面板我们看不到」）：同样走 `sheetTransition()`。
  ['components/SessionStatsSheet.ets', 1],
  // 定时任务详情（目标④「任务管理做的很差」收尾）：同样只走 `sheetTransition()`
  //   —— 全站面板入场语言唯一那一套（⛔ 不自造第二套）。
  ['components/CronDetailSheet.ets', 1],
  ['components/TodoPanel.ets', 2],     // ① 属性动画 `.animation(animFast())`（`chevron_right` 的 `rotate 0→90`）
                                       //   —— **必须留**（2026-10-11 动效审计逐处判）：它讲的是**展开/收起的
                                       //   **方向状态变化**，删了箭头会"跳"；web `TodoPullOut.tsx` 同款有过渡。
                                       // ② 2026-10-12：展开态清单块 `.transition(fadeTransition())` —— 讲的是
                                       //   **展开/收起**（web 同处在 `AnimatedCollapse` 内，是 `opacity 180ms`
                                       //   出现过渡）；静息态恒可见 ⇒ fail-safe（门禁 ⑨ 正向形态）。
  // 思考区展开/收起（2026-10-12）—— 此前**硬切**（`if (this.open)` 门控的正文块瞬现瞬消），
  //   而 web `ThinkingLine.tsx:69` 把它放在 `AnimatedCollapse`（`opacity 180ms ease-out` +
  //   CSS grid 高度）里。本波补上 **opacity 那一半**（`.transition(fadeTransition())`，语义
  //   = "内容出现/消失"）；⚠️ **高度不补间**（ArkUI `TransitionEffect` 无尺寸档，SDK 实证）——
  //   诚实记账，不假称与 web 全等。静息态恒可见 ⇒ fail-safe（门禁 ⑨ 正向形态）。
  ['components/ThinkingLine.ets', 1],
  ['components/MessageNav.ets', 1],    // ⚠️ 属性动画（`backgroundColor` + `opacity` 的 idle 40% ↔ 激活 100%）
                                       //   —— **必须留**：状态变化（激活态），且**逐字对齐 web 的 `transition-all`**；
                                       //   删 ⇒ 激活变硬切。两处都**不是**"为动而动"。（`bindPopup` 本体是系统绘制，改不到）
  ['components/Lightbox.ets', 1],      // 全屏浮层弹出 —— 同上
  ['components/Toast.ets', 1],         // ⚠️ **可删候选**（见报告：web 无对应动画）
  // 页面级（归 main agent 协调）。2026-10-12 +2：会话抽屉 = 遮罩淡入 + 抽屉横向滑入
  //   （**必须留**：抽屉的进出场就是"从左侧滑出/收回"的空间关系；此前**瞬现瞬消**）。
  // 2026-10-12 +1：侧边栏分组箭头的折叠/展开**旋转过渡**（属性动画 `animFast()`）——
  //   讲的是分组收起/展开的方向状态变化（此前瞬变 ⇒ 观感跳）。
  // 2026-10-12 +1（本波，第 5 项新口径下的**第一例**）：composer 主按钮的图标**符号替换**
  //   （`.symbolEffect(new ReplaceSymbolEffect(WHOLE, CROSS_FADE))`）—— 讲的是**同一个按钮**的
  //   语义在「发送 → 插话 → 停止」之间切换（用户要求「busy 时输入文字 ⇒ 按钮变插队/排队」的
  //   视觉落点）；此前是硬切。⛔ 用一次性子类（非循环）⇒ `inflight-single-source.sh` 归 B2。
  // 2026-10-13 +8（目标③「所有面板」+①「丝滑动画」）：**面板内切换语言统一**，全部走既有工厂
  //   （⛔ 零新增曲线对象）：
  //   ① 运行面板 5 个 tab 的内容根（List）×5 + 空态（`PanelEmpty` 的 Column）×1 = 6 处
  //      `.transition(fadeTransition())` —— 讲的是"**tab 分支替换**"这条状态关系（此前切 tab
  //      是瞬变，列表↔空态高度差会"跳"）。用**出现过渡**（静息态恒可见）⇒ 天然 fail-safe。
  //   ② 抽屉分段控件（`项目/状态/时间`）选中态 ×1 + 运行面板 chips 选中态 ×1
  //      `.animation(animBase())` —— 讲的是"**选中项从 A 到 B**"这条状态关系（Apple
  //      `UISegmentedControl` 的选中是渐变、不是硬切）。只动底色/描边 ⇒ 不碰不透明度语义。
  // 2026-10-13 +1（15z12）：运行面板 chips → **下划线页签**（`§21.86`）后，这 1 处 `animBase()`
  //   随形态**保留**在指示器上（只动指示器底色）；另 **模型选择器「思考模式」**由实心芯片 ×4 改
  //   **分段控件**（`§21.87`）⇒ 新增选中段 `.animation(animBase())` ×1（与抽屉那一处同款）。
  //   ⛔ 两处都走既有工厂 `animBase()`（零新增曲线对象）；讲的状态关系 = "选中项从 A 到 B"。
  // 2026-10-13 **+1**：消息列表「回到最新」药丸的**浮现/隐去** = 纯淡入淡出 `fadeTransition()`
  //   —— 与终端面板同款药丸**同一语言**（讲"可回到底部"这条状态的出现/消失，无空间含义 ⇒ 不滑入）；
  //   此前"啪"地出现/消失。静息态 = 组件自身属性 = 可见 ⇒ fail-safe（门禁 ⑨）。
  ['pages/Index.ets', 17],
]);

const root: string = findRoot();
ok('探测到仓库根', root.length > 0);
const ETS: string = path.join(root, 'entry/src/main/ets');
const files: string[] = [];
walk(path.join(ETS, 'components'), files);
const nComp: number = files.length;
walk(path.join(ETS, 'pages'), files);
ok(`零扫描判红：扫到 .ets > 0（实得 ${files.length}）`, files.length > 0);
ok(`零扫描判红：components/** 真扫到文件（${nComp}）`, nComp > 0);
ok(`零扫描判红：pages/** 真扫到文件（${files.length - nComp}）`, files.length - nComp > 0);

const dist: string[] = [];
const undeclared: string[] = [];
const overBudget: string[] = [];
for (const f of files) {
  const rel: string = path.relative(ETS, f).split(path.sep).join('/');
  const src: string = stripComments(fs.readFileSync(f, 'utf8'));
  const n: number = (src.match(/\.transition\(/g) || []).length
    + (src.match(/\.animation\(/g) || []).length
    + (src.match(/animateTo\(/g) || []).length
    + (src.match(/withDelay\(/g) || []).length
    + (src.match(/\.symbolEffect\(/g) || []).length;
  if (n === 0) { continue; }
  dist.push(`${rel}: ${n}（台账 ${BUDGET.has(rel) ? BUDGET.get(rel) : '未登记'}）`);
  if (!BUDGET.has(rel)) { undeclared.push(rel); }
  else if (n > (BUDGET.get(rel) as number)) { overBudget.push(`${rel}: ${n} > 台账 ${BUDGET.get(rel)}`); }
}
console.log(`▶ 动效台账扫描：${files.length} 个 .ets（components ${nComp} + pages ${files.length - nComp}）`);
for (const d of dist) { console.log(`    · ${d}`); }

ok('② 无文件**超出**台账（新增动效必须显式登记）', overBudget.length === 0, overBudget.join('\n      '));
ok('③ 无**未登记**的动效面（新开一面必须来登记理由）', undeclared.length === 0, undeclared.join('\n      '));
// ⛔ 曾试写第 ④ 条"禁 `iterations`/`setInterval(`"—— **已删**：实测那是**误判**。
//    `/...iterations/` 在本仓绝大多数是**数据模型字段**（`row.iterations.length`、`HistoryIteration`），
//    与动画参数 `iterations` **同名不同物**；`setInterval(` 则是**轮询定时器**（LiveTailView/SettingsChannels/
//    SettingsDeveloper/Index），也不是动画。⇒ 把它们并进来会得到一条**永远红的假判据**。
//    "唯一在飞 / 循环动画"已由 `tools/lint/inflight-single-source.sh` 专管 ⇒ **本判据不重复管**。

// ── ④ **具名工厂必须被 ≥1 站点消费**（防"造了工厂没人用"= 死码）────────────────────────
//    `components/anim.ets` 的每个 `export function <name>Transition(` 都必须被 anim.ets **之外**
//    的至少一个文件引用（`this.entryTransition` 这类页面/组件自造的不在此列 —— 只查 anim.ets 的导出）。
{
  const animRel: string = 'components/anim.ets';
  const animSrc: string = stripComments(fs.readFileSync(path.join(ETS, animRel), 'utf8'));
  const names: string[] = [];
  const re = /export function ([A-Za-z0-9_]*Transition)\(/g;
  let m: RegExpExecArray | null = re.exec(animSrc);
  while (m !== null) { names.push(m[1]); m = re.exec(animSrc); }
  ok('④ 在 anim.ets 里找到 ≥1 个 `*Transition()` 具名工厂（零扫描判红）', names.length > 0);
  const others: string = files
    .filter((f: string) => path.relative(ETS, f).split(path.sep).join('/') !== animRel)
    .map((f: string) => stripComments(fs.readFileSync(f, 'utf8')))
    .join('\n');
  for (const n of names) {
    ok(`④ 工厂 \`${n}()\` 被 anim.ets 之外 ≥1 处消费（⛔ 零消费者 = 死码）`, others.indexOf(n + '(') >= 0);
  }
  console.log(`    具名工厂 ${names.length} 个：${names.join(', ')}`);
}

if (fail > 0) { console.log(`  motion_budget: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  motion_budget: ${pass} passed, 0 failed`);
process.exit(0);

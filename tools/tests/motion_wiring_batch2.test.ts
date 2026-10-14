/**
 * 动效**批次 2 接线**契约测试 —— 「展开/收起出现过渡 + 主按钮符号替换」（2026-10-12）。
 *
 * 动机：本仓最危险的缺陷类是「**纯逻辑/公共件已就绪、UI 却 0 消费**」（AGENTS.md『死消费』）——
 *   动效尤其如此：`motion_budget` 只保证"台账不超 + 工厂被 ≥1 处消费"，**不保证"那一处"是
 *   真正该动的地方**；把 `.transition(fadeTransition())` 挂到无关元素上同样能骗过它。
 *   ⇒ 本单钉**形态契约**（在**哪个块**里、挂给**谁**、**走哪个出口**），与 `collapse_all_wiring`
 *   同款（组件/页面不进离线 harness ⇒ 读真实源码断言）。
 *
 * 覆盖三处（每处都有 web 权威对照，见 `docs/WEB-ALIGNMENT.md §21.22`）：
 *   ① `components/ThinkingLine.ets` 展开体 = 出现过渡（web `ThinkingLine.tsx:69` 的 `AnimatedCollapse`）
 *   ② `components/TodoPanel.ets` 展开块 = 出现过渡（web `TodoPullOut.tsx:125` 的 `AnimatedCollapse`）
 *   ③ `pages/Index.ets` composer 主按钮 = **符号替换**（Apple SF Symbols replace；三态发送/插话/停止）
 *
 * ⛔ 判据纪律（AGENTS.md「判据 ≠ 信号」）：
 *   · **先剥注释**（本仓用注释记录"为什么不用某做法"，朴素 grep 会把文档当违规）；
 *   · **只取调用片段 / 区间**（不"取整行猜"）；
 *   · **零扫描判红**（读不到源 / 0 命中 ⇒ 红，白绿防线）；
 *   · 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 *
 * **mutation 自证**（改完应各红一条）：
 *   · 删 `ThinkingLine.ets` 的 `.transition(fadeTransition())` ⇒ ① 红；
 *   · 把 `fadeTransition()` 换成就地 `.transition(TransitionEffect.OPACITY…)` ⇒ ① 红（并经 motion_uniform 规则 D）；
 *   · 删 `TodoPanel.ets` 的 `.transition(fadeTransition())` ⇒ ② 红；
 *   · 把 `ReplaceEffectType.CROSS_FADE` 改回默认（删该参数）⇒ ③ 红（三枚符号**彼此无关**，
 *     `SEQUENTIAL` 不适用 —— 这是**语义正确性**，不是风格）。
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

/** 剥 `//` 与 `/* *\/` 注释 —— 只判**代码**。 */
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

/** 探测仓库根（含 `entry/src/main/ets/components/anim.ets` 的那层）。 */
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components/anim.ets'))) { return p; }
  }
  return '';
}

const root: string = findRoot();
ok('探测到仓库根（含 anim.ets）', root.length > 0);
const ETS: string = path.join(root, 'entry/src/main/ets');

function read(p: string): string {
  try { return stripComments(fs.readFileSync(p, 'utf8')); } catch (e) { return ''; }
}

// ── ① ThinkingLine：展开体 = 出现过渡（走底座唯一出口）─────────────────────────
{
  const rel: string = 'components/ThinkingLine.ets';
  const src: string = read(path.join(ETS, rel));
  ok(`① ${rel} 读到源码（零扫描判红）`, src.length > 0);
  // 消费底座出口，⛔ 不自造过渡
  ok(`① ${rel} import 了底座出口 \`fadeTransition\`（⛔ 不自造就地过渡）`,
    /import\s*\{[^}]*\bfadeTransition\b[^}]*\}\s*from\s*'\.\/anim'/.test(src));
  // 区间断言：必须挂在 **展开体** 那个 `if (this.open …)` 块内（取 `if` 起点 → 其闭合 `}` 前的窗口）
  const anchor: string = 'if (this.open && this.body.length > 0) {';
  const ai: number = src.indexOf(anchor);
  ok(`① ${rel} 有展开体门控 \`${anchor}\`（形态未漂移）`, ai >= 0);
  const win: string = ai >= 0 ? src.substring(ai, ai + 3000) : '';
  // ── 2026-10-16 升级（§21.122bw）：过渡必须**只给用户点击的开合** ────────────────────
  // ⛔ 用户亲报「stream 下一个迭代时，展开的上一迭代思考区时不时闪烁」：真机探针实证每个迭代 commit
  //    那一刻思考块在「live 槽 ↔ 已完成槽」换位 ⇒ 新实例以 `open=true` 挂载 ⇒ 旧写法（裸
  //    `.transition(fadeTransition())`）把过渡当"插入"**重放** ⇒ 淡入一下 = 闪烁。
  // ⇒ 形态升级为「`animReady` 门控」：挂载那一帧走 IDENTITY（无过渡），下一拍才允许过渡。
  //    本判据同时钉住**门控存在**与**门控对象仍是底座出口**（⛔ 不自造就地过渡）。
  const gated: RegExp = /\.transition\(this\.animReady \? fadeTransition\(\) : TransitionEffect\.IDENTITY\)/;
  ok(`① ${rel} 展开体过渡由 \`animReady\` 门控（挂载那一帧 IDENTITY ⇒ commit 交接零闪烁）`, gated.test(win));
  ok(`① ${rel} 有 \`animReady\` 状态位（\`@State private animReady: boolean = false\` = 挂载那一帧不播）`,
    /@State\s+private\s+animReady:\s*boolean\s*=\s*false/.test(src));
  // mutation 自证（判别力）：旧写法（裸 `.transition(fadeTransition())`）必须被本判据判红
  ok(`① ${rel} mutation：裸 \`.transition(fadeTransition())\`（挂载即重放 ⇒ 闪烁）必红`,
    gated.test('          .transition(fadeTransition())') === false);
  // ⛔ 反面形态：静息态不得由动画决定（旧缺陷的真根因，用户亲报正文被压到 ≈13%）
  ok(`① ${rel} ⛔ 展开体不得出现 \`animateTo(\`（静息态不得是动画的函数）`,
    win.indexOf('animateTo(') < 0);
}

// ── ② TodoPanel：展开块 = 出现过渡（同一个具名工厂）──────────────────────────
{
  const rel: string = 'components/TodoPanel.ets';
  const src: string = read(path.join(ETS, rel));
  ok(`② ${rel} 读到源码（零扫描判红）`, src.length > 0);
  ok(`② ${rel} import 了底座出口 \`fadeTransition\``,
    /import\s*\{[^}]*\bfadeTransition\b[^}]*\}\s*from\s*'\.\/anim'/.test(src));
  const anchor: string = 'if (this.expanded) {';
  const ai: number = src.indexOf(anchor);
  ok(`② ${rel} 有展开门控 \`${anchor}\``, ai >= 0);
  const win: string = ai >= 0 ? src.substring(ai, ai + 4000) : '';
  ok(`② ${rel} 展开块挂着 .transition(fadeTransition())`, win.indexOf('.transition(fadeTransition())') >= 0);
}

// ── ③ Index：composer 主按钮 = 符号替换（三态发送/插话/停止）──────────────────
{
  const rel: string = 'pages/Index.ets';
  const src: string = read(path.join(ETS, rel));
  ok(`③ ${rel} 读到源码（零扫描判红）`, src.length > 0);
  // 定位主按钮的图标三态（`bolt_fill` 是插话态的独有字形）⇒ 在其后窗口内断言
  const anchor: string = "sys.symbol.bolt_fill";
  const ai: number = src.indexOf(anchor);
  ok(`③ ${rel} 有插话态字形 \`${anchor}\`（主按钮三态锚点）`, ai >= 0);
  const win: string = ai >= 0 ? src.substring(ai, ai + 900) : '';
  ok(`③ ${rel} 主按钮 SymbolGlyph 挂着 \`.symbolEffect(new ReplaceSymbolEffect(\``,
    win.indexOf('.symbolEffect(new ReplaceSymbolEffect(') >= 0);
  // ⚠️ 语义正确性：三枚符号**彼此无关** ⇒ 必须显式 CROSS_FADE（默认 SEQUENTIAL 不适用）
  ok(`③ ${rel} 符号替换显式选 \`ReplaceEffectType.CROSS_FADE\``,
    win.indexOf('ReplaceEffectType.CROSS_FADE') >= 0);
}

if (fail > 0) { console.log(`  motion_wiring_batch2: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  motion_wiring_batch2: ${pass} passed, 0 failed`);
process.exit(0);

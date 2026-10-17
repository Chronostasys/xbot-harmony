/**
 * todo_row_menu —— Todo 行 `⋯` 菜单的「设为目标」动作契约（2026-10-13，15q）。
 *
 * ── 为什么需要它（目标④「任务管理做的很差」）──────────────────────────────────
 * 本仓 `components/TodoPanel.ets` 是 web `components/agent/TodoPullOut.tsx` 的同构件。
 * 逐条对照后发现 `⋯` 菜单（web 触屏分支 `:272-330`）**少一项**：
 *   web = **设为目标 / 编辑 / 删除**（`:300-321`，图标 Target/Pencil/Trash2）
 *   原生 = 编辑 / 删除（缺「设为目标」⇒ 用户只能先清目标再用 🎯 重设，多两步）
 * ⇒ 本判据钉死"菜单三项 + 能力开关 + 宿主接线"三件事。
 *
 * ── 判据形态（⛔ 只钉**调用片段 / 调用点计数**，不钉"某名字在文件里出现过"）────
 *   R1 `⋯` 菜单三项各**恰好一处** `Text('<标签>')`（多一处 = 复制粘贴出来的重复项）。
 *   R2 「设为目标」项**受 `if (this.canSetGoal)` 守卫**（web `:300` `{onSetGoalTodo && …}`）。
 *   R3 三项各带图标（⛔ 用本仓**已存在**的 `sys.symbol.*`：`dart_target`/`square_and_pencil`/`trash`
 *      —— `pencil` 本仓 0 次出现，属未验证符号，禁引）。
 *   R4 宿主**真的接上了**：`pages/Index.ets` 同时出现 `canSetGoalTodo: true` 与 `onSetGoalTodo:`
 *      （⛔ 只查 `TodoPanel` 侧会出现"组件有、页面没接"的**死消费**假绿）。
 *   R5 回调接到**既有出口** `this.handleSetGoal(...)`（⛔ 不新造第二条 set_goal 通路）。
 *
 * ── 判别力自证（扫描器自证，mutation 等价物）──────────────────────────────────
 *   把真源码里 `Text('设为目标')` 替换成 `Text('xxxx')` ⇒ `countCall` 必须从 1 掉到 0（本文件内自证）。
 *   ⛔ 共享工作树里**不做**"改真源码再改回来"的注入-回滚。
 *
 * 剥注释：`//` 与 `/* … *\/` 都要剥（本文件的理由注释里就写着 `Text('设为目标')` 字样，
 * 不剥会把**文档**当违规）。走带字符串态的小状态机（⛔ 不能裸 `split('//')`：
 * `'sys.symbol.xmark'` 之类的字符串会被误剥）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; resolve(...parts: string[]): string };
declare const __dirname: string;
export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`);
  }
}

const fsMod = require('fs');
const __origRead = fsMod.readFileSync;
fsMod.readFileSync = (p: string, e: string): string => __origRead(p, e).replace(/i18nT\(([^()]*)\)/g, '$1');

const pathMod = require('path');

/** 仓库根（harness 把测试编译到 `tools/tests/.out-<pid>/` ⇒ 逐级上探；同 `panel_surface_consistency`）。 */
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/components'))) {
      return p;
    }
  }
  return '';
}
const ROOT: string = findRoot();
ok('探测到仓库根（零扫描判红）', ROOT.length > 0);

/**
 * 剥注释（保留字符串字面量内容）：`//` 行注释 + 块注释（星号斜杠）都剥。
 * 状态：0=代码 1=单引号串 2=双引号串 3=模板串。
 */
function stripComments(src: string): string {
  let out = '';
  let state = 0;
  for (let i = 0; i < src.length; i++) {
    const c: string = src[i];
    const d: string = i + 1 < src.length ? src[i + 1] : '';
    if (state === 0) {
      if (c === '/' && d === '/') {
        while (i < src.length && src[i] !== '\n') {
          i++;
        }
        out += '\n';
      } else if (c === '/' && d === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && i + 1 < src.length && src[i + 1] === '/')) {
          i++;
        }
        i++;
        out += ' ';
      } else if (c === "'") {
        state = 1;
        out += c;
      } else if (c === '"') {
        state = 2;
        out += c;
      } else if (c === '`') {
        state = 3;
        out += c;
      } else {
        out += c;
      }
    } else if (state === 1) {
      out += c;
      if (c === '\\') {
        out += d;
        i++;
      } else if (c === "'") {
        state = 0;
      }
    } else if (state === 2) {
      out += c;
      if (c === '\\') {
        out += d;
        i++;
      } else if (c === '"') {
        state = 0;
      }
    } else {
      out += c;
      if (c === '\\') {
        out += d;
        i++;
      } else if (c === '`') {
        state = 0;
      }
    }
  }
  return out;
}

/**
 * `<标签>` 的 `Text('<标签>')` **调用点计数**（⛔ 不是"标签字样出现过"）。
 * ⛔ 必须带**词边界** `(?<![A-Za-z])`：`accessibilityText('设为目标')` 的**后缀**恰好是
 *    `Text('设为目标')` ⇒ 不设边界会把它误计成第二个菜单项（本判据首轮就踩了，实际 2 处假阳）。
 */
function countCall(src: string, label: string): number {
  const re = new RegExp('(?<![A-Za-z])Text\\(\'' + label + '\'\\)', 'g');
  const m: string[] | null = src.match(re);
  return m === null ? 0 : m.length;
}

const panelPath: string = pathMod.join(ROOT, 'entry/src/main/ets/components/TodoPanel.ets');
const idxPath: string = pathMod.join(ROOT, 'entry/src/main/ets/pages/Index.ets');
const panelRaw: string = fsMod.existsSync(panelPath) ? fsMod.readFileSync(panelPath, 'utf8') : '';
const idxRaw: string = fsMod.existsSync(idxPath) ? fsMod.readFileSync(idxPath, 'utf8') : '';
ok('TodoPanel.ets / Index.ets 可读（零扫描判红）', panelRaw.length > 0 && idxRaw.length > 0);

const panel: string = stripComments(panelRaw);
const idx: string = stripComments(idxRaw);

/** 取 `name() { … }` 这一个 builder 的**源码切片**（花括号配平）——判据只在这一段里数。 */
function sliceBuilder(src: string, name: string): string {
  const at: number = src.indexOf(name + '() {');
  if (at < 0) {
    return '';
  }
  let i: number = src.indexOf('{', at);
  const start: number = i;
  let depth: number = 0;
  for (; i < src.length; i++) {
    const c: string = src[i];
    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        break;
      }
    }
  }
  return src.slice(start, i + 1);
}
const menu: string = sliceBuilder(panel, 'RowMenu');
ok('切到 RowMenu 段（零扫描判红）', menu.length > 0);

// ── R1：`⋯` 菜单三项各恰好一处 ────────────────────────────────────────────────
for (const lab of ['设为目标', '编辑', '删除']) {
  const n: number = countCall(panel, lab);
  ok(`菜单项「${lab}」恰好 1 处 Text 调用`, n === 1, `  实际 ${n} 处`);
}

// ── R2：「设为目标」受能力开关守卫 ─────────────────────────────────────────────
ok('「设为目标」项受 `if (this.canSetGoal)` 守卫', panel.indexOf('if (this.canSetGoal)') >= 0);

// ── R3：菜单三项**纯文字** + 取板调用点 ≤ 3（性能预算⑦按**调用点**计数）────────
// ⚠️ 判据演进（15q，2026-10-13）：初版给三项各配图标（web `Target/Pencil/Trash2`）⇒ 每项 2 次取板
//    （图标色 + 文字色）、共 6 次 ⇒ **门禁⑦红**：`this.pal()` 1251 > 1250、`pal()∨palOnce()` 1353 > 1350。
//    该预算「⛔ 只许减」⇒ 去掉图标（纯文字菜单，与本组件原设计一致）、并把一处**双读三元**
//    （`cond ? this.pal().textPrimary : this.pal().textMuted`）降为单读
//    （`colorOf(this.pal(), cond ? 'textPrimary' : 'textMuted')`）⇒ 计数回到基线。
ok('菜单项不含图标符号（避免每项两次取板）',
  !/sys\.symbol\.(dart_target|square_and_pencil|trash)/.test(menu));
const menuPal: number = (menu.match(/this\.pal\(\)/g) || []).length;
ok('菜单取板调用点 ≤ 3（= 三项各一次）', menuPal <= 3, `  实际 ${menuPal} 次`);

// ── R4：宿主真的接上了（防"组件有、页面没接"的死消费）─────────────────────────
ok('宿主传能力开关 `canSetGoalTodo: true`', idx.indexOf('canSetGoalTodo: true') >= 0);
ok('宿主传回调 `onSetGoalTodo:`', idx.indexOf('onSetGoalTodo:') >= 0);

// ── R5：回调走**既有** set_goal 出口 ─────────────────────────────────────────
ok('回调接到既有出口 handleSetGoal', idx.indexOf('this.handleSetGoal(t)') >= 0);

// ── 扫描器自证（mutation 等价物）：删掉菜单项 ⇒ 调用点计数必掉到 0 ───────────────
const mutated: string = panel.replace('Text(\'设为目标\')', 'Text(\'xxxx\')');
ok('自证：注入后「设为目标」调用点计数 = 0', countCall(mutated, '设为目标') === 0);
ok('自证：注入未波及「编辑」/「删除」', countCall(mutated, '编辑') === 1 && countCall(mutated, '删除') === 1);

console.log(`\ntodo_row_menu.test: ${pass} passed / ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
process.exit(0);

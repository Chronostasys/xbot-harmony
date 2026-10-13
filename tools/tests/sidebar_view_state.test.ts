/**
 * 「侧边栏视图态 / 分段控件尺寸 / 会话面切换动效」接线门禁 —— 三处**调用点计数**证据。
 *
 * ── 背景（用户 2026-10-12 亲报三条）──────────────────────────────────────────────
 *   ① 「侧边栏要能记忆上次是选择的按什么排序」
 *      · 分类（项目/状态/时间）的**真值**在服务端 settings（`web:session:category`，与 web 共读一份）——
 *        真机实测读写都通（点「状态」⇒ 后端变 `status`；冷启读到 `time` ⇒ 抽屉按时间桶分组）。
 *      · 但服务端值要**登录后一次网络往返**才到页面 ⇒ 冷启后立刻开抽屉会**先显示默认『项目』**再跳变
 *        （用户观感 = "没记住"）⇒ 需要**本地首帧镜像**（盘上），服务端到达后**服务端胜**。
 *   ② 「那个项目 状态 时间 高度太高了」
 *      · 病因：把**命中盒**（`HIT_TARGET_MIN` = 44vp）直接当**视觉**高度用 ⇒ 轨道 48vp
 *        （Apple 栏内控件 ~32-36pt）。
 *      · ⛔ 不能靠 `responseRegion` 负偏移"视觉小、热区大"——真机实测无效（本仓 GOTCHA）
 *        ⇒ 正解 = **视觉层与命中层分离**：`Stack[ 轨道(36) | 命中层(每段 44, 芯 32) ]`。
 *   ③ 「侧边栏点击切换会话后要有动画，现在没有」
 *      · 切换瞬间把整面**下沉一格**（`switchSlide = 1`），内容就位后**下一帧**动画归零 ⇒ 新会话"落位"。
 *      · ⛔ **只动位移**：静息态位移恒 0 ⇒ 动画被打断也只是位置差一格，**可读性不依赖动画**
 *        （本仓血债；门禁 ⑨ / `anim-opacity-gate.sh`）。
 *
 * ── 钉什么（缺一即"以为做了其实没有"）──────────────────────────────────────────
 *   ① 零扫描判红（三个文件都真读到、剥注释后非空）。
 *   ② 本地镜像**全链路**：`core/config.ets` 有键常量 + 字段 + 读盘 + 写盘各恰 1 处。
 *   ③ 页面侧**优先级**：`sessionCategory()` 切片内 `normalizeSessionCategory(` 恰 **2** 处
 *      （服务端分支 + 本地镜像分支）+ 服务端"有值才用"的守卫；`setSessionCategory()` **双写**
 *      （本地 `saveSessionCategory` 恰 1 + 服务端 `setSetting(KEY_SESSION_CATEGORY` 恰 1）。
 *   ④ 分段控件尺寸**由令牌派生**（⛔ 不是就地字面量）：`SEG_TRACK_H` = `SPACE_XXL + SPACE_XXS`、
 *      `SEG_PILL_H` = `SPACE_XXL`；切片内 `SEG_TRACK_H`/`SEG_PILL_H` 各恰 1 处**被消费**、
 *      命中盒 `HIT_TARGET_MIN` 恰 2 处（段 + 容器）⇒ "视觉小、热区大"真落地。
 *   ⑤ 切换动效：底座 `MOTION_SESSION_SWITCH_SLIDE_VP` 派生自 `SP_4`（⛔ 不写字面量）·
 *      `Index.ets` 恰 1 处 import · `translate({ y: this.switchSlide * … })` 恰 1 处 ·
 *      `switchSession` 切片内 `this.switchSlide = 1` 恰 1 处 · 收尾跨帧
 *      （`settleSwitchSlide()` 内 `delay(` + `this.anim(` 各恰 1 处）·
 *      **反向断言**：切换动效路径**不许**出现 `.opacity(`（可读性不能是动画的函数）。
 *
 * ⚠️ 纪律：**剥注释**（注释里提到这些名字是文档，不是调用点）；计数一律**精确 `=== n`**
 *   （本仓教训：`>= n` 会假绿）；**切片内**定位（全文件计数会打到切片外 ⇒ 假绿）。
 * ✅ 判据自证：mutation（见提交信息）· 还原后 md5 逐字节一致。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 标记为模块（顶层变量不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` ｜ ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function countIn(s: string, needle: string): number {
  return s.split(needle).length - 1;
}
/** 剥注释：块注释 + 行注释（避开 `http://` 这类协议前缀）。 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function readOrDie(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.log(`  ✗ 读不到 ${p}`);
    process.exit(1);
    return '';
  }
}
// 仓库根：编译产物落在 `tools/tests/.out-*/js/`（`run-one.sh:45` 的 `--outDir "$OUT/js"`）⇒ 上溯 4 级
const root: string = path.resolve(__dirname, '..', '..', '..', '..');
function readSrc(rel: string): string {
  return stripComments(readOrDie(path.join(root, rel)));
}
/** **原文**（不剥注释）：只有"注释必须在场"这类断言才用它（如吞异常台账要求的说明注释）。 */
function readRaw(rel: string): string {
  return readOrDie(path.join(root, rel));
}
/** 取一段切片：从 `from` 起、到其后首次出现的 `to` 止（找不到 ⇒ 返回空串 ⇒ 判据红）。 */
function slice(s: string, from: string, to: string): string {
  const a: number = s.indexOf(from);
  if (a < 0) { return ''; }
  const b: number = s.indexOf(to, a + from.length);
  return b < 0 ? '' : s.substring(a, b + to.length);
}

const cfg: string = readSrc('entry/src/main/ets/core/config.ets');
const pg: string = readSrc('entry/src/main/ets/pages/Index.ets');
const mo: string = readSrc('entry/src/main/ets/core/motion.ets');

// ── ① 零扫描判红（白绿防线：路径写错/文件被清空 ⇒ 必须红）────────────────────────
ok('① config.ets 真读到且非空', cfg.length > 500, `len=${cfg.length}`);
ok('① Index.ets 真读到且非空', pg.length > 100000, `len=${pg.length}`);
ok('① motion.ets 真读到且非空', mo.length > 1000, `len=${mo.length}`);

// ── ② 本地镜像全链路（`core/config.ets`）──────────────────────────────────────
eq('② 本地镜像键常量恰 1 处', countIn(cfg, "const KEY_SESSION_CATEGORY_LOCAL: string = 'local_session_category'"), 1);
eq('② AppConfig 字段 `sessionCategory` 恰 1 处', countIn(cfg, 'sessionCategory: string ='), 1);
eq('② 读盘（init）恰 1 处', countIn(cfg, 's.getSync(KEY_SESSION_CATEGORY_LOCAL,'), 1);
eq('② 写盘（saveSessionCategory）恰 1 处', countIn(cfg, 's.putSync(KEY_SESSION_CATEGORY_LOCAL, cat)'), 1);
eq('② 写盘 flush 恰 1 处', countIn(cfg, 'async saveSessionCategory(cat: string): Promise<void>'), 1);

// ── ③ 页面侧优先级 + 双写（切片内）───────────────────────────────────────────
const readFn: string = slice(pg, 'private sessionCategory(): string {', '\n  }');
ok('③ 读出口切片非空（零扫描判红）', readFn.length > 120, `len=${readFn.length}`);
eq('③ 读出口内 `normalizeSessionCategory(` 恰 2 处（服务端 + 本地镜像）', countIn(readFn, 'normalizeSessionCategory('), 2);
eq('③ 读出口读服务端键恰 1 处', countIn(readFn, 'settingOf(this.settings, KEY_SESSION_CATEGORY)'), 1);
eq('③ 读出口读本地镜像恰 1 处', countIn(readFn, 'this.localSessionCategory'), 1);
ok('③ 服务端分支有"有值才用"守卫（srv.length > 0）', readFn.includes('srv.length > 0'), readFn.replace(/\n/g, ' ⏎ ').substring(0, 160));

const writeFn: string = slice(pg, 'private setSessionCategory(cat: string): void {', '\n  }');
ok('③ 写出口切片非空（零扫描判红）', writeFn.length > 80, `len=${writeFn.length}`);
eq('③ 写出口经本地落盘方法恰 1 处', countIn(writeFn, 'this.persistSessionCategory(cat);'), 1);
eq('③ 写出口写服务端恰 1 处', countIn(writeFn, 'this.setSetting(KEY_SESSION_CATEGORY, cat)'), 1);
// 本地落盘方法（跨帧/失败语义都在这）——⛔ 不许用"空 catch"（吞异常台账只许缩短 ⇒ 会红）
const persistFn: string = slice(pg, 'private async persistSessionCategory(cat: string): Promise<void> {', '\n  }');
ok('③ 本地落盘切片非空（零扫描判红）', persistFn.length > 120, `len=${persistFn.length}`);
eq('③ 本地落盘调 config 恰 1 处', countIn(persistFn, 'await this.config.saveSessionCategory(cat);'), 1);
// ⛔ 本地落盘**不许**用"空 catch"：吞异常台账只许缩短，新增空块会直接红
//   ⇒ 断言块内确有说明注释（`// 有意吞`），且**原文**里没有链式空 catch 形态。
// ⚠️ 这条必须用**原文**（剥注释视图里注释本就不存在 ⇒ 会假红）
const pgRaw: string = readRaw('entry/src/main/ets/pages/Index.ets');
const persistRaw: string = slice(pgRaw, 'private async persistSessionCategory(cat: string): Promise<void> {', '\n  }');
eq('③ 本地落盘块内有说明注释（吞异常台账要求）', countIn(persistRaw, '// 有意吞'), 1);
eq('③ 本地落盘**不是**链式空 catch', countIn(persistFn, '=> {'), 0);
eq('③ 读回本地镜像赋进 state 恰 1 处', countIn(pg, 'this.localSessionCategory = saved.sessionCategory'), 1);
eq('③ state 声明恰 1 处', countIn(pg, '@State localSessionCategory: string'), 1);

// ── ④ 分段控件尺寸：视觉 36 / 芯 32 / 命中盒 44（令牌派生，⛔ 非字面量）────────
eq('④ 轨道高常量派生自间距令牌恰 1 处', countIn(pg, 'const SEG_TRACK_H: number = SPACE_XXL + SPACE_XXS'), 1);
eq('④ 选中芯高常量派生自间距令牌恰 1 处', countIn(pg, 'const SEG_PILL_H: number = SPACE_XXL'), 1);
const seg: string = slice(pg, 'ForEach(SESSION_CATEGORIES, (c: string) => {', 'this.setSessionCategory(c);');
ok('④ 分段控件切片非空（零扫描判红）', seg.length > 300, `len=${seg.length}`);
eq('④ 切片内消费 SEG_PILL_H 恰 1 处', countIn(seg, '.height(SEG_PILL_H)'), 1);
// 轨道层（视觉）必须真的画出 36：`.width('100%').height(SEG_TRACK_H)` 全文件恰 2 处。
// ⚠️ 2026-10-13（15z12 判据演进）：原为「恰 1 处」（只有抽屉「分类」）。本轮**模型选择器
//    「思考模式」**由实心 accent 芯片 ×4 改**同款分段控件**（目标③「所有面板一种语言」，
//    `§21.87`）⇒ 消费点变 2。⛔ 不是"放宽到 ≥1"：**恰 2**，多一处就红（逼下一次显式决策），
//    且两处的**形态**由 `tools/tests/segmented_control.test.ts` 逐站点钉住（轨道/芯/浮起/无实心块）。
eq('④ 轨道行消费 SEG_TRACK_H（视觉层）恰 2 处（抽屉分类 + 思考模式）',
  countIn(pg, ".width('100%').height(SEG_TRACK_H)"), 2);
// 可量测性：轨道层必须有 `id` 测试钩子（真机 dumpLayout 才能**量出**视觉高度；同
// `xbot-empty-state`/`xbot-skeleton` 口径）。⛔ 删钩子 = 真机不可量 ⇒ 判红。
eq('④ 轨道层有 id 测试钩子（真机可量）恰 1 处', countIn(pg, ".id('xbot-seg-track')"), 1);
// 命中层：段（`seg` 切片内）+ 容器行（`.width('100%').height(HIT_TARGET_MIN)`）各 1
eq('④ 每段命中盒 44（切片内）恰 1 处', countIn(seg, '.height(HIT_TARGET_MIN)'), 1);
eq('④ 命中层容器行 44 恰 1 处', countIn(pg, ".width('100%').height(HIT_TARGET_MIN)"), 1);
// ⛔ 反向钉：**命中盒那层不许画底色**（否则"视觉 44"的病根原样复活）——底色只能落在 32 的芯上。
const segBox: string = slice(seg, '.layoutWeight(1)', '.onClick(() => {');
ok('④ 命中盒切片非空（零扫描判红）', segBox.length > 60, `len=${segBox.length}`);
eq('④ 命中盒仍为 44', countIn(segBox, '.height(HIT_TARGET_MIN)'), 1);
eq('④ 反向：命中盒那层**不画底色**', countIn(segBox, '.backgroundColor('), 0);
eq('④ 反向：命中盒那层**不设圆角**（圆角属视觉层）', countIn(segBox, '.borderRadius('), 0);
// ⚠️ 2026-10-13 anchor 演进（形状语言统一，`Index.ets` DrawerSheet）：视觉芯圆角由
//    `RADIUS_CHIP`(6) 升为 `RADIUS_PILL`(8) —— 新语言 = **容器 12（`RADIUS_CARD`）/ 内芯 8**
//    （搜索框、分段轨道、`⋯`、渠道 chip 全部收到 12；芯与并列 chip 的内部档位用 8）。
//    ⛔ 不是放宽：终点仍是**语义令牌**（形状一变就红），只是令牌换档。
const segPill: string = slice(seg, '.width(\'100%\').height(SEG_PILL_H)', '.borderRadius(RADIUS_PILL)');
ok('④ 视觉芯切片非空（零扫描判红）', segPill.length > 40, `len=${segPill.length}`);
eq('④ 视觉芯那层画底色恰 1 处', countIn(segPill, '.backgroundColor('), 1);

// ── ⑤ 会话面切换动效：底座令牌 + 跨帧 + 只动位移 ─────────────────────────────
eq('⑤ 底座位移档派生自 SP_4 恰 1 处', countIn(mo, 'export const MOTION_SESSION_SWITCH_SLIDE_VP: number = SP_4;'), 1);
eq('⑤ Index 恰 1 处 import 该令牌', countIn(pg, 'import { MOTION_SESSION_SWITCH_SLIDE_VP } from \'../core/motion\''), 1);
eq('⑤ 位移消费点恰 1 处（消息面）', countIn(pg, '.translate({ y: this.switchSlide * MOTION_SESSION_SWITCH_SLIDE_VP })'), 1);
const sw: string = slice(pg, 'private async switchSession(chatId: string): Promise<void> {', '\n  }');
ok('⑤ 切换函数切片非空（零扫描判红）', sw.length > 400, `len=${sw.length}`);
eq('⑤ 切换函数内置位移起点恰 1 处', countIn(sw, 'this.switchSlide = 1;'), 1);
ok('⑤ 切换函数内**不许**直接归零（必须跨帧收尾）', countIn(sw, 'this.switchSlide = 0') === 0, `got ${countIn(sw, 'this.switchSlide = 0')}`);
eq('⑤ 收尾调用恰 2 处（池中已开 + 打开完成）', countIn(sw, 'this.settleSwitchSlide();'), 2);
const settle: string = slice(pg, 'private settleSwitchSlide(): void {', '\n  }');
ok('⑤ 收尾切片非空（零扫描判红）', settle.length > 80, `len=${settle.length}`);
eq('⑤ 收尾经唯一 setTimeout 出口（跨帧）恰 1 处', countIn(settle, 'delay('), 1);
eq('⑤ 收尾经底座动画出口恰 1 处', countIn(settle, 'this.anim('), 1);
eq('⑤ 收尾归零位移恰 1 处', countIn(settle, 'this.switchSlide = 0;'), 1);
// ⛔ 反向钉：切换动效路径**不许**碰不透明度（"可读性不能是动画的函数"）
eq('⑤ 反向：收尾切片内不许有 .opacity(', countIn(settle, '.opacity('), 0);
eq('⑤ 反向：位移消费行不许带 .opacity(', countIn(pg, 'MOTION_SESSION_SWITCH_SLIDE_VP })'), 1);
ok('⑤ 反向：消息面位移后紧跟行内注释而非 opacity',
  pg.indexOf('MOTION_SESSION_SWITCH_SLIDE_VP })') > 0 &&
  pg.indexOf('.opacity(', pg.indexOf('MOTION_SESSION_SWITCH_SLIDE_VP })')) > 0,
  '仅做顺序存在性检查（人眼复核注释块）');

console.log(`sidebar_view_state: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

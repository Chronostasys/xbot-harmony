/**
 * 自绘 toast 门禁 —— `core/toast.ets` 的**时长档 / 文案 / 单槽语义 / 静息可见性**。
 *
 * 为什么必须有守护：toast 是**瞬时面**，它的三类错都**不会编译报错**、只在真机可见：
 *   ① 时长裸字面量（`2000/2500`）⇒ 与 web 复制反馈（1200ms）不同节拍；
 *   ② **陈旧计时器误杀新 toast**（A 未撤、B 已盖、A 的定时器到点把 B 提前清掉）；
 *   ③ 把"显示/隐藏"写成**动画状态**（门禁 ⑨ A1 硬红）⇒ 动画被打断就永久不可读。
 * ⇒ 全部钉成断言 + mutation。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`tools/tests/run.sh` 逐文件 `node`）。
 * ⚠️ 本文件有 `import`（⇒ TS 模块）；顶层 `declare const` 不会与其它"无 import 的全局脚本"
 *    测试撞名（本仓已入库 GOTCHA：无 import/export 的测试会被当**全局脚本**）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

import {
  TOAST_KIND_COPY, TOAST_KIND_NOTICE, TOAST_KIND_NOTICE_ERR, TOAST_KIND_NOTICE_OK,
  TOAST_MS_COPY, TOAST_MS_NOTICE, TOAST_MS_NOTICE_ERR, TOAST_MS_NOTICE_OK,
  emptyToast, nextToast, toastDurationMs, toastExpired, toastLabel, toastVisible,
} from '../../entry/src/main/ets/core/toast';
import { COPY_FEEDBACK_MS } from '../../entry/src/main/ets/core/feedback';
import { ORB_BREATH_MS } from '../../entry/src/main/ets/core/orb';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── ⓪ 时长档：**全部派生自底座，零裸数字** ────────────────────────────────────
{
  eq('复制档 = COPY_FEEDBACK_MS（core/feedback）', TOAST_MS_COPY, COPY_FEEDBACK_MS);
  eq('  = 1200（web MarkdownRenderer.tsx:364 逐值）', TOAST_MS_COPY, 1200);
  eq('一般档 = ORB_BREATH_MS（core/orb，在飞主呼吸 1×）', TOAST_MS_NOTICE, ORB_BREATH_MS);
  eq('  = 2560', TOAST_MS_NOTICE, 2560);
  eq('copy ⇒ 复制档', toastDurationMs(TOAST_KIND_COPY), TOAST_MS_COPY);
  eq('notice ⇒ 一般档', toastDurationMs(TOAST_KIND_NOTICE), TOAST_MS_NOTICE);
  eq('未知类别 ⇒ 一般档（保守：宁可多留）', toastDurationMs('???'), TOAST_MS_NOTICE);
  ok('两档不同（否则"档"没有意义）', TOAST_MS_COPY !== TOAST_MS_NOTICE);
}

// ── ① 文案：复制类**恒**统一（不各写一句） ───────────────────────────────────
{
  eq('copy ⇒ 「已复制」（忽略传入文案）', toastLabel(TOAST_KIND_COPY, '随便什么'), '已复制');
  eq('notice ⇒ 原样透传', toastLabel(TOAST_KIND_NOTICE, '保存成功'), '保存成功');
  eq('notice + undefined ⇒ 空串（不抛）', toastLabel(TOAST_KIND_NOTICE, undefined as unknown as string), '');
}

// ── ② 单槽语义：替换 + 版本自增（不排队） ────────────────────────────────────
{
  const e0 = emptyToast();
  eq('空态：无文案、seq=0、不可见', [e0.msg, e0.seq, toastVisible(e0)], ['', 0, false]);

  const t1 = nextToast(e0, TOAST_KIND_COPY, '');
  eq('copy：文案 = 已复制、seq=1、可见', [t1.msg, t1.seq, toastVisible(t1)], ['已复制', 1, true]);

  const t2 = nextToast(t1, TOAST_KIND_NOTICE, '链接打开失败');
  eq('**替换**（不是拼接）、seq=2', t2.msg, '链接打开失败');
  eq('  seq 自增', t2.seq, 2);
  ok('  ⛔ 不含上一条文案（单槽 = 最新者胜）', t2.msg.indexOf('已复制') < 0);

  const t3 = nextToast(t2, TOAST_KIND_NOTICE, '   ');
  eq('空白文案 ⇒ 清空 + seq 自增（使旧计时器失效）', [t3.msg, t3.seq, toastVisible(t3)], ['', 3, false]);
}

// ── ③ **陈旧计时器不误杀**（本判据的核心） ───────────────────────────────────
{
  const a = nextToast(emptyToast(), TOAST_KIND_NOTICE, 'A');      // seq=1
  const b = nextToast(a, TOAST_KIND_NOTICE, 'B');                 // seq=2（盖掉 A）
  eq('A 的计时器到点 ⇒ **不撤**（seq 已变）', toastExpired(b, a.seq), false);
  eq('B 的计时器到点 ⇒ 撤', toastExpired(b, b.seq), true);
  eq('空态 ⇒ 永不"撤"（无可撤）', toastExpired(emptyToast(), 0), false);
}

// ── ★D 组件**源码形态**守卫（组件层不进离线 harness ⇒ 读真实源码；同本仓先例）──────
//
// 三条硬纪律的机器形态：
//   ① **不得**有任何 `.opacity(`（门禁 ⑨ A1 "静息态 = 隐藏"在本文件结构上不可能）——
//      mutation：加回 `@State entered=false` + `.opacity(this.entered ? 1 : 0)` ⇒ 本项必红。
//   ② 必须走 `.transition(toastTransition())`（装饰性出场，fail-safe）。
//   ③ 面/发丝/柔影/字**全走 token**；⛔ 无 `promptAction`/`showToast`（已自绘）、⛔ 无 `setTimeout(`。
{
  let src: string = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up, 'entry/src/main/ets/components/Toast.ets');
    if (fs.existsSync(p)) { src = fs.readFileSync(p, 'utf8'); break; }
  }
  ok('读到 components/Toast.ets 源码', src.length > 0);
  // 只判**代码**（剥注释）：注释里记录"⛔ 不出现 `.opacity(...)`"是文档，不该被判违规。
  let code: string = '';
  let i: number = 0;
  while (i < src.length) {
    const c: string = src.charAt(i);
    const n: string = i + 1 < src.length ? src.charAt(i + 1) : '';
    if (c === '/' && n === '/') { while (i < src.length && src.charAt(i) !== '\n') { i++; } }
    else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && i + 1 < src.length && src.charAt(i + 1) === '/')) { i++; }
      i += 2;
    } else { code += c; i++; }
  }
  ok('① ⛔ 组件内**无** .opacity(（静息可见性不由动画函数决定；门禁 ⑨ A1 的正向形态）',
    code.indexOf('.opacity(') < 0);
  ok('② 出场用 .transition(toastTransition())', code.indexOf('.transition(toastTransition())') >= 0);
  ok('③ 面 token：surfaceFillOf(p, ...overlay...)', code.indexOf('surfaceFillOf(') >= 0 && code.indexOf('surface.overlay') >= 0);
  ok('③ 发丝 token：hairlineOf(', code.indexOf('hairlineOf(') >= 0);
  ok('③ 柔影 token：shadowRadiusOf(', code.indexOf('shadowRadiusOf(') >= 0);
  ok('③ 字角色（⛔ 不写裸字号）：fs(/tc(', code.indexOf('fs(TOAST_TYPE)') >= 0 && code.indexOf('tc(') >= 0);
  ok('⛔ 不再调系统 toast（promptAction / showToast 均不得出现）',
    code.indexOf('promptAction') < 0 && code.indexOf('showToast') < 0);
  ok('⛔ 组件不自持定时器（无 setTimeout(）—— dismiss 只能由页面 `delay()` 驱动', code.indexOf('setTimeout(') < 0);
}

// ── ⓪b notice **分场景**档（对齐 web 的两个 call site；此前是单一 2560）──────────
eq('notice-ok 档 = 5000（web ToolRender.tsx:508）', TOAST_MS_NOTICE_OK, 5000);
eq('notice-err 档 = 4000（web ToolRender.tsx:514）', TOAST_MS_NOTICE_ERR, 4000);
eq('notice-ok ⇒ 5000（映射）', toastDurationMs(TOAST_KIND_NOTICE_OK), TOAST_MS_NOTICE_OK);
eq('notice-err ⇒ 4000（映射）', toastDurationMs(TOAST_KIND_NOTICE_ERR), TOAST_MS_NOTICE_ERR);
// 向后兼容：旧 `notice` 与未知类别 ⇒ 一般档 2560（老 call site 行为不变）
eq('notice（旧）⇒ 2560（向后兼容）', toastDurationMs(TOAST_KIND_NOTICE), TOAST_MS_NOTICE);
eq('未知类别 ⇒ 2560（保守，宁可多留）', toastDurationMs('mystery-kind'), TOAST_MS_NOTICE);

// ── 汇总（⚠️ 见下：这里曾是**陷阱**）────────────────────────────────────────
//
// ⛔ **历史陷阱（2026-10-11 实锤）**：本文件的汇总**曾是**
//      `if (fail > 0) { console.log(\`  toast: ${pass} passed, ${fail} failed\`); process.exit(1); }`
//    ⇒ 那个 `console.log` **在失败分支之内** ⇒ 任何以它作"末尾前"锚点插入的断言
//    **落在 `fail===0` 永不执行的死区** ⇒ "加了 4 条断言，改前/改后/mutation 三次都是 29 passed"。
// ⛔ **新纪律**：汇总**无条件打印**、退出码由 `fail` 决定（下两行）—— 别再把它包进 `if`。
console.log(`  toast: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

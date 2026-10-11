/**
 * 触觉「**事件 → 档位**」纯逻辑判据（目标⑤ 阶段 1）。
 *
 * 分工（⛔ 别与 `haptics.test.ts` 重复）：
 *   · `haptics.test.ts`（E4）钉**接线形态**：全仓 `startVibration(` 恰好 1 处且只在
 *     `pages/Index.ets`、`components/**` 零触觉、静默失败契约、`buzz()` 体形态。
 *   · **本文件**钉**纯逻辑半场**：`core/haptics.ets` 的「事件 → 档位」映射本身。
 *     （阶段 2 `buzz(event)` 接线后，接线形态仍由 `haptics.test.ts` 覆盖。）
 *
 * 判据（判別力优先）：
 *   ① **每个事件 → 档位**逐一断言（不含糊：`send`/`stop` → 中档；`select`/`toggle`/`confirm` → 轻档）；
 *   ② **未登记事件 ⇒ 不动**（安全默认）：`''` / `'unknown'` / 大小写变体 / 带空格 ⇒ `HAPTIC_NONE_MS`；
 *   ③ **档位量级契约**：轻档 > 0、轻 ≤ 中、中档 < 50ms（>50ms 会读成"告警/来电"，与"日常确认"冲突）；
 *   ④ **未登记哨兵不与合法时长撞车**：平台 `duration` 值域 `(0, 1800000]` ⇒ 哨兵必须是 0；
 *   ⑤ **零扫描判红** + **纯模块形态**：`core/haptics.ets` 必须存在、非空、含 `export function hapticFor(`，
 *      且 **不** import `@ohos.*` / `@kit.*` / ArkUI（`core/` 被 `run.sh` 当纯 TS 编译，见 AGENTS 铁律）；
 *   ⑥ **模块仍被消费**（防"接线没做"假绿）：`pages/Index.ets` 必须 import `../core/haptics`。
 *
 * mutation 自证（已实测，见交付）：
 *   · 把 `case HAPTIC_EVENT_STOP: return HAPTIC_MEDIUM_MS;` 改成 `return HAPTIC_NONE_MS;` ⇒ ① 必红；
 *   · 把 `default: return HAPTIC_NONE_MS;` 改成 `return HAPTIC_LIGHT_MS;` ⇒ ② 必红。
 *
 * ⚠️ **插入位置铁律**：断言一律插在 `if (fail > 0)` **之前**（否则落死区）。
 * ⚠️ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
export {};

import {
  hapticFor, HAPTIC_TAP_MS, HAPTIC_LIGHT_MS, HAPTIC_MEDIUM_MS, HAPTIC_NONE_MS,
  HAPTIC_EVENT_SEND, HAPTIC_EVENT_STOP, HAPTIC_EVENT_SELECT, HAPTIC_EVENT_TOGGLE, HAPTIC_EVENT_CONFIRM,
} from '../../entry/src/main/ets/core/haptics';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
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
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/core/haptics.ets'))) { return p; }
  }
  return '';
}

// ── SELFCHECK（自证断言数随新增而变；防"插进死区"）───────────────────────────
eq('SELFCHECK-1（证明本文件在跑）', 1, 1);
eq('SELFCHECK-2（证明计数在增）', 2, 2);

// ── ⑤ 零扫描判红 + 纯模块形态 ────────────────────────────────────────────────
const root: string = findRoot();
ok('⑤ 探测到仓库根（零扫描判红）', root.length > 0);
const hapticsPath: string = root.length > 0 ? path.join(root, 'entry/src/main/ets/core/haptics.ets') : '';
const raw: string = hapticsPath.length > 0 && fs.existsSync(hapticsPath) ? fs.readFileSync(hapticsPath, 'utf8') : '';
ok(`⑤ 读到 core/haptics.ets 且非空（实得 ${raw.length} 字符）—— 读不到即红`, raw.length > 0);
const code: string = stripComments(raw);
ok('⑤ 源码含 `export function hapticFor(`（真源存在）', code.indexOf('export function hapticFor(') >= 0);
ok('⑤ 纯模块：不 import `@ohos.*`', code.indexOf('@ohos.') < 0);
ok('⑤ 纯模块：不 import `@kit.*`', code.indexOf('@kit.') < 0);
ok('⑤ 纯模块：不 import ArkUI（无 `@Component`/`@ohos.arkui`）',
  code.indexOf('@Component') < 0 && code.indexOf('arkui') < 0);

// ── ⑥ 模块仍被消费（防"接线没做"假绿；孤儿判据仅警告级）──────────────────────
if (root.length > 0) {
  const idxPath: string = path.join(root, 'entry/src/main/ets/pages/Index.ets');
  const idx: string = fs.existsSync(idxPath) ? stripComments(fs.readFileSync(idxPath, 'utf8')) : '';
  ok('⑥ 探测到 pages/Index.ets（零扫描判红）', idx.length > 0);
  ok("⑥ Index.ets 仍 import '../core/haptics'（模块有真消费者）", idx.indexOf("from '../core/haptics'") >= 0);
  ok('⑥ 纯映射 `hapticFor` 真被 Index 消费（阶段 2 接线已做，防"没接线"假绿）', idx.indexOf('hapticFor(') >= 0);
  ok('⑥ 事件常量真被 Index 传参（登记表有真消费者，防"常量空转"）',
    idx.indexOf('HAPTIC_EVENT_SEND') >= 0 && idx.indexOf('HAPTIC_EVENT_CONFIRM') >= 0);
}

// ── ④ 哨兵不与合法时长撞车 ──────────────────────────────────────────────────
eq('④ 哨兵 = 0（平台 duration 值域 (0,1800000] ⇒ 0 非法，可当"不动"）', HAPTIC_NONE_MS, 0);

// ── ③ 档位量级契约 ──────────────────────────────────────────────────────────
ok('③ 轻档 > 0（登记事件的档位必须是真时长）', HAPTIC_LIGHT_MS > 0);
ok('③ 轻档 ≤ 中档（中档不轻于轻档）', HAPTIC_LIGHT_MS <= HAPTIC_MEDIUM_MS);
ok(`③ 中档 < 50ms（仍属"轻点"；实得 ${HAPTIC_MEDIUM_MS}）—— >50 会读成告警/来电`,
  HAPTIC_MEDIUM_MS < 50);
ok('③ 既有单档 HAPTIC_TAP_MS 取值不变（=12，E4 语义）', HAPTIC_TAP_MS === 12);
ok('③ 轻档 == 既有单档（同"轻点"量级）', HAPTIC_LIGHT_MS === HAPTIC_TAP_MS);

// ── ① 每个事件 → 档位（逐一断言，不含糊）────────────────────────────────────
eq('① send → 中档', hapticFor(HAPTIC_EVENT_SEND), HAPTIC_MEDIUM_MS);
eq('① stop → 中档', hapticFor(HAPTIC_EVENT_STOP), HAPTIC_MEDIUM_MS);
eq('① select → 轻档', hapticFor(HAPTIC_EVENT_SELECT), HAPTIC_LIGHT_MS);
eq('① toggle → 轻档', hapticFor(HAPTIC_EVENT_TOGGLE), HAPTIC_LIGHT_MS);
eq('① confirm → 轻档', hapticFor(HAPTIC_EVENT_CONFIRM), HAPTIC_LIGHT_MS);

// 事件名本身要非空且互不相同（防常量写重/写空 ⇒ 映射形同虚设）
const EVENTS: string[] = [HAPTIC_EVENT_SEND, HAPTIC_EVENT_STOP, HAPTIC_EVENT_SELECT,
  HAPTIC_EVENT_TOGGLE, HAPTIC_EVENT_CONFIRM];
ok('① 事件名全部非空', EVENTS.filter((e: string) => e.length === 0).length === 0,
  `空名：${JSON.stringify(EVENTS)}`);
ok('① 事件名互不相同（无重复常量）', new Set(EVENTS).size === EVENTS.length,
  `实得 ${new Set(EVENTS).size} / ${EVENTS.length}`);
ok('① 每个登记事件都**真的会震**（> 0ms）', EVENTS.every((e: string) => hapticFor(e) > 0));

// ── ② 未登记 ⇒ 不动（安全默认；严格相等、不 trim、大小写敏感）───────────────
eq("② 空串 ⇒ 不动", hapticFor(''), HAPTIC_NONE_MS);
eq("② 'unknown' ⇒ 不动", hapticFor('unknown'), HAPTIC_NONE_MS);
eq("② 大小写变体 'SEND' ⇒ 不动（严格匹配）", hapticFor('SEND'), HAPTIC_NONE_MS);
eq("② 带空格 ' send' ⇒ 不动（不 trim）", hapticFor(' send'), HAPTIC_NONE_MS);
eq("② 后缀 'sendX' ⇒ 不动（非前缀匹配）", hapticFor('sendX'), HAPTIC_NONE_MS);
eq("② 原型链名 'constructor' ⇒ 不动（⛔ 不用裸对象查表）", hapticFor('constructor'), HAPTIC_NONE_MS);

if (fail > 0) { console.log(`  haptics_events: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  haptics_events: ${pass} passed, 0 failed`);
process.exit(0);

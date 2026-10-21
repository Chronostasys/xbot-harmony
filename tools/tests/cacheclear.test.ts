/**
 * cacheclear —— 「清除缓存」纯逻辑契约测试（判别力：每条可被 mutation 弄红）。
 *
 *  1. **三态文案互异且精确**：双成 / 单败（两个方向都必须各自点名失败步骤）/
 *     双败 —— 改任何一处文案或交换步骤标签 ⇒ 对应断言红。
 *  2. **ClearCacheResult 聚合**：ok = failures 全空；note/detail 只从构造器派生
 *     （组件不自己拼串 —— 判据与渲染同源）。
 *  3. **detail 空串协议**：无失败 ⇒ 空串（渲染层用它判隐藏；⛔ 不出现"无内容行"）。
 *  4. **reason 原样透传**：不吞、不包一层"未知错误"（组件层 catch 什么就显示什么）。
 *  5. **步骤 id 常量**：钉死 'webdata'/'webcache'（改名 ⇒ 测试红，防止静默漂移）。
 */
declare const process: { exit: (c: number) => void };

import {
  CLEAR_STEP_WEB_CACHE, CLEAR_STEP_WEB_DATA, ClearCacheResult, ClearFailure,
  clearCacheDetail, clearCacheNote,
} from '../../entry/src/main/ets/core/cacheclear';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

console.log('cacheclear.test.ts');

// ── 1. 三态文案 ────────────────────────────────────────────────────────────────
eq('note: 双成', clearCacheNote(true, true), '已清除 WebView 缓存与网页数据（登录态与偏好不受影响）。');
eq('note: 仅缓存败', clearCacheNote(true, false), '部分清除：网页缓存清除失败，可稍后重试。');
eq('note: 仅数据败', clearCacheNote(false, true), '部分清除：网页数据清除失败，可稍后重试。');
eq('note: 双败', clearCacheNote(false, false), '清除失败，请稍后重试。');

// ── 2. ClearCacheResult 聚合 ─────────────────────────────────────────────────
const allOk = new ClearCacheResult([]);
eq('result: 全成 ok', allOk.ok, true);
eq('result: 全成 note', allOk.note, '已清除 WebView 缓存与网页数据（登录态与偏好不受影响）。');
eq('result: 全成 detail', allOk.detail, '');

const dataFail = new ClearCacheResult([new ClearFailure(CLEAR_STEP_WEB_DATA, '17100001 Init error')]);
eq('result: 数据败 ok', dataFail.ok, false);
eq('result: 数据败 note', dataFail.note, '部分清除：网页数据清除失败，可稍后重试。');
eq('result: 数据败 detail', dataFail.detail, '网页数据：17100001 Init error');

const bothFail = new ClearCacheResult([
  new ClearFailure(CLEAR_STEP_WEB_DATA, 'a'),
  new ClearFailure(CLEAR_STEP_WEB_CACHE, 'b'),
]);
eq('result: 双败 ok', bothFail.ok, false);
eq('result: 双败 note', bothFail.note, '清除失败，请稍后重试。');
eq('result: 双败 detail 顺序=传入', bothFail.detail, '网页数据：a\n网页缓存：b');

// ── 3. detail 空串协议 ────────────────────────────────────────────────────────
eq('detail: 空清单', clearCacheDetail([]), '');

// ── 4. reason 透传（不吞信息） ────────────────────────────────────────────────
eq('detail: 单步透传', clearCacheDetail([new ClearFailure(CLEAR_STEP_WEB_CACHE, 'ERR_X')]),
  '网页缓存：ERR_X');

// ── 5. 步骤 id 常量 ───────────────────────────────────────────────────────────
eq('const: WEB_DATA', CLEAR_STEP_WEB_DATA, 'webdata');
eq('const: WEB_CACHE', CLEAR_STEP_WEB_CACHE, 'webcache');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};

/**
 * 「流式上滚不被人机对抗」接线的**源码形态**门禁 —— `pages/Index.ets` 滚动处理的调用点证据。
 *
 * ── 背景（用户 2026-10-12 真机亲报）──────────────────────────────────────────────────
 *   *"思考中数字滚动的时候，用户滚开会立马被拉回最下方"*。
 *   根因：`userScrollFrame` 是**单布尔**，**任一** `onScrollIndex` 都会消费它；流式期间程序滚动
 *   （`scrollEdge(Bottom)`）与用户拖动**交错** ⇒ 程序滚动的索引回调**抢先消费**用户刚置的 flag，
 *   且此刻 `end` 恰为 `itemCount-1` ⇒ `followBottom` 被判回 `true` ⇒ 用户被拽回底部。
 *
 * ── 修复（web `MessageList.tsx:1327-1345` 同构）与钉什么 ─────────────────────────────
 * ① `onWillScroll` 里用户帧 ⇒ **立即** `this.followBottom = false`（web `pauseFollowing()`：
 *    与方向/位置无关）—— 判据：源码出现 `this.lastScrollWasUser = user;`（记录本帧来源）。
 * ② `onScrollIndex` 里恢复跟随**只在** `lastScrollWasUser` 为真时判定 —— 判据：出现
 *    `this.userScrollFrame && this.lastScrollWasUser`（程序帧**绝不**改写意图）。
 * ③ 30ms 延迟程序滚动**派发后复查**意图 —— 判据：出现 `if (!this.followBottom) {`。
 * ④ 旧判据不删只演进：`markUserScrollFrame(` / `nextFollowBottom(` 仍被消费（≥1，防死代码）。
 *
 * ✅ 扫描器自证：打印扫了哪个文件 + 逐项计数；**零扫描判红**（合计 0 ⇒ 红）。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 标记为模块（顶层 pass/fail 不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const PAGES: string = path.join(REPO, 'entry/src/main/ets/pages');

/** **剥注释**（块 + 行；行注释用 `(^|[^:])//` 以免剥掉 `https://`）—— 只认**生产**调用点。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}

const IDX: string = 'Index.ets';
const idxSrc: string = stripComments(fs.readFileSync(path.join(PAGES, IDX), 'utf8'));

console.log(`  scroll-scan dir=${PAGES}`);
console.log(`  scroll-scan files: ${IDX}`);
const markUser: number = countOf(idxSrc, 'markUserScrollFrame(');
const recordSrc: number = countOf(idxSrc, 'this.lastScrollWasUser = user;');
const gate: number = countOf(idxSrc, 'this.userScrollFrame && this.lastScrollWasUser');
const recheck: number = countOf(idxSrc, 'if (!this.followBottom) {');
const nextFb: number = countOf(idxSrc, 'nextFollowBottom(');
const isUserSrc: number = countOf(idxSrc, 'isUserScrollSource(source)');
console.log(`  scroll-scan ${IDX}: markUserScrollFrame(=${markUser} lastScrollWasUser=${recordSrc} gate=${gate} recheck=${recheck} nextFollowBottom(=${nextFb} isUserScrollSource(source)=${isUserSrc}`);

// ── ① 记录本帧来源（onWillScroll 覆写）─────────────────────────────────────────────
ok(`记录本帧滚动来源 lastScrollWasUser（${recordSrc} ≥ 1）`, recordSrc >= 1);

// ── ② onScrollIndex 只在**用户帧**判定恢复（程序帧绝不改写意图）────────────────────
ok(`onScrollIndex 门控 userScrollFrame && lastScrollWasUser（${gate} ≥ 1）`, gate >= 1);

// ── ③ 30ms 延迟程序滚动派发后**复查**意图 ────────────────────────────────────────
ok(`延迟程序滚动派发后复查 followBottom（${recheck} ≥ 1）`, recheck >= 1);

// ── ④ 判据不删只演进：纯函数仍被消费 ──────────────────────────────────────────────
ok(`仍消费 markUserScrollFrame(（${markUser} ≥ 1）`, markUser >= 1);
ok(`仍消费 nextFollowBottom(（${nextFb} ≥ 1）`, nextFb >= 1);
ok(`仍用 isUserScrollSource(source) 判定用户帧（${isUserSrc} ≥ 1）`, isUserSrc >= 1);

// ── 零扫描判红：链接线调用点合计必须 > 0（扫描器与真源脱节 ⇒ 红）──────────────────
ok('零扫描判红：滚动跟随接线调用点合计 > 0',
  markUser + recordSrc + gate + recheck + nextFb + isUserSrc > 0);

console.log(`  scroll-follow-wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

/**
 * 判据：AskUser 面板**提交/取消后必须立刻消失**（用户 2026-10-16 亲报「消失了还会出现一瞬间，严重 bug」）。
 *
 * 两条必须同时成立（缺一条就闪回）：
 *   ① **清在请求之前**：`Math` 顺序 —— `this.askUser = null` 必须出现在 `'/api/ask_user/respond'` **之前**
 *      （旧实现在 `await POST` 之后清 ⇒ 往返期间面板仍在）；
 *   ② **按身份抑制回填**：`pickAskUserFromProgress` 必须用 `answeredAskId` 把**同一 request_id** 拦掉
 *      （服务端收尾期会重播同一个 pending 问题 ⇒ 否则写回 ⇒ 闪回）。
 *
 * 判别力（mutation 自证）：把清除挪回 POST 之后 / 删掉 `answeredAskId` 拦截面 ⇒ 本判据必红。
 * 真机实证：点「取消」后连续 12 帧 dump 中问题词/输入行/「提交」全为 NO（无闪回）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

const fs: { readFileSync(p: string, e: string): string } = require('fs');
const path: { join(...parts: string[]): string } = require('path');
const root: string = path.join(__dirname, '..', '..', '..', '..');

let passed: number = 0;
let failed: number = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 判据本体：清位必须在发请求**之前**（纯字符串位置判定 ⇒ 可脱机 + 可 mutation 证伪）。 */
export function clearsBeforePost(src: string, anchorPost: string): boolean {
  const iClear: number = src.indexOf('this.askUser = null;');
  const iPost: number = src.indexOf(anchorPost);
  return iClear >= 0 && iPost >= 0 && iClear < iPost;
}

const storeSrc: string = stripComments(
  fs.readFileSync(path.join(root, 'entry/src/main/ets/core/store.ets'), 'utf8'));

// ── ① respondAsk：清在 POST 之前 ────────────────────────────────────────────────
const iRespond: number = storeSrc.indexOf('async respondAsk(');
const respondBody: string = iRespond < 0 ? '' : storeSrc.slice(iRespond, iRespond + 1600);
ok(respondBody.length > 0, 'respondAsk 仍存在（⛔ 改签名需同步本判据）');
ok(clearsBeforePost(respondBody, "'/api/ask_user/respond'"),
  'respondAsk：`this.askUser = null` 出现在 `/api/ask_user/respond` **之前**（否则往返期间面板仍在）');
ok(respondBody.indexOf('answeredAskId') >= 0, 'respondAsk：记下刚答的 request_id（answeredAskId）');
ok(respondBody.indexOf('this.askUser = prompt;') >= 0, 'respondAsk：失败时把问题**还回来**（不假装成功）');

// ── ② pickAskUserFromProgress：按身份抑制回填 ────────────────────────────────────
const iPick: number = storeSrc.indexOf('private pickAskUserFromProgress(');
const pickBody: string = iPick < 0 ? '' : storeSrc.slice(iPick, iPick + 1200);
ok(pickBody.length > 0, 'pickAskUserFromProgress 仍存在');
ok(pickBody.indexOf('answeredAskId') >= 0, 'pickAskUserFromProgress：用 answeredAskId 拦掉同一 request_id');

// ── ③ mutation 自证：旧式（清在 POST 之后）必红 ──────────────────────────────────
const oldBody: string = "await this.http.post('/api/ask_user/respond', req); this.askUser = null;";
ok(clearsBeforePost(oldBody, "'/api/ask_user/respond'") === false,
  'mutation 自证：旧式先 POST 后清 ⇒ 判据必红（有判别力，不是恒真）');
ok(clearsBeforePost(respondBody, "'/api/ask_user/respond'") === true, 'mutation 自证：现行实现判绿');

console.log(`  askuser-flashback: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

// ⛔ 必须导出：聚合 harness 把全部 `.test.ts` 编进同一输出目录，缺它会让全局声明撞名。
export {};

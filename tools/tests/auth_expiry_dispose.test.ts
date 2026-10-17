/**
 * 401 退出后**必须真正停掉旧 store**（2026-10-17 用户 P0：模拟器每隔几秒退回登录页）。
 *
 * 根因链：
 *  ① 后端重启 ⇒ 服务端内存会话全失效（`web_auth.go` 的 `wc.sessions` 是内存 map）；
 *  ② 旧 `ChatStore.dispose()` 只 `sse.close()`，**不清 `sessionPollTimer`** ⇒ 被清池的
 *     store 仍每 5s（busy）/30s（idle）打 `/api/session-tree`，带**旧 cookie** ⇒ 401；
 *  ③ 旧 store 的 `onAuthExpired` 回调也没摘 ⇒ 401 又把刚重新登录成功的页面踢回登录页
 *     ⇒ 每过一个轮询周期重复一次（用户看到「每过几秒登录过期」）。
 *
 * 判据（源码形态 + 零扫描防线）：
 *  · `dispose()` 必须清 `sessionPollTimer` **且** 摘掉 4 个外部回调；
 *  · `doLogin()` 开始必须先 `disposeAllStores()` 并把 `authExpiredHandled=true`
 *    （忽略登录期间旧 store 的迟到 401），成功后清零。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const root: string = path.resolve(__dirname, '../../../..');
const store: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/core/store.ets'), 'utf8');
const index: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/pages/Index.ets'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}
function has(name: string, s: string, sub: string): void {
  ok(`${name}（应含「${sub}」）`, s.indexOf(sub) >= 0);
}

console.log('\n▶ dispose 必须停轮询 + 摘回调');
const d0: number = store.indexOf('dispose(): void {');
const d1: number = d0 >= 0 ? store.indexOf('\n  }', d0) : -1;
const disposeBody: string = d0 >= 0 && d1 > d0 ? store.substring(d0, d1) : '';
ok('零扫描防线：找到 dispose() 方法体', disposeBody.length > 100);
has('清 sessionPollTimer', disposeBody, 'clearTimeout(this.sessionPollTimer)');
has('摘 http.onUnauthorized', disposeBody, 'this.http.onUnauthorized = () =>');
has('摘 sse.onUnauthorized', disposeBody, 'this.sse.onUnauthorized = () =>');
has('摘 store.onAuthExpired', disposeBody, 'this.onAuthExpired = () =>');
has('摘 http.onApiError', disposeBody, 'this.http.onApiError = () =>');
ok('mutation 反证：dispose 里不能只有 sse.close（旧实现形态）',
  disposeBody.indexOf('this.sse.close()') >= 0 && disposeBody.length > 500);

console.log('\n▶ doLogin 必须清旧 store 并忽略登录期迟到 401');
const l0: number = index.indexOf('private async doLogin(): Promise<void> {');
const l1: number = l0 >= 0 ? index.indexOf('\n  }', l0) : -1;
const loginBody: string = l0 >= 0 && l1 > l0 ? index.substring(l0, l1) : '';
ok('零扫描防线：找到 doLogin() 方法体', loginBody.length > 500);
has('登录开始置 authExpiredHandled=true', loginBody, 'this.authExpiredHandled = true;');
has('登录开始清旧 store', loginBody, 'this.disposeAllStores();');
has('登录成功清零 authExpiredHandled', loginBody, 'this.authExpiredHandled = false;');
const atTrue: number = loginBody.indexOf('this.authExpiredHandled = true;');
const atFalse: number = loginBody.indexOf('this.authExpiredHandled = false;');
ok('顺序：先置 true（登录期）后置 false（成功后）', atTrue >= 0 && atFalse > atTrue);
has('handleAuthExpired 复用 disposeAllStores', index, 'this.disposeAllStores();');

console.log(fail === 0 ? 'auth_expiry_dispose: ALL PASS' : `auth_expiry_dispose: ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);

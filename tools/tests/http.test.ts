/**
 * XbotHttp 登录链路集成测试（Linux 上真跑 HTTP）。
 *
 * 复现 2026-10-09 真机 bug：服务端登录下发 `Set-Cookie`，而鸿蒙把同名头给成**数组**，
 * 我按 string 声明后直接 `.split()` ⇒ "undefined is not callable"。
 * 这里用 mock kit（数组形态）+ mock 服务端把该场景钉死；字符串形态也一并覆盖。
 */
import { XbotHttp } from '../../entry/src/main/ets/core/http';

declare const require: (m: string) => any;
declare const Buffer: any;

const nodeHttp = require('http');

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

interface MockState {
  seenCookie: string;
}

function startMockServer(state: MockState): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = nodeHttp.createServer((req: any, res: any) => {
      const chunks: any[] = [];
      req.on('data', (c: any) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        state.seenCookie = req.headers['cookie'] !== undefined ? req.headers['cookie'] : '';
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/auth/config') {
          res.end(JSON.stringify({ ok: true, data: { invite_only: true, bootstrap: false }, error: null }));
          return;
        }
        if (req.url === '/api/auth/login') {
          // 关键：登录下发 cookie（真机就是这一步把数组喂给了我的 string 声明）
          res.setHeader('Set-Cookie', [
            'xbot_session=TOK123; Path=/; HttpOnly; SameSite=Lax',
            'xbot_extra=Y; Path=/',
          ]);
          if (body.indexOf('stringcookie') >= 0) {
            res.setHeader('x-test-setcookie-string', '1');
          }
          res.end(JSON.stringify({ ok: true, data: { user_id: 'adm' }, error: null }));
          return;
        }
        if (req.url === '/api/session-tree') {
          res.end(JSON.stringify({
            ok: true,
            data: { sessions: [{ chat_id: 'chat-1', channel: 'web', label: 'T' }], chats: [], orphan_subagents: [] },
            error: null,
          }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: { message: 'not found' } }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port: number = server.address().port;
      resolve({ port, close: () => server.close() });
    });
  });
}

async function main(): Promise<void> {
  const state: MockState = { seenCookie: '' };
  const srv = await startMockServer(state);
  const h = new XbotHttp(`http://127.0.0.1:${srv.port}`);

  // ① 无 cookie 的端点先跑通（基线：真机上这一步一直正常）
  let cfgOk = false;
  try {
    const cfg = await h.authConfig();
    cfgOk = cfg.invite_only === true;
  } catch (e) {
    cfgOk = false;
  }
  ok('authConfig 正常（无 Set-Cookie 路径）', cfgOk);

  // ② 登录：这里就是真机崩掉的那一步（Set-Cookie 为数组形态）
  let loginErr = '';
  try {
    await h.login('adm', 'pw');
  } catch (e) {
    const err: Error = e as Error;
    loginErr = err.message !== undefined ? err.message : `${e}`;
  }
  ok('login 不抛错（数组形态 Set-Cookie）', loginErr === '', loginErr);
  ok('捕获到会话 cookie', h.exportSessionCookie() === 'xbot_session=TOK123',
    `got=${h.exportSessionCookie()}`);
  ok('多条 cookie 都收下（extras）', h.cookieHeaderForStream().indexOf('xbot_extra=Y') >= 0,
    h.cookieHeaderForStream());

  // ③ 后续请求带上 cookie（服务端应当收到）
  await h.post('/api/session-tree', {});
  ok('后续请求自动带 Cookie 头', state.seenCookie.indexOf('xbot_session=TOK123') >= 0, state.seenCookie);

  // ④ 字符串形态（某些栈会把同名头拼成一个字符串）——同样必须工作
  const h2 = new XbotHttp(`http://127.0.0.1:${srv.port}`);
  let strErr = '';
  try {
    await h2.login('stringcookie', 'pw');
  } catch (e) {
    const err: Error = e as Error;
    strErr = err.message !== undefined ? err.message : `${e}`;
  }
  ok('login 不抛错（字符串形态 Set-Cookie）', strErr === '', strErr);
  ok('字符串形态同样解析出会话 cookie', h2.exportSessionCookie() === 'xbot_session=TOK123',
    h2.exportSessionCookie());

  srv.close();
  console.log(`http.test: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    throw new Error('http 集成测试失败');
  }
}

main();

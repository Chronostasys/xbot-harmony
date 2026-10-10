/**
 * store_null.test.ts —— 真机 P0「点『＋ 新建』100% 失败」的**判别力回归守卫**。
 *
 * ── 症状与根因（2026-10-11 真机 + 服务端实测）──────────────────────────────────
 * 点「＋ 新建」⇒ Toast `新建失败: Cannot read property questions of null`。
 * 链路：`Index.newSession → store.createSession → openSession → loadHistoryInner`。
 * `POST /api/history` 对**没有在飞进度**的会话返回 **JSON `null`**：
 *   {"active_progress":null,"messages":null,"has_more":false,"last_seq":0,"oldest_id":0,…}
 * 而客户端把它标注成 `T | undefined`（"可能缺失"，**不含 null 语义**）⇒
 * `ap !== undefined` 对 `null` 为 **true** ⇒ `pickAskUserFromProgress(null)` ⇒ 取
 * `p.questions` 抛 TypeError。
 *
 * 判别力：把 `store.ets` 的三处 `isPresent(...)`/三态判空改回 `!== undefined`
 * （或删掉 `pickAskUserFromProgress` 的自身防御）⇒ 下面带 ★ 的断言**红**。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

/** 打桩 `store.http.postAs`：按路径返回"服务端 JSON 解码后"的 data（**可含 null**）。 */
function stubHttp(store: ChatStore, routes: Record<string, object>): void {
  const h = store.http as unknown as { postAs: (path: string, body: object) => Promise<object> };
  h.postAs = (path: string, _body: object): Promise<object> => {
    const hit: object | undefined = routes[path];
    return Promise.resolve(hit !== undefined ? hit : {});
  };
}

/** 打桩 SSE：捕获监听器，供测试手动"投递"事件（避免真连网络）。 */
function stubSse(store: ChatStore): (event: string, data: string) => void {
  let listener: ((event: string, data: string) => void) | null = null;
  const s = store.sse as unknown as {
    connect: (chatId: string, channel: string, cookie: string,
      l: (event: string, data: string) => void) => void;
  };
  s.connect = (_c: string, _ch: string, _ck: string, l: (event: string, data: string) => void): void => {
    listener = l;
  };
  return (event: string, data: string): void => {
    if (listener !== null) {
      listener(event, data);
    }
  };
}

/** 服务端实测的"空会话"响应（逐字抄，注意四处 null）。 */
const EMPTY_HISTORY: object = {
  active_progress: null,
  channel: 'web',
  chat_id: 'chat_new',
  messages: null,
  has_more: false,
  last_seq: 0,
  oldest_id: null,
  processing: false,
};

async function main(): Promise<void> {
  // ── ① 新建会话链路：history 里 active_progress/messages/oldest_id 全是 null ──
  {
    const store = new ChatStore('http://127.0.0.1:9');
    stubHttp(store, {
      '/api/session-tree': { sessions: [{ chat_id: 'chat_new', channel: 'web' }], chats: [] },
      '/api/history': EMPTY_HISTORY,
    });
    const fire = stubSse(store);
    ok('store 构造完成', store !== null);
    let threw: string = '';
    try {
      await store.openSession('chat_new'); // ★ 旧实现在这里抛 questions of null
    } catch (e) {
      threw = (e as Error).message;
    }
    ok('★ 打开「无在飞进度」的会话不得抛（P0 根因）', threw.length === 0, threw);
    ok('★ null 的 active_progress 不得造出 pending 问题', store.askUser === null);
    ok('★ null 的 oldest_id 不得把 null 塞进数值字段', store.oldestId === 0);
    ok('★ null 的 messages 不得炸（空历史）', store.rows.length === 0);

    // ② SSE ask_user 事件携带 `progress:null`（服务端 nil → null 的同类形态）
    let sseThrew: string = '';
    try {
      fire('ask_user', '{"progress":null}');
    } catch (e) {
      sseThrew = (e as Error).message;
    }
    ok('★ SSE ask_user + progress:null 不得抛', sseThrew.length === 0, sseThrew);
    ok('★ 且不得造出 pending 问题', store.askUser === null);

    // ③ SSE session 事件本身是 null（`env.session` 为 null）
    let sessThrew: string = '';
    try {
      fire('session', '{"session":null}');
    } catch (e) {
      sessThrew = (e as Error).message;
    }
    ok('★ SSE session:null 不得抛', sessThrew.length === 0, sessThrew);

    // ④ 正向对照：合法 progress 仍要能识别出 pending 问题（守卫不能把功能一起挡掉）
    fire('ask_user', JSON.stringify({
      progress: { request_id: 'r1', questions: [{ id: 'q1', question: '继续吗？' }] },
    }));
    ok('正向对照：合法 ask_user 仍造出 pending 问题', store.askUser !== null);
    ok('正向对照：问题文本正确',
      store.askUser !== null && store.askUser.questions.length === 1
        ? (store.askUser.questions[0].question !== undefined ? store.askUser.questions[0].question : '') : '',
      '继续吗？');
  }

  // ── ⑤ createSession：`/api/chats/create` 回 `chat_id:null` 不得抛 ──────────
  {
    const store = new ChatStore('http://127.0.0.1:9');
    stubHttp(store, {
      '/api/chats/create': { chat_id: null } as unknown as object,
      '/api/session-tree': { sessions: [], chats: [] },
    });
    stubSse(store);
    let threw: string = '';
    try {
      await store.createSession(); // ★ 旧实现 `created.chat_id.length` 会炸
    } catch (e) {
      threw = (e as Error).message;
    }
    ok('★ createSession + chat_id:null 不得抛', threw.length === 0, threw);
  }

  if (fail > 0) { console.log(`  store_null: ${pass} passed, ${fail} failed`); process.exit(1); }
  console.log(`  store_null: ${pass} passed, 0 failed`);
  process.exit(0);
}

main();

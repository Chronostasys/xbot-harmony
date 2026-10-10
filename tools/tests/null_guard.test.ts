/**
 * null_guard.test.ts —— 根治真机 P0「登录成功后立刻 `[加载会话] Cannot read property
 * length of null`」的**判别力回归守卫**。
 *
 * 根因：服务端 Go 的 nil slice 经 encoding/json 序列化成 **JSON `null`**（实测
 * `/api/session-tree` 返回 `{"sessions":[...],"orphan_subagents":null,...}`），而客户端
 * 把这类字段声明为 `T[] | undefined`（可选 = "可能缺失"，**不含 null 语义**）⇒
 * `x !== undefined` 对 `null` 为真 ⇒ 紧接着的 `x.length` 抛 TypeError。
 *
 * 判别力：本文件**驱动真实的 `ChatStore.loadSessions()`**，输入即服务端 JSON 解码后的
 * 数据（含 null）。把 `core/store.ets` 的 `arrOrEmpty(...)` 改回旧写法
 * （裸 `x !== undefined && x.length`）时，下面前 4 条会**红**（见交付报告 mutation 记录）。
 */
declare const process: { exit: (c: number) => void };

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { arrOrEmpty, arrPresent, isPresent } from '../../entry/src/main/ets/core/guards';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
    return;
  }
  fail++;
  console.log(`  ✗ ${name}${extra !== undefined && extra.length > 0 ? `\n      ${extra}` : ''}`);
}

/** 打桩 `store.http.postAs`：`/api/session-tree` 返回给定 data（模拟服务端 JSON 解码结果，可含 null）。 */
function stubSessionTree(store: ChatStore, data: object): void {
  const httpAny = store.http as unknown as {
    postAs: (path: string, body: object) => Promise<object>;
  };
  httpAny.postAs = (path: string, _body: object): Promise<object> => {
    if (path === '/api/session-tree') {
      return Promise.resolve(data);
    }
    return Promise.resolve({});
  };
}

/** 以给定 data 调一次 loadSessions，返回是否抛 + 抛出的 message。 */
async function run(
  name: string, data: object,
): Promise<void> {
  const store = new ChatStore('http://127.0.0.1:9');
  stubSessionTree(store, data);
  let threw: string = '';
  try {
    await store.loadSessions();
  } catch (e) {
    threw = (e as Error).message;
  }
  ok(name, threw === '', `loadSessions 抛错：${threw}`);
}

async function main(): Promise<void> {
  // ── 用例 1..4：三种必测输入 + chats 回退的 null 形态，均**不得抛** ──
  //   （旧写法下 1/2/4 会抛 "Cannot read property length of null"）
  await run('orphan_subagents: null 不抛', {
    sessions: [{ chat_id: 'c1' }],
    orphan_subagents: null,
  });
  await run('sessions: null 不抛', {
    sessions: null,
    orphan_subagents: [],
  });
  await run('sessions: undefined 不抛', {});
  await run('sessions: undefined + chats: null 回退不抛', {
    sessions: undefined,
    chats: null,
  });

  // ── 用例 5：正常数据仍被正确解析（防止"全变空"式的假修复）──
  {
    const store = new ChatStore('http://127.0.0.1:9');
    stubSessionTree(store, {
      sessions: [{ chat_id: 'c1', label: '会话一', running: true }, { chat_id: 'c2' }],
      orphan_subagents: null,
    });
    let threw: string = '';
    try {
      await store.loadSessions();
    } catch (e) {
      threw = (e as Error).message;
    }
    ok('正常 sessions 被解析', threw === '' && store.sessions.length === 2,
      `threw=${threw} sessions=${store.sessions.length}`);
    ok('null orphan_subagents 归一为空数组', store.subagents.length === 0,
      `subagents=${store.subagents.length}`);
  }

  // ── 用例 6：`/api/llm-config` 无配置时服务端 `data` 整块为 null ⇒ 必须回落到 undefined ──
  {
    const store = new ChatStore('http://127.0.0.1:9');
    const httpAny = store.http as unknown as {
      getAs: (path: string) => Promise<object>;
    };
    httpAny.getAs = (_path: string): Promise<object> => Promise.resolve(null as unknown as object);
    let threw: string = '';
    try {
      await store.loadLlmConfig();
    } catch (e) {
      threw = (e as Error).message;
    }
    ok('llm-config data=null 不崩且回落 undefined',
      threw === '' && store.llmConfig === undefined, `threw=${threw} llmConfig=${String(store.llmConfig)}`);
  }

  // ── 用例 7..：守卫原语自身的语义（null 与 undefined 一律当"空"）──
  ok('arrOrEmpty(null) = []', arrOrEmpty<string>(null).length === 0);
  ok('arrOrEmpty(undefined) = []', arrOrEmpty<string>(undefined).length === 0);
  ok('arrOrEmpty([x]) 原样', arrOrEmpty<string>(['x']).length === 1
    && arrOrEmpty<string>(['x'])[0] === 'x');
  ok('arrPresent(null) = false', arrPresent<string>(null) === false);
  ok('arrPresent([]) = false', arrPresent<string>([]) === false);
  ok('arrPresent([x]) = true', arrPresent<string>(['x']) === true);
  ok('isPresent(null) = false', isPresent<object>(null) === false);
  ok('isPresent(undefined) = false', isPresent<object>(undefined) === false);
  ok('isPresent(x) = true', isPresent<object>({}) === true);

  if (fail > 0) {
    console.log(`  null_guard: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`  null_guard: ${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch((e: Error): void => {
  console.log(`  ✗ null_guard 主流程异常：${e.message}`);
  process.exit(1);
});

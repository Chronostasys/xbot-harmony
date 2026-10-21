import { ChatStore } from '../../entry/src/main/ets/core/store';
declare const process: { exit: (c: number) => void };
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${extra ? `: ${extra}` : ''}`); }
}
async function main(): Promise<void> {
  const store = new ChatStore('http://127.0.0.1:9');
  store.currentChatId = 'chat-audit';
  const httpAny = store.http as unknown as { post: (p: string, b: object) => Promise<string> };
  httpAny.post = (p: string, _b: object): Promise<string> => {
    if (p === '/api/history') {
      return Promise.resolve(JSON.stringify({ chat_id: 'chat-audit', channel: 'web', messages: [], has_more: false, oldest_id: 0 }));
    }
    return Promise.resolve(JSON.stringify({ id: 7, turn_id: 5, queued: false }));
  };
  await store.send('你好');
  const row = store.rows.find((r) => r.role === 'user');
  console.log('rows=', store.rows.map((r) => `${r.role}:${r.content}:sending=${r.sending}`).join(' | '));
  ok('ack 后不存在 sending user 行', row === undefined || row.sending === false);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.log('EXCEPTION', e); process.exit(2); });

export {};

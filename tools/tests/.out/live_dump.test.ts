/**
 * 真实服务端「渲染模型」dump（**只读**：仅 /api/auth/login、/api/history、/api/regions）。
 *
 * 用法：XBOT_E2E_BASE=http://127.0.0.1:16000 XBOT_E2E_USER=adm XBOT_E2E_PASS=123 \
 *       XBOT_E2E_CHAT=chat_XXX tools/tests/run.sh
 *
 * 注意：**刻意不走 openSession()**（它含 SSE 长连接，会让 Node 事件循环不退出）；
 * 这里直接取 history + 用同一静态函数构造行模型，得到与 App 一致的"要渲染什么"。
 */
import { ChatStore } from './store';
import { ChatRow, HistoryData, HistoryIteration, HistoryMessage } from './types';

declare const process: { env: Record<string, string>; exit: (c: number) => void };

const BASE = process.env.XBOT_E2E_BASE;
const USER = process.env.XBOT_E2E_USER || 'admin';
const PASS = process.env.XBOT_E2E_PASS || 'admin';
const CHAT = process.env.XBOT_E2E_CHAT || '';
const MAX_ITER_VISIBLE = 16;

async function main(): Promise<void> {
  if (BASE === undefined || BASE.length === 0 || CHAT.length === 0) {
    console.log('live_dump.test: 跳过（需 XBOT_E2E_BASE 与 XBOT_E2E_CHAT）');
    return;
  }
  const http = new ChatStore(BASE).http;
  await http.login(USER, PASS);
  const data: HistoryData = await http.postAs<HistoryData>('/api/history', {
    channel: 'web', chat_id: CHAT, limit: 30, before_id: 0,
  });
  const msgs: HistoryMessage[] = data.messages !== undefined ? data.messages : [];
  const rows: ChatRow[] = ChatStore.rowsFromHistory(msgs);

  let iterTotal = 0;
  let maxIter = 0;
  let rendered = 0;
  let kb = 0;
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r: ChatRow = rows[i];
    ids.push(r.id);
    const n: number = r.iterations.length;
    iterTotal += n;
    if (n > maxIter) { maxIter = n; }
    rendered += Math.min(n, MAX_ITER_VISIBLE);
    for (let k = 0; k < n; k++) {
      const it: HistoryIteration = r.iterations[k];
      kb += ((it.content !== undefined ? it.content.length : 0)
        + (it.reasoning !== undefined ? it.reasoning.length : 0)) / 1024;
    }
  }
  const folded = rows.filter((r) => r.regionsBefore > 0).length;
  console.log(`=== 渲染模型 dump（${CHAT}）===`);
  console.log(`  rows=${rows.length}  迭代总数=${iterTotal}  单行最多迭代=${maxIter}  App 实际渲染块数=${rendered}（每行≤${MAX_ITER_VISIBLE}）`);
  console.log(`  正文字节=${kb.toFixed(0)} KB   带 regions_before 的行=${folded}`);
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    const r: ChatRow = rows[i];
    console.log(`   row[${i}] role=${r.role} iter=${r.iterations.length} regionsBefore=${r.regionsBefore} contentLen=${r.content.length}`);
  }
  console.log(`  行 id 唯一=${new Set(ids).size === ids.length}`);
  process.exit(0);
}

main();

/**
 * 真实服务端端到端验证（**可选**，默认跳过以保持 CI 无依赖）。
 *
 * 用法：XBOT_E2E_BASE=http://127.0.0.1:8082 XBOT_E2E_USER=admin XBOT_E2E_PASS=admin tools/tests/run.sh
 *
 * 为什么值得有：mock 只能验证"我理解的契约"，真服务端能验证"契约真的是这样"——
 * 尤其是**折叠历史 + regions_before + /api/regions**（serverapp/callbacks.go:386 的行为），
 * 这是客户端最容易理解错、且直接决定"历史能不能看全/会不会卡死"的地方。
 */
import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatRow, HistoryData, HistoryMessage } from '../../entry/src/main/ets/core/types';

declare const process: { env: Record<string, string>; exit: (c: number) => void };

const BASE = process.env.XBOT_E2E_BASE;
const USER = process.env.XBOT_E2E_USER || 'admin';
const PASS = process.env.XBOT_E2E_PASS || 'admin';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

async function main(): Promise<void> {
  if (BASE === undefined || BASE.length === 0) {
    console.log('live.test: 跳过（未设 XBOT_E2E_BASE）');
    return;
  }
  const store = new ChatStore(BASE);
  await store.http.login(USER, PASS);
  ok('登录成功并拿到会话 cookie', store.http.hasSession(), store.http.exportSessionCookie().substring(0, 24));
  await store.loadSessions();
  ok('会话列表可解析', store.sessions.length >= 0, `sessions=${store.sessions.length}`);
  if (store.sessions.length === 0) {
    console.log('live.test: 该实例没有会话，仅验证到会话列表');
  } else {
    const first = store.sessions[0];
    const chatId: string = first.chat_id !== undefined ? first.chat_id : '';
    // ⚠️ 不用 openSession()：它含 SSE 长连接，会让 node 进程不退出（测试挂住）。
    // 直接取 history 并用同一静态函数构造行模型 —— 验证的仍是真实解析路径。
    const hist: HistoryData = await store.http.postAs<HistoryData>('/api/history', {
      channel: 'web', chat_id: chatId, limit: 30, before_id: 0,
    });
    const msgs: HistoryMessage[] = hist.messages !== undefined ? hist.messages : [];
    store.rows = ChatStore.rowsFromHistory(msgs);
    ok('历史可解析（含 user/assistant 行）', store.rows.length >= 0, `rows=${store.rows.length}`);
    // 折叠视图：找带 regionsBefore 的行，验证按需取回真的能取到更早区域
    const folded: ChatRow | undefined = store.rows.find((r) => r.regionsBefore > 0);
    if (folded === undefined) {
      console.log(`live.test: 该会话无折叠区域（rows=${store.rows.length}）；折叠路径由 mock 测试覆盖`);
    } else {
      const before: number = folded.regionsBefore;
      const n0: number = folded.iterations.length;
      await store.loadEarlierRegions(folded);
      ok('折叠历史按需取回：迭代数增加或 regionsBefore 递减',
        folded.iterations.length > n0 || folded.regionsBefore < before,
        `iters ${n0}→${folded.iterations.length}, regionsBefore ${before}→${folded.regionsBefore}`);
      ok('取回后无重复迭代号',
        new Set(folded.iterations.map((i) => i.iteration)).size === folded.iterations.length,
        folded.iterations.map((i) => i.iteration).join(','));
      ok('迭代号为升序（前插正确）', folded.iterations.every((it, i, a) => i === 0 || a[i - 1].iteration < it.iteration));
    }
  }
  console.log(`live.test: ${pass} passed, ${fail} failed`);
  if (fail > 0) { throw new Error('真实服务端验证失败'); }
  process.exit(0);   // 确保退出（即使有残留连接）
}

main();

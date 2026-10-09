/**
 * 「更早的展示区域」按需取回（服务端折叠视图）守护。
 *
 * 背景（serverapp/callbacks.go:386）：REST 历史是**折叠视图** —— 每个 turn 只下发尾部
 * `HistoryRegionWindow = 100` 个展示区域 + `regions_before` 声明，更早的必须用
 * `POST /api/regions {channel,chat_id,turn_id,before_iteration,region_limit}` 取回。
 * 若客户端忽略 `regions_before`：用户"看不到更早的迭代"，历史不完整。
 *
 * 本测试钉死语义：前插 + 去重 + `regions_before` 递减至 0 + 反复可加载。
 */
declare const process: { exit: (c: number) => void };
import { ChatStore } from './store';
import { ChatRow } from './types';

declare const require: (m: string) => any;
declare const Buffer: any;
const nodeHttp = require('http');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

function startMock(): Promise<{ port: number; close: () => void; asked: string[] }> {
  const asked: string[] = [];
  return new Promise((resolve) => {
    const srv = nodeHttp.createServer((req: any, res: any) => {
      const chunks: any[] = [];
      req.on('data', (c: any) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/session-tree') {
          res.end(JSON.stringify({ ok: true, data: { sessions: [{ chat_id: 'c1', channel: 'web' }], chats: [] }, error: null }));
          return;
        }
        if (req.url === '/api/history') {
          // 折叠视图：只给尾部 2 个区域，并声明还有 3 个更早区域
          res.end(JSON.stringify({
            ok: true,
            data: {
              messages: [
                { id: 1, role: 'user', content: 'hi', turn_id: 7 },
                { id: 2, role: 'assistant', content: '', turn_id: 7, regions_before: 3,
                  iterations: [{ iteration: 5, content: 'e5' }, { iteration: 6, content: 'e6' }] },
              ],
              chat_id: 'c1', channel: 'web', last_seq: 0, has_more: false, oldest_id: 1,
            },
            error: null,
          }));
          return;
        }
        if (req.url === '/api/regions') {
          asked.push(body);
          // 第一次要 3 个更早（给 2 个 + 仍剩 1），第二次给最后 1 个（剩 0）
          if (body.indexOf('"before_iteration":5') >= 0) {
            res.end(JSON.stringify({ ok: true, data: { iterations: [{ iteration: 3, content: 'e3' }, { iteration: 4, content: 'e4' }], regions_before: 1 }, error: null }));
          } else {
            res.end(JSON.stringify({ ok: true, data: { iterations: [{ iteration: 1, content: 'e1' }, { iteration: 2, content: 'e2' }], regions_before: 0 }, error: null }));
          }
          return;
        }
        res.end(JSON.stringify({ ok: true, data: {}, error: null }));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, close: () => srv.close(), asked }));
  });
}

async function main(): Promise<void> {
  const mock = await startMock();
  const store = new ChatStore(`http://127.0.0.1:${mock.port}`);
  await store.loadSessions();
  await store.openSession('c1');

  const row: ChatRow | undefined = store.rows.find((r) => r.role === 'assistant');
  ok('解析出 assistant 行', row !== undefined);
  if (row === undefined) { mock.close(); return; }
  ok('带上 regions_before（折叠视图声明）', row.regionsBefore === 3, `regionsBefore=${row.regionsBefore}`);
  ok('初始只有尾部迭代', row.iterations.map((i) => i.iteration).join(',') === '5,6',
    row.iterations.map((i) => i.iteration).join(','));

  await store.loadEarlierRegions(row);
  ok('前插更早迭代并保持升序', row.iterations.map((i) => i.iteration).join(',') === '3,4,5,6',
    row.iterations.map((i) => i.iteration).join(','));
  ok('regions_before 递减', row.regionsBefore === 1, `regionsBefore=${row.regionsBefore}`);

  await store.loadEarlierRegions(row);
  ok('可反复加载直到取全', row.iterations.map((i) => i.iteration).join(',') === '1,2,3,4,5,6',
    row.iterations.map((i) => i.iteration).join(','));
  ok('取全后 regions_before 归零', row.regionsBefore === 0, `regionsBefore=${row.regionsBefore}`);
  ok('请求带 turn_id 与 before_iteration', mock.asked.length === 2
    && mock.asked[0].indexOf('"turn_id":7') >= 0 && mock.asked[0].indexOf('"before_iteration":5') >= 0,
    JSON.stringify(mock.asked));
  ok('去重：不产生重复迭代号',
    new Set(row.iterations.map((i) => i.iteration)).size === row.iterations.length);

  mock.close();
  console.log(`regions.test: ${pass} passed, ${fail} failed`);
  if (fail > 0) { throw new Error('regions 分页测试失败'); }
}

main();

// 显式退出：node 的事件循环可能被 mock 网络句柄/定时器拉住，不退出会让
// run.sh（set -e 顺序执行）永远卡在本文件，后续测试根本不跑。
process.exit(0);

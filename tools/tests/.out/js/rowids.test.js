"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 行 id 唯一性守护。
 *
 * 为什么必须测：ArkUI 的 ForEach 按 key 复用组件，**key 重复 ⇒ 复用/错位 ⇒ 整个渲染错乱**
 * （与 Web 端 React 重复 key 的 #185 同源）。原实现用 `local-<Date.now()>`、
 * `a-<turnID>` 等拼接，跨命名空间会撞；现统一走单调计数器，本测试把"任何操作序列后
 * id 全局唯一"钉死（含历史行、本地乐观行、重复发送）。
 */
const store_1 = require("./store");
const nodeHttp = require('http');
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
    if (cond) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`);
    }
}
function startMock() {
    const sent = [];
    return new Promise((resolve) => {
        const srv = nodeHttp.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                res.setHeader('Content-Type', 'application/json');
                if (req.url === '/api/session-tree') {
                    res.end(JSON.stringify({ ok: true, data: { sessions: [{ chat_id: 'chat-1', channel: 'web', label: 'T' }], chats: [] }, error: null }));
                    return;
                }
                if (req.url === '/api/history') {
                    // 历史里给出 message id = 1（user）与 2（assistant）⇒ 生成 u-1 / a-2
                    res.end(JSON.stringify({
                        ok: true,
                        data: {
                            messages: [
                                { id: 1, role: 'user', content: 'hi', turn_id: 1 },
                                { id: 2, role: 'assistant', content: '', turn_id: 1, iterations: [{ iteration: 1, content: 'ok' }] },
                            ],
                            chat_id: 'chat-1', channel: 'web', last_seq: 0, has_more: false, oldest_id: 1,
                        },
                        error: null,
                    }));
                    return;
                }
                if (req.url === '/api/message') {
                    sent.push(body);
                    res.end(JSON.stringify({ ok: true, data: {}, error: null }));
                    return;
                }
                if (req.url === '/api/queue/list') {
                    res.end(JSON.stringify({ ok: true, data: { items: [] }, error: null }));
                    return;
                }
                res.end(JSON.stringify({ ok: true, data: {}, error: null }));
            });
        });
        srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, close: () => srv.close(), sent }));
    });
}
function idsUnique(store) {
    const ids = store.rows.map((r) => r.id);
    return new Set(ids).size === ids.length;
}
async function main() {
    const mock = await startMock();
    const store = new store_1.ChatStore(`http://127.0.0.1:${mock.port}`);
    await store.loadSessions();
    ok('会话列表解析', store.sessions.length === 1, JSON.stringify(store.sessions));
    await store.openSession('chat-1');
    ok('历史行生成 2 行', store.rows.length === 2, `rows=${store.rows.length}`);
    ok('历史行 id 唯一', idsUnique(store), store.rows.map((r) => r.id).join(','));
    // 连续两次发送（原实现在同一毫秒会撞 local-<Date.now()>）
    await store.send('第一条');
    await store.send('第二条');
    ok('乐观 user 行各一行', store.rows.length === 4, `rows=${store.rows.length}`);
    ok('发送后 id 仍全局唯一（同毫秒连发也不撞）', idsUnique(store), store.rows.map((r) => r.id).join(','));
    ok('请求里带上了正确的 chat_id', mock.sent.every((b) => b.indexOf('chat-1') >= 0), JSON.stringify(mock.sent));
    mock.close();
    console.log(`rowids.test: ${pass} passed, ${fail} failed`);
    if (fail > 0) {
        throw new Error('行 id 唯一性测试失败');
    }
    // ⚠️ 必须显式退出：本测试开了真实 HTTP mock server + ChatStore（含网络句柄）⇒
    // 不 exit 时 node 事件循环不退出，run.sh（set -e 顺序执行）会**永远卡在这一步**，
    // 后面的测试文件根本不会跑（曾长期掩盖：看似"全绿"实则后半套件未执行）。
    process.exit(0);
}
main();

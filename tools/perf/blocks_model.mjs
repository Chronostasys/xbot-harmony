#!/usr/bin/env node
/**
 * tools/perf/blocks_model.mjs —— **只读**渲染规模基线（离线，真实服务端）。
 *
 * 口径来源：`docs/RENDER-LOAD-MEASUREMENT.md`（rows / 迭代总数 / 单行最多迭代 /
 * 实际渲染块数 / 最大单块字符数 / 正文字节）。本脚本 = 该口径的**免编译**实现，
 * 供 "块级窗口化"（MessageRow 单行 N 块）改造的**改前/改后**对比基线使用。
 *
 * 只调 `/api/auth/login`、`/api/session-tree`、`/api/history`，**绝不写数据**。
 *
 * 用法：
 *   XBOT_PERF_BASE=https://xbot.pivotlang.tech XBOT_PERF_USER=adm XBOT_PERF_PASS=123 \
 *     [XBOT_PERF_SCAN=30] [XBOT_PERF_WINDOW=24] node tools/perf/blocks_model.mjs
 */

const BASE = process.env.XBOT_PERF_BASE;
const USER = process.env.XBOT_PERF_USER || 'adm';
const PASS = process.env.XBOT_PERF_PASS || '123';
const SCAN = Number(process.env.XBOT_PERF_SCAN || '30');
/** 改造后"行内块级窗口"的目标上界（末尾 N 块渲染，其余折叠为 1 行哨兵）。 */
const WINDOW = Number(process.env.XBOT_PERF_WINDOW || '24');

if (!BASE) {
  console.log('blocks_model: 跳过（未设 XBOT_PERF_BASE）');
  process.exit(0);
}

let cookie = '';
async function rpc(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body || {}),
  });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const raw = res.headers.get('set-cookie');
  const all = sc.length > 0 ? sc : (raw ? [raw] : []);
  for (const c of all) {
    const m = /xbot_session=[^;]+/.exec(c);
    if (m) cookie = m[0];
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  const j = await res.json();
  return j && j.data !== undefined ? j.data : j;
}

/** 与 MessageRow 的渲染一一对应：一行 = Σ 每块的 MarkdownView 子树规模。 */
function countBlocks(rows, windowN) {
  let before = 0;      // 改造前：全部块渲染
  let after = 0;       // 改造后：末尾 windowN 块 + 1 行哨兵
  let worstBefore = 0;
  let worstAfter = 0;
  let rowsOneShot = 0; // 行内块数 > windowN 的行（改造后需要哨兵）
  for (const r of rows) {
    const n = r.iterations.length + (r.content.length > 0 && r.iterations.length === 0 ? 1 : 0);
    before += n;
    after += Math.min(n, windowN) + (n > windowN ? 1 : 0);
    if (n > worstBefore) worstBefore = n;
    const a = Math.min(n, windowN) + (n > windowN ? 1 : 0);
    if (n > windowN) rowsOneShot++;
    if (a > worstAfter && n === worstBefore) worstAfter = a;
  }
  return { before, after, worstBefore, worstAfter, rowsOneShot };
}

(async () => {
  await rpc('/api/auth/login', { username: USER, password: PASS });
  const tree = await rpc('/api/session-tree', {});
  const all = Array.isArray(tree) ? tree : (tree.sessions || tree.items || []);
  console.log(`会话总数=${all.length}；扫描 ${Math.min(SCAN, all.length)} 个；行内窗口上界=${WINDOW}`);

  const lines = [];
  let totBefore = 0, totAfter = 0, gWorstRow = 0, gWorstRowId = '';
  let rowsScanned = 0;
  for (let i = 0; i < Math.min(SCAN, all.length); i++) {
    const s = all[i];
    const chatId = s.chat_id || s.chatId || String(s.id || '');
    const channel = s.channel || 'web';
    if (!chatId) continue;
    let hist;
    try {
      hist = await rpc('/api/history', { channel, chat_id: chatId, limit: 30, before_id: 0 });
    } catch (e) {
      continue;
    }
    // ⛔ 服务端 null ≠ undefined（ARKTS-GOTCHAS 批次 15）：Go 的 nil slice marshal 成 null
    const msgs = Array.isArray(hist && hist.messages) ? hist.messages : [];
    const rows = [];
    for (const m of msgs) {
      const its = Array.isArray(m.iterations) ? m.iterations : [];
      rows.push({ iterations: its, content: typeof m.content === 'string' ? m.content : '' });
    }
    const c = countBlocks(rows, WINDOW);
    totBefore += c.before;
    totAfter += c.after;
    rowsScanned += rows.length;
    if (c.worstBefore > gWorstRow) { gWorstRow = c.worstBefore; gWorstRowId = chatId; }
    lines.push({ chatId, rows: rows.length, ...c });
  }
  lines.sort((a, b) => b.worstBefore - a.worstBefore);
  console.log('\n── 单行块数最多的会话（改造前 / 改造后）──');
  for (const l of lines.slice(0, 6)) {
    console.log(`  ${l.chatId} rows=${l.rows} 单行最多块=${l.worstBefore}`
      + ` 全表块数=${l.before} → 窗口后=${l.after}（该会话需哨兵行=${l.rowsOneShot}）`);
  }
  console.log('\n── 基线汇总（scan 内全部会话）──');
  console.log(`  扫到行数=${rowsScanned}`);
  console.log(`  总渲染块数（改造前）=${totBefore} → （窗口化后）=${totAfter}`
    + `  降幅=${totBefore > 0 ? Math.round((1 - totAfter / totBefore) * 100) : 0}%`);
  console.log(`  全库最重单行 = ${gWorstRow} 块（${gWorstRowId}）`);
  console.log(`  ⇒ 改后该行渲染块数 = ${Math.min(gWorstRow, WINDOW)} + 1 哨兵行`);
  process.exit(0);
})().catch((e) => {
  console.log('blocks_model 失败：', e.message);
  process.exit(1);
});

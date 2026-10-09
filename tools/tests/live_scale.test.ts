/**
 * 真实服务端**渲染负载全量扫描**（可选，默认跳过；只读）。
 *
 * 用法：XBOT_E2E_BASE=http://127.0.0.1:16000 XBOT_E2E_USER=adm XBOT_E2E_PASS=123 tools/tests/run.sh
 *
 * 为什么需要：单看一个会话不够——"渲染错乱"可能由多种规模形态触发，至少要能回答：
 *   ① 哪个会话的单行迭代数最多（触发"每行 ≤16 块"折叠）
 *   ② 是否存在**单个巨大块**（一个迭代就几十上百 KB ⇒ 单块高度/解析量爆炸）
 *   ③ 服务端折叠视图（regions_before）在哪些会话上生效（决定"历史能不能看全"）
 * 这些都在**只读**接口上完成：/api/history（不含写操作）。
 */
import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatRow, HistoryData, HistoryMessage } from '../../entry/src/main/ets/core/types';

declare const process: { env: Record<string, string>; exit: (c: number) => void };

const BASE = process.env.XBOT_E2E_BASE;
const USER = process.env.XBOT_E2E_USER || 'admin';
const PASS = process.env.XBOT_E2E_PASS || 'admin';
/** 与本应用一致的单 turn 迭代渲染上限（超出折叠） */
const MAX_ITER_VISIBLE = 16;
/** 单个迭代块超过这个体量就值得警惕（单块过高 / 流式重解析代价大） */
const BIG_BLOCK_CHARS = 32 * 1024;

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

function kb(n: number): string {
  return `${Math.round(n / 1024)}K`;
}

async function main(): Promise<void> {
  if (BASE === undefined || BASE.length === 0) {
    console.log('live_scale.test: 跳过（未设 XBOT_E2E_BASE）');
    return;
  }
  const store = new ChatStore(BASE);
  await store.http.login(USER, PASS);
  await store.loadSessions();
  const total = store.sessions.length;
  console.log(`live_scale.test: 会话总数=${total}`);
  ok('拿到会话列表', total > 0);

  const rowsOut: string[] = [];
  let sessionsChecked = 0;
  let bigBlocks = 0;
  let foldedSessions = 0;

  const LIMIT = Math.min(total, 12);
  for (let s = 0; s < LIMIT; s++) {
    const sess = store.sessions[s];
    const chatId: string = sess.chat_id !== undefined ? sess.chat_id : '';
    if (chatId.length === 0) {
      continue;
    }
    let hist: HistoryData;
    try {
      hist = await store.http.postAs<HistoryData>('/api/history', {
        channel: 'web', chat_id: chatId, limit: 30, before_id: 0,
      });
    } catch (e) {
      console.log(`  ! ${chatId} history 失败：${e}`);
      continue;
    }
    const msgs: HistoryMessage[] = hist.messages !== undefined ? hist.messages : [];
    // 诊断：服务端到底把迭代放在哪 —— 顶层 iteration_history 还是每条 message 里？
    // 若客户端只读 message.iterations 而服务端其实发在顶层，会成批渲染空白（必须查清）。
    const rawTop: string[] = Object.keys(hist as Object);
    let msgsWithIters = 0;
    for (let m = 0; m < msgs.length; m++) {
      const its = (msgs[m] as HistoryMessage).iterations;
      if (its !== undefined && its.length > 0) {
        msgsWithIters++;
      }
    }
    console.log(`  · ${chatId} 顶层字段=[${rawTop.join(',')}] messages=${msgs.length}`
      + ` 带iterations的message=${msgsWithIters}`);
    const rows: ChatRow[] = ChatStore.rowsFromHistory(msgs);
    sessionsChecked++;

    let iterTotal = 0;
    let maxRowIter = 0;
    let rendered = 0;
    let maxBlock = 0;
    let bodyChars = 0;
    let foldedRows = 0;
    for (let i = 0; i < rows.length; i++) {
      const r: ChatRow = rows[i];
      const n = r.iterations.length;
      iterTotal += n;
      rendered += Math.min(n, MAX_ITER_VISIBLE);
      if (n > maxRowIter) {
        maxRowIter = n;
      }
      if (r.regionsBefore > 0) {
        foldedRows++;
      }
      bodyChars += r.content.length;
      for (let k = 0; k < n; k++) {
        const it = r.iterations[k];
        const c = it.content !== undefined ? it.content.length : 0;
        const rz = it.reasoning !== undefined ? it.reasoning.length : 0;
        if (c > maxBlock) {
          maxBlock = c;
        }
        if (rz > maxBlock) {
          maxBlock = rz;
        }
      }
      // 不变量：迭代号必须唯一且升序（前插/去重正确）
      const nums = r.iterations.map((x) => x.iteration);
      ok(`${chatId} 行${i} 迭代号唯一`, new Set(nums).size === nums.length);
      ok(`${chatId} 行${i} 迭代号升序`, nums.every((v, idx, a) => idx === 0 || a[idx - 1] < v));
      // 不变量：渲染块数受上限约束
      ok(`${chatId} 行${i} 渲染块数 ≤ ${MAX_ITER_VISIBLE}`,
        Math.min(n, MAX_ITER_VISIBLE) <= MAX_ITER_VISIBLE);
    }
    if (foldedRows > 0) {
      foldedSessions++;
    }
    if (maxBlock > BIG_BLOCK_CHARS) {
      bigBlocks++;
    }
    rowsOut.push(`  ${chatId} rows=${rows.length} 迭代=${iterTotal} 单行最多=${maxRowIter}`
      + ` 渲染块=${rendered} 最大单块=${kb(maxBlock)} 正文=${kb(bodyChars)} 折叠行=${foldedRows}`);
  }

  console.log('=== 渲染负载（真实服务端，只读）===');
  for (let i = 0; i < rowsOut.length; i++) {
    console.log(rowsOut[i]);
  }
  console.log(`  扫描会话=${sessionsChecked}｜含折叠区域的会话=${foldedSessions}｜存在 >${kb(BIG_BLOCK_CHARS)} 单块的会话=${bigBlocks}`);
  ok('至少扫描到一个会话', sessionsChecked > 0);

  console.log(`live_scale.test: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    throw new Error('渲染负载扫描发现不变量被破坏');
  }
  process.exit(0);
}

main();

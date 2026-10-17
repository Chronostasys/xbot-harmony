/**
 * 转后台（promote-to-background）后 **tool 可见性不变量** —— 用户 2026-10-16 真机亲报：
 *
 *   「转后台点击后，转后台的那个迭代 tool **立刻消失**，过一会才会重新出现。」
 *
 * ── 取证（本地后端真实帧，探针 `/tmp/probeB.py` 抓的原始 SSE，2026-10-16）──────────
 * 转后台后的服务端帧序列（`data.progress` 原文，字段已逐字抄进本测试）：
 *
 *   F1 iter=1 tool_exec  active=[Shell running(iter1)]  completed=[]
 *   F2 iter=1 tool_exec  active=[Shell done(iter1)]     completed=[]          ← 采用成功
 *   F3 iter=1 tool_exec  active=[]                      completed=[Shell done(iter1)]
 *   F4 iter=2 thinking   active=[] completed=[]
 *                        iteration_history=[{iteration:1, **completed_tools=[Shell done]**}]
 *
 * ⇒ **服务端没丢数据**（delta 里带着 tool，只是装在 `completed_tools` 而非 `tools`；
 *   `agent_normalize.normalizeWebIteration` 有该回退）。所以丢失必发生在**前端**渲染链上。
 *
 * ── 判据（钉"渲染层真画出 pill"，与渲染同源）────────────────────────────────────
 * 每一步之后，**live 行里必须有一处**带着该 Shell 工具（无论它在在飞块还是已提交迭代块），
 * 否则用户看到的就是"pill 消失"。⛔ 只钉 reduce 的字段存在不够（判据/渲染分叉是历史高频根因）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { ChatRow, HistoryIteration, ToolProgress } from '../../entry/src/main/ets/core/types';
import type { SseListener } from '../../entry/src/main/ets/core/sse';

const CHAT = 'chat-1';
const CALL = 'call_f0c2e231cc5a477d8cc2bb61';

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${label}: ${detail}`); }
}
function ok(label: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${label}`); }
}

function wire(store: ChatStore): { emit: (e: string, p: object) => void } {
  const box: { listener: SseListener | null } = { listener: null };
  const httpAny = store.http as unknown as { post: (p: string, b: object) => Promise<string> };
  httpAny.post = (path: string, _body: object): Promise<string> => {
    if (path === '/api/history') {
      return Promise.resolve(JSON.stringify({
        chat_id: CHAT, channel: 'web', messages: [], has_more: false, oldest_id: 0,
      }));
    }
    return Promise.resolve(JSON.stringify({ message_id: 7, turn_id: 5, queued: false }));
  };
  const sseAny = store.sse as unknown as {
    connect: (c: string, ch: string, ck: string, l: SseListener) => void;
  };
  sseAny.connect = (_c: string, _ch: string, _ck: string, l: SseListener): void => {
    box.listener = l;
  };
  store.currentChatId = CHAT;
  store.subscribe();
  return {
    emit: (e: string, p: object): void => {
      const l = box.listener;
      if (l === null) { throw new Error('SSE listener 未捕获'); }
      l(e, JSON.stringify(p));
    },
  };
}

const P = (progress: object): object => ({ chat_id: CHAT, progress });

function liveRowOf(store: ChatStore): ChatRow | undefined {
  for (let i = 0; i < store.rows.length; i++) {
    if (store.rows[i].isLive) { return store.rows[i]; }
  }
  return undefined;
}

/** 渲染 oracle：live 行里**画出**的 Shell pill 枚数（逐个迭代块 + 在飞块都算）。 */
function renderedShellPills(row: ChatRow | undefined): number {
  if (row === undefined) { return -1; }
  let n = 0;
  for (let i = 0; i < row.iterations.length; i++) {
    const it: HistoryIteration = row.iterations[i];
    const tools: ToolProgress[] | undefined = it.tools;
    if (tools === undefined) { continue; }
    for (let j = 0; j < tools.length; j++) {
      if (tools[j].name === 'Shell') { n += 1; }
    }
  }
  return n;
}

const shell = (status: string, extra?: Record<string, string>): Record<string, string> => {
  const t: Record<string, string> = {
    name: 'Shell', label: 'Shell: sleep 90; echo DONE', status, iteration: '1', call_id: CALL,
  };
  if (extra !== undefined) {
    const ks: string[] = Object.keys(extra);
    for (let i = 0; i < ks.length; i++) { t[ks[i]] = extra[ks[i]]; }
  }
  return t;
};

const PROMOTED = '[PROMOTED to background by user] Command moved to the background [task_id: "7b95fd9a"]';

async function main(): Promise<void> {
  console.log('\n▶ 转后台后 tool 可见性（用户 2026-10-16 P0：pill 立刻消失、稍后才回）');
  const store = new ChatStore('http://127.0.0.1:9');
  const w = wire(store);
  await store.send('跑个长任务');

  const step = (label: string): void => {
    const row = liveRowOf(store);
    const pills = renderedShellPills(row);
    check(label, pills >= 1, `渲染出的 Shell pill 枚数=${pills}（0 = 用户看到的"消失"）`);
  };

  w.emit('progress_structured', P({
    turn_id: 5, phase: 'turn_started', seq: 2,
    turn_start: { trigger: 'user', content: '跑个长任务', request_id: 'r1' },
  }));

  // F1：Shell 起跑（前台）
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'tool_exec', seq: 10, iteration: 1,
    active_tools: [shell('running')], completed_tools: [],
  }));
  step('F1 Shell running');

  // F2：转后台被服务端采用 ⇒ done + PROMOTED 正文
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'tool_exec', seq: 11, iteration: 1,
    active_tools: [shell('done', { summary: PROMOTED, detail: PROMOTED })], completed_tools: [],
  }));
  step('F2 采用成功（active 里 done + PROMOTED）');

  // F3：服务端把完成的移出 active ⇒ completed
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'tool_exec', seq: 12, iteration: 1,
    active_tools: [], completed_tools: [shell('done', { summary: PROMOTED })],
  }));
  step('F3 移入 completed_tools');

  // F4：迭代推进（iter=2 thinking），delta 把 iter1 的 tool 装在 completed_tools 里
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'thinking', seq: 13, iteration: 2,
    active_tools: [], completed_tools: [],
    iteration_history: [{
      iteration: 1, reasoning: '思考…', content: '',
      completed_tools: [shell('done', { summary: PROMOTED })],
    }],
  }));
  step('F4 迭代推进（iter1 delta 带 completed_tools）');

  // F5：下一次 LLM 调用（iter=2 的流式正文）—— 不变式仍须成立
  w.emit('progress_structured', P({
    turn_id: 5, phase: 'thinking', seq: 14, iteration: 2, stream_content: '继续…',
  }));
  step('F5 iter2 流式正文');

  // ── ② 页面接线（源码形态）：结构投递**必须**在时间闸门之前 ────────────────────────
  // 病根（真机 + 本地后端实测帧时刻表）：转后台把工具从**在飞块**搬进**已完成块**
  // （`liveBlocks`）只用了两帧、相隔 **40ms**，而其后下一帧要 **1.2s** 才到（模型思考无帧）
  // ⇒ 若这一帧被 `syncLiveTail` 顶部的时间闸门（100ms / 浮层覆盖 400ms）`return` 掉，
  // 则本帧**没有任何地方再画这枚 pill**（在飞块已空、`liveBlocks` 又没投）⇒ 用户看到的
  // 「pill 立刻消失、过一会才回来」。
  // ⇒ 判据：`syncLiveTail` 里结构投递的位置**必须早于** ①100ms 闸门 ②`shouldDeliverLive(`
  //   ③`userScrolling` 分支（按**函数边界**截取，⛔ 不用定长窗 —— 见 AGENTS.md 的教训）。
  {
    const pathMod = require('path');
    const fsMod = require('fs');
    const pageSrc: string = fsMod.readFileSync(
      pathMod.resolve(__dirname, '../../../..', 'entry/src/main/ets/pages/Index.ets'), 'utf8');
    const fnA: number = pageSrc.indexOf('private syncLiveTail(): void {');
    ok('② 定位到 syncLiveTail', fnA > 0);
    const fnB: number = pageSrc.indexOf('private liveTailHasContent', fnA);
    const body: string = fnA > 0 && fnB > fnA ? pageSrc.substring(fnA, fnB) : '';
    ok('② 函数体截取到（函数边界，非定长窗）', body.length > 500);
    // 2026-10-17：结构投递改为**引用投递**（`row.completedBlocks`，整数 rev 门控），
    // 且不再有 `if (!this.userScrolling)` 分支（滚动期内容也不丢，只有 100ms/浮层降频）。
    const iStruct: number = body.indexOf('this.liveBlocks = this.liveRowRef.completedBlocks;');
    const iThrottle: number = body.indexOf('this.lastNonFollowLiveMs < 100');
    const iDeliver: number = body.indexOf('shouldDeliverLive(');
    const iGate: number = body.indexOf('if (throttled || covered)');
    ok('② 四个调用点都扫到（零扫描判红 —— 白绿防线）',
      iStruct >= 0 && iThrottle >= 0 && iDeliver >= 0 && iGate >= 0);
    ok('② 结构投递在 100ms 闸门**之前**（⛔ 被连坐 ⇒ pill 消失到下帧）',
      iStruct >= 0 && iThrottle >= 0 && iStruct < iThrottle);
    ok('② 结构投递在 shouldDeliverLive 闸门之前', iStruct >= 0 && iDeliver >= 0 && iStruct < iDeliver);
    ok('② 结构投递在内容闸门之前（滚动期也保留）',
      iStruct >= 0 && iGate >= 0 && iStruct < iGate);
  }

  if (fail > 0) {
    console.log(`  promote_tool_visibility: ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  console.log(`  promote_tool_visibility: ${pass} passed, 0 failed`);
  process.exit(0);
}

main();

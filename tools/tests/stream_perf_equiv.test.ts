/**
 * stream_perf_equiv.test.ts —— 流式渲染流水线**纯逻辑热路径**优化（目标⑤ 2026-10-11）的
 * **语义等价 + 不变量**判据。
 *
 * 本波只做「同样输入 ⇒ 同样输出」的纯优化，涉及 3 处：
 *   · `core/typewriter.ets` 的 `runeCount`（免分配计数）与 `clipRunes`（扫边界 + 单次 substring）；
 *   · `core/render.ets` 的 `inFlightBlock`（已提交工具键 `Array.indexOf` → `Set.has`）。
 *
 * 判据一律用**独立 oracle**（不调用被测优化实现）：
 *   · `runeCount`/`clipRunes` → oracle 由 `toRunes`（未改动）推导；
 *   · `inFlightBlock` 的键过滤 → oracle 用 `Array.indexOf` 重算。
 * ⇒ 任何语义偏移（少滤一枚、切坏代理对、键不含 call_id …）都会**逐字段不等** ⇒ 红。
 * （mutation 自证见文件末 §6。）
 */
declare const process: { exit: (c: number) => void };

import { toRunes, runeCount, clipRunes } from '../../entry/src/main/ets/core/typewriter';
import { inFlightBlock } from '../../entry/src/main/ets/core/render';
import {
  completedBlocks, mergeToolRuns, blocksSignature, toolKey,
} from '../../entry/src/main/ets/core/streammerge';
import { parseMarkdown, parseMarkdownCached, resetMdCache } from '../../entry/src/main/ets/core/markdown';
import { HistoryIteration, ToolProgress, ChatRow } from '../../entry/src/main/ets/core/types';
import { LiveRowView } from '../../entry/src/main/ets/core/derive';
import { WebToolProgress } from '../../entry/src/main/ets/core/chattypes';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 独立 oracle（不调用被测实现）───────────────────────────────────────────────
/** oracle：码点数 = `toRunes` 长度。 */
function oracleCount(text: string): number {
  return toRunes(text).length;
}
/** oracle：取前 n 个码点（由 `toRunes` 推导，逐码点拼）。 */
function oracleClip(text: string, n: number): string {
  if (n <= 0) { return ''; }
  const runes: string[] = toRunes(text);
  if (n >= runes.length) { return text; }
  let out: string = '';
  for (let i = 0; i < n; i++) { out += runes[i]; }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §1 typewriter：runeCount / clipRunes 与 oracle 逐字相等（含代理对边界）');
{
  const battery: string[] = [
    '',                         // 空
    'a',                        // 单字符
    '中',                       // 单 CJK
    'abc',
    '中文正文',
    'a👍b',                     // 代理对居中
    '👍',                       // 纯 emoji
    '👍👍👍',
    'x👍',                      // 代理对收尾
    '\ud83d',                   // **孤立高代理**（末位，按单单元处理）
    'a\ud83d',                  // 孤立高代理收尾
    '\ud83d\ude00\ud83d',       // emoji + 尾孤立高代理
    '**粗体** `code` [链接](http://x)',
    '```ts\nconst a = 1;\n```',
    '行1\n行2\n\n行3',
    '中文正文'.repeat(2000),     // 超长 8000 字符
    ('a👍b'.repeat(2000)),       // 超长 + 大量代理对
  ];
  let countOk = true, clipOk = true, pairOk = true;
  for (let b = 0; b < battery.length; b++) {
    const s: string = battery[b];
    if (runeCount(s) !== oracleCount(s)) { countOk = false; console.log(`    count 不等: ${JSON.stringify(s).slice(0, 40)}`); }
    for (let n = -1; n <= 8; n++) {
      const got: string = clipRunes(s, n);
      if (got !== oracleClip(s, n)) { clipOk = false; console.log(`    clip 不等: n=${n} s=${JSON.stringify(s).slice(0, 40)}`); }
    }
    // 超长切片：只在码点边界切（不切出半个代理对 ⇒ 无孤立高代理收尾）
    for (const n of [1, 2, 3, 7, 4000, s.length]) {
      const got: string = clipRunes(s, n);
      const lastC: number = got.length > 0 ? got.charCodeAt(got.length - 1) : 0;
      const isLoneHigh: boolean = lastC >= 0xd800 && lastC <= 0xdbff;
      const srcEndsHigh: boolean = s.length > 0 && (s.charCodeAt(s.length - 1) >= 0xd800 && s.charCodeAt(s.length - 1) <= 0xdbff);
      if (isLoneHigh && !srcEndsHigh) { pairOk = false; console.log(`    切坏代理对: n=${n} s=${JSON.stringify(s).slice(0, 40)}`); }
    }
  }
  ok('★1 runeCount == oracle（全部样例，含孤立高代理 / 超长 / 大量 emoji）', countOk);
  ok('★1 clipRunes == oracle（n 取 -1..8，含 0 / 负数 / 超长）', clipOk);
  ok('★1 clipRunes 不切出半个代理对（除源串本身以孤立高代理收尾）', pairOk);
  // 具体回归钉（可读性 + 防"oracle 一起被改坏"）：
  eq('★1 裁剪不切坏 emoji：clipRunes("a👍b", 2)', clipRunes('a👍b', 2), 'a👍');
  eq('★1 emoji 计 1 个码点', runeCount('👍'), 1);
  eq('★1 JS length 是 2（对照组）', '👍'.length, 2);
  eq('★1 超长返回原串', clipRunes('中文正文', 99), '中文正文');
  eq('★1 n<=0 返回空串', clipRunes('中文正文', 0), '');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §2 inFlightBlock：工具键过滤 ≡ indexOf oracle（含大键集 / 部分命中 / 全滤光）');
{
  function tw(name: string, status: string, callId: string, iter?: number): WebToolProgress {
    const o: { [k: string]: unknown } = {
      name, label: name, status, elapsedMs: 0, summary: '', detail: '', args: '', toolHints: '', callID: callId,
    };
    if (iter !== undefined) { o.iteration = iter; }
    return o as unknown as WebToolProgress;
  }
  function doneTool(i: number): ToolProgress {
    return { name: 'Shell', label: '运行', status: 'done', call_id: `c${i}` } as unknown as ToolProgress;
  }
  function completedWith(k: number): HistoryIteration[] {
    const out: HistoryIteration[] = [];
    for (let i = 1; i <= k; i++) {
      out.push({ iteration: i, content: '', reasoning: '', tools: [doneTool(i)], tools_folded: false });
    }
    return out;
  }
  function liveOf(active: WebToolProgress[], streaming: WebToolProgress[], lastIter: number): LiveRowView {
    return {
      kind: 'live', id: 'live', turnID: 1, isPartial: true, streaming: true,
      content: 'x'.repeat(50), reasoning: '', iterations: [], activeTools: active,
      streamingTools: streaming, genui: '', subAgents: [], todos: [], lastIter,
    } as unknown as LiveRowView;
  }
  /** oracle：按 toolKey 去重后，滤掉键在 completedKeys 里的（用 Array.indexOf，非 Set）。 */
  function oracleLiveKeys(active: WebToolProgress[], streaming: WebToolProgress[], completed: HistoryIteration[]): string[] {
    const completedKeys: string[] = [];
    for (let i = 0; i < completed.length; i++) {
      const ts: ToolProgress[] | undefined = completed[i].tools;
      if (ts === undefined) { continue; }
      for (let j = 0; j < ts.length; j++) { completedKeys.push(toolKey(ts[j])); }
    }
    const seen: { [k: string]: boolean } = {};
    const out: string[] = [];
    const consider = (list: WebToolProgress[]): void => {
      for (let i = 0; i < list.length; i++) {
        const w: WebToolProgress = list[i];
        const nat: ToolProgress = { name: w.name, label: w.label, status: w.status, call_id: w.callID } as unknown as ToolProgress;
        const key: string = toolKey(nat);
        if (seen[key] === true) { continue; }
        seen[key] = true;
        if (completedKeys.indexOf(key) < 0) {
          const cid: string | undefined = w.callID;
          out.push(cid !== undefined ? cid : '');
        }
      }
    };
    consider(streaming);
    consider(active);
    return out;
  }
  function actualLiveKeys(block: HistoryIteration | null): string[] {
    if (block === null) { return []; }
    const ts: ToolProgress[] = block.tools === undefined ? [] : block.tools;
    const out: string[] = [];
    for (let i = 0; i < ts.length; i++) {
      const cid: string | undefined = ts[i].call_id;
      out.push(cid !== undefined ? cid : '');
    }
    return out;
  }
  let allEq = true;
  const cases: string[] = [];
  // 用例矩阵：completed 键数 K ∈ {0,1,8,54,108}；在飞 D ∈ {0,1,8,64}；命中重叠度分档
  const Ks = [0, 1, 8, 54, 108];
  const Ds = [0, 1, 8, 64];
  for (const K of Ks) {
    for (const D of Ds) {
      const completed: HistoryIteration[] = completedWith(K);
      const active: WebToolProgress[] = [];
      for (let i = 0; i < D; i++) {
        // 让约一半在飞键与已提交键重叠（i 为奇数 ⇒ 命中 c{i}），另一半是新键（w{i}）
        const overlap: boolean = K > 0 && i % 2 === 1 && i <= K;
        active.push(tw('Shell', 'running', overlap ? `c${i}` : `w${i}`));
      }
      const block: HistoryIteration | null = inFlightBlock(liveOf(active, [], D), completed);
      const got: string[] = actualLiveKeys(block);
      const want: string[] = oracleLiveKeys(active, [], completed);
      const same: boolean = JSON.stringify(got) === JSON.stringify(want);
      allEq = allEq && same;
      if (!same && cases.length < 4) { cases.push(`K=${K} D=${D} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
    }
  }
  for (const c of cases) { console.log(`    ${c}`); }
  ok('★2 inFlightBlock 键过滤 == indexOf oracle（5×4=20 组合：K∈{0,1,8,54,108}×D∈{0,1,8,64}）', allEq);

  // 具体边界钉（可读性 + 防"oracle 一起被改坏"）
  {
    const completed: HistoryIteration[] = completedWith(5);
    // 命中：c1/c3 在已提交里 ⇒ 被滤；w9 是新键 ⇒ 保留
    const active: WebToolProgress[] = [tw('Shell', 'running', 'c1'), tw('Shell', 'running', 'w9'), tw('Shell', 'running', 'c3')];
    const block: HistoryIteration | null = inFlightBlock(liveOf(active, [], 9), completed);
    eq('★2 已提交同键被滤掉、新键保留', actualLiveKeys(block), ['w9']);
  }
  {
    const completed: HistoryIteration[] = completedWith(5);
    // 只有陈旧命中项 + 无正文/思考 ⇒ null（不产空壳）
    const lv = liveOf([tw('Shell', 'pending', 'c2')], [], 5);
    (lv as unknown as { content: string }).content = '';
    eq('★2 全部被滤 + 无正文 ⇒ null（不产"全是排队"空壳）', inFlightBlock(lv, completed), null);
  }
  {
    // 去重：同一 call_id 出现在 active 与 streaming ⇒ 只一行（且都未在 completed 里）
    const block: HistoryIteration | null = inFlightBlock(
      liveOf([tw('Shell', 'running', 'z1')], [tw('Shell', 'running', 'z1')], 1), []);
    eq('★2 同 call_id（active+streaming）只留一行', actualLiveKeys(block), ['z1']);
  }
  {
    // 迭代号过滤（web toolDeriv）：陈旧 pending（iteration <= maxCompleted）被滤
    const completed: HistoryIteration[] = [{ iteration: 2, content: '', reasoning: '', tools: [], tools_folded: false }];
    const stale: WebToolProgress = tw('Write', 'pending', 'stale', 2);
    const cur: WebToolProgress = tw('Read', 'running', 'cur', 3);
    const block: HistoryIteration | null = inFlightBlock(liveOf([stale, cur], [], 3), completed);
    eq('★2 陈旧 pending（iter 2 ≤ maxCompleted 2）被滤，当前 executing 保留', actualLiveKeys(block), ['cur']);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §3 块切分 / 合并：同一批输入下 completedBlocks 与 mergeToolRuns 逐字稳定');
{
  function iter(n: number, content: string, reasoning: string, tools: ToolProgress[]): HistoryIteration {
    return { iteration: n, content, reasoning, tools, tools_folded: false };
  }
  function tool(name: string, cid: string): ToolProgress {
    return { name, label: name, status: 'done', call_id: cid } as unknown as ToolProgress;
  }
  // 边界批次：空 / 单块 / 含正文 / 纯工具连续块（可被吸收）/ 混合
  const batches: HistoryIteration[][] = [
    [],
    [iter(1, 'hello', '', [])],
    [iter(1, 'a', 'think', [tool('S', 'c1')])],
    [iter(1, '', '', [tool('S', 'c1')]), iter(2, '', '', [tool('R', 'c2')]), iter(3, '', '', [tool('W', 'c3')])],
    [iter(1, 'text1', '', [tool('S', 'c1')]), iter(2, '', '', [tool('R', 'c2')]), iter(3, 'text3', '', [])],
    [iter(1, 'x'.repeat(3000), '', []), iter(2, '', 'reason'.repeat(500), [])],
  ];
  let splitOk = true, mergeOk = true;
  for (let b = 0; b < batches.length; b++) {
    const bs: HistoryIteration[] = batches[b];
    if (completedBlocks({ iterations: bs } as ChatRow).length !== bs.length) { splitOk = false; }
    const merged: HistoryIteration[] = mergeToolRuns(bs);
    // 不变量：合并**不丢内容**（非工具块数量保持；块数 ≤ 原块数）
    if (merged.length > bs.length) { mergeOk = false; }
    for (let i = 0; i < merged.length; i++) {
      const m: HistoryIteration = merged[i];
      if (m.iteration === undefined || m.content === undefined || m.reasoning === undefined) { mergeOk = false; }
    }
    // 稳定性：同输入两次调用 ⇒ 同一 key 序列
    if (blocksSignature(mergeToolRuns(bs)) !== blocksSignature(merged)) { mergeOk = false; }
  }
  ok('★3 completedBlocks 不丢块（空/单块/纯工具/混合 全部 batch）', splitOk);
  ok('★3 mergeToolRuns 结构不变量：不增块、字段齐全、同输入同输出（稳定）', mergeOk);
  // 具体钉：连续纯工具块被吸收进前一个含工具块，保留 head 迭代号，工具顺序先 head 后成员
  {
    const bs: HistoryIteration[] = [
      iter(1, '', '', [tool('S', 'c1')]),
      iter(2, '', '', [tool('R', 'c2')]),
      iter(3, '', '', [tool('W', 'c3')]),
    ];
    const merged: HistoryIteration[] = mergeToolRuns(bs);
    eq('★3 三个连续纯工具块合为一块', merged.length, 1);
    eq('★3 保留 head 迭代号', merged[0].iteration, 1);
    eq('★3 工具顺序 = 先 head 后成员', merged[0].tools !== undefined ? merged[0].tools.map((t) => t.call_id) : [], ['c1', 'c2', 'c3']);
  }
  // 含正文的块**不**被吸收（文本不丢失）
  {
    const bs: HistoryIteration[] = [
      iter(1, '', '', [tool('S', 'c1')]),
      iter(2, '正文不可丢', '', [tool('R', 'c2')]),
    ];
    const merged: HistoryIteration[] = mergeToolRuns(bs);
    eq('★3 含正文的块不被吸收 ⇒ 仍是两块', merged.length, 2);
    eq('★3 正文逐字保留', merged[1].content, '正文不可丢');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §4 Markdown：mdCache 按块增量复用 ≡ 全量 parseMarkdown（逐字，含代码块）');
{
  function sig(blocks: { key: string; kind: number; text: string; items: string[]; code: string; header: string[]; rows: string[][]; start: number }[]): string {
    const out: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      out.push(`${b.key}|${b.kind}|${b.text}|${b.items.join(',')}|${b.code}|${b.header.join(',')}|${b.rows.map((r) => r.join('/')).join(';')}|${b.start}`);
    }
    return out.join('\n');
  }
  resetMdCache();
  // 流式增长：逐步追加（含围栏代码块），每步用 cached 与全量 parseMarkdown 比
  const steps: string[] = [
    '# 标题\n\n第一段',
    '# 标题\n\n第一段中文\n\n',
    '# 标题\n\n第一段中文\n\n- 项1\n- 项2\n\n',
    '# 标题\n\n第一段中文\n\n- 项1\n- 项2\n\n```ts\nconst a = 1;\n',
    '# 标题\n\n第一段中文\n\n- 项1\n- 项2\n\n```ts\nconst a = 1;\nconsole.log(a);\n```\n\n尾段',
    '# 标题\n\n第一段中文\n\n- 项1\n- 项2\n\n```ts\nconst a = 1;\nconsole.log(a);\n```\n\n尾段\n\n| A | B |\n|---|---|\n| 1 | 2 |\n',
  ];
  let ident = true;
  for (const s of steps) {
    const cached: unknown = parseMarkdownCached(s);
    const full: unknown = parseMarkdown(s);
    // 逐字（含 key/start/文本/items/code/表格）比较
    if (sig(cached as never) !== sig(full as never)) { ident = false; console.log(`    增量 != 全量 @len=${s.length}`); }
  }
  ok('★4 逐步增长（含围栏代码块 + 表格）下：增量复用结果 == 全量解析（逐字）', ident);
  // 重复同文本 ⇒ 全命中且结果恒等
  const t = steps[steps.length - 1];
  const a: string = sig(parseMarkdownCached(t) as never);
  const b: string = sig(parseMarkdownCached(t) as never);
  eq('★4 重复同文本 ⇒ 结果恒等（缓存不改语义）', a, b);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §5 零样本防线（防止"优化成空操作"的假绿）');
{
  // runeCount/clipRunes 必须真的在算（不是恒 0 / 恒空）
  ok('★5 runeCount 非零（真的在数）', runeCount('中文正文') === 4);
  ok('★5 clipRunes 真的裁剪（非恒空/非恒原串）', clipRunes('abcde', 2) === 'ab' && clipRunes('abcde', 2) !== 'abcde');
  // inFlightBlock 必须真的在滤（不是恒空）
  const completed: HistoryIteration[] = [{ iteration: 1, content: '', reasoning: '', tools: [{ name: 'S', label: 'S', status: 'done', call_id: 'keep' } as unknown as ToolProgress], tools_folded: false }];
  const lv: LiveRowView = {
    kind: 'live', id: 'live', turnID: 1, isPartial: true, streaming: true, content: 'x',
    reasoning: '', iterations: [], activeTools: [{ name: 'R', label: 'R', status: 'running', callID: 'gone' } as unknown as WebToolProgress],
    streamingTools: [], genui: '', subAgents: [], todos: [], lastIter: 2,
  } as unknown as LiveRowView;
  const blk: HistoryIteration | null = inFlightBlock(lv, completed);
  ok('★5 有产物（不是恒 null）', blk !== null);
  // parseMarkdown 真的切块
  ok('★5 parseMarkdown 真在切块（非恒空）', parseMarkdown('# H\n\ntext').length === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §6 mutation 自证（由外部脚本注入，改动语义 ⇒ 本文件必红）:');
console.log('   · `core/typewriter.ets` `runeWidthAt` 改 `return 1`（忽略代理对）');
console.log('     ⇒ §1 clipRunes/runeCount 与 oracle 不等 ⇒ 红；');
console.log('   · `core/render.ets` `inFlightBlock` 去掉 `!completedKeys.has(...)` 过滤');
console.log('     ⇒ §2 「已提交同键被滤掉」红；');
console.log('   · `core/render.ets` 已提交键改用 `it.tools[j].name`（丢 call_id）');
console.log('     ⇒ §2 oracle（按 toolKey）不等 ⇒ 红。');

if (fail > 0) { console.log(`\n  stream_perf_equiv: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  stream_perf_equiv: ${pass} passed, 0 failed`);
process.exit(0);

export {};

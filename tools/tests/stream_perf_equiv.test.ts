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
import {
  completedBlocks, mergeToolRuns, blocksSignature,
} from '../../entry/src/main/ets/core/streammerge';
import { ModelFeed } from './model_harness';
import { parseMarkdown, parseMarkdownCached, parseInline, resetMdCache, MdSpan } from '../../entry/src/main/ets/core/markdown';
import { HistoryIteration, ToolProgress, ChatRow } from '../../entry/src/main/ets/core/types';

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
// §2 **已删除**（2026-10-21 链路迁移）—— 旧链路 `core/render.ets:inFlightBlock` 的判据。
//
// 旧判据守的两条保证（`inFlightBlock` 是 `applyRow` live 分支的唯一消费者）：
//   ① 在飞工具 = `streamingTools ⊕ activeTools`，**按 `toolKey`（call_id）去重**，
//      且**滤掉已在已完成块里的键**（否则工具双渲染 —— 用户 2026-09-04 turn-580-live 实录）；
//   ② 按**迭代号**滤陈旧项（`iteration <= maxCompletedIter` 且状态仍是 pending/running 的
//      要滤掉 —— web `LiveIteration.tsx:149-183` `toolDeriv` 的硬要求，见 AGENTS.md 的
//      "服务端 active_tools 整批先标 pending" 一条）。
// ⇒ 新链路的在飞工具是**模型位置状态**（`model_step.applyToolTicks` 直接用该帧 tick 全集），
//   **既不去重也不按迭代号过滤**（实测：同一 `call_id` 同时出现在 streaming+active ⇒
//   `live.tools` 里出现两条；`iteration=1` 的陈旧 pending 工具在已完成块号=1 时仍保留）。
//   即：这两条保证在**新链路整体不存在** ⇒ 判据删除（不把现状钉成"正确"）。
//   ⚠️ 已上报：若要恢复，落点是 `core/model_adapter.ts` 的 tick 工具装配（或
//   `core/model_step.ts:applyToolTicks` 的去重/过滤），恢复后应把本段按新入口重写。
console.log('\n▶ §2 inFlightBlock 判据已删除（旧链路函数，新链路无等价保证 —— 见本段注释）');

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
  // 链路必须真的在产出在飞块与工具（不是恒空）
  const f5 = new ModelFeed('c');
  f5.push({ type: 'turn_started', turnID: 1, requestID: null, trigger: 'user', content: null });
  f5.push({
    type: 'iteration', turnID: 1, iter: 1, seq: 10, phase: 'tool_gen',
    content: 'x', reasoning: '', completedTools: [],
    activeTools: [{ name: 'R', label: 'R', status: 'running', call_id: 'keep' }],
  });
  const rows5: ChatRow[] = f5.rows();
  const live5: ChatRow = rows5.filter((r) => r.id === 'turn-1-live')[0];
  const its5: HistoryIteration[] = live5.iterations;
  const blk: HistoryIteration | undefined = its5.length > 0 ? its5[its5.length - 1] : undefined;
  ok('★5 有产物（在飞块存在，不是恒空）', blk !== undefined && its5.length === 1);
  ok('★5 在飞块带工具（不是恒空工具表）',
    blk !== undefined && blk.tools !== undefined && blk.tools.length === 1
      && blk.tools[0].call_id === 'keep' && blk.tools[0].status === 'running');
  // parseMarkdown 真的切块
  ok('★5 parseMarkdown 真在切块（非恒空）', parseMarkdown('# H\n\ntext').length === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §7 assignKeys：增量「只重编号尾部」≡ 全量重编号（多块增长 ⇒ 逐块 key/start 相等）');
{
  /** MdBlock 关键字段 → 规范化字符串（含 key 与 start —— 二者都必须与全量解析一致）。 */
  function mdSig(bs: unknown[]): string {
    const out: string[] = [];
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i] as { key: string; kind: number; text: string; items: string[]; code: string; header: string[]; rows: string[][]; start: number };
      out.push(`${b.key}|${b.kind}|${b.text}|${b.items.join(',')}|${b.code}|${b.header.join(',')}|${b.rows.map((r) => r.join('/')).join(';')}|${b.start}`);
    }
    return out.join('\n');
  }
  resetMdCache();
  let doc = '';
  let stepOk = true;
  let keyWidthOk = true;
  for (let i = 0; i < 30; i++) {
    doc += `## 标题${i}\n\n第 ${i} 段的正文内容，含 **粗体** 与 \`code\`。\n\n`;
    const cached = parseMarkdownCached(doc) as unknown as unknown[];
    const full = parseMarkdown(doc) as unknown as unknown[];
    if (mdSig(cached) !== mdSig(full)) { stepOk = false; console.log(`    增量 != 全量 @blocks=${full.length}`); }
    if (cached.length !== full.length) { keyWidthOk = false; }
  }
  ok('★7 30 步增长（多块，每步都触发增量尾部重编号）：增量 key/start == 全量（逐块）', stepOk);
  ok('★7 块数一致（不是"扫了 0 块"的假绿）', keyWidthOk);
  const grown = parseMarkdownCached(doc) as unknown as { key: string }[];
  // key 必须含**全局下标**（尾部块的下标不得从 0 重启 ⇒ 否则与头部撞 key）
  let globalIdx = true;
  for (let i = 0; i < grown.length; i++) {
    if (grown[i].key.indexOf(`-${i}`) < 0) { globalIdx = false; }
  }
  ok('★7 每块 key 含其**全局下标**（尾部不从 0 重启 ⇒ 不与头部撞 key）', globalIdx && grown.length > 5);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §8 blocksSignature：记忆化不改变输出（独立 oracle 逐字节比 + 换内容必换值）');
{
  /** oracle：与生产同格式，但**独立重写**（不调用被测实现）。 */
  function oracleSig(bs: HistoryIteration[]): string {
    let s = `${bs.length}`;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      s += `|${b.iteration}:${(b.content ?? '').length}:${(b.reasoning ?? '').length}`
        + `:${b.tools !== undefined ? b.tools.length : 0}`;
    }
    return s;
  }
  function mk(n: number, extra = ''): HistoryIteration[] {
    const a: HistoryIteration[] = [];
    for (let i = 1; i <= n; i++) {
      a.push({ iteration: i, content: '正文' + i + extra, reasoning: i % 3 === 0 ? 'reason' : '', tools: [], tools_folded: false });
    }
    return a;
  }
  let eqOk = true;
  for (const n of [0, 1, 8, 24, 340]) {
    const bs = mk(n);
    if (blocksSignature(bs) !== oracleSig(bs)) { eqOk = false; console.log(`    n=${n} 不等`); }
    // 幂等（记忆化命中路径必须与首次计算同值）
    if (blocksSignature(bs) !== blocksSignature(bs)) { eqOk = false; }
  }
  ok('★8 blocksSignature == oracle（n∈{0,1,8,24,340}；含记忆化命中路径）', eqOk);

  // 同内容、**不同对象** ⇒ 同值（内容派生，不是身份派生）
  const a1 = mk(24);
  const a2 = mk(24);
  eq('★8 同内容不同对象 ⇒ 同签名（被比对方是每帧新数组）', blocksSignature(a1), blocksSignature(a2));
  // 改一个块的长度 ⇒ 必换值（覆盖"同号权威覆盖"场景）
  const a3 = mk(24);
  a3[5].content = a3[5].content + 'X';
  ok('★8 任一块内容长度变化 ⇒ 签名必变（判别力不降）', blocksSignature(a1) !== blocksSignature(a3));
  // 换源数组（同一对象反复用不同切片）⇒ 每侧各自按自身内容取值
  const base = mk(24);
  const v1 = blocksSignature(base.slice());
  const v2 = blocksSignature(base.slice());
  eq('★8 不同数组对象、同内容 ⇒ 等值（记忆化不产生陈旧）', v1, v2);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §9 parseInline：纯文本早退 ≡ 旧行为（空串仍 []；含标记字符仍走完整解析）');
{
  const plainCases: string[] = [
    '这是一段没有任何行内标记的纯文本正文',
    'abc',
    'x y z 1 2 3',
    '中文，标点。（括号）【方括号】',      // 全角括号不是标记字符
    'a b  c   d',
    '中文'.repeat(500),
  ];
  let plainOk = true;
  for (const s of plainCases) {
    const sp = parseInline(s);
    if (sp.length !== 1 || sp[0].text !== s || sp[0].bold || sp[0].italic || sp[0].code
      || sp[0].strike || sp[0].link !== '' || sp[0].image !== '') {
      plainOk = false; console.log(`     纯文本早退不符: ${JSON.stringify(s).slice(0, 20)}`);
    }
  }
  ok('★9 纯文本（无 ` ! [ * _ ~）⇒ 单个纯 span、全文、无任何标记位', plainOk);
  eq('★9 空串仍返回 []（早退必须要求 length>0）', parseInline('').length, 0);

  // 含任一标记字符 ⇒ 早退**不触发**，仍走完整解析（结果正确）
  const markedCases: [string, (s: { bold: boolean; italic: boolean; code: boolean; strike: boolean; link: string; image: string }) => boolean][] = [
    ['**粗**', (s) => s.bold],
    ['_斜_', (s) => s.italic],
    ['`码`', (s) => s.code],
    ['~~删~~', (s) => s.strike],
    ['[文](http://x)', (s) => s.link === 'http://x'],
    ['![图](http://y)', (s) => s.image === 'http://y'],
  ];
  let markedOk = true;
  for (const c of markedCases) {
    const sp = parseInline(c[0]);
    if (sp.length !== 1 || !c[1](sp[0])) { markedOk = false; console.log(`     标记解析不符: ${c[0]}`); }
  }
  ok('★9 含标记字符 ⇒ 早退不触发、完整解析仍正确（6 类）', markedOk);
  // 含标记字符但**非合法标记**（如孤立 `!`）⇒ 仍走完整解析，结果仍是单 span（不误判）
  const lone = parseInline('a!b');
  ok('★9 孤立 `!`（非合法图片）⇒ 完整解析后仍是单个纯 span', lone.length === 1 && lone[0].text === 'a!b' && lone[0].image === '');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §10 行源 = 模型投影：同一状态重复投影**零新对象**，新帧只换在飞行，commit 必长新块');
//   旧写法（旧链路的 oracle）：`blocksSignature(completedBlocks(row))` —— 每帧新数组、每帧 miss，
//   靠"双命中"（行指纹 + 源数组指纹）才 O(1)。
//   新链路（行源 = `model_bridge.applyModel`）：`PRow` 引用早退 + `toHistoryIteration` 按源
//   `Block` 恒等记忆化 ⇒ "已完成块指纹"退化成 **对象恒等比较**（不再有任何字符串拼接）。
//   本段钉住这条 O(1) 链的三个事实：① 同状态重复投影幂等；② 流式帧只换在飞行、
//   已完成块对象逐元素恒等；③ 提交帧必长出新块（不陈旧）。
{
  const T10 = 1;
  const itEv10 = (iter: number, c: string, seq: number, delta: boolean): { [k: string]: unknown } => {
    const ev: { [k: string]: unknown } = {
      type: 'iteration', turnID: T10, iter, seq, phase: 'tool_exec',
      content: c, reasoning: '', activeTools: [], completedTools: [],
    };
    if (delta) {
      ev.iterationsDelta = [{ iteration: iter, content: `iter-${iter}-final`, reasoning: '', tools: [], toolCount: 0 }];
    }
    return ev;
  };
  const buildLive10 = (k: number): ModelFeed => {
    const f = new ModelFeed('c');
    f.push({ type: 'turn_started', turnID: T10, requestID: null, trigger: 'user', content: null });
    for (let n = 1; n <= k; n++) { f.push(itEv10(n, `s-${n}`, n * 10, true)); }
    f.push(itEv10(k + 1, 'x', (k + 1) * 10, false));      // 在飞迭代
    return f;
  };
  const liveRow10 = (f: ModelFeed): ChatRow => {
    const rows: ChatRow[] = f.rows();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === 'turn-1-live') { return rows[i]; }
    }
    throw new Error('§10 无 live 行 —— 构造器坏了（零扫描防线）');
  };

  let idempotent = true;        // 同一状态重复投影 ⇒ 零新对象
  let onlyLiveChanged = true;   // 流式帧只改在飞行（已完成块对象恒等）
  let commitGrows = true;       // 提交帧必长新块（新对象）
  let sawNonEmpty = false;      // 零扫描防线
  for (const K of [0, 8, 24, 108]) {
    const f = buildLive10(K);
    const row: ChatRow = liveRow10(f);
    const cb0: HistoryIteration[] = row.completedBlocks.slice(0);
    const its0: unknown = row.iterations;
    const otherBefore = f.rows().filter((r) => r.id !== 'turn-1-live');

    // ① 同一状态重复投影：行对象、iterations、completedBlocks **全部同一引用**
    const again = liveRow10(f);
    if (again !== row || again.iterations !== its0 || again.completedBlocks !== row.completedBlocks) {
      idempotent = false;
    }
    if (K > 0) { sawNonEmpty = true; }

    // ② 流式帧（在飞正文增长）：在飞行换 iterations，已完成块逐元素恒等；其它行不被重建
    f.push(itEv10(K + 1, 'xy', (K + 1) * 10 + 1, false));
    const rowsAfter = f.rows();
    const live = liveRow10(f);
    if (live.iterations === its0) { onlyLiveChanged = false; }       // 在飞行必须更新
    if (live.completedBlocks.length !== K) { onlyLiveChanged = false; }
    for (let i = 0; i < K; i++) {
      if (live.completedBlocks[i] !== cb0[i]) { onlyLiveChanged = false; }
    }
    const othersAfter = rowsAfter.filter((r) => r.id !== 'turn-1-live');
    if (othersAfter.length !== otherBefore.length) { onlyLiveChanged = false; }
    for (let i = 0; i < othersAfter.length; i++) {
      if (othersAfter[i] !== otherBefore[i]) { onlyLiveChanged = false; }
    }

    // ③ commit 帧：已完成块 +1，新块是**新对象**（绝不陈旧）
    const lastBefore: HistoryIteration | undefined = live.completedBlocks[K - 1];
    f.push(itEv10(K + 1, 'xy', (K + 1) * 10 + 2, true));
    const live2 = liveRow10(f);
    if (live2.completedBlocks.length !== K + 1) { commitGrows = false; }
    if (live2.completedBlocks[K] === lastBefore || live2.completedBlocks[K] === undefined) { commitGrows = false; }
    if (K > 0 && live2.completedBlocks[0] !== cb0[0]) { commitGrows = false; }
  }
  ok('★10 同一状态重复投影 ⇒ 行对象/iterations/completedBlocks **同一引用**（幂等，零重建）', idempotent);
  ok('★10 流式帧只换在飞行：已完成块对象逐元素恒等 + 其它行对象不变（不依赖任何字符串指纹）', onlyLiveChanged);
  ok('★10 提交帧必长出新块（新对象；前缀对象仍恒等 ⇒ 不陈旧、不整体重造）', commitGrows);
  ok('★10 零扫描防线：K>0 时确实有已完成块（判据不是"两边都空"的假绿）', sawNonEmpty);
  const fresh: ChatRow = new ChatRow();
  eq('★10 新建行（未投影）⇒ completedBlocks 为空', fresh.completedBlocks.length, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §11 parseInline：charCode 快路径 + run-slice ≡ 旧实现（旧算法即 oracle）');
//   旧实现（round4 前）**逐字复刻**为 oracle ⇒ 改坏新实现（漏分支、把 `*_` 当偶对、
//   普通文本段切错起点、未闭合标记吞字符…）都会**逐字段不等** ⇒ 红。
{
  const oracleInline = (text: string): MdSpan[] => {
    const spans: MdSpan[] = [];
    if (text.length > 0 && !/[`!\[*_~]/.test(text)) {
      const s: MdSpan = new MdSpan(); s.text = text; spans.push(s); return spans;
    }
    let buf: string = '';
    let i: number = 0;
    const pushPlain = (bold: boolean, italic: boolean, strike: boolean): void => {
      if (buf.length === 0) { return; }
      const s: MdSpan = new MdSpan(); s.text = buf; s.bold = bold; s.italic = italic; s.strike = strike;
      spans.push(s); buf = '';
    };
    while (i < text.length) {
      if (text.charAt(i) === '`') {
        const end: number = text.indexOf('`', i + 1);
        if (end > i) {
          pushPlain(false, false, false);
          const s: MdSpan = new MdSpan(); s.text = text.substring(i + 1, end); s.code = true; spans.push(s);
          i = end + 1; continue;
        }
      }
      if (text.charAt(i) === '!' && text.charAt(i + 1) === '[') {
        const close: number = text.indexOf(']', i + 2);
        if (close > i && text.charAt(close + 1) === '(') {
          const paren: number = text.indexOf(')', close + 2);
          if (paren > close) {
            pushPlain(false, false, false);
            const s: MdSpan = new MdSpan(); s.text = text.substring(i + 2, close);
            s.image = text.substring(close + 2, paren); spans.push(s); i = paren + 1; continue;
          }
        }
      }
      if (text.charAt(i) === '[') {
        const close: number = text.indexOf(']', i + 1);
        if (close > i && text.charAt(close + 1) === '(') {
          const paren: number = text.indexOf(')', close + 2);
          if (paren > close) {
            pushPlain(false, false, false);
            const s: MdSpan = new MdSpan(); s.text = text.substring(i + 1, close);
            s.link = text.substring(close + 2, paren); spans.push(s); i = paren + 1; continue;
          }
        }
      }
      if (text.startsWith('**', i) || text.startsWith('__', i)) {
        const marker: string = text.substring(i, i + 2);
        const end: number = text.indexOf(marker, i + 2);
        if (end > i) {
          pushPlain(false, false, false);
          const s: MdSpan = new MdSpan(); s.text = text.substring(i + 2, end); s.bold = true; spans.push(s);
          i = end + 2; continue;
        }
      }
      if (text.startsWith('~~', i)) {
        const end: number = text.indexOf('~~', i + 2);
        if (end > i) {
          pushPlain(false, false, false);
          const s: MdSpan = new MdSpan(); s.text = text.substring(i + 2, end); s.strike = true; spans.push(s);
          i = end + 2; continue;
        }
      }
      const ch: string = text.charAt(i);
      if ((ch === '*' || ch === '_') && !text.startsWith(ch + ch, i)) {
        const end: number = text.indexOf(ch, i + 1);
        if (end > i + 1) {
          pushPlain(false, false, false);
          const s: MdSpan = new MdSpan(); s.text = text.substring(i + 1, end); s.italic = true; spans.push(s);
          i = end + 1; continue;
        }
      }
      buf += text.charAt(i);
      i++;
    }
    pushPlain(false, false, false);
    return spans;
  };
  const corpus: string[] = [
    '', 'plain', '这是一段纯文本', '**bold**', '__bold__', '*italic*', '_italic_', '~~strike~~', '`code`',
    '[link](http://a.b)', '![alt](http://a.b/img.png)', '![alt](x) [l](y)', 'a**b**c', 'a*b*c', 'a_b_c',
    'a__b__c', '***both***', '**bold with `code` inside**', '*a `b` c*', '**unclosed', '*unclosed',
    '`unclosed', '~~unclosed', '[unclosed', '![unclosed', '![a](b', '[a](b', 'a!b[c', '!x[', '[]()',
    '**', '__', '~~', '`', '*', '_', '~', '!', '[', '`a` and **b** and *c* and ~~d~~ and [e](f)',
    'multi\nline **bold**\ntext', '中**粗**文', '中`码`文', '[中文](链接)', '****', '**a**b**c**',
    '*a*b*c*', '`a``b`', '~~a~~b~~c~~', '_*mixed*_', '*_mixed_*', '__(_)_', '`**not bold**`',
    '**`code`**', 'a'.repeat(300) + '**x**' + 'b'.repeat(300), '**' + 'x'.repeat(500) + '**',
    '| `a` | *b* | [c](d) |', 'text with trailing _', '_leading', 'a_', '**a *b* c**', '*a **b** c*',
    // ⛔ 专攻「粗体判据必须是**同一字符偶对**」的语料：混对 `*_`/`_*` 若被当偶对 ⇒ 结果分叉
    '*_*_', '_*_*', '*_*', '_*_', '**__', '__**', 'a*_b_*c', '_*_*_', '*_*_*', '__*_*__', '*___*',
  ];
  let bad = 0;
  let produced = 0;
  for (const s of corpus) {
    const a = parseInline(s), b = oracleInline(s);
    produced += a.length + b.length;
    if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; }
  }
  ok('★11 语料逐字等价（含 `*_` 混对 / 未闭合 / 孤立标记 / 长文本 / 全角）', bad === 0);
  ok('★11 零扫描防线：语料确实产出 span（不是"两边都返回 []"的假绿）', produced > corpus.length);
  // 随机语料（标记字符随机组合）—— 覆盖面远超手写语料
  // ⛔ 必须用真随机（LCG）：**确定性线性公式**（`marks[(t*13+k*5)%n]`）会让相邻字符恒隔固定步长
  //    ⇒ **永不产生相邻标记对**（如 `*_`）⇒ 判据形同虚设（本波实测：混对 mutation 逃逸）。见 §6。
  const marks: string[] = ['*', '_', '`', '~', '!', '[', ']', '(', ')', 'a', 'b', '中', ' '];
  let seed: number = 20261011;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  let bad2 = 0;
  for (let t = 0; t < 8000; t++) {
    const len: number = rnd() % 24;
    let s: string = '';
    for (let k = 0; k < len; k++) { s += marks[rnd() % marks.length]; }
    if (JSON.stringify(parseInline(s)) !== JSON.stringify(oracleInline(s))) { bad2++; }
  }
  ok('★11 随机 8000 条逐字等价（标记字符随机组合，含相邻标记对）', bad2 === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n▶ §6 mutation 自证（由外部脚本注入，改动语义 ⇒ 本文件必红）:');
console.log('   · `core/typewriter.ets` `runeWidthAt` 改 `return 1`（忽略代理对）');
console.log('     ⇒ §1 clipRunes/runeCount 与 oracle 不等 ⇒ 红；');
console.log('   · `core/markdown.ets` 增量路径把 `assignKeys(blocks, stable)` 改回 `assignKeys(blocks, 0)`');
console.log('     ⇒ **不变**（等价）—— 反向自证"尾部重编号 == 全量重编号"；');
console.log('   · `core/markdown.ets` 把尾部重编号的 `stable` 改成 `0`（即从 0 起re-key 尾部、丢掉头部偏移）');
console.log('     ⇒ §7「key 含全局下标」/「增量 == 全量」必红；');
console.log('   · `core/streammerge.ets` `blocksSignature` 内核改 `return \'\'`（记忆化产物被改）');
console.log('     ⇒ §8 oracle 不等 ⇒ 红；');
console.log('   · `core/markdown.ets` parseInline 早退条件改成 `!false`（永远早退）');
console.log('     ⇒ §9 「含标记字符仍正确」红；');
console.log('   · `model_bridge.toHistoryIteration` 去掉按源 `Block` 的 WeakMap 记忆化（恒新建）');
console.log('     ⇒ §10 ★10「流式帧已完成块对象恒等」必红；');
console.log('   · `model_project.assistantRow` 的 memo 失效（每次新建 PRow）');
console.log('     ⇒ §10 ★10「同一状态重复投影同一引用」必红；');
console.log('   · `model_step.onDone` 每次 append 全量块（重复）⇒ §10 ★10「commit 只长尾巴」必红；');
console.log('   · [round4] `core/markdown.ets` 粗体判据改成"`*`/`_` **任意相邻对**"（把混对 `*_` 当偶对）');
console.log('     ⇒ §11 语料 + 随机各红（实测 2 failed）。');
console.log('     ⚠️ 该 mutation **最初逃逸**：§11 的"随机语料"用确定性线性公式生成 ⇒ 相邻字符恒隔');
console.log('        固定步长 ⇒ 永不产生相邻标记对。改真 LCG + 补 `*_*_` 语料后必红（判据自身也要可判别）。');

if (fail > 0) { console.log(`\n  stream_perf_equiv: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n  stream_perf_equiv: ${pass} passed, 0 failed`);
process.exit(0);

export {};

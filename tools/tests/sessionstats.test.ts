/**
 * `core/sessionstats.ets`（内置插件 `xbot.session-stats` 的面板判据）的判别力测试。
 *
 * 为什么必须有：面板此前**原生不存在**（它不在服务端 `web_plugin_list` 里 ⇒ 无入口），
 * 用户的投诉是「统计插件的面板我们看不到」。本文件把"画什么 / 怎么格式化"逐条钉死
 * （判据住 `core/`，组件只画）。
 *
 * ⚠️ 判别力自证（见交付）：① `formatTokenCount` 的 1e3/1e6/1e9 三档删任一 ⇒ ★A/★B/★C 红；
 *    ② `formatCount` 的分组条件 `(len-i)%3===0` 写反 ⇒ ★D 红；
 *    ③ `fmtMs` 的 `v===0 ⇒ '—'` 去掉 ⇒ ★E 红；④ `fmtPct` 分母 0 的 `—` 删掉 ⇒ ★F 红；
 *    ⑤ `parseSessionUsage` 的 `by_model`/`recent_iterations` 解析删掉 ⇒ ★G 红；
 *    ⑥ `byModelRows` 的空模型过滤删掉 ⇒ ★H 红；⑦ `recentRows` 的尾部切片改头 ⇒ ★I 红。
 */
declare const process: { exit: (c: number) => void };

import {
  ByModelRow, RecentIterRow, SessionUsage, SessionUsageWire, StatCell,
  byModelRows, cacheRatio, contextCells, statMs, fmtPct, formatCount, formatRatio, formatTokenCount,
  overviewCells, parseSessionUsage, perfCells, recentRows, recentTableHeader, recentTableText, sinceText,
} from '../../entry/src/main/ets/core/sessionstats';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ★A/★B/★C formatTokenCount（web `format.ts:7-13` 逐字）──────────────────────
{
  eq('★A 0 ⇒ "0"', formatTokenCount(0), '0');
  // web `!n` 对负数为假 ⇒ 走整数分支原样返回（原生逐字同；统计面负数不会出现）
  eq('★A 负数 ⇒ 原值（同 web）', formatTokenCount(-5), '-5');
  eq('★A 999 ⇒ 原值', formatTokenCount(999), '999');
  eq('★B 1000 ⇒ "1.0k"', formatTokenCount(1000), '1.0k');
  eq('★B 12345 ⇒ "12.3k"', formatTokenCount(12345), '12.3k');
  eq('★C 1000000 ⇒ "1.00M"', formatTokenCount(1000000), '1.00M');
  eq('★C 1234567 ⇒ "1.23M"', formatTokenCount(1234567), '1.23M');
  eq('★C 1234567890 ⇒ "1.23B"', formatTokenCount(1234567890), '1.23B');
}

// ── ★D formatCount（千分位）──────────────────────────────────────────────────
{
  eq('★D 0 ⇒ "0"', formatCount(0), '0');
  eq('★D 999 ⇒ 无逗号', formatCount(999), '999');
  eq('★D 1000 ⇒ "1,000"', formatCount(1000), '1,000');
  eq('★D 1234567 ⇒ "1,234,567"', formatCount(1234567), '1,234,567');
  eq('★D 负数 ⇒ 负号在左', formatCount(-1234), '-1,234');
  eq('★D 小数四舍五入', formatCount(1234.6), '1,235');
}

// ── formatRatio（null/NaN ⇒ "—"，绝不 0%）─────────────────────────────────────
{
  eq('undefined ⇒ "—"', formatRatio(undefined, 1), '—');
  eq('NaN ⇒ "—"', formatRatio(NaN, 1), '—');
  eq('0.745 ⇒ "74.5%"', formatRatio(0.745, 1), '74.5%');
  eq('0 ⇒ "0.0%"', formatRatio(0, 1), '0.0%');
}

// ── ★E fmtMs（web 面板 `:49-58`）──────────────────────────────────────────────
{
  eq('★E 0 ⇒ "—"', statMs(0), '—');
  eq('★E 850 ⇒ "850ms"', statMs(850), '850ms');
  eq('★E 12300 ⇒ "12.3s"', statMs(12300), '12.3s');
  eq('★E 75000 ⇒ "1m15s"', statMs(75000), '1m15s');
  eq('★E 10320000 ⇒ "2h52m"', statMs(10320000), '2h52m');
  eq('★E 60000 ⇒ "1m00s"', statMs(60000), '1m00s');
}

// ── ★F fmtPct（分母 0 ⇒ "—"）──────────────────────────────────────────────────
{
  eq('★F 分母 0 ⇒ "—"', fmtPct(5, 0), '—');
  eq('★F 179456/204877 ⇒ 87.6%', fmtPct(179456, 204877), '87.6%');
}

// ── ★G parseSessionUsage（缺字段回落 0/''，绝不 NaN）──────────────────────────
{
  const empty: SessionUsage = parseSessionUsage(undefined);
  eq('★G undefined ⇒ 全零', [empty.inputTokens, empty.outputTokens, empty.iterationCount], [0, 0, 0]);
  eq('★G undefined ⇒ 空模型名', empty.currentModel, '');
  eq('★G undefined ⇒ 空数组', [empty.byModel.length, empty.recentIterations.length], [0, 0]);

  const raw: SessionUsageWire = {
    input_tokens: 204877,
    output_tokens: 925,
    cached_tokens: 179456,
    iteration_count: 11,
    turn_count: 6,
    llm_total_ms: 11776,
    avg_ttft_ms: 678.9,
    avg_tpot_ms: 4,
    avg_tokens_per_sec: 266.8,
    last_prompt_tokens: 19255,
    last_completion_tokens: 56,
    current_model: 'deepseek-flash',
    session_created_at: '2026-10-12 10:00:01.084329 +0800',
    by_model: [
      { model: 'deepseek-flash', input_tokens: 204877, output_tokens: 925, cached_tokens: 179456, iterations: 11 },
    ],
    recent_iterations: [
      { turn_id: 3, iteration: 1, input_tokens: 1000, output_tokens: 50, cached_tokens: 900, ttft_ms: 500, tpot_ms: 4, tokens_per_sec: 250 },
    ],
  };
  const u: SessionUsage = parseSessionUsage(raw);
  eq('★G 顶层数字', [u.inputTokens, u.outputTokens, u.cachedTokens, u.iterationCount], [204877, 925, 179456, 11]);
  eq('★G by_model 解析', u.byModel.length, 1);
  eq('★G by_model 字段', [u.byModel[0].model, u.byModel[0].iterations], ['deepseek-flash', 11]);
  eq('★G recent 解析', u.recentIterations.length, 1);
  eq('★G recent 字段', [u.recentIterations[0].turnId, u.recentIterations[0].iteration], [3, 1]);

  // NaN/Infinity 一律归零（不把坏数据透到 UI）
  const bad: SessionUsage = parseSessionUsage({ input_tokens: NaN, output_tokens: Infinity });
  ok('★G NaN/Infinity 归零', bad.inputTokens === 0 && bad.outputTokens === 0);
}

// ── cacheRatio ────────────────────────────────────────────────────────────────
{
  const u: SessionUsage = new SessionUsage();
  ok('分母 0 ⇒ undefined', cacheRatio(u) === undefined);
  u.inputTokens = 1000; u.cachedTokens = 250;
  eq('250/1000 ⇒ 0.25', cacheRatio(u), 0.25);
}

// ── sinceText（去掉年份，web slice(5,16)）──────────────────────────────────────
{
  eq('带 T 的 ISO 归一化', sinceText('2026-10-12T10:00:01.084329'), 'since 10-12 10:00');
  eq('空格分隔也归一化', sinceText('2026-10-12 10:00:01.084329 +0800'), 'since 10-12 10:00');
  eq('空 ⇒ 空串', sinceText(''), '');
}

// ── 窄形态单元（overview/perf/context）────────────────────────────────────────
{
  const u: SessionUsage = parseSessionUsage({
    input_tokens: 204877, output_tokens: 925, cached_tokens: 179456, llm_total_ms: 11776,
    iteration_count: 11, turn_count: 6, avg_ttft_ms: 678.9, avg_tpot_ms: 4, avg_tokens_per_sec: 266.8,
    last_prompt_tokens: 19255, last_completion_tokens: 56, current_model: 'deepseek-flash',
    session_created_at: '2026-10-12 10:00:01',
  });
  const ov: StatCell[] = overviewCells(u);
  eq('overview 4 张', ov.length, 4);
  eq('overview[0] = 输入', [ov[0].label, ov[0].value], ['输入', '204.9k']);
  eq('overview[1] = 输出', [ov[1].label, ov[1].value], ['输出', '925']);
  eq('overview[2] = 缓存命中 + 实际命中率', [ov[2].label, ov[2].value, ov[2].sub], ['缓存命中', '179.5k', '命中率 87.6%']);
  eq('overview[3] = LLM 时长 + 迭代/轮次', [ov[3].label, ov[3].value, ov[3].sub], ['LLM 时长', '11.8s', '11 迭代 · 6 轮次']);

  const pf: StatCell[] = perfCells(u);
  eq('perf 3 张', pf.length, 3);
  eq('perf TTFT/TPOT/tps', [pf[0].value, pf[1].value, pf[2].value], ['679ms', '4ms', '267']);

  const cx: StatCell[] = contextCells(u);
  eq('context 2 张', cx.length, 2);
  eq('上下文水位（语义正确，非 web 的「当前模型」误标）', [cx[0].label, cx[0].value, cx[0].sub],
    ['上下文水位', '19.3k', '生成 56']);
  eq('当前模型 + since', [cx[1].value, cx[1].sub], ['deepseek-flash', 'since 10-12 10:00']);

  // 空模型 ⇒ '—'；空数据 ⇒ TTFT 用 statMs(0)='—'
  const z: SessionUsage = new SessionUsage();
  eq('空模型 ⇒ "—"', contextCells(z)[1].value, '—');
  eq('无数据 TTFT ⇒ "—"', perfCells(z)[0].value, '—');
  eq('无数据 TPOT ⇒ "—"', perfCells(z)[1].value, '—');
}

// ── ★H byModelRows（空模型过滤；组件按 >1 决定是否展示）───────────────────────
{
  const u: SessionUsage = parseSessionUsage({
    by_model: [
      { model: 'deepseek-flash', input_tokens: 204877, output_tokens: 925, cached_tokens: 179456, iterations: 11 },
      { model: '', input_tokens: 5 },
    ],
  });
  const rows: ByModelRow[] = byModelRows(u);
  eq('★H 空模型被过滤', rows.length, 1);
  eq('★H 模型名', rows[0].model, 'deepseek-flash');
  eq('★H meta 含 in/out/cache/iters', rows[0].meta, 'in 204.9k · out 925 · cache 179.5k · 11 iters');
}

// ── ★I recentRows（取**尾部**最新；下标在尾部）────────────────────────────────
{
  const rawIters: object[] = [];
  for (let i = 0; i < 70; i++) {
    rawIters.push({ turn_id: i, iteration: 1, input_tokens: 100, output_tokens: 10, cached_tokens: 0 });
  }
  const u: SessionUsage = parseSessionUsage({ recent_iterations: rawIters as never });
  const rows: RecentIterRow[] = recentRows(u);
  eq('★I 只保留最近 60 行', rows.length, 60);
  eq('★I 尾部是最新（turn 69）', rows[rows.length - 1].turnIter, '69.1');
  eq('★I 头部是第 10 行（70-60）', rows[0].turnIter, '10.1');
  eq('★I cache=0 ⇒ "—"', rows[0].cache, '—');
}

// ── ★J 等宽表（**单 Text 承载** ⇒ 组件无 `ForEach`；性能预算 ⑦）──────────────
{
  const hdr: string = recentTableHeader();
  ok('★J 表头以 T.I 起、含 tok/s', hdr.indexOf('T.I') === 0 && hdr.indexOf('tok/s') > 0);
  const u: SessionUsage = parseSessionUsage({
    recent_iterations: [
      { turn_id: 1, iteration: 1, input_tokens: 12345, output_tokens: 678, cached_tokens: 0, ttft_ms: 500, tpot_ms: 4, tokens_per_sec: 250 },
    ],
  });
  const body: string = recentTableText(u);
  eq('★J 数据行数 = 1', body.split('\n').length, 1);
  // 每列固定 7 宽 ⇒ 表头与数据行**逐字符等宽**（列对齐的基础）
  eq('★J 行宽 == 表头宽（列对齐）', body.length, hdr.length);
  eq('★J 空样本 ⇒ 空串', recentTableText(new SessionUsage()), '');
  ok('★J 空表头仍非空', recentTableHeader().length > 0);
  // 多行（3 行样本）⇒ 3 行、每行等宽
  const u3: SessionUsage = parseSessionUsage({
    recent_iterations: [
      { turn_id: 1, iteration: 1, input_tokens: 1 },
      { turn_id: 1, iteration: 2, input_tokens: 2 },
      { turn_id: 2, iteration: 1, input_tokens: 3 },
    ],
  });
  const b3: string = recentTableText(u3);
  const l3: string[] = b3.split('\n');
  eq('★J 3 行', l3.length, 3);
  ok('★J 3 行逐行等宽', l3[0].length === hdr.length && l3[1].length === hdr.length && l3[2].length === hdr.length);
}

console.log(`sessionstats.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

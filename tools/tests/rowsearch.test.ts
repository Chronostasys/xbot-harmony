/**
 * rowsearch — 输出搜索纯函数的判别力测试。
 *
 * 运行：`bash tools/tests/run-one.sh rowsearch`（随 run.sh 全量跑）。
 * 判别力要求：每个断言在「实现写错」时必须红（mutation 自证过的心态）：
 *   · 空查询回落、大小写不敏感、行序、每行首命中、snippet 窗口与偏移同源。
 */
import { SearchHit, SearchRow } from '../../entry/src/main/ets/core/rowsearch';
import {
  isEmptyQuery, rowSearchHits, snippetAround, hitOffsetInSnippet, SNIPPET_PAD,
} from '../../entry/src/main/ets/core/rowsearch';

declare const process: { exit: (c: number) => void };

let fail: number = 0;

function expect(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    fail += 1;
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

function rowsOf(...pairs: [string, string][]): SearchRow[] {
  const out: SearchRow[] = [];
  for (const p of pairs) {
    out.push({ role: p[0], content: p[1] });
  }
  return out;
}

// ── isEmptyQuery ─────────────────────────────────────────────────────────────
console.log('isEmptyQuery（空/空白/非空）');
expect(isEmptyQuery('') === true, '空串 ⇒ true');
expect(isEmptyQuery('   ') === true, '全空白 ⇒ true');
expect(isEmptyQuery('  abc ') === false, '非空 ⇒ false');
expect(isEmptyQuery(undefined as unknown as string) === true, 'undefined ⇒ true（防炸）');

// ── rowSearchHits 基础 ───────────────────────────────────────────────────────
console.log('rowSearchHits（空查询/大小写/行序/首命中/无命中）');
const rows: SearchRow[] = rowsOf(
  ['user', '帮我查一下部署文档'],
  ['assistant', 'Deploy Guide is at /docs/deploy.md'],
  ['tool', 'cat deploy.md'],
  ['assistant', '部署完成 deploy done'],
);
expect(rowSearchHits(rows, '').length === 0, '空查询 ⇒ 0 命中');
expect(rowSearchHits(rows, '   ').length === 0, '全空白查询 ⇒ 0 命中');
expect(rowSearchHits(null, 'x').length === 0, 'null rows ⇒ 0 命中（防炸）');
expect(rowSearchHits(undefined, 'x').length === 0, 'undefined rows ⇒ 0 命中（防炸）');

const ci: SearchHit[] = rowSearchHits(rows, 'DEPLOY');
expect(ci.length === 3, '大小写不敏感：DEPLOY 命中 3 行（assistant/tool/assistant）');
expect(ci[0].index === 1 && ci[1].index === 2 && ci[2].index === 3, '行序保持原顺序（1→2→3）');
expect(ci[0].role === 'assistant' && ci[1].role === 'tool', '角色随行带出');

const multi: SearchHit[] = rowSearchHits(
  rowsOf(['assistant', 'deploy deploy deploy']),
  'deploy',
);
expect(multi.length === 1, '同一行多次出现 ⇒ 只出 1 条（首个命中，导航语义）');

expect(rowSearchHits(rows, '不存在词').length === 0, '无命中 ⇒ 0');

const zh: SearchHit[] = rowSearchHits(rows, '部署');
expect(zh.length === 2, '中文命中 2 行（user 行与最后 assistant 行）');
expect(zh[0].index === 0, '中文首命中在行 0');

// ── snippet 窗口与偏移同源 ────────────────────────────────────────────────────
console.log('snippetAround / hitOffsetInSnippet（窗口+省略号+同源偏移）');
const long: string =
  '0123456789'.repeat(10); // 100 字符
const hitAt: number = 50;
const snip: string = snippetAround(long, hitAt, 1);
expect(snip.length === SNIPPET_PAD * 2 + 1 + 2, `窗口长 = 2*PAD+命中1+省略号2（实际 ${snip.length}）`);
expect(snip.startsWith('…'), '开头越界 ⇒ 头省略号');
expect(snip.endsWith('…'), '结尾越界 ⇒ 尾省略号');
const off: number = hitOffsetInSnippet(hitAt);
expect(snip.slice(off, off + 1) === '0', '片段内偏移指向命中字符（同源判定；long[50]="0"）');

const edgeStart: string = snippetAround('abcXdef', 0, 1);
expect(!edgeStart.startsWith('…') && edgeStart.startsWith('a'), '命中在原文头 ⇒ 无头省略号');
const edgeEnd: string = snippetAround('abcdefX', 6, 1);
expect(!edgeEnd.endsWith('…') && edgeEnd.endsWith('X'), '命中在原文尾 ⇒ 无尾省略号');

// ── 命中段偏移与真实查询组合（端到端同源） ────────────────────────────────────
console.log('端到端：rowSearchHits 的 snippet/at 与 hitOffsetInSnippet 一致');
const e2e: SearchRow[] = rowsOf(['assistant', long]);
const hits: SearchHit[] = rowSearchHits(e2e, '5');
expect(hits.length === 1 && hits[0].index === 0, '长文查 "5" 命中行 0');
const e2eOff: number = hitOffsetInSnippet(hits[0].at);
expect(hits[0].snippet.slice(e2eOff, e2eOff + 1) === '5', '端到端偏移指向命中段');

process.exit(fail === 0 ? 0 : 1);

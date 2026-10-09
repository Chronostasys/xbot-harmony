/**
 * Markdown 解析缓存的行为测试（"长会话卡到没法用"的直接根因，必须有守护）。
 *
 * 背景：`MarkdownView.build()` 在渲染路径里解析 Markdown，而行级 ForEach 的 key 含 `row.rev`
 * ⇒ 数据一变整行重建 ⇒ 流式期间每来一个 SSE 事件就要把该 turn 全部迭代块的几百 KB 重新解析。
 * 缓存按**原文本身**做键 ⇒ 语义必须与不缓存**逐字节一致**，且内容变了必须立刻反映（不能有陈旧结果）。
 */
declare const process: { exit: (c: number) => void };

import {
  parseMarkdown, parseInline, parseMarkdownCached, parseInlineCached, mdCacheStats,
} from '../../entry/src/main/ets/core/markdown';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

function eqJson(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

const doc = ['# 标题一', '正文 **粗** 与 *斜* 与 `code`。', '', '- A', '- B', '', '```ts', 'const a = 1', '```', '', '末段'].join('\n');

// ① 首次调用结果必须与不缓存的解析**完全一致**
eqJson('首调用 == parseMarkdown', parseMarkdownCached(doc), parseMarkdown(doc));

// ② 再次调用必须命中缓存（同一实例 ⇒ 证明没有重复解析）
const first = parseMarkdownCached(doc);
const second = parseMarkdownCached(doc);
ok('重复调用命中缓存（同实例）', first === second);

// ③ 内容变了必须立刻反映（键=原文 ⇒ 不可能陈旧）
const doc2 = doc + '\n新增一行';
eqJson('内容变化后结果同步变化', parseMarkdownCached(doc2), parseMarkdown(doc2));
ok('不同内容不共享条目', parseMarkdownCached(doc) !== parseMarkdownCached(doc2));

// ④ 交替调用不串味
const docs = ['甲 **甲**', '乙 *乙*', '# 丙'];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < docs.length; i++) {
    eqJson(`交替第${round}轮 doc${i}`, parseMarkdownCached(docs[i]), parseMarkdown(docs[i]));
  }
}

// ⑤ 行内解析同样：一致 + 命中
eqJson('行内首调用 == parseInline', parseInlineCached('a **b** c'), parseInline('a **b** c'));
ok('行内重复调用命中缓存', parseInlineCached('a **b** c') === parseInlineCached('a **b** c'));

// ⑥ 超出预算后淘汰最早的，但**结果必须仍然正确**（淘汰只是丢缓存，不影响语义）
//    用多份小文本凑够 2MB 预算（不要用超大单段落：解析器对超大单段落是慢路径，会把测试拖住）
const unit = '段落 **粗体** 与 `code` 与 [链接](https://x)。\n- 项一\n- 项二\n';
const chunk = unit.repeat(16);
const need = 2 * 1024 * 1024;
const iters = Math.ceil(need / chunk.length) + 50;
ok('凑够缓存预算（>2MB 字符）', chunk.length * iters > need);
for (let i = 0; i < iters; i++) {
  parseMarkdownCached(`${chunk}#${i}`);
}
eqJson('被淘汰后重新解析仍正确', parseMarkdownCached(`${chunk}#0`), parseMarkdown(`${chunk}#0`));

// ⑦ 统计口径自洽
const st = mdCacheStats();
ok('有命中', st.hits > 0);
ok('有未命中', st.misses > 0);
ok('占用受预算约束', st.chars <= 4 * 1024 * 1024);
eqJson('统计含条目数', typeof st.entries === 'number', true);

if (fail > 0) {
  console.log(`  md_cache: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  md_cache: ${pass} passed, 0 failed`);

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const markdown_1 = require("./markdown");
let pass = 0;
let fail = 0;
function ok(name, cond) {
    if (cond) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}`);
    }
}
function eqJson(name, got, want) {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g === w) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
    }
}
const doc = ['# 标题一', '正文 **粗** 与 *斜* 与 `code`。', '', '- A', '- B', '', '```ts', 'const a = 1', '```', '', '末段'].join('\n');
// ① 首次调用结果必须与不缓存的解析**完全一致**
eqJson('首调用 == parseMarkdown', (0, markdown_1.parseMarkdownCached)(doc), (0, markdown_1.parseMarkdown)(doc));
// ② 再次调用必须命中缓存（同一实例 ⇒ 证明没有重复解析）
const first = (0, markdown_1.parseMarkdownCached)(doc);
const second = (0, markdown_1.parseMarkdownCached)(doc);
ok('重复调用命中缓存（同实例）', first === second);
// ③ 内容变了必须立刻反映（键=原文 ⇒ 不可能陈旧）
const doc2 = doc + '\n新增一行';
eqJson('内容变化后结果同步变化', (0, markdown_1.parseMarkdownCached)(doc2), (0, markdown_1.parseMarkdown)(doc2));
ok('不同内容不共享条目', (0, markdown_1.parseMarkdownCached)(doc) !== (0, markdown_1.parseMarkdownCached)(doc2));
// ④ 交替调用不串味
const docs = ['甲 **甲**', '乙 *乙*', '# 丙'];
for (let round = 0; round < 3; round++) {
    for (let i = 0; i < docs.length; i++) {
        eqJson(`交替第${round}轮 doc${i}`, (0, markdown_1.parseMarkdownCached)(docs[i]), (0, markdown_1.parseMarkdown)(docs[i]));
    }
}
// ⑤ 行内解析同样：一致 + 命中
eqJson('行内首调用 == parseInline', (0, markdown_1.parseInlineCached)('a **b** c'), (0, markdown_1.parseInline)('a **b** c'));
ok('行内重复调用命中缓存', (0, markdown_1.parseInlineCached)('a **b** c') === (0, markdown_1.parseInlineCached)('a **b** c'));
// ⑥ 超出预算后淘汰最早的，但**结果必须仍然正确**（淘汰只是丢缓存，不影响语义）
//    用多份小文本凑够 2MB 预算（不要用超大单段落：解析器对超大单段落是慢路径，会把测试拖住）
const unit = '段落 **粗体** 与 `code` 与 [链接](https://x)。\n- 项一\n- 项二\n';
const chunk = unit.repeat(16);
const need = 2 * 1024 * 1024;
const iters = Math.ceil(need / chunk.length) + 50;
ok('凑够缓存预算（>2MB 字符）', chunk.length * iters > need);
for (let i = 0; i < iters; i++) {
    (0, markdown_1.parseMarkdownCached)(`${chunk}#${i}`);
}
eqJson('被淘汰后重新解析仍正确', (0, markdown_1.parseMarkdownCached)(`${chunk}#0`), (0, markdown_1.parseMarkdown)(`${chunk}#0`));
// ⑦ 统计口径自洽
const st = (0, markdown_1.mdCacheStats)();
ok('有命中', st.hits > 0);
ok('有未命中', st.misses > 0);
ok('占用受预算约束', st.chars <= 4 * 1024 * 1024);
eqJson('统计含条目数', typeof st.entries === 'number', true);
if (fail > 0) {
    console.log(`  md_cache: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  md_cache: ${pass} passed, 0 failed`);

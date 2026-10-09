/**
 * Markdown 解析器行为测试（原生渲染的地基，必须有守护）。
 *
 * 运行：tools/tests/run.sh
 * 为什么放在仓库里：`core/markdown.ets` 是纯 TS，可脱离 SDK 直接跑；
 * 渲染层（ArkUI）只能在真机/构建里验，但**解析语义**必须在这里锁死。
 */
declare const process: { exit: (c: number) => void };
import { parseMarkdown, parseInline, MdBlockKind } from '../../entry/src/main/ets/core/markdown';

let pass = 0;
let fail = 0;

function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

const md = [
  '# 标题一', '正文 **粗** 与 *斜*。', '', '## 二级', '',
  '- A', '- B', '', '1. 一', '2. 二', '',
  '> 引用', '', '```ts', 'const a = 1', '```', '',
  '| c1 | c2 |', '| --- | --- |', '| a | b |', '', '---', '末段',
].join('\n');

const b = parseMarkdown(md);
eq('块数', b.length, 10);
eq('h1', [b[0].kind, b[0].level, b[0].text], [MdBlockKind.Heading, 1, '标题一']);
eq('段落', b[1].kind, MdBlockKind.Paragraph);
eq('h2', b[2].level, 2);
eq('无序列表', [b[3].kind, b[3].ordered, b[3].items], [MdBlockKind.List, false, ['A', 'B']]);
eq('有序列表', [b[4].ordered, b[4].items], [true, ['一', '二']]);
eq('引用', b[5].kind, MdBlockKind.Quote);
eq('代码块', [b[6].kind, b[6].lang, b[6].code], [MdBlockKind.Code, 'ts', 'const a = 1']);
eq('表格', [b[7].header, b[7].rows], [['c1', 'c2'], [['a', 'b']]]);
eq('分隔线', b[8].kind, MdBlockKind.Divider);
eq('末段', b[9].text, '末段');

const s = parseInline('**粗** *斜* `码` ~~删~~ [链](http://a) ![图](http://b/c.png) 尾');
eq('行内 span 数（标记之间的空格各自成 span）', s.length, 12);
eq('粗体', [s[0].text, s[0].bold], ['粗', true]);
eq('斜体', [s[2].text, s[2].italic], ['斜', true]);
eq('行内码', [s[4].text, s[4].code], ['码', true]);
eq('删除线', [s[6].text, s[6].strike], ['删', true]);
eq('链接', [s[8].text, s[8].link], ['链', 'http://a']);
eq('图片', [s[10].text, s[10].image], ['图', 'http://b/c.png']);
eq('尾随文本', s[11].text, ' 尾');

eq('未闭合 ** 不吞文本', parseInline('a ** b').map((x) => x.text).join(''), 'a ** b');
eq('围栏内不解析 markdown', parseMarkdown('```\n# t\n**b**\n```')[0].code, '# t\n**b**');
eq('空输入', parseMarkdown('').length, 0);

console.log(`markdown.test: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  throw new Error('markdown 解析器测试失败');
}

// 显式退出：node 的事件循环可能被 mock 网络句柄/定时器拉住，不退出会让
// run.sh（set -e 顺序执行）永远卡在本文件，后续测试根本不跑。
process.exit(0);

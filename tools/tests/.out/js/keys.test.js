"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const markdown_1 = require("./markdown");
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
    if (cond) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`);
    }
}
const A = '# 标题\n\n段落一。\n\n- 项 1\n- 项 2';
const B = '# 标题\n\n段落一。\n\n- 项 1\n- 项 2\n\n```ts\nconst a = 1\n```\n\n追加的新段落。';
const ka1 = (0, markdown_1.parseMarkdown)(A).map((b) => b.key);
const ka2 = (0, markdown_1.parseMarkdown)(A).map((b) => b.key);
const kb = (0, markdown_1.parseMarkdown)(B).map((b) => b.key);
ok('同一内容两次解析，key 完全一致', JSON.stringify(ka1) === JSON.stringify(ka2), `${JSON.stringify(ka1)} vs ${JSON.stringify(ka2)}`);
ok('单次解析内 key 唯一', new Set(ka1).size === ka1.length, JSON.stringify(ka1));
ok('追加内容后，前序块的 key 不变（流式增长不漂移）', ka1.every((k, i) => kb[i] === k), `A=${JSON.stringify(ka1)} B=${JSON.stringify(kb)}`);
ok('新增块确实产生了新 key', kb.length > ka1.length && !ka1.includes(kb[kb.length - 1]));
// 相同内容重复出现时 key 仍唯一（靠出现序号区分）
const DUP = '重复段落\n\n重复段落\n\n重复段落';
const kd = (0, markdown_1.parseMarkdown)(DUP).map((b) => b.key);
ok('内容相同的多个块 key 仍唯一', new Set(kd).size === kd.length, JSON.stringify(kd));
// 代码块内容变化 ⇒ key 变化（该块会被重建）
const C1 = (0, markdown_1.parseMarkdown)('```\na\n```').map((b) => b.key);
const C2 = (0, markdown_1.parseMarkdown)('```\na\nb\n```').map((b) => b.key);
ok('代码块内容变化 ⇒ key 变化', C1[0] !== C2[0], `${C1[0]} vs ${C2[0]}`);
console.log(`keys.test: ${pass} passed, ${fail} failed`);
if (fail > 0) {
    throw new Error('渲染 key 稳定性测试失败');
}
// 显式退出：node 的事件循环可能被 mock 网络句柄/定时器拉住，不退出会让
// run.sh（set -e 顺序执行）永远卡在本文件，后续测试根本不跑。
process.exit(0);

/**
 * 文件路径 ⇒ 语言 门禁 —— `core/toolargs.ets`（移植 web `ToolRender.langFromPath`）。
 *
 * 守护：FileCreate/FileReplace 的浮层要按**文件语言**给内容着色（用户 2026-10-10：
 * 「filecreate 也要高亮」），语言推断错了就会着错色 / 不着色。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  fileArgFields, FileArgFields, isFileTool, langFromPath, pathFromLabel,
} from '../../entry/src/main/ets/core/toolargs';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── langFromPath：扩展名 ⇒ 语言 ─────────────────────────────────────────────
eq('.ts ⇒ typescript', langFromPath('/a/b/x.ts'), 'typescript');
eq('.tsx ⇒ typescript', langFromPath('x.tsx'), 'typescript');
eq('.ets ⇒ typescript', langFromPath('/u/entry/src/main/ets/core/render.ets'), 'typescript');
eq('.js ⇒ javascript', langFromPath('a/b.js'), 'javascript');
eq('.go ⇒ go', langFromPath('main.go'), 'go');
eq('.py ⇒ python', langFromPath('/x/y/z.py'), 'python');
eq('.json ⇒ json', langFromPath('package.json'), 'json');
eq('.yml ⇒ yaml', langFromPath('a.yml'), 'yaml');
eq('.md ⇒ markdown', langFromPath('README.md'), 'markdown');
eq('.html ⇒ markup', langFromPath('i.html'), 'markup');
eq('.sh ⇒ bash', langFromPath('run.sh'), 'bash');
eq('大写扩展名归一', langFromPath('X.TS'), 'typescript');
eq('MakefileX 也按 makefile 特判（web 同款前缀匹配）', langFromPath('/a/b/MakefileX'), 'makefile');
eq('dockerfile 特判', langFromPath('Dockerfile'), 'dockerfile');
eq('dockerfile 带后缀', langFromPath('/x/Dockerfile.prod'), 'dockerfile');
eq('makefile 特判', langFromPath('Makefile'), 'makefile');
eq('未知扩展名 ⇒ 空', langFromPath('x.weird'), '');
eq('无扩展名文件 ⇒ 空', langFromPath('LICENSE'), '');
eq('空串 ⇒ 空', langFromPath(''), '');
eq('只有目录名不误判', langFromPath('/a.b/c'), '');
eq('点开头（.gitignore）⇒ 空', langFromPath('.gitignore'), '');

// ── pathFromLabel ───────────────────────────────────────────────────────────
eq('去前缀', pathFromLabel('FileCreate: /a/b.ts'), '/a/b.ts');
eq('Read 前缀', pathFromLabel('Read: /x/y'), '/x/y');
eq('无前缀原样', pathFromLabel('/a/b.ts'), '/a/b.ts');
eq('空串', pathFromLabel(''), '');
eq('前后空白被裁', pathFromLabel('  FileCreate:   /a.ts  '), '/a.ts');

// ── fileArgFields：从 args JSON 抽 path/content ─────────────────────────────
const a1: FileArgFields = fileArgFields('{"path":"/a/b.ts","content":"line1\\nline2"}');
eq('抽 path', a1.path, '/a/b.ts');
eq('抽 content（含真实换行）', a1.content, 'line1\nline2');
const a2: FileArgFields = fileArgFields('{"path":"/x"}');
eq('缺 content ⇒ 空', a2.content, '');
eq('有 path', a2.path, '/x');
// ⛔ 流式截断（非法 JSON）不得抛异常、不得吞掉调用方要用的原始 args
const a3: FileArgFields = fileArgFields('{"path":"/a","content":"unterminated');
eq('截断 JSON 安全回落 path 空', a3.path, '');
eq('截断 JSON 安全回落 content 空', a3.content, '');
eq('空串安全', fileArgFields('').path, '');
eq('非对象安全', fileArgFields('42').path, '');
eq('数组不误当文件参数', fileArgFields('["a"]').content, '');

// ── isFileTool ──────────────────────────────────────────────────────────────
eq('FileCreate 是文件工具', isFileTool('FileCreate'), true);
eq('FileReplace 是文件工具', isFileTool('FileReplace'), true);
eq('Read 是文件工具', isFileTool('Read'), true);
eq('Shell 不是', isFileTool('Shell'), false);
eq('空名不是', isFileTool(''), false);

console.log(`  toolargs: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

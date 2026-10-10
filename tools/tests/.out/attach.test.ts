/**
 * 附件纯逻辑测试（发文件/图片的地基；名字或 MIME 错了 = 上传成功但对方收到错东西）。
 */
declare const process: { exit: (c: number) => void };

import { baseName, extensionOf, mimeOf, humanSize } from './attach';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

eq('取文件名', baseName('file://docs/1/报告.pdf'), '报告.pdf');
eq('带 query 的 URI', baseName('file://media/1/a.png?x=1'), 'a.png');
eq('无斜杠', baseName('a.zip'), 'a.zip');
eq('空串回落 file', baseName(''), 'file');
eq('尾斜杠', baseName('file://docs/'), 'file');

eq('扩展名小写', extensionOf('A.PNG'), 'png');
eq('无扩展名', extensionOf('Makefile'), '');
eq('点在末尾', extensionOf('name.'), '');

eq('png', mimeOf('a.png'), 'image/png');
eq('jpeg', mimeOf('a.JPEG'), 'image/jpeg');
eq('pdf', mimeOf('r.pdf'), 'application/pdf');
eq('md 文本', mimeOf('README.md'), 'text/plain');
eq('zip', mimeOf('x.zip'), 'application/zip');
eq('未知回落 octet-stream', mimeOf('weird.xyz'), 'application/octet-stream');
eq('无扩展名回落 octet-stream', mimeOf('Makefile'), 'application/octet-stream');

eq('B 级', humanSize(512), '512 B');
eq('KB 级', humanSize(262462), '256 KB');
eq('MB 级', humanSize(3 * 1024 * 1024), '3.0 MB');

if (fail > 0) { console.log(`  attach: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  attach: ${pass} passed, 0 failed`);
process.exit(0);

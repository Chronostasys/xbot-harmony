/**
 * 附件纯逻辑测试（发文件/图片的地基；名字或 MIME 错了 = 上传成功但对方收到错东西）。
 */
declare const process: { exit: (c: number) => void };

import {
  ATTACH_DONE, ATTACH_FAILED, ATTACH_UPLOADING, AttachItem, appendRef, attachChipText,
  attachmentRef, baseName, doneKeys, doneNames, doneRefs, doneSizes, downloadRef, extensionOf,
  hasRef, humanSize, isImageMime, isImageName, mimeOf, patchByUid, pendingCount, removeByUid,
} from '../../entry/src/main/ets/core/attach';

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


// ── P3：多选 / 图片判定 / 引用生成 / 并发回填 ──────────────────────────────
eq('图片 MIME', isImageMime('image/png'), true);
eq('非图片 MIME', isImageMime('application/pdf'), false);
eq('图片名', isImageName('photo.PNG'), true);
eq('非图片名', isImageName('a.pdf'), false);
eq('未知后缀不算图片', isImageName('a.bin'), false);

eq('下载引用（编码 key、非内联）',
  downloadRef('uploads/3/a b.pdf', false), '/api/files/download?key=uploads%2F3%2Fa%20b.pdf');
eq('下载引用（内联）',
  downloadRef('uploads/3/z.png', true), '/api/files/download?key=uploads%2F3%2Fz.png&inline=1');
eq('图片引用 = Markdown 图片',
  attachmentRef('uploads/3/z.png', 'z.png', 'image/png'),
  '![z.png](/api/files/download?key=uploads%2F3%2Fz.png&inline=1)');
eq('非图片引用 = 普通链接',
  attachmentRef('uploads/3/a.pdf', 'a.pdf', 'application/pdf'),
  '[a.pdf](/api/files/download?key=uploads%2F3%2Fa.pdf)');

eq('正文已含引用（防重复追加）',
  hasRef('hi ![z](/api/files/download?key=uploads%2F3%2Fz.png&inline=1)', 'uploads/3/z.png'), true);
eq('正文不含引用', hasRef('hi', 'uploads/3/z.png'), false);
eq('追加到空正文', appendRef('', 'ref'), 'ref');
eq('追加换行', appendRef('hi', 'ref'), 'hi\nref');
eq('末尾已有换行不重复', appendRef('hi\n', 'ref'), 'hi\nref');
eq('空引用不改正文', appendRef('hi', ''), 'hi');

function item(uid: string, status: string, name: string, mime: string, key: string, size: number) {
  const it = new AttachItem();
  it.uid = uid; it.status = status; it.name = name; it.mime = mime; it.key = key; it.size = size;
  return it;
}
eq('上传中 chip', attachChipText(item('1', ATTACH_UPLOADING, 'a.png', 'image/png', '', 0)), '上传中… a.png');
eq('图片就绪 chip', attachChipText(item('1', ATTACH_DONE, 'a.png', 'image/png', 'k', 2048)), 'a.png（2 KB）');
eq('文件就绪 chip', attachChipText(item('1', ATTACH_DONE, 'a.pdf', 'application/pdf', 'k', 1024)), 'a.pdf（1 KB）');
eq('失败 chip', attachChipText(item('1', ATTACH_FAILED, 'a.pdf', 'application/pdf', '', 0)), 'a.pdf 上传失败');

const list = [
  item('1', ATTACH_DONE, 'a.png', 'image/png', 'uploads/3/a.png', 10),
  item('2', ATTACH_UPLOADING, 'b.png', 'image/png', '', 0),
  item('3', ATTACH_FAILED, 'c.png', 'image/png', '', 0),
];
eq('上传中条数', pendingCount(list), 1);
eq('发送载荷只取就绪', doneKeys(list), ['uploads/3/a.png']);
eq('载荷名字', doneNames(list), ['a.png']);
eq('载荷体积', doneSizes(list), [10]);
eq('正文引用只取就绪', doneRefs(list),
  ['![a.png](/api/files/download?key=uploads%2F3%2Fa.png&inline=1)']);

const patched = patchByUid(list, '2', 'uploads/3/b.png', 22, ATTACH_DONE, '');
eq('并发回填按 uid（不是下标）', patched[1].key, 'uploads/3/b.png');
eq('回填后上传中归零', pendingCount(patched), 0);
eq('回填保留原名', patched[1].name, 'b.png');
eq('回填不存在的 uid = 原样', patchByUid(list, 'nope', 'x', 1, ATTACH_DONE, '').length, 3);
eq('删除按 uid', removeByUid(list, '2').map((x) => x.uid), ['1', '3']);
eq('删除不存在的 uid', removeByUid(list, 'nope').length, 3);

if (fail > 0) { console.log(`  attach: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  attach: ${pass} passed, 0 failed`);
process.exit(0);

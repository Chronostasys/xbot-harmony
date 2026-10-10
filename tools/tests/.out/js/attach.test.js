"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const attach_1 = require("./attach");
let pass = 0, fail = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
    }
}
eq('取文件名', (0, attach_1.baseName)('file://docs/1/报告.pdf'), '报告.pdf');
eq('带 query 的 URI', (0, attach_1.baseName)('file://media/1/a.png?x=1'), 'a.png');
eq('无斜杠', (0, attach_1.baseName)('a.zip'), 'a.zip');
eq('空串回落 file', (0, attach_1.baseName)(''), 'file');
eq('尾斜杠', (0, attach_1.baseName)('file://docs/'), 'file');
eq('扩展名小写', (0, attach_1.extensionOf)('A.PNG'), 'png');
eq('无扩展名', (0, attach_1.extensionOf)('Makefile'), '');
eq('点在末尾', (0, attach_1.extensionOf)('name.'), '');
eq('png', (0, attach_1.mimeOf)('a.png'), 'image/png');
eq('jpeg', (0, attach_1.mimeOf)('a.JPEG'), 'image/jpeg');
eq('pdf', (0, attach_1.mimeOf)('r.pdf'), 'application/pdf');
eq('md 文本', (0, attach_1.mimeOf)('README.md'), 'text/plain');
eq('zip', (0, attach_1.mimeOf)('x.zip'), 'application/zip');
eq('未知回落 octet-stream', (0, attach_1.mimeOf)('weird.xyz'), 'application/octet-stream');
eq('无扩展名回落 octet-stream', (0, attach_1.mimeOf)('Makefile'), 'application/octet-stream');
eq('B 级', (0, attach_1.humanSize)(512), '512 B');
eq('KB 级', (0, attach_1.humanSize)(262462), '256 KB');
eq('MB 级', (0, attach_1.humanSize)(3 * 1024 * 1024), '3.0 MB');
if (fail > 0) {
    console.log(`  attach: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  attach: ${pass} passed, 0 failed`);
process.exit(0);

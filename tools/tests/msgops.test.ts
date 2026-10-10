/** 消息操作纯逻辑测试（复制变体语义与链接白名单 —— 都只能靠单测钉死）。 */
declare const process: { exit: (c: number) => void };

import {
  COPY_RAW, COPY_REPLY, COPY_THINKING, COPY_TOOLS, CopyParts, composeCopy, isOpenableScheme, linkLabel,
  linksIn, resolveOpenable, toolArgsOnly, toolCopyText, toolResultOnly,
} from '../../entry/src/main/ets/core/msgops';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function parts(): CopyParts {
  const p = new CopyParts();
  p.reply = '正文'; p.thinking = '思考内容'; p.tools = 'Shell: ls'; p.raw = '# 原始';
  return p;
}

eq('reply 只有正文', composeCopy(parts(), COPY_REPLY), '正文');
eq('thinking 追加思考', composeCopy(parts(), COPY_THINKING), '正文\n\n【思考】\n思考内容');
eq('tools 再追加工具', composeCopy(parts(), COPY_TOOLS), '正文\n\n【思考】\n思考内容\n\n【工具】\nShell: ls');
eq('raw 用原文', composeCopy(parts(), COPY_RAW), '# 原始');

const onlyThinking = new CopyParts();
onlyThinking.thinking = 'x';
eq('无正文时 thinking 只给思考', composeCopy(onlyThinking, COPY_THINKING), '【思考】\nx');
const rawEmpty = new CopyParts();
rawEmpty.reply = '正文';
eq('raw 缺失时回落正文', composeCopy(rawEmpty, COPY_RAW), '正文');
eq('全空 = 空串', composeCopy(new CopyParts(), COPY_TOOLS), '');

eq('工具文本全字段', toolCopyText('Shell', '{"cmd":"ls"}', 'ok'), 'Shell\n参数：{"cmd":"ls"}\n输出：ok');
eq('工具文本空输出', toolCopyText('Shell', 'ls', ''), 'Shell\n参数：ls');
eq('参数单取', toolArgsOnly('  '), '');
eq('输出单取', toolResultOnly('ok'), 'ok');

eq('白名单 http', isOpenableScheme('http://a.com'), true);
eq('白名单 https 大写', isOpenableScheme('HTTPS://a.com'), true);
eq('白名单 mailto', isOpenableScheme('mailto:a@b.c'), true);
eq('拒绝 javascript', isOpenableScheme('javascript:alert(1)'), false);
eq('拒绝 data', isOpenableScheme('data:text/html,x'), false);
eq('拒绝 file', isOpenableScheme('file:///etc/passwd'), false);

eq('绝对 http 原样', resolveOpenable('https://a.com/x', 'https://base.com'), 'https://a.com/x');
eq('同源相对按 base 拼', resolveOpenable('/api/files/download?key=a', 'https://x.com'), 'https://x.com/api/files/download?key=a');
eq('base 末尾斜杠不重复', resolveOpenable('/a', 'https://x.com/'), 'https://x.com/a');
eq('协议相对补 https', resolveOpenable('//cdn.com/a.png', 'https://x.com'), 'https://cdn.com/a.png');
eq('协议相对补 http', resolveOpenable('//cdn.com/a.png', 'http://x.com'), 'http://cdn.com/a.png');
eq('裸相对地址拒绝（不猜）', resolveOpenable('foo/bar', 'https://x.com'), '');
eq('javascript 拒绝', resolveOpenable('javascript:1', 'https://x.com'), '');
eq('空地址拒绝', resolveOpenable('', 'https://x.com'), '');

eq('抽链接', linksIn('见 [A](https://a.com) 与 [B](https://b.com)'), ['https://a.com', 'https://b.com']);
eq('图片不算链接', linksIn('![图](/api/files/download?key=k)'), []);
eq('链接去重', linksIn('[A](https://a.com) [A2](https://a.com)'), ['https://a.com']);
eq('图文混合只取链接', linksIn('![i](https://i.png) [A](https://a.com)'), ['https://a.com']);
eq('无链接', linksIn('普通文本'), []);

eq('链接显示名', linkLabel('https://a.com/p?x=1'), 'a.com/p');
eq('长链接截断', linkLabel(`https://a.com/${'x'.repeat(60)}`).length <= 46, true);

if (fail > 0) { console.log(`  msgops: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  msgops: ${pass} passed, 0 failed`);
process.exit(0);

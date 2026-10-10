/** 输入框补全纯逻辑测试（触发条件写错会把邮箱/路径误当补全，或补全插错位置）。 */
declare const process: { exit: (c: number) => void };

import {
  activeToken, applyCommand, applyMention, CommandItem, enterSends, FsEntry, joinPath, matchCommands,
  matchFiles, maxComposerLines, parentDir,
} from './composer';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function cmd(n: string, d: string): CommandItem { const c = new CommandItem(); c.name = n; c.desc = d; return c; }
function fs(n: string, isDir: boolean): FsEntry { const e = new FsEntry(); e.name = n; e.isDir = isDir; return e; }

eq('行首 /compress', activeToken('/compress', '/'), '/compress');
eq('空白后 /co', activeToken('你好 /co', '/'), '/co');
eq('非行首非空白 = 不是命令', activeToken('abc/co', '/'), '');
eq('邮箱不算提及', activeToken('a@b.com', '@'), '');
eq('空白后 @src', activeToken('看 @src', '@'), '@src');
eq('结尾空白 = 无 token', activeToken('/compress ', '/'), '');
eq('空文本', activeToken('', '/'), '');
eq('换行后也算新 token', activeToken('第一行\n@a', '@'), '@a');

const all = [cmd('/new', '新会话'), cmd('/compress', '压缩'), cmd('/context', '上下文'), cmd('/help', '帮助')];
eq('空查询给全部', matchCommands(all, '/').length, 4);
eq('前缀匹配', matchCommands(all, '/co').map((c) => c.name), ['/compress', '/context']);
eq('无匹配', matchCommands(all, '/zzz').length, 0);
eq('替换命令 token', applyCommand('请 /comp', '/comp', '/compress'), '请 /compress ');
eq('行首替换', applyCommand('/co', '/co', '/context'), '/context ');

const files = [fs('src', true), fs('README.md', false), fs('source', true), fs('a.txt', false)];
eq('目录优先', matchFiles(files, '@').map((e) => e.name), ['src', 'source', 'README.md', 'a.txt']);
eq('包含匹配', matchFiles(files, '@sou').map((e) => e.name), ['source']);
eq('无匹配', matchFiles(files, '@zzz').length, 0);
eq('目录补斜杠', applyMention('看 @sr', '@sr', 'src', true), '看 @src/');
eq('文件补空格', applyMention('看 @RE', '@RE', 'README.md', false), '看 @README.md ');

eq('父目录', parentDir('/a/b/'), '/a/b');
eq('根父目录', parentDir('/'), '/');
eq('父目录多斜杠', parentDir('/a/b//'), '/a/b');
eq('拼接路径', joinPath('/a', 'b'), '/a/b');
eq('拼接已带斜杠', joinPath('/a/', 'b'), '/a/b');

eq('enter 模式回车发送', enterSends('enter'), true);
eq('mod-enter 模式回车换行', enterSends('mod-enter'), false);
eq('行数上限', maxComposerLines(), 6);

if (fail > 0) { console.log(`  composer: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  composer: ${pass} passed, 0 failed`);
process.exit(0);

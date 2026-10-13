/** 输入框补全纯逻辑测试（触发条件写错会把邮箱/路径误当补全，或补全插错位置）。 */
declare const process: { exit: (c: number) => void };

import {
  activeToken, applyCommand, applyMention, CommandItem, composerPlaceholder, composerPlaceholderBudgetVp,
  enterSends, estimateTextWidthVp, FsEntry, joinPath,
  matchCommands, matchFiles, maxComposerLines, MAX_CANDIDATES, parentDir,
} from '../../entry/src/main/ets/core/composer';

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
// ⭐ 命令"只在首块"（web `useCompletion.ts:244-252`）：`/` 前有换行 ⇒ **不是命令**；`@` 不受此限。
eq('/ 前有换行 ⇒ 不算命令', activeToken('第一行\n/co', '/'), '');
eq('/ 前仅空格（仍首块）⇒ 算命令', activeToken('   /co', '/'), '/co');
eq('@ 前有换行 ⇒ 仍算提及（web 允许，:141-144）', activeToken('第一行\n@a', '@'), '@a');

const all = [cmd('/new', '新会话'), cmd('/compress', '压缩'), cmd('/context', '上下文'), cmd('/help', '帮助')];
eq('空查询给全部', matchCommands(all, '/').length, 4);
eq('前缀匹配', matchCommands(all, '/co').map((c) => c.name), ['/compress', '/context']);
eq('无匹配', matchCommands(all, '/zzz').length, 0);
eq('替换命令 token', applyCommand('请 /comp', '/comp', '/compress'), '请 /compress ');
eq('行首替换', applyCommand('/co', '/co', '/context'), '/context ');

const files = [fs('src', true), fs('README.md', false), fs('source', true), fs('a.txt', false)];
eq('目录优先', matchFiles(files, '@').map((e) => e.name), ['src', 'source', 'README.md', 'a.txt']);
eq('前缀匹配', matchFiles(files, '@sou').map((e) => e.name), ['source']);
eq('无匹配', matchFiles(files, '@zzz').length, 0);
// ⭐ 判别力样本（子串 vs 前缀的分水岭）：`localStorage.md` **不含前缀** `stor` ⇒ 必须不命中
//   （旧实现 `indexOf(q) >= 0` 子串匹配会错误命中，web `useCompletion.ts:296` = startsWith）。
eq('前缀匹配：包含但非前缀 ⇒ 不命中', matchFiles([fs('localStorage.md', false)], '@stor').length, 0);
eq('前缀匹配：前缀命中', matchFiles([fs('storage.md', false)], '@stor').map((e) => e.name), ['storage.md']);
// 上限 20（web `:67` MAX_CANDIDATES）
const many = [];
for (let i = 0; i < 25; i++) { many.push(fs(`f${i}`, false)); }
eq('文件候选上限 = 20', matchFiles(many, '@').length, 20);
eq('MAX_CANDIDATES 常量', MAX_CANDIDATES, 20);

// 命令：空名过滤（web `:254`）+ 上限 20（web `:262`）
const withEmpty = [cmd('', '空'), cmd('/new', '新'), cmd('/next', '下')];
eq('命令过滤空名', matchCommands(withEmpty, '/').map((c) => c.name), ['/new', '/next']);
const manyCmd = [];
for (let i = 0; i < 25; i++) { manyCmd.push(cmd(`/c${i}`, '')); }
eq('命令候选上限 = 20', matchCommands(manyCmd, '/').length, 20);
eq('目录补斜杠', applyMention('看 @sr', '@sr', 'src', true), '看 @src/');
eq('文件补空格', applyMention('看 @RE', '@RE', 'README.md', false), '看 @README.md ');

eq('父目录', parentDir('/a/b/'), '/a/b');
eq('根父目录', parentDir('/'), '/');
eq('父目录多斜杠', parentDir('/a/b//'), '/a/b');
eq('拼接路径', joinPath('/a', 'b'), '/a/b');
eq('拼接已带斜杠', joinPath('/a/', 'b'), '/a/b');

eq('enter 模式回车发送', enterSends('enter'), true);
eq('ctrl-enter 模式回车换行', enterSends('ctrl-enter'), false);
eq('历史 mod-enter 仍换行（迁移兼容）', enterSends('mod-enter'), false);
eq('行数上限', maxComposerLines(), 6);

// ── composerPlaceholder（mode-aware 占位文案；web `MessageInput.tsx:214-221` 同源）──────────────
// ⛔ 判据只许钉**调用点计数 + 三态 + 优先级 + 单行预算**：钉"函数体里有某字符串"会假绿。
const phIdle = composerPlaceholder(false, false);
const phBusy = composerPlaceholder(true, false);
const phInterject = composerPlaceholder(true, true);
eq('空闲 ⇒ 默认占位', phIdle, '给 Agent 发消息…');
eq('busy + 排队 ⇒ 明说"将排队"（web inputPlaceholderBusy）', phBusy, '处理中 — 消息将排队…');
eq('busy + 插话 ⇒ 明说"注入当前回合"（web inputPlaceholderInterject）', phInterject, '插话：立即注入当前回合…');
// 三态互异（防"三个分支返回同一句"式假绿）。
eq('三态文案两两不同', new Set([phIdle, phBusy, phInterject]).size, 3);
// ⭐ 优先级 = web 顺序：插话 **先于** busy（两者同为 true 时必须出插话文案）。
eq('优先级：插话 > busy', composerPlaceholder(true, true), phInterject);
eq('优先级：插话 > busy（idle 时插话不该出现，但仍取插话文案）', composerPlaceholder(false, true), phInterject);
// ⭐ 单行预算（2026-10-14 真机实测：可用宽 240vp；超一行即被裁 —— 见 `v_busy.jpeg` 的首版回归）。
const bodyPx = 15;   // `type.body` 档（`design.ets:231`）
const budget = composerPlaceholderBudgetVp();
const allPh = [phIdle, phBusy, phInterject];
eq('预算上限 = 210vp（实测可用 240vp，留 ~12% 余量）', budget, 210);
eq('预算 < 实测可用宽 240vp', budget < 240, true);
// 逐条**真的**量一遍（⛔ 不是"目测" —— 宽度由 estimateTextWidthVp 按字符类累加）。
for (let i = 0; i < allPh.length; i++) {
  const w = estimateTextWidthVp(allPh[i], bodyPx);
  eq(`单行预算内：「${allPh[i]}」`, w <= budget, true);
}
// ⭐ **mutation 自证**（判据必须有判别力）：注入 web 桌面原文，必须**超预算** ⇒ 说明这条闸真的能拦。
const webDesktop = '给 Agent 发消息…（Ctrl+Enter 发送）';
eq('mutation：web 桌面原文必超预算', estimateTextWidthVp(webDesktop, bodyPx) > budget, true);
// 宽度估算自身的判别力：CJK 比 ASCII 宽、`…` 按全角计。
eq('宽度估算：12 个 CJK = 12em', estimateTextWidthVp('中文字符测试用例啊哦嗯诶', 10), 120);
eq('宽度估算：10 个 ASCII = 5em', estimateTextWidthVp('abcdefghij', 10), 50);
eq('宽度估算：2 空格 = 0.5em', estimateTextWidthVp('  ', 10), 5);
eq('宽度估算：省略号按全角', estimateTextWidthVp('…', 10), 10);

if (fail > 0) { console.log(`  composer: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  composer: ${pass} passed, 0 failed`);
process.exit(0);

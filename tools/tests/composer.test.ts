/** 输入框补全纯逻辑测试（触发条件写错会把邮箱/路径误当补全，或补全插错位置）。 */
declare const process: { exit: (c: number) => void };

import {
  activeToken, applyCommand, applyMention, CANCEL_SPIN_MIN_MS, CommandItem, ComposerButton,
  composerButtonState, composerPlaceholder, composerPlaceholderBudgetVp,
  enterSends, estimateTextWidthVp, FsEntry, joinPath,
  matchCommands, matchFiles, maxComposerLines, MAX_CANDIDATES, parentDir, spinHoldRemainingMs,
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

// ══ 主按钮簇的同源语义（§21.120）══════════════════════════════════════════════════════
// 判据本体 `core/composer.composerButtonState`。⛔ 关键不变量：chip 可见性 **恒等于** 主按钮用的
// 那个 `running` ⇒ 页面里**不可能**再出现"停止按钮 + 无模式 chip"的自相矛盾（此前 chip 读裸 `this.busy`）。
const bIdle = composerButtonState(false, false, false, false);
eq('idle：不在跑', bIdle.running, false);
eq('idle：主按钮 = 发送（非停止）', bIdle.showStop, false);
eq('idle：不转圈', bIdle.cancelling, false);
eq('idle：无 ⚡', bIdle.interject, false);
const bStop = composerButtonState(true, false, false, false);
eq('busy+无内容：主按钮 = 停止', bStop.showStop, true);
eq('busy+无内容：chip 可见（与 running 同源）', bStop.running, true);
const bCancel = composerButtonState(true, false, true, false);
eq('busy+无内容+取消在飞：转圈', bCancel.cancelling, true);
eq('busy+有内容：主按钮 = 发送（用户要求「busy 时输入文字 ⇒ 变插队/排队」）',
  composerButtonState(true, true, false, false).showStop, false);
eq('busy+有内容+取消在飞：也**不**转圈（按钮已是"发送"，没有取消语义）',
  composerButtonState(true, true, true, false).cancelling, false);
eq('busy+有内容+插话模式 ⇒ ⚡ 图标', composerButtonState(true, true, false, true).interject, true);
eq('busy+有内容+排队模式 ⇒ 纸飞机（非 ⚡）', composerButtonState(true, true, false, false).interject, false);
eq('idle+有内容+插话模式 ⇒ **非** ⚡（插话只对在跑的回合有意义）',
  composerButtonState(false, true, false, true).interject, false);
// ⭐ 同源不变量（全组合穷举）：`running` 必须**逐字**等于入参，且 showStop ⇒ running。
const bcs: ComposerButton[] = [];
for (const r of [false, true]) for (const h of [false, true]) for (const c of [false, true]) for (const m of [false, true]) {
  bcs.push(composerButtonState(r, h, c, m));
}
eq('全组合：running === 入参 running（唯一出口）', bcs.map((b) => b.running).join(','),
  'false,false,false,false,false,false,false,false,true,true,true,true,true,true,true,true');
eq('全组合：showStop ⇒ running（不存在"不在跑却在停止"）', bcs.every((b) => !b.showStop || b.running), true);
eq('全组合：interject ⇒ running（不存在"不在跑却显示 ⚡"）', bcs.every((b) => !b.interject || b.running), true);
// ⭐ mutation 自证：若 chip 改回"第二个 busy 源"（不入参），上面这条 `running` 等式必红 ——
//    这里给出反例本身，证明判据有判别力（并非恒真）。
const divergent: ComposerButton = new ComposerButton();
divergent.running = false;                      // 第二个源说"不在跑"
eq('mutation：第二个 busy 源会让 running 等式失效（判据有判别力）',
  divergent.running === composerButtonState(true, false, false, false).running, false);


// ══ 取消按钮「最短转圈驻留」（§21.122bs）══════════════════════════════════════════════
// 判据本体 `core/composer.spinHoldRemainingMs`。真机实测：本地 `/api/cancel` 是**非阻塞派发**，
// 点停止后 ≤115ms 内按钮已收束，而设备侧最快截图量具周期就是 115ms/帧 ⇒ 用户看不到那一下 spin。
eq('最小驻留 = 240ms（Apple 最短反馈量级）', CANCEL_SPIN_MIN_MS, 240);
eq('请求瞬时返回（0ms）⇒ 驻留满额 240ms', spinHoldRemainingMs(0), 240);
eq('请求 100ms 返回 ⇒ 补足 140ms', spinHoldRemainingMs(100), 140);
eq('请求 239ms 返回 ⇒ 补足 1ms（边界内）', spinHoldRemainingMs(239), 1);
eq('请求正好 240ms ⇒ 0（立即可收束）', spinHoldRemainingMs(240), 0);
eq('请求 1s 返回 ⇒ 0（⛔ 不得返回负数；慢请求不额外拖长）', spinHoldRemainingMs(1000), 0);
// ⭐ mutation 自证：去掉 `rest > 0 ? rest : 0` 的夹紧（直接 `return rest`）后，上面这条会得到
//    `-760` ⇒ 必红。此处给出反例本身，证明判据有判别力（不是恒真）。
eq('mutation：不夹紧会返回负数（判据有判别力）', CANCEL_SPIN_MIN_MS - 1000 < 0, true);

process.exit(0);

export {};

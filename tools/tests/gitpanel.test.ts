/**
 * gitpanel 纯逻辑测试 —— 原生 Git 面板（web 内置插件 `xbot.git-fancy` 的原生落地）。
 *
 * 判别力要点（错一个字就会误导用户 / 让 UI 崩）：
 * ① **wire 解析**：字段缺省（旧后端 omitempty）、`clean` 的两种来源；
 * ② **分页合并去重**（真实场景：本仓多线并行，取第二页时仓库刚多了提交 ⇒ 与首页重叠）；
 * ③ **diff 归一化**：commit 作用域的 `git show` **前言必须剥掉**、未跟踪文件**没有 diff**
 *    （正文 ⇒ 合成全增行）—— 这两条不归一化，UI 会把 commit 头当 diff 画 / 把源码画成 ctx 行；
 * ④ 状态字母/分档/± 统计/分支/落差的格式化与空值口径。
 */
declare const process: { exit: (c: number) => void };

import {
  GitChange, GitDiffData, gitAheadBehindText, gitBranchText, gitCommitMetaText, gitDiffFiles,
  gitFileDir, gitFileName, gitHeadline, gitMethod, gitShortHash, gitStatText, gitStatusLetter,
  gitStatusTone, hasMoreGitLog, mergeGitLog, parseGitCommit, parseGitDiff, parseGitLog, parseGitStatus,
  stripDiffPreamble, synthesizeAddedLines, GIT_LOG_PAGE, GIT_PLUGIN_ID, RPC_WEB_PLUGIN,
} from '../../entry/src/main/ets/core/gitpanel';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 通道常量 / 方法名（wire 格式钉死）────────────────────────────────────────
eq('插件 id', GIT_PLUGIN_ID, 'xbot.git-fancy');
eq('外层方法名 = web_plugin_rpc（⛔ 不是插件方法本身，否则服务端 unknown RPC method）',
  RPC_WEB_PLUGIN, 'web_plugin_rpc');
eq('插件方法全名', gitMethod('status'), 'xbot.git-fancy.status');
eq('一页 20 条', GIT_LOG_PAGE, 20);

// ── status 解析（用真机实测到的真实载荷）──────────────────────────────────────
const realStatus = {
  ahead: 0, behind: 0, branch: 'main', clean: false, repo: true,
  changes: [
    { added: 69, deleted: 1, path: 'docs/SPLASH-SPEC.md', status: 'M' },
    { added: 4, deleted: 1, path: 'entry/src/main/ets/components/SettingsTools.ets', status: 'M' },
    { added: 0, deleted: 0, path: 'tools/tests/settings_tools_summary.test.ts', status: 'U' },
  ],
};
const st = parseGitStatus(realStatus);
eq('status: repo/branch', [st.repo, st.branch], [true, 'main']);
eq('status: 变更条数', st.changes.length, 3);
eq('status: 首条 path/status/±', [st.changes[0].path, st.changes[0].status, st.changes[0].added, st.changes[0].deleted],
  ['docs/SPLASH-SPEC.md', 'M', 69, 1]);
eq('status: 未跟踪计数缺省 0', [st.changes[2].added, st.changes[2].deleted], [0, 0]);
eq('status: 有变更 ⇒ clean=false', st.clean, false);

eq('status: null ⇒ 全缺省（不崩）', JSON.stringify(parseGitStatus(null)), JSON.stringify({
  repo: false, branch: '', ahead: 0, behind: 0, clean: true, changes: [], error: '',
}));
// ⛔ 判别点：服务端 `clean` 用 `omitempty` 时干净仓库**不带该字段** ⇒ 不能只看 clean 标志。
eq('status: 无 changes 且无 clean 字段 ⇒ 判为干净', parseGitStatus({ repo: true, branch: 'main' }).clean, true);
eq('status: 非仓库带原因', parseGitStatus({ repo: false, error: 'not a git repository' }).error, 'not a git repository');
eq('status: 数字字段缺失 ⇒ 0（不是 NaN）', parseGitStatus({ ahead: undefined, behind: undefined }).ahead, 0);

// ── log 解析 / 短哈希 / 分页 ───────────────────────────────────────────────
const logRaw = {
  commits: [
    { author: 'Li Boxiu', hash: '37173e969be67b246c9b9f70274e88ea9ffae7b2', subject: 'feat(panels): 定时任务详情', when: '4 hours ago' },
    { author: 'Li Boxiu', hash: 'b83eed2', subject: 'style(panels)', when: '5 hours ago' },
  ],
  total: 137,
};
const lg = parseGitLog(logRaw);
eq('log: 条数', lg.commits.length, 2);
eq('log: 短哈希 7 位', lg.commits[0].shortHash, '37173e9');
eq('log: 短哈希不足 7 位原样', lg.commits[1].shortHash, 'b83eed2');
eq('log: total', lg.total, 137);
eq('log: null ⇒ 空', JSON.stringify(parseGitLog(null)), JSON.stringify({ commits: [], total: 0 }));
// 旧后端不给 total ⇒ 兜底为本页长度（否则 hasMore 会拿 0 比较 ⇒ 永远 false，用户看不到"加载更多"）
eq('log: 无 total ⇒ 兜底本页长度', parseGitLog({ commits: logRaw.commits }).total, 2);
eq('log: 缺字段不崩', parseGitLog({ commits: [{ hash: 'abc' }] }).commits[0].subject, '');

eq('还有更多', hasMoreGitLog(lg), true);
eq('已取完 ⇒ 没有更多', hasMoreGitLog(parseGitLog({ commits: [{ hash: 'a' }], total: 1 })), false);
eq('空列表 ⇒ 没有更多（⛔ 不显示"加载更多"按钮）', hasMoreGitLog(parseGitLog(null)), false);

// ⛔ 判别点（真实现场）：取第二页时仓库刚新增提交 ⇒ 与首页重叠一行，必须去重。
const page1 = parseGitLog({ commits: [{ hash: 'aaa', subject: 'one' }, { hash: 'bbb', subject: 'two' }], total: 4 });
const page2 = parseGitLog({ commits: [{ hash: 'bbb', subject: 'two' }, { hash: 'ccc', subject: 'three' }], total: 4 });
const merged = mergeGitLog(page1, page2);
eq('分页合并：去重后顺序', merged.commits.map((c) => c.hash), ['aaa', 'bbb', 'ccc']);
eq('分页合并：total 取新页', merged.total, 4);
eq('分页合并：不重复追加（幂等）', mergeGitLog(merged, parseGitLog({ commits: [], total: 4 })).commits.length, 3);

// ── 状态字母 / 分档 / ± 统计 ──────────────────────────────────────────────
eq('字母：空 ⇒ ?（不留空白格）', gitStatusLetter(''), '?');
eq('字母：单字母原样', gitStatusLetter('M'), 'M');
eq('字母：未归一化两位 ⇒ 取首字母', gitStatusLetter(' M'), 'M');
eq('字母：untracked U', gitStatusLetter('U'), 'U');
eq('分档：A ⇒ add', gitStatusTone('A'), 'add');
eq('分档：U(untracked) ⇒ add', gitStatusTone('U'), 'add');
eq('分档：D ⇒ del', gitStatusTone('D'), 'del');
eq('分档：M ⇒ warn', gitStatusTone('M'), 'warn');
eq('分档：R/C ⇒ warn', [gitStatusTone('R'), gitStatusTone('C')], ['warn', 'warn']);
eq('分档：未知 ⇒ none（⛔ 不猜颜色）', gitStatusTone('X'), 'none');
eq('分档：空 ⇒ none', gitStatusTone(''), 'none');

function chg(a: number, d: number): GitChange {
  const c = new GitChange();
  c.added = a; c.deleted = d;
  return c;
}
eq('± 统计：增删都有', gitStatText(chg(69, 1)), '+69 −1');
eq('± 统计：只有增', gitStatText(chg(7, 0)), '+7');
eq('± 统计：只有删', gitStatText(chg(0, 3)), '−3');
eq('± 统计：双 0 ⇒ 空串（⛔ 不画 ±0 噪音）', gitStatText(chg(0, 0)), '');

// ── 分支 / 落差 / 顶部一句 ─────────────────────────────────────────────────
eq('落差：都有', gitAheadBehindText(Object.assign(parseGitStatus(null), { ahead: 2, behind: 1 })), '↑2 ↓1');
eq('落差：只有 ahead', gitAheadBehindText(Object.assign(parseGitStatus(null), { ahead: 3 })), '↑3');
eq('落差：皆 0 ⇒ 空串', gitAheadBehindText(parseGitStatus({ repo: true })), '');
eq('分支：正常', gitBranchText(parseGitStatus({ repo: true, branch: 'main' })), 'main');
eq('分支：空 ⇒ 可读兜底', gitBranchText(parseGitStatus({ repo: true })), '（无分支）');

eq('顶部：非仓库无原因 ⇒ 缺省文案',
  gitHeadline(parseGitStatus({ repo: false })), '当前会话的工作目录不是 Git 仓库');
eq('顶部：非仓库有原因 ⇒ 原因优先', gitHeadline(parseGitStatus({ repo: false, error: 'not a git repository' })), 'not a git repository');
eq('顶部：干净', gitHeadline(parseGitStatus({ repo: true, clean: true })), '工作区干净');
eq('顶部：N 个文件有改动', gitHeadline(parseGitStatus({ repo: true, changes: [{ path: 'a' }, { path: 'b' }] })), '2 个文件有改动');

// ── 路径拆分 ────────────────────────────────────────────────────────────────
eq('文件名：嵌套', gitFileName('entry/src/main/ets/pages/Index.ets'), 'Index.ets');
eq('文件名：根级', gitFileName('README.md'), 'README.md');
eq('目录：嵌套', gitFileDir('entry/src/main/ets/pages/Index.ets'), 'entry/src/main/ets/pages');
eq('目录：根级 ⇒ 空串（组件据此不画副行）', gitFileDir('README.md'), '');
eq('目录：单层', gitFileDir('tools/x.ts'), 'tools');

// ── diff 归一化（本文件最容易出错的地方）─────────────────────────────────────
const showOut = [
  'commit 37173e969be67b246c9b9f70274e88ea9ffae7b2',
  'Author: Li Boxiu <x@y.z>',
  'Date:   Mon Oct 13 05:00:00 2026 +0800',
  '',
  '    feat(panels): 定时任务详情',
  '',
  'diff --git a/tools/x.ts b/tools/x.ts',
  'index 111..222 100644',
  '--- a/tools/x.ts',
  '+++ b/tools/x.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = 4',
].join('\n');
const stripped = stripDiffPreamble(showOut);
eq('剥前言：从 diff --git 起', stripped.indexOf('diff --git a/tools/x.ts') === 0, true);
eq('剥前言：commit 头已消失', stripped.indexOf('Author:') < 0, true);
eq('剥前言：hunk 内容逐字保留', stripped.indexOf('-const b = 2') >= 0, true);
eq('剥前言：本来就干净 ⇒ 原样', stripDiffPreamble('@@ -1 +1 @@\n-a\n+b'), '@@ -1 +1 @@\n-a\n+b');
eq('剥前言：不是 diff ⇒ 原样（⛔ 不吞内容）', stripDiffPreamble('hello\nworld'), 'hello\nworld');

eq('未跟踪合成：尾部幻影空行不产出',
  synthesizeAddedLines('a\nb\n'), '@@ -0,0 +1,2 @@\n+a\n+b');
eq('未跟踪合成：无尾换行', synthesizeAddedLines('a\nb'), '@@ -0,0 +1,2 @@\n+a\n+b');
// ⚠️ `'\n'` = **一行空行**（不是空文件）⇒ 与服务端 `main.go:381-388` 逐字一致：产出 1 条增行。
eq('未跟踪合成：只有一个空行 ⇒ 1 条增行（同服务端）',
  synthesizeAddedLines('\n'), '@@ -0,0 +1,1 @@\n+');
eq('未跟踪合成：空文件 ⇒ 空串', synthesizeAddedLines(''), '');

const dUntracked = parseGitDiff({ path: 'new.ts', untracked: true, content: 'x\ny\n', adds: 2, dels: 0 });
eq('diff 解析：untracked 标记', dUntracked.untracked, true);
eq('diff 解析：untracked ⇒ 合成全增行', dUntracked.diffText, '@@ -0,0 +1,2 @@\n+x\n+y');
const dCommit = parseGitDiff({ path: 'tools/x.ts', commit: '37173e9', content: showOut, adds: 2, dels: 1 });
eq('diff 解析：commit 作用域剥前言', dCommit.diffText.indexOf('diff --git ') === 0, true);
eq('diff 解析：commit 作用域记 hash', dCommit.commit, '37173e9');
eq('diff 解析：空 content ⇒ 空 diffText（组件渲染空态）', parseGitDiff({ path: 'a' }).diffText, '');
eq('diff 解析：null ⇒ 默认', JSON.stringify(parseGitDiff(null)), JSON.stringify({
  path: '', diffText: '', adds: 0, dels: 0, untracked: false, commit: '', error: '',
}));

// ── 与既有 diff 渲染管线打通（唯一通路：diffText → parseUnifiedDiff）───────────
const files = gitDiffFiles(dCommit);
eq('喂给 parseUnifiedDiff：产出 1 个文件', files.length, 1);
eq('喂给 parseUnifiedDiff：路径取自 diff 头', files[0].path, 'tools/x.ts');
eq('喂给 parseUnifiedDiff：增删行数正确', [files[0].adds, files[0].dels], [2, 1]);
eq('未跟踪文件也能渲染', gitDiffFiles(dUntracked).length, 1);
eq('空 diff ⇒ 零文件（组件画空态而不是空 diff 卡）', gitDiffFiles(parseGitDiff(null)).length, 0);

// ── commit 详情 ────────────────────────────────────────────────────────────
const commitRaw = {
  hash: '37173e969be67b246c9b9f70274e88ea9ffae7b2', short: '37173e9',
  author: 'Li Boxiu', email: 'x@y.z', date: '2026-10-13T05:00:00+08:00',
  message: 'feat(panels): 定时任务详情\n\n正文第二段',
  files: [{ path: 'tools/x.ts', status: 'M', added: 12, deleted: 3 }],
};
const cd = parseGitCommit(commitRaw);
eq('commit: 短哈希本地算（与 log 行同口径）', cd.shortHash, '37173e9');
eq('commit: 作者/时间本地化', [cd.author, cd.when.length > 0 && cd.when !== commitRaw.date], ['Li Boxiu', true]);
eq('commit: 信息全文保换行', cd.message.indexOf('\n\n正文第二段') >= 0, true);
eq('commit: 文件复用 GitChange（± 统计同渲染）', [cd.files[0].path, cd.files[0].status, gitStatText(cd.files[0])],
  ['tools/x.ts', 'M', '+12 −3']);
eq('commit: null ⇒ 默认', JSON.stringify(parseGitCommit(null)), JSON.stringify({
  hash: '', shortHash: '', author: '', email: '', when: '', message: '', files: [], error: '',
}));
eq('commit: hash 缺失 ⇒ 退回服务端 short', parseGitCommit({ short: 'abc1234' }).shortHash, 'abc1234');
eq('commit: 元信息行 = 作者 · 时间', gitCommitMetaText(cd).indexOf('Li Boxiu · ') === 0, true);
eq('commit: 无作者 ⇒ 退回邮箱', gitCommitMetaText(parseGitCommit({ email: 'x@y.z' })), 'x@y.z');
eq('commit: 都没有 ⇒ 空串（⛔ 不留孤立分隔符）', gitCommitMetaText(parseGitCommit({})), '');

if (fail > 0) { console.log(`  gitpanel: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  gitpanel: ${pass} passed, 0 failed`);
process.exit(0);

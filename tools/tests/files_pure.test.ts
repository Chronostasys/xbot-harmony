/**
 * files_pure.test.ts —— 文件管理纯逻辑判据（目标④「文件管理也没有」，2026-10-12）。
 *
 * 钉死三件事（组件渲染**只读这些函数** ⇒ 判据与渲染同源）：
 *   ① 排序口径逐字对齐 web `useFileSystem.ts:96-99`（目录优先 + `localeCompare`）；
 *   ② 路径/面包屑/扩展名判定的**边界**（根、尾斜杠、无扩展名、点开头隐藏文件）；
 *   ③ 大小/相对时间的**人类可读**口径（1024 进制，与 Finder/`du -h` 同族）。
 *
 * ⚠️ **判别力自证**：把 `sortFsEntries` 的比较符反向 ⇒ 必红；`fmtSize` 的 1024 改 1000 ⇒ 必红；
 *    `extOf` 的 `i <= 0` 改 `i < 0`（`.hidden` 被当扩展名）⇒ 必红。
 */
export {};

declare const process: { exit: (c: number) => void };

import {
  extOf, fileKindOf, parentPath, joinFsPath, sortFsEntries, fmtSize, fmtAgo, fsCrumbs,
  fsListBody, fsHiddenToggleLabel,
  filterFsEntries, fsFilterEmptyText, fsFilterPlaceholder,
  fsCodeLanguage, fsCodeFence,
  FK_DIR, FK_IMAGE, FK_MARKDOWN, FK_TEXT, FsFileEntry,
} from '../../entry/src/main/ets/core/files';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ① extOf 边界 ────────────────────────────────────────────────────────────
eq('extOf 普通', extOf('a.md'), 'md');
eq('extOf 大写归一小写', extOf('a.MD'), 'md');
eq('extOf 无扩展名', extOf('Makefile'), '');
eq('★ extOf 点开头隐藏文件**不算**扩展名（`i<=0` 守卫）', extOf('.gitignore'), '');
eq('extOf 结尾点', extOf('a.'), '');
eq('extOf 多级（取最后一段）', extOf('a.b.ts'), 'ts');

// ── ② fileKindOf ────────────────────────────────────────────────────────────
eq('kind 目录优先（即使名字像图片）', fileKindOf('cat.png', true), FK_DIR);
eq('kind 图片', fileKindOf('cat.png', false), FK_IMAGE);
eq('kind svg 也算图片', fileKindOf('logo.svg', false), FK_IMAGE);
eq('kind markdown（大小写不敏感）', fileKindOf('README.MD', false), FK_MARKDOWN);
eq('kind 其余一律文本', fileKindOf('main.ets', false), FK_TEXT);
eq('kind 无扩展名 ⇒ 文本', fileKindOf('Makefile', false), FK_TEXT);

// ── ③ parentPath / joinFsPath ───────────────────────────────────────────────
eq('parentPath 常规', parentPath('/Users/bobli/x'), '/Users/bobli');
eq('parentPath 一级 ⇒ 根', parentPath('/Users'), '/');
eq('parentPath 根 ⇒ 根（幂等）', parentPath('/'), '/');
eq('parentPath 尾斜杠先规整', parentPath('/a/b/'), '/a');
eq('parentPath 空串 ⇒ 根', parentPath(''), '/');
eq('parentPath 相对单段 ⇒ 根', parentPath('a'), '/');
eq('parentPath 相对两段', parentPath('a/b'), 'a');
eq('joinFsPath 常规', joinFsPath('/a', 'b'), '/a/b');
eq('joinFsPath 去重尾斜杠', joinFsPath('/a/', 'b'), '/a/b');
eq('joinFsPath 空 dir', joinFsPath('', 'b'), 'b');
eq('joinFsPath 根 dir', joinFsPath('/', 'b'), '/b');

// ── ④ sortFsEntries：目录优先 + localeCompare（web 逐字同口径）─────────────
const raw: FsFileEntry[] = [
  { name: 'zeta.ts', isDir: false, size: 1 },
  { name: 'alpha', isDir: true, size: 0 },
  { name: 'Beta.txt', isDir: false, size: 2 },
  { name: 'aardvark', isDir: true, size: 0 },
];
const sorted: FsFileEntry[] = sortFsEntries(raw);
eq('sort：目录全在前（顺序按名）', sorted.map((e) => e.name).slice(0, 2), ['aardvark', 'alpha']);
eq('sort：文件按 localeCompare（Beta 在 zeta 前）', sorted.map((e) => e.name).slice(2), ['Beta.txt', 'zeta.ts']);
eq('sort：⛔ 不改入参（返回新数组）', raw.map((e) => e.name), ['zeta.ts', 'alpha', 'Beta.txt', 'aardvark']);
eq('sort：空输入', sortFsEntries([]).length, 0);

// ── ⑤ fmtSize：1024 进制 + 一位小数 ─────────────────────────────────────────
eq('size 0', fmtSize(0), '0 B');
eq('size 负数 ⇒ 0 B（防御）', fmtSize(-5), '0 B');
eq('size 512', fmtSize(512), '512 B');
// ★ 这条**区分 1024/1000 阈值**：1023 在 1024 进制下仍是 `1023 B`（1000 进制会误报 `1.0 KB`）
//   —— 补它的原因：仅靠 `fmtSize(1024) === '1.0 KB'` **抓不到** 1024→1000 的变异（实测定）
eq('★ size 1023 ⇒ 1023 B（1024 进制；1000 进制会误报 1.0 KB）', fmtSize(1023), '1023 B');
eq('★ size 1024 ⇒ 1.0 KB（1024 进制，非 1000）', fmtSize(1024), '1.0 KB');
eq('size 1536 ⇒ 1.5 KB', fmtSize(1536), '1.5 KB');
eq('size 1MB', fmtSize(1048576), '1.0 MB');
eq('size 1GB', fmtSize(1073741824), '1.0 GB');

// ── ⑥ fmtAgo ────────────────────────────────────────────────────────────────
const NOW: number = 1791800000000;
eq('ago 未来/相等 ⇒ 刚刚', fmtAgo(NOW + 5000, NOW), '刚刚');
eq('ago 30s ⇒ 刚刚', fmtAgo(NOW - 30000, NOW), '刚刚');
eq('ago 120s ⇒ 2 分钟前', fmtAgo(NOW - 120000, NOW), '2 分钟前');
eq('ago 2h ⇒ 2 小时前', fmtAgo(NOW - 7200000, NOW), '2 小时前');
eq('ago 2d ⇒ 2 天前', fmtAgo(NOW - 2 * 86400000, NOW), '2 天前');

// ── ⑦ fsCrumbs（面包屑判据同源）───────────────────────────────────────────────
eq('crumbs 根', fsCrumbs('/').map((c) => c.label), ['/']);
eq('crumbs 两级', fsCrumbs('/Users/bobli').map((c) => c.label), ['/', 'Users', 'bobli']);
eq('crumbs 绝对路径累计正确', fsCrumbs('/a/b').map((c) => c.path), ['/', '/a', '/a/b']);
eq('crumbs 尾斜杠不产生空段', fsCrumbs('/a/b/').map((c) => c.label), ['/', 'a', 'b']);

// ── ⑧ 隐藏文件开关（`show_hidden`；web 契约已有、原生此前未接）──────────────────
// ⛔⛔ 本块的核心价值：**钉死请求体的键名**。服务端 POST body 认 `show_hidden`（下划线），
//     随后折成 GET query 键 `showHidden`（驼峰）；`handleFsList` 读的是驼峰那个。
//     写错 ⇒ 服务端**静默忽略**（无错、无日志）⇒ 开关点了没反应 ⇒ 只有真机点一次才能发现。
eq('★ show_hidden：开 ⇒ body.show_hidden=true（键名必须是下划线）', fsListBody('/a', true).show_hidden, true);
eq('★ show_hidden：关 ⇒ body.show_hidden=false', fsListBody('/a', false).show_hidden, false);
eq('★ 键名集合恰为 {path, show_hidden}（多写/写错驼峰都抓）',
  Object.keys(fsListBody('/a', true)).sort(), ['path', 'show_hidden']);
ok('★ ⛔ 不得出现驼峰 `showHidden` 键（那是服务端 query 侧的键，body 侧写它=静默失效）',
  Object.keys(fsListBody('/a', true)).indexOf('showHidden') < 0);
eq('★ 空路径归一为根（同服务端 `rawPath=="" ⇒ "/"`）', fsListBody('', false).path, '/');
eq('★ 路径原样透传', fsListBody('/Users/bobli', true).path, '/Users/bobli');
// 开关可读状态（颜色态必须另有文本，⛔ 不许只靠颜色表达状态）
eq('★ 关闭时读法「显示隐藏文件」', fsHiddenToggleLabel(false), '显示隐藏文件');
eq('★ 开启时读法「不显示隐藏文件」', fsHiddenToggleLabel(true), '不显示隐藏文件');
ok('★ 两种状态读法不同（否则颜色态无替代文本）',
  fsHiddenToggleLabel(true) !== fsHiddenToggleLabel(false));

// ── 内联过滤（对齐 web `sidebar/FileExplorer.tsx:124-131`）──────────────────────
const ENT: FsFileEntry[] = [
  { name: 'README.md', isDir: false, size: 10, modTime: '' },
  { name: 'src', isDir: true, size: 0, modTime: '' },
  { name: 'SRC.md', isDir: false, size: 1, modTime: '' },
  { name: 'main.ets', isDir: false, size: 2, modTime: '' },
];
eq('★ 过滤：空查询 ⇒ 不过滤（全量）', filterFsEntries(ENT, '').length, 4);
eq('★ 过滤：纯空白 ⇒ 不过滤（trim 后为空）', filterFsEntries(ENT, '   ').length, 4);
eq('★ 过滤：大小写不敏感子串', filterFsEntries(ENT, 'read').map((e) => e.name).join(','), 'README.md');
eq('★ 过滤：子串命中在中间也算（非前缀）', filterFsEntries(ENT, 'adme').map((e) => e.name).join(','), 'README.md');
eq('★ 过滤：大小写混写命中两条（名字与扩展名都算）',
  filterFsEntries(ENT, 'src').map((e) => e.name).join(','), 'src,SRC.md');
eq('★ 过滤：目录也参与过滤（不是只过滤文件）',
  filterFsEntries(ENT, 'src').filter((e) => e.isDir).length, 1);
eq('★ 过滤：无命中 ⇒ 空数组', filterFsEntries(ENT, 'zzz').length, 0);
ok('★ 过滤返回新数组（不改入参）', (() => {
  const before = ENT.length;
  filterFsEntries(ENT, 'main');
  return ENT.length === before;
})());
ok('★ 过滤不改写条目顺序（排序是调用方的事）',
  filterFsEntries(ENT, 'src').map((e) => e.name).join(',') === 'src,SRC.md');
// 空态文案必须区分"空目录"与"过滤没命中"（⛔ 不静默）
eq('★ 空态：无查询 ⇒ 空目录', fsFilterEmptyText(''), '空目录');
eq('★ 空态：有查询 ⇒ 明说没匹配（带查询原文）',
  fsFilterEmptyText('zzz'), '没有匹配「zzz」的条目');
ok('★ 空态：两种情形文案不同', fsFilterEmptyText('') !== fsFilterEmptyText('zzz'));
ok('★ 占位文案非空（输入框必须有可读提示）', fsFilterPlaceholder().length > 0);

// ── 代码预览（围栏块复用聊天渲染）─────────────────────────────────────────────
eq('★ 语言：服务端 language 优先', fsCodeLanguage('a.py', 'Python'), 'python');
eq('★ 语言：服务端缺失 ⇒ 回落扩展名', fsCodeLanguage('a.ETS', ''), 'ets');
eq('★ 语言：两者皆空 ⇒ 空串（回落纯文本）', fsCodeLanguage('Makefile', ''), '');
eq('★ 语言：服务端纯空白视同缺失', fsCodeLanguage('a.ts', '   '), 'ts');
// 围栏：普通内容 ⇒ 3 反引号 + 语言 + 内容 + 收尾（`a` 无扩展名 ⇒ 语言为空）
eq('★ 围栏：标准形态', fsCodeFence('a', '', 'x = 1\n'), '```\nx = 1\n```\n');
eq('★ 围栏：带上语言', fsCodeFence('a.py', 'python', 'x = 1\n'), '```python\nx = 1\n```\n');
eq('★ 围栏：内容无尾换行 ⇒ 补一个（否则收尾栅栏与末行粘连）',
  fsCodeFence('a', '', 'x'), '```\nx\n```\n');
// ⛔ 安全：内容自带 3 反引号 ⇒ 围栏必须加长到 4（否则提前闭合、后半段被当正文）
eq('★ 围栏：内容含 ``` ⇒ 围栏升为 4（不提前闭合）',
  fsCodeFence('a', '', 'a\n```\nb\n'), '````\na\n```\nb\n````\n');
eq('★ 围栏：内容含 5 反引号连续串 ⇒ 围栏升为 6',
  fsCodeFence('a', '', '`````\n'), '``````\n`````\n``````\n');
ok('★ 围栏：升长后首尾长度一致且 = 内容最长串 + 1',
  (() => {
    const s = fsCodeFence('a', '', '`````\n');
    const first = s.slice(0, s.indexOf('\n')).length;
    const rest = s.slice(s.indexOf('\n') + 1);
    const second = rest.slice(rest.lastIndexOf('\n', rest.length - 2) + 1, rest.length - 1).length;
    return first === 6 && second === 6;
  })());
ok('★ 围栏：空内容不炸（返回空代码块）', fsCodeFence('a.txt', '', '').indexOf('```') === 0);


if (fail > 0) {
  console.log(`  ✗ files_pure: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ files_pure: ${pass} passed, 0 failed`);
process.exit(0);

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
  FK_DIR, FK_IMAGE, FK_MARKDOWN, FK_TEXT, FsFileEntry,
} from '../../entry/src/main/ets/core/files';

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
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

if (fail > 0) {
  console.log(`  ✗ files_pure: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ files_pure: ${pass} passed, 0 failed`);
process.exit(0);

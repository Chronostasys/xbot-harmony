/**
 * 流式 Markdown 块 key 判据（用户 2026-10-27：「打字机遇到列表表格之类的，会漏字」）。
 *
 * 根因（本文件钉死）：`assignKeys` 的 sig 旧版只有 `items.length` / `rows.length` / `text.length`
 *   —— 列表项或表格单元格**内容增长**时三者都不变 ⇒ 块 key 不变 ⇒ ArkUI `ForEach` 复用旧子树、
 *   不重跑 item builder ⇒ 新打的字永远不上屏（= 漏字）。
 * web 用「整篇解析成 DOM，只裁文本节点」（`MarkdownRenderer.tsx:clipTextNodes`），结构整体重建，
 *   所以没有这个失效面；原生必须让 key 随**内容**变化。
 *
 * mutation 自证：把 `blockContentHash` 从 sig 里去掉 ⇒ §2/§3 红。
 */
declare const process: { exit: (c: number) => void };

import { MdBlockKind, parseMarkdown, parseMarkdownCached, resetMdCache } from '../../entry/src/main/ets/core/markdown';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── §1 列表：条目**内容**增长时 key 必须变 ───────────────────────────────────
const listA = parseMarkdown('- 第一项\n- 第二');
const listB = parseMarkdown('- 第一项\n- 第二项已经打完了');
eq('列表块仍是列表', listB[0].kind, MdBlockKind.List);
eq('条目数相同（旧 sig 的唯一维度）', listA[0].items.length, listB[0].items.length);
ok('列表项内容变长 ⇒ 块 key 必须变（否则 ForEach 复用旧子树 = 漏字）',
  listA[0].key !== listB[0].key);

// 同一文本 ⇒ 同一 key（缓存/幂等前提）
ok('同文本 ⇒ 同 key', parseMarkdown('- 一\n- 二')[0].key === parseMarkdown('- 一\n- 二')[0].key);

// ── §2 表格：行内容增长（行数不变）时 key 必须变 ─────────────────────────────
const tblA = parseMarkdown('| 名称 | 值 |\n| --- | --- |\n| Alpha | 1');
const tblB = parseMarkdown('| 名称 | 值 |\n| --- | --- |\n| Alpha | 12345 |');
eq('表格块', tblB[0].kind, MdBlockKind.Table);
eq('行数相同（旧 sig 的唯一维度）', tblA[0].rows.length, tblB[0].rows.length);
ok('表格单元格内容变长 ⇒ 块 key 必须变', tblA[0].key !== tblB[0].key);

// 表头内容增长（行数/列数都不变）
const thA = parseMarkdown('| 名 | 值 |\n| --- | --- |');
const thB = parseMarkdown('| 名称 | 值 |\n| --- | --- |');
ok('表头内容变长 ⇒ 块 key 必须变', thA[0].key !== thB[0].key);

// ── §3 逐字符推进：key 序列单调变化（模拟打字机每拍）────────────────────────
// ⚠️ 只判「**可见正文**增长」那一拍：结构性字符（`|`/`-`/空白）可能不改变解析产物
//    （例如行尾空格），那不是漏字场景；正文多一个字却不换 key 才是。
function keysGrowWithVisibleChars(doc: string): boolean {
  let prevKeys = '';
  let prevText = '';
  for (let n = 1; n <= doc.length; n++) {
    const prefix = doc.substring(0, n);
    const keys = parseMarkdown(prefix).map((b) => b.key).join('|');
    const added = prefix.charAt(n - 1);
    const visible = /[\u4e00-\u9fa5A-Za-z0-9]/.test(added);
    if (visible && prevText.length > 0 && keys === prevKeys) {
      return false;
    }
    prevKeys = keys;
    prevText = prefix;
  }
  return true;
}
ok('列表：可见正文每长一个字符 ⇒ 块 key 必变（打字机每拍都能重建到最新文本）',
  keysGrowWithVisibleChars('- 第一项\n- 第二项\n- 第三项'));
ok('表格：可见正文每长一个字符 ⇒ 块 key 必变',
  keysGrowWithVisibleChars('| 名称 | 说明 |\n| --- | --- |\n| Alpha | 描述一 |'));

// ── §4 同文档内 key 唯一（重复即 ArkUI 报错 / 渲染中断）───────────────────────
const mixed = parseMarkdown('# 标题\n\n- a\n- b\n\n| h | v |\n| --- | --- |\n| 1 | 2 |\n\n段落');
const keys = mixed.map((b) => b.key);
const uniq = new Set(keys);
eq('块 key 唯一', keys.length, uniq.size);

// 两个**内容相同**的列表块（不同下标）也必须区分
const dup = parseMarkdown('- a\n\n- a');
eq('同内容不同下标的块 key 仍唯一', dup.length, new Set(dup.map((b) => b.key)).size);
ok('同内容不同下标的 key 不同', dup[0].key !== dup[1].key);

// ── §5 缓存路径（渲染实际入口）同样拿新 key ────────────────────────────────
resetMdCache();
const c1 = parseMarkdownCached('- x');
const c2 = parseMarkdownCached('- xy');
ok('parseMarkdownCached 内容变 ⇒ key 变', c1[0].key !== c2[0].key);
ok('parseMarkdownCached 命中同文本 ⇒ 同 key', parseMarkdownCached('- xy')[0].key === c2[0].key);

console.log(`stream_md_keys: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }

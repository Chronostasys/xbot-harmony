/**
 * loadmore_batch_tag.test.ts —— load more 分页截断根治的**判别力回归守卫**。
 *
 * ── 用户亲报（2026-10-13）───────────────────────────────────────────────────
 *   「有时候 load more 加载几次之后更早的加载不出来」。
 *
 * ── 根因（读码定位，对齐 web `hooks/useChatMessages.ts` Loop2 F4）──────────────
 *   服务端 `protocol.HistoryMessage.ID` 是 `json:"id,omitempty"` —— ID=0 时 JSON
 *   **省略该字段** ⇒ 客户端 `m.id` 为 `undefined`（无 id 行）。`toChatMessages` 旧写法
 *   用**批内下标**合成 id：`m-i${i}`（常规行）/ `m-tu${i}`（turn_user 还原行）。
 *   loadMore 分批时每批 `i` 都从 0 重来 ⇒ **第二批的合成 id 与第一批完全相同**
 *   ⇒ 前插后 `this.history` 出现**重复行 id** ⇒ 状态机/渲染层把新（更早）行当作已存在
 *   的重复行处理 ⇒ **更老的消息永远加载不出来**（分页在几次后截断）。
 *
 * ── 修法（精确对齐 web parseHistoryMessages(rows, batchTag)）─────────────────
 *   `toChatMessages(messages, batchTag=0)` 增参 —— id-less 行合成 id 改
 *   `hist-${batchTag}-${i}`（并 turn_user 还原行 `tu-${batchTag}-${i}`），批间唯一。
 *   `loadMore` 传 `this.oldestId`（本次 before_id 游标）；初始加载 / 测试路径传 0。
 *
 * ── 判别力（mutation 自证）──────────────────────────────────────────────────
 *   ① 若把 id-less 合成 id 改回 `m-i${i}`（忽略 batchTag）⇒ A1/A4 红；
 *   ② 若把 turn_user 还原行改回 `m-tu${i}`（忽略 batchTag）⇒ B1 红；
 *   ③ 若把有 DB id 行的 id 也随 batchTag 变 ⇒ C1 红（真实 id 必须批间稳定）；
 *   ④ 若 `loadMore` 不传 `this.oldestId`（恒 0）⇒ 源码级 D1 红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; resolve(...parts: string[]): string };
declare const __dirname: string;

import { ChatStore } from '../../entry/src/main/ets/core/store';
import { HistoryMessage } from '../../entry/src/main/ets/core/types';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
    return;
  }
  fail++;
  console.log(`  \u2717 ${name}${extra !== undefined ? '  (' + extra + ')' : ''}`);
}

/** 一行**无 DB id** 的历史（服务端 omitempty 省略 id ⇒ 客户端 undefined）。 */
function idLessRow(content: string): HistoryMessage {
  return {
    id: undefined as unknown as number,
    role: 'user',
    content,
    iterations: [],
  };
}

/** 一行**有 DB id** 的历史。 */
function idRow(id: number, content: string): HistoryMessage {
  return { id, role: 'assistant', content, iterations: [] };
}

function idsOf(rows: { id: string }[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) { s.add(r.id); }
  return s;
}

function collide(a: Set<string>, b: Set<string>): boolean {
  for (const x of b) { if (a.has(x)) { return true; } }
  return false;
}

function joinSet(s: Set<string>): string {
  let out = '';
  s.forEach((x: string) => { out += (out.length > 0 ? ',' : '') + x; });
  return out;
}

// ── A. 常规 id-less 行：**批间唯一**（不同 batchTag ⇒ id 不碰撞）────────────────
{
  const batch1 = ChatStore.toChatMessages([idLessRow('a0'), idLessRow('a1'), idLessRow('a2')], 100);
  const batch2 = ChatStore.toChatMessages([idLessRow('b0'), idLessRow('b1'), idLessRow('b2')], 50);
  const s1 = idsOf(batch1);
  const s2 = idsOf(batch2);
  ok('A1 不同 batchTag ⇒ 批间 id 无碰撞', !collide(s1, s2),
    `b1=${joinSet(s1)} b2=${joinSet(s2)}`);
  ok('A2 同批内 id 唯一（3 行 3 个不同 id）', s1.size === batch1.length && batch1.length === 3,
    `size=${s1.size} len=${batch1.length}`);
  // batchTag 进入 id（能区分 batch1/batch2 的同一 index）
  ok('A3 batchTag 参与合成（batch1[0] !== batch2[0]）', batch1[0].id !== batch2[0].id,
    `${batch1[0].id} vs ${batch2[0].id}`);
  // 模拟真实 loadMore 两批前插：合并后总 id 数 = 行数（零重复）
  const merged = batch2.concat(batch1);
  ok('A4 两批合并后 id 零重复（前插不产生重复行）', idsOf(merged).size === merged.length,
    `unique=${idsOf(merged).size} total=${merged.length}`);
}

// ── B. turn_user 还原行：**批间唯一**（对齐 web `turn-user-${...}` 批间唯一）────────
{
  const mk = (content: string): HistoryMessage[] => [
    {
      id: undefined as unknown as number,
      role: 'assistant',
      turn_id: 7,
      regions_before: 9,
      content: '\u7b54',
      iterations: [],
      turn_user: { id: undefined as unknown as number, role: 'user', content, turn_id: 7 },
    },
  ];
  const b1 = ChatStore.toChatMessages(mk('q1'), 100);
  const b2 = ChatStore.toChatMessages(mk('q2'), 50);
  const u1 = b1.filter((m) => m.role === 'user');
  const u2 = b2.filter((m) => m.role === 'user');
  ok('B0 两批都还原出 user 行', u1.length === 1 && u2.length === 1);
  ok('B1 turn_user 还原行 id 批间不碰撞（batchTag 参与）',
    u1.length === 1 && u2.length === 1 && u1[0].id !== u2[0].id,
    u1.length === 1 && u2.length === 1 ? `${u1[0].id} vs ${u2[0].id}` : 'n/a');
}

// ── C. 有 DB id 行：id 批间**稳定**（真实主键唯一 ⇒ 不随 batchTag 变）────────────
{
  const b1 = ChatStore.toChatMessages([idRow(200, 'x')], 100);
  const b2 = ChatStore.toChatMessages([idRow(200, 'x')], 50);
  ok('C1 有 DB id 行 id 批间稳定（= m-<id>，与 batchTag 无关）',
    b1[0].id === 'm-200' && b2[0].id === 'm-200',
    `${b1[0].id} / ${b2[0].id}`);
}

// ── D. 源码级：`loadMore` 必须把 `this.oldestId` 当 batchTag 传下去 ──────────────
{
  const fsMod = require('fs');
  const pathMod = require('path');
  // ⚠️ 测试从临时目录 `.out-one.$$/js/` 运行 ⇒ `__dirname` 不是仓库根。上溯探测。
  let root = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const p = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(p, 'entry/src/main/ets/core/store.ets'))) { root = p; break; }
  }
  ok('D0 探测到仓库根（零扫描判红）', root.length > 0);
  const storeSrc: string = root.length > 0
    ? fsMod.readFileSync(pathMod.join(root, 'entry/src/main/ets/core/store.ets'), 'utf-8')
    : '';
  // 只取 `loadMore` 调用片段（`grep -o` 风格：钉调用点，不钉"名字出现过"）
  ok('D1 loadMore 传 this.oldestId 作 batchTag',
    storeSrc.includes('ChatStore.toChatMessages(data.messages, this.oldestId)'),
    '未找到 loadMore 的 batchTag 实参');
  ok('D2 初始加载传 0（非 pagination 游标）',
    storeSrc.includes('ChatStore.toChatMessages(data.messages, 0)'));
  // ⛔ web `useChatMessages.ts:620-639` 的「精确 id 全重复 ⇒ 停止分页」安全网（防游标停滞
  //    死循环 + 重复行撞 key）。钉**调用片段**，不钉"名字出现过"。
  ok('D3 loadMore 有「全重复 ⇒ hasMore=false 停止」安全网',
    storeSrc.includes('if (fresh.length === 0) {') && storeSrc.includes('this.hasMore = false;'),
    '未找到 fresh 全重复停止逻辑');
}

console.log(`\nloadmore_batch_tag: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

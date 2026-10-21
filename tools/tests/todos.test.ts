/**
 * Todo 面板纯逻辑测试 —— 状态归一 / 进度统计 / 行变换（勾选·改名·删除）/ goal 判定 / RPC 载荷。
 *
 * 权威基准（web）：
 *   · 状态词汇 `xbot/tools/todo.go:15` = `"pending" | "doing" | "done"`
 *   · 统计 `web/src/hooks/useTodos.ts:34-43`（含 :37-39 记的 in-flight P0：**不能** truthy 判 status）
 *   · 行变换 `web/src/components/agent/TodoPullOut.tsx:66-84`
 *   · goal 行判定 `:128`；空列表不渲染 `:56`
 *   · set_todos 载荷 `web/src/components/agent/api.ts:190-198`（只发 `{text,status}`）
 *
 * ⚠️ 判别力自证（提交信息）：三处 mutation 分别必红 ——
 *   ① `todoState` 的 done 判定改成"非 pending 即 done"；② `renameTodoAt` 去掉空文本守卫；
 *   ③ `todoStatusKind` 的未知值兜底从 pending 改成 done。
 */
declare const process: { exit: (c: number) => void };

import {
  hasTodos, isGoalTodo, isTodoDone, removeTodoAt, renameTodoAt, TodoPayloadRow, TodoState,
  TODO_DOING, TODO_DONE, TODO_PENDING, todoCountLabel, todoPayloadRows, todoPercent, todoRowKey,
  todoState, todoStatusKind, todoText, toggleTodoAt,
} from '../../entry/src/main/ets/core/todos';
import { TodoItem } from '../../entry/src/main/ets/core/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function td(text: string, status?: string, id?: string): TodoItem {
  const t: TodoItem = { text };
  if (status !== undefined) { t.status = status; }
  if (id !== undefined) { t.id = id; }
  return t;
}

// ── ① 状态归一（服务端词汇 tools/todo.go:15）──
{
  eq('pending ⇒ pending', todoStatusKind('pending'), TODO_PENDING);
  eq('doing ⇒ doing', todoStatusKind('doing'), TODO_DOING);
  eq('done ⇒ done', todoStatusKind('done'), TODO_DONE);
  // 兼容别名（仅为容错；服务端不会发这两个值）
  eq('in_progress 别名 ⇒ doing', todoStatusKind('in_progress'), TODO_DOING);
  eq('completed 别名 ⇒ done', todoStatusKind('completed'), TODO_DONE);
  // ⛔ 未知值 ⇒ **pending**（归 done 会让进度虚高、清单看起来全做完）
  eq('未知值 ⇒ pending', todoStatusKind('weird'), TODO_PENDING);
  eq('空串 ⇒ pending', todoStatusKind(''), TODO_PENDING);
  eq('undefined ⇒ pending', todoStatusKind(undefined), TODO_PENDING);
  eq('大小写敏感（Done ≠ done）', todoStatusKind('Done'), TODO_PENDING);
}

// ── ② isTodoDone / todoText ──
{
  ok('done 已完成', isTodoDone('done'));
  ok('doing 未完成', !isTodoDone('doing'));
  ok('pending 未完成', !isTodoDone('pending'));
  ok('undefined 未完成', !isTodoDone(undefined));
  eq('todoText 取值', todoText(td('abc', 'pending')), 'abc');
  eq('todoText 缺省空串', todoText({ id: '1' }), '');
  eq('todoText undefined ⇒ 空串', todoText(undefined), '');
}

// ── ③ 统计（web useTodos.ts:34-43，含 in-flight P0 的判据）──
{
  const empty: TodoState = todoState([]);
  eq('空：total=0', empty.total, 0);
  eq('空：doneCount=0', empty.doneCount, 0);
  eq('空：currentIndex=-1', empty.currentIndex, -1);
  eq('空：currentText=""', empty.currentText, '');
  eq('空：hasTodos=false', hasTodos([]), false);
  eq('undefined：hasTodos=false', hasTodos(undefined), false);

  const mixed: TodoItem[] = [
    td('a', 'done'), td('b', 'doing'), td('c', 'pending'), td('d', 'done'),
  ];
  const st: TodoState = todoState(mixed);
  eq('total=4', st.total, 4);
  eq('doneCount=2（只认 done）', st.doneCount, 2);
  eq('currentIndex=1（第一条未完成）', st.currentIndex, 1);
  eq('currentText=b', st.currentText, 'b');
  eq('percent=50', todoPercent(st), 50);
  eq('label=2/4', todoCountLabel(st), '2/4');
  ok('total>0 ⇒ hasTodos', hasTodos(mixed));

  // ⛔ web :37-39 的事故：status 是**字符串**，"pending"/"doing" 都是 truthy。
  //    truthy 判 `t.status` 会得出 doneCount=4 ⇒ "4/4 全部完成"但展开全是圆圈。
  const allPending: TodoItem[] = [td('a', 'pending'), td('b', 'pending')];
  const sp: TodoState = todoState(allPending);
  eq('全 pending ⇒ doneCount=0（不是 truthy 计数）', sp.doneCount, 0);
  eq('全 pending ⇒ percent=0', todoPercent(sp), 0);
  eq('全 pending ⇒ currentIndex=0', sp.currentIndex, 0);

  // 未知状态**不得**算完成（否则进度虚高）
  const unknown: TodoItem[] = [td('a', 'weird'), td('b', 'done')];
  const su: TodoState = todoState(unknown);
  eq('未知状态不算 done ⇒ doneCount=1', su.doneCount, 1);
  eq('未知状态视作未完成 ⇒ currentIndex=0', su.currentIndex, 0);

  const allDone: TodoItem[] = [td('a', 'done'), td('b', 'completed')];
  const sd: TodoState = todoState(allDone);
  eq('全完成 ⇒ doneCount=2', sd.doneCount, 2);
  eq('全完成 ⇒ currentIndex=-1', sd.currentIndex, -1);
  eq('全完成 ⇒ currentText=""', sd.currentText, '');
  eq('全完成 ⇒ percent=100', todoPercent(sd), 100);
  eq('percent 取整（1/3 ⇒ 33）', todoPercent(todoState([td('a', 'done'), td('b', 'pending'), td('c', 'pending')])), 33);

  // 缺 status 字段的条目按 pending 处理
  const noStatus: TodoItem[] = [{ text: 'x' }];
  eq('缺 status ⇒ 未完成', todoState(noStatus).doneCount, 0);
}

// ── ④ 勾选/取消（web :76-80）──
{
  const src: TodoItem[] = [td('a', 'pending', 'id-a'), td('b', 'done'), td('c', 'doing')];
  const toggled: TodoItem[] = toggleTodoAt(src, 0);
  eq('pending → done', toggled[0].status, 'done');
  eq('勾选不改文本', toggled[0].text, 'a');
  eq('勾选保留 id', toggled[0].id, 'id-a');
  eq('未触及的行原样', [toggled[1].status, toggled[2].status], ['done', 'doing']);

  eq('done → pending', toggleTodoAt(src, 1)[0 - 0 + 1].status, 'pending');
  // web 逐字语义：doing 也会被翻成 done（不是翻成 pending）
  eq('doing → done（与 web 一致）', toggleTodoAt(src, 2)[2].status, 'done');
  // 不可变：原数组不受影响
  eq('原数组未被就地修改', [src[0].status, src[1].status, src[2].status], ['pending', 'done', 'doing']);
  // 越界 ⇒ 内容不变（长度与状态一致）
  eq('越界勾选不改内容', toggleTodoAt(src, 9).length, 3);
  eq('越界勾选状态不变', [toggleTodoAt(src, 9)[0].status, toggleTodoAt(src, 9)[2].status], ['pending', 'doing']);
}

// ── ⑤ 改名（web commitEdit :66-74）──
{
  const src: TodoItem[] = [td('old', 'doing', 'id-1'), td('keep', 'pending')];
  const renamed: TodoItem[] = renameTodoAt(src, 0, '  new  ');
  eq('改名 trim 后落库', renamed[0].text, 'new');
  eq('改名保留 status', renamed[0].status, 'doing');
  eq('改名保留 id', renamed[0].id, 'id-1');
  eq('其它行不变', renamed[1].text, 'keep');

  // ⛔ 空/纯空白 ⇒ **原样返回（同一引用）**：清空文本会静默丢一条清单项
  ok('空串 ⇒ 同一引用（不丢条目）', renameTodoAt(src, 0, '') === src);
  ok('纯空白 ⇒ 同一引用', renameTodoAt(src, 0, '   ') === src);
  // 与原文相同 ⇒ 同一引用（不产生无谓写）
  ok('未变更 ⇒ 同一引用', renameTodoAt(src, 0, 'old') === src);
  ok('未变更（两侧空白）⇒ 同一引用', renameTodoAt(src, 0, '  old ') === src);
  // 越界 ⇒ 同一引用
  ok('越界 ⇒ 同一引用', renameTodoAt(src, 5, 'x') === src);
  ok('负索引 ⇒ 同一引用', renameTodoAt(src, -1, 'x') === src);
}

// ── ⑥ 删除（web :82-84）──
{
  const src: TodoItem[] = [td('a'), td('b'), td('c')];
  const removed: TodoItem[] = removeTodoAt(src, 1);
  eq('删除中间项', removed.map((t: TodoItem) => t.text), ['a', 'c']);
  ok('越界 ⇒ 同一引用', removeTodoAt(src, 3) === src);
  ok('负索引 ⇒ 同一引用', removeTodoAt(src, -1) === src);
  eq('删空', removeTodoAt(src, 0).length, 2);
}

// ── ⑦ goal 行判定（web :128：`!!goalText && goalText.trim() === todo.text.trim()`）──
{
  ok('空 goal ⇒ 恒 false', !isGoalTodo('任意', ''));
  ok('undefined goal ⇒ false', !isGoalTodo('任意', undefined));
  ok('纯空白 goal ⇒ false（不能匹配空文本条目）', !isGoalTodo('', '   '));
  ok('两侧空白后相等 ⇒ true', isGoalTodo('  修复登录 ', '修复登录'));
  ok('不等 ⇒ false', !isGoalTodo('a', 'b'));
  ok('子串不算相等', !isGoalTodo('修复登录页', '修复登录'));
}

// ── ⑧ set_todos 载荷（web api.ts:190-198：只发 text+status，**不带 id**）──
{
  const rows: TodoPayloadRow[] = todoPayloadRows([
    td('a', 'doing', 'id-1'), td('b', undefined), td('c', 'weird'),
  ]);
  eq('载荷 text', rows.map((r: TodoPayloadRow) => r.text), ['a', 'b', 'c']);
  eq('载荷 status 已归一', rows.map((r: TodoPayloadRow) => r.status), ['doing', 'pending', 'pending']);
  eq('载荷键只有 text/status（无 id）', Object.keys(rows[0]).sort(), ['status', 'text']);
  eq('空列表 ⇒ 空载荷', todoPayloadRows([]), []);
}

// ── ⑨ 行 key 唯一真源（判据单一性门禁规则 A 的处方形态；ArkUI ForEach 不比较内容）──
// ⛔ 判别力：**任一**内容维度变化 ⇒ key 必变（否则 ArkUI 复用旧节点、勾选/改名/进编辑不刷新）。
{
  const a: TodoItem = td('买牛奶', 'pending');
  const base: string = todoRowKey(a, 0, false, '');
  eq('同输入 ⇒ 同 key（稳定）', todoRowKey(a, 0, false, ''), base);
  // status 变 ⇒ key 变（勾选必须刷新）
  ok('status 变 ⇒ key 变', todoRowKey(td('买牛奶', 'done'), 0, false, '') !== base);
  // 文本变（**同长异文**：'ab'→'cd' 仍须换 key，长度指纹会漏）
  ok('同长异文 ⇒ key 变', todoRowKey(td('买可乐', 'pending'), 0, false, '') !== base);
  // 编辑态变 ⇒ key 变（进/出编辑要重建该行）
  ok('editing 变 ⇒ key 变', todoRowKey(a, 0, true, '') !== base);
  // goal 徽标变 ⇒ key 变
  ok('goal 变 ⇒ key 变', todoRowKey(a, 0, false, '买牛奶') !== base);
  // 位置变 ⇒ key 变（列表内身份 = 位置）
  ok('index 变 ⇒ key 变', todoRowKey(a, 1, false, '') !== base);
  // key 必须**含**稳定身份（index）与内容（文本），便于人读/定位
  ok('key 含 index 前缀', base.indexOf('0#') === 0);
  ok('key 含文本全文', base.indexOf('买牛奶') >= 0);
  // 缺 status 的条目按 pending 归一（与 todoStatusKind 同源）
  eq('缺 status ⇒ 归 pending', todoRowKey({ text: 'x' }, 2, false, ''), todoRowKey(td('x', 'pending'), 2, false, ''));
  // undefined 条目不抛（外来 JSON 边界）
  ok('undefined 条目不抛', todoRowKey(undefined, 3, false, '').indexOf('3#pending#') === 0);
}

console.log(`\ntodos.test: ${pass} passed / ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);

export {};

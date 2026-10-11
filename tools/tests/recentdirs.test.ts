/**
 * 最近工作目录门禁 —— 守护 `core/recentdirs.ets`（web `lib/recent-workdirs.ts` 的纯逻辑移植）。
 *
 * 判别力自证（改动下列任一锚点 ⇒ 必红）：
 *   · 把 `RECENT_WORKDIRS_MAX` 从 5 改成 4           ⇒ '上限 5' 红
 *   · 把解析里的"去重保首现序"改成"保末现"          ⇒ '去重保首序' 红
 *   · 放宽版本校验（`!== 1` 改成总是通过）            ⇒ '版本不符 ⇒ []' 红
 *   · 让 `rememberWorkDir` 把新目录**追加到末尾**     ⇒ 'LRU 最新在前' 红
 *   · 把 `removeWorkDir` 改成 trim 后比较            ⇒ 'remove 不 trim' 红
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 逐文件 `node`）。
 */
declare const process: { exit: (c: number) => void };

import {
  RECENT_WORKDIRS_KEY, RECENT_WORKDIRS_VERSION, RECENT_WORKDIRS_MAX,
  parseRecentWorkDirs, serializeRecentWorkDirs, rememberWorkDir, removeWorkDir, hasWorkDir,
} from '../../entry/src/main/ets/core/recentdirs';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── 常量契约（与 web 逐字一致）─────────────────────────────────────────────────
eq('存储键 = web 原值', RECENT_WORKDIRS_KEY, 'xbot:recent-workdirs:v1');
eq('版本 = 1', RECENT_WORKDIRS_VERSION, 1);
eq('上限 = 5', RECENT_WORKDIRS_MAX, 5);

// ── 解析：脏数据容错（绝不抛）─────────────────────────────────────────────────
eq('undefined ⇒ []', parseRecentWorkDirs(undefined), []);
eq('null ⇒ []', parseRecentWorkDirs(null), []);
eq('空串 ⇒ []', parseRecentWorkDirs(''), []);
eq('非法 JSON ⇒ []（不抛）', parseRecentWorkDirs('{not json'), []);
eq('JSON null ⇒ []', parseRecentWorkDirs('null'), []);
eq('数组而非对象 ⇒ []', parseRecentWorkDirs('["/a"]'), []);
eq('版本不符 ⇒ []', parseRecentWorkDirs('{"version":2,"paths":["/a"]}'), []);
eq('缺 version ⇒ []', parseRecentWorkDirs('{"paths":["/a"]}'), []);
eq('paths 非数组 ⇒ []', parseRecentWorkDirs('{"version":1,"paths":"/a"}'), []);
eq('paths 缺省 ⇒ []', parseRecentWorkDirs('{"version":1}'), []);
// 脏项：非字符串剔除、空/空白剔除、trim
eq('脏项剔除 + trim',
  parseRecentWorkDirs('{"version":1,"paths":[" /a ", 42, null, "", "   ", "/b", {"x":1}]}'),
  ['/a', '/b']);
// 去重保**首现序**（不是末现）
eq('去重保首现序', parseRecentWorkDirs('{"version":1,"paths":["/a","/b","/a"]}'), ['/a', '/b']);
// 超上限截断
eq('超上限截断到 5',
  parseRecentWorkDirs('{"version":1,"paths":["/1","/2","/3","/4","/5","/6","/7"]}'),
  ['/1', '/2', '/3', '/4', '/5']);
// 对象里多余字段忽略
eq('多余字段忽略', parseRecentWorkDirs('{"version":1,"paths":["/a"],"extra":true}'), ['/a']);
// Unicode / 带空格路径
eq('Unicode 目录保留', parseRecentWorkDirs('{"version":1,"paths":["/用户/项目","/a b/c"]}'), ['/用户/项目', '/a b/c']);

// ── 序列化：格式与 web 逐字一致（两端读同一份服务端设置）────────────────────────
eq('序列化 = {version:1,paths}',
  serializeRecentWorkDirs(['/a', '/b']), '{"version":1,"paths":["/a","/b"]}');
eq('空列表序列化', serializeRecentWorkDirs([]), '{"version":1,"paths":[]}');
// 往返：serialize ∘ parse 恒等
eq('往返恒等', parseRecentWorkDirs(serializeRecentWorkDirs(['/a', '/b'])), ['/a', '/b']);

// ── remember：LRU、去重、上限、空参不改 ───────────────────────────────────────
eq('最新在前', rememberWorkDir([], '/a'), ['/a']);
eq('LRU：重复目录提到最前', rememberWorkDir(['/a', '/b'], '/b'), ['/b', '/a']);
eq('LRU：新目录插最前', rememberWorkDir(['/a'], '/c'), ['/c', '/a']);
// 逐字对齐 web 的用例：['/a'…'/f','/c'] ⇒ ['/c','/f','/e','/d','/b']
{
  let list: string[] = [];
  for (const p of ['/a', '/b', '/c', '/d', '/e', '/f', '/c']) { list = rememberWorkDir(list, p); }
  eq('web 用例：记忆序列 ⇒ 前 5', list, ['/c', '/f', '/e', '/d', '/b']);
}
eq('上限 5（第 6 个进来挤掉最旧）',
  rememberWorkDir(['/1', '/2', '/3', '/4', '/5'], '/6'), ['/6', '/1', '/2', '/3', '/4']);
eq('remember 空参不改', rememberWorkDir(['/a'], '   '), ['/a']);
eq('remember 入参 trim', rememberWorkDir([], '  /a  '), ['/a']);
// 入参不被修改（纯函数）
{
  const orig: string[] = ['/a', '/b'];
  const copy: string[] = orig.slice();
  rememberWorkDir(orig, '/c');
  eq('remember 不改入参', orig, copy);
}

// ── remove：逐字对齐 web（不 trim）─────────────────────────────────────────────
eq('移除命中', removeWorkDir(['/a', '/b'], '/a'), ['/b']);
eq('移除未命中 ⇒ 原样', removeWorkDir(['/a', '/b'], '/x'), ['/a', '/b']);
eq('web 用例：移除后仅剩一项', removeWorkDir(rememberWorkDir(rememberWorkDir([], '/repo/one'), '/repo/two'), '/repo/one'), ['/repo/two']);
// ⚠️ 不 trim：带空格入参删不掉带空格的存储项以外的东西
eq('remove 不 trim（与 web 一致）', removeWorkDir([' /a '], '/a'), [' /a ']);
{
  const orig: string[] = ['/a', '/b'];
  const copy: string[] = orig.slice();
  removeWorkDir(orig, '/a');
  eq('remove 不改入参', orig, copy);
}

// ── hasWorkDir ────────────────────────────────────────────────────────────────
eq('has 命中', hasWorkDir(['/a'], '/a'), true);
eq('has 未命中', hasWorkDir(['/a'], '/b'), false);

console.log(`  recentdirs: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

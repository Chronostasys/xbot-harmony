/**
 * 「最近工作目录」**UI 接线**判据 —— 守护 `core/recentdirs.ets` 被界面**真的消费**。
 *
 * 为什么需要它（本仓血教训）：「纯逻辑就绪 ≠ 用户能用」。`core/recentdirs.ets`（`10aae43`）
 * 交付时**零消费方**，而 `run.sh`/`lint`/`typecheck` 全绿 ⇒ 假绿。纯逻辑测试
 * （`recentdirs.test.ts`）只能证明"函数对"，**证明不了"用户用得到"** —— 本判据补这一刀。
 *
 * 口径（钉**调用点计数**，⛔ 不钉"方法体存在"）：
 *   ① `Index.ets` 真的调用 `parseRecentWorkDirs`/`rememberWorkDir`/`removeWorkDir`/`serializeRecentWorkDirs`
 *      （计数 ≥1，并打印 `file:line`）；
 *   ② **写回路径**：串化（serialize）+ 设置写入（`this.setSetting`）+ 应用到会话（`set_cwd` RPC）三者齐备；
 *   ③ **零扫描判红**：源文件读不到 / 非空断言先红（白绿防线）；
 *   ④ **mutation 自证**：把任一消费点从 `Index.ets` 去掉 ⇒ 对应断言必红（实测见交付报告）。
 *
 * ⚠️ 先剥注释（本仓 GOTCHA：注释里就会写这些函数名，不剥会**假绿**）。
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 逐文件 `node`）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import {
  parseRecentWorkDirs, rememberWorkDir, removeWorkDir, serializeRecentWorkDirs, RECENT_WORKDIRS_SERVER_KEY,
} from '../../entry/src/main/ets/core/recentdirs';

const fsMod = require('fs');
const pathMod = require('path');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}

// ── 定位仓库根 + 读源（零扫描判红）────────────────────────────────────────────
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const c = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/pages/Index.ets'))) { repo = c; break; }
}
ok('探测到仓库根', repo.length > 0);

const SRC = pathMod.join(repo, 'entry/src/main/ets/pages/Index.ets');
let raw = '';
try {
  raw = fsMod.readFileSync(SRC, 'utf-8');
} catch (e) {
  raw = '';
}
// ③ 零扫描判红：源文件读不到 ⇒ 断言红（后续所有 counting 也都会 0 ⇒ 红）。
ok('★ 零扫描防线：pages/Index.ets 可读且非空', raw.length > 0);

/** 剥注释（⛔ 不剥会误伤：注释里就会写这些函数名）。 */
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** 出现次数（纯字符串计数；needle 取调用片段，⛔ 不取"整行第一个引号"）。 */
function count(needle: string): number {
  let n = 0, i = 0;
  while ((i = src.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

/** 首次出现的行号（1 基）；未命中 ⇒ -1。 */
function firstLine(needle: string): number {
  const i = src.indexOf(needle);
  if (i < 0) { return -1; }
  return src.slice(0, i).split('\n').length;
}

// ── ① 真消费：四个 API 都有调用点（计数 ≥1，指名 file:line）────────────────────
const CALLS: string[] = ['parseRecentWorkDirs(', 'rememberWorkDir(', 'removeWorkDir(', 'serializeRecentWorkDirs('];
for (const c of CALLS) {
  ok(`① 调用点计数 ≥1：${c} （Index.ets:${firstLine(c)}）`, count(c) >= 1);
}
ok(`① 服务端设置键被消费（index.ets:${firstLine('RECENT_WORKDIRS_SERVER_KEY')}）`,
  count('RECENT_WORKDIRS_SERVER_KEY') >= 1);
ok('① 从 core/recentdirs 导入（不是别处复制一份）', count("from '../core/recentdirs'") >= 1);

// ── ② 记录写回路径：串化 + 设置写入 + 应用到会话 ──────────────────────────────
// ⛔ 钉 `this.setSetting(`（**调用点**）而非 `setSetting(`（方法定义也会命中 ⇒ 假绿）。
ok(`② 串化写回：serializeRecentWorkDirs（Index.ets:${firstLine('serializeRecentWorkDirs(')}）`,
  count('serializeRecentWorkDirs(') >= 1);
ok(`② 设置写入通道：this.setSetting（Index.ets:${firstLine('this.setSetting(')}）`,
  count('this.setSetting(') >= 1);
ok(`② 应用到会话：set_cwd RPC（Index.ets:${firstLine('RPC_SET_CWD')}）`,
  count('rpc<Object>(store.http, RPC_SET_CWD') >= 1);
ok(`② set_cwd 的 params 构造点（Index.ets:${firstLine('new SetCwdParams(')}）`,
  count('new SetCwdParams(') >= 1);

// ── ④ mutation 自证锚点：服务端键必须与 web `userSettings.ts:44` 逐字一致 ────────
// （改回 localStorage 键 'xbot:recent-workdirs:v1' ⇒ 两端不再共读一份 ⇒ 本断言红）
ok('④ 服务端键 = web 映射目标 web:workspace:recent-workdirs',
  RECENT_WORKDIRS_SERVER_KEY === 'web:workspace:recent-workdirs');

// ── 运行期同源：被消费的模块真的可用（remember → serialize → parse 恒等）──────
{
  let list: string[] = [];
  list = rememberWorkDir(list, '/a');
  list = rememberWorkDir(list, '/b');
  ok('模块可用：remember → serialize → parse 恒等',
    JSON.stringify(parseRecentWorkDirs(serializeRecentWorkDirs(list))) === JSON.stringify(['/b', '/a']));
  ok('模块可用：remove 命中', JSON.stringify(removeWorkDir(list, '/b')) === JSON.stringify(['/a']));
}

if (fail > 0) { console.log(`  recentdirs_ui: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  recentdirs_ui: ${pass} passed, 0 failed`);
process.exit(0);

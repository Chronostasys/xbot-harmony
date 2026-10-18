/**
 * 状态持久化**出路完整性**门禁 —— "该保留的必须真的存得下、也读得回"。
 *
 * 动机：杀进程/切后台回前台后，用户**期望还在的东西**（草稿、当前会话）要是丢了，是最恼人的一类。
 *   本仓的持久化都收敛在 `core/config.ets`（`persistedState` + `getSync`/`putSync`）⇒ **可离线核**：
 *   每个 `KEY_*` 都必须是**成对**的 —— **有读（`getSync`）也得有写（`putSync`）**（反之亦然）。
 *   只写不读 = 存了没用；**只读不写 = 永远读到初值**（"看起来做了持久化，其实每次都是默认值"）。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────────
 *   ① `core/config.ets` 里每个 `KEY_<NAME>` 常量：`getSync(KEY_X` ≥1 **且** `putSync(KEY_X` ≥1。
 *   ② 台账（键 → 读/写计数）打印 + **零扫描判红**（键总数 > 0 ∧ 每个键都真被扫到）。
 *   ③ 台账**只许缩短**（`PERSIST_BUDGET`：键 → 读/写总计数）；新增键必须显式登记。
 *
 * ⚠️ 本判据**不判**"时机对不对"（如"600ms 防抖窗口内被杀 ⇒ 草稿丢"是**时序**问题，见回报里的 spec）。
 * mutation：删掉任一 `putSync(KEY_DRAFT_CHAT, …)`（或任一 `getSync`）⇒ ① 必红。
 *
 * ⚠️ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名（本仓已入库 GOTCHA）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    const n = i + 1 < src.length ? src.charAt(i + 1) : '';
    if (c === '/' && n === '/') {
      while (i < src.length && src.charAt(i) !== '\n') { i++; }
      if (i < src.length) { out += '\n'; i++; }
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src.charAt(i) === '*' && i + 1 < src.length && src.charAt(i + 1) === '/')) {
        if (src.charAt(i) === '\n') { out += '\n'; }
        i++;
      }
      i += 2;
    } else { out += c; i++; }
  }
  return out;
}
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/core/config.ets'))) { return p; }
  }
  return '';
}

/** **台账**（2026-10-11 首次清点；⛔ 只许缩短）：键 → `get`/`put` 计数（口径 = 该键在 config.ets 里的出现次数）。 */
const PERSIST_BUDGET: Map<string, number> = new Map<string, number>([
  ['KEY_SERVERS', 2],      // 服务器列表
  ['KEY_SERVER', 2],       // 当前服务器
  ['KEY_USER', 2],         // 用户
  ['KEY_COOKIE', 2],       // 会话 cookie（自动登录）
  ['KEY_THEME', 3],        // 主题（读 2：初始化 + 同步 / 写 1）
  ['KEY_DRAFT_CHAT', 4],   // `draft_chat_id`：草稿 + "当前会话"（读 1 / 写 1 + saveDraft 内读写）
  ['KEY_DRAFT_TEXT', 2],   // 草稿正文
  // 分类本地镜像（2026-10-12 新增，用户点名「侧边栏要能记忆上次选择的排序」）：
  // 业务真值在服务端 `web:session:category`；本地盘只做**冷启首帧**镜像（服务端值到达后服务端胜）
  // ⇒ 读 1（`init`）/ 写 1（`saveSessionCategory`），共 2。
  ['KEY_SESSION_CATEGORY_LOCAL', 2],
  // 界面语言本地镜像（2026-10-18，用户「切日文后重启侧边栏仍是中文」）：
  // 读 2（`init` + 首帧 `readCachedLocale`）/ 写 1（`saveLocale`）。
  ['KEY_LOCALE_LOCAL', 3],
]);

const root: string = findRoot();
ok('探测到仓库根', root.length > 0);
const cfg: string = stripComments(fs.readFileSync(path.join(root, 'entry/src/main/ets/core/config.ets'), 'utf8'));
ok('扫到 core/config.ets（非空）—— 零扫描判红', cfg.length > 0);

// 收集 KEY_* 常量名
const keys: string[] = [];
const reKey = /(?:const|export const)\s+(KEY_[A-Z0-9_]+)\s*:/g;
let m: RegExpExecArray | null = reKey.exec(cfg);
while (m !== null) { keys.push(m[1]); m = reKey.exec(cfg); }
console.log(`▶ 持久化台账扫描：core/config.ets 共 ${keys.length} 个 KEY_*`);
ok('零扫描判红：找到 ≥1 个 KEY_* 常量', keys.length > 0);

let declared = 0;
const missing: string[] = [];
const undeclared: string[] = [];
for (const k of keys) {
  const reads: number = (cfg.match(new RegExp('getSync\\(\\s*' + k + '\\b', 'g')) || []).length;
  const writes: number = (cfg.match(new RegExp('putSync\\(\\s*' + k + '\\b', 'g')) || []).length;
  console.log(`    · ${k}: 读 ${reads} / 写 ${writes}（台账 ${PERSIST_BUDGET.has(k) ? PERSIST_BUDGET.get(k) : '未登记'}）`);
  if (reads < 1 || writes < 1) { missing.push(`${k}（读 ${reads} / 写 ${writes}）`); }
  if (PERSIST_BUDGET.has(k)) { declared++; } else { undeclared.push(k); }
}

ok('③ 无未登记的持久化键（新增键必须显式登记）', undeclared.length === 0, undeclared.join(', '));
ok('③ 台账里的键都还在（⛔ 只许缩短：删键要同步删台账）', declared === PERSIST_BUDGET.size,
  `台账 ${PERSIST_BUDGET.size} 个 / 命中 ${declared} 个`);
if (missing.length === 0) {
  ok('① 每个持久化键都**成对**（有读也有写 ⇒ 存得下也读得回）', true);
} else {
  for (const v of missing) { ok(`持久化键不成对：${v} —— 只写不读=存了没用；只读不写=永远读到初值`, false); }
}

if (fail > 0) { console.log(`  persistence_roundtrip: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  persistence_roundtrip: ${pass} passed, 0 failed`);
process.exit(0);

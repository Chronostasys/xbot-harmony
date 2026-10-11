/**
 * notify_background —— 后台「极轻量接收 agent 通知」的**源码/接线形态判据**（判别力）。
 *
 * 覆盖目标① 的落地：**workScheduler 延迟任务对账**（`workreconcile/**`）+ **短时任务窗**（A 档）。
 * 为什么读源码而不 import：本面涉及的文件全是 **ArkTS 侧**（`entryability/**`、`workreconcile/**`，
 * 都 `import @ohos.*`）与**配置**（`module.json5`）⇒ 脱机 harness 无法 import，只能做**形态断言**
 * （本仓既有先例：`notify_icon.test.ts` / `notify_group.test.ts`）。
 *
 * ⛔ 铁律（本仓血教训）：**钉"调用点计数"，不钉"方法体存在"**。只断言 `ensureReconcileScheduled`
 *   在源码里"出现过"会**假绿**（它可能只被 import、从未被调用；或调用点被删掉）。这里一律用
 *   `countStr/countRe` 取**精确次数**再等值比较；期待 ≥1 却扫到 0 ⇒ 必红（零扫描判红）。
 *
 * mutation 自证（改坏必红；已实测 —— 注掉/改回两向都验过，见文件尾 §自证）：
 *   ① module.json5 加 `KEEP_BACKGROUND_RUNNING`            ⇒ '零审核类权限' 红
 *   ② EntryAbility 注掉 `ensureReconcileScheduled(this.context);` ⇒ '注册恰 1 处调用' 红
 *   ③ schedule.ets 把 `isPersisted: true` 改 `false`        ⇒ 'isPersisted 恰 1 处' 红
 *   ④ reconcile.ets 改 `RECONCILE_ABILITY` 常量值            ⇒ '扩展名与常量同源' 红
 *   ⑤ reconcile.ets 加 `import … from '@ohos.x'`            ⇒ 'core 无 @ohos import' 红
 *   ⑥ store.ets 注掉 `noteForegroundSeen(...)`              ⇒ '前台侧恰 1 处调用' 红（死消费 #1）
 *   ⑦ memo.ets 注掉 `markSeen(memo, …)`                     ⇒ 'markSeen 恰 1 处真调用' 红（死消费 #1）
 *   ⑧ notify.ets 注掉 `clearAll` 里的 `sessionClearedHook()` ⇒ 'clearAll 真的调了端口' 红（死消费 #2）
 *   ⑨ EntryAbility 注掉 `cancelReconcileScheduled();`        ⇒ 'cancelReconcileScheduled 恰 1 调用点' 红（死消费 #2）
 *   ⑩ EntryAbility 注掉 `setForegroundSeenSink(` 注册        ⇒ '注册恰 1 处' 红
 *
 * ⚠️ 结尾必须 `process.exit(...)`（run.sh 用 `set -e` 顺序跑；不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): {
  readFileSync(p: string, e: string): string;
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean; isFile(): boolean }[];
  statSync(p: string): { isDirectory(): boolean };
};
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const fs = require('fs');
const path = require('path');
// 默认 = 真仓根；`XBOT_BG_ROOT` 仅供**离线 mutation 自证**指向一份改动副本（门禁里不设 ⇒ 不变）。
const ROOT: string = (process.env.XBOT_BG_ROOT !== undefined && process.env.XBOT_BG_ROOT.length > 0)
  ? process.env.XBOT_BG_ROOT
  : path.join(__dirname, '..', '..', '..', '..');

function read(rel: string): string {
  const p = path.join(ROOT, rel);
  return fs.readFileSync(p, 'utf-8'); // ⛔ 读不到 ⇒ 直接抛（红），不做静默兜底
}
/** `read` + 剥注释 —— ⛔ 计数类断言**必须**用它：否则"把调用注释掉"仍会被算进去（假绿）。 */
function readS(rel: string): string {
  return stripComments(read(rel));
}
/** 剥注释（`/* *\/` 与 `//`）——避免"注释里提到函数名"被当成调用点（本仓踩过假报）。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
/** 子串出现次数（零扫描 ⇒ 返回 0，由断言判红）。 */
function countStr(src: string, needle: string): number {
  return src.split(needle).length - 1;
}
/** 正则命中次数。 */
function countRe(src: string, re: RegExp): number {
  const m = src.match(re);
  return m === null ? 0 : m.length;
}
/** 取 a..b 之间的片段（判断"调用是否落在某函数体内"）。 */
function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a);
  if (i < 0) { return ''; }
  const j = src.indexOf(b, i + a.length);
  return j < 0 ? src.substring(i) : src.substring(i, j);
}
/** 递归统计一棵源码树里 needle 的调用点总数（用于"全仓 0 消费方"这类断言）。 */
function grepTree(dirRel: string, needle: string): number {
  const root = path.join(ROOT, dirRel);
  let total = 0;
  const walk = (d: string): void => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) { continue; }
      if (!(e.name.endsWith('.ets') || e.name.endsWith('.ts') || e.name.endsWith('.json5')
        || e.name.endsWith('.json'))) { continue; }
      total += countStr(stripComments(fs.readFileSync(full, 'utf-8')), needle);
    }
  };
  walk(root);
  return total;
}

// ── 载入（全部剥注释）──────────────────────────────────────────────────────
const mod = read('entry/src/main/module.json5');
const entry = stripComments(read('entry/src/main/ets/entryability/EntryAbility.ets'));
const sched = stripComments(read('entry/src/main/ets/workreconcile/schedule.ets'));
const abil = stripComments(read('entry/src/main/ets/workreconcile/NotifyReconcileAbility.ets'));
const rec = stripComments(read('entry/src/main/ets/core/reconcile.ets'));
const notify = stripComments(read('entry/src/main/ets/core/notify.ets'));

// ── (A) 零权限 / 零审核：**不许**偷偷引入审核类权限（决策表 A 档的前提）──────
ok('⛔ module.json5 **不含** KEEP_BACKGROUND_RUNNING（未启用长时任务）',
  mod.indexOf('KEEP_BACKGROUND_RUNNING') < 0);
ok('⛔ module.json5 不含代理提醒权限 PUBLISH_AGENT_REMINDER', mod.indexOf('PUBLISH_AGENT_REMINDER') < 0);
ok('⛔ module.json5 **不含** ability `backgroundModes`（长时任务档位）',
  mod.indexOf('backgroundModes') < 0);
eq('声明权限数 = 3（INTERNET/GET_NETWORK_INFO/VIBRATE；变动即需复核本文件 §决策表）',
  countRe(mod, /ohos\.permission\./g), 3);

// ── (B) workScheduler 注册**真的接线**（调用点计数，防"只 import 不调用"假绿）──
eq('⛔ EntryAbility 里 `ensureReconcileScheduled(` 调用点**恰 1 处**',
  countStr(entry, 'ensureReconcileScheduled('), 1);
eq('`ensureReconcileScheduled` 的 import+调用共 2 处', countStr(entry, 'ensureReconcileScheduled'), 2);
ok('注册落在 `onCreate` 内（不是别处）',
  countStr(between(entry, 'onCreate(', 'onDestroy('), 'ensureReconcileScheduled(') === 1);
ok('注册是旁路（`.catch` 前的直接调用形态，失败不影响启动）',
  between(entry, 'onCreate(', 'onDestroy(').indexOf('ensureReconcileScheduled(this.context)') >= 0);

// ── (C) 扩展声明与常量**同源**（改名漂移 ⇒ 系统找不到扩展 ⇒ 静默失效）───────
const abilityNameM = rec.match(/RECONCILE_ABILITY\s*:\s*string\s*=\s*'([^']+)'/);
const abilityName: string = abilityNameM === null ? '' : abilityNameM[1];
ok('core/reconcile 定义了 RECONCILE_ABILITY 常量', abilityName.length > 0);
ok(`module.json5 扩展名与常量逐字一致（${abilityName}）`,
  abilityName.length > 0 && mod.indexOf(`"name": "${abilityName}"`) >= 0);
ok('扩展 type = workScheduler', /"type"\s*:\s*"workScheduler"/.test(mod));
ok('扩展 srcEntry 指向真实文件（workreconcile/NotifyReconcileAbility.ets）',
  mod.indexOf('./ets/workreconcile/NotifyReconcileAbility.ets') >= 0
  && fs.statSync(path.join(ROOT, 'entry/src/main/ets/workreconcile/NotifyReconcileAbility.ets')).isDirectory() === false);

// ── (D) 纯判定层**不许**引入 SDK（core/ 被 run.sh 当纯 TS 编译）──────────────
eq('⛔ core/reconcile.ets 无 `@ohos.*` import', countRe(rec, /from\s+'@ohos\./g), 0);
eq('⛔ core/reconcile.ets 无 `@kit.*` import', countRe(rec, /from\s+'@kit\./g), 0);
eq('⛔ core/reconcile.ets 无 ArkUI 装饰器（非组件层）',
  countRe(rec, /@(Component|Entry|State|Prop|Builder)\b/g), 0);

// ── (E) 注册参数 = 「重启存活 + 有网才跑」（缺一 ⇒ 后台对账退化为"跑一次就没了"）──
eq('isRepeat: true 恰 1 处（周期任务）', countRe(sched, /isRepeat:\s*true/g), 1);
eq('isPersisted: true 恰 1 处（重启后仍有效）', countRe(sched, /isPersisted:\s*true/g), 1);
eq('networkType 触发条件恰 1 处（对账是只读 HTTP，无网不唤醒）', countRe(sched, /networkType:/g), 1);
eq('`workScheduler.startWork(` 恰 1 处', countStr(sched, 'workScheduler.startWork('), 1);

// ── (F) A 档短时任务仍在线（后台对账是补，不是替）─────────────────────────────
eq('`requestSuspendDelay(` 恰 1 处（短时任务唯一入口）', countStr(notify, 'requestSuspendDelay('), 1);
ok('`endTurnKeepAlive` 在 EntryAbility 有真实消费点（回前台释放）',
  countStr(entry, 'endTurnKeepAlive(') >= 1);

// ── (G) 消费方存在（防门禁 ⑧「core 未消费模块」假绿）─────────────────────────
ok('`reconcileDecision(` 在扩展里有真实消费点', countStr(abil, 'reconcileDecision(') >= 1);
ok('`summarizeMissed(` 在扩展里有真实消费点（文案唯一来源）', countStr(abil, 'summarizeMissed(') >= 1);
ok('`turnKeyOf(` 在扩展里有真实消费点（前台/扩展同源构造）', countStr(abil, 'turnKeyOf(') >= 1);
ok('扩展发通知是**最小合法发布**（不复制 notify.ets 的三形态逻辑）',
  countStr(abil, 'notificationManager.publish(') === 1);

// ── (H) 尊重系统 DND（既有契约的回归哨兵）───────────────────────────────────
eq('⛔ 通知面**全仓不设** bypassDnd（尊重系统免打扰）',
  countStr(notify, 'bypassDnd') + countStr(abil, 'bypassDnd'), 0);

// ── 已知缺口（诚实台账，非硬断言；修好它会自动翻绿）─────────────────────────
// markSeen = "前台亲眼见过的回合"的**唯一记录点**。它若全仓 0 消费 ⇒ 备忘里的
// lastSeenTurnKey 只由扩展自己维护 ⇒ 用户前台读完再切后台，首次对账把**已看过的**回合
// ── (I) 死消费修复 #1：`markSeen` 必须接到**前台**（2026-10-11）─────────────────
// 背景：此前 `markSeen` 全仓 0 消费 ⇒ 备忘的 `lastSeenTurnKey` 只由**后台扩展**维护
// ⇒ 用户前台读完再切后台，首次对账把**已看过**的回合误报成"新消息"（假阳性）。
// 修法：`core/store.ets`（前台，`/api/history` 回来后）→ `core/notify.noteForegroundSeen`
// → 端口 → `workreconcile/memo.markForegroundSeen` → **`markSeen`**。
// ⛔ 钉**调用点计数**：只断言"函数存在"会**假绿**（本仓血教训）。
eq('`markSeen(` 在 workreconcile/memo.ets 里**恰 1 处真调用**（喂 ReconcileMark）',
  countStr(readS('entry/src/main/ets/workreconcile/memo.ets'), 'markSeen(memo,'), 1);
// 全仓计数（含定义）− 定义(1) = 真消费点，必须 ≥1。
ok('⛔ `markSeen` 全仓有 ≥1 个真消费点（>1 定义）', grepTree('entry/src/main/ets', 'markSeen(') - 1 >= 1);
eq('前台侧：store.ets 调用 `noteForegroundSeen(` **恰 1 处**',
  countStr(readS('entry/src/main/ets/core/store.ets'), 'noteForegroundSeen('), 1);
eq('core 侧：`noteForegroundSeen` 定义恰 1 处',
  countStr(notify, 'noteForegroundSeen('), 1);
eq('core 侧：`noteForegroundSeen` 真的调了端口 `foregroundSeenSink(`（非空壳）',
  countStr(notify, 'foregroundSeenSink('), 1);
eq('接线：EntryAbility 注册 `setForegroundSeenSink(` **恰 1 处**',
  countStr(entry, 'setForegroundSeenSink('), 1);
eq('接线：EntryAbility 的 sink 落到 `markForegroundSeen(`（把 last_seq 交给落盘）',
  countStr(entry, 'markForegroundSeen('), 1);
ok('落盘层与扩展**同源取数**（`turnKeyOf` + `/api/history` 的 `last_seq`）',
  countStr(readS('entry/src/main/ets/workreconcile/memo.ets'), 'turnKeyOf(') >= 1
  && countStr(readS('entry/src/main/ets/core/store.ets'), 'data.last_seq') >= 1);

// ── (J) 死消费修复 #2：`cancelReconcileScheduled` 必须接**登出/清场**（2026-10-11）──
// 背景：此前全仓 0 调用 ⇒ 登出后后台对账仍带着旧会话空跑（读不到 cookie 只是静默跳过）。
// 修法：`core/notify.clearAll`（"整机清场"既有出口，`store.ets` 在 401 时调它）
// → 端口 `sessionClearedHook()` → `workreconcile/schedule.cancelReconcileScheduled`。
eq('⛔ `cancelReconcileScheduled` 全仓有 **恰 2** 个真调用点（合计 3 − 定义 1）：EntryAbility（清场钩子）+ 显式登出',
  grepTree('entry/src/main/ets', 'cancelReconcileScheduled(') - 1, 2);
eq('接线：EntryAbility 在清场钩子里调 `cancelReconcileScheduled();` **恰 1 处**',
  countStr(entry, 'cancelReconcileScheduled();'), 1);
// 显式登出（`doLogout`）**不调** `clearAll` ⇒ 那条路径不被清场钩子覆盖 ⇒ 必须自己调一次（`00fd338` 补的最后一环）
eq('接线：`pages/Index.ets` 的 `doLogout` 也调 **恰 1 处**（显式登出不受 `clearAll` 覆盖）',
  countStr(readS('entry/src/main/ets/pages/Index.ets'), 'cancelReconcileScheduled();'), 1);
eq('接线：EntryAbility 注册 `setSessionClearedHook(` **恰 1 处**',
  countStr(entry, 'setSessionClearedHook('), 1);
eq('core 侧：`clearAll` 真的调了端口 `sessionClearedHook()`（非空壳）',
  countStr(notify, 'sessionClearedHook()'), 1);
ok('端口调用落在 `clearAll` 函数体内（不是别处）',
  countStr(between(notify, 'export async function clearAll(', 'export async function clearForChat('),
    'sessionClearedHook()') === 1);
eq('清场出口 `clearAll` 仍有真实调用方（store.ets）',
  countStr(readS('entry/src/main/ets/core/store.ets'), 'clearAll('), 1);

if (fail > 0) { console.log(`  notify_background: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify_background: ${pass} passed, 0 failed`);
process.exit(0);
export {};

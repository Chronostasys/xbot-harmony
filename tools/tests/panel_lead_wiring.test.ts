/**
 * 面板行**前导字形**接线门禁 —— 钉住 `LEAD_CRON` 的**消费点计数**（而不是"常量存在"）。
 *
 * ── 背景（2026-10-13 有数据态装机实测）─────────────────────────────────────────────
 *   有数据后对比 web 权威 `TasksPanel.tsx:101-182`：cron 行**常驻** `<AlarmClock>` 前导图标
 *   （`text-text-secondary`），而后台任务行是**随状态变形**的状态字形。本仓定时行**没有**传
 *   `lead` ⇒ `PanelRowCard` 的前导槽空着 ⇒ ① 少了 web 的 ⏰；② 因为前导槽是**固定槽宽**，
 *   两个页签的文字基线不齐（跨页签切换时文字会整体横移）。
 *
 * ── 为什么必须钉"消费点计数"（⛔ 本仓已抓到 3 例"死消费"缺陷）────────────────────
 *   `LEAD_CRON` 是纯常量：**定义了但没人用** ⇒ 形式上是"已修复"，运行时页面毫无变化
 *   （本仓同类前科：`withAccent`、`applyNotifyPrefs`、`reasoningopen`）。所以判据必须数到
 *   ① 核心导出 ② 组件内映射到 SymbolGlyph ③ **页面在 cron 行的入参处**真的传了它 —— 三者缺一即红。
 *
 * ✅ 判据自证（mutation，已实测）：删掉 `Index.ets` 的 `lead: LEAD_CRON` ⇒ ③ 红；
 *    删掉 `PanelRows.ets` 的 `this.lead === LEAD_CRON` 分支 ⇒ ② 红；还原 ⇒ 全绿。
 * ⚠️ 纪律：剥注释；计数精确；**并检查两处在同一个对象字面量窗口内**（避免"传在别的行上"假绿）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

// ⛔ 标记为模块（顶层变量不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function eq(name: string, got: number, want: number): void {
  if (got === want) { pass++; console.log(`  ✅ ${name}（${got}）`); }
  else { fail++; console.log(`  ❌ ${name}（期望 ${want}，实得 ${got}）`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name}`); }
}

const REPO: string = path.resolve(__dirname, '../../../..');
function readSrc(rel: string): string {
  const raw: string = fs.readFileSync(path.join(REPO, rel), 'utf8');
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
function count(s: string, needle: string): number {
  return s.split(needle).length - 1;
}

const panels: string = readSrc('entry/src/main/ets/core/panels.ets');
const rows: string = readSrc('entry/src/main/ets/components/PanelRows.ets');
const idx: string = readSrc('entry/src/main/ets/pages/Index.ets');

// ── ① 零扫描判红：三文件都真读到 ────────────────────────────────────────────
// ⚠️ 阈值按**剥注释后**的真实规模留 ~25% 余量（⛔ 不给实现让步；本仓同类假红已出现两次：
//    先拍 20000/8000，实际 16104/5829 —— 记入 `docs/WEB-ALIGNMENT.md` 的判据自身缺陷清单）。
ok('① core/panels.ets 读到', panels.length > 12000);
ok('① PanelRows.ets 读到', rows.length > 4000);
ok('① Index.ets 读到', idx.length > 100000);

// ── ② 核心：LEAD_CRON 定义恰 1 处，且与状态码互不相等 ────────────────────────
eq('② core 导出 LEAD_CRON 恰 1 处', count(panels, "export const LEAD_CRON: string = 'cron'"), 1);

// ── ③ 组件：确实把 LEAD_CRON 映射到一个 SymbolGlyph ─────────────────────────
eq('③ PanelRows 消费 LEAD_CRON 恰 1 处', count(rows, 'this.lead === LEAD_CRON'), 1);
{
  // 该分支体里必须出现 SymbolGlyph（形随语义：码 → 字形），且用**已实证**的符号名
  const i: number = rows.indexOf('this.lead === LEAD_CRON');
  const win: string = i >= 0 ? rows.substring(i, i + 320) : '';
  ok('③ 该分支体含 SymbolGlyph', win.indexOf('SymbolGlyph(') >= 0);
  ok("③ 该分支体用已实证符号 `clock`", win.indexOf("sys.symbol.clock") >= 0);
}

// ── ④ 页面：**cron 行**真的传入 lead（两处在同一对象字面量窗口内 ⇒ 未张冠李戴）
eq('④ Index 传 lead: LEAD_CRON 恰 1 处', count(idx, 'lead: LEAD_CRON'), 1);
{
  const iLead: number = idx.indexOf('lead: LEAD_CRON');
  const iCron: number = idx.indexOf('primary: cronPrimary(job)');
  eq('④ cron 行 primary 恰 1 处', count(idx, 'primary: cronPrimary(job)'), 1);
  ok('④ lead 与 cron 行的 primary 同一个对象字面量（≤400 字符窗口）',
    iLead >= 0 && iCron >= 0 && Math.abs(iLead - iCron) <= 400);
}
// 后台任务行不许被误改成 cron 的静态字形（它必须是**状态**码 ⇒ 随状态变形）
eq('④ 后台行仍用状态码 bgTaskLeadCode', count(idx, 'lead: bgTaskLeadCode(t)'), 1);

console.log(`  panel_lead_wiring: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

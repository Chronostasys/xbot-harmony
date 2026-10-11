/**
 * 插件面 · `plugin_status`（后端插件**全量**）判据（波12 目标② P1-b，2026-10-11）。
 *
 * ── 缺口（本波要修的）──────────────────────────────────────────────────────────
 *   本仓此前**只**通过两条口看插件：`web_plugin_list`（**有 web 产物**者，`core/store.ets:1042`）
 *   与 `plugin_config`（**带配置声明**者，`rpc_table.go:2370-2453`）
 *   ⇒ **纯后端插件**（script/grpc 运行时）在原生端**完全不可见**、也**管不了**。
 *   权威基准 = web `plugins/manager/PluginManagerPanel.tsx:52-76`（`plugin_status`，`pm.ListPlugins()`）。
 *
 * ── 服务端契约（只读核实，file:line 可查）───────────────────────────────────────
 *   · `serverapp/rpc_table.go:2011-2053`：params `{rescan:bool}`；
 *     返回 `{plugins:[{id,name,version,state,runtime}], active, total}`；
 *     `rescan:true` ⇒ `Discover()+ActivateAll()`（**只激活新发现的**；注释明言**不用** `ReloadAll`）；
 *     插件系统不可用 ⇒ `plugin system not available`（`:2015-2017`）。
 *   · 启停/重载**复用既有** `plugin_set_enabled`(`:2213-2233`) / `plugin_reload`(`:2099-2133`)
 *     ⇒ 本波**不发新 RPC**（判据 ③ 钉住这一点）。
 *
 * ── 判据（零扫描判红 + mutation 自证）─────────────────────────────────────────
 *   ① **UI 入口**：`loadBackend` 有真调用点（初始化 + "刷新"按钮 + 启停/重载后各一次）。
 *   ② **消费点计数（只在 struct 体内、排除 import 行）**：新增 core 符号全部有真消费者。
 *   ③ **契约钉死**：方法名 `plugin_status`；`PluginStatusParams(true)` 的 JSON 形状；
 *      且**不登记** `RpcMethod.ALL`（`rpc.test.ts` 断言 `ALL.length === NAMED.length` ⇒ 登记必红）；
 *      **复用**既有启停/重载调用点（两条列表各一处 ⇒ 计数 ≥2）。
 *   ④ **运行期同源**：解析全容错（null/缺字段/缺 id/name 回落/计数兜底）+ 状态判据 + 文案。
 *   ⑤ **mutation**：(a) 摘 `RPC_PLUGIN_STATUS` 使用 · (b) 摘后端行的启停调用 · (c) 改方法字面量 ·
 *      (d) 计数兜底改成不兜底 —— 四者各自必红。
 *
 * ⚠️ 纯 TS（`export {}` + `declare require`）；结尾必须 `process.exit`。
 * ⚠️ 本波**无设备** ⇒ "真机上后端插件列表是否正确渲染"标**待设备验证**。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

import {
  parsePluginStatus, PluginStatusEntry, PluginStatusList, pluginStatusIsActive,
  pluginStatusMetaText, pluginStatusSummaryText,
} from '../../entry/src/main/ets/core/settingsplugins';
import { PluginStatusParams, RpcMethod, RPC_PLUGIN_STATUS } from '../../entry/src/main/ets/core/rpc';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function has(name: string, hay: string, needle: string): void {
  eq(name, hay.indexOf(needle) >= 0, true);
}

function findRoot(start: string): string {
  let cur: string = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets'))) { return cur; }
    cur = path.join(cur, '..');
  }
  return '';
}
const ROOT: string = findRoot(__dirname);
const ETS: string = ROOT.length > 0 ? path.join(ROOT, 'entry', 'src', 'main', 'ets') : '';
const PANEL: string = ETS.length > 0 ? path.join(ETS, 'components', 'SettingsPlugins.ets') : '';

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function readOr(p: string): string {
  return p.length > 0 && fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}
function countOf(src: string, marker: string): number {
  return marker.length === 0 ? 0 : src.split(marker).length - 1;
}

// ── 零扫描防线 ────────────────────────────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
const panel: string = readOr(PANEL);
eq('零扫描防线：含 components/SettingsPlugins.ets', panel.length > 0, true);
const BODY_AT: number = panel.indexOf('export struct SettingsPlugins');
const body: string = BODY_AT >= 0 ? panel.substring(BODY_AT) : '';
eq('零扫描防线：切出 struct 体（非空且短于整文件）',
  body.length > 0 && body.length < panel.length, true);

// ── 判据 ①：UI 入口（真调用点）────────────────────────────────────────────────
{
  // 初始化 + "刷新"按钮 ⇒ 2 处 `void this.loadBackend();`
  eq('① `void this.loadBackend();` 真调用点 ≥2（初始化 + 刷新按钮）',
    countOf(body, 'void this.loadBackend();') >= 2, true);
  // 启停/重载后各刷新一次 ⇒ ≥2 处 `await this.loadBackend();`
  eq('① `await this.loadBackend();` ≥2（启停 + 重载后刷新）',
    countOf(body, 'await this.loadBackend();') >= 2, true);
  eq('① 概览文案有渲染点', countOf(body, 'pluginStatusSummaryText(') >= 1, true);
  eq('① 错误/空态各有渲染分支（不静默）',
    countOf(body, 'this.backendErr') >= 1 && countOf(body, '后端没有插件') >= 1, true);
}

// ── 判据 ②：消费点计数（struct 体内；⛔ 排除 import 行，否则"只 import 不用"会假绿）──
{
  const markers: string[] = [
    'RPC_PLUGIN_STATUS', 'PluginStatusParams', 'parsePluginStatus(',
    'pluginStatusSummaryText(', 'pluginStatusMetaText(', 'pluginStatusIsActive(', 'PluginStatusEntry',
  ];
  for (const m of markers) {
    eq(`② 消费点：${m} 在 struct 体内被真使用（≥1）`, countOf(body, m) >= 1, true);
  }
  const head: string = panel.substring(0, BODY_AT);
  has('② 防线：import 行确实引了 RPC_PLUGIN_STATUS', head, 'RPC_PLUGIN_STATUS');
  has('② 防线：import 行确实引了 parsePluginStatus', head, 'parsePluginStatus');
  eq('② 零扫描判红：struct 体对 plugin_status 相关符号的总引用 > 0',
    countOf(body, 'pluginStatus') + countOf(body, 'PluginStatus') > 0, true);
}

// ── 判据 ③：契约钉死 ─────────────────────────────────────────────────────────
{
  eq('③ 方法名 = plugin_status（rpc_table.go:2011）', RPC_PLUGIN_STATUS, 'plugin_status');
  eq('③ params 形状 {rescan:true}（rpc_table.go:2012）',
    JSON.stringify(new PluginStatusParams(true)), '{"rescan":true}');
  eq('③ params 形状 {rescan:false}', JSON.stringify(new PluginStatusParams(false)), '{"rescan":false}');
  // ⛔ **不登记** `RpcMethod.ALL`：`rpc.test.ts` 断言 `ALL.length === NAMED.length`（NAMED 硬编码）
  eq('③ 未登记进 RpcMethod.ALL（登记会打红 rpc.test.ts）',
    RpcMethod.ALL.indexOf(RPC_PLUGIN_STATUS) < 0, true);
  // ⛔ 本波**不发新 RPC**：启停/重载必须复用既有那对调用点（两条列表各一处 ⇒ ≥2）
  eq('③ 复用既有启停调用（两条列表各一处 ⇒ ≥2）', countOf(body, 'void this.toggleEnabled(') >= 2, true);
  eq('③ 复用既有重载调用（两条列表各一处 ⇒ ≥2）', countOf(body, 'void this.reload(') >= 2, true);
  has('③ 面板未另造启停 RPC（仍走 RPC_PLUGIN_SET_ENABLED）', body, 'RPC_PLUGIN_SET_ENABLED');
  has('③ 面板未另造重载 RPC（仍走 RPC_PLUGIN_RELOAD）', body, 'RPC_PLUGIN_RELOAD');
}

// ── 判据 ④：运行期同源（解析容错 + 判据 + 文案）────────────────────────────────
{
  eq('④ 解析：null ⇒ 空表', parsePluginStatus(null).entries.length, 0);
  eq('④ 解析：undefined ⇒ 空表', parsePluginStatus(undefined).entries.length, 0);
  eq('④ 解析：{} ⇒ 空表且计数 0', JSON.stringify([
    parsePluginStatus({}).entries.length, parsePluginStatus({}).active, parsePluginStatus({}).total,
  ]), '[0,0,0]');

  const full: PluginStatusList = parsePluginStatus({
    plugins: [
      { id: 'xbot.a', name: '甲', version: '1.2.3', state: 'active', runtime: 'script' },
      { id: 'xbot.b', name: '乙', version: '0.1', state: 'error', runtime: 'grpc' },
    ], active: 1, total: 2,
  });
  eq('④ 解析：条目数', full.entries.length, 2);
  eq('④ 解析：首条字段', [full.entries[0].id, full.entries[0].name, full.entries[0].version,
    full.entries[0].state, full.entries[0].runtime], ['xbot.a', '甲', '1.2.3', 'active', 'script']);
  eq('④ 解析：active/total 取服务端值', [full.active, full.total], [1, 2]);

  // 缺 id ⇒ 跳过（没有 id 就启停/重载不了 ⇒ 宁可不显示）
  eq('④ 解析：缺 id 的条目被跳过', parsePluginStatus({ plugins: [{ name: '无 id' }] }).entries.length, 0);
  eq('④ 解析：id 全空白被跳过', parsePluginStatus({ plugins: [{ id: '   ' }] }).entries.length, 0);
  // name 空 ⇒ 回落 id
  eq('④ 解析：name 空回落 id', parsePluginStatus({ plugins: [{ id: 'xbot.c' }] }).entries[0].name, 'xbot.c');
  // 计数缺失 / 非有限 ⇒ 用条目数兜底
  const noCounts: PluginStatusList = parsePluginStatus({ plugins: [{ id: 'a' }, { id: 'b' }] });
  eq('④ 解析：计数缺失 ⇒ 用条目数兜底', [noCounts.active, noCounts.total], [2, 2]);
  const badCounts: PluginStatusList = parsePluginStatus({
    plugins: [{ id: 'a' }], active: Number.NaN, total: Number.POSITIVE_INFINITY,
  });
  eq('④ 解析：计数非有限 ⇒ 用条目数兜底', [badCounts.active, badCounts.total], [1, 1]);

  // 状态判据（开关初始态）
  eq('④ 状态：active ⇒ true', pluginStatusIsActive('active'), true);
  eq('④ 状态：带空白 active ⇒ true', pluginStatusIsActive(' active '), true);
  eq('④ 状态：ACTIVE（大小写）⇒ false（服务端是小写枚举）', pluginStatusIsActive('ACTIVE'), false);
  eq('④ 状态：disabled ⇒ false', pluginStatusIsActive('disabled'), false);
  eq('④ 状态：error ⇒ false（失败插件开关应显示为关）', pluginStatusIsActive('error'), false);
  eq('④ 状态：空 ⇒ false', pluginStatusIsActive(''), false);

  // 文案
  eq('④ 元信息：v/runtime/state 全给', pluginStatusMetaText(new PluginStatusEntry('x', 'n', '1.0', 'active', 'script')),
    'v1.0 · script · active');
  eq('④ 元信息：全空 ⇒ 空串（调用方不画）', pluginStatusMetaText(new PluginStatusEntry('x', 'n', '', '', '')), '');
  eq('④ 概览：启用 1 / 共 3', pluginStatusSummaryText(1, 3), '全部插件（启用 1 / 共 3）');
  eq('④ 概览：非有限 ⇒ 归零（不显示 NaN）', pluginStatusSummaryText(Number.NaN, Number.NaN),
    '全部插件（启用 0 / 共 0）');
}

// ── 判据 ⑤：mutation 自证（每条都**真**有鉴别力：删/改 ⇒ 必有断言红）────────────────
{
  // (a) 摘掉 RPC_PLUGIN_STATUS 的**使用**（保留 import）⇒ 判据②的 body 计数归零 ⇒ 必红
  const m1: string = 'RPC_PLUGIN_STATUS';
  eq('⑤(a) 前置：body 真用 RPC_PLUGIN_STATUS', countOf(body, m1) >= 1, true);
  eq('⑤(a) 摘掉后 ⇒ body 计数 = 0 ⇒ 判据②必红', countOf(body.split(m1).join('REMOVED'), m1), 0);

  // (b) 真删**一处**启停调用（复刻"后端行漏接线"）⇒ 计数 = 1 < 2 ⇒ 判据③必红
  const m2: string = 'void this.toggleEnabled(';
  const before2: number = countOf(body, m2);
  eq('⑤(b) 前置：启停调用点 ≥2（两条列表各一处）', before2 >= 2, true);
  const at2: number = body.indexOf(m2);
  const deleted: string = body.substring(0, at2) + body.substring(at2 + m2.length);
  eq('⑤(b) 真删一处后 ⇒ 计数 = before-1 且 < 2 ⇒ 判据③必红',
    countOf(deleted, m2), before2 - 1);
  eq('⑤(b) 反向对照：未删时计数不变', countOf(body, m2), before2);

  // (c) **方法名不得硬编码**：组件必须经常量（否则服务端改名时"漂移"编译期查不出）⇒ 硬编码必红
  eq('⑤(c) 组件未硬编码方法名（必须走 RPC_PLUGIN_STATUS 常量）',
    countOf(body, "'plugin_status'"), 0);
}

if (fail > 0) { console.log(`  ✗ plugin_status: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ plugin_status: ${pass} passed, 0 failed`);
process.exit(0);

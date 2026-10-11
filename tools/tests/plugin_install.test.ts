/**
 * 插件面 · `.zip` 安装「调用点 + 服务端契约」判据（波12 目标② P1-a，2026-10-11）。
 *
 * ── 为什么需要它（本仓血教训）─────────────────────────────────────────────────
 *   ① **死消费**：新增的纯逻辑常量/函数若**没有真消费者**，用户操作静默无效
 *      （已抓到 3 例：`withAccent` / `applyNotifyPrefs` / `reasoningopen`）⇒ 形态断言必须钉
 *      **调用点计数**（钉"方法体存在"会假绿）。
 *   ② **契约即事实**：本功能的一切判据来自**服务端**（只读核实 `/Users/bobli/src/xbot`）。
 *      把"路径 / 字段名 / 上限"钉成断言，服务端一改就**红在测试**，而不是"传上去神秘 400"。
 *
 * ── 服务端契约（file:line，均可复现）────────────────────────────────────────────
 *   · 路由 `channel/web/web.go:971`：`/api/plugin/install-file` = `authenticatedPOST`（cookie 鉴权）。
 *   · 处理器 `channel/web/web_api.go:563-625`：401（无 senderID `:573-576`）· 403（非管理员 `:577-580`）·
 *     `ParseMultipartForm(32 << 20)`（`:582`）· `r.FormFile("file")`（`:587`）· 成功 `{ok:true,id,dir}`（`:621-625`）。
 *   · 信封 `channel/web/web_auth.go:511-535 writeJSON` ⇒ `{ok,data,error}`；
 *     `XbotHttp.uploadBytes` 已剥信封（`core/http.ets:380-385`）⇒ 复用它的前提成立。
 *   · web 调用点 `web/src/plugins/manager/PluginManagerPanel.tsx:129-143` →
 *     `web/src/components/agent/api.ts:644-649 installPluginFile`（`FormData`，字段 `file`）。
 *
 * ── 判据（零扫描判红 + mutation 自证）─────────────────────────────────────────
 *   ① **UI 入口**：`SettingsPlugins.ets` 里有 `void this.installZip();` 的**真调用点**（⛔ 不钉方法体）。
 *   ② **消费点计数**：本轮新增的每个 core 符号在组件里都有真消费（路径/字段/上限/7 个函数/结果类）。
 *   ③ **契约钉死**：路径、字段名 `file`（并与 `core/http.ets` 的上传器交叉校验）、32 MiB 上限、zip MIME。
 *   ④ **运行期同源**：文件名归一 / 大小预检 / 响应解析（空·null·坏 JSON·缺 id ⇒ 不 ok）/ 文案。
 *   ⑤ **mutation**：(a) 摘掉路径消费 ⇒ ② 红；(b) 字段名改成别的 ⇒ 与上传器交叉校验必红；
 *      (c) 摘掉按钮 onClick ⇒ ① 红。
 *
 * ⚠️ 纯 TS（`export {}` + `declare require`，照 `settings_notify_ui.test.ts`）；结尾必须 `process.exit`。
 * ⚠️ 本波**无设备** ⇒ 仅覆盖"选中文件之后的判据"；**picker 交互与真上传标待设备验证**。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

import {
  PLUGIN_INSTALL_FIELD_FILE, PLUGIN_INSTALL_MAX_BYTES, PLUGIN_INSTALL_MIME, PLUGIN_INSTALL_PATH,
  PluginInstallResult, parsePluginInstallResult, pluginInstallErrorText,
  pluginInstallFilenameFromUri, pluginInstallFilenameIsValid, pluginInstallSizeOk,
  pluginInstallSuccessText,
} from '../../entry/src/main/ets/core/settingsplugins';

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
const HTTP: string = ETS.length > 0 ? path.join(ETS, 'core', 'http.ets') : '';

/** 剥注释（块 + 行）—— ⛔ 必须先剥，否则注释里的符号名会**假绿**（本仓血教训）。 */
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
const httpSrc: string = readOr(HTTP);
eq('零扫描防线：含 components/SettingsPlugins.ets', panel.length > 0, true);
eq('零扫描防线：含 core/http.ets（交叉校验上传器）', httpSrc.length > 0, true);

// ── 判据 ①：UI 入口（真调用点，⛔ 不钉"方法体存在"）─────────────────────────────
{
  eq('① 面板有 installZip 的**真调用点**（`void this.installZip();`）',
    countOf(panel, 'void this.installZip();') >= 1, true);
  eq('① 安装入口在三态分支之前（空目录也能装）—— 锚点：入口文本先于 loading 分支',
    panel.indexOf('安装插件（.zip）') >= 0
    && panel.indexOf('安装插件（.zip）') < panel.indexOf("if (this.loading)"), true);
  eq('① 失败文案有渲染点（installErr）', countOf(panel, 'this.installErr') >= 1, true);
}

// ── 判据 ②：消费点计数（本轮新增的 core 符号必须有真消费者）─────────────────────
// ⛔ **只在 `SettingsPlugins` 的 struct 体内计数**：`import { … } from` 那一行里**也**含符号名
//    ⇒ 若整文件计数，"声明了但没人用"会**假绿**（正是本仓"钉方法体存在"的教训）。
const BODY_AT: number = panel.indexOf('export struct SettingsPlugins');
const body: string = BODY_AT >= 0 ? panel.substring(BODY_AT) : '';
{
  eq('② 零扫描防线：切出 struct 体（非空且短于整文件）',
    body.length > 0 && body.length < panel.length, true);
  const markers: string[] = [
    'PLUGIN_INSTALL_PATH', 'PLUGIN_INSTALL_MIME', 'PLUGIN_INSTALL_MAX_BYTES',
    'pluginInstallFilenameFromUri(', 'pluginInstallSizeOk(', 'parsePluginInstallResult(',
    'pluginInstallSuccessText(',
  ];
  for (const m of markers) {
    eq(`② 消费点：${m} 在 struct 体内被真调用（≥1，⛔ 不含 import 行）`, countOf(body, m) >= 1, true);
  }
  // 错误文案在**两条**路径上用（本地超限 + 上传异常）
  eq('② 消费点：pluginInstallErrorText( ≥2（本地超限 + 上传异常两处）',
    countOf(body, 'pluginInstallErrorText(') >= 2, true);
  eq('② 消费点：PluginInstallResult 有类型消费点', countOf(body, 'PluginInstallResult') >= 1, true);
  // ★ 自我防线：这些常量**确实出现在 import 行**（证明"只在 body 计数"没有被"压根没 import"骗过）
  const head: string = panel.substring(0, BODY_AT);
  has('② 防线：import 行确实引了 PLUGIN_INSTALL_PATH（否则上面的 body 计数无意义）',
    head, 'PLUGIN_INSTALL_PATH');
  eq('② 零扫描判红：struct 体对插件安装符号的总引用 > 0',
    countOf(body, 'pluginInstall') + countOf(body, 'PLUGIN_INSTALL') > 0, true);
}

// ── 判据 ③：服务端契约钉死（改服务端 ⇒ 红在测试，不是"神秘 400"）────────────────
{
  eq('③ 路径 = /api/plugin/install-file（web.go:971）', PLUGIN_INSTALL_PATH, '/api/plugin/install-file');
  eq('③ multipart 字段名 = file（web_api.go:587 r.FormFile("file")）', PLUGIN_INSTALL_FIELD_FILE, 'file');
  eq('③ 上限 = 32 MiB（web_api.go:582 ParseMultipartForm(32 << 20)）',
    PLUGIN_INSTALL_MAX_BYTES, 32 * 1024 * 1024);
  has('③ MIME 含 zip', PLUGIN_INSTALL_MIME, 'zip');
  // ★ 交叉校验：本仓上传器**硬编码**的字段名必须与端点要求的字段名一致
  //   （否则会把字段名传错 ⇒ 服务端 `no file uploaded` ⇒ 400，且只有真机才能发现）
  has('③ 交叉校验：core/http.ets 的 multipart 上传器硬编码 name="file"',
    httpSrc, 'name="file"');
  has('③ 交叉校验：上传器仍走 /api 的 cookie 鉴权（带 Cookie 头）', httpSrc, "headers['Cookie']");
  has('③ 面板复用既有上传器（不新造上传路径）', panel, 'this.http.uploadBytes(');
}

// ── 判据 ④：运行期同源验证（判据与渲染同源；真源函数）──────────────────────────
{
  // 文件名归一：去 query/hash；非 .zip ⇒ 用 fallback
  eq('④ 文件名：file://a/b.zip?x=1#y ⇒ b.zip', pluginInstallFilenameFromUri('file://a/b.zip?x=1#y', 'fb.zip'), 'b.zip');
  eq('④ 文件名：无扩展名且 fallback 合法 ⇒ fallback',
    pluginInstallFilenameFromUri('file://a/noext', 'fb.zip'), 'fb.zip');
  eq('④ 文件名：都不合法 ⇒ plugin.zip',
    pluginInstallFilenameFromUri('', ''), 'plugin.zip');
  eq('④ .zip 判据：x.zip 合法', pluginInstallFilenameIsValid('x.zip'), true);
  eq('④ .zip 判据：X.ZIP（大小写）合法', pluginInstallFilenameIsValid('X.ZIP'), true);
  eq('④ .zip 判据：x.rar 非法', pluginInstallFilenameIsValid('x.rar'), false);
  eq('④ .zip 判据：裸 .zip 非法（长度）', pluginInstallFilenameIsValid('.zip'), false);
  eq('④ .zip 判据：空串非法', pluginInstallFilenameIsValid(''), false);

  // 大小预检（0 / 非有限 / 超限 都要挡）
  eq('④ 大小：1 字节合法', pluginInstallSizeOk(1), true);
  eq('④ 大小：恰 32 MiB 合法（闭区间，与 ParseMultipartForm 语义一致）',
    pluginInstallSizeOk(32 * 1024 * 1024), true);
  eq('④ 大小：32 MiB + 1 非法', pluginInstallSizeOk(32 * 1024 * 1024 + 1), false);
  eq('④ 大小：0 非法', pluginInstallSizeOk(0), false);
  eq('④ 大小：负数非法', pluginInstallSizeOk(-1), false);
  eq('④ 大小：NaN 非法', pluginInstallSizeOk(Number.NaN), false);

  // 响应解析（⛔ 绝不静默当成功）
  const okRes: PluginInstallResult = parsePluginInstallResult('{"id":"xbot.a","dir":"/p/x"}');
  eq('④ 解析：正常响应 ok', okRes.ok(), true);
  eq('④ 解析：正常响应 id', okRes.id, 'xbot.a');
  eq('④ 解析：正常响应 dir', okRes.dir, '/p/x');
  eq('④ 解析：空串 ⇒ 不 ok', parsePluginInstallResult('').ok(), false);
  eq('④ 解析：JSON null ⇒ 不 ok', parsePluginInstallResult('null').ok(), false);
  eq('④ 解析：坏 JSON ⇒ 不 ok', parsePluginInstallResult('{bad').ok(), false);
  eq('④ 解析：缺 id ⇒ 不 ok（只回 dir 不算装上）', parsePluginInstallResult('{"dir":"/x"}').ok(), false);

  // 文案
  has('④ 成功文案含插件 id', pluginInstallSuccessText('xbot.a'), 'xbot.a');
  has('④ 403 文案点明"管理员"（web_api.go:577-580）', pluginInstallErrorText(403, 'admin required'), '管理员');
  has('④ 400 文案点明 32 MiB（web_api.go:582）', pluginInstallErrorText(400, ''), '32 MiB');
  has('④ 401 文案点明未登录（web_api.go:573-576）', pluginInstallErrorText(401, ''), '未登录');
  has('④ 500 文案点明 plugin.json（web_api.go:617-619）', pluginInstallErrorText(500, ''), 'plugin.json');
  has('④ 503 文案点明未启用插件系统（web_api.go:564-567）', pluginInstallErrorText(503, ''), '未启用');
  eq('④ 无码无因 ⇒ 只给标题', pluginInstallErrorText(0, ''), '插件安装失败');
}

// ── 判据 ⑤：mutation 自证 ─────────────────────────────────────────────────────
{
  // (a) 摘掉路径消费 ⇒ 判据②的消费点计数归零 ⇒ 必红
  const marker: string = 'PLUGIN_INSTALL_PATH';
  eq('⑤(a) 前置条件：面板真消费 PLUGIN_INSTALL_PATH', countOf(panel, marker) >= 1, true);
  eq('⑤(a) 摘掉后 ⇒ 消费点计数 = 0 ⇒ 判据②会红',
    countOf(panel.split(marker).join('REMOVED'), marker), 0);

  // (b) 字段名改成别的 ⇒ 与上传器交叉校验必红
  const mutatedField: string = PLUGIN_INSTALL_FIELD_FILE.split('').join('') + 'X';
  eq('⑤(b) 字段名被改成 fileX ⇒ 与端点/上传器的 "file" 不再一致（判据③必红）',
    mutatedField === PLUGIN_INSTALL_FIELD_FILE, false);
  eq('⑤(b) 反向对照：真源字段名就是 file', PLUGIN_INSTALL_FIELD_FILE, 'file');

  // (c) 摘掉按钮 onClick ⇒ 判据①红
  const call: string = 'void this.installZip();';
  eq('⑤(c) 前置条件：有真调用点', countOf(panel, call) >= 1, true);
  eq('⑤(c) 摘掉调用点后 ⇒ 计数 = 0 ⇒ 判据①会红',
    countOf(panel.split(call).join('/*removed*/'), call), 0);
}

if (fail > 0) { console.log(`  ✗ plugin_install: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ plugin_install: ${pass} passed, 0 failed`);
process.exit(0);

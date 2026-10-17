/**
 * git_panel —— **原生 Git 面板**（web 内置插件 `xbot.git-fancy` 的落地）接线门禁
 * （2026-10-13，目标④「插件都打不开」）。
 *
 * ── 病根（跨仓取证）──────────────────────────────────────────────────────────────
 * 抽屉「插件」里点 `Git 面板` 落到**通用 Web UI 根页**（聊天页）而不是插件面板：web 侧插件 view
 * **没有静态 URL 入口**（`usePluginViewPanels.ts:36`「只能经 ctx.ui.openViewTab」）；而原生壳
 * 没有 React 宿主 ⇒ 深链不可达。⇒ 唯一合法路线 = 原生化（先例：会话统计 / 技能管理）。
 *
 * ── 判据（钉**调用点**，不是"存在就行"）────────────────────────────────────────────
 *   ① 插件行**确实**按 id 分流到原生面板（只钉 `openGitPanel` 存在 ⇒ 漏掉"点行还是塞 webview"）；
 *   ② wire 格式：含点号的方法**必须**经 `RPC_WEB_PLUGIN` 包一层（⛔ 直接当外层 method ⇒
 *     服务端 `unknown RPC method`，已实测），且**不得**散落插件 id 字面量；
 *   ③ 取数每个字段都过 `core/gitpanel.ets` 的纯函数（解析/格式化同源）；
 *   ④ 面板是真门控 + 组件恰 1 处消费 + **绘制顺序在 `PanelsSheet()` 之后**（15z13 教训）；
 *   ⑤ 返回键先于浮层栈；抽屉互斥收口已登记；
 *   ⑥ 组件侧：真 `@Component`（⛔ 不用带参 `@Builder` 承载会变内容）、回调**不**加 `@Prop`
 *      （V1 装饰器不许标函数类型）、调色板读取点恰 2（`palOnce`+`skin`）、diff 解析有缓存、
 *      关闭/刷新/返回是真实 44 盒、空 diff 有显式文案。
 *
 * ✅ 扫描器自证：打印扫到的文件 + 逐项计数；**零扫描判红**。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ⚠️ 运行时 `__dirname` = `<repo>/tools/tests/.out-one.<pid>/js` ⇒ 上溯 **4** 级才是仓根
//    （与 `tools/tests/cron_detail.test.ts` 同口径；写 3 级会扫到 `tools/` ⇒ 零扫描判红）。
const REPO: string = path.resolve(__dirname, '../../../..');
const PAGES: string = path.join(REPO, 'entry/src/main/ets/pages');
const COMPONENTS: string = path.join(REPO, 'entry/src/main/ets/components');
const CORE: string = path.join(REPO, 'entry/src/main/ets/core');

/** **剥注释**（块 + 行；行注释用 `(^|[^:])//` 以免剥掉 `https://`）—— 只认生产代码。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function countOf(src: string, needle: string): number {
  let n = 0, i = src.indexOf(needle);
  while (i >= 0) { n++; i = src.indexOf(needle, i + needle.length); }
  return n;
}
/** 取 `from` 之后 `to` 之前的片段（任一未命中 ⇒ `''` ⇒ 后续断言自然红）。 */
function sliceBetween(src: string, from: string, to: string, fromAt: number = -1): string {
  const a = fromAt >= 0 ? fromAt : src.indexOf(from);
  if (a < 0) { return ''; }
  const b = src.indexOf(to, a + from.length);
  if (b < 0) { return ''; }
  return src.substring(a, b);
}

const pagePath: string = path.join(PAGES, 'Index.ets');
const compPath: string = path.join(COMPONENTS, 'GitPanelSheet.ets');
const corePath: string = path.join(CORE, 'gitpanel.ets');

const files: string[] = [pagePath, compPath, corePath];
const scanned: string[] = [];
for (const f of files) { if (fs.existsSync(f)) { scanned.push(f); } }
console.log(`  git_panel 扫描：${scanned.length}/${files.length} 个文件`);
for (const f of scanned) { console.log(`    · ${f.replace(REPO + '/', '')}`); }
// ⛔ 白绿防线：三个文件一个都不能少（少一个 ⇒ 后面所有 indexOf 都 '红'，但**要说清是"没扫到"**）。
ok('零扫描防线：三个文件都存在', scanned.length === files.length);
if (scanned.length !== files.length) { console.log(`  git_panel: 扫描失败`); process.exit(1); }

const pageAll: string = fs.readFileSync(pagePath, 'utf8');
const page: string = stripComments(pageAll);
const compRaw: string = fs.readFileSync(compPath, 'utf8');
const comp: string = stripComments(compRaw);
const coreRaw: string = fs.readFileSync(corePath, 'utf8');
const core: string = stripComments(coreRaw);

// ── ① 插件行 **通用**深链（⛔ 零插件特判 —— 用户架构修正：任何插件都靠自己的 view 声明打开）──
const openPluginSeg: string = sliceBetween(page, 'onOpenPlugin: (p: PluginCatalogItem) => {', 'onRetry');
ok('onOpenPlugin 片段取到', openPluginSeg.length > 0);
// ⛔ 判据演进（2026-10-13，15z15）：深链拼装**收敛到唯一纯函数** `pluginOpenTarget`
//    （`core/pluginhost.ets`）—— 页面**不再自己拼**（此前页面与"原生插件目录"两条路径各自为政，
//    目录那条直接载入 `openUrl` = host 根页 = 聊天页 ⇒ 真机实测「跑回主界面」）。
//    所以这里钉的形态从"页面内有拼装表达式"改成"页面**调那个唯一函数**、且**不得**再内联拼装"。
ok('① 页面调唯一纯函数 pluginOpenTarget（主视图由插件自己的 views 决定）',
  openPluginSeg.indexOf('pluginOpenTarget(p, this.serverUrl)') >= 0);
ok('① ⛔ 页面**不得**再内联拼深链（分叉防线：拼装只在 core 一处）',
  openPluginSeg.indexOf('pluginViewDeepLink(') < 0 && openPluginSeg.indexOf('primaryViewId(') < 0);
// ⛔ 判据演进（**§21.122**，2026-10-14，用户定向）：插件视图**一律 WebView 直渲** ⇒ 深链进
//    `panelUrl` 前必须打「WebView 直渲」标记（`embedPluginViewLink`），否则 `WebSurface` 的
//    `onLoadIntercept` 会把同一 viewId 拦回**原生面板**（用户明确否掉的"每插件一份原生实现"）。
//    形态仍钉**唯一调用点**（⛔ 页面不得自己拼条件），只是把出口从 `target.url` 收紧为
//    `embedPluginViewLink(target.url)`。
ok('① 深链结果进 panelUrl（§21.122：经 embedPluginViewLink 打「WebView 直渲」标记）',
  openPluginSeg.indexOf('this.panelUrl = embedPluginViewLink(target.url);') >= 0);
ok('① 无 view 声明时回落既有行为', openPluginSeg.indexOf('this.panelUrl = p.url;') >= 0);
// 唯一纯函数自身：必须由 viewId 拼深链，且有 view 时**绝不**返回 host 根页（真机 bug 的根因）。
const hostCore: string = stripComments(fs.readFileSync(path.join(CORE, 'pluginhost.ets'), 'utf8'));
const potSeg: string = sliceBetween(hostCore, 'export function pluginOpenTarget(', 'export function pluginViewTarget(');
ok('① pluginOpenTarget 片段取到', potSeg.length > 0);
ok('① pluginOpenTarget 用 primaryViewId + pluginViewDeepLink 拼',
  potSeg.indexOf('primaryViewId(views)') >= 0 && potSeg.indexOf('pluginViewDeepLink(base, viewId, label)') >= 0);
ok('① pluginOpenTarget 只在**无 view** 时才回落 p.url',
  potSeg.indexOf('return new PluginOpenTarget(p.url') >= 0);
// 原生「插件目录」不得再直接用 openUrl 导航（真机实测的「跑回主界面」根因）。
const hostComp: string = stripComments(fs.readFileSync(path.join(COMPONENTS, 'PluginHost.ets'), 'utf8'));
ok('① ⛔ 原生目录不得直接导航 openUrl/item.url（跑回主界面根因）',
  hostComp.indexOf('this.onOpen(this.view.openUrl') < 0 && hostComp.indexOf('this.onOpen(this.item.url') < 0);
ok('① 原生目录两条路径都上报"点了谁"（onOpenPlugin/onOpenView）',
  hostComp.indexOf('this.onOpenPlugin(p);') >= 0 && hostComp.indexOf('this.onOpenView(v);') >= 0);
// ⛔ 判别点：**不许**按插件 id 分流（那正是"以后新插件怎么办"的病根）。
ok('① 无插件 id 特判', openPluginSeg.indexOf('p.id ===') < 0 && openPluginSeg.indexOf('GIT_PLUGIN_ID') < 0);
// 原生 Git 面板改为**固定入口**（可选增强，不在关键路径上）。
const sheetsSeg: string = fs.readFileSync(path.join(COMPONENTS, 'PluginsSheet.ets'), 'utf8');
ok('① 原生 Git 面板是能力面板里的固定入口', sheetsSeg.indexOf("this.EntryRow('Git 面板（原生）'") >= 0);
ok('① 页面把它接到 openGitPanel',
  sliceBetween(page, 'onOpenGit: () => {', '},').indexOf('this.openGitPanel()') >= 0);

// ── ② wire 格式：插件方法必须经 web_plugin_rpc 包一层 ─────────────────────────────
ok('② 页面用 RPC_WEB_PLUGIN 常量', countOf(page, 'RPC_WEB_PLUGIN') >= 4);
ok('② 不得散落插件 id 字面量（走 gitMethod）', countOf(page, "'xbot.git-fancy") === 0);
eq('② 四个方法都经 gitMethod', ['status', 'log', 'diff', 'commit']
  .map((m) => countOf(page, `gitMethod('${m}')`) >= 1), [true, true, true, true]);
ok('② 外层参数类 WebPluginRpcParams 被用', countOf(page, 'new WebPluginRpcParams(') >= 4);
// 核心模块侧：id 只在 GIT_PLUGIN_ID 定义处出现一次（唯一引用点）。
eq('② 插件 id 只在纯模块定义一次', countOf(core, "'xbot.git-fancy'"), 1);
ok('② 外层方法名 = web_plugin_rpc', core.indexOf("RPC_WEB_PLUGIN: string = 'web_plugin_rpc'") >= 0);

// ── ③ 取数字段全部过纯函数（解析/格式化同源）────────────────────────────────────
const loadSeg: string = sliceBetween(page, 'private async loadGitPanel(): Promise<void> {', 'private async loadMoreGitLog');
ok('③ loadGitPanel 片段取到', loadSeg.length > 0);
ok('③ status 过 parseGitStatus', loadSeg.indexOf('parseGitStatus(') >= 0);
ok('③ log 过 parseGitLog', loadSeg.indexOf('parseGitLog(') >= 0);
const projSeg: string = sliceBetween(page, 'GitPanelSheet({', '})', page.indexOf('GitPanelSheet({'));
ok('③ 面板投影全部调纯函数',
  projSeg.indexOf('gitHeadline(this.gitStatus)') >= 0
  && projSeg.indexOf('gitBranchText(this.gitStatus)') >= 0
  && projSeg.indexOf('gitAheadBehindText(this.gitStatus)') >= 0
  && projSeg.indexOf('hasMoreGitLog(this.gitLog)') >= 0);
ok('③ diff 过 parseGitDiff（归一化后才交给组件）', countOf(page, 'parseGitDiff(') >= 1);
ok('③ commit 过 parseGitCommit + gitCommitMetaText',
  countOf(page, 'parseGitCommit(') >= 1 && countOf(page, 'gitCommitMetaText(') >= 1);
// 分页合并必须去重（`mergeGitLog`），⛔ 直接 concat 会重复行 + 键冲突。
ok('③ 加载更多走去重合并', countOf(page, 'mergeGitLog(') >= 1);
ok('③ skip = 已取条数（游标推进）', page.indexOf('this.gitLog.commits.length))') >= 0);
// commit 形态里点文件 ⇒ 该提交作用域的 diff（形态在切换前读）。
ok('③ commit 内点文件带 commit 作用域', page.indexOf("this.gitMode === 'commit' ? this.gitCommitHash : ''") >= 0);

// ── ④ 门控 + 组件消费 + 绘制顺序（15z13 教训：必须在 PanelsSheet 之后）────────────
eq('④ 组件被消费恰 1 处', countOf(page, 'GitPanelSheet({'), 1);
// ⚠️ 三处**都用 lastIndexOf**：`showCronDetail` / `showGit` 在 `onBackPress` 里也各出现一次，
//    用 indexOf 会定位到返回键那段（比 PanelsSheet 更靠前）⇒ 绘制顺序判据假红。
const panelsIdx: number = page.lastIndexOf('this.PanelsSheet()');
const cronDetailIdx: number = page.lastIndexOf('if (this.showCronDetail)');
const gitIdx: number = page.lastIndexOf('if (this.showGit) {');
ok('④ 三处调用点都定位到', panelsIdx > 0 && cronDetailIdx > 0 && gitIdx > 0);
ok('④ 绘制顺序：Git 面板在运行面板之后', panelsIdx > 0 && gitIdx > panelsIdx);
ok('④ 绘制顺序：Git 面板在定时详情之后', cronDetailIdx > 0 && gitIdx > cronDetailIdx);
const gateSeg: string = sliceBetween(page, 'if (this.showGit) {', 'GitPanelSheet({', gitIdx);
ok('④ 门控与组件之间无其它浮层（真门控）', gateSeg.length > 0 && countOf(gateSeg, 'if (') === 1);
ok('④ 遮罩点击即关', gateSeg.indexOf('this.closeGitPanel()') >= 0);

// ── ⑤ 返回键（先于浮层栈）+ 抽屉互斥收口 ────────────────────────────────────────
const backSeg: string = sliceBetween(page, 'onBackPress(): boolean {', 'const code: OverlayCode = topOverlay');
ok('⑤ 返回键处理取到', backSeg.length > 0);
ok('⑤ 返回键先关 Git 面板（在浮层栈之前）', backSeg.indexOf('if (this.showGit) {') >= 0);
ok('⑤ 详情形态先回列表、列表形态才关面板',
  backSeg.indexOf("if (this.gitMode !== 'list')") >= 0 && countOf(backSeg, 'this.showGit = false;') >= 1);
const aboveSeg: string = sliceBetween(page, 'private closeOverlaysAboveDrawer(): void {', 'private openPanels()');
ok('⑤ 开抽屉前的互斥收口已登记 showGit', aboveSeg.indexOf('this.showGit = false;') >= 0);

// ── ⑥ 组件侧形态 ───────────────────────────────────────────────────────────────
ok('⑥ 真 @Component + export struct', /@Component\s*\nexport struct GitPanelSheet\s*\{/.test(comp));
eq('⑥ 回调不许加 @Prop（V10905363）', countOf(comp, '@Prop on'), 0);
eq('⑥ 调色板读取点恰 1 处 paletteOf', countOf(comp, 'paletteOf('), 1);
eq('⑥ 不用 this.pal()（走 memo 入口）', countOf(comp, 'this.pal()'), 0);
ok('⑥ diff 解析有缓存（不随 build 重复解析）', comp.indexOf('diffCacheKey') >= 0);
eq('⑥ 关闭/刷新/返回都是真实 44 盒', countOf(comp, '.width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)'), 3);
ok('⑥ 有测试钩子 id', comp.indexOf(".id('xbot-git-panel')") >= 0);
ok('⑥ 空 diff 有显式文案（⛔ 不留白屏）', comp.indexOf('没有可显示的文本改动') >= 0);
ok('⑥ 长串可任意折行（错误条/提交信息）', countOf(comp, 'WordBreak.BREAK_ALL') >= 2);
ok('⑥ 面板高度与姊妹面板同档', comp.indexOf("PANEL_H: string = '78%'") >= 0);
ok('⑥ 「加载更多」只在还有时出现', comp.indexOf('if (this.hasMore) {') >= 0);
// 组件必须把三种形态都画出来（漏一种 ⇒ 点进去白屏）。
ok('⑥ 三形态分支齐', comp.indexOf("this.mode === 'diff'") >= 0 && comp.indexOf("this.mode === 'commit'") >= 0
  && comp.indexOf('this.ListBody()') >= 0);

// ── ⑦ commit 作用域接线（2026-10-16 真机 bug：「点 commit 的文件 diff 都是 0」）──────────
// 病根：`gitCommitHash` **只声明、从不赋值**（恒 `''`）⇒ `openGitDiff(path,
//   this.gitMode === 'commit' ? this.gitCommitHash : '')`（`:5774`）恒传空 ⇒ 服务端退化成
//   **工作区**作用域（`git diff -- path`）⇒ 已提交文件在工作区无改动 ⇒ `content` 为空 ⇒
//   前端落到空态文案「没有可显示的文本改动（二进制文件或仅权限变更）」。
// ⇒ 判据必须钉**赋值调用点**：只钉"声明存在"必假绿（原 bug 的形态恰恰是声明齐全）。
const commitScopeWrites: number = countOf(page, 'this.gitCommitHash = ');
eq('⑦ gitCommitHash 赋值点恰 2 处（写入本次 hash + 回列表清理）', commitScopeWrites, 2);
ok('⑦ commit 详情打开时写入本次 hash（⛔ 只声明不写 = 原 bug）',
  /this\.gitCommitHash\s*=\s*hash\s*;/.test(page));
ok('⑦ 回列表时清掉作用域（⛔ 否则工作区文件错带上一个 commit）',
  /this\.gitCommitHash\s*=\s*''\s*;/.test(page));
ok('⑦ 点文件时真把 commit 作用域传下去（⛔ 不许写死空串）',
  page.indexOf("this.openGitDiff(path, this.gitMode === 'commit' ? this.gitCommitHash : '')") >= 0);

if (fail > 0) { console.log(`  git_panel: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  git_panel: ${pass} passed, 0 failed`);
process.exit(0);

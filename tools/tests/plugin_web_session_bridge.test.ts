/**
 * plugin_web_session_bridge —— 用户 2026-10-17 P0：「web 内嵌插件拿到的 pwd/cwd 都是错的」。
 *
 * ── 根因（已核实，web 侧真源）─────────────────────────────────────────────────
 *  web 插件的 cwd **不是**插件自己算的：它们经 **plugin RPC** 取 `cwd`，而 RPC 的会话身份
 *  来自宿主注入的全局 `window.__xbot_session__ = {channel, chatID}`
 *  （`web/src/plugin-runtime/usePluginRuntimeHost.ts:373-390` 原文："插件 RPC 通过
 *   resolveChat() 读取此值注入 cwd"；`src/plugins/git-fancy/shared.tsx:189-209` 直接读它）。
 *  ⛔ 原生 WebView 此前**从未注入**它 ⇒ 插件要么"会话身份未就绪"，要么按错的兜底取 cwd
 *  ⇒ 用户看到"pwd/cwd 全是错的"。
 *
 * ── 修法（**通用**：零插件特判）──────────────────────────────────────────────
 *  ① 页面脚本之前注入 `__xbot_session__`（`runJavaScriptOnDocumentStart`）⇒ 所有 web 插件通吃；
 *  ② 会话切换时 `@Watch` 原地重注入（不重载页面）；
 *  ③ 新增通用桥 `{type:'diff', payload:{path,commit}}` ⇒ 原生 diff 面板（任何插件都能用）。
 *
 * ── 判据 ─────────────────────────────────────────────────────────────────────
 *  A 纯逻辑：注入脚本的形状/转义、diff 载荷的 fail-closed 解析、桥类型白名单；
 *  B 接线（源码形态）：WebSurface 真的在 documentStart 注入 + 有 @Watch 重注入；
 *    页面真的把 chatId 传下去并把 diff 回调接到原生 `openGitDiff`（⛔ 无插件 id 特判）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;

import { sessionBootstrapJs, parseDiffBridgePayload, DiffBridgeRequest } from '../../entry/src/main/ets/core/pluginhost';
import { bridgeTypeIsAllowed, hostActionFor, BridgeMessage, BRIDGE_ACTION_DIFF, BRIDGE_VERSION } from '../../entry/src/main/ets/core/webbridge';
import { buildPluginCatalog } from '../../entry/src/main/ets/core/pluginhost';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

console.log('\n▶ A① 会话注入脚本（插件 cwd 的唯一来源）');
const js: string = sessionBootstrapJs('web', 'chat_ABC');
ok('设置了 window.__xbot_session__', js.indexOf('window.__xbot_session__') >= 0);
ok('含 channel', js.indexOf('channel:') >= 0 && js.indexOf('"web"') >= 0);
ok('含 chatID', js.indexOf('chatID:') >= 0 && js.indexOf('"chat_ABC"') >= 0);
ok('能在页面脚本前安全执行（IIFE + try/catch）', js.indexOf('(function(){') === 0 && js.indexOf('try{') > 0);
const esc: string = sessionBootstrapJs('web', 'a"b\\c');
ok('会话 id 做了 JSON 转义（不会破坏脚本）', esc.indexOf('a\\"b\\\\c') >= 0);
eq('空 channel ⇒ 回落 web', sessionBootstrapJs('', 'x').indexOf('"web"') >= 0, true);

console.log('\n▶ A② diff 桥载荷（fail-closed，⛔ 绝不开空 diff 骗用户）');
const good: DiffBridgeRequest | null = parseDiffBridgePayload('{"path":"src/a b.go","commit":"abc123"}');
ok('合法载荷解析成功', good !== null);
eq('path 透传', good?.path, 'src/a b.go');
eq('commit 透传', good?.commit, 'abc123');
eq('缺 commit ⇒ 空串（工作区 diff）', parseDiffBridgePayload('{"path":"x"}')?.commit, '');
ok('非 JSON ⇒ null', parseDiffBridgePayload('not json') === null);
ok('缺 path ⇒ null', parseDiffBridgePayload('{"commit":"abc"}') === null);
ok('空 path ⇒ null', parseDiffBridgePayload('{"path":"   "}') === null);
ok('path 非字符串 ⇒ null', parseDiffBridgePayload('{"path":123}') === null);
ok('空载荷 ⇒ null', parseDiffBridgePayload('') === null);
ok('超长载荷 ⇒ null（防灌）', parseDiffBridgePayload('{"path":"' + 'a'.repeat(9000) + '"}') === null);

console.log('\n▶ A③ 桥协议：diff 是白名单类型，且路由到宿主 diff 动作');
ok('bridgeTypeIsAllowed(diff)', bridgeTypeIsAllowed('diff') === true);
const m: BridgeMessage = new BridgeMessage(BRIDGE_VERSION, 'd-1', 'diff', '{"path":"a.go","commit":"c"}');
eq('hostActionFor 路由到 BRIDGE_ACTION_DIFF', hostActionFor(m).kind, BRIDGE_ACTION_DIFF);
eq('payload 原样带出（解析交给纯函数）', hostActionFor(m).text, '{"path":"a.go","commit":"c"}');

console.log('\n▶ A④ 入口去重（用户 2026-10-17：有原生入口的内置插件不再给 web 入口）');
// 同一插件同时声明「原生有落地的视图」+「纯 web 视图」⇒ 只留原生那一类（不许两条入口）
const wire: any = {
  plugins: [
    {
      id: 'xbot.git-fancy', name: 'Git', version: '1', state: 'installed',
      contributes: [
        { kind: 'view', id: 'xbot.git-fancy.panel', container: 'sidebar', title: 'Git' },
        { kind: 'view', id: 'xbot.git-fancy.extra-web', container: 'sidebar', title: 'GitWeb' },
      ],
    },
    {
      id: 'xbot.pure-web', name: 'PureWeb', version: '1', state: 'installed',
      contributes: [
        { kind: 'view', id: 'xbot.pure-web.panel', container: 'sidebar', title: 'Pure' },
      ],
    },
  ],
};
const cat: any = buildPluginCatalog(wire, 'zh', 'http://h:8082');
const fancy: any = cat.items.filter((it: any) => it.id === 'xbot.git-fancy')[0];
const pure: any = cat.items.filter((it: any) => it.id === 'xbot.pure-web')[0];
ok('有原生入口的插件**整条不进 web 目录**（能力面板只剩原生那条）', fancy === undefined);
eq('纯 web 插件不受影响（仍走 web 入口）', pure.views.length, 1);
eq('纯 web 插件仍是 web 视图', pure.views[0].id, 'xbot.pure-web.panel');

console.log('\n▶ B 接线（源码形态）：注入 + 会话切换重注入 + 页面接线');
const pathMod = require('path');
const fsMod = require('fs');
const root: string = pathMod.resolve(__dirname, '../../../..');
const ws: string = fsMod.readFileSync(pathMod.join(root, 'entry/src/main/ets/components/WebSurface.ets'), 'utf8');
const page: string = fsMod.readFileSync(pathMod.join(root, 'entry/src/main/ets/pages/Index.ets'), 'utf8');

ok('WebSurface 在 documentStart 注入会话脚本', ws.indexOf('sessionBootstrapJs(this.channel, this.chatId)') >= 0);
const dsAt: number = ws.indexOf('runJavaScriptOnDocumentStart([');
// ⛔ 从数组起点**向后**找（`sessionBootstrapJs` 在 `onChatIdChanged` 里也出现一次，
//   取全局第一个会假红 —— 判据要钉"数组内那一次调用"，不是"全文存在"）
const injAt: number = dsAt >= 0 ? ws.indexOf('sessionBootstrapJs(this.channel, this.chatId)', dsAt) : -1;
ok('注入点在 documentStart 数组内（页面脚本之前）', dsAt >= 0 && injAt > dsAt);
ok('chatId 变化触发重注入（@Watch）', ws.indexOf("@Watch('onChatIdChanged')") >= 0 && ws.indexOf('onChatIdChanged(): void') >= 0);
ok('diff 动作接到 onOpenDiff 回调', ws.indexOf('this.onOpenDiff(req.path, req.commit)') >= 0);

const chatIdWires: number = (page.match(/chatId: this\.currentChat/g) || []).length;
ok(`页面把 chatId 传给 WebSurface（>=2 处承载面，实际 ${chatIdWires}）`, chatIdWires >= 2);
const diffWires: number = (page.match(/onOpenDiff: \(path: string, commit: string\)/g) || []).length;
ok(`页面接住 onOpenDiff（>=2 处，实际 ${diffWires}）`, diffWires >= 2);
ok('onOpenDiff 走既有原生 diff 面板（openGitDiff ⇒ 覆盖层，返回即回 web view）',
  page.indexOf('void this.openGitDiff(path, commit);') >= 0);
// ⛔ 零插件特判：不得出现"按 pluginId 决定是否弹原生 diff"的分支
ok('⛔ 无插件特判（不按 pluginId 分支到 diff）',
  !/pluginId\s*===\s*['"]xbot\.git-fancy['"][^\n]*diff/.test(page) && page.indexOf("pluginId === 'xbot.git-fancy'") < 0);

if (fail > 0) {
  console.log(`  plugin_web_session_bridge: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  plugin_web_session_bridge: ${pass} passed, 0 failed`);
process.exit(0);

export {};

/**
 * GenUI（`display_html`）**免点击直接展示**判据 — 用户 2026-11-06：
 *   「更好的支持 display html 画出的窗口，**不需要用户点开就能展示**」。
 *
 * 旧实现（本文件钉住，回退即红）：`display_html` 只落一枚**紧凑卡**，用户必须点「打开面板」
 * 才会 `POST /api/share/create` → 全屏 `WebSurface` ⇒ 面板内容**永远不主动出现**。
 * web 权威是**内联**（`plugins/genui/GenUIPanel.tsx:196-203`：`SandboxedUI` 直接挂进消息流，
 * `max-h-[70vh] overflow-auto`），不是一枚按钮。
 *
 * 新实现：
 *   · 卡片 `aboutToAppear` 就调上层 `onShare`（页面 IO）取 URL，拿到就直接内联渲染 `WebSurface`；
 *   · `live → false`（提交）也自动触发（生成中的半截源码不建分享）；
 *   · 页面按 `genuiPanelKey(code)` **缓存 URL + 并发去重** ⇒ 反复挂载只建一次分享
 *     （否则"自动展示"会制造一堆垃圾分享）。
 *
 * mutation 自证：删掉卡片里的 `ensureInline()` 调用 / 页面的 `genuiUrlCache` ⇒ §1/§2 立刻红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; resolve(...parts: string[]): string };
declare const __dirname: string;

import { genuiPanelKey } from '../../entry/src/main/ets/core/genui';

const gi_fs = require('fs');
const gi_path = require('path');
function giFindRoot(): string {
  const ups: string[] = ['../..', '../../..', '../../../..'];
  for (let i = 0; i < ups.length; i++) {
    const p: string = gi_path.resolve(__dirname, ups[i]);
    if (gi_fs.existsSync(gi_path.join(p, 'entry/src/main/ets/components'))) {
      return p;
    }
  }
  return '';
}
const gi_root: string = giFindRoot();
const gi_card: string = gi_fs.readFileSync(
  gi_path.join(gi_root, 'entry/src/main/ets/components/GenuiPanelCard.ets'), 'utf8');
const gi_index: string = gi_fs.readFileSync(
  gi_path.join(gi_root, 'entry/src/main/ets/pages/Index.ets'), 'utf8');

let gi_pass = 0;
let gi_fail = 0;
function ok(name: string, cond: boolean, detail: string = ''): void {
  if (cond) {
    gi_pass++;
  } else {
    gi_fail++;
    console.log(`  ✗ ${name}${detail.length > 0 ? '\n      ' + detail : ''}`);
  }
}
function at(src: string, needle: string): number {
  return src.indexOf(needle);
}

// ── §0 缓存键（页面去重的唯一依据）────────────────────────────────────────────
console.log('\n▶ §0 genuiPanelKey');
{
  ok('同源码 ⇒ 同键', genuiPanelKey('const a = 1') === genuiPanelKey('const a = 1'));
  ok('异源码 ⇒ 异键', genuiPanelKey('const a = 1') !== genuiPanelKey('const a = 2'));
  ok('长度变化也换键（截断/追加不会误命中）',
    genuiPanelKey('abc') !== genuiPanelKey('ab'));
  ok('空串可键（不崩）', genuiPanelKey('').length > 0);
  ok('长源码键稳定（重复调用一致）',
    genuiPanelKey('x'.repeat(4096)) === genuiPanelKey('x'.repeat(4096)));
}

// ── §1 卡片：挂载即自动准备 + 内联渲染 ───────────────────────────────────────
console.log('\n▶ §1 GenuiPanelCard 免点击展示');
{
  ok('有 aboutToAppear 且触发 ensureInline', at(gi_card, 'aboutToAppear(): void {') >= 0
    && at(gi_card, 'this.ensureInline();') >= 0);
  ok('live→false 也会触发（提交后才建分享）', at(gi_card, "@Watch('onLiveChanged') live") >= 0
    && at(gi_card, 'private onLiveChanged(): void {') >= 0);
  ok('生成中/空源码不建分享', at(gi_card, 'if (this.live || this.inlineUrl.length > 0 || this.preparing) {') >= 0
    && at(gi_card, 'if (this.code.length === 0) {') >= 0);
  ok('组件层不发请求：只调上层 onShare（唯一调用点 requestUrl）',
    at(gi_card, 'private requestUrl(): Promise<string> {') >= 0
    && at(gi_card, 'return this.onShare(this.code, this.title);') >= 0
    && at(gi_card, 'this.requestUrl().then(') > 0);
  ok('内联 URL 状态位存在', at(gi_card, '@State private inlineUrl: string') >= 0);
  ok('build() 按 inlineUrl 分流（就绪 ⇒ 内联面板）',
    at(gi_card, 'if (this.inlineUrl.length > 0) {\n      this.InlinePanel()\n    } else {\n      this.CompactCard()') >= 0);
  ok('内联面板真的挂 ArkWeb（chrome=false）', at(gi_card, 'WebSurface({') >= 0
    && at(gi_card, 'chrome: false,') >= 0);
  ok('内联高度有界（防把消息流撑爆）', at(gi_card, 'const GENUI_INLINE_H: number') >= 0
    && at(gi_card, '.height(GENUI_INLINE_H)') >= 0);
  ok('内联态仍保留「全屏」逃生口', at(gi_card, 'this.onOpen(this.code, this.title);') >= 0);
  ok('内联态仍保留分享 chip（shareLabelOf 单一来源）', at(gi_card, 'shareLabelOf(this.shareState)') >= 0);
  // ArkWeb 是重资源：同时内联挂载必须有上限（历史会话几十张面板不能全开）
  ok('并发内联有上限（GENUI_INLINE_MAX）', at(gi_card, 'const GENUI_INLINE_MAX: number') >= 0
    && at(gi_card, 'if (genuiInlineMounted >= GENUI_INLINE_MAX) {') >= 0);
  ok('卸载归还名额（aboutToDisappear）', at(gi_card, 'aboutToDisappear(): void {') >= 0
    && at(gi_card, 'genuiInlineMounted = genuiInlineMounted > 0 ? genuiInlineMounted - 1 : 0;') >= 0);
}

// ── §2 页面：URL 缓存 + 并发去重（自动展示不能刷垃圾分享）────────────────────
console.log('\n▶ §2 页面级分享 URL 缓存');
{
  ok('URL 缓存表存在', at(gi_index, 'private genuiUrlCache: Map<string, string>') >= 0);
  ok('并发去重表存在', at(gi_index, 'private genuiUrlPending: Map<string, Promise<string>>') >= 0);
  ok('缓存键用 genuiPanelKey(code)', at(gi_index, 'const key: string = genuiPanelKey(code);') >= 0);
  ok('命中缓存直接返回（不再发请求）', at(gi_index, 'const cached: string | undefined = this.genuiUrlCache.get(key);') >= 0);
  ok('并发复用同一 Promise', at(gi_index, 'const pending: Promise<string> | undefined = this.genuiUrlPending.get(key);') >= 0);
  ok('成功才写缓存', at(gi_index, 'this.genuiUrlCache.set(key, url);') >= 0);
  ok('请求结束清 pending', at(gi_index, 'this.genuiUrlPending.delete(key);') >= 0);
  ok('建分享前注入会话 cookie（否则 401 落登录页）',
    at(gi_index, 'syncSessionCookieToWeb(store);') > 0
    && at(gi_index, 'syncSessionCookieToWeb(store);') < at(gi_index, 'await store.shareGenuiPanel(code, title);'));
  ok('Index 引入了 genuiPanelKey', at(gi_index, 'import { genuiPanelKey, genuiPayloadTooLarge }') >= 0);
}

console.log(`\n=== genui_inline: ${gi_pass} 通过 / ${gi_fail} 失败 ===`);
if (gi_fail > 0) {
  process.exit(1);
}
export {};

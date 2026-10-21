/**
 * web_chrome_label.test.ts —— 承载面**顶栏标题**的判别力回归守卫。
 *
 * 缺陷形态（用户 2026-10-13 亲报「你开插件，上面有个地址是不是太丑了，能优化一下吗」）：
 * `components/WebSurface.ets` 的顶栏旧实现是
 * `Text(this.title.length > 0 ? this.title : this.url)`，而 `onPageBegin` 又把
 * `event.url` 写进 `this.title` ⇒ 顶栏**恒显示原始 URL**
 * （`http://127.0.0.1:8082/?xbot_view=xbot.git-fancy.panel`）：丑、无信息量、泄露内网地址。
 *
 * 修复：标题一律经纯函数 `core/pluginview.ets:webChromeLabel(pageTitle, url, fallback)`，
 * 优先级 = **调用方给的语义标签**（插件自己声明的 view 标题 / 「完整 Web UI」）
 *   > 页面 `document.title`（且**否决**"看着像 URL"的值）
 *   > 空串（组件据此**不渲染**该文本节点，而不是退回显示一条丑 URL）。
 *
 * 判别力（mutation 自证）：
 *   · 把 `webChromeLabel` 的 fallback 分支删掉（恒取 pageTitle）⇒ A1/A2/A3 红；
 *   · 删掉「像 URL 就否决」的分支 ⇒ B1/B2 红；
 *   · 把空串兜底改成返回 url ⇒ C1 红。
 */
declare const process: { exit: (c: number) => void };

import { webChromeLabel } from '../../entry/src/main/ets/core/pluginview';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
    console.log(`  \u2713 ${name}`);
    return;
  }
  fail++;
  console.log(`  \u2717 ${name}${extra !== undefined ? '  (' + extra + ')' : ''}`);
}

const URL = 'http://127.0.0.1:8082/?xbot_view=xbot.git-fancy.panel&xbot_view_title=Git';

// ── A. 调用方标签**优先**（宿主打开时就知道自己要展示什么，最权威）─────────────
{
  ok('A1 有 fallback ⇒ 用它（页面标题只作次选）',
    webChromeLabel('xbot', URL, 'Git \u9762\u677f') === 'Git \u9762\u677f',
    webChromeLabel('xbot', URL, 'Git \u9762\u677f'));
  ok('A2 fallback 前后空白被裁剪',
    webChromeLabel('', URL, '  \u5b8c\u6574 Web UI  ') === '\u5b8c\u6574 Web UI');
  ok('A3 fallback 存在时**不看** pageTitle（内置 web 的 document.title 恒为 xbot，不可用）',
    webChromeLabel('xbot', URL, '\u8fdc\u7a0b\u673a\u5668\uff08SSH\uff09') === '\u8fdc\u7a0b\u673a\u5668\uff08SSH\uff09');
}

// ── B. 无调用方标签 ⇒ 用页面标题，但**否决**"看着像 URL"的值 ──────────────────
{
  ok('B1 pageTitle 是普通标题 ⇒ 用它', webChromeLabel('\u8fed\u4ee3\u6307\u6807', URL, '') === '\u8fed\u4ee3\u6307\u6807');
  ok('B2 pageTitle 以 http:// 开头 ⇒ 否决（空串）', webChromeLabel(URL, URL, '') === '');
  ok('B3 pageTitle 以 https:// 开头 ⇒ 否决', webChromeLabel('https://x.example/a', URL, '') === '');
  ok('B4 pageTitle 恰好等于 url ⇒ 否决', webChromeLabel(URL, URL, '') === '');
  ok('B5 pageTitle 是 file:// ⇒ 否决', webChromeLabel('file:///x/y.html', URL, '') === '');
  ok('B6 大小写混写的 URL 也否决', webChromeLabel('HTTP://127.0.0.1:8082/', URL, '') === '');
}

// ── C. 都不可用 ⇒ 空串（组件不渲染文本节点；**绝不**回落显示 URL）──────────────
{
  ok('C1 全空 ⇒ 空串', webChromeLabel('', URL, '') === '');
  ok('C2 空页标题 + 空白 fallback ⇒ 空串', webChromeLabel('', URL, '   ') === '');
  ok('C3 url 为空时也不返回 url', webChromeLabel('', '', '') === '');
}

// ── D. 幂等/稳定：同一输入恒同输出（组件每帧都可能调用）────────────────────────
{
  const a = webChromeLabel('\u63d2\u4ef6', URL, 'Git');
  const b = webChromeLabel('\u63d2\u4ef6', URL, 'Git');
  ok('D1 纯函数（同输入同输出）', a === b && a === 'Git');
}

console.log(`\nweb_chrome_label: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

export {};

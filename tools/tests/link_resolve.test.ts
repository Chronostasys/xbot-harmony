/**
 * 相对链接解析判据（用户 2026-10-27：「如果后端的链接是相对地址，用户要打开自动拼接上 host」）。
 *
 * 契约（语义 = 浏览器 / RFC 3986 §5.2）：
 *   · 绝对 `http(s)://…` / `mailto:` ⇒ 原样；
 *   · 协议相对 `//host/p` ⇒ 补 base 协议；
 *   · 根相对 `/api/x` ⇒ base origin + path；
 *   · 路径相对 `docs/a.md` / `./a` / `../a` ⇒ base **目录** + path，` .`/`..` 归一；
 *   · 仅查询 `?q` / 仅片段 `#f` ⇒ base 路径；
 *   · 其它显式协议（`javascript:`/`data:`/`file:`/`tel:`）⇒ 空串（白名单）；
 *   · 无 base ⇒ 相对地址空串（fail-closed，不猜）。
 *
 * mutation 自证：把 `resolveOpenable` 退回「只认 `/` 开头」⇒ 本文件 §2/§3 立刻红。
 */
declare const process: { exit: (c: number) => void };
declare const __dirname: string;

import { currentLinkBase, normalizeRefPath, resolveOpenable, setLinkBase } from '../../entry/src/main/ets/core/msgops';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

const BASE = 'http://192.168.1.10:16000';

// ── §1 绝对地址 / 白名单 ────────────────────────────────────────────────────
eq('https 原样', resolveOpenable('https://example.com/a?b=1', BASE), 'https://example.com/a?b=1');
eq('http 原样', resolveOpenable('http://x/y', BASE), 'http://x/y');
eq('mailto 原样', resolveOpenable('mailto:a@b.c', BASE), 'mailto:a@b.c');
eq('javascript 拒绝', resolveOpenable('javascript:alert(1)', BASE), '');
eq('data 拒绝', resolveOpenable('data:text/html,x', BASE), '');
eq('file 拒绝', resolveOpenable('file:///etc/passwd', BASE), '');
eq('tel 拒绝', resolveOpenable('tel:10086', BASE), '');
eq('空白输入拒绝', resolveOpenable('   ', BASE), '');

// ── §2 根相对 / 协议相对 ────────────────────────────────────────────────────
eq('根相对拼 origin', resolveOpenable('/api/files/download?k=1', BASE),
  'http://192.168.1.10:16000/api/files/download?k=1');
eq('根相对（base 带路径）', resolveOpenable('/x', 'http://h:1/app/'), 'http://h:1/x');
eq('协议相对补 https', resolveOpenable('//cdn.x/a.png', 'https://h:1'), 'https://cdn.x/a.png');
eq('协议相对补 http', resolveOpenable('//cdn.x/a.png', BASE), 'http://cdn.x/a.png');

// ── §3 路径相对（旧实现一律返回空 ⇒ 本段是 mutation 判据）────────────────────
eq('路径相对拼 base 目录', resolveOpenable('docs/guide.md', BASE),
  'http://192.168.1.10:16000/docs/guide.md');
eq('./ 归一', resolveOpenable('./docs/a.md', BASE), 'http://192.168.1.10:16000/docs/a.md');
eq('../ 上跳', resolveOpenable('../a.png', 'http://h:1/app/sub/'), 'http://h:1/app/a.png');
eq('../../ 越过根不越界', resolveOpenable('../../a', 'http://h:1/app/'), 'http://h:1/a');
eq('裸文件名', resolveOpenable('README.md', BASE), 'http://192.168.1.10:16000/README.md');
eq('相对 + 查询', resolveOpenable('a/b?x=1&y=2', BASE), 'http://192.168.1.10:16000/a/b?x=1&y=2');
eq('相对 + 片段', resolveOpenable('a#frag', BASE), 'http://192.168.1.10:16000/a#frag');
eq('仅查询', resolveOpenable('?page=2', BASE), 'http://192.168.1.10:16000/?page=2');
eq('仅片段', resolveOpenable('#top', BASE), 'http://192.168.1.10:16000/#top');

// ── §4 base 缺省 = fail-closed；已注册基地址兜底 ─────────────────────────────
eq('无 base ⇒ 相对不可解析', resolveOpenable('docs/a.md', ''), '');
setLinkBase(BASE);
eq('setLinkBase 后可解析', resolveOpenable('docs/a.md', ''), 'http://192.168.1.10:16000/docs/a.md');
eq('currentLinkBase 读回', currentLinkBase(), BASE);
setLinkBase('https://h:2/');
eq('https base 协议跟随', resolveOpenable('//cdn/a', ''), 'https://cdn/a');
setLinkBase('');

// ── §5 路径归一（纯函数，独立判据）──────────────────────────────────────────
eq('normalizeRefPath 去 .', normalizeRefPath('/a/./b'), '/a/b');
eq('normalizeRefPath 去 ..', normalizeRefPath('/a/b/../c'), '/a/c');
eq('normalizeRefPath 保留 query', normalizeRefPath('/a/../b?x=./y'), '/b?x=./y');
eq('normalizeRefPath 保留 fragment', normalizeRefPath('/a/./b#f'), '/a/b#f');
ok('normalizeRefPath 空串 ⇒ "/"', normalizeRefPath('') === '/');

// ── §6 源码接线判据（页面/组件必须真的用它 + 真的注入 base）──────────────────
declare const require: (m: string) => { readFileSync: (p: string, e: string) => string };
const fs = require('fs');
const root = __dirname + '/../../../..';
const msgopsSrc: string = fs.readFileSync(root + '/entry/src/main/ets/core/msgops.ets', 'utf8');
const httpSrc: string = fs.readFileSync(root + '/entry/src/main/ets/core/http.ets', 'utf8');
const mdSrc: string = fs.readFileSync(root + '/entry/src/main/ets/components/MarkdownView.ets', 'utf8');
ok('msgops 导出 setLinkBase', msgopsSrc.indexOf('export function setLinkBase') >= 0);
ok('HTTP 构造时注册基地址（唯一注入点）', httpSrc.indexOf('setLinkBase(this.baseUrl)') >= 0);
ok('MarkdownView 用 HTTP 层基地址兜底', mdSrc.indexOf('currentLinkBase()') >= 0);
ok('⛔ 旧行为（其余相对地址直接拒绝）已移除',
  msgopsSrc.indexOf('其余相对地址：不做拼接') < 0);

console.log(`link_resolve: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }

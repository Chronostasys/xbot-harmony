/**
 * `EntryAbility.loadContent` **失败不静默**门禁 —— `docs/SPLASH-SPEC.md §10 ③` 的最小落地（2026-10-11 裁决）。
 *
 * 事故面：`loadContent('pages/Index')` 失败时若只 `hilog.error(...); return;` ⇒ 页面**根本没挂载**
 *   ⇒ 系统开屏撤下后**屏幕上什么都没有**（用户只会说"打不开"），日志里也只有一行 error ⇒ 无法归因。
 * 裁决的三段式：① 明确 tag 的 error 日志（可 grep）→ ② **重试一次** → ③ 仍失败 ⇒ 加载**最小兜底页**
 *   `pages/Fallback`（纯文本；⛔ 不白屏、⛔ 不复杂 UI）。
 *
 * ⛔ 判据纪律：读**真实源码**、**剥注释且保留换行**、**零扫描判红**、命中原文可 grep。
 * mutation 自证：把失败分支改回 `hilog.error(...); return;`（静默）⇒ 重试/兜底两条断言必红。
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

/** 剥注释**保留换行**（行号与真源码一致；只看代码，注释里提到函数名不算）。 */
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
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/entryability/EntryAbility.ets'))) { return p; }
  }
  return '';
}
const root: string = findRoot();
ok('探测到仓库根', root.length > 0);
const R = (p: string): string => path.join(root, p);

const abilitySrc: string = fs.readFileSync(R('entry/src/main/ets/entryability/EntryAbility.ets'), 'utf8');
const ability: string = stripComments(abilitySrc);
const fb: string = fs.readFileSync(R('entry/src/main/ets/pages/Fallback.ets'), 'utf8');
const fbCode: string = stripComments(fb);
const pagesRaw: string = fs.readFileSync(R('entry/src/main/resources/base/profile/main_pages.json'), 'utf8');

// ── ① 三段式：日志 → 重试 → 兜底 ───────────────────────────────────────────────
ok('扫到 EntryAbility（非空）—— 零扫描判红', ability.length > 0);
ok('① 失败 ⇒ **明确 tag 的 error 日志**（`loadContent failed` + `hilog.error(DOMAIN, TAG`）',
  ability.indexOf('loadContent failed') >= 0 && ability.indexOf('hilog.error(DOMAIN, TAG') >= 0);
ok('② 失败 ⇒ **重试一次**（递归调 `loadContentWithRetry(windowStage, attempt + 1)`）',
  ability.indexOf('loadContentWithRetry(windowStage, attempt + 1)') >= 0);
ok('② 重试次数有**具名常量**（`MAX_LOAD_RETRY`，⛔ 不散裸数字）', ability.indexOf('MAX_LOAD_RETRY') >= 0);
ok('③ 两试均失败 ⇒ 加载**最小兜底页** `pages/Fallback`',
  ability.indexOf("loadContent('pages/Fallback'") >= 0);
ok('  而起始调用走 `loadContentWithRetry(windowStage, 0)`（onWindowStageCreate 不再裸调 loadContent）',
  ability.indexOf('loadContentWithRetry(windowStage, 0)') >= 0);
// ⛔ 反例：不能只有 "log + return"（静默）
ok('⛔ 失败分支**不是**"log 完就 return"（回到静默 ⇒ 本条必红）',
  !(ability.indexOf('loadContent failed') >= 0 && ability.indexOf('loadContentWithRetry(windowStage, attempt + 1)') < 0));

// ── ② 兜底页本身：极简、已注册、零颜色字面量 ────────────────────────────────────
ok('兜底页存在：pages/Fallback.ets', fs.existsSync(R('entry/src/main/ets/pages/Fallback.ets')));
ok('兜底页是 `@Entry`（可被 loadContent 加载）', fbCode.indexOf('@Entry') >= 0);
ok('兜底页**已注册**进 main_pages.json', pagesRaw.indexOf('pages/Fallback') >= 0);
ok('兜底页仍注册主页面 pages/Index（⛔ 别把主页删了）', pagesRaw.indexOf('pages/Index') >= 0);
ok('兜底页**零颜色字面量**（色/字号全走 token：colorOf(...) / typeOf(...)）',
  !/#[0-9A-Fa-f]{6}/.test(fbCode) && fbCode.indexOf('colorOf(') >= 0 && fbCode.indexOf('typeOf(') >= 0);
ok('兜底页**不引**业务模块（⛔ 不 store/http —— 兜底页自己再失败就越兜越糟）',
  fbCode.indexOf('store') < 0 && fbCode.indexOf('/http') < 0);
// ⛔ 兜底页不许有"加载中/动效"之类会再失败的依赖
ok('兜底页**无动画/定时器**（静态一帧）',
  fbCode.indexOf('animateTo') < 0 && fbCode.indexOf('setTimeout(') < 0 && fbCode.indexOf('.transition(') < 0);

if (fail > 0) { console.log(`  loadcontent_fallback: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  loadcontent_fallback: ${pass} passed, 0 failed`);
process.exit(0);

/**
 * 深链命令路由门禁（S1）—— **纯逻辑**（解析/形状/注册）+ **接线源码形态**。
 *
 * 背景：`core/command` 被零消费审计列为"零生产消费者"；本波把它接到**深链入口**
 * `entryability/EntryAbility.ets`（`want.uri`）—— 这是它的**唯一生产消费点**。
 *
 * web 权威（只读 `/Users/bobli/src/xbot/web`）：
 *   · `src/lib/commandRouter.ts:113-133 parseUri()`：三种等价前缀（`xbot://` / `xbot:` / `/command/`）、
 *     id 去尾斜杠、query 走 `URLSearchParams`；**非命令 URI ⇒ `null`**。
 *   · `:88-92 execute()`：**未注册命令 ⇒ `throw`**（"拼错命令名应该立刻暴露，不静默失败"）。
 *   · `src/layouts/AppShell.tsx:118-152 registerAll([...])`：**4 条**命令
 *     （`settings.open`(+`section`) / `sidebar.toggle` / `session.new` / `input.focus`）。
 *
 * ⛔ 判据纪律：读**真实源码**、**剥注释保留换行**、**零扫描判红**。
 * mutation 自证：删掉 `EntryAbility` 里的 `captureCommandUri(...)` 调用（或整段方法）⇒ 本判据必红。
 *
 * ⚠️ 有 `export {}`/`import`（⇒ TS 模块），避免与"无 import 的全局脚本"测试撞名（本仓已入库 GOTCHA）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

import {
  COMMAND_INPUT_FOCUS, COMMAND_SESSION_NEW, COMMAND_SETTINGS_OPEN, COMMAND_SIDEBAR_TOGGLE,
  PENDING_COMMAND_KEY, PENDING_COMMAND_SEQ_KEY,
  commandActionValid, commandDispatchable, commandIdValid, commandRegistered, isCommandUri,
  parseCommandUri, registeredCommands,
} from '../../entry/src/main/ets/core/command';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
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

// ── ① 解析层（与 web `parseUri` 同源；未知 scheme / 空 id 必须 ⇒ null）──────────────
{
  eq('未知 scheme ⇒ null', parseCommandUri('https://example.com/x'), null);
  eq('空前缀体（xbot://）⇒ null', parseCommandUri('xbot://'), null);
  eq('空 id（xbot://?x=1）⇒ null', parseCommandUri('xbot://?x=1'), null);
  eq('非字符串 null ⇒ null（防御）', parseCommandUri(null as unknown as string), null);
  eq('空串 ⇒ null', parseCommandUri(''), null);
  eq('xbot://settings.open ⇒ id 解析出来', parseCommandUri('xbot://settings.open')?.id, 'settings.open');
  eq('  ⇒ isCommandUri=true', isCommandUri('xbot://settings.open'), true);
  eq('https ⇒ isCommandUri=false', isCommandUri('https://example.com'), false);
  eq('单冒号形态（xbot:settings.open）同源', parseCommandUri('xbot:settings.open')?.id, 'settings.open');
  eq('/command/ 前缀同源', parseCommandUri('/command/settings.open')?.id, 'settings.open');
  eq('id 去尾斜杠', parseCommandUri('xbot://settings.open/')?.id, 'settings.open');
  eq('query 解析（& 分隔 + 百分号解码）', parseCommandUri('xbot://settings.open?section=llm&q=a%20b')?.args,
    { section: 'llm', q: 'a b' });
  eq('`+` 当空格（对齐 URLSearchParams）', parseCommandUri('xbot://settings.open?q=a+b')?.args.q, 'a b');
}

// ── ② 形状校验 + **注册白名单**（web `has()`；⛔ 形状合法 ≠ 已注册）─────────────────
{
  eq('已注册命令 = 4 条（逐条对应 web AppShell registerAll）', registeredCommands().length, 4);
  eq('  含 settings.open', registeredCommands().indexOf(COMMAND_SETTINGS_OPEN) >= 0, true);
  eq('  含 sidebar.toggle', registeredCommands().indexOf(COMMAND_SIDEBAR_TOGGLE) >= 0, true);
  eq('  含 session.new', registeredCommands().indexOf(COMMAND_SESSION_NEW) >= 0, true);
  eq('  含 input.focus', registeredCommands().indexOf(COMMAND_INPUT_FOCUS) >= 0, true);
  ok('全部已注册 id 都通过**形状**校验（白名单不藏非法 id）',
    registeredCommands().every((id: string) => commandIdValid(id)));

  eq('已注册 ⇒ registered=true', commandRegistered('settings.open'), true);
  eq('**未注册**（如 tools.do）⇒ false', commandRegistered('tools.do'), false);
  eq('空 id ⇒ false', commandRegistered(''), false);

  // 形状：必须点号命名空间
  eq('无点 ⇒ 形状非法（web id 全带命名空间）', commandIdValid('settings'), false);
  eq('以点开头 ⇒ 非法', commandIdValid('.settings'), false);
  eq('以点结尾 ⇒ 非法', commandIdValid('settings.'), false);
  eq('连续点 ⇒ 非法', commandIdValid('settings..open'), false);
  eq('含非法字符（空格）⇒ 非法', commandIdValid('settings open'), false);
  eq('settings.open ⇒ 形状合法', commandIdValid('settings.open'), true);

  // ⛔ 核心：形状合法 **但未注册** ⇒ 不可派发（web 会 throw）
  const badShape: string = 'totally.madeup';
  ok('形状合法但**未注册** ⇒ commandIdValid=true 而 dispatchable=false（两者分工）',
    commandIdValid(badShape) === true && commandDispatchable(parseCommandUri('xbot://' + badShape)) === false);
  eq('已注册且形状合法 ⇒ dispatchable=true', commandDispatchable(parseCommandUri('xbot://settings.open')), true);
  eq('未注册 ⇒ dispatchable=false', commandDispatchable(parseCommandUri('xbot://a.b')), false);
  eq('形状非法 ⇒ dispatchable=false', commandDispatchable(parseCommandUri('xbot://nodot')), false);
  eq('null ⇒ dispatchable=false（防御）', commandDispatchable(null), false);
  eq('  且 commandActionValid(null)=false', commandActionValid(null), false);
  ok('待消费键是具名常量（⛔ 页面不得硬写字符串）',
    PENDING_COMMAND_KEY.length > 0 && PENDING_COMMAND_SEQ_KEY.length > 0
    && PENDING_COMMAND_KEY !== PENDING_COMMAND_SEQ_KEY);
}

// ── ★③ 接线源码形态（`entryability/**` 不进离线 harness ⇒ 读真实源码）──────────────
{
  let root: string = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/entryability/EntryAbility.ets'))) { root = p; break; }
  }
  ok('读到 entryability/EntryAbility.ets', root.length > 0);
  const oc: string = stripComments(fs.readFileSync(
    path.join(root, 'entry/src/main/ets/entryability/EntryAbility.ets'), 'utf8'));
  ok('扫到源码（非空）—— 零扫描判红', oc.length > 0);
  // ── **扫描器自证**（⛔ 不空转）：打印"扫了哪个文件 + 逐形态命中数 + 白名单集合" ──
  {
    const nParse: number = (oc.match(/parseCommandUri\(/g) || []).length;
    const nIsCmd: number = (oc.match(/isCommandUri\(/g) || []).length;
    const nShape: number = (oc.match(/commandActionValid\(/g) || []).length;
    const nReg: number = (oc.match(/commandRegistered\(/g) || []).length;
    const nCall: number = (oc.match(/this\.captureCommandUri\(want\);/g) || []).length;
    const nLogErr: number = (oc.match(/hilog\.error\(DOMAIN, TAG/g) || []).length;
    const nDrop: number = (oc.match(/AppStorage\.setOrCreate<string>\(PENDING_COMMAND_KEY/g) || []).length;
    console.log(`▶ 深链接线扫描：entryability/EntryAbility.ets（剥注释后 ${oc.length} 字符）`);
    console.log(`    命中：parseCommandUri=${nParse} · isCommandUri=${nIsCmd} · commandActionValid=${nShape}`
      + ` · commandRegistered=${nReg} · captureCommandUri(want)=${nCall} · hilog.error=${nLogErr}`
      + ` · setOrCreate(PENDING_COMMAND_KEY)=${nDrop}`);
    console.log(`    白名单：${registeredCommands().join(' | ')}`);
    ok('自证：四道形态各至少命中 1（扫描器不是空转）',
      nParse >= 1 && nIsCmd >= 1 && nShape >= 1 && nReg >= 1);
  }

  ok('③ 真 import `../core/command`', oc.indexOf("from '../core/command'") >= 0);
  ok('③ 生产调用 `parseCommandUri(` ≥ 1（消零消费）', (oc.match(/parseCommandUri\(/g) || []).length >= 1);
  ok('③ 三道闸门都在：isCommandUri / commandActionValid / commandRegistered',
    oc.indexOf('isCommandUri(') >= 0 && oc.indexOf('commandActionValid(') >= 0 && oc.indexOf('commandRegistered(') >= 0);
  ok('③ 冷启动 + 热启动**两条**通路都接（`this.captureCommandUri(want);` ×2）',
    (oc.match(/this\.captureCommandUri\(want\);/g) || []).length >= 2);
  ok('③ 合法 ⇒ **投递待消费键**（AppStorage.setOrCreate<string>(PENDING_COMMAND_KEY, …)）',
    oc.indexOf('AppStorage.setOrCreate<string>(PENDING_COMMAND_KEY') >= 0);
  // ⛔ 不静默：非法/未注册两条路都必须 hilog.error（web 是 throw ⇒ 本端"明确报错但不崩"）
  ok('⛔ 形状非法 ⇒ `hilog.error(DOMAIN, TAG` 明确报错（不静默）',
    oc.indexOf('deep-link 命令形状非法') >= 0 && oc.indexOf('hilog.error(DOMAIN, TAG') >= 0);
  ok('⛔ 未注册 ⇒ `hilog.error(DOMAIN, TAG` 明确报错 + 列出已注册集合（不静默）',
    oc.indexOf('未注册') >= 0 && oc.indexOf('registeredCommands().join(') >= 0);
  ok('③ 非命令 URI（普通链接）⇒ **不接管**（早返回，不误报错）',
    oc.indexOf('if (!isCommandUri(uri))') >= 0);
  ok('③ 全链旁路保护（try/catch ⇒ 深链异常绝不影响启动）', oc.indexOf('captureCommandUri skipped') >= 0);
}

if (fail > 0) { console.log(`  command_deeplink: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  command_deeplink: ${pass} passed, 0 failed`);
process.exit(0);

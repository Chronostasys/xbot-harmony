/**
 * 空态/失败态**文案**门禁 —— "所有细节都做好"（空/失焦/边界态审计）。
 *
 * 动机：每面的"**什么都没有**"长相最容易被糊弄过去（裸白屏、`No data`、`null`、原始错误码）——
 *   而"**极简/干净**"恰恰在这种状态最容易露馅（用户口径）。
 *
 * ── 本判据守什么（可离线的部分）─────────────────────────────────────────────────
 *   ① **禁"机器语"**：空/失败/加载文案里不得出现 `No data` / `null` / `undefined` / `NaN` /
 *      `Error:` / 裸 HTTP 码（`401`/`500` 之类**单独成句**）—— 那些是**开发者的语言**，不是用户语。
 *   ② **禁裸技术串**：不得把 `JSON.stringify(` 之类的**原始序列化**直接塞进 `Text(...)`。
 *   ③ **逐面有文案**：台账列出"已被审计的空/失败态面"（文件 → 文案数）；**零扫描判红**；
 *      台账**只许缩短**（口径：不得出现新文件的新面 ⇒ 新面必须来登记）。
 *
 * ⚠️ 本判据**不判**"文案写得好不好"（那是人眼/真机的事）—— 它只把**可离线证伪**的那半钉住：
 *   "到底有没有用用户语、有没有把机器语漏给用户"。
 *
 * ⛔ 纪律：**剥注释**（注释里写 `No data` 是文档）；**零扫描判红**；断言落在汇总 `if (fail>0)` **之前**
 *   （本仓 GOTCHA：写在汇总之后 = **死区**，永不执行）。
 * mutation：往任一组件加 `Text('No data')` ⇒ ① 必红。
 *
 * ⚠️ 有 `export {}`（⇒ TS 模块），避免与"无 import 的全局脚本"测试在聚合编译里撞名（本仓已入库 GOTCHA）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');
export {};

// ── ④ 的**标签真源** = `core/settings.ets:settingLabel`（⛔ 不自造表；KEY_* 一起导入以解析 `settingLabel(KEY_X)`）。
import {
  settingLabel, KEY_APP_THEME, KEY_ACCENT, KEY_MD_THEME, KEY_LOCALE, KEY_FONT_SCALE, KEY_CODE_WRAP,
  KEY_SEND_KEY, KEY_REASONING_DEFAULT, KEY_ORB, KEY_NOTIFY_ASK, KEY_NOTIFY_TURN_DONE, KEY_NOTIFY_DETAIL,
} from '../../entry/src/main/ets/core/settings';
/** 源码标识符（`KEY_X`）→ 真值（用于把 `settingLabel(KEY_X)` 解析成标签文案）。 */
const KEYMAP: { [k: string]: string } = {
  KEY_APP_THEME, KEY_ACCENT, KEY_MD_THEME, KEY_LOCALE, KEY_FONT_SCALE, KEY_CODE_WRAP,
  KEY_SEND_KEY, KEY_REASONING_DEFAULT, KEY_ORB, KEY_NOTIFY_ASK, KEY_NOTIFY_TURN_DONE, KEY_NOTIFY_DETAIL,
};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
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
function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'entry/src/main/ets/components'))) { return p; }
  }
  return '';
}
function walk(dir: string, out: string[]): void {
  let ents: any[] = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, out); }
    else if (e.name.endsWith('.ets')) { out.push(full); }
  }
}

/** 「机器语」黑名单（⛔ 这些是**开发者的话**，不该出现在空/失败/加载文案里）。 */
const MACHINE: RegExp[] = [
  /\bNo data\b/i, /\bnull\b/, /\bundefined\b/, /\bNaN\b/, /\bError:/, /\bERR_[A-Z]/, /\bJSON\.stringify\(/,
];
/** 单独的裸 HTTP 码（`401` 独立成句 ⇒ 机器语；带解释的 `401 未授权` 不算 —— 用户能懂）。 */
const BARE_HTTP: RegExp = /['"`](4\d\d|5\d\d)['"`]/;

/** 「像人话」的判定：**不含代码标点**（代码片段 / 注入的 JS 串会被排除 —— 它们不是面向用户的文案）。
 *  ⛔ 不加这一层就会把 `… !== undefined ? …`、`JSON.stringify(window.__xbotProbe)` 这类**代码**判成"文案"
 *  ⇒ 假红（我第一版正是这样：加了黑名单却把输入集放宽到"所有字面量"，立刻 3 处假红）。 */
function isCopyLike(s: string): boolean {
  return !/[(){}\[\]?:;,=+&|$`<>]/.test(s) && !/\b(return|=>|function|window|console)\b/.test(s);
}

const root: string = findRoot();
ok('探测到仓库根', root.length > 0);
const ETS: string = path.join(root, 'entry/src/main/ets');
const files: string[] = [];
walk(path.join(ETS, 'components'), files);
walk(path.join(ETS, 'pages'), files);
ok(`零扫描判红：扫到 .ets > 0（实得 ${files.length}）`, files.length > 0);

const violations: string[] = [];
const dist: string[] = [];
for (const f of files) {
  const rel: string = path.relative(ETS, f).split(path.sep).join('/');
  const src: string = stripComments(fs.readFileSync(f, 'utf8'));
  // ⛔ 两个集合必须分开（**我第一版把它们混了 ⇒ mutation 打不红 = 自造假绿**）：
  //    · `lits`（**全部**字符串字面量）= **黑名单的输入** —— 机器语（`No data`）本来就不含中文，
  //      若只用"含中文"的集合去查黑名单，等于**永远查不到 `No data`**；
  //    · `zhLits`（含中文）= **台账/零扫描**的口径（"面向用户的文案"）。
  const lits: string[] = [];
  let zh = 0;
  const re = /'([^'\n]{2,120})'|"([^"\n]{2,120})"/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    const s: string = m[1] !== undefined ? m[1] : m[2];
    lits.push(s);
    if (/[\u4e00-\u9fa5]/.test(s)) { zh++; }
    m = re.exec(src);
  }
  if (zh > 0) { dist.push(`${rel}: 中文文案 ${zh} 条`); }
  for (const s of lits) {
    if (!isCopyLike(s)) { continue; }   // ⛔ 只判"像人话"的字面量（排除代码片段/注入 JS）⇒ 防假红
    for (const bad of MACHINE) {
      if (bad.test(s)) { violations.push(`${rel}: 文案含机器语 ${JSON.stringify(s)}`); break; }
    }
    if (BARE_HTTP.test(s)) { violations.push(`${rel}: 文案是裸 HTTP 码 ${JSON.stringify(s)}`); }
  }
}

console.log(`▶ 空/失败态文案扫描：${files.length} 个 .ets`);
for (const d of dist.slice(0, 12)) { console.log(`    · ${d}`); }
if (dist.length > 12) { console.log(`    · …另 ${dist.length - 12} 个文件`); }
ok('扫到面向用户的中文文案 > 0（⛔ 扫描器没空转）', dist.length > 0);
if (violations.length === 0) {
  ok('① + ② 空/失败文案里无机器语（`No data`/`null`/`undefined`/`NaN`/`Error:`/裸 HTTP 码/裸 `JSON.stringify`）', true);
} else {
  for (const v of violations) { ok(`空态文案违规：${v}（改用用户语）`, false); }
}

// ── ③ 用户文案**禁整体全角括号包裹**（批次 13c 统一）─────────────────────────────
// 口径：面向用户的文案是**陈述句/标签**（web 权威 i18n：`暂无数据`/`暂无内容`/`暂无插件` —— 一律无括号），
//   **不是**「（这里什么都没有）」式的括注 —— 后者读起来像占位符/开发备注，与 Apple 式干净文案相悖
//   （用户目标③「对标苹果」）。真机取证（2026-10-12）：10 处括注（AskUserSheet/StatusSheet/ToolPopover×2/
//   TaskDetailSheet/Index×3/SettingsPlugins×2）⇒ 全部去括号成陈述句。
// 形态：**整条**字符串字面量被全角括号包裹（`'（…）'`）—— 覆盖 `Text('（…）')`、`Text(cond ? '（…）' : …)`
//   与变量赋值（`x = '（…）'`）三种载体。⛔ `[^']` 保证不跨引号（相邻两串不会误并）。
// 白名单（⛔ 逐字 web parity、且被他测钉住 ⇒ 不得改）：`MessageRow.EMPTY_NOTICE_TEXT = '（无文本输出）'`
//   （= web `i18n.emptyAssistant`，`empty_notice.test.ts:117` 逐字钉）。
const PAREN_WRAP: RegExp = /'（[^'\n]{1,60}）'/g;
const PAREN_ALLOW: string[] = ['（无文本输出）'];
const parenHits: string[] = [];
for (const f of files) {
  const rel: string = path.relative(ETS, f).split(path.sep).join('/');
  const src: string = stripComments(fs.readFileSync(f, 'utf8'));
  const hits: string[] | null = src.match(PAREN_WRAP);
  if (hits !== null) {
    for (const h of hits) {
      if (PAREN_ALLOW.indexOf(h.slice(1, -1)) < 0) { parenHits.push(`${rel}: ${h}`); }
    }
  }
}
if (parenHits.length === 0) {
  ok('③ 用户文案无整体全角括号包裹（`\'（…）\'` 占位 = 0，除 web-parity 白名单）', true);
} else {
  for (const v of parenHits) { ok(`占位括注违规：${v}（去全角括号 ⇒ 陈述句/标签）`, false); }
}

// ── ④ 设置行**描述不得复述标签**（批次 13e 统一）─────────────────────────────────
// 口径（Apple 式设置行）：标签是**名词短语**（"应用主题"），描述只补充**它没说的信息**；
//   ⛔ 描述以标签原文开头 ⇒ 读成"应用主题 / 应用主题（含…）"，复述 = 噪声。真机截图取证（2026-10-12）：
//   `SettingsAppearance.ets:155` 原为 `'应用主题（含原生独享的「极简白」）。'` ⇒ 读成"应用主题 / 应用主题…"。
// 解析：`label:` 为字符串字面量或 `settingLabel(KEY_X)`（真源 `core/settings.ets`）；解析不到 ⇒ 跳过。
// ⛔ 零扫描判红；mutation：把那行改回复述串 ⇒ 必红。
const settingsFiles: string[] = files.filter((f) => /[\\/]components[\\/]Settings[^\\/]*\.ets$/.test(f));
const dupHits: string[] = [];
let rowPairs = 0;
for (const f of settingsFiles) {
  const rel: string = path.relative(ETS, f).split(path.sep).join('/');
  const src: string = stripComments(fs.readFileSync(f, 'utf8'));
  const callRe = /Settings[A-Za-z]+Row\(\{/g;
  let cm: RegExpExecArray | null = callRe.exec(src);
  while (cm !== null) {
    const open = cm.index + cm[0].length - 1;   // 指向 '{'
    let depth = 0; let j = open; let end = -1;
    while (j < src.length) {
      const ch = src.charAt(j);
      if (ch === '{') { depth++; } else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
      j++;
    }
    if (end > open) {
      const block = src.slice(open + 1, end);
      const lm = /label:\s*([^,\n]+)/.exec(block);
      const dm = /description:\s*'([^'\n]*)'/.exec(block);
      if (lm !== null && dm !== null) {
        const expr = lm[1].trim();
        let label = '';
        const lit = /^'([^']*)'$/.exec(expr);
        const sl = /^settingLabel\(([A-Za-z0-9_]+)\)$/.exec(expr);
        if (lit !== null) { label = lit[1]; }
        else if (sl !== null && KEYMAP[sl[1]] !== undefined) { label = settingLabel(KEYMAP[sl[1]]); }
        if (label.length > 0) {
          rowPairs++;
          const desc = dm[1];
          if (desc.indexOf(label) === 0) {
            dupHits.push(`${rel}: 标签「${label}」被描述复述（描述="${desc}"）`);
          }
        }
      }
    }
    cm = callRe.exec(src);
  }
}
ok(`零扫描判红：设置行 label+description 配对 > 0（实得 ${rowPairs}）`, rowPairs > 0);
if (dupHits.length === 0) {
  ok('④ 设置行描述不以标签原文开头（不复述标签）', true);
} else {
  for (const v of dupHits) { ok(`设置行描述复述标签：${v}（描述只补充标签没说的信息）`, false); }
}

if (fail > 0) { console.log(`  empty_state_copy: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  empty_state_copy: ${pass} passed, 0 failed`);
process.exit(0);

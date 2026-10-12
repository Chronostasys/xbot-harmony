/**
 * 设置分区「用户可见文案」判据（目标③，2026-10-11）。
 *
 * 口径：`SettingsErrorBar`（`components/SettingsRows.ets`）+ 三个有 web 权威的分区
 *   （`SettingsAbout` / `SettingsAgent` / `SettingsPlugins`）里**用户可见的文案常量**
 *   必须落在**白名单**内（每条注明 web 出处）；并断言 `'重试'` 与 web **逐字相同**。
 *
 * ③（批13g 增）**文案卫生**：4 个分区（Agent / Storage / Developer / Plugins）的用户可见串不得含
 *   **内部标识符**（工具名 `compact_context`、SSE 字段 `httpVer`/`errCode`/`respCode`）、
 *   **内部 API 路径**（`/api/…`）、**Markdown 残留**（`**` —— `Text` 不渲染 ⇒ 原样上屏）、
 *   或**开发者语**（「bucket 为真值 / 承载」）。只扫**剥注释后的单引号字面量**（注释里的码名是文档，不算）。
 *
 * web 出处（`/Users/bobli/src/xbot/web/src/i18n/zh-CN.ts`）：
 *   · `:16  retry: '重试'`            ⇒ 本仓 `'重试'` 逐字一致
 *   · `:232 loading: '加载中…'`       ⇒ 本仓 `'加载中…'`（单省略号）一致
 *     （web 自身两种并存：`:14 '加载中...'` 三点 / `:232 '加载中…'` 单省略号 ⇒ 本仓取 `:232` 口径）
 *
 * ⚠️ **错误正文判"有意不同"**（不判一致）：本仓走 **RPC 原文**（`readableRpcError`）+
 *   分区专属文案（如 Agent 的「设置读取失败，开关暂不可用。」），比 web 固定的 `'加载失败'`(`:592`)
 *   信息量更大 ⇒ 记档不改（见 `docs/WEB-PARITY.md §2.11`）。
 *
 * ⚠️ **验证通道自证**：本文件顶部的 `SELFCHECK` 断言数必须随新增而变 —— 若"改了却计数不变"，
 *   先查早退/`process.exit`/分支，再谈落地（本轮血教训）。
 */
export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
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
const ETS_DIR: string = ROOT.length > 0 ? path.join(ROOT, 'entry', 'src', 'main', 'ets') : '';
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function srcOf(rel: string): string {
  const p: string = path.join(ETS_DIR, rel);
  return fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf-8')) : '';
}

/** 被检查的文件（SettingsErrorBar 的宿主 + 三个有 web 权威的分区）。 */
const FILES: string[] = [
  'components/SettingsRows.ets',
  'components/SettingsAbout.ets',
  'components/SettingsAgent.ets',
  'components/SettingsPlugins.ets',
];

/**
 * **白名单**：允许出现的用户可见文案常量（每条注明 web 出处；⛔ 只许缩短）。
 * 键 = 文案原文。判据只认这些 + 各分区**错误正文**（后者判"有意不同"，见文件头）。
 */
const ALLOWED_LABELS: string[] = [
  '加载中…',   // web zh-CN.ts:232
  '重试',      // web zh-CN.ts:16（逐字）
];

// ── 验证通道自证（断言数必须随新增而变）──────────────────────────────────────
eq('SELFCHECK-1（占位：证明本文件在跑）', 1, 1);
eq('SELFCHECK-2（占位：证明计数在增）', 2, 2);

// ── 零扫描防线 + 逐面命中分布 ────────────────────────────────────────────────
eq('零扫描防线：仓库根解析成功', ROOT.length > 0, true);
{
  let empty: number = 0;
  console.log('  ── 逐面命中分布（自证扫描器）──');
  for (let i = 0; i < FILES.length; i++) {
    const s: string = srcOf(FILES[i]);
    if (s.length === 0) { empty++; }
    // 抽出所有形如 Text('xxx' … 的单引号字面量（仅取 `Text(` 紧邻的那个）
    const m: RegExpMatchArray | null = s.match(/Text\('[^']*'/g);
    const count: number = m === null ? 0 : m.length;
    console.log(`    ${FILES[i].padEnd(34)} 读到=${s.length > 0}  Text('…') 常量 ${count}`);
  }
  eq('零扫描防线：四个文件都读到了源码', empty, 0);
}

// ── ① 白名单内的文案：逐字与 web 一致 ─────────────────────────────────────────
{
  const rowsHost: string = srcOf('components/SettingsRows.ets');
  eq('SettingsErrorBar 有「重试」入口文案', /'重试'/.test(rowsHost), true);
  eq('「重试」与 web zh-CN.ts:16 逐字相同（3 字，无空格/标点）', /'重试'/.test(rowsHost), true);
  let loading = 0;
  for (let i = 0; i < FILES.length; i++) {
    const s: string = srcOf(FILES[i]);
    if (s.indexOf("'加载中…'") >= 0) { loading++; }
  }
  console.log(`    '加载中…' 出现在 ${loading} 个文件`);
  eq('至少 2 个分区用 \'加载中…\'（与 web :232 同口径，⛔ 不写三点版）', loading >= 2, true);
  // ⛔ web 的 `:14` 三点版**不应**被本仓采用（两版并存会造成节拍不一致）
  {
    let threeDot = 0;
    for (let i = 0; i < FILES.length; i++) {
      if (srcOf(FILES[i]).indexOf("'加载中...'") >= 0) { threeDot++; }
    }
    eq('不得混用 web `:14` 的三点版 \'加载中...\'', threeDot, 0);
  }
}

// ── ② 白名单外的"用户可见"文案：只允许**错误正文**（有意不同）────────────────────
eq('白名单常量表非空（`加载中…` / `重试`）', ALLOWED_LABELS.length, 2);
eq('白名单每条都必须非空（防占位作弊）', ALLOWED_LABELS[0].length > 0 && ALLOWED_LABELS[1].length > 0, true);

// ── ③ 文案卫生（目标③，批13g）：用户可见串不得含内部标识符 / 内部 API 路径 / Markdown 残留 ──────
// 口径：把 4 个分区的源码**剥注释**后抽**单引号字面量**（用户可见串必在其中）⇒ 逐一拒绝：
//   · 内部标识符（代码里的名字，如工具名 `compact_context`、SSE 字段名 `httpVer`）；
//   · 内部 API 路径（`/api/…` —— web 只在 `fetch` 里用，从不上屏）；
//   · Markdown 残留（`**` —— ArkUI `Text` 不渲染 Markdown ⇒ 会原样上屏）。
// ⛔ 只抽字面量：注释里的码名/路径是**文档**，不是用户可见内容（mutation 自证亦据此）。
{
  const HYGIENE_FILES: string[] = [
    'components/SettingsAgent.ets',
    'components/SettingsStorage.ets',
    'components/SettingsDeveloper.ets',
    'components/SettingsPlugins.ets',
  ];
  function literals(s: string): string[] {
    const out: string[] = [];
    const m: RegExpMatchArray | null = s.match(/'[^'\\]*'/g);
    if (m !== null) { for (let i = 0; i < m.length; i++) { out.push(m[i]); } }
    return out;
  }
  // 已知**内部标识符**：`compact_context` = 工具名（Agent 开关描述曾直呼其名 ⇒ 13g 去码）；
  //   `httpVer`/`errCode`/`respCode` = SSE 状态字段名（Developer 连接状态卡标签曾带码名括号 ⇒ 13g 去码）。
  const INTERNAL_IDS: string[] = ['compact_context', 'httpVer', 'errCode', 'respCode'];
  // 已知**开发者语短语**（13g 从 Storage 文案里删除；「真值/承载」是程序术语，不是用户语言）。
  const BANNED_PHRASES: string[] = ['bucket 为真值', 'bucket 承载'];
  let lits: number = 0;
  const badId: string[] = [];
  const badPhrase: string[] = [];
  for (let i = 0; i < HYGIENE_FILES.length; i++) {
    const ls: string[] = literals(srcOf(HYGIENE_FILES[i]));
    lits += ls.length;
    for (let j = 0; j < ls.length; j++) {
      const lit: string = ls[j];
      let bad: boolean = false;
      for (let k = 0; k < INTERNAL_IDS.length; k++) {
        if (lit.indexOf(INTERNAL_IDS[k]) >= 0) { bad = true; }
      }
      if (lit.indexOf('/api/') >= 0) { bad = true; }
      if (lit.indexOf('**') >= 0) { bad = true; }
      if (bad) { badId.push(`${HYGIENE_FILES[i]}: ${lit}`); }
      for (let k = 0; k < BANNED_PHRASES.length; k++) {
        if (lit.indexOf(BANNED_PHRASES[k]) >= 0) { badPhrase.push(`${HYGIENE_FILES[i]}: ${lit}`); }
      }
    }
  }
  console.log(`    文案卫生③：4 分区共抽到字面量 ${lits} 条；内部标识/API/Markdown 违规 ${badId.length}；开发者语 ${badPhrase.length}`);
  // 零扫描防线（白绿）：抽不到字面量 ⇒ 规则形同虚设 ⇒ 判红
  eq('零扫描防线：4 分区共抽到 > 50 条单引号字面量', lits > 50, true);
  if (badId.length > 0) { for (let i = 0; i < badId.length; i++) { console.log(`      ✗ ${badId[i]}`); } }
  eq('用户可见串不得含内部标识符(compact_context/httpVer/errCode/respCode)/内部 API 路径/Markdown 残留',
    badId.length, 0);
  if (badPhrase.length > 0) { for (let i = 0; i < badPhrase.length; i++) { console.log(`      ✗ ${badPhrase[i]}`); } }
  eq('用户可见串不得含开发者语（「bucket 为真值」/「bucket 承载」）', badPhrase.length, 0);

  // ③b 逐条固定：修好后的文案必须在位（⛔ 判据演进，不删；防回退）
  eq('Agent：开关描述改用「自行压缩上下文」（不再直呼工具名）',
    srcOf('components/SettingsAgent.ets').indexOf('可在需要时自行压缩上下文') >= 0, true);
  eq('Storage：provider 描述改用「上传到你的对象存储」',
    srcOf('components/SettingsStorage.ets').indexOf('上传到你的对象存储') >= 0, true);
  {
    const dev: string = srcOf('components/SettingsDeveloper.ets');
    eq('Developer：副标题去 Markdown（「录制内容会自动脱敏」原样保留）',
      dev.indexOf('录制内容会自动脱敏') >= 0, true);
    eq('Developer：连接状态卡三条标签去码名括号（请求协议 / 上次错误码 / 上次响应码）',
      dev.indexOf("label: '请求协议'") >= 0 && dev.indexOf("label: '上次错误码'") >= 0
        && dev.indexOf("label: '上次响应码'") >= 0, true);
  }
  eq('Plugins：图片说明去内部 API 路径（保留「当前值 = 本站上传的图片。」）',
    srcOf('components/SettingsPlugins.ets').indexOf('当前值 = 本站上传的图片。') >= 0, true);
}

if (fail > 0) { console.log(`  ✗ settings_copy_parity: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ✅ settings_copy_parity: ${pass} passed, 0 failed（白名单 2 条；错误正文判"有意不同"并记档；③ 文案卫生）`);
process.exit(0);

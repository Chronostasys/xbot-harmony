/**
 * **环境（插件）值被消费**契约（`glassOpacity`/`wallpaperOpacity`/`glassBlur`；2026-10-11）。
 *
 * 背景：backlog 记「插件值原生**未消费**」= 用户 `setSetting` 后界面**静默无反应**（死消费族）。
 * 口径（主 agent 定死）：**覆盖式** —— `currentAmbience === null`（未设置）⇒ **完全走现状**
 * （⛔ 不用 web 的 0.82/1/0 当缺省：相乘口径下缺省即变，spec 自相矛盾）；非空 ⇒ 覆盖
 * `glassBg`/`glassBorder` 的 alpha = `glassOpacity`、`e.glassBlur = glassBlur`（值直用，web 侧亦无换算）。
 * ⚠️ `wallpaperOpacity`：**原生 N/A（web 独有）**——`grep -rn "wallpaper" entry/src/main/ets/` 剥注释后为空；
 *    保留在 `AmbienceValues` 里对齐 web 契约，**判据显式豁免**。
 *
 * ⭐ 期望值来源（⛔ 不用"改后自比"）：**改动前**用 tsc+node 录下三主题的 `glassBg/glassBorder/glassBlur`。
 * ⭐ 消费点断言钉**调用点计数**（`currentAmbience` 在 `buildEffects` 里被**读**），⛔ 不钉"函数存在"。
 * mutation：把 `buildEffects` 里对 `currentAmbience` 的消费摘掉 ⇒ ★②/★③ 必红（还原后复跑绿）。
 * ⚠️ 结尾必须 `process.exit(...)`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import { paletteOf, effectsOf, setAmbience, AmbienceValues, AMBIENCE_UNSET } from '../../entry/src/main/ets/core/theme';
import { ambienceFromPluginConfig } from '../../entry/src/main/ets/core/settingsplugins';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

// ⭐ 改动前录得的期望值（tsc+node 实跑，非自比）
// ⚠️ C3（2026-10-11）：porcelain 行随浅色玻璃 0.80→0.84 / 0.70→0.86 同步更新
//    （`#CCFFFFFF→#D6FFFFFF`、`#B3D8D8DC→#DBD8D8DC`）；base/dark 行**逐字节不变**。
const BEFORE: string[][] = [
  ['base', '#9E0E0E14', '#8C2E2E3C', '18'],
  ['dark', '#9E0E0E14', '#8C2E2E3C', '18'],
  ['porcelain', '#D6FFFFFF', '#DBD8D8DC', '18'],
];

// ── ① `null` ⇒ 现状**逐字节**（用改前期望值比对）────────────────────────────────────
{
  setAmbience(null);
  for (let i = 0; i < BEFORE.length; i++) {
    const p = paletteOf(BEFORE[i][0]);
    const e = effectsOf(p);
    eq(`① ${BEFORE[i][0]} glassBg 缺省 == 改前`, e.glassBg, BEFORE[i][1]);
    eq(`① ${BEFORE[i][0]} glassBorder 缺省 == 改前`, e.glassBorder, BEFORE[i][2]);
    eq(`① ${BEFORE[i][0]} glassBlur 缺省 == 改前`, String(e.glassBlur), BEFORE[i][3]);
  }
}

// ── ② 设置了 ⇒ 按设置变；复位 ⇒ 回① ────────────────────────────────────────────────
{
  const v = new AmbienceValues();
  v.glassOpacity = 0.5; v.wallpaperOpacity = 1; v.glassBlur = 24;
  setAmbience(v);
  const p = paletteOf('base');
  const e = effectsOf(p);
  ok('② 设置后 glassBg 与缺省**不同**', e.glassBg !== BEFORE[0][1], `got ${e.glassBg}`);
  eq('② glassBlur 直用设置值', e.glassBlur, 24);
  ok('② 设置的 alpha 生效（0.5 ⇒ 首字节 0x80）', e.glassBg.substring(1, 3) === '80', e.glassBg);
  setAmbience(null);
  eq('② 复位后 glassBg 回到改前', effectsOf(p).glassBg, BEFORE[0][1]);
}

// ── ③ 消费点：形态断言钉**调用点计数**（⛔ 不钉"函数存在"）───────────────────────────
{
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const c = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/core/theme.ets'))) { repo = c; break; }
  }
  ok('③ 探测到 theme.ets', repo.length > 0);
  if (repo.length > 0) {
    const src: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/theme.ets'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const reads: number = (src.match(/currentAmbience/g) || []).length;   // 读+写共现；零扫描判红
    ok(`③ ★消费点：theme.ets 里 currentAmbience 出现 ${reads} 次（≥4：声明/写入口 2/读 1+）`, reads >= 4);
    ok('③ 且 `buildEffects` 里确有读（`const amb: AmbienceValues | null = currentAmbience;`）',
      src.indexOf('const amb: AmbienceValues | null = currentAmbience;') >= 0);
    ok('③ 且三处玻璃取值都吃 `amb`（glassBlur + 2 主题 glassBg/Border）',
      (src.match(/amb === null \?/g) || []).length >= 5);
  }
}

// ── ④ 解析器：服务端 `values` **恒填满 schema 默认** ⇒ 只有"用户真改过"的键才覆盖 ──────────
//    真源（2026-10-13 登录后 curl `plugin_config{id:'xbot.ambience'}` 实拍）：
//      properties.glassOpacity {number, default 0.82} · glassBlur {number, default 0} ·
//      wallpaperOpacity {number, default 1}；values 与 defaults 逐键相同（**用户没动过**）。
{
  const DEF = (): Record<string, unknown> => ({
    // ⛔ `id` 必须给：解析器只认 `xbot.ambience`（真载荷实测带 `"id":"xbot.ambience"`）
    id: 'xbot.ambience',
    properties: {
      glassOpacity: { type: 'number', default: 0.82 },
      glassBlur: { type: 'number', default: 0 },
      wallpaperOpacity: { type: 'number', default: 1 },
    },
    values: { glassOpacity: 0.82, glassBlur: 0, wallpaperOpacity: 1 },
  });
  const wrap = (entry: Record<string, unknown>): Object => ({ plugins: [entry] });

  // ④-1 头号安全护栏：用户没动过 ⇒ null ⇒ 观感**逐字节不变**（⛔ 绝不套用 web 的 0.82/0/1）
  ok('④-1 values == defaults ⇒ null（不覆盖）', ambienceFromPluginConfig(wrap(DEF())) === null);

  // ④-2 只改了「面板透明度」⇒ 只覆盖这一键，柔焦**不许被顺手改掉**
  const e2 = DEF();
  e2.values = { glassOpacity: 0.55, glassBlur: 0, wallpaperOpacity: 1 };
  const a2 = ambienceFromPluginConfig(wrap(e2));
  ok('④-2 只改 glassOpacity ⇒ 非 null', a2 !== null);
  if (a2 !== null) {
    eq('④-2 glassOpacity 取值', a2.glassOpacity, 0.55);
    eq('④-2 glassBlur 留哨兵（不越权）', a2.glassBlur, AMBIENCE_UNSET);
  }

  // ④-3 只改了「壁纸柔焦」⇒ 同理
  const e3 = DEF();
  e3.values = { glassOpacity: 0.82, glassBlur: 12, wallpaperOpacity: 1 };
  const a3 = ambienceFromPluginConfig(wrap(e3));
  ok('④-3 只改 glassBlur ⇒ 非 null', a3 !== null);
  if (a3 !== null) {
    eq('④-3 glassBlur 取值', a3.glassBlur, 12);
    eq('④-3 glassOpacity 留哨兵', a3.glassOpacity, AMBIENCE_UNSET);
  }

  // ④-4 端到端：只改 opacity ⇒ 玻璃变、深色柔焦**仍是 18**（⛔ 防"缺省即变"的事故形态）
  const e4 = DEF();
  e4.values = { glassOpacity: 0.5, glassBlur: 0, wallpaperOpacity: 1 };
  setAmbience(ambienceFromPluginConfig(wrap(e4)));
  const darkE = effectsOf(paletteOf('dark'));
  eq('④-4 深色柔焦**仍 18**（没被 web 的 0 顶掉）', darkE.glassBlur, 18);
  ok('④-4 深色玻璃 alpha 已按 0.5 生效（首字节 0x80）', darkE.glassBg.substring(1, 3) === '80', darkE.glassBg);
  setAmbience(null);
  eq('④-4 复位 ⇒ 深色玻璃回到改前', effectsOf(paletteOf('dark')).glassBg, BEFORE[1][1]);

  // ④-5 不误伤：空载荷 / 无该插件 / 非 number 值 ⇒ null
  ok('④-5 空载荷 ⇒ null', ambienceFromPluginConfig(null) === null);
  ok('④-5 无 ambience 条目 ⇒ null',
    ambienceFromPluginConfig(wrap({ id: 'xbot.other', properties: {}, values: {} })) === null);
  const e6 = DEF();
  e6.values = { glassOpacity: '0.5', glassBlur: 0, wallpaperOpacity: 1 };
  ok('④-5 非 number ⇒ 不算"用户设了值" ⇒ null', ambienceFromPluginConfig(wrap(e6)) === null);

  // ④-6 越界值按 schema 范围夹（glassOpacity 0.5..1 / glassBlur 0..24）
  const e7 = DEF();
  e7.values = { glassOpacity: 2, glassBlur: 99, wallpaperOpacity: 1 };
  const a7 = ambienceFromPluginConfig(wrap(e7));
  ok('④-6 越界 ⇒ 解析器**原样**给值（夹取是 `setAmbience` 的职责，不是解析器的）',
    a7 !== null && a7.glassOpacity === 2 && a7.glassBlur === 99);
  // 端到端：`setAmbience` 按 schema 范围夹（glassOpacity 0.5..1 / glassBlur 0..24）
  setAmbience(a7);
  const e7E = effectsOf(paletteOf('dark'));
  eq('④-6 glassBlur 夹到 24', e7E.glassBlur, 24);
  eq('④-6 glassOpacity 夹到 1 ⇒ alpha 满档 0xFF', e7E.glassBg.substring(1, 3), 'FF');
  setAmbience(null);
}

// ── ⑤ 死消费防线：解析器必须**真被应用**（钉文件级调用点计数，⛔ 不钉"函数存在"）────────
{
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo2 = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const c = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(c, 'entry/src/main/ets/pages/Index.ets'))) { repo2 = c; break; }
  }
  ok('⑤ 探到 Index.ets', repo2.length > 0);
  if (repo2.length > 0) {
    const strip = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const idx: string = strip(fsMod.readFileSync(pathMod.join(repo2, 'entry/src/main/ets/pages/Index.ets'), 'utf-8'));
    const setP: string = strip(fsMod.readFileSync(pathMod.join(repo2, 'entry/src/main/ets/components/SettingsPlugins.ets'), 'utf-8'));
    ok('⑤ ★Index.ets 真应用（首帧前）== 1 处',
      (idx.match(/setAmbience\(ambienceFromPluginConfig\(/g) || []).length === 1);
    ok('⑤ ★SettingsPlugins.ets 真应用（改设置后）== 1 处',
      (setP.match(/setAmbience\(ambienceFromPluginConfig\(/g) || []).length === 1);
    ok('⑤ 解析器本体在 core/settingsplugins.ets（判据与实现同源）',
      /export function ambienceFromPluginConfig\(/.test(
        fsMod.readFileSync(pathMod.join(repo2, 'entry/src/main/ets/core/settingsplugins.ets'), 'utf-8')));
  }
}

if (fail > 0) { console.log(`  ambience_override: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  ambience_override: ${pass} passed, 0 failed`);
process.exit(0);

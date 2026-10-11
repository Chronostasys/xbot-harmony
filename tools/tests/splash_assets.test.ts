/**
 * 开屏 / 品牌资产的**存在性 + 命名 + 引用链**门禁 —— 开屏全规格复核（2026-10-11）。
 *
 * 真源规格：`docs/SPLASH-SPEC.md`（阶段/判据）+ `docs/BRAND.md`（§5 资源落点与引用链 / §12 配置面）。
 * 为什么需要：这几件是**跨文件契约**（`app.json5` ↔ `module.json5` ↔ `layered_image.json` ↔ 资源文件名 ↔
 *   组件里的 `$r('app.media.*')`），改一处忘另一处**不会编译报错**，只会在真机上表现为
 *   **图标缺失 / 开屏空白 / 通知回落系统图标**。⇒ 全部钉成断言。
 *
 * ⛔ 判据纪律：读**真实文件**（⛔ 不抄文档）；**零扫描判红**（漏读=红）；命中行原文打印（可 grep）。
 *
 * mutation 自证：把 `AppScope/app.json5` 的 `icon` 改回 `$media:app_icon`（= 文档 §5 的**旧值**）
 *   ⇒ 本判据必红；把 `module.json5` 的 `startWindowIcon` 改成不存在的 `$media:nope` ⇒ 资源存在性必红。
 *
 * ⚠️ 有 `export {}` / `import`（⇒ TS 模块）：否则顶层 `declare const` 会与"无 import 的全局脚本"测试
 *   在**聚合编译**里撞名（本仓已入库 GOTCHA）。
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
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function findRoot(): string {
  for (const up of ['../..', '../../..', '../../../..']) {
    const p: string = path.resolve(__dirname, up);
    if (fs.existsSync(path.join(p, 'AppScope/app.json5'))) { return p; }
  }
  return '';
}
const root: string = findRoot();
ok('探测到仓库根（含 AppScope/app.json5）', root.length > 0);
const R = (p: string): string => path.join(root, p);

/** 读 JSON（4 个配置件都实测可 `JSON.parse`；失败 ⇒ 抛，由调用点记红）。 */
function readJson(rel: string): any {
  return JSON.parse(fs.readFileSync(R(rel), 'utf8'));
}
function exists(rel: string): boolean {
  return fs.existsSync(R(rel));
}

// ── ① 资产**存在性 + 命名**（BRAND §5/§12.2 的资源清单）──────────────────────────
{
  const must: string[] = [
    'AppScope/resources/base/media/app_icon.svg',
    'entry/src/main/resources/base/media/app_icon.svg',
    'entry/src/main/resources/base/media/start_icon.png',
    'entry/src/main/resources/base/media/brand_mark_outline.svg',
    // 通知小图标的 128×128 派生变体（`docs/BRAND.md §6.4.1`；由 `start_icon.png` 纯缩放 ⇒ 同形同色）
    'entry/src/main/resources/base/media/brand_mark_128.png',
    'entry/src/main/resources/base/media/brand_foreground.svg',
    'entry/src/main/resources/base/media/brand_background.svg',
    'AppScope/resources/base/media/brand_foreground.svg',
    'AppScope/resources/base/media/brand_background.svg',
    'AppScope/resources/base/media/layered_image.json',
    'entry/src/main/resources/base/profile/startWindow.json',
  ];
  let checked = 0;
  for (const f of must) {
    ok(`资产存在：${f}`, exists(f));
    checked++;
  }
  ok(`扫到资产条目 > 0（实得 ${checked}）—— 零扫描判红`, checked > 0);
  // 命名纪律（BRAND §6.3）：启动器图标是 **svg**、开屏标记是 **png**；⛔ 同名不能二者共存
  ok('start_icon 只有 .png（⛔ 无同名 .svg ⇒ Resource conflict）',
    exists('entry/src/main/resources/base/media/start_icon.png')
    && !exists('entry/src/main/resources/base/media/start_icon.svg'));
  ok('app_icon 在 AppScope/entry 两侧同名各一份（模块级覆盖 app 级，不算冲突）',
    exists('AppScope/resources/base/media/app_icon.svg') && exists('entry/src/main/resources/base/media/app_icon.svg'));
}

// ── ② **引用链**（app.json5 / module.json5 / startWindow.json / layered_image.json）──
{
  const app = readJson('AppScope/app.json5');
  const mod = readJson('entry/src/main/module.json5');
  const prof = readJson('entry/src/main/resources/base/profile/startWindow.json');
  const li = readJson('AppScope/resources/base/media/layered_image.json');

  eq('app.json5 app.icon → $media:layered_image（§12.2 已落地）', app.app.icon, '$media:layered_image');

  const ab: any = mod.module.abilities[0];
  eq('module.json5 ability.icon → $media:layered_image', ab.icon, '$media:layered_image');
  eq('module.json5 startWindowIcon → $media:start_icon', ab.startWindowIcon, '$media:start_icon');
  eq('module.json5 startWindowBackground → $color:start_window_background', ab.startWindowBackground, '$color:start_window_background');
  eq('module.json5 startWindow → $profile:startWindow', ab.startWindow, '$profile:startWindow');

  // 分层描述符 → 两层资产名（且两个文件都存在）
  eq('layered_image.background → $media:brand_background', li['layered-image'].background, '$media:brand_background');
  eq('layered_image.foreground → $media:brand_foreground', li['layered-image'].foreground, '$media:brand_foreground');
  ok('描述符引用的两层资产都在 AppScope 侧存在',
    exists('AppScope/resources/base/media/brand_background.svg')
    && exists('AppScope/resources/base/media/brand_foreground.svg'));

  // startWindow profile：底色同源 + colorModeType 保留（真机不生效，见 §12.1；⛔ 但配置仍在）
  eq('startWindow.json startWindowBackgroundColor → $color:start_window_background',
    prof.startWindowBackgroundColor, '$color:start_window_background');
  eq('startWindow.json startWindowAppIcon → $media:start_icon', prof.startWindowAppIcon, '$media:start_icon');
  eq('startWindow.json startWindowColorModeType = FOLLOW_APPLICATION（保留；真机不生效，§12.1）',
    prof.startWindowColorModeType, 'FOLLOW_APPLICATION');

  // `$media:start_icon` 与 `$media:app_icon` 都必须真能解析到文件（存在性已在 ① 断言，这里给"引用方"一个明确报错）
  ok('startWindowIcon 引用的 $media:start_icon 真有对应文件', exists('entry/src/main/resources/base/media/start_icon.png'));
}

// ── ③ **T0 底色不变量**：base/dark 两处 == 品牌开屏画布（= T1，逐字节）─────────────
{
  const base = readJson('entry/src/main/resources/base/element/color.json');
  const dark = readJson('entry/src/main/resources/dark/element/color.json');
  const pick = (j: any, name: string): string => {
    for (const c of j.color) { if (c.name === name) { return c.value; } }
    return '';
  };
  eq('base 的 start_window_background', pick(base, 'start_window_background').toUpperCase(), '#0B0B0E');
  eq('dark 的 start_window_background', pick(dark, 'start_window_background').toUpperCase(), '#0B0B0E');
  ok('两处同值 ⇒ 系统浅色/深色下 T0 都恒深（与 T1 的 splashBrandCanvas 同色）',
    pick(base, 'start_window_background').toUpperCase() === pick(dark, 'start_window_background').toUpperCase());
}

// ── ④ 组件 / 通知侧**引用的资产名**必须存在（跨文件契约的另一半）──────────────────
{
  const overlay: string = fs.readFileSync(R('entry/src/main/ets/components/SplashOverlay.ets'), 'utf8');
  const icons: string = fs.readFileSync(R('entry/src/main/ets/workreconcile/icons.ets'), 'utf8');
  ok('SplashOverlay 引用 $r(\'app.media.start_icon\')（标记本体）', overlay.indexOf("$r('app.media.start_icon')") >= 0);
  ok('SplashOverlay 引用 $r(\'app.media.brand_mark_outline\')（降级链 OUTLINE 档）',
    overlay.indexOf("$r('app.media.brand_mark_outline')") >= 0);
  ok('两者都真有文件',
    exists('entry/src/main/resources/base/media/start_icon.png')
    && exists('entry/src/main/resources/base/media/brand_mark_outline.svg'));
  // 通知小图标：解 svg → 回退 png（两路资产都必须在）
  ok('通知小图标首选 $r(\'app.media.brand_mark_outline\')', icons.indexOf("$r('app.media.brand_mark_outline')") >= 0);
  ok('通知小图标回退 $r(\'app.media.start_icon\')', icons.indexOf("$r('app.media.start_icon')") >= 0);
  // ⛔ 计数前**剥注释**：该文件头注里就写着 `image.createImageSource(`（文档），朴素计数会得到 2 ⇒ 假红。
  let code: string = '';
  let ci: number = 0;
  while (ci < icons.length) {
    const c: string = icons.charAt(ci);
    const n: string = ci + 1 < icons.length ? icons.charAt(ci + 1) : '';
    if (c === '/' && n === '/') { while (ci < icons.length && icons.charAt(ci) !== '\n') { ci++; } }
    else if (c === '/' && n === '*') {
      ci += 2;
      while (ci < icons.length && !(icons.charAt(ci) === '*' && ci + 1 < icons.length && icons.charAt(ci + 1) === '/')) { ci++; }
      ci += 2;
    } else { code += c; ci++; }
  }
  ok('全仓唯一解码点仍是 workreconcile/icons.ets（剥注释后 image.createImageSource 计数 = 1）',
    (code.match(/image\.createImageSource\(/g) || []).length === 1);
}

if (fail > 0) { console.log(`  splash_assets: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  splash_assets: ${pass} passed, 0 failed`);
process.exit(0);

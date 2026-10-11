/**
 * 通知小图标**品牌资产**契约（目标①；2026-10-11）。
 *
 * 背景：`NotificationRequest.smallIcon?: image.PixelMap` 要**解码后的位图**（SDK 对图标推荐 128×128）。
 * `workreconcile/icons.ets`（orb-ux）此前的解码顺序是 **SVG 优先 → `start_icon.png` 回退**，而
 * "`createImageSource` 能否吃 SVG"**无任何证据** ⇒ 本笔产出**保证可解码**的 128×128 变体
 * `brand_mark_128.png`（品牌紫 + 与 SVG 同形），并把"资源存在 + 尺寸合规"钉成判据。
 *
 * ⚠️ 优先级结论（**已上报，未改 orb-ux 的文件**）：应 **PNG 优先、SVG 备选**。`icons.ets` 目前仍
 *    SVG 优先 ⇒ ★④ 只断言"**解码链里有保证可解码的 PNG 兜底**"（现状成立），并在此记录**待翻转**。
 *
 * mutation 自证（必红）：把 `brand_mark_128.png` 换成非 128 尺寸（或删掉）⇒ ★①/★② 红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const cand = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/resources/base/media'))) { repo = cand; break; }
}
ok('探测到仓库根', repo.length > 0);

const MEDIA: string = pathMod.join(repo, 'entry/src/main/resources/base/media');
const PNG128: string = pathMod.join(MEDIA, 'brand_mark_128.png');

// ── ★① 资源存在 ────────────────────────────────────────────────────────────────────
ok('★① brand_mark_128.png 存在', fsMod.existsSync(PNG128));
// 既有 SVG **未被动**（它们是 §6.4 的规格产物；本变体是派生物）
for (const svg of ['brand_mark_outline.svg', 'brand_foreground.svg', 'brand_background.svg']) {
  ok(`  · 既有 SVG 仍在（未改）：${svg}`, fsMod.existsSync(pathMod.join(MEDIA, svg)));
}

// ── ★② 尺寸断言（纯逻辑：直接读 PNG 的 IHDR）────────────────────────────────────────
if (fsMod.existsSync(PNG128)) {
  // ⛔ 不用 Node 的 `Buffer`（本仓测试不带 @types/node）⇒ Uint8Array + 手写大端读取。
  const buf: Uint8Array = new Uint8Array(fsMod.readFileSync(PNG128));
  const SIG: number[] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  let sigOk = true;
  for (let i = 0; i < SIG.length; i++) { if (buf[i] !== SIG[i]) { sigOk = false; } }
  ok('★② 是合法 PNG（8 字节签名）', sigOk);
  let ihdr = '';
  for (let i = 12; i < 16; i++) { ihdr += String.fromCharCode(buf[i]); }
  ok('  · 首个 chunk 是 IHDR', ihdr === 'IHDR');
  const be32 = (o: number): number => (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
  const w: number = be32(16);
  const h: number = be32(20);
  eq('  · 宽 = 128（SDK 对图标推荐尺寸）', w, 128);
  eq('  · 高 = 128', h, 128);
  const colorType: number = buf[25];
  ok('  · 带 alpha 的色型（6 = RGBA ⇒ 透明底品牌标记）', colorType === 6, `colorType=${colorType}`);
}

// ── ★③ 品牌色保持：由 `sips -z` 从 `start_icon.png` 纯缩放（同形同色）──────────────
{
  // 说明（可判）+ 出处：`docs/BRAND.md §6.4.1` 记了再生成命令；这里钉"来源资产仍在"
  ok('★③ 来源资产 start_icon.png 仍在（本变体是它的 128 缩放）',
    fsMod.existsSync(pathMod.join(MEDIA, 'start_icon.png')));
  const doc: string = fsMod.readFileSync(pathMod.join(repo, 'docs/BRAND.md'), 'utf-8');
  ok('  · 文档记录了再生成命令（sips -z 128 128 … brand_mark_128.png）',
    doc.indexOf('brand_mark_128.png') >= 0 && doc.indexOf('sips -z 128 128') >= 0);
}

// ── ★④ 解码链必须**有保证可解码的 PNG 兜底**（现状成立；顺序**待翻转**）───────────────
{
  const iconsPath: string = pathMod.join(repo, 'entry/src/main/ets/workreconcile/icons.ets');
  ok('★④ 找到 icons.ets', fsMod.existsSync(iconsPath));
  if (fsMod.existsSync(iconsPath)) {
    const src: string = fsMod.readFileSync(iconsPath, 'utf-8');
    const stripped: string = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    ok('  · 解码链里有保证可解码的 PNG（`$r(\'app.media.start_icon\')` 或新变体）',
      stripped.indexOf("app.media.start_icon") >= 0 || stripped.indexOf("app.media.brand_mark_128") >= 0);
    // ⚠️ 当前顺序 = SVG 先（`brand_mark_outline` 在 `start_icon` 之前出现）。**结论是应翻转**，
    //    但该文件是 orb-ux 的在途域 ⇒ 我只记录、不改（已上报主 agent 路由）。
    const iSvg: number = stripped.indexOf('app.media.brand_mark_outline');
    const iPng: number = stripped.indexOf('app.media.start_icon');
    ok('  · ⚠️ 记录现状：SVG 先于 PNG（与"PNG 优先"结论不一致 ⇒ 已上报，待 orb-ux 翻转）',
      iSvg >= 0 && iPng >= 0 && iSvg < iPng);
  }
}

if (fail > 0) { console.log(`  notify_icon_asset: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify_icon_asset: ${pass} passed, 0 failed`);
process.exit(0);

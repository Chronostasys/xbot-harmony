/**
 * Lightbox 的 PixelMap **不能走 `@Prop`**（2026-10-17 用户 P0：点开图片 ⇒ 整个 App 卡死）。
 *
 * 机制（`docs/ARKTS-GOTCHAS.md` §3）：`@Prop` 对**对象**做深拷贝；`image.PixelMap` 是原生
 * 位图（整块像素缓冲）⇒ 深拷贝会复制/遍历整张图；页面流式期每次重渲都会再拷贝一次 ⇒ UI
 * 线程被钉死。修法：
 *   · Lightbox 的 `pixel`/`busy`/`label` 改**普通成员**（构造时拿引用，零拷贝）；
 *   · 页面用**互斥分支**（`imagePixel !== null` / `imageBusy`）在位图就绪时**重建**组件
 *     （普通成员只在构造时赋值；复用 busy 实例会永远看不到图）。
 *
 * 判据：形态 + 零扫描 + mutation（把 `pixel` 改回 `@Prop` ⇒ 必红）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

const root: string = path.resolve(__dirname, '../../../..');
const lb: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/components/Lightbox.ets'), 'utf8');
const index: string = fs.readFileSync(
  path.join(root, 'entry/src/main/ets/pages/Index.ets'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

/** 判据本体（可被 mutation 喂副本）。 */
function pixelIsPlain(lbSrc: string, idxSrc: string): boolean {
  if (lbSrc.indexOf('@Prop pixel') >= 0) { return false; }
  if (lbSrc.indexOf('pixel: image.PixelMap | null = null;') < 0) { return false; }
  if (lbSrc.indexOf('@Prop busy') >= 0) { return false; }
  if (lbSrc.indexOf('busy: boolean = false;') < 0) { return false; }
  // 页面必须有两个互斥分支，且都在分支内构造 Lightbox（普通成员需要重建才拿得到新值）。
  const branchReady: number = idxSrc.indexOf('if (this.imagePixel !== null) {');
  const branchBusy: number = idxSrc.indexOf('} else if (this.imageBusy) {');
  if (branchReady < 0 || branchBusy < 0 || branchReady >= branchBusy) { return false; }
  const readyChunk: string = idxSrc.substring(branchReady, branchBusy);
  if (readyChunk.indexOf('Lightbox({') < 0) { return false; }
  const busyChunk: string = idxSrc.substring(branchBusy, branchBusy + 900);
  if (busyChunk.indexOf('Lightbox({') < 0) { return false; }
  // 旧单分支（busy 与 pixel 同一实例）必须消失：它会让普通成员永远停在 null。
  if (idxSrc.indexOf('if (this.imagePixel !== null || this.imageBusy) {') >= 0) { return false; }
  return true;
}

console.log('\n▶ Lightbox PixelMap 不得走 @Prop（深拷贝会卡死 UI）');
ok('零扫描防线：Lightbox/Index 真读到内容', lb.length > 5000 && index.length > 50000);
ok('判据：pixel/busy 普通成员 + 页面互斥分支重建', pixelIsPlain(lb, index));
ok('mutation：把 pixel 改回 @Prop ⇒ 必红',
  !pixelIsPlain(lb.replace('pixel: image.PixelMap | null = null;', '@Prop pixel: image.PixelMap | null = null;'), index));
ok('mutation：删掉“就绪分支” ⇒ 必红',
  !pixelIsPlain(lb, index.replace('if (this.imagePixel !== null) {', 'if (false) {')));
ok('mutation：恢复旧单分支形态 ⇒ 必红',
  !pixelIsPlain(lb, index.replace('if (this.imagePixel !== null) {',
    'if (this.imagePixel !== null || this.imageBusy) {')));

ok('Lightbox 内容层不得 HitTestMode.Block（会连 Toolbar 子按钮一起挡掉）',
  lb.indexOf('hitTestBehavior(HitTestMode.Block)') < 0);
console.log(fail === 0 ? 'lightbox_pixel_prop: ALL PASS' : `lightbox_pixel_prop: ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);

export {};

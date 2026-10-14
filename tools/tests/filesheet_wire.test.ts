/**
 * filesheet_wire —— 第一波「文件面板 + 终端」两案接线的**形态断言**（2026-10-14）。
 *
 * 两案都是「接线即修复」型（逻辑主体在别处/已存在），判据核心 = **调用点存在且唯一**，
 * ⛔ 不钉方法体存在（防死消费假绿）：
 *   #3 图片点按放大（P1-1）：FilesSheet `onOpen` 曾是空实现 —— 图片能看不能放大。
 *      链路：AuthImage `onOpen` ⇒ `this.onOpenImage(this.previewImageUrl)`（组件只上报）
 *      ⇒ 页面 FilesSheet({...}) 传入 `onOpenImage` ⇒ `void this.openImage(url)`
 *      （与聊天图片同一条全屏查看器通道，:4737 装载 imagePixel + Lightbox）。
 *   #5 新建终端落会话 cwd（终端 P1）：`createTerminal('')`（恒沙箱默认目录）⇒
 *      `createTerminal(store.cwd)`（`loadStatus()`：`/api/session/status` 已赋值的
 *      会话工作目录；空串 = 未拿到 ⇒ 服务端沙箱兜底，与旧行为一致）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; dirname(p: string): string };
declare const __dirname: string;

import { describe, expect, it, summary } from './vitest_shim';

/** 爬根 idiom（run-one.sh 编译产物令 __dirname 漂移 ⇒ 裸 ../ 会 ENOENT，实测）。 */
function repoRoot(): string {
  let root: string = __dirname;
  for (let i = 0; i < 8; i++) {
    if (require('fs').existsSync(require('path').join(root, 'entry', 'src', 'main', 'ets'))) {
      break;
    }
    root = require('path').join(root, '..');
  }
  return root;
}

function srcOf(rel: string): string {
  const f: string = require('path').join(repoRoot(), 'entry', 'src', 'main', 'ets', rel);
  if (!require('fs').existsSync(f)) {
    throw new Error(`形态断言取不到源文件: ${f}`);
  }
  return require('fs').readFileSync(f, 'utf-8');
}

function occ(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

const sheet: string = srcOf('components/FilesSheet.ets');
const idx: string = srcOf('pages/Index.ets');

describe('#3 图片点按放大——接线形态（FilesSheet + Index）', () => {
  it('① 组件成员 onOpenImage 声明恰 1（缺省空实现 = 失败方向安全）', () => {
    expect(occ(sheet, 'onOpenImage: (url: string) => void')).toBe(1);
  });

  it('② 组件内实装：AuthImage onOpen ⇒ this.onOpenImage(this.previewImageUrl)（只上报不 IO）', () => {
    expect(occ(sheet, 'this.onOpenImage(this.previewImageUrl)')).toBe(1);
  });

  it('③ 页面传入点恰 1 且走聊天同一条 openImage 通道', () => {
    expect(occ(idx, 'onOpenImage: (url: string) => {')).toBe(1);
    expect(occ(idx, 'void this.openImage(url)')).toBe(1);
  });

  it('④ 反向：组件内不出现页面私有 IO 方法（openImage 归 Index —— 分层纪律）', () => {
    expect(occ(sheet, 'this.openImage(')).toBe(0);
  });
});

describe('#5 新建终端落会话 cwd——接线形态（Index）', () => {
  it('① createTerminal(store.cwd) 恰 1（loadStatus 已赋值的会话工作目录）', () => {
    expect(occ(idx, 'createTerminal(store.cwd)')).toBe(1);
  });

  it('② 反向：旧空串形态 createTerminal(\'\') 归零（防回退成恒沙箱）', () => {
    expect(occ(idx, "createTerminal('')")).toBe(0);
  });
});

summary('filesheet_wire');

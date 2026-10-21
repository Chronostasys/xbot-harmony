/**
 * `core/sheets.ets` —— 浮层面板「可见性 flag 所有权」的**判别力**回归守卫。
 *
 * 背景（2026-10-11 用户亲报的真机 P0）：抽屉进入的「设置」面板**打开了关不掉**
 * —— 它的渲染 flag 是 `showPrefs`，但头部 X 的 onClick 误写了**另一个面板**的 flag
 *   `showSettings` ⇒ 点 X 关的是别人。见 `docs/ARKTS-GOTCHAS.md` 批次26。
 *
 * 本用例钉死两件事：
 *   1. `core/sheets.ets` 的 flag 表**自洽**（id/flag 唯一、id↔flag 双向一一对应）；
 *   2. **源码级**：`pages/Index.ets` 里每个浮层 `@Builder` 的**头部 X 关闭分支**，
 *      写的 flag 必须 === 该面板的 `closeFlagOf(id)`（即 `sheets.ets` 的唯一真相）
 *      ⇒ 任何"写错 flag"的面板都会让本用例**变红**。
 *
 * ⚠️ **判别力自证（改动下列任一锚点 ⇒ 本测试必红）**：
 *   · 把 `closeFlagOf('drawer')` 的值改成 `'showModel'`（sheets.ets 的 flag 表）
 *     ⇒ 断言 2 在 `DrawerSheet` 上红（源码写的是 `showDrawer`，与表不符）——与历史病灶同类。
 *   · 把 `Index.ets` 里 `DrawerSheet` 头部 X 的 `showDrawer` 改成别的 flag
 *     ⇒ 源码扫描红（同一次历史 bug 的**另一半**）。
 *   · 让两个面板共用同一个 flag ⇒ `sheetsIssues()` 红（"关错人"的结构性前提被破坏）。
 *
 * ⚠️ 历史病灶（`PrefsSheet` 的 X 写了 `showSettings`）已随**收敛**退场：那两个旧 `@Builder`
 *    不再入表（`core/sheets.ets` 注释有说明），故本用例对它们"跳过"而非"钉死"。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { describe, expect, it, summary } from './vitest_shim';
import {
  sheetSpecs, SheetSpec, closeFlagOf, sheetIdOfFlag, sheetIdOfBuilder, sheetsIssues,
} from '../../entry/src/main/ets/core/sheets';

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const indexSrc: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8');

/** 取某 `@Builder` 的函数体（从 `  Name() {` 到下一个 `@Builder` 或文件尾）。 */
function builderBody(name: string): string {
  const start = indexSrc.indexOf(`  ${name}() {`);
  if (start < 0) { return ''; }
  const next = indexSrc.indexOf('\n  @Builder', start);
  return indexSrc.slice(start, next < 0 ? indexSrc.length : next);
}

/**
 * 面板头部首个 `xmark` 的 onClick 里赋的 flag 名（`''` = 该 builder 没有"X 关闭"）。
 * ⚠️ 只看 X 之后的**一小段**（onClick 回调体），不误抓同 builder 内其它按钮。
 */
function closeFlagInBody(body: string): string {
  const x = body.indexOf('xmark');
  if (x < 0) { return ''; }
  const oc = body.indexOf('.onClick', x);
  if (oc < 0) { return ''; }
  const seg = body.slice(oc, oc + 400);
  const m = /this\.(\w+)\s*=\s*false/.exec(seg);
  return m === null ? '' : m[1];
}

describe('sheets：面板 flag 表自洽（id/flag 唯一、id↔flag 一一对应）', () => {
  it('无任何不变量违规', () => {
    expect(sheetsIssues()).toEqual([]);
  });

  it('flag 两两不同（同一 flag 不能属于两个面板）', () => {
    const flags: string[] = sheetSpecs().map((s: SheetSpec) => s.flag);
    const uniq: string[] = [];
    for (let i = 0; i < flags.length; i++) {
      if (uniq.indexOf(flags[i]) < 0) { uniq.push(flags[i]); }
    }
    expect(uniq.length).toBe(flags.length);
  });

  it('closeFlagOf / sheetIdOfFlag 是双向逆映射', () => {
    const all: SheetSpec[] = sheetSpecs();
    for (let i = 0; i < all.length; i++) {
      expect(closeFlagOf(all[i].id)).toBe(all[i].flag);
      expect(sheetIdOfFlag(all[i].flag)).toBe(all[i].id);
    }
  });

  it('未知 id/flag ⇒ 空串（不误命中任何面板）', () => {
    expect(closeFlagOf('nope')).toBe('');
    expect(sheetIdOfFlag('showNope')).toBe('');
    expect(sheetIdOfBuilder('LoadingView')).toBe('');
  });
});

describe('sheets：源码里每个浮层 @Builder 的 X 关闭 flag == closeFlagOf(id)', () => {
  it('全部浮层 @Builder 逐一核对（缺 X / builder 已删 ⇒ 跳过；有 X 的必须写自己的 flag）', () => {
    const all: SheetSpec[] = sheetSpecs();
    for (let i = 0; i < all.length; i++) {
      const s: SheetSpec = all[i];
      if (s.builder.length === 0) { continue; }
      const body: string = builderBody(s.builder);
      if (body.length === 0) { continue; } // 面板已抽成组件/被删 ⇒ 该 builder 已不存在
      const got: string = closeFlagInBody(body);
      if (got.length === 0) { continue; }  // 该 builder 没有头部 X（内联/背板关）
      expect(got).toBe(s.flag);
    }
  });
});

process.exit(summary('sheets'));

export {};

/**
 * staging —— 「待发队列托盘」的判别力测试（纯逻辑 + **接线形态**）。
 *
 * 两层：
 *   · ① 纯函数数值（`core/staging.ets`）—— 计数/预览/id/高度，含码点截断（emoji 安全）。
 *   · ② 接线形态（读源码）—— 目标④「支持 web 的所有功能」的落点判据：
 *      a. `components/StagingTray.ets` **存在**且 `Index.ets` **import + 实例化**它；
 *      b. 托盘以 `queue.length > 0` **短路**（空 ⇒ 零节点，同 web `:56`）；
 *      c. 托盘**不 import store**（分层铁律：动作留页面）；
 *      d. `QueueSheet.ets` 的 id 口径已改消费 `stagingItemId`（**单一真源**，防两处漂移）。
 *
 * ⛔ 形态断言钉「**调用点计数**」而非「函数体存在」（AGENTS.md：钉方法体会假绿）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { describe, expect, it, summary } from './vitest_shim';
import {
  stagingCountLabel, stagingHeadPreview, stagingItemId, stagingListHeight, STAGING_MAX_H, STAGING_ROW_H,
  stagingPreview, stagingText,
} from '../../entry/src/main/ets/core/staging';

describe('core/staging 纯函数', () => {
  it('stagingItemId：msg_id 优先，其次 id，都缺 ⇒ 空串', () => {
    expect(stagingItemId({ msg_id: 'm1', id: 'i1' })).toBe('m1');
    expect(stagingItemId({ id: 'i1' })).toBe('i1');
    expect(stagingItemId({})).toBe('');
  });

  it('stagingText：content 优先（空串回落 text）', () => {
    expect(stagingText({ content: 'C', text: 'T' })).toBe('C');
    expect(stagingText({ content: '', text: 'T' })).toBe('T');
    expect(stagingText({ text: 'T' })).toBe('T');
    expect(stagingText({})).toBe('');
  });

  it('stagingCountLabel：中文量词「条」', () => {
    expect(stagingCountLabel(1)).toBe('1 条待发');
    expect(stagingCountLabel(7)).toBe('7 条待发');
  });

  it('stagingPreview：取首个非空行 + 连续空白压单空格', () => {
    expect(stagingPreview('\n\n  第一行  有\t空 格 \n第二行', 100)).toBe('第一行 有 空 格');
    expect(stagingPreview('   ', 100)).toBe('');
  });

  it('stagingPreview：按**码点**截断（emoji 代理对不劈半）', () => {
    // 4 个 emoji（每个 2 UTF-16 单元）；maxLen=3 ⇒ 取 2 个码点 + 省略号。
    expect(stagingPreview('😀😀😀😀', 3)).toBe('😀😀…');
    // 恰好等于上限 ⇒ 不截断、不加省略号。
    expect(stagingPreview('abc', 3)).toBe('abc');
    expect(stagingPreview('abcd', 4)).toBe('abcd');
    // 超一码点 ⇒ 截断加省略号。
    expect(stagingPreview('abcde', 4)).toBe('abc…');
    // maxLen <= 0 ⇒ 空串（零扫描防线：不允许无限/负数）。
    expect(stagingPreview('abc', 0)).toBe('');
    expect(stagingPreview('abc', -5)).toBe('');
  });

  it('stagingListHeight：0 ⇒ 0；n*ROW_H；封顶 MAX_H', () => {
    expect(stagingListHeight(0)).toBe(0);
    expect(stagingListHeight(-1)).toBe(0);
    expect(stagingListHeight(3)).toBe(3 * STAGING_ROW_H);
    expect(stagingListHeight(100)).toBe(STAGING_MAX_H);
  });

  it('stagingHeadPreview：无队首 ⇒ 空串', () => {
    expect(stagingHeadPreview(undefined, 40)).toBe('');
    expect(stagingHeadPreview({ content: 'hello world' }, 5)).toBe('hell…');
  });
});

describe('StagingTray 接线形态（目标④）', () => {
  const fs = require('fs');
  const path = require('path');
  let root: string = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(root, 'entry', 'src', 'main', 'ets'))) { break; }
    root = path.join(root, '..');
  }
  const trayPath: string = path.join(root, 'entry', 'src', 'main', 'ets', 'components', 'StagingTray.ets');
  const idxPath: string = path.join(root, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');
  const qsPath: string = path.join(root, 'entry', 'src', 'main', 'ets', 'components', 'QueueSheet.ets');

  const trayRaw: string = fs.existsSync(trayPath) ? fs.readFileSync(trayPath, 'utf-8') : '';
  const idxRaw: string = fs.existsSync(idxPath) ? fs.readFileSync(idxPath, 'utf-8') : '';
  const qsRaw: string = fs.existsSync(qsPath) ? fs.readFileSync(qsPath, 'utf-8') : '';
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const tray: string = strip(trayRaw);
  const idx: string = strip(idxRaw);
  const qs: string = strip(qsRaw);

  it('零扫描防线：三份源码都读到', () => {
    expect(tray.length).toBeGreaterThan(500);
    expect(idx.length).toBeGreaterThan(1000);
    expect(qs.length).toBeGreaterThan(500);
  });

  it('a. 组件存在 + 被判据模块驱动（消费 core/staging）', () => {
    expect(tray).toContain('export struct StagingTray');
    expect(tray).toContain("from '../core/staging'");
    // 判据函数**真的**被调用（钉调用点，而非"import 存在"）。
    expect(tray).toContain('stagingPreview(');
    expect(tray).toContain('stagingCountLabel(');
    expect(tray).toContain('stagingListHeight(');
  });

  it('b. Index.ets import + 实例化（接线点计数 = 1 处 import、1 处 new）', () => {
    const imports: number = (idx.match(/import \{ StagingTray \} from '\.\.\/components\/StagingTray';/g) || []).length;
    const uses: number = (idx.match(/StagingTray\(\{/g) || []).length;
    expect(imports).toBe(1);
    expect(uses).toBe(1);
  });

  it('c. 空队列短路（同 web :56 —— 空 ⇒ 不产出节点）', () => {
    expect(tray).toContain('if (this.queue.length > 0)');
  });

  it('d. 分层铁律：组件不 import store（动作留页面）', () => {
    expect(tray).not.toContain("core/store");
    expect(tray).not.toContain("from '../core/store'");
    // 也不得自造第二套 id 口径（必须消费 stagingItemId）。
    expect(tray).toContain('stagingItemId(');
  });

  it('e. QueueSheet 的 id 口径已改为消费 stagingItemId（单一真源，防漂移）', () => {
    expect(qs).toContain("from '../core/staging'");
    expect(qs).toContain('stagingItemId(');
    // 旧的自写 idOf 必须**消失**（否则两处口径会漂移）。
    expect(qs).not.toContain('private idOf(');
  });
});

process.exit(summary('staging'));

export {};

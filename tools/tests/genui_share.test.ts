/**
 * genui_share —— GenUI 面板「分享按钮」四态文案（`core/genui.ets`）的判别力测试。
 *
 * web 权威（`plugins/genui/index.tsx:122-181` ShareablePanel）：四态
 * `'idle' | 'busy' | 'done' | 'error'` + t() fallback 文案（zh-CN.ts 无 share* key，
 * grep 实证 0 命中 ⇒ fallback 即线上真实显示）。本文件钉：
 *   ① 四态常量逐字对齐 web 的 state 字面量；
 *   ② shareLabelOf 四态文案互异且精确（含全角逗号/省略号，逐字节）；
 *   ③ 未知/空态回落 idle 文案（失败方向安全：宁可显示可重按的『分享』）。
 * 形态断言（卡片接线）在批次 ② 组件落完后追加（见文件尾 TODO 同批）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { describe, expect, it, summary } from './vitest_shim';
import {
  SHARE_BUSY, SHARE_DONE, SHARE_ERR, SHARE_IDLE, shareLabelOf,
} from '../../entry/src/main/ets/core/genui';

describe('core/genui 分享按钮四态文案', () => {  it('四态常量逐字对齐 web state 字面量（genui/index.tsx:126）', () => {
    expect(SHARE_IDLE).toBe('idle');
    expect(SHARE_BUSY).toBe('busy');
    expect(SHARE_DONE).toBe('done');
    expect(SHARE_ERR).toBe('error');
  });

  it('四态文案精确（fallback 逐字：含省略号/全角逗号）', () => {
    expect(shareLabelOf(SHARE_IDLE)).toBe('分享');
    expect(shareLabelOf(SHARE_BUSY)).toBe('生成链接…');
    expect(shareLabelOf(SHARE_DONE)).toBe('已复制链接');
    expect(shareLabelOf(SHARE_ERR)).toBe('分享失败，重试');
  });

  it('四态互异（任何两态文案不撞车——撞了用户看到的状态就是错的）', () => {
    const labels: string[] = [
      shareLabelOf(SHARE_IDLE), shareLabelOf(SHARE_BUSY),
      shareLabelOf(SHARE_DONE), shareLabelOf(SHARE_ERR),
    ];
    expect(new Set(labels).size).toBe(4);
  });

  it('未知/空态回落 idle 文案（失败方向安全）', () => {
    expect(shareLabelOf('')).toBe('分享');
    expect(shareLabelOf('whatever')).toBe('分享');
    expect(shareLabelOf('Done')).toBe('分享'); // 大小写敏感：web state 是小写，'Done' 不是完成态
  });
});

/** 源文件取数（形态断言用）—— **爬根 idiom**（与 genui.test.ts:125-133 同款）：
 * run-one.sh 的编译产物会让 `__dirname` 落点漂移 ⇒ 裸 `../../` 前缀会 ENOENT（实测两次）。
 * 从 `__dirname` 向上爬到仓根（`entry/src/main/ets` 存在处），县份一律用扁平相对名。 */
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

/** 子串出现次数（「调用片段」计数，⛔ 不取整行）。 */
function occ(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

const CARD = 'components/GenuiPanelCard.ets';
const MROW = 'components/MessageRow.ets';
const LTV = 'components/LiveTailView.ets';
const IDX = 'pages/Index.ets';

describe('分享 chip 接线形态（钉「调用点计数」，⛔ 不钉方法体——防死消费假绿）', () => {
  it('GenuiPanelCard：文案同源 + 四态消费 + pasteboard + live 门控', () => {
    const s: string = srcOf(CARD);
    // 文案判据与渲染同源：chip 只准调 shareLabelOf（出现了即接线成功；mutation=删调用必红）
    expect(occ(s, 'shareLabelOf(')).toBeGreaterThanOrEqual(1);
    // 四态 state 的本地消费：busy 守卫 + setBusy + UI 三元 ⇒ ≥3 处 this.shareState
    expect(occ(s, 'this.shareState')).toBeGreaterThanOrEqual(3);
    // @State 声明恰 1（组件自持交互态）
    expect(occ(s, '@State shareState')).toBe(1);
    // onShare 回调真被调用（shareClicked 里恰 1）
    expect(occ(s, 'this.onShare(')).toBe(1);
    // 复制 idiom（与 MarkdownView/SettingsDeveloper 同款）
    expect(occ(s, 'pasteboard.createData')).toBe(1);
    expect(occ(s, 'MIMETYPE_TEXT_PLAIN')).toBe(1);
    // 流式期不显示 chip（对齐 web：流式路径不包 ShareablePanel，历史路径才包）
    expect(occ(s, 'if (!this.live)')).toBe(1);
    // 色对：done=successText / error=dangerText（语义 role，非自造色）
    expect(occ(s, "'successText'")).toBe(1);
    expect(occ(s, "'dangerText'")).toBe(1);
  });

  it('GenuiPanelCard：反向断言——组件不 IO（分层铁律，⛔ 建链不得泄进组件）', () => {
    const s: string = srcOf(CARD);
    expect(occ(s, 'shareGenuiPanel')).toBe(0);
    expect(occ(s, '/api/share')).toBe(0);
  });

  it('MessageRow／LiveTailView：onShareGenui 透传链', () => {
    const m: string = srcOf(MROW);
    // 声明 + 给内部 LiveTailView 透传 + 给 GenuiPanelCard 传 onShare ⇒ ≥3
    expect(occ(m, 'onShareGenui')).toBeGreaterThanOrEqual(3);
    const l: string = srcOf(LTV);
    // 声明 + 给 GenuiPanelCard 传 onShare ⇒ ≥2
    expect(occ(l, 'onShareGenui')).toBeGreaterThanOrEqual(2);
  });

  it('Index：两处传入点 + shareGenuiLink 实现 + 复用既有建分享链', () => {
    const s: string = srcOf(IDX);
    expect(occ(s, 'onShareGenui:')).toBe(2);
    expect(occ(s, 'shareGenuiLink')).toBeGreaterThanOrEqual(3);
    expect(occ(s, 'shareGenuiPanel(')).toBeGreaterThanOrEqual(2); // openGenuiPanel 1 + shareGenuiLink 1
  });
});

process.exit(summary('genui_share'));

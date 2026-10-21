/**
 * genui —— GenUI（`display_html`）面板落点的判别力测试（纯逻辑 + **接线形态**）。
 *
 * 目标④ 用户原话：「必须真的支持 web 的所有插件和功能…比如**统计插件的面板我们看不到**」。
 * 本文件钉两件事：
 *   ① 纯函数（`core/genui.ets`）—— 判据/文案/请求体/URL 逐条对齐 web
 *      （`plugins/genui/index.tsx:57-87` 的 `stripGenUIPrefix`/`genUICode`）；
 *   ② **接线形态**（读源码）—— 卡片真的被渲染路径消费（**调用点计数**，不是"文件存在"）。
 *
 * ⛔ 形态断言钉「调用点计数」（AGENTS.md：钉方法体会假绿）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { describe, expect, it, summary } from './vitest_shim';
import {
  GENUI_CONTENT_TYPE, GENUI_MAX_PAYLOAD, GENUI_PLUGIN_ID, GENUI_UI_MODE,
  genuiCardSubtitle, genuiCardTitle, genuiCode, genuiFailed, genuiPanelUrl, genuiPayloadTooLarge,
  genuiRenderable, genuiShareBody, isGenuiTool, stripGenuiPrefix,
} from '../../entry/src/main/ets/core/genui';
import { ToolProgress } from '../../entry/src/main/ets/core/types';

function tool(p: Partial<ToolProgress>): ToolProgress {
  const t: ToolProgress = { name: 'display_html' };
  if (p.status !== undefined) { t.status = p.status; }
  if (p.args !== undefined) { t.args = p.args; }
  if (p.detail !== undefined) { t.detail = p.detail; }
  if (p.ui_mode !== undefined) { t.ui_mode = p.ui_mode; }
  if (p.ui_libs !== undefined) { t.ui_libs = p.ui_libs; }
  if (p.gen_chars !== undefined) { t.gen_chars = p.gen_chars; }
  if (p.summary !== undefined) { t.summary = p.summary; }
  return t;
}

const TSX: string = 'function App(){ return <div/> }';

describe('core/genui 纯函数', () => {
  it('isGenuiTool：只看服务端 UI 元数据 ui_mode（不看工具名）', () => {
    expect(isGenuiTool(tool({ ui_mode: 'genui' }))).toBe(true);
    expect(isGenuiTool(tool({ ui_mode: 'other' }))).toBe(false);
    expect(isGenuiTool(tool({}))).toBe(false);
    expect(isGenuiTool(undefined)).toBe(false);
    expect(GENUI_UI_MODE).toBe('genui');
  });

  it('genuiFailed：error / failed ⇒ 不渲染（对齐 web index.tsx:81）', () => {
    expect(genuiFailed(tool({ status: 'error' }))).toBe(true);
    expect(genuiFailed(tool({ status: 'failed' }))).toBe(true);
    expect(genuiFailed(tool({ status: 'done' }))).toBe(false);
    expect(genuiFailed(tool({ status: 'generating' }))).toBe(false);
    expect(genuiFailed(undefined)).toBe(true);
  });

  it('stripGenuiPrefix：首行散文 + 是 TSX 模块 ⇒ 丢首行；代码起始 ⇒ 原样', () => {
    expect(stripGenuiPrefix(`这是统计面板：\n${TSX}`)).toBe(TSX);
    expect(stripGenuiPrefix(`// 注释行\n${TSX}`)).toBe(`// 注释行\n${TSX}`);
    expect(stripGenuiPrefix(`function App(){ return <div/> }`)).toBe(`function App(){ return <div/> }`);
    // 首行是散文但整体不像模块（无 export default/function App/大写标签）⇒ 不丢。
    expect(stripGenuiPrefix('这是散文\n第二行')).toBe('这是散文\n第二行');
    expect(stripGenuiPrefix('')).toBe('');
  });

  it('genuiCode：args.code 优先（剥前缀）→ detail 回落；失败态 ⇒ 空', () => {
    const a: string = JSON.stringify({ code: `说明\n${TSX}` });
    expect(genuiCode(tool({ status: 'done', ui_mode: 'genui', args: a }))).toBe(TSX);
    expect(genuiCode(tool({ status: 'done', ui_mode: 'genui', detail: TSX }))).toBe(TSX);
    // 失败态即使 args 完整也**不**给源码（web 踩坑：空面板撑高）。
    expect(genuiCode(tool({ status: 'error', ui_mode: 'genui', args: a }))).toBe('');
    // 坏 JSON ⇒ 回落 detail。
    expect(genuiCode(tool({ status: 'done', ui_mode: 'genui', args: '{not json', detail: TSX }))).toBe(TSX);
    // args 有 code 但为空串 ⇒ 回落 detail。
    expect(genuiCode(tool({ status: 'done', ui_mode: 'genui', args: JSON.stringify({ code: '  ' }), detail: TSX }))).toBe(TSX);
    expect(genuiCode(tool({ status: 'done', ui_mode: 'genui' }))).toBe('');
  });

  it('genuiRenderable：GenUI + 未失败 + 有源码', () => {
    expect(genuiRenderable(tool({ status: 'generating', ui_mode: 'genui', args: JSON.stringify({ code: TSX }) }))).toBe(true);
    expect(genuiRenderable(tool({ status: 'error', ui_mode: 'genui', args: JSON.stringify({ code: TSX }) }))).toBe(false);
    expect(genuiRenderable(tool({ status: 'done', ui_mode: 'shell', args: JSON.stringify({ code: TSX }) }))).toBe(false);
    expect(genuiRenderable(tool({ status: 'done', ui_mode: 'genui' }))).toBe(false);
  });

  it('genuiPayloadTooLarge：按服务端 1 MiB 上限自判', () => {
    expect(GENUI_MAX_PAYLOAD).toBe(1 << 20);
    expect(genuiPayloadTooLarge('x')).toBe(false);
    expect(genuiPayloadTooLarge('x'.repeat(GENUI_MAX_PAYLOAD + 1))).toBe(true);
  });

  it('genuiCardTitle / genuiCardSubtitle：摘要优先、兜底文案；生成中带字符数', () => {
    expect(genuiCardTitle(tool({ summary: '  ' }))).toBe('交互式面板');
    expect(genuiCardTitle(tool({ summary: '月度统计' }))).toBe('月度统计');
    expect(genuiCardSubtitle(tool({ status: 'generating', gen_chars: 120 }))).toBe('生成中 120 字');
    expect(genuiCardSubtitle(tool({ status: 'done' }))).toBe('');
    expect(genuiCardSubtitle(tool({ status: 'done', ui_libs: ['echarts', 'three'] }))).toBe('echarts · three');
    expect(genuiCardSubtitle(tool({ status: 'generating', gen_chars: 5, ui_libs: ['echarts'] }))).toBe('生成中 5 字 · echarts');
  });

  it('genuiShareBody：注册表常量与服务端契约键名一致（web 侧 contentType 同值）', () => {
    const b = genuiShareBody(TSX, '标题');
    expect(b.plugin_id).toBe(GENUI_PLUGIN_ID);
    expect(b.content_type).toBe(GENUI_CONTENT_TYPE);
    expect(b.payload).toBe(TSX);
    expect(b.title).toBe('标题');
    // 键名 = 服务端 protocol/share.go:31-37 的 json tag（下划线）。
    expect(Object.keys(b).sort().join(',')).toBe('content_type,payload,plugin_id,title');
    // 空标题 ⇒ 兜底（服务端 title 只是展示元数据，但不该是空串）。
    expect(genuiShareBody(TSX, '   ').title).toBe('交互式面板');
    // ⛔ 服务端只校验 contentType 非空/≤128、payload 非空/≤1MiB（web_share.go:46-61）。
    expect(GENUI_CONTENT_TYPE.length).toBeLessThanOrEqual(128);
  });

  it('genuiPanelUrl：host 尾斜杠归一；path 前斜杠归一；任一侧空 ⇒ 空串', () => {
    expect(genuiPanelUrl('http://10.0.2.2:8082/', '/s/abc')).toBe('http://10.0.2.2:8082/s/abc');
    expect(genuiPanelUrl('http://10.0.2.2:8082', 's/abc')).toBe('http://10.0.2.2:8082/s/abc');
    expect(genuiPanelUrl('', '/s/abc')).toBe('');
    expect(genuiPanelUrl('http://h', '')).toBe('');
  });
});

describe('GenUI 面板接线形态（目标④「面板我们看不到」）', () => {
  const fs = require('fs');
  const path = require('path');
  let root: string = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(root, 'entry', 'src', 'main', 'ets'))) { break; }
    root = path.join(root, '..');
  }
  const p = (rel: string): string => path.join(root, 'entry', 'src', 'main', 'ets', rel);
  const readOr = (rel: string): string => {
    const f: string = p(rel);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : '';
  };
  const count = (s: string, sub: string): number => s.split(sub).length - 1;

  const cardRaw: string = readOr('components/GenuiPanelCard.ets');
  const msgRaw: string = readOr('components/MessageRow.ets');
  const liveRaw: string = readOr('components/LiveTailView.ets');
  const idxRaw: string = readOr('pages/Index.ets');
  const storeRaw: string = readOr('core/store.ets');

  it('① 卡片存在，且 MessageRow 与 LiveTailView **各自**渲染它（调用点计数）', () => {
    expect(cardRaw).toContain('export struct GenuiPanelCard');
    // 两个渲染路径各 import 恰 1 次、实例化恰 1 次（live + committed 都要能看到面板）。
    expect(count(msgRaw, "from './GenuiPanelCard'")).toBe(1);
    expect(count(liveRaw, "from './GenuiPanelCard'")).toBe(1);
    expect(count(msgRaw, 'GenuiPanelCard({')).toBe(1);
    expect(count(liveRaw, 'GenuiPanelCard({')).toBe(1);
  });

  it('② 判据同源：两处渲染路径都走 `genuiRenderable`，且不各自判 ui_mode', () => {
    expect(count(msgRaw, 'genuiRenderable(')).toBe(1);
    expect(count(liveRaw, 'genuiRenderable(')).toBe(1);
    // ⛔ 组件里不得出现裸 ui_mode 判据（判据只在 core/genui.ets）。
    expect(msgRaw).not.toContain("=== 'genui'");
    expect(liveRaw).not.toContain("=== 'genui'");
  });

  it('③ 动作只上报：两个渲染路径都透传 `onOpenGenui`（组件内不发请求）', () => {
    // MessageRow：声明 1 处 + 透传给 LiveTailView 1 处 = 2。
    expect(count(msgRaw, 'onOpenGenui:')).toBe(2);
    // LiveTailView：声明 1 处（卡片里是**调用** `this.onOpenGenui(...)`，不是键）。
    expect(count(liveRaw, 'onOpenGenui:')).toBe(1);
    expect(count(liveRaw, 'this.onOpenGenui(')).toBe(1);
    // ⛔ 组件层**不 import store**（分层铁律：动作/IO 留页面）。
    expect(msgRaw).not.toContain("from '../core/store'");
    expect(liveRaw).not.toContain("from '../core/store'");
  });

  it('④ 页面接线：`openGenuiPanel` 唯一实现 + 两个 MessageRowView 都接上', () => {
    expect(count(idxRaw, 'private async openGenuiPanel(')).toBe(1);
    // 两个 MessageRowView 实例化各调一次（live 行 + 历史行）。
    expect(count(idxRaw, 'openGenuiPanel(code, title)')).toBe(2);
    expect(count(idxRaw, 'onOpenGenui:')).toBe(2); // two MessageRowView instantiations
    // 打开前必须注入会话 cookie（否则内嵌 webview 401 落登录页）。
    expect(count(idxRaw, 'syncSessionCookieToWeb(store)')).toBeGreaterThanOrEqual(1);
  });

  it('⑤ 数据面：store 走 `/api/share/create`（单一真源构造请求体）', () => {
    expect(count(storeRaw, 'async shareGenuiPanel(')).toBe(1);
    expect(storeRaw).toContain("'/api/share/create'");
    expect(storeRaw).toContain('genuiShareBody(code, title)');
    expect(storeRaw).toContain('genuiPanelUrl(');
  });
});

process.exit(summary('genui'));

export {};

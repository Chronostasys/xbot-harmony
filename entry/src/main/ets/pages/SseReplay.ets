/**
 * SseReplay —— **debug 页面**：把真机录制的 SSE（`<filesDir>/sse/*.jsonl`）在 App 内**原样重放**
 * 一遍，走**同一套** `normalizeEvent → reduce → deriveRows → applyRow`，然后把
 * 「状态里的迭代/工具」与「渲染拿到的块/工具」并排打出来。
 *
 * 为什么（用户 2026-10-21）：「你直接渲染一个 debug 页面去模拟器里重放这些 sse」——
 * 这样不必再靠猜帧类/猜代码，缺哪枚工具一眼可见（状态有、块没有 ⇒ 渲染层；两边都没 ⇒ 状态机）。
 *
 * 入口：应用日志浮层里的 `REPLAY` 按钮（`router.pushUrl('pages/SseReplay')`）。
 */
import fs from '@ohos.file.fs';
import http from '@ohos.net.http';
import util from '@ohos.util';
import router from '@ohos.router';
import { normalizeEvent } from '../core/normalize';
import { reduce } from '../core/reduce';
import { initialChatState } from '../core/chat_types_full';
import type { ChatState, DomainEvent } from '../core/chat_types_full';
import { deriveRows } from '../core/derive';
import { applyRow } from '../core/render';
import { colorOf } from '../core/design';
import { paletteOf } from '../core/theme';
import { mergeToolRuns } from '../core/streammerge';
import { ChatRow } from '../core/types';
import type { HistoryIteration, ToolProgress } from '../core/types';
import type { WebIteration } from '../core/chattypes';

interface Envelope {
  type?: string;
  seq?: number;
  route_chat_id?: string;
  route_channel?: string;
  progress?: Envelope;
  chat_id?: string;
  channel?: string;
}

interface RawFrame {
  t?: number;
  u?: string;
  r?: string;
}

interface DumpLine {
  key: string;
  text: string;
}

function readText(path: string): string {
  try {
    const st = fs.statSync(path);
    const buf = new ArrayBuffer(st.size);
    const f = fs.openSync(path, fs.OpenMode.READ_ONLY);
    fs.readSync(f.fd, buf);
    fs.closeSync(f);
    const dec = util.TextDecoder.create('utf-8');
    return dec.decodeToString(new Uint8Array(buf));
  } catch (e) {
    return '';
  }
}

function toolList(ts: ToolProgress[] | undefined): string {
  const arr: ToolProgress[] = ts !== undefined ? ts : [];
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i];
    out.push(`${t.name}@${t.iteration !== undefined ? t.iteration : '-'}#${t.call_id !== undefined ? t.call_id : 'NOID'}:${t.status !== undefined ? t.status : ''}`);
  }
  return `[${out.join(', ')}]`;
}

@Entry
@Component
struct SseReplay {
  @State private summary: string = 'loading…';
  @State private lines: DumpLine[] = [];
  @State private picked: string = '';
  /** 主题名（与全站同一真源；调试页也要跟随主题，⛔ 不写死色值）。 */
  @StorageProp('appTheme') themeName: string = 'dark';
  private curPick: number = 0;

  aboutToAppear(): void {
    this.run(0);
  }

  private run(pick: number): void {
    this.curPick = pick;
    const dir = `${AppStorage.get<string>('xbotFilesDir') ?? ''}/sse`;
    let names: string[] = [];
    try {
      // ⛔ 按**体积降序**选（录制轮转会产生很多只有几帧的心跳小文件 —— 按名字/时间取最新的那个
      //   会拿到 3 帧的空文件，用户点了 REPLAY 只看到 `frames=3 events=0`）。
      const all: string[] = fs.listFileSync(dir).filter((n: string) => n.endsWith('.jsonl'));
      const sizes: Map<string, number> = new Map<string, number>();
      for (let i = 0; i < all.length; i++) {
        let sz: number = 0;
        try {
          sz = fs.statSync(`${dir}/${all[i]}`).size;
        } catch (e) {
          sz = 0;
        }
        sizes.set(all[i], sz);
      }
      names = all.sort((x: string, y: string) => (sizes.get(y) ?? 0) - (sizes.get(x) ?? 0));
    } catch (e) {
      this.summary = `无法列目录：${dir}`;
      return;
    }
    if (names.length === 0) {
      // ⛔ 模拟器沙箱推不进文件（permission denied）⇒ 从宿主机 `python3 -m http.server` 拉：
      //   `curl` 侧在宿主跑 `python3 -m http.server 8099`（服务 /tmp），这里落到本地后照常重放。
      this.summary = `本地无 .jsonl，正在从 mock 服务拉取…`;
      this.loadFromMock(dir);
      return;
    }
    const idx: number = Math.min(names.length - 1, Math.max(0, pick));
    const name: string = names[idx];
    this.picked = name;
    const text: string = readText(`${dir}/${name}`);
    const rawLines: string[] = text.split('\n');
    let state: ChatState = initialChatState('replay');
    let frames: number = 0;
    let events: number = 0;
    for (let i = 0; i < rawLines.length; i++) {
      const ln: string = rawLines[i];
      if (ln.length === 0) {
        continue;
      }
      let o: RawFrame;
      try {
        o = JSON.parse(ln) as RawFrame;
      } catch (e) {
        continue;
      }
      frames++;
      const raw: string = o.r !== undefined ? o.r : '';
      const pieces: string[] = raw.split('\n');
      const datas: string[] = [];
      for (let k = 0; k < pieces.length; k++) {
        if (pieces[k].startsWith('data:')) {
          datas.push(pieces[k].substring(5).replace(/^\s/, ''));
        }
      }
      if (datas.length === 0) {
        continue;
      }
      let payload: ESObject;
      try {
        payload = JSON.parse(datas.join('\n')) as ESObject;
      } catch (e) {
        continue;
      }
      // ⛔ 必须用**帧自带的 chat id**：`normalizeEvent` 会按 chat 身份过滤（我第一版写死
      //   `'replay'` ⇒ 全部事件被判"别的会话" ⇒ `events=0`，页面看起来像"没数据"）。
      let env: Envelope = payload as Envelope;
      if (env.progress !== undefined) {
        env = env.progress;
      }
      const chatId: string = env.chat_id !== undefined && env.chat_id.length > 0
        ? env.chat_id
        : ((payload as Envelope).route_chat_id !== undefined ? (payload as Envelope).route_chat_id as string : '');
      const evs: readonly DomainEvent[] | null = normalizeEvent(payload, chatId);
      if (evs === null) {
        continue;
      }
      for (let k = 0; k < evs.length; k++) {
        state = reduce(state, evs[k]);
        events++;
      }
    }
    // ── 结果：状态 vs 渲染 ──────────────────────────────────────────────
    const out: DumpLine[] = [];
    const rows = deriveRows(state);
    let liveSeen: number = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.kind === 'live') {
        liveSeen++;
        const its: readonly WebIteration[] = r.iterations;
        out.push({ key: `live-hdr-${i}`, text: `== LIVE turn=${r.turnID} iter=${r.lastIter} streaming=${r.streaming} stateIterations=${its.length}` });
        for (let k = 0; k < its.length; k++) {
          out.push({ key: `live-it-${i}-${k}`, text: `  STATE iter${its[k].iteration}: ${toolList(its[k].tools)}` });
        }
        const cr = new ChatRow();
        cr.id = `replay-${i}`;
        applyRow(cr, r);
        const blocks: HistoryIteration[] = mergeToolRuns(cr.iterations);
        out.push({ key: `live-blk-${i}`, text: `  → RENDER blocks=${blocks.length}` });
        for (let k = 0; k < blocks.length; k++) {
          out.push({ key: `live-bk-${i}-${k}`, text: `    BLOCK iter${blocks[k].iteration}: ${toolList(blocks[k].tools)}` });
        }
      }
    }
    this.summary = `file=${name} frames=${frames} events=${events} liveRows=${liveSeen}`
      + ` turns=${state.turns.size} active=${state.activeTurn}`;
    this.lines = out;
  }

  /** 从宿主机 mock 服务拉一份录制落到本地，然后走正常重放（调试用，零点击）。 */
  private loadFromMock(dir: string): void {
    const url: string = 'http://127.0.0.1:8099/rec3.jsonl';
    try {
      if (!fs.accessSync(dir)) {
        fs.mkdirSync(dir, true);
      }
    } catch (e) {
      this.summary = `建目录失败：${dir}`;
      return;
    }
    const req = http.createHttp();
    req.request(url, { method: http.RequestMethod.GET, connectTimeout: 5000, readTimeout: 20000 },
      (err: Object, res: Object) => {
        const r = res as Record<string, Object>;
        const code: number = r.responseCode !== undefined ? r.responseCode as number : 0;
        if (code !== 200) {
          this.summary = `mock 拉取失败 code=${code}（宿主是否起了 8099？）`;
          req.destroy();
          return;
        }
        const body: string = typeof r.result === 'string' ? r.result as string : '';
        const dst: string = `${dir}/mock-rec3.jsonl`;
        try {
          const f = fs.openSync(dst, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
          fs.writeSync(f.fd, body);
          fs.closeSync(f);
        } catch (e) {
          this.summary = `写本地失败：${dst}`;
          req.destroy();
          return;
        }
        req.destroy();
        this.run(0);
      });
  }

  build() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text('SSE REPLAY').fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1)
        Button('下一个').onClick(() => this.run(Math.min(this.curPick + 1, 20)))
        Button('关闭').onClick(() => router.back())
      }
      Text(this.summary).fontSize(12)
      Text(`file=${this.picked}`).fontSize(11).opacity(0.7)
      List({ space: 2 }) {
        ForEach(this.lines, (l: DumpLine) => {
          ListItem() {
            Text(l.text).fontSize(11).width('100%').wordBreak(WordBreak.BREAK_ALL)
          }
        }, (l: DumpLine) => l.key)
      }
      .layoutWeight(1)
      .width('100%')
    }
    .padding(12)
    .width('100%')
    .height('100%')
    .backgroundColor(colorOf(paletteOf(this.themeName), 'surface'))
  }
}

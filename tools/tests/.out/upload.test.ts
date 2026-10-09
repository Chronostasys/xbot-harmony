/**
 * uploadBytes（自检截图上传）的 multipart 编码测试。
 *
 * 为什么要测：ArkTS 没有 FormData，这段 multipart 是**手搓**的 ——
 * 若 boundary/part 头/字节拼接有误，上传会静默失败（真机上只表现为"走查失败"）。
 * 这里用 mock 服务端**真实解析**请求体，断言字段名/文件名/字节完全正确（二进制安全）。
 */
import { XbotHttp } from './http';

declare const require: (m: string) => any;
declare const Buffer: any;

const nodeHttp = require('http');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`);
  }
}

interface Seen {
  contentType: string;
  cookie: string;
  fieldName: string;
  filename: string;
  bytes: number[];
}

function startMock(state: Seen): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const srv = nodeHttp.createServer((req: any, res: any) => {
      const chunks: any[] = [];
      req.on('data', (c: any) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        state.contentType = req.headers['content-type'] || '';
        state.cookie = req.headers['cookie'] || '';
        const m = /boundary=(.+)$/.exec(state.contentType);
        if (m) {
          // Buffer 没有 split（按 boundary 字节手动切分），且必须保字节原样
          const delim = Buffer.from('--' + m[1]);
          const idxs: number[] = [];
          let pos = body.indexOf(delim);
          while (pos !== -1) {
            idxs.push(pos);
            pos = body.indexOf(delim, pos + delim.length);
          }
          for (let k = 0; k + 1 < idxs.length; k++) {
            const startIdx = idxs[k] + delim.length;
            const endIdx = idxs[k + 1];
            const part = body.slice(startIdx, endIdx);
            const headEnd = part.indexOf(Buffer.from('\r\n\r\n'));
            if (headEnd < 0) continue;
            const headerText = part.slice(0, headEnd).toString('latin1');
            const fileM = /filename="([^"]+)"/.exec(headerText);
            if (fileM) {
              const nameM = /name="([^"]+)"/.exec(headerText);
              state.fieldName = nameM ? nameM[1] : '';
              state.filename = fileM[1];
              let data = part.slice(headEnd + 4);
              // 去掉紧贴下一个 boundary 之前的 CRLF
              if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
                data = data.slice(0, data.length - 2);
              }
              state.bytes = Array.from(data);
            }
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, data: { key: 'uploads/1/shot.png' }, error: null }));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, close: () => srv.close() }));
  });
}

async function main(): Promise<void> {
  const state: Seen = { contentType: '', cookie: '', fieldName: '', filename: '', bytes: [] };
  const srv = await startMock(state);
  const h = new XbotHttp(`http://127.0.0.1:${srv.port}`);
  h.importSessionCookie('xbot_session=TOK1');

  // 构造一段"PNG"载荷（含 0x0D/0x0A/0x2D 等易被文本处理破坏的字节）
  const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x2d, 0x2d, 0x00, 0xff, 0x7f]);

  let err = '';
  try {
    await h.uploadBytes('/api/files/upload', '01-chat.png', payload.buffer as ArrayBuffer, 'image/png');
  } catch (e) {
    const e2: Error = e as Error;
    err = e2.message !== undefined ? e2.message : `${e}`;
  }

  ok('uploadBytes 不抛错', err === '', err);
  ok('Content-Type 是 multipart 且带 boundary', state.contentType.indexOf('multipart/form-data') === 0
    && state.contentType.indexOf('boundary=') > 0, state.contentType);
  ok('字段名是 file（服务端契约）', state.fieldName === 'file', state.fieldName);
  ok('文件名原样传递（便于识别页面）', state.filename === '01-chat.png', state.filename);
  ok('携带会话 Cookie（/api/files/upload 需鉴权）', state.cookie.indexOf('xbot_session=TOK1') >= 0, state.cookie);
  ok('字节二进制安全（含 0x0d/0x0a/0x2d 也未被破坏）',
    state.bytes.length === payload.length && state.bytes.every((b: number, i: number) => b === payload[i]),
    `got=${JSON.stringify(state.bytes)} want=${JSON.stringify(Array.from(payload))}`);

  srv.close();
  console.log(`upload.test: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    throw new Error('uploadBytes 测试失败');
  }
}

main();

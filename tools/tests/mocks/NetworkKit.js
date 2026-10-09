/**
 * `@kit.NetworkKit` 的 Node 实现（仅测试用）—— 让 core/http.ets 能在 Linux 上"真跑"。
 *
 * ⚠️ 关键保真点：**set-cookie 以数组形态暴露**。真机（鸿蒙）对同名响应头给的是字符串数组，
 * 而这正是 2026-10-09 「登录报 undefined is not callable」的根因场景 —— 不保真就测不出这个 bug。
 */
const nodeHttp = require('http');
const nodeHttps = require('https');
const { URL } = require('url');

function perform(url, options) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? nodeHttps : nodeHttp;
    const headers = Object.assign({}, options.header || {});
    const req = lib.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: options.method || 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const header = {};
          for (const k of Object.keys(res.headers)) {
            const v = res.headers[k];
            header[k] = Array.isArray(v) ? v.slice() : v;
          }
          // 可选的"字符串形态"仿真：服务端回 x-test-setcookie-string 时，把数组拼成单串
          if (header['x-test-setcookie-string'] !== undefined && Array.isArray(header['set-cookie'])) {
            header['set-cookie'] = header['set-cookie'].join(', ');
          }
          const expect = options.expectDataType;
          const result = expect === 2
            ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
            : buf.toString('utf8');
          resolve({ result, responseCode: res.statusCode, header });
        });
      },
    );
    req.on('error', reject);
    // 真机 http.request 接受 extraData: ArrayBuffer / string；
    // Node 的 req.write 只吃 Buffer/Uint8Array/string ⇒ 这里做等价转换（保真 SDK 行为）
    let body = options.extraData;
    if (body !== undefined && body !== null) {
      if (body instanceof ArrayBuffer) body = Buffer.from(body);
      else if (ArrayBuffer.isView(body)) body = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
      req.write(body);
    }
    req.end();
  });
}

function createHttp() {
  return {
    request(url, options) { return perform(url, options); },
    requestInStream(url, options, cb) { perform(url, options).then(() => cb(undefined, 0)).catch((e) => cb(e, 0)); },
    on() {},
    off() {},
    destroy() {},
  };
}

module.exports = {
  http: {
    createHttp,
    RequestMethod: { GET: 'GET', POST: 'POST' },
    HttpDataType: { STRING: 0, OBJECT: 1, ARRAY_BUFFER: 2 },
  },
};

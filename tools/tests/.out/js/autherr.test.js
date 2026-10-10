"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const autherr_1 = require("./autherr");
let pass = 0, fail = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
    }
}
const real = 'HTTP 401: {"ok":false,"data":null,"error":{"code":"unauthorized","message":"unauthorized"}}';
eq('真实 401 报文判为会话失效', (0, autherr_1.isUnauthorized)(real), true);
eq('仅 code=unauthorized', (0, autherr_1.isUnauthorized)('{"code":"unauthorized"}'), true);
eq('大小写不敏感', (0, autherr_1.isUnauthorized)('http 401: unauthorized'), true);
eq('网络错误不算会话失效', (0, autherr_1.isUnauthorized)('HTTP 502: bad gateway'), false);
eq('超时不算会话失效', (0, autherr_1.isUnauthorized)('[发送 /api/history] connect timeout'), false);
eq('401 标题', (0, autherr_1.loadErrTitle)(real), '登录已过期');
eq('其他标题', (0, autherr_1.loadErrTitle)('HTTP 502: bad gateway'), '加载会话失败');
eq('401 提示指向重新登录', (0, autherr_1.loadErrHint)(real).indexOf('重新登录') >= 0, true);
eq('401 提示明确否定网络问题', (0, autherr_1.loadErrHint)(real).indexOf('不是网络问题') >= 0, true);
eq('5xx 提示', (0, autherr_1.loadErrHint)('HTTP 500: boom').indexOf('服务端出错') >= 0, true);
eq('其他提示指向网络/地址', (0, autherr_1.loadErrHint)('connect timeout').indexOf('网络不通') >= 0, true);
eq('401 需要重新登录按钮', (0, autherr_1.needsRelogin)(real), true);
eq('网络错误只需重试', (0, autherr_1.needsRelogin)('connect timeout'), false);
if (fail > 0) {
    console.log(`  autherr: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  autherr: ${pass} passed, 0 failed`);
process.exit(0);

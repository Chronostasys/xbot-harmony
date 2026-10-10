/** 错误分类测试（把 401 当网络故障是本仓真实事故，必须钉死）。 */
declare const process: { exit: (c: number) => void };

import {
  isUnauthorized, loadErrHint, loadErrTitle, needsRelogin,
} from '../../entry/src/main/ets/core/autherr';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const real = 'HTTP 401: {"ok":false,"data":null,"error":{"code":"unauthorized","message":"unauthorized"}}';

eq('真实 401 报文判为会话失效', isUnauthorized(real), true);
eq('仅 code=unauthorized', isUnauthorized('{"code":"unauthorized"}'), true);
eq('大小写不敏感', isUnauthorized('http 401: unauthorized'), true);
eq('网络错误不算会话失效', isUnauthorized('HTTP 502: bad gateway'), false);
eq('超时不算会话失效', isUnauthorized('[发送 /api/history] connect timeout'), false);

eq('401 标题', loadErrTitle(real), '登录已过期');
eq('其他标题', loadErrTitle('HTTP 502: bad gateway'), '加载会话失败');

eq('401 提示指向重新登录', loadErrHint(real).indexOf('重新登录') >= 0, true);
eq('401 提示明确否定网络问题', loadErrHint(real).indexOf('不是网络问题') >= 0, true);
eq('5xx 提示', loadErrHint('HTTP 500: boom').indexOf('服务端出错') >= 0, true);
eq('其他提示指向网络/地址', loadErrHint('connect timeout').indexOf('网络不通') >= 0, true);

eq('401 需要重新登录按钮', needsRelogin(real), true);
eq('网络错误只需重试', needsRelogin('connect timeout'), false);

if (fail > 0) { console.log(`  autherr: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  autherr: ${pass} passed, 0 failed`);
process.exit(0);

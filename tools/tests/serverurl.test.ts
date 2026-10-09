/**
 * 服务端地址解析测试。
 *
 * 为什么值得锁：这是"能不能连上"的第一道门 —— 手机端让用户手打 IP:端口，
 * 协议/尾斜杠/空白写错都会变成难懂的连接失败。这里把容错规则钉死。
 */
declare const process: { exit: (c: number) => void };
import { isValidServerUrl, normalizeServerUrl } from '../../entry/src/main/ets/core/endpoint';

let pass = 0;
let fail = 0;

function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

// 补协议
eq('裸 ip:端口 → 补 http://', normalizeServerUrl('192.168.1.10:16000'), 'http://192.168.1.10:16000');
eq('裸域名 → 补 http://', normalizeServerUrl('xbot.local:16000'), 'http://xbot.local:16000');
// 保协议
eq('已是 https 不动', normalizeServerUrl('https://x.home:8443'), 'https://x.home:8443');
eq('已是 http 不动', normalizeServerUrl('http://a.b:16000'), 'http://a.b:16000');
// 去空白 / 尾斜杠
eq('去首尾空白', normalizeServerUrl('  http://a:16000  '), 'http://a:16000');
eq('去尾斜杠', normalizeServerUrl('http://a:16000/'), 'http://a:16000');
eq('去多个尾斜杠', normalizeServerUrl('http://a:16000///'), 'http://a:16000');
eq('空串 → 空串', normalizeServerUrl('   '), '');
// 校验
eq('合法 http', isValidServerUrl('http://192.168.1.10:16000'), true);
eq('合法 https', isValidServerUrl('https://x.home:8443'), true);
eq('无主机拒绝', isValidServerUrl('http://'), false);
eq('无协议拒绝', isValidServerUrl('192.168.1.10:16000'), false);
eq('带空格拒绝', isValidServerUrl('http://a b:1'), false);
// 组合（登录路径就是这样用的）
eq('组合：先规范再校验', (() => {
  const u = normalizeServerUrl(' 10.0.0.5:16000/ ');
  return [u, isValidServerUrl(u)];
})(), ['http://10.0.0.5:16000', true]);

console.log(`serverurl.test: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  throw new Error('服务端地址解析测试失败');
}

// 显式退出：node 的事件循环可能被 mock 网络句柄/定时器拉住，不退出会让
// run.sh（set -e 顺序执行）永远卡在本文件，后续测试根本不跑。
process.exit(0);

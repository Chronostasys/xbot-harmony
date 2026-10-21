/**
 * pushreg —— App 侧「本机 Push Token 取用与上报」的判别力测试（纯逻辑面；不联网、不碰真 SDK）。
 *
 * 覆盖：
 *  ① 错误码 → 可执行中文（尤其 `1000900012 推送权益未开通`：这是"要去 AGC 开通 + 重签 profile"
 *     那条，文案必须能直接指导用户；⛔ 不许退化成"获取失败"这类无用话）；
 *  ② 上报判据（token 变了必报；失败过必重试；其余按间隔省流量）；
 *  ③ 设备名/掩码（真 token 绝不整串外露）。
 */
declare const process: { exit: (c: number) => void };

import {
  PUSH_REREGISTER_MIN_MS, PushRegParams, PushRegState, maskTokenForLog, pushDeviceName,
  pushErrorHint, pushPluginActiveFromStatus, pushShouldRegister,
} from '../../entry/src/main/ets/core/pushreg';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function has(name: string, s: string, sub: string): void {
  ok(`${name}（应含「${sub}」）`, s.indexOf(sub) >= 0);
}

console.log('\n▶ ① 错误码 → 可执行中文');
has('1000900012 权益未开通 → 指明 AGC + profile', pushErrorHint(1000900012, ''), 'AGC');
has('1000900012 权益未开通 → 点出"权益"', pushErrorHint(1000900012, ''), '权益未开通');
has('1000900010 身份非法 → 指向签名/包名', pushErrorHint(1000900010, ''), '签名 profile');
has('1000900008 连不上 → 提示网络', pushErrorHint(1000900008, ''), '网络');
has('1000900014 设备不支持 → 明确说设备不支持', pushErrorHint(1000900014, ''), '不支持');
const unknown: string = pushErrorHint(999, 'boom');
has('未知码保留原始信息', unknown, '999');
has('未知码保留服务端原文', unknown, 'boom');
ok('未知码不伪造原因（不与已知码文案相同）',
  unknown !== pushErrorHint(1000900012, ''));

console.log('\n▶ ② 上报判据');
const st = new PushRegState();
ok('没取到 token ⇒ 不报', pushShouldRegister(st, '', 1000) === false);
ok('首次拿到 token ⇒ 必报', pushShouldRegister(st, 'tokA', 1000) === true);
st.reportedToken = 'tokA';
st.reportedAt = 1000;
ok('同 token + 刚报过 ⇒ 不报（省流量）',
  pushShouldRegister(st, 'tokA', 1000 + PUSH_REREGISTER_MIN_MS - 1) === false);
ok('同 token + 超过间隔 ⇒ 报（周期续约）',
  pushShouldRegister(st, 'tokA', 1000 + PUSH_REREGISTER_MIN_MS) === true);
ok('token 变了 ⇒ 必报（换机/重装/换 token，结构事件不受间隔限制）',
  pushShouldRegister(st, 'tokB', 1001) === true);
const failed = new PushRegState();
failed.reportedToken = 'tokA';
failed.reportedAt = 5000;
failed.failCount = 2;
ok('上次失败过 ⇒ 必重试（失败不许被间隔永久压住）',
  pushShouldRegister(failed, 'tokA', 5001) === true);

console.log('\n▶ ③ 设备名与掩码');
ok('品牌 + 型号', pushDeviceName('HUAWEI', 'Mate 70') === 'HUAWEI Mate 70');
ok('只有品牌', pushDeviceName('HUAWEI', '  ') === 'HUAWEI');
ok('只有型号', pushDeviceName('', 'Mate 70') === 'Mate 70');
ok('都空 ⇒ 兜底名（不让台账出现空名）', pushDeviceName('', '') === 'HarmonyOS 设备');
// ⛔ 华为 marketName/productModel 常已以品牌开头；再拼一次会变成
//    `HUAWEI HUAWEI Mate 90 Pro Max`（用户 2026-10-20 亲报）。
ok('型号已含品牌 ⇒ 不重复品牌', pushDeviceName('HUAWEI', 'HUAWEI Mate 90 Pro Max') === 'HUAWEI Mate 90 Pro Max');
ok('型号已含品牌（大小写不敏感）', pushDeviceName('HUAWEI', 'huawei Mate 90') === 'huawei Mate 90');
ok('型号只是品牌 ⇒ 不重复', pushDeviceName('HUAWEI', 'HUAWEI') === 'HUAWEI');
ok('HUAWEIxxx 不是完整品牌词 ⇒ 仍拼接', pushDeviceName('HUAWEI', 'HUAWEIX Mate') === 'HUAWEI HUAWEIX Mate');
ok('短 token 只显示 ***', maskTokenForLog('abcdefgh') === '***');
const long: string = maskTokenForLog('MOCK_PUSH_TOKEN_0123456789');
ok('长 token 掩码为 前6…后4', long === 'MOCK_P…6789');
ok('掩码不含完整原文', long.indexOf('MOCK_PUSH_TOKEN_0123456789') < 0);

console.log('\n▶ ④ RPC 参数形态（服务端 register_token 读这四个键）');
const p = new PushRegParams('tok', '我的手机', '7.0.0');
ok('token 透传', p.token === 'tok');
ok('name 透传', p.name === '我的手机');
ok('platform 默认 HarmonyOS', p.platform === 'HarmonyOS');
ok('version 透传', p.version === '7.0.0');

console.log('\n▶ ⑤ 插件探活判据（用户要求：先判 active 再请求）');
// 形态来自服务端 `plugin_status`：{"plugins":[{"id","name","version","state","runtime"}],"active","total"}
const okData: Object = {
  plugins: [
    { id: 'xbot.git-fancy', name: 'Git', version: '0.3.5', state: 'active', runtime: 'stdio' },
    { id: 'xbot.harmony-push', name: '鸿蒙推送', version: '1.0.0', state: 'active', runtime: 'stdio' },
  ],
  active: 2, total: 2,
};
ok('本插件 active ⇒ 放行', pushPluginActiveFromStatus(okData) === true);
ok('本插件 error ⇒ 不发请求（这是"一进去就500"那种窗口）',
  pushPluginActiveFromStatus({ plugins: [{ id: 'xbot.harmony-push', state: 'error' }] }) === false);
ok('本插件 discovered（未激活）⇒ 不放行',
  pushPluginActiveFromStatus({ plugins: [{ id: 'xbot.harmony-push', state: 'discovered' }] }) === false);
ok('列表里没有本插件（未安装）⇒ 不放行',
  pushPluginActiveFromStatus({ plugins: [{ id: 'xbot.git-fancy', state: 'active' }] }) === false);
ok('plugins 缺失 ⇒ 不放行（不崩）', pushPluginActiveFromStatus({}) === false);
ok('plugins 为空数组 ⇒ 不放行', pushPluginActiveFromStatus({ plugins: [] }) === false);
ok('undefined / null ⇒ 不放行', pushPluginActiveFromStatus(undefined) === false
  && pushPluginActiveFromStatus(null as unknown as Object) === false);
ok('state 缺失（undefined）⇒ 不放行',
  pushPluginActiveFromStatus({ plugins: [{ id: 'xbot.harmony-push' }] }) === false);

if (fail > 0) {
  console.log(`  pushreg: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  pushreg: ${pass} passed, 0 failed`);
process.exit(0);

export {};

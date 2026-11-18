/**
 * 渲染层去重键**必须带迭代号**（用户 2026-10-29 P0：
 * 「连续工具组只有 tool1 能渲染，从 tool2 开始 done 就消失」）。
 *
 * 服务端每迭代从 call_0 重新编号 ⇒ 不带迭代号时 tool1/tool2 同键 ⇒ 吞。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => { readFileSync: (p: string, e: string) => string };
declare const __dirname: string;

const fs = require('fs');
const root = __dirname + '/../../../..';
// ⚡ 2026-11-14：渲染层去重已收敛到 `core/streammerge.pillView`（直出/徽标/溢出同源，
//   见 `pill_badge_single_source` 判据）⇒ 去重键的唯一落点搬到那里，本判据改钉新落点
//   （**断言意图不变**：键必须带迭代号，无迭代号的旧键不得存在）。
const src: string = fs.readFileSync(root + '/entry/src/main/ets/core/streammerge.ets', 'utf8');

let gdi_pass = 0, gdi_fail = 0;
function gdi_ok(name: string, cond: boolean): void {
  if (cond) { gdi_pass++; } else { gdi_fail++; console.log('  ✗ ' + name); }
}

gdi_ok('去重键含迭代号', src.indexOf('`c:${iter}#${cid}`') >= 0);
gdi_ok('旧的无迭代号键已移除', src.indexOf('`c:${cid}`') < 0);

console.log('group_dedupe_iter: ' + gdi_pass + ' passed, ' + gdi_fail + ' failed');
if (gdi_fail > 0) { process.exit(1); }

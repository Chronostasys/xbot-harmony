/**
 * 通知品牌小图标的**源码形态判据**（判别力）。
 * 为什么读源码：`core/notify.ets` 被 run.sh 当纯 TS 编译，`workreconcile/icons.ets` 是 ArkTS 侧
 * （import `@ohos.*`）⇒ 组件/ArkTS 层无法直接 import 单测，只能用形态断言（本仓既有先例）。
 *
 * mutation（改坏必红）：
 *   · 删掉 `notifyDecorator(request)` 调用       ⇒ 'core 装饰钩子被调用' 红
 *   · 把解码搬进 publishTurn / 删除 icons.ets    ⇒ '唯一解码点' 红
 *   · 在 core/notify.ets 新增 `@ohos.multimedia` ⇒ 'core 未新增 @ohos import' 红
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const notifySrc = stripComments(fs.readFileSync(path.join(ROOT, 'entry/src/main/ets/core/notify.ets'), 'utf-8'));
const iconSrc = stripComments(fs.readFileSync(path.join(ROOT, 'entry/src/main/ets/workreconcile/icons.ets'), 'utf-8'));

// ① core 侧：钩子定义 + 在 publishTurn 里被调用（且仍无新增 SDK import）
ok('core：装饰端口 setNotifyDecorator 已定义', notifySrc.indexOf('export function setNotifyDecorator(') >= 0);
ok('core：publishTurn 里真的调了装饰器', notifySrc.indexOf('notifyDecorator(request);') >= 0);
ok('⛔ core/notify.ets 未新增 image/multimedia import（分层铁律）',
  notifySrc.indexOf('@ohos.multimedia.image') < 0 && notifySrc.indexOf('@kit.ImageKit') < 0);
ok('⛔ core：publishTurn 内**不做解码**（装饰是端口，解析不在这层）',
  notifySrc.indexOf('createImageSource(') < 0);

// ② ArkTS 侧：唯一解码点 + 不在 publish 路径
const allIcon = iconSrc.split('image.createImageSource(').length - 1;
ok(`⛔ 全仓唯一解码点（icons.ets 内 image.createImageSource( 恰好 1 处，实测 ${allIcon}）`, allIcon === 1);
ok('解码封装在独立函数里（decodeMedia）', iconSrc.indexOf('async function decodeMedia(') >= 0);
ok('结果被缓存（memo 模块级）', iconSrc.indexOf('let memo: image.PixelMap | null = null;') >= 0);
ok('只尝试一次（tried 守卫）', iconSrc.indexOf('if (tried) {') >= 0);
// 解码不得出现在装饰器回调体内（= 每次 publish 才解码的性能坑）
const cbIdx = iconSrc.indexOf('setNotifyDecorator(');
const cbBody = cbIdx < 0 ? '' : iconSrc.substring(cbIdx);
ok('⛔ 装饰器回调体内**不含**解码（否则每次发通知都解码）', cbBody.indexOf('createImageSource(') < 0);
ok('回调只做赋值 req.smallIcon = memo', cbBody.indexOf('req.smallIcon = memo;') >= 0);

// ③ 回退链 + 静默
ok('⛔ 主选 = PNG 位图（brand_mark_128；SDK 推荐 128×128）', iconSrc.indexOf("$r('app.media.brand_mark_128')") >= 0);
ok('⛔ PNG 必须在 SVG **之前**（翻转后的期望顺序）', (() => { const a = iconSrc.indexOf("$r('app.media.brand_mark_128')"); const b = iconSrc.indexOf("$r('app.media.brand_mark_outline')"); return a >= 0 && b >= 0 && a < b; })());
ok('SVG 作为兜底仍在位', iconSrc.indexOf("$r('app.media.brand_mark_outline')") >= 0);
ok('两路都失败 ⇒ 不装饰并留证据日志', iconSrc.indexOf('不设 smallIcon') >= 0);
ok('cast 在 ArkTS 侧（request as NotificationRequest）',
  iconSrc.indexOf('as notificationManager.NotificationRequest') >= 0);

// ── #5 接线判据：对账产出 → 聚合通知（真接上消费方，避免门禁 ⑧ 零消费告警）──────────────
const abilSrc = stripComments(fs.readFileSync(
  path.join(ROOT, 'entry/src/main/ets/workreconcile/NotifyReconcileAbility.ets'), 'utf-8'));
const recSrc = stripComments(fs.readFileSync(
  path.join(ROOT, 'entry/src/main/ets/core/reconcile.ets'), 'utf-8'));
ok('⛔ summarizeMissed 有真实消费方（否则 ⑧ 零消费=假绿）',
  abilSrc.indexOf('summarizeMissed(items)') >= 0);
ok('消费点在 workreconcile 扩展里（不在 core 自消费）',
  recSrc.indexOf('summarizeMissed(') > 0 && abilSrc.indexOf('summarizeMissed(') >= 0);
ok('⛔ count==0 ⇒ **不发**通知（硬门禁）', abilSrc.indexOf('sum.count > 0') >= 0);
ok('else 分支留下证据日志（可判"为什么没发"）', abilSrc.indexOf('summary count=0') >= 0);
ok('文案唯一来源 = summarizeMissed（本层不另写文案）',
  abilSrc.indexOf('sum.text') >= 0 && abilSrc.indexOf("'回复好了'") < 0);
ok('点进路由：wantAgent 带 chat_id', abilSrc.indexOf('chat_id: chatId') >= 0);
ok('复用既有 notify_action 机制', abilSrc.indexOf("notify_action: 'open'") >= 0);
ok('wantAgent 失败静默（仍会起应用，不丢通知）', abilSrc.indexOf('wantAgent failed') >= 0);
ok('⛔ 未新增 setTimeout（性能预算 ⑦ 已满 7/7）', abilSrc.indexOf('setTimeout') < 0);

if (fail > 0) { console.log(`  notify_icon: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  notify_icon: ${pass} passed, 0 failed`);
process.exit(0);
export {};

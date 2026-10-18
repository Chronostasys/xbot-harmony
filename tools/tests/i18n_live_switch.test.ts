/**
 * i18n 实时切换 / 冷启动持久化 **接线判据**（2026-10-18 用户三连报）。
 *
 * 根因不是翻译表缺 key，而是「值变了但没人重渲 / 首帧没读到本地语言」：
 *   · 侧边栏组标题/分类/渠道/时间文案来自 `core/*` 中文常量，且 `drawerGroups()` 的
 *     缓存指纹不含 locale ⇒ 切日文后缓存仍返回中文；打开设置再回来只是碰巧重建；
 *   · 设置面板各组件没有语言订阅 ⇒ `setLocale` 后当前面板不重渲；
 *   · 冷启动只从服务端 settings 异步拿 locale ⇒ 首帧（侧边栏）先中文。
 *
 * 本判据钉**调用点**（不是"方法存在"）：少任何一处接线都必须红。
 */
declare const require: (name: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fsMod = require('fs');
const pathMod = require('path');
const cpMod = require('child_process');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function read(rel: string): string {
  const cands: string[] = [
    pathMod.join(process.cwd(), rel),
    pathMod.join(process.cwd(), '..', rel),
    pathMod.join(process.cwd(), '..', '..', rel),
  ];
  for (let i = 0; i < cands.length; i++) {
    try { return fsMod.readFileSync(cands[i], 'utf-8'); } catch (e) { /* next */ }
  }
  return '';
}
function count(src: string, re: RegExp): number {
  const m = src.match(re);
  return m === null ? 0 : m.length;
}
/** 绕过 `i18n_normalize.js`（它把 `i18nT(...)` 剥成裸文案，供旧 shape 判据）读原文。 */
function raw(rel: string): string {
  const cands: string[] = [
    pathMod.join(process.cwd(), rel),
    pathMod.join(process.cwd(), '..', rel),
    pathMod.join(process.cwd(), '..', '..', rel),
  ];
  for (let i = 0; i < cands.length; i++) {
    try { return cpMod.execFileSync('cat', [cands[i]], { encoding: 'utf8' }); } catch (e) { /* next */ }
  }
  return '';
}

const root = 'entry/src/main/ets';
const i18n = read(`${root}/core/i18n.ets`);
const config = read(`${root}/core/config.ets`);
const ability = read(`${root}/entryability/EntryAbility.ets`);
const index = read(`${root}/pages/Index.ets`);
const panel = read(`${root}/components/SettingsPanel.ets`);
const appearance = read(`${root}/components/SettingsAppearance.ets`);
const rows = read(`${root}/components/SettingsRows.ets`);
const panelRaw = raw(`${root}/components/SettingsPanel.ets`);
const rowsRaw = raw(`${root}/components/SettingsRows.ets`);
const bubble = read(`${root}/components/UserBubble.ets`);

// ── 1. 冷启动首帧：本地同步读 locale + 每个设置项变更写本地 ──
ok('config 暴露 readCachedLocale（同步首帧）', /export function readCachedLocale/.test(config));
ok('config 持久化 locale（saveLocale）', /async saveLocale\(/.test(config));
ok('EntryAbility 首帧前 initLocale(readCachedLocale(...))', /initLocale\(readCachedLocale\(/.test(ability));
ok('Index bootstrap 对齐本地 locale', /initLocale\(saved\.locale\)/.test(index));
ok('Index 订阅变更写本地 + AppStorage', /saveLocale\(loc\)/.test(index)
  && count(index, /AppStorage\.setOrCreate<string>\('appLocale'/g) >= 2);

// ── 2. 当前面板 / 已存在组件即时重渲（组件级订阅，不靠父级重投递） ──
ok('SettingsPanel 订阅 appLocale', /@StorageProp\('appLocale'\)/.test(panel));
ok('SettingsAppearance 订阅 appLocale', /@StorageProp\('appLocale'\)/.test(appearance));
ok('SettingsRows 每类原子都订阅 appLocale',
  count(rows, /@StorageProp\('appLocale'\)/g) >= 10);
ok('UserBubble 通知正文即时重译（行键含 locale，随 rowDs 重载）',
  /isNotification \? tNotification\(plain\) : plain/.test(bubble));

// ── 3. 侧边栏缓存/文案必须随语言变化 ──
ok('drawerFingerprint 调用点带 getLocale()', /drawerFingerprint\([^;]*getLocale\(\)/.test(index));
// 翻译在 core 纯函数内部（页面仍调用同名的唯一出口，source gate 继续钉调用点）。
const sg = read(`${root}/core/sessiongroup.ets`);
const sp = read(`${root}/core/sessionpick.ets`);
const ind = read(`${root}/core/indicators.ets`);
ok('分组标题翻译后再入缓存', /dg\.title = groupTitle\(/.test(index) && /return t\(timeBucketLabel/.test(sg));
ok('分类标签翻译', /return t\('时间'\)/.test(sg));
ok('渠道标签翻译', /return active\.length === 0 \? t\('全部'\)/.test(sp));
ok('空态文案翻译', /return t\('还没有会话'\)/.test(ind));
ok('相对时间翻译', /return t\('刚刚'\)/.test(sg) && /return t\('\{\{n\}\} 分钟前'\)/.test(sg));

// ── 4. 设置页静态标签不再绕过 i18nT ──
ok('设置页根行 label 翻译', /Text\(i18nT\(r\.label\)\)/.test(panelRaw));
ok('设置页头部标题/偏好设置翻译', /i18nT\(this\.active\.length > 0/.test(panel));
ok('SettingsPanelHeader subtitle 翻译', /Text\(i18nT\(this\.subtitle\)\)/.test(rowsRaw));
ok('SettingsValueRow value 翻译', /Text\(i18nT\(this\.value\)\)/.test(rowsRaw));

// ── 5. 通知协议标签翻译器 ──
ok('i18n 暴露 tNotification', /export function tNotification/.test(i18n));
ok('通知覆盖后台任务/定时任务/合并通知',
  i18n.includes('Background task') && i18n.includes('定时任务触发') && i18n.includes('合并通知'));

console.log(`i18n_live_switch: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

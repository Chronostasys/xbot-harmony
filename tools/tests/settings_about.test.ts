/**
 * 设置「关于 / 账号」分区的**纯逻辑契约测试**。
 *
 * 判别力重点（用户点名要求的三类：取值域校验 / 默认值回落 / 键映射）：
 *  1. **取值域**：`check_update` 有 4 个取值域（未检查 / `skipped` / 有新版 / 已最新），
 *     判定顺序错 ⇒ 把"跳过检查"显示成"已是最新"（用户以为真的检查过了）。
 *  2. **默认值回落**：服务端字段全部可能缺失/为空（`internal/selfupdate` 的字段随构建方式变化，
 *     ldflags 未注入时 version 是 `dev`、commit 可能空）⇒ 面板必须显示 `—` 而不是空白行。
 *  3. **键映射**：`managedBy` 是枚举字面量（`systemd|launchd|supervisord|docker|none`，
 *     `SettingsAbout.tsx:35`）⇒ 映射漏一个就显示英文原值；未知值要**原样透传**（不能吞）。
 *
 * 另：`CONFIG_SURFACE_METHODS` 是"就地定义、待折叠进 core/rpc.ets"的 method 清单，
 * 用完整性断言把"加了 method 忘了登记"钉死。
 */
declare const process: { exit: (c: number) => void };

import {
  accountDisplayName, CONFIG_SURFACE_METHODS, formatBuildTime, managedByLabel, MetaLine, osArch,
  RPC_CHECK_UPDATE, RPC_GET_SYSTEM_INFO, shortCommit, systemInfoLines, SystemInfoRow, textOrDash,
  UpdateCheckRow, updateStatusText,
} from '../../entry/src/main/ets/core/settings';
import { isLightPalette, Palette, paletteOf } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ① RPC method 名（就地定义，待折叠进 core/rpc.ets）─────────────────────────

eq('about methods', [RPC_GET_SYSTEM_INFO, RPC_CHECK_UPDATE], ['get_system_info', 'check_update']);
eq('就地登记清单（含 about 两个）', CONFIG_SURFACE_METHODS,
  ['get_storage_config', 'set_storage_config', 'list_web_users', 'create_web_user', 'delete_web_user',
    'get_system_info', 'check_update']);
eq('清单无重复', new Set(CONFIG_SURFACE_METHODS).size, CONFIG_SURFACE_METHODS.length);
ok('about 的两个 method 都已登记',
  CONFIG_SURFACE_METHODS.indexOf(RPC_GET_SYSTEM_INFO) >= 0
    && CONFIG_SURFACE_METHODS.indexOf(RPC_CHECK_UPDATE) >= 0);

// ── ② 默认值回落 ─────────────────────────────────────────────────────────────

eq('回落：空串 ⇒ —', textOrDash(''), '—');
eq('回落：纯空白 ⇒ —', textOrDash('   '), '—');
eq('回落：undefined ⇒ —', textOrDash(undefined), '—');
eq('回落：正常值原样', textOrDash('  v1.2.3  '), 'v1.2.3');

eq('提交号：长 ⇒ 截 12', shortCommit('0123456789abcdef'), '0123456789ab');
eq('提交号：短 ⇒ 原样', shortCommit('abc123'), 'abc123');
eq('提交号：空 ⇒ —', shortCommit(undefined), '—');
eq('提交号：纯空白 ⇒ —', shortCommit('  '), '—');

eq('osArch：都有', osArch('linux', 'arm64'), 'linux/arm64');
eq('osArch：缺 arch', osArch('linux', undefined), 'linux');
eq('osArch：缺 os', osArch(undefined, 'arm64'), 'arm64');
eq('osArch：都缺 ⇒ —', osArch(undefined, undefined), '—');
eq('osArch：空白视为缺', osArch('  ', '  '), '—');

// 构建时间：能解析 ⇒ 本地可读；解析失败 ⇒ **原样**（不吞信息）；空 ⇒ —
const iso = new Date(2026, 9, 11, 9, 5, 0).toISOString();
eq('构建时间：ISO 可读化', formatBuildTime(iso), '2026-10-11 09:05');
eq('构建时间：非法原样', formatBuildTime('not-a-date'), 'not-a-date');
eq('构建时间：空 ⇒ —', formatBuildTime(''), '—');
eq('构建时间：undefined ⇒ —', formatBuildTime(undefined), '—');

// ── ③ 键映射（managedBy 枚举）──────────────────────────────────────────────

eq('托管：systemd', managedByLabel('systemd'), 'systemd 托管');
eq('托管：launchd', managedByLabel('launchd'), 'launchd 托管');
eq('托管：supervisord', managedByLabel('supervisord'), 'supervisord 托管');
eq('托管：docker', managedByLabel('docker'), 'Docker 容器');
eq('托管：none', managedByLabel('none'), '手动启动');
eq('托管：空 ⇒ 未知', managedByLabel(undefined), '未知');
eq('托管：未知值**原样透传**', managedByLabel('k8s'), 'k8s');

// ── ④ systemInfoLines：顺序 + 兜底 + devBuild 后缀 ─────────────────────────

const info: SystemInfoRow = {
  version: '1.4.2', commit: '0123456789abcdef', buildTime: iso, channel: 'stable',
  goVersion: 'go1.23.4', os: 'linux', arch: 'arm64', exePath: '/usr/local/bin/xbot',
  managedBy: 'systemd', devBuild: false,
};
const lines: MetaLine[] = systemInfoLines(info);
eq('行数', lines.length, 8);
eq('行顺序（键映射顺序）', lines.map((l: MetaLine) => l.label),
  ['版本', '提交', '构建时间', '渠道', '运行时', '平台', '托管方式', '程序路径']);
eq('版本行', lines[0].value, '1.4.2');
eq('提交行截断', lines[1].value, '0123456789ab');
eq('平台行', lines[5].value, 'linux/arm64');
eq('托管行中文', lines[6].value, 'systemd 托管');
// 空壳：所有字段缺失也要出满 8 行且全为 —
const shellLines: MetaLine[] = systemInfoLines({} as SystemInfoRow);
eq('空壳行数', shellLines.length, 8);
eq('空壳全兜底（除托管为"未知"）', shellLines.map((l: MetaLine) => l.value).filter((v: string) => v === '—').length, 7);
eq('空壳托管行', shellLines[6].value, '未知');
// undefined ⇒ 空数组（渲染层据此显示"未返回版本信息"而不是空卡片）
eq('undefined ⇒ 空数组', systemInfoLines(undefined).length, 0);
// devBuild 后缀
const devLines: MetaLine[] = systemInfoLines({ version: 'dev', devBuild: true } as SystemInfoRow);
eq('devBuild 标记', devLines[0].value, 'dev（开发构建）');
const nonDevLines: MetaLine[] = systemInfoLines({ version: '1.0.0', devBuild: false } as SystemInfoRow);
eq('非 devBuild 无标记', nonDevLines[0].value, '1.0.0');

// ── ⑤ updateStatusText：4 个取值域 + 优先级 ─────────────────────────────────

eq('更新：未检查', updateStatusText(undefined), '尚未检查更新');
eq('更新：跳过 ⇒ 报原因（不是"已最新"）',
  updateStatusText({ skipped: true, reason: 'dev build', current: 'dev' } as UpdateCheckRow),
  '已跳过检查：dev build');
eq('更新：跳过但无原因 ⇒ 兜底文案',
  updateStatusText({ skipped: true } as UpdateCheckRow), '已跳过检查：未说明原因');
eq('更新：有新版', updateStatusText({ hasUpdate: true, latest: '1.5.0', current: '1.4.2' } as UpdateCheckRow),
  '有新版本 1.5.0（当前 1.4.2）');
eq('更新：已最新', updateStatusText({ hasUpdate: false, current: '1.4.2' } as UpdateCheckRow),
  '已是最新（当前 1.4.2）');
// ⛔ 优先级守卫：skipped 必须压过 hasUpdate（同时给时以"跳过"为准）
eq('更新：skipped 优先于 hasUpdate',
  updateStatusText({ skipped: true, reason: 'offline', hasUpdate: true, latest: '9.9.9' } as UpdateCheckRow),
  '已跳过检查：offline');
// current 缺失走兜底
eq('更新：current 缺失兜底', updateStatusText({ hasUpdate: false } as UpdateCheckRow), '已是最新（当前 —）');

// ── ⑥ account：显示名回落 ───────────────────────────────────────────────────

eq('账号：有名字', accountDisplayName('bob'), 'bob');
eq('账号：trim', accountDisplayName('  bob  '), 'bob');
eq('账号：空 ⇒ 中性文案', accountDisplayName(''), '当前登录账号');
eq('账号：undefined ⇒ 中性文案', accountDisplayName(undefined), '当前登录账号');

// ── ⑦ 纯白主题（porcelain）可读性：次级文字分叉必须**按亮度**，不按主题名 ──────
//
// 面板（SettingsAbout/SettingsAccount）的次级文字用
// `isLightPalette(paletteOf(theme)) ? textSecondary : textMuted` 分叉。
// 这里锁两件事：① 分叉判据确实是亮度（porcelain 判为浅色、dark 判为深色）；
// ② 分叉**有效**（浅色系的次级色 != muted，否则等于没升档）。
const palPorcelain: Palette = paletteOf('porcelain');
const palDark: Palette = paletteOf('dark');
const palLight: Palette = paletteOf('light');
eq('porcelain 判为浅色', isLightPalette(palPorcelain), true);
eq('light 判为浅色', isLightPalette(palLight), true);
eq('dark 判为深色', isLightPalette(palDark), false);
ok('porcelain 次级文字升档有效（textSecondary ≠ textMuted）',
  palPorcelain.textSecondary !== palPorcelain.textMuted);
ok('dark 次级文字保持 muted（本就是浅字压深底）',
  isLightPalette(palDark) === false);
ok('porcelain 卡片面与画布同色（靠发丝/柔影分层 ⇒ 面板不得依赖灰底对比）',
  palPorcelain.surface === palPorcelain.appBg);
ok('porcelain 有可见发丝边框（面板 card 的 border 非透明）',
  palPorcelain.border !== palPorcelain.transparent);

console.log(`\n${fail === 0 ? '✅' : '❌'} settings about/account 契约测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

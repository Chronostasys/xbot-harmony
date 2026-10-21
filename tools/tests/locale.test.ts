/** 语言清单测试 —— 对齐 web `src/i18n/`（zh-CN / en / ja）。 */
declare const process: { exit: (c: number) => void };

import { LOCALES, DEFAULT_LOCALE, localeLabel, normalizeLocale, setLocale, tNotification } from '../../entry/src/main/ets/core/i18n';
import { drawerFingerprint } from '../../entry/src/main/ets/core/drawerfp';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

eq('语言数量 = web(3)', LOCALES.length, 3);
eq('id 与顺序一致', LOCALES.map((l) => l.id).join(','), 'zh-CN,en,ja');
eq('默认语言', DEFAULT_LOCALE, 'zh-CN');
eq('每项都有显示名', LOCALES.filter((l) => l.label.length === 0).length, 0);
eq('normalize 未知回落默认', normalizeLocale('fr'), 'zh-CN');
eq('normalize undefined 回落默认', normalizeLocale(undefined), 'zh-CN');
eq('normalize 合法原样', normalizeLocale('ja'), 'ja');
eq('标签查表', localeLabel('en'), 'English');
eq('未知 id 标签原样（暴露脏数据）', localeLabel('fr'), 'fr');

// 通知正文的协议标签本地化（服务端模板不是 i18n key）。
const bg = '[System Notification] Background task abc completed.\nCommand: ls\nStatus: done | Elapsed: 2s\nExit Code: 0\n\nOutput:\nok';
setLocale('ja');
eq('通知→日文：前缀/字段标签', tNotification(bg),
  '[システム通知] バックグラウンドタスク abc が完了しました。\nコマンド: ls\nステータス: done | 経過: 2s\n終了コード: 0\n\n出力:\nok');
eq('通知→日文：cron 前缀', tNotification('⏰ [定时任务触发] 背诵出师表'), '⏰ [定期タスク実行] 背诵出师表');
setLocale('zh-CN');
eq('通知→中文：英文模板', tNotification(bg),
  '[系统通知] 后台任务 abc 已完成。\n命令： ls\n状态： done | 耗时： 2s\n退出码： 0\n\n输出：\nok');
setLocale('en');
eq('通知→英文：中文模板', tNotification('[系统通知] 后台任务 abc 已完成。'),
  '[System Notification] Background task abc 已完成。'.replace('已完成。', 'completed.'));
setLocale('zh-CN');

// 抽屉缓存必须随语言失效（否则切日文后组标题/分类名仍是缓存中文）。
eq('抽屉指纹含语言（切语言必 miss）',
  drawerFingerprint('[]', 'path', '', 'web', 'zh-CN') !== drawerFingerprint('[]', 'path', '', 'web', 'ja'), true);

console.log(`locale: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

export {};

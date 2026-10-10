/** 语言清单测试 —— 对齐 web `src/i18n/`（zh-CN / en / ja）。 */
declare const process: { exit: (c: number) => void };

import { LOCALES, DEFAULT_LOCALE, localeLabel, normalizeLocale } from '../../entry/src/main/ets/core/i18n';

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

console.log(`locale: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

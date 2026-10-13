/**
 * theme_reactivity.test.ts —— 「theme 里各种配色必须真实起作用」的**判别力**判据。
 *
 * 覆盖两条 2026-10-13 用户亲报的缺陷（同一族：值变了、但 ArkUI 的**可观察面**没变）：
 *   ①「配色根本没起作用 / theme 里的各种配色必须真实起作用」
 *      —— 强调色只写模块级覆盖（`core/theme.APP_ACCENT`），它不是 @State/@Prop
 *      ⇒ 改强调色 ⇒ 全站零重渲染 ⇒ 80 处 `paletteOf` 仍是旧色板。
 *      修法：把强调色并进**唯一可观察真源** `appTheme`（`renderThemeKey`），`paletteOf` 从标识里取值。
 *   ②「浅色模式字色有时对有时不对像抽奖」+「所有浅色 theme 看起来完全一样」
 *      —— md 主题只经 `@Prop mdTheme` 投递，而历史行由 `LazyForEach` 承载（item builder 只在新建时
 *      执行）⇒ 冻结在创建那刻。修法：`MarkdownView` 自己订阅 `@StorageProp('appMdTheme')`。
 *
 * 判据分两层（本仓纪律）：
 *   ★ 行为层（纯函数）：复合标识的**取值**必须真的改变色板；
 *   ★ 形态层：钉**调用点计数**（"方法体存在"会假绿）——`markdown` 侧所有取色点都必须走订阅版。
 */
// ⚠️ 与其它"源码形态"测试同样式：CommonJS `require`（`run.sh`/`run-one.sh` 的 tsc 环境不给 @types/node）。
//    本文件含 ES `import` ⇒ 是 **module**，全局声明须在模块内自带（不能靠 .d.ts 全局桩）。
declare const require: (m: string) => {
  readFileSync(p: string, enc: string): string;
  existsSync(p: string): boolean;
  join(...p: string[]): string;
};
declare const __dirname: string;
declare const process: { exit(code?: number): void };
const fs = require('fs');
const path = require('path');
import {
  isLightPalette, normalizeTheme, paletteOf, renderThemeKey, themeBaseName, themeInlineAccent,
  THEME_DARK, THEME_LIGHT,
} from '../../entry/src/main/ets/core/theme';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function eq<T>(name: string, got: T, want: T): void {
  ok(`${name}（got=${String(got)} want=${String(want)}）`, got === want);
}

console.log('— theme_reactivity：复合渲染标识（★行为层）—');

// 解析：名字 / 强调色 / 无分隔符原样
eq("themeBaseName('light|#22C55E')", themeBaseName('light|#22C55E'), 'light');
eq("themeBaseName('light')", themeBaseName('light'), 'light');
eq("themeInlineAccent('light|#22C55E')", themeInlineAccent('light|#22C55E'), '#22C55E');
eq("themeInlineAccent('light')", themeInlineAccent('light'), '');
eq('renderThemeKey 无强调色 ⇒ 逐字节等于色板名', renderThemeKey('light', ''), 'light');
eq('renderThemeKey 有强调色 ⇒ 复合', renderThemeKey('light', '#22C55E'), 'light|#22C55E');
// 复合标识不得让 normalizeTheme 掉进"未知 ⇒ 深色"（否则浅色用户被系统表面判成深色）
eq('normalizeTheme 容忍复合标识', normalizeTheme('light|#22C55E'), THEME_LIGHT);
eq('normalizeTheme 未知仍回落深色', normalizeTheme('nope|#22C55E'), THEME_DARK);

// ★ 关键判别力：标识里带强调色 ⇒ 取到的色板**真的不同**（这正是"配色没起作用"的反例守卫）
const lightPlain = paletteOf(THEME_LIGHT);
const lightGreen = paletteOf(renderThemeKey(THEME_LIGHT, '#22C55E'));
ok('强调色写进标识 ⇒ accent 家族真的改变（非"零变化"假绿）', lightPlain.accent !== lightGreen.accent);
eq('强调色取到的是标识里的值（normalize 后）', lightGreen.accent, '#22C55E');
ok('复合标识不改变深浅判定（仍浅色）', isLightPalette(lightGreen) === isLightPalette(lightPlain));
// 记忆化：同标识两次取到**同一对象**（缓存键含强调色，不得串味）
ok('记忆化：同标识同一对象', paletteOf(renderThemeKey(THEME_LIGHT, '#22C55E')) === lightGreen);
ok('记忆化：不同强调色不同对象', paletteOf(renderThemeKey(THEME_LIGHT, '#EF4444')) !== lightGreen);

console.log('— 形态层：md 主题必须走**订阅**（钉调用点）—');

// 仓库根：**向上搜索**定位（编译产物落在 `tools/tests/.out-*/js` ⇒ 层数不定，不能硬编 `../..`）。
function findRepo(from: string): string {
  let d: string = from;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'entry/src/main/ets/pages/Index.ets'))) {
      return d;
    }
    d = path.join(d, '..');
  }
  return from;
}
const repo = findRepo(__dirname);
ok('零扫描白绿防线：仓库根定位成功', fs.existsSync(path.join(repo, 'entry/src/main/ets/pages/Index.ets')));
const mdView = fs.readFileSync(
  path.join(repo, 'entry/src/main/ets/components/MarkdownView.ets'), 'utf8');
const index = fs.readFileSync(path.join(repo, 'entry/src/main/ets/pages/Index.ets'), 'utf8');

function countOf(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

// 白绿防线：确实读到了源码（路径/改名都会先在这里红）
ok('零扫描白绿防线：MarkdownView 源码读到了', mdView.length > 5000);
ok('零扫描白绿防线：Index 源码读到了', index.length > 100000);

eq("MarkdownView 订阅 appMdTheme 恰好 1 处", countOf(mdView, "@StorageProp('appMdTheme')"), 1);
// ⛔ 钉**消费点**：取色必须走订阅版 `mdThemeNow()`；裸 `this.mdTheme` 只允许出现在回落表达式里（1 处）
const bareMdTheme = countOf(mdView, 'this.mdTheme') - countOf(mdView, 'this.mdThemeNow()');
eq('MarkdownView 裸 this.mdTheme 只剩回落那 1 处', bareMdTheme, 1);
ok('MarkdownView 取色点全部走订阅版（≥6 处）', countOf(mdView, 'this.mdThemeNow()') >= 6);

// 页面必须**写**这个键（否则订阅永远收不到变化 = 死订阅）
eq("Index 写 appMdTheme 恰好 2 处（syncFrom 落点 + 乐观切换）",
  countOf(index, "AppStorage.setOrCreate<string>('appMdTheme'"), 2);
ok('Index 用 renderThemeKey 组装标识（≥2 处）', countOf(index, 'renderThemeKey(') >= 2);

console.log('');
console.log(`theme_reactivity: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);

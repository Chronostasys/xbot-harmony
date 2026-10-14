/**
 * 用户消息导航高亮态（`activeSeq`）的**接线判据** —— P0「加载完历史后滚动掉帧」的防回归闸门。
 *
 * ── 用户实录（2026-10-15）────────────────────────────────────────────────────
 *   「加载完毕后滚动就掉帧」「我感觉是列表太长，没做虚拟列表吗」
 *
 * ── 根因（源码定位）──────────────────────────────────────────────────────────
 *   `List.onScrollIndex` 里算出当前锚点序号 `seq` 后写**页级 `@State navSeq`** ⇒ 每**跨过一个
 *   用户消息锚点**（长历史里约等于"每隔一屏"）就触发**整页 `build()` 重跑**；而页面 build 里的
 *   `LazyForEach` 需要对**数据源全部行**（= 行窗口 `rowLimit`，初始 12、每次"加载更早" +12、
 *   **无上界**）做重复 key diff ⇒ 代价 ∝ 历史长度 ⇒ **历史越长、滚动越掉帧**。
 *
 * ── 修法（本判据钉住的形态）──────────────────────────────────────────────────
 *   真源落 **AppStorage**（键 = `MessageNav.NAV_ACTIVE_SEQ_KEY`）：`MessageNav` 用
 *   `@StorageProp` **自己订阅** ⇒ 写入只通知订阅者，**页级 build 零参与**。
 *   页面只留一个**普通字段** `private navSeq` 做"值是否变化"的判定。
 *
 * ── 判别力（mutation 自证）──────────────────────────────────────────────────
 *   ① 把 `private navSeq` 改回 `@State navSeq` ⇒ 判据①红；
 *   ② 拿掉 `AppStorage.setOrCreate<number>(NAV_ACTIVE_SEQ_KEY, seq)` ⇒ 判据②红；
 *   ③ 恢复 `activeSeq: this.navSeq` 传参（= 又把真源搬回页级状态）⇒ 判据③红；
 *   ④ 把键写成字符串字面量而不 import 常量 ⇒ 判据④红。
 *   （零扫描防线：源文件读不到 ⇒ 判据⑤红，绝不"没扫到就跳过"。）
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

const fs: { readFileSync(p: string, e: string): string } = require('fs');
const path: { join(...parts: string[]): string } = require('path');
// ⚠️ 脱机 harness 把测试**拷到** `tools/tests/.out-all.$$/` 再编译运行 ⇒ `__dirname` 是那份拷贝，
//    故与既有判据（`a11y_icon_button`/`busy_label`…）**同一口径**：上溯 4 级才回到仓库根。
const repoRoot: string = path.join(__dirname, '..', '..', '..', '..');
const src: string = fs.readFileSync(
  path.join(repoRoot, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets'), 'utf-8');
// ⛔ 本判据**不许 import 组件 `.ets`**（脱机 harness 把 `core/**` 当纯 TS 编译 ⇒
//    `import … from '../components/MessageNav'` 会 TS2307 —— 实测踩到过）。
//    ⇒ 组件侧只做**源码文本**判据（读文件 + 字面量比对）。
const navSrc: string = fs.readFileSync(
  path.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'MessageNav.ets'), 'utf-8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ⑤ 零扫描防线：两个源都必须真读到（否则下面所有 hasNot 都是"白绿"）。
ok(`源已读到（Index.ets ${src.length} 字符 / MessageNav.ets ${navSrc.length} 字符）`,
  src.length > 100000 && navSrc.length > 5000);

// ① 不许有页级 @State navSeq（这就是掉帧根因）。
ok('① 无 `@State navSeq`（滚动路径不许写页级渲染状态）', src.indexOf('@State navSeq') < 0);
ok('① 存在普通字段 `private navSeq: number = 0;`', src.indexOf('private navSeq: number = 0;') >= 0);

// ② 真源必须落 AppStorage（页面侧写入点）。
ok('② 页面写 AppStorage（`AppStorage.setOrCreate<number>(NAV_ACTIVE_SEQ_KEY, seq)`）',
  src.indexOf('AppStorage.setOrCreate<number>(NAV_ACTIVE_SEQ_KEY, seq)') >= 0);

// ③ 不许再把地址订阅搬回"页级状态 → 传参"形态。
ok('③ 不再传 `activeSeq: this.navSeq` 给 MessageNav', src.indexOf('activeSeq: this.navSeq') < 0);

// ④ 两端同键：页面用常量（值必须 == 组件 `@StorageProp` 的字面量）。
//    ⚠️ ArkTS 的 `@StorageProp` 装饰器**只收字符串字面量**（`@StorageProp(常量)` 编译不过）⇒
//    组件侧只能是字面量，页面侧必须是常量 ⇒ 本判据就是把"两处必须相等"钉死。
const PAGE_KEY: string = "export const NAV_ACTIVE_SEQ_KEY: string = 'navActiveSeq';";
ok('④ 组件导出键常量（唯一定义处）', navSrc.indexOf(PAGE_KEY) >= 0);
ok('④ 页面 import 同一常量', src.indexOf('import { MessageNav, NAV_ACTIVE_SEQ_KEY }') >= 0);
ok('④ 组件的 @StorageProp 字面量与常量值相等（navActiveSeq）',
  navSrc.indexOf("@StorageProp('navActiveSeq')") >= 0);
ok('④ 组件侧无残留 `@Prop … activeSeq`（防回退成"页面持状态 + 传参"）',
  navSrc.indexOf("@Prop @Watch('syncRows') activeSeq") < 0);

if (fail > 0) { console.log(`  nav_seq_storage_wiring: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  nav_seq_storage_wiring: ${pass} passed, 0 failed`);
process.exit(0);

export {};

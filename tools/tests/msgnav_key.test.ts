/**
 * MessageNav 的**结构契约测试**（修 §12 #18 / 本轮 ③）。
 *
 * 用户可见缺陷：导航面板条目的 `ForEach` key **含 `active`**（`? 'A' : 'w'`）⇒ 滚动时
 * `activeSeq` 一变，旧/新两个当前项被 **销毁+重建** ⇒ 闪动。web 权威
 * `web/src/components/agent/MessageUserNav.tsx:175` 的 key 恒为 `turn.seq`、只切 className。
 *
 * ArkUI 约束：key 不变则复用节点、`@Prop` 不重估（ARKTS-GOTCHAS §3/§4）⇒ **不能只把 key
 * 改恒定**；本仓的等价机制 = `@Observed class` + 子组件 `@ObjectLink`（会同仓
 * `core/types.ets:256` + `components/MessageRow.ets:78` 的既有先例）。
 *
 * 本用例是**源码形态断言**（组件不进离线 harness；先例 `sessiongroup_wiring.test.ts` /
 * `live_tail_delivery.test.ts` 同款）：
 *   A. key **不含** active（静态可证）；
 *   B. **内容更新通道存在**（@Observed + @ObjectLink + 高亮读对象字段），两头都成立。
 *
 * mutation 自证：把 key 改回 `${r.rowIndex}#${r.seq}${r.active ? 'A' : 'w'}` ⇒ A 组红；
 *               删掉 `@ObjectLink row: NavRow` ⇒ B 组红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(`${name}（应含 ${needle}）`, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(`${name}（不应含 ${needle}）`, src.indexOf(needle) < 0);
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
const src: string = fsMod.readFileSync(
  pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components', 'MessageNav.ets'), 'utf-8');

// ── A. key 必须稳定：**不含 active**（本轮修的判据）─────────────────────────────
has(src, '(r: NavRow) => `${r.rowIndex}#${r.seq}`', '条目 key = 行下标#序号（稳定身份）');
hasNot(src, "? 'A' : 'w'", 'key 不再把 active 编进去');
hasNot(src, "#'A'", 'key 不再含 A 标记');
hasNot(src, '`${a.rowIndex}#${a.seq}#${a.seq === this.activeSeq', '旧的「key 含 activeSeq」形态已删除');
ok('不存在含 active 的 key 生成器',
  !/\(.*\)\s*=>\s*`[^`]*active[^`]*`/.test(src));

// ── B. 内容更新通道：@Observed + @ObjectLink（key 恒定也要能穿透 active 变化）──────
has(src, '@Observed', '存在 @Observed 行类（NavRow）');
has(src, 'class NavRow', 'NavRow 类已声明');
has(src, '@ObjectLink row: NavRow;', '子组件用 @ObjectLink 观察行对象');
hasNot(src, '@Prop active: boolean', 'NavItemView 不再用 @Prop active（改用对象属性）');
has(src, 'this.row.active', '高亮读的是对象字段（@ObjectLink 可观测）');
has(src, 'r.active = a.seq === this.activeSeq;', 'syncRows 就地写入 active（属性变更驱动重渲染）');
has(src, 'private syncRows(): void {', '存在 syncRows 同步入口');
has(src, "@Prop @Watch('syncRows') anchors: NavAnchor[] = [];", 'anchors 变化触发同步');
has(src, "@Prop @Watch('syncRows') activeSeq: number = 0;", 'activeSeq 变化触发同步');
has(src, 'aboutToAppear(): void {', '首帧同步（@Prop 初值不触发 @Watch）');

if (fail > 0) { console.log(`  msgnav_key: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  msgnav_key: ${pass} passed, 0 failed`);
process.exit(0);

// ⛔ `export {}` 让本文件成为 **module**（而不是 script）⇒ 上面所有顶层 `declare const process/
//    __dirname`、`let pass/fail`、`function ok/has/...` 全部收进**模块作用域**，不再落进
//    `run.sh` 编同一个 TS 程序时的**全局作用域**（否则会与 `one_inflight_motion.test.ts` 等
//    兄弟测试的顶层 `process`/`pass`/`fail` 相撞 ⇒ TS2451/TS2393，污染整轮测试基建）。
//    本文件无 `import`（只用 `require('fs'|'path')`）⇒ 必须显式 `export` 才会成为 module。
export {};

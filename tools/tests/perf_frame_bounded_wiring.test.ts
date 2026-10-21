/**
 * perf_frame_bounded_wiring.test.ts —— **接线判据**：钉住"每帧 O(1)（与迭代块数 N 无关）"
 * 的**调用点**，而不是"某个方法存在"（否则假绿）。
 *
 * 纪律（AGENTS.md「死消费」条）：形态断言必须钉**调用点计数**与**方向**（谁读谁写、
 * 哪条路径被禁用），并对每条断言给一个 mutation（摘掉/写反必红）。
 *
 * 判据清单：
 *  ① `streammerge.ets`：`mergeToolRuns` 必须真的**写**记忆化表（`mergedRunsMemo.set`）——
 *     历史 bug：只有 `get` 没有 `set` ⇒ 每次渲染都 O(N) 重算 + 新对象 + rev 漂移。
 *  ② `core/render.ets`：块列表持有者只在**引用变化**时赋值（`holder.blocks !== merged`）。
 *  ③ `MessageRowView`：**不再**自己 `ForEach` 全部块（那是 O(N)/帧）；改为把持有者交给
 *     `IterBlocksView`（`iters: this.row.iterBlocks`）。
 *  ④ `IterBlocksView`：`ForEach` 的源必须是 `this.iters.blocks`（持有者），且订阅是 `@ObjectLink`。
 *  ⑤ `LiveTailView`：在飞内容是 `@ObjectLink tail: LiveTailState`（**不是** `@Prop text`）。
 *  ⑥ `pages/Index.ets`：`syncLiveTail` 写持有者；全文件**不得**再有 `this.liveText` 之类的
 *     页面 @State 逐帧写入；`syncFrom` 的结构判据必须是 `store.rowsGen`（O(1)），
 *     且 busy 期不能再"无条件重投 rows"。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}
function count(hay: string, needle: string): number {
  let n = 0, i = 0;
  while (true) {
    const k = hay.indexOf(needle, i);
    if (k < 0) { return n; }
    n++; i = k + needle.length;
  }
}

const streammerge = read('entry/src/main/ets/core/streammerge.ets');
const render = read('entry/src/main/ets/core/render.ets');
const rowView = read('entry/src/main/ets/components/MessageRow.ets');
const iterView = read('entry/src/main/ets/components/IterBlocksView.ets');
const liveView = read('entry/src/main/ets/components/LiveTailView.ets');
const page = read('entry/src/main/ets/pages/Index.ets');

console.log('\n▶ §A 记忆化必须真的"写"（历史根因：只读不写）');
{
  ok('★A `mergeToolRuns` 里存在 `mergedRunsMemo.set(`（没有它 ⇒ 每帧 O(N) 重算）',
    count(streammerge, 'mergedRunsMemo.set(') >= 1);
  ok('★A 且 `get`/`set` 成对（同文件内各 1 处以上，不多写第二份缓存）',
    count(streammerge, 'mergedRunsMemo.get(') === 1 && count(streammerge, 'mergedRunsMemo.set(') === 1);
  ok('★A `completedBlocks` 也写记忆化（同一契约）',
    count(streammerge, 'completedBlocksMemo.set(') === 1);
}

console.log('\n▶ §B 块列表持有者：只在**引用**变化时赋值（O(1) 判据，零比较）');
{
  ok('★B `syncIterBlocks` 用引用比较守卫 `holder.blocks !== merged`',
    /holder\.blocks !== merged/.test(render));
  // ⛔ 2026-10-21 用户决策：「**每个 tool 是一个单独的迭代**」⇒ 渲染层**不再吸收**
  //   相邻纯工具迭代（`mergeToolRuns`）。mutation：把这里改回 `mergeToolRuns(blocks)`
  //   并让页面按合并后块渲染 ⇒ 用户读作"后面两个迭代消失了"，本条必须红。
  ok('★B 块列表**原样**交给渲染（不 absorption；每个迭代一块）',
    /const merged: HistoryIteration\[\] = blocks;/.test(render)
    && count(render, 'mergeToolRuns(') === 0);
  ok('★B live 行取 `row.completedBlocks`（不含末尾在飞块）',
    /syncIterBlocks\(row, row\.completedBlocks, NO_COMPACTIONS, turnID\)/.test(render));
  ok('★B 用户行也清空持有者（切行不复用旧块）',
    /row\.iterBlocks\.blocks = \[\]/.test(read('entry/src/main/ets/core/model_bridge.ets')));
}

console.log('\n▶ §C 行组件不再自己遍历全部块（每帧 O(N) 的旧形态）');
{
  ok('★C `MessageRow.ets` 里**没有** `shownIters()`（旧的全块 ForEach 入口）',
    count(rowView, 'shownIters(') === 0);
  ok('★C `MessageRow.ets` 里**没有** `ForEach(this.shownIters` / `ForEach(this.itersFor`',
    count(rowView, 'ForEach(this.shownIters') === 0 && count(rowView, 'ForEach(this.itersFor') === 0);
  ok('★C 且它把持有者交给独立组件（`iters: this.row.iterBlocks`）',
    count(rowView, 'iters: this.row.iterBlocks') === 1);
  ok('★C `MessageRow.ets` 里**没有** `mergedBlocks()`/`itersFor()`（合并已移入 core 的持有者维护）',
    count(rowView, 'mergedBlocks(') === 0 && count(rowView, 'itersFor(') === 0);
}

console.log('\n▶ §D 独立块组件的订阅语义（必须是 @ObjectLink，不是 @Prop 深拷贝）');
{
  ok('★D `IterBlocksView` 声明 `@ObjectLink iters: IterBlocks`',
    /@ObjectLink iters: IterBlocks;/.test(iterView));
  ok('★D 它 `ForEach` 的源 = 持有者 `this.iters.blocks`（唯一一处）',
    count(iterView, 'ForEach(this.iters.blocks') === 1);
}

console.log('\n▶ §E 在飞内容：**@Prop 值投递**（2026-10-21 回滚后的事实口径）');
{
  // ⛔ 历史：曾改成 `@ObjectLink LiveTailState` + `onDidBuild`，实测出现「光球与
  //   『思考 N 字』一起静止数秒、N 卡在 3/39」的 P0 ⇒ 回滚到此前长期验证过的值投递通道。
  //   本段锁的是**回滚后**的形态：⛔ 不要再改回持有者（除非能复现并证明不卡）。
  ok('★E `LiveTailView` 用 `@Prop @Watch(\'onSource\') text/reasoning`（值投递）',
    /@Prop @Watch\('onSource'\) text: string = '';/.test(liveView)
    && /@Prop @Watch\('onSource'\) reasoning: string = '';/.test(liveView));
  ok('★E 且**没有** `@ObjectLink tail: LiveTailState`（已回滚）',
    count(liveView, '@ObjectLink tail:') === 0);
  ok('★E 页面持有 `liveText/liveReasoning/liveTools` 三项 @State（投递源）',
    count(page, '@State liveText:') === 1 && count(page, '@State liveReasoning:') === 1
    && count(page, '@State liveTools:') === 1);
  ok('★E 页面把三项以 @Prop 投给行组件（`liveText: this.liveText`）',
    /liveText: this\.liveText,[\s\S]{0,120}liveReasoning: this\.liveReasoning,/.test(page));
  ok('★E `MessageRowView` 也声明了这三项 @Prop 并透传给 `LiveTailView`',
    /@Prop liveText: string = '';/.test(rowView) && /text: this\.liveText,/.test(rowView));
}

console.log('\n▶ §F 页面结构判据：O(1) 整数（不再逐帧 O(rows) 指纹/重投）');
{
  ok('★F `syncFrom` 用 `store.rowsGen !== this.rowsGenMirror` 判结构',
    /const structural: boolean = store\.rowsGen !== this\.rowsGenMirror;/.test(page));
  ok('★F 且 busy 期不再无条件重投：`contentGrew` 只认 structural（+ 非 busy 的指纹）',
    /const contentGrew: boolean = structural \|\| \(!store\.busy && rowsFp !== this\.rowsFp\);/.test(page));
  ok('★F 但切会话必须强制重投（代数镜像置 -1）',
    /this\.rowsGenMirror = -1;/.test(page));
}

console.log('\n▶ §G mutation 自证（由外部脚本注入，逐条必红）');
console.log('   · 删掉 `mergedRunsMemo.set(iters, out);` ⇒ §A 必红');
console.log('   · `holder.blocks !== merged` 改成 `true`（无条件赋值）⇒ perf_frame_bounded §A 必红');
console.log('   · `MessageRow` 里恢复 `ForEach(this.shownIters(), …)` ⇒ §C 必红');
console.log('   · `IterBlocksView` 的 `@ObjectLink` 改 `@Prop` ⇒ §D 必红');
console.log('   · `contentGrew` 改回 `this.busy || …` ⇒ §F 必红');

console.log(`\n  perf_frame_bounded_wiring: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

// 显式模块作用域（聚合门禁把全部 *.test.ts 编进同一 program；缺它 ⇒ 顶层 const/fn 与
// 其它文件重名会 TS2451/TS2393，整条 ① 判"编译失败"，断言层不执行）。
export {};

/**
 * status_sheet_wiring.test.ts —— 目标④「会话信息面板补全」的**形态 + 消费点计数**判据。
 *
 * ── 缺陷类（为什么必须"消费点计数"而非"声明存在"）────────────────────────────────
 *   本仓有「死消费」缺陷类（`AGENTS.md` GOTCHAS）：函数/偏好/`@Prop` **声明了却 0 消费方**
 *   ⇒ 用户操作**静默无效**（已抓 3 例：`withAccent` / `applyNotifyPrefs` / `reasoningopen`）。
 *   ⇒ 本判据对**每个新 `@Prop`** 同时钉三件：① 声明；② `this.<prop>` 有消费；③ **渲染落点**
 *   （作为 `StatusInfoRow` 的 `value` 真传进去）。任何一项缺失 ⇒ 红。
 *
 * ── 覆盖（web 真口径 `src/components/sidebar/SessionInfo.tsx`）────────────────────
 *   · 会话 ID `:48` / 渠道 `:49` / 最后活跃 `:174-176`（空串 ⇒ 不显示该行）。
 *   · 工作路径**可编辑** `:138-173`（点值 → `TextInput` → Enter / 确认 ⇒ `onSubmitCwd`）；
 *     写路径**只许复用既有** `set_cwd`（页面 `sendSetCwd` → `RPC_SET_CWD` + `SetCwdParams`），
 *     ⛔ 不许新造 RPC 名。
 *   · ⛔ 不加动效（「只许减」）；⛔ 禁 `responseRegion`（真机实测负偏移外扩无效）。
 *
 * ── 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`components/**`
 *    与 `pages/**` 不进 harness ⇒ 组件/页面层无法直接 import。先例：`sheets2_visual.test.ts` /
 *    `status_sheet_drawer.test.ts`。**断言前剥注释**（组件用注释记录 web 口径，朴素匹配会假红）。
 *
 * ── mutation 自证（⛔ 不改真树即可证红）──────────────────────────────────────────
 *   `SSW_STATUS_SRC` / `SSW_INDEX_SRC` 指向**副本**；注入一处违规（如删掉 `value: this.channel`、
 *   把 `onSubmitCwd` 断开、新造 RPC 名）⇒ 必红；同副本不注入 ⇒ 必绿。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 */
declare const process: { exit: (c: number) => void; env: Record<string, string | undefined> };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

// 让本文件成为**模块**（否则顶层 `process/pass/fail/fsMod/…` 落进**全局作用域**，与其它同类
// 非模块测试文件冲突：TS2451 Cannot redeclare / TS2393 Duplicate function）。本文件只用 `require`
// （无 `import`）⇒ 必须显式 `export {}`。先例：`status_sheet_drawer.test.ts`。
export {};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function has(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) >= 0);
}
function hasNot(src: string, needle: string, name: string): void {
  ok(name, src.indexOf(needle) < 0);
}
function count(src: string, needle: string): number {
  return src.split(needle).length - 1;
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

/** 剥注释（等长替换；对字符串内的 `//` 免疫 —— 组件注释里大量出现 `file:line`）。 */
function stripComments(src: string): string {
  const out: string[] = [];
  const n: number = src.length;
  let i: number = 0;
  let inLine: boolean = false;
  let inBlock: boolean = false;
  let inStr: boolean = false;
  let quote: string = '';
  while (i < n) {
    const c: string = src[i];
    const nxt: string = i + 1 < n ? src[i + 1] : '';
    if (inLine) {
      if (c === '\n') { inLine = false; out.push(c); } else { out.push(' '); }
    } else if (inBlock) {
      if (c === '*' && nxt === '/') { out.push(' '); out.push(' '); i += 2; inBlock = false; continue; }
      out.push(c === '\n' ? '\n' : ' ');
    } else if (inStr) {
      if (c === '\\') { out.push(c); out.push(nxt); i += 2; continue; }
      if (c === quote) { inStr = false; }
      out.push(c);
    } else {
      if (c === '/' && nxt === '/') { out.push(' '); out.push(' '); i += 2; inLine = true; continue; }
      if (c === '/' && nxt === '*') { out.push(' '); out.push(' '); i += 2; inBlock = true; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c; }
      out.push(c);
    }
    i += 1;
  }
  return out.join('');
}

const fsMod = require('fs');
const pathMod = require('path');
const repoRoot = pathMod.join(__dirname, '..', '..', '..', '..');
function srcPath(envName: string, rel: string): string {
  const v: string | undefined = process.env[envName];
  return v !== undefined && v.length > 0 ? v : pathMod.join(repoRoot, rel);
}
const statusSrc: string = stripComments(fsMod.readFileSync(
  srcPath('SSW_STATUS_SRC', 'entry/src/main/ets/components/StatusSheet.ets'), 'utf-8'));
const indexSrc: string = stripComments(fsMod.readFileSync(
  srcPath('SSW_INDEX_SRC', 'entry/src/main/ets/pages/Index.ets'), 'utf-8'));

// ════════════════════════════════════════════════════════════════════════════
// ⓪ 零扫描判红 —— 真源必须读到、锚点必须真在（否则"绿"是假的）
// ════════════════════════════════════════════════════════════════════════════
ok(`零扫描判红：StatusSheet.ets 读到源码（${statusSrc.length} 字符）`, statusSrc.length > 800);
ok(`零扫描判红：Index.ets 读到源码（${indexSrc.length} 字符）`, indexSrc.length > 10000);
has(statusSrc, 'export struct StatusSheet', '锚点：StatusSheet 组件定义在');
has(statusSrc, 'struct StatusInfoRow', '锚点：行原语 StatusInfoRow 在');
has(indexSrc, 'StatusSheet({', '锚点：页面 StatusSheet 调用点在');

// ════════════════════════════════════════════════════════════════════════════
// ① 组件侧：三个新 @Prop —— 声明 + 消费 + **渲染落点**（三件套，防"死 props"）
// ════════════════════════════════════════════════════════════════════════════
// 每个 prop 一组：声明存在 / 至少一处 `this.<prop>` 消费 / 作为渲染 value 真传 / 空串不显示该行。
has(statusSrc, '@Prop sessionId', '① sessionId：@Prop 声明存在');
ok('① sessionId：被消费（this.sessionId 出现 ≥2 次：isEmpty ∪ 渲染）',
  count(statusSrc, 'this.sessionId') >= 2);
has(statusSrc, 'value: this.sessionId', '① sessionId：渲染落点（作为 StatusInfoRow 的 value 真传）');
has(statusSrc, 'if (this.sessionId.length > 0)', '① sessionId：空串 ⇒ 不显示该行');

has(statusSrc, '@Prop channel', '① channel：@Prop 声明存在');
ok('① channel：被消费（this.channel 出现 ≥2 次：isEmpty ∪ 渲染）',
  count(statusSrc, 'this.channel') >= 2);
has(statusSrc, 'value: this.channel', '① channel：渲染落点（作为 StatusInfoRow 的 value 真传）');
has(statusSrc, 'if (this.channel.length > 0)', '① channel：空串 ⇒ 不显示该行');

has(statusSrc, '@Prop lastActive', '① lastActive：@Prop 声明存在');
ok('① lastActive：被消费（this.lastActive 出现 ≥2 次：isEmpty ∪ 渲染）',
  count(statusSrc, 'this.lastActive') >= 2);
has(statusSrc, 'value: this.lastActive', '① lastActive：渲染落点（作为 StatusInfoRow 的 value 真传）');
has(statusSrc, 'if (this.lastActive.length > 0)', '① lastActive：空串 ⇒ 不显示该行（web `:174-176` truthy 才显示）');

// ⛔ 反向：三个新字段都必须进 `isEmpty()`（否则"点开了但什么都没有"的会话会被当非空）。
const emptyBody: string = ((): string => {
  const i: number = statusSrc.indexOf('private isEmpty(): boolean');
  return i < 0 ? '' : statusSrc.substring(i, i + 400);
})();
ok('① isEmpty() 可定位', emptyBody.length > 40);
has(emptyBody, 'this.sessionId.length === 0', '① isEmpty 计入 sessionId');
has(emptyBody, 'this.channel.length === 0', '① isEmpty 计入 channel');
has(emptyBody, 'this.lastActive.length === 0', '① isEmpty 计入 lastActive');

// ════════════════════════════════════════════════════════════════════════════
// ② 组件侧：onSubmitCwd —— 声明 + 消费（转发给行原语的 onSubmitValue）
// ════════════════════════════════════════════════════════════════════════════
has(statusSrc, 'onSubmitCwd: (dir: string) => void', '② onSubmitCwd：@Prop 回调声明存在');
has(statusSrc, 'this.onSubmitCwd(dir)', '② onSubmitCwd：被消费（行原语 onSubmitValue 转发到它）');
has(statusSrc, '@Prop editable: boolean = false', '② 行原语有 editable 开关');
has(statusSrc, 'onSubmitValue: (v: string) => void', '② 行原语有 onSubmitValue 回调');
has(statusSrc, 'editable: true', '② 工作路径行以 editable: true 真接线（否则编辑入口不存在）');

// ════════════════════════════════════════════════════════════════════════════
// ③ 组件侧：可编辑「工作路径」的形态（web `SessionInfo.tsx:138-173`）
// ════════════════════════════════════════════════════════════════════════════
has(statusSrc, 'TextInput(', '③ 编辑态有单行 TextInput（web `:139-155`）');
has(statusSrc, '@State private draft', '③ 编辑草稿是组件本地 @State（不进 store）');
has(statusSrc, '@State private editing', '③ 编辑态开关是组件本地 @State');
has(statusSrc, 'private beginEdit()', '③ 点值进编辑的入口 beginEdit()');
has(statusSrc, 'private commit()', '③ 提交 commit()（Enter / 确认共用）');
ok('③ Enter 提交（TextInput.onSubmit）', statusSrc.indexOf('TextInput(') >= 0
  && statusSrc.indexOf('.onSubmit(', statusSrc.indexOf('TextInput(')) >= 0);
// 确认按钮：图标-only ⇒ 必须有读屏文案；热区靠**真实 ≥44 布局盒**（⛔ 禁 responseRegion）。
has(statusSrc, "accessibilityText('保存工作路径')", '③ 图标-only 确认按钮有 accessibilityText（a11y）');
has(statusSrc, 'colorOf(this.pal(), \'iconMuted\')', '③ 确认图标色走 colorOf 计算型 role（iconMuted 非 Palette 字段）');
ok('③ 关闭 X + 确认按钮都靠真实 ≥44 布局盒（≥2 处）',
  count(statusSrc, '.width(HIT_TARGET_MIN).height(HIT_TARGET_MIN)') >= 2);
hasNot(statusSrc, 'responseRegion', '③ ⛔ 不用 responseRegion（真机实测负偏移外扩无效）');
// ⛔ 不加动效（本仓"只许减"，且 sheets2_visual / motion_budget 亦会抓）。
hasNot(statusSrc, 'animateTo(', '③ ⛔ 无 animateTo（不加动效）');
hasNot(statusSrc, '.animation(', '③ ⛔ 无属性动画');
hasNot(statusSrc, 'setInterval(', '③ ⛔ 无 setInterval');
hasNot(statusSrc, 'SymbolEffect', '③ ⛔ 无符号动效');
// ⛔ 零颜色字面量（取色唯一入口 = colorOf / 语义 token）。
ok('③ ⛔ 无 #RRGGBB 颜色字面量', statusSrc.match(/#[0-9A-Fa-f]{6}\b/g) === null);
// 保留既有空态（sheets2_visual 亦钉）。
has(statusSrc, "Text('暂无会话状态')", '③ 保留空态文案（八路全空 ⇒ 一行小字；⛔ 无全角括号括注）');

// ════════════════════════════════════════════════════════════════════════════
// ④ 页面侧：调用点**逐 field 真传**（criterion ②：不是"字段存在"，是"真接线"）
// ════════════════════════════════════════════════════════════════════════════
has(indexSrc, "sessionId: this.store !== null ? this.store.currentChatId : ''",
  '④ 调用点真传 sessionId（store.currentChatId，权威值）');
has(indexSrc, "channel: this.store !== null ? this.store.channel : ''",
  '④ 调用点真传 channel（store.channel）');
// ⚠️ 2026-10-16（③真机审计）：原钉 `lastActive: this.currentLastActive(),`。真机图抓到「最后活跃」
//    **直出机器时间戳**（`2026-10-14T15:06:53+08:00`）⇒ 调用点外套了**显示规范化** `formatLastActive(...)`
//    （真源仍是页面的 `currentLastActive()`）。⇒ 钉两条（⛔ 不许只留一条）。
has(indexSrc, 'lastActive: formatLastActive(this.currentLastActive())',
  '④ 调用点真传 lastActive（页面判据 currentLastActive + 展示过 formatLastActive）');
has(indexSrc, 'onSubmitCwd: (dir: string) => {',
  '④ 调用点真传 onSubmitCwd 回调');
has(indexSrc, 'this.submitCwd(dir)', '④ onSubmitCwd 回调体真调 submitCwd(dir)');
has(indexSrc, 'cwd: this.cwd', '④ 既有 cwd 传参保留');

// ════════════════════════════════════════════════════════════════════════════
// ⑤ 页面侧：写路径**复用既有 set_cwd**（criterion ③：形态指向既有落点，不新造 RPC）
// ════════════════════════════════════════════════════════════════════════════
// ⛔ `'set_cwd'` 字面量只许出现 1 次（= 唯一常量 `RPC_SET_CWD` 的定义）⇒ 新造 RPC 名立刻红。
eq("⑤ `'set_cwd'` 字面量恰 1 处（唯一常量定义，⛔ 不新造 RPC 名）",
  count(indexSrc, "'set_cwd'"), 1);
has(indexSrc, 'const RPC_SET_CWD: string = \'set_cwd\'', '⑤ 唯一 set_cwd method 常量在');
ok('⑤ `RPC_SET_CWD` 被消费（定义 + 发送点 ≥2 处）', count(indexSrc, 'RPC_SET_CWD') >= 2);
has(indexSrc, 'private async sendSetCwd(store: ChatStore, dir: string): Promise<void>',
  '⑤ 唯一发送点 sendSetCwd 存在');
// ⚠️ 2026-10-13 订正：chat_id 参数改为 `store.wireChatId()`（出网规范化，见 §21.110）。
//    本判据的**意图不变**：写路径只许走既有 `set_cwd`（`RPC_SET_CWD` + `SetCwdParams`）。
has(indexSrc,
  'rpc<Object>(store.http, RPC_SET_CWD, new SetCwdParams(store.channel, store.wireChatId(), dir))',
  '⑤ 发送点通过 RPC_SET_CWD + SetCwdParams（既有 set_cwd 契约）');
eq('⑤ SetCwdParams 只构造 1 处（唯一写路径）', count(indexSrc, 'new SetCwdParams('), 1);
has(indexSrc, 'class SetCwdParams', '⑤ SetCwdParams 类型仍在（force:true 契约）');
// 回调链闭合：call site → submitCwd → sendSetCwd（三跳都必须在）。
has(indexSrc, 'private async submitCwd(dir: string): Promise<void>', '⑤ submitCwd 定义在');
has(indexSrc, 'await this.sendSetCwd(store, path)', '⑤ submitCwd 复用 sendSetCwd（写路径唯一）');
// 权威回流：改完拉一次会话状态（不本地估算 / 不假装成功）。
has(indexSrc, 'await store.loadStatus()', '⑤ 提交后拉服务端权威状态（cwd 回流，不估算）');

// ════════════════════════════════════════════════════════════════════════════
// ⑥ 页面侧：currentLastActive 真读 `SessionItem.last_active`（数据面真源，非字段名臆造）
// ════════════════════════════════════════════════════════════════════════════
has(indexSrc, 'private currentLastActive(): string', '⑥ currentLastActive 定义在');
const lastActiveBody: string = ((): string => {
  const i: number = indexSrc.indexOf('private currentLastActive(): string');
  return i < 0 ? '' : indexSrc.substring(i, i + 800);
})();
ok('⑥ currentLastActive 可定位', lastActiveBody.length > 60);
has(lastActiveBody, 'this.store.currentChatId', '⑥ 以当前会话 id 为键');
// ⚠️ 2026-10-13：取值点从 `s`（按原值精确比对的循环）改为 `node`（`resolveSessionNode` 规范化解析，
//    同 id 多行取真身 —— 见 docs §21.112）⇒ 断言随形态更新，意图不变（仍真读 `last_active`）。
has(lastActiveBody, 'node.last_active !== undefined ? node.last_active', '⑥ 真读 SessionItem.last_active（core/types.ets:37）');
has(lastActiveBody, "return '';", '⑥ 取不到 ⇒ 空串（面板不显示该行，不编造）');

if (fail > 0) {
  console.log(`  status_sheet_wiring: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  status_sheet_wiring: ${pass} passed, 0 failed`);
process.exit(0);

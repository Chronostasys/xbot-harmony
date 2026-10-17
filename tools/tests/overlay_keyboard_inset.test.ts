/**
 * 「浮层自避让软键盘」接线门禁 —— **生产者唯一 + 消费点计数**证据。
 *
 * ── 背景（真机 dump 对照，2026-10-12）─────────────────────────────────────────────
 *   `KeyboardAvoidMode.RESIZE`（`EntryAbility.ets`）**只对"焦点在文档流输入框"生效**。
 *   同一个抽屉、同一段手势，两次测量：
 *     · 点 composer（**文档流**输入框）⇒ 页面内容根 `[0,131][1320,2754]` → composer 上移 932px
 *       （model 行 y2444 → y1496）⇒ **视口真缩**、输入框可见 ✓
 *     · 点抽屉**自己的搜索框**（**浮层内**输入框）⇒ 页面内容根**仍 `[0,131][1320,2754]`**、
 *       composer 仍在 y2417 ⇒ **视口一点没缩** ⇒ 抽屉底栏留在 `y2647`、被 IME 窗口**完全盖死**
 *       （`uitest dumpLayout` 里那 5 键的节点被整批裁掉 = 被别的窗口盖住）✗
 *   同一元素 y 取决于"键盘是否先存在"（键盘先弹起再开抽屉 ⇒ 底栏在 y1699 正常）⇒ 不确定行为。
 *   ⇒ 浮层**不能**指望系统避让，必须自己按键盘高度让位（用户点名「终端和任务管理做的很差」的硬点：
 *   终端 sheet 底部命令行、运行面板下半截、抽屉底栏 5 键都在键盘之下 ⇒ 不可达）。
 *
 * ── 钉什么（缺一即"以为修好了其实没有"）──────────────────────────────────────────
 *   ① 零扫描判红：两个文件都真读到、剥注释后非空。
 *   ② **生产者唯一**：`EntryAbility.ets` 内 `keyboardHeightChange` 恰 1 处（`on` 注册）、
 *      往 `AppStorage` 写 `kbHeightPx` 恰 1 处、注销 `off('keyboardHeightChange'` 恰 1 处
 *      （**成对**：留一个打到已销毁页面的回调是本轮要避免的形态）。
 *   ③ **消费点计数 == 3**：`Index.ets` 内 `px2vp(this.kbHeightPx)` 恰 3 处（抽屉底栏 / 运行面板 /
 *      终端 sheet）——三处都是**底部锚定**的浮层，键盘弹起时底部会被盖。
 *   ④ **切片内逐个钉**：三个消费点必须各自落在其浮层容器切片内（各恰 1 处）；
 *      ⛔ 全文件 `.replace`/`countIn` 会打到切片外 ⇒ 判据假绿。
 *   ⑤ **键名同源**：`@StorageProp('kbHeightPx')` 恰 1 处（页面侧唯一订阅点）。
 *
 * ⚠️ 纪律：**剥注释**（注释里提到这些名字是文档，不是调用点）；计数一律**精确 `=== n`**
 *   （本仓教训：`>= n` 会假绿）；**切片内**定位。
 * ✅ 判据自证：mutation（删 `AppStorage.setOrCreate` 行 ⇒ ≥2 红；把抽屉底栏那处 `px2vp` 删掉 ⇒ 红；
 *   把 `@StorageProp` 键名改错 ⇒ 红）· 还原 md5 逐字节一致。
 * ⚠️ 结尾 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const path = require('path');
const fs = require('fs');

// ⛔ 标记为模块（顶层变量不落全局，避免与其它脚本测试重名 TS2451）。
export {};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` ｜ ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function countIn(s: string, needle: string): number {
  return s.split(needle).length - 1;
}
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function readOrDie(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8').replace(/i18nT\(([^()]*)\)/g, '$1');
  } catch (e) {
    console.log(`  ✗ 读不到 ${p}`);
    process.exit(1);
    return '';
  }
}

const REPO: string = path.resolve(__dirname, '../../../..');
const ABILITY: string = path.join(REPO, 'entry', 'src', 'main', 'ets', 'entryability', 'EntryAbility.ets');
const PAGE: string = path.join(REPO, 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');

const abilityRaw: string = readOrDie(ABILITY);
const pageRaw: string = readOrDie(PAGE);

// ① 零扫描判红 + 剥注释
ok('① ability 文件非空（零扫描判红）', abilityRaw.length > 3000, `len=${abilityRaw.length}`);
ok('① page 文件非空（零扫描判红）', pageRaw.length > 100000, `len=${pageRaw.length}`);
const ab: string = stripComments(abilityRaw);
const pg: string = stripComments(pageRaw);
ok('① ability 剥注释后仍非空', ab.length > 3000, `len=${ab.length}`);
ok('① page 剥注释后仍非空', pg.length > 100000, `len=${pg.length}`);

// ② 生产者唯一（EntryAbility）
const AB_ON: string = 'win.on(\'keyboardHeightChange\', this.kbCb);';
const AB_SET: string = 'AppStorage.setOrCreate<number>(\'kbHeightPx\', h);';
const AB_OFF: string = 'win.off(\'keyboardHeightChange\', this.kbCb);';
eq('② 注册 keyboardHeightChange 恰 1 处', countIn(ab, AB_ON), 1);
eq('② 写 AppStorage kbHeightPx 恰 1 处', countIn(ab, AB_SET), 1);
eq('② 注销 off(keyboardHeightChange) 恰 1 处（成对）', countIn(ab, AB_OFF), 1);

// ②b 切片：注册落在 onWindowStageCreate；注销落在 onWindowStageDestroy（⛔ 不放错方法）
function sliceTo(src: string, mark: string, endMark: string): string {
  const a: number = src.indexOf(mark);
  if (a < 0) { return ''; }
  const b: number = src.indexOf(endMark, a);
  return b > a ? src.substring(a, b) : src.substring(a);
}
function sliceBlock(src: string, mark: string, endIndent: string): string {
  const a: number = src.indexOf(mark);
  if (a < 0) { return ''; }
  const b: number = src.indexOf(`\n${endIndent}}`, a);
  return b > a ? src.substring(a, b) : src.substring(a);
}
{
  const s: string = sliceBlock(ab, 'onWindowStageCreate(windowStage: window.WindowStage): void {', '  ');
  ok('②b onWindowStageCreate 切片非空（零扫描判红）', s.length > 200, `len=${s.length}`);
  eq('②b 注册落在 onWindowStageCreate 恰 1 处', countIn(s, AB_ON), 1);
  eq('②b 写 AppStorage 落在 onWindowStageCreate 恰 1 处', countIn(s, AB_SET), 1);
}
{
  const s: string = sliceBlock(ab, 'onWindowStageDestroy(): void {', '  ');
  ok('②b onWindowStageDestroy 切片非空（零扫描判红）', s.length > 20, `len=${s.length}`);
  eq('②b 注销落在 onWindowStageDestroy 恰 1 处', countIn(s, AB_OFF), 1);
}

// ③ 消费点计数（Index）
const USE: string = 'px2vp(this.kbHeightPx)';
// 7 处 = 抽屉根容器 + 终端 sheet + 5 个含输入框的浮层（新建会话 / AskUser / 状态 / 模型 / 设置面）。
// ⛔ 计数一律**精确 `=== n`**：夹带一处"顺手加的"（如 composer 那段文档流）会让闭包证明（④b）红。
eq('③ 页面消费点恰 7 处', countIn(pg, USE), 7);
eq('③ 页面订阅点 @StorageProp(kbHeightPx) 恰 1 处（唯一订阅点）', countIn(pg, '@StorageProp(\'kbHeightPx\')'), 1);

// ④ 两个消费点**逐个**落在自己的浮层切片内（各恰 1 处）
{
  // 抽屉：从「退出」按钮的点击（抽屉最后一个动作）到 DrawerSheet 结束。
  // 让位**落在抽屉根容器**（`.width('88%').height('100%')` 那个 Column 的 padding）——
  // ⛔ 只抬底栏那一排是不够的：抽屉里有**行内重命名输入框**（列表中部），只抬底栏时
  //    列表底部仍在键盘下 ⇒ 输入框滚不进可见区。整片内容区上缩才两者兼顾。
  const s: string = sliceBlock(pg, 'this.doLogout();', '  ');
  ok('④ 抽屉切片非空（零扫描判红）', s.length > 40, `len=${s.length}`);
  eq('④ 抽屉切片内让位恰 1 处', countIn(s, USE), 1);
}
{
  // ⛔ 反向钉（"不许死消费"纪律）：运行面板内**没有**输入框（终端 tab 只有列表 + 「＋ 新建」，
  //    真正的输入行在 `TerminalSheet`）⇒ 面板**不可能**与软键盘共存（`openPanels()` 已先收键盘）
  //    ⇒ 给它加让位就是**不可达的死代码**。这一条钉住"不要顺手加进去"。
  const s: string = sliceBlock(pg, 'if (this.showPanels) {', '      ');
  ok('④ 运行面板切片非空（零扫描判红）', s.length > 100, `len=${s.length}`);
  eq('④ 运行面板切片内含 PanelsSheet', countIn(s, 'this.PanelsSheet()'), 1);
  eq('④ 运行面板切片内**不许**有让位（无输入 ⇒ 死消费点）', countIn(s, USE), 0);
}
{
  const s: string = sliceBlock(pg, 'if (this.showTerminal) {', '      ');
  ok('④ 终端浮层切片非空（零扫描判红）', s.length > 100, `len=${s.length}`);
  eq('④ 终端浮层切片内含 TerminalSheet', countIn(s, 'TerminalSheet({'), 1);
  eq('④ 终端浮层切片内让位恰 1 处', countIn(s, USE), 1);
}

// ④b 其余 5 个**含输入框**的浮层：让位**逐个**落在自己的容器切片内（各恰 1 处）。
//     ⛔ 为什么必须逐个钉：全文件计数（③）只能证明"总数对"，证明不了"每处都加在对的元素上"
//     —— 把让位误加到某个无关 Row、又漏掉设置面 ⇒ 总数仍是 7 ⇒ 假绿。
//     **闭包证明**：各切片计数之和 == 全文件计数 ⇒ 全文件**没有第 8 处**（钉住"别顺手给文档流
//     元素也加"：composer / GoalBanner / TodoPanel 都是文档流，系统 `RESIZE` 已避让，
//     再加 = **双倍避让**）。见 ④c 的反向断言。
const OVERLAYS: Array<[string, string]> = [
  ['④b 新建会话 sheet（2 输入 + 底部 sheet）', 'this.NewSessionSheet()'],
  ['④b AskUser 确认卡（居中）', 'AskUserSheet({'],
  ['④b 会话状态面板（居中）', 'StatusSheet({'],
  ['④b 模型/上下文栏（底部 sheet）', 'this.ModelSheet()'],
  ['④b 全屏设置面板（6 分区含输入）', 'SettingsPanel({'],
];
let sliceSum: number = 0;
{
  sliceSum += countIn(sliceBlock(pg, 'this.doLogout();', '  '), USE); // 抽屉根容器（④ 已钉）
  sliceSum += countIn(sliceBlock(pg, 'if (this.showTerminal) {', '      '), USE);
}
for (let i = 0; i < OVERLAYS.length; i++) {
  const label: string = OVERLAYS[i][0];
  const s: string = sliceBlock(pg, OVERLAYS[i][1], '      ');
  ok(`${label} 切片非空（零扫描判红）`, s.length > 80, `len=${s.length}`);
  eq(`${label} 切片内让位恰 1 处`, countIn(s, USE), 1);
  sliceSum += countIn(s, USE);
}
eq('④b 闭包证明：各切片让位之和 == 全文件让位总数（无第 8 处）', sliceSum, countIn(pg, USE));

// ④c 反向：**文档流**元素不做让位 —— 它们的输入框属页面文档流（`RESIZE` 已被系统避让：
//     真机实测 composer 上移 932px）⇒ 加让位 = **双倍避让**（系统 + 自己）。
//     这一条钉住"不要顺手加进去"；覆盖 `GoalBanner` → 「添加目标」内联输入 → `TodoPanel` 这一列。
{
  const s: string = sliceTo(pg, '      GoalBanner({', '      TodoPanel({');
  ok('④c 输入胶囊上方那一列切片非空（零扫描判红）', s.length > 300, `len=${s.length}`);
  eq('④c 该列内含「添加目标」内联输入框（确认切的是对的地方）', countIn(s, 'goalDraft'), 2);
  eq('④c 反向：文档流元素**不许**有让位（防双倍避让）', countIn(s, USE), 0);
}

// ⑤ 两处消费点必须**都在浮层容器上**（⛔ 钉住"不是加在随便一个元素上"），且形态**各自精确**：
//    ⛔ 别用宽松正则（`.padding` 后面接什么都算）—— 本仓教训：宽形态断言会在重构后假绿。
{
  const termForm: string = `.padding({ bottom: ${USE} })`;
  eq('⑤ 简单形态（容器 padding-bottom）恰 6 处', countIn(pg, termForm), 6);
  const drawerForm: string = `.padding({ top: SP_3, left: SP_3, right: SP_3, bottom: SP_3 + ${USE} })`;
  eq('⑤ 抽屉根容器让位形态（四边 padding + 底部加键盘高）恰 1 处', countIn(pg, drawerForm), 1);
  // ⛔ 反向：抽屉底栏那一排**不许**再单独让位（否则"整片上缩 + 底栏再上缩"= 双倍让位、底部留白翻倍）。
  const barSlice: string = sliceBlock(pg, 'accessibilityText(\'退出登录\')', '      ');
  ok('⑤ 抽屉底栏切片非空（零扫描判红）', barSlice.length > 20, `len=${barSlice.length}`);
  eq('⑤ 反向：抽屉底栏那一排自己不许带让位', countIn(barSlice, USE), 0);
}

console.log(`  overlay_keyboard_inset: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

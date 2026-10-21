/**
 * skills_pure.test.ts —— 原生**技能管理**（目标④）的判别力判据。
 *
 * 两层：
 *   ① **纯逻辑**（`core/skills.ets`）：解析归一化 / 来源分档 / 分组档序 / 摊平行模型 /
 *      计数文案 / 路径提示 / 开关可访问性文案 —— 组件的每一处显示都必须读这里（判据与渲染同源）。
 *   ② **消费形态**（读源码）：⛔ "方法体存在"会假绿，必须钉**调用点**——
 *      · 组件必须真的消费 `skillRows`/`skillSummaryText`/`skillToggleLabel`；
 *      · 页面必须真的接线（`onToggle`/`onOpen` + `openSkills`）；
 *      · 能力面板必须有**第 4 条入口行**（技能）+ `onOpenSkills`，且
 *        `PANEL_FIXED_ENTRY_ROWS === 4`（高度估值与行数同源 —— 13h 的"裁行"缺陷即此条失守）；
 *      · 性能预算 ⑦ 净额：静态骨架屏的 `ForEach([0, 1, 2, 3]` 必须已展开成静态调用
 *        （本批新增 1 个列表站点靠它抵消 ⇒ 全仓 `ForEach(` 仍 107）。
 */
import {
  normalizeSkillDescription, normalizeSkillSource, parseSkillList, SKILL_ROW_GROUP, SKILL_ROW_ITEM, SKILL_SOURCE_EMBEDDED,
  SKILL_SOURCE_GLOBAL, SKILL_SOURCE_ORDER, SKILL_SOURCE_OTHER, SKILL_SOURCE_PROJECT, SKILL_SOURCE_USER,
  SkillGroup, SkillItem, SkillRow, skillGroups, skillPathHint, skillRows, skillSummaryText,
  skillSourceLabel, skillToggleLabel,
} from '../../entry/src/main/ets/core/skills';
import { PANEL_FIXED_ENTRY_ROWS } from '../../entry/src/main/ets/core/pluginview';

declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function mk(name: string, source: string, enabled: boolean): SkillItem {
  return { name: name, description: `desc ${name}`, path: source === SKILL_SOURCE_EMBEDDED ? `embedded:${name}` : `/x/${name}`, source: source, enabled: enabled, canUninstall: source === SKILL_SOURCE_USER };
}

// ── ① 解析归一化 ───────────────────────────────────────────────────────────────
{
  eq('★解析：非数组（undefined）⇒ 空列表（⛔ 不抛）', parseSkillList(undefined), []);
  const bad: unknown = { nope: 1 };
  eq('★解析：非数组（对象）⇒ 空列表', parseSkillList(bad as never), []);

  const rows = parseSkillList([
    { name: ' debug ', description: ' d ', path: 'embedded:debug', source: 'embedded', enabled: true, can_uninstall: false },
    { name: '', description: '无名' },            // 缺 name ⇒ 跳过
    { name: 'mine', source: 'user', enabled: false, can_uninstall: true, path: '/u/mine' },
    { name: 'weird', source: 'brand_new_tier', enabled: true },
  ]);
  eq('★解析：条数（无名跳过）', rows.length, 3);
  eq('★解析：name/description 去空白', [rows[0].name, rows[0].description], ['debug', 'd']);
  eq('★解析：source 归一 + enabled/canUninstall 逐字', [rows[0].source, rows[0].enabled, rows[0].canUninstall],
    [SKILL_SOURCE_EMBEDDED, true, false]);
  eq('★解析：enabled=false 保留（黑名单技能不装成"启用"）', rows[1].enabled, false);
  eq('★解析：未知档 ⇒ other（⛔ 不丢行）', rows[2].source, SKILL_SOURCE_OTHER);
  // ⛔ `enabled` 只在显式 true 时为真（字段缺失 ⇒ false：让用户看到真实状态）
  const miss = parseSkillList([{ name: 'noflag' }]);
  eq('★解析：enabled 缺失 ⇒ false（不乐观假设）', miss[0].enabled, false);
}

// ── ② 来源标签/归一 ────────────────────────────────────────────────────────────
{
  eq('来源：四档标签', [skillSourceLabel(SKILL_SOURCE_PROJECT), skillSourceLabel(SKILL_SOURCE_USER),
    skillSourceLabel(SKILL_SOURCE_GLOBAL), skillSourceLabel(SKILL_SOURCE_EMBEDDED)],
    ['项目技能', '我的技能', '全局技能', '内置技能']);
  eq('来源：未知标签', skillSourceLabel('zzz'), '其他技能');
  eq('来源：归一（已知原样）', normalizeSkillSource(' global '), SKILL_SOURCE_GLOBAL);
  eq('来源：归一（undefined/空 ⇒ other）', [normalizeSkillSource(undefined), normalizeSkillSource('')],
    [SKILL_SOURCE_OTHER, SKILL_SOURCE_OTHER]);
}

// ── ③ 分组：档序 + 空组不产出 + 组内保序 ───────────────────────────────────────
{
  const items: SkillItem[] = [
    mk('e1', SKILL_SOURCE_EMBEDDED, true),
    mk('p1', SKILL_SOURCE_PROJECT, true),
    mk('e2', SKILL_SOURCE_EMBEDDED, false),
    mk('p2', SKILL_SOURCE_PROJECT, true),
  ];
  const gs: SkillGroup[] = skillGroups(items);
  eq('★分组：只产出非空组', gs.length, 2);
  eq('★分组：档序 = project 先于 embedded', [gs[0].source, gs[1].source],
    [SKILL_SOURCE_PROJECT, SKILL_SOURCE_EMBEDDED]);
  eq('★分组：组内**保持输入顺序**', [gs[0].items[0].name, gs[0].items[1].name], ['p1', 'p2']);
  eq('★分组：空输入 ⇒ 零组', skillGroups([]).length, 0);
  eq('分档常量：5 档（含 other）', SKILL_SOURCE_ORDER.length, 5);
}

// ── ④ 摊平行模型（组件只需一处列表站点）────────────────────────────────────────
{
  const items: SkillItem[] = [mk('p1', SKILL_SOURCE_PROJECT, true), mk('e1', SKILL_SOURCE_EMBEDDED, true), mk('e2', SKILL_SOURCE_EMBEDDED, false)];
  const rs: SkillRow[] = skillRows(items);
  eq('★摊平：行数 = 组数(2) + 条目数(3)', rs.length, 5);
  eq('★摊平：结构 = 组标题 ⊕ 条目…', [rs[0].kind, rs[1].kind, rs[2].kind, rs[3].kind, rs[4].kind],
    [SKILL_ROW_GROUP, SKILL_ROW_ITEM, SKILL_ROW_GROUP, SKILL_ROW_ITEM, SKILL_ROW_ITEM]);
  eq('★摊平：组标题带计数（“项目技能 · 1”）', rs[0].label, '项目技能 · 1');
  eq('★摊平：组标题行无 item（⛔ 组件据此分支）', rs[0].item, undefined);
  eq('★摊平：条目行 label = 技能名', rs[1].label, 'p1');
  ok('★摊平：条目行带完整 item（开关/点行要用）', rs[1].item !== undefined && rs[1].item!.name === 'p1');
  eq('★摊平：空 ⇒ 零行', skillRows([]).length, 0);
}

// ── ⑤ 文案 ────────────────────────────────────────────────────────────────────
{
  eq('计数：空', skillSummaryText([]), '暂无技能');
  eq('计数：全启用', skillSummaryText([mk('a', SKILL_SOURCE_EMBEDDED, true), mk('b', SKILL_SOURCE_EMBEDDED, true)]),
    '2 个技能 · 全部启用');
  eq('计数：全禁用', skillSummaryText([mk('a', SKILL_SOURCE_EMBEDDED, false)]), '1 个技能 · 全部禁用');
  eq('计数：混合', skillSummaryText([mk('a', SKILL_SOURCE_EMBEDDED, true), mk('b', SKILL_SOURCE_EMBEDDED, false), mk('c', SKILL_SOURCE_EMBEDDED, true)]),
    '3 个技能 · 2 启用 · 1 禁用');
  eq('★开关可访问性文案：描述**动作**（关→"启用"，开→"禁用"）',
    [skillToggleLabel('debug', false), skillToggleLabel('debug', true)],
    ['启用技能 debug', '禁用技能 debug']);
  eq('路径提示：内置伪路径 ⇒ 空（不画噪音）', skillPathHint('embedded:debug'), '');
  eq('路径提示：真实路径原样', skillPathHint('/Users/x/.xbot/skills/foo'), '/Users/x/.xbot/skills/foo');
  eq('路径提示：空路径 ⇒ 空', skillPathHint(''), '');
}

// ── ⑥ 消费形态（源级；⛔ 钉调用点，不钉"方法体存在"）────────────────────────────
{
  let root: string = __dirname;
  for (let i = 0; i < 10; i++) {
    if (require('fs').existsSync(require('path').join(root, 'entry', 'src', 'main', 'ets'))) { break; }
    root = require('path').join(root, '..');
  }
  const rd = (rel: string): string => {
    const p = require('path').join(root, rel);
    return require('fs').existsSync(p) ? require('fs').readFileSync(p, 'utf-8') : '';
  };
  // ⛔ **剥注释**后再做形态判断：注释里的散文提及（`ForEach(`/`this.pal()` 这些"反面教材"写法
  //    恰恰最常出现在解释性注释里）会被文本搜索计入 ⇒ **虚增/假红**。门禁 `tools/perf/guard.sh`
  //    对同类计数用的是同一手艺（见其 :47-50 的实战记录）。
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const compRaw: string = rd('entry/src/main/ets/components/SkillsSheet.ets');
  const pageRaw: string = rd('entry/src/main/ets/pages/Index.ets');
  const panelRaw: string = rd('entry/src/main/ets/components/PluginsSheet.ets');
  const comp: string = stripComments(compRaw);
  const page: string = stripComments(pageRaw);
  const panel: string = stripComments(panelRaw);

  ok('零扫描防线：三个源文件都读到了', compRaw.length > 1000 && pageRaw.length > 10000 && panelRaw.length > 1000);
  ok('★组件消费摊平模型 `skillRows(`（而不是自己写第二套分组）', comp.indexOf('skillRows(this.items)') >= 0);
  ok('★组件消费计数文案 `skillSummaryText(`', comp.indexOf('skillSummaryText(this.items)') >= 0);
  ok('★组件消费开关可访问性文案 `skillToggleLabel(`', comp.indexOf('skillToggleLabel(') >= 0);
  ok('★组件消费路径提示 `skillPathHint(`', comp.indexOf('skillPathHint(') >= 0);
  ok('★组件真的画了开关（Toggle + 用户强调色，⛔ 不写死绿）',
    comp.indexOf('Toggle({ type: ToggleType.Switch') >= 0 && comp.indexOf('.selectedColor(paletteOf(this.theme).accent)') >= 0);
  ok('★组件只允许**一处**列表站点（`ForEach(` 计数 ≤ 1）',
    (comp.match(/ForEach\(/g) || []).length <= 1);
  // ⛔ 防"死消费"（`AGENTS.md` 明确点名的缺陷类）：**只画开关/不接回调** ⇒ 用户操作静默无效。
  //    "属性存在"抓不到它 ⇒ 必须钉**回调调用点**。
  ok('★组件开关**真的回调**（`this.onToggle(r.item!.name, on)`，不是画个哑开关）',
    comp.indexOf('this.onToggle(r.item!.name, on)') >= 0);
  ok('★组件点行**真的回调**（`this.onOpen(r.item!)`）', comp.indexOf('this.onOpen(r.item!)') >= 0);
  ok('★组件取色走**记忆化** `paletteOf(this.theme)`（不计入 A/B 预算）',
    comp.indexOf('paletteOf(this.theme)') >= 0);
  // ⚠️ 2026-10-12 亲踩：本条原只断言 `this.pal()`（漏了 `this.palOnce()`）⇒ 我照抄 FilesSheet 的
  //    `palOnce()` 记忆化写法时判据**全绿**，而门禁 B 线（`this.pal() ∨ this.palOnce()`）**超限 19 处**
  //    （1350 → 1369）。⇒ 断言必须覆盖**两个**入口（A 线 `pal()` + B 线 `palOnce()`）。
  ok('★★组件**零** `this.pal()` / `this.palOnce()` 站点（A/B 两线都不吃预算）',
    comp.indexOf('this.pal(') < 0 && comp.indexOf('this.palOnce(') < 0);

  ok('★页面接线：`openSkills()` 定义 + 能力面板回调 `onOpenSkills`', page.indexOf('private openSkills()') >= 0 && page.indexOf('onOpenSkills: () => {') >= 0);
  ok('★页面接线：三处数据/行为回调（onToggle / onOpen / onRefresh）',
    page.indexOf('void this.toggleSkill(name, on)') >= 0 && page.indexOf('void this.openSkillView(it)') >= 0);
  ok('★页面接线：技能面板挂载（`SkillsSheet({`）', page.indexOf('SkillsSheet({') >= 0);

  ok('★能力面板第 4 条入口行（技能）在位', panel.indexOf("this.EntryRow('技能'") >= 0 && panel.indexOf('this.onOpenSkills();') >= 0);
  eq('★固定入口行数 = 6（高度估值与行数同源；否则第 6 行会被裁；§21.115 分组头另计；§21.122 增「插件管理（Web）」）', PANEL_FIXED_ENTRY_ROWS, 6);

  // 性能预算 ⑦ 净额：静态骨架屏的 `ForEach([0, 1, 2, 3]` 必须已展开
  ok('★预算净额：静态骨架屏 `ForEach([0, 1, 2, 3]` 已展开为静态调用（`this.SkeletonRow(`）',
    page.indexOf('ForEach([0, 1, 2, 3]') < 0 && page.indexOf('this.SkeletonRow(') >= 0);
}

// ── ④b 描述显示规范化（真机截图抓到的细节：frontmatter 引号被直出）────────────────
//  判据必须覆盖「删对了」与「⛔ 什么都没删」（白绿防线：未实现时成对引号必须还在 ⇒ 必红）。
{
  eq('★desc：成对双引号被剥（真机 `"Manage SubAgent roles: …` 那条）',
    normalizeSkillDescription('"Manage SubAgent roles: create, view"'), 'Manage SubAgent roles: create, view');
  eq('★desc：成对单引号被剥', normalizeSkillDescription('\'Build plans\''), 'Build plans');
  eq('★desc：成对全角引号被剥', normalizeSkillDescription('“主 Agent 指挥模式：定约”'), '主 Agent 指挥模式：定约');
  eq('★desc：无引号原样（含内部引号：只删定界符）',
    normalizeSkillDescription('Use xbot "name" field'), 'Use xbot "name" field');
  eq('★desc：⛔ 单边引号不剥（缺配对 ⇒ 不是定界符）', normalizeSkillDescription('"only-left'), '"only-left');
  eq('★desc：⛔ 长度 <2 不炸', normalizeSkillDescription('"'), '"');
  eq('★desc：undefined/null ⇒ 空串', [normalizeSkillDescription(undefined), normalizeSkillDescription(null as never)], ['', '']);
  eq('★desc：首尾空白先 trim 再判配对', normalizeSkillDescription('  "hi"  '), 'hi');
  // 与 `parseSkillList` 同源（组件只读 `SkillItem.description` ⇒ 那里必须已是干净串）
  eq('★desc：解析链路里已生效（组件拿到的就是干净串）',
    parseSkillList([{ name: 'orchestrator', description: '“主 Agent 指挥模式”', source: 'embedded', enabled: true }])[0].description,
    '主 Agent 指挥模式');
}

if (fail > 0) {
  console.log(`  ✗ skills_pure: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  ✅ skills_pure: ${pass} passed, 0 failed`);
process.exit(0);

export {};

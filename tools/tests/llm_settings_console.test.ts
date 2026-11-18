/**
 * LLM 设置页 **交互重设计** 判据（用户 2026-11-06：「重写设置里 llm 配置页……目前的交互完全用不了」）。
 *
 * 旧实现症状（本文件钉死，改回即红）：
 *   · 所有东西塞在同一根滚动条里 —— 订阅卡 → 一排「编辑/管理模型/删除」按钮 → 展开再嵌模型列表
 *     → 行内再嵌逐模型编辑器，最上面还插着新增/编辑表单（真机上一屏三层嵌套表单）。
 *   · 入口被埋：`manageSubId` / `toggleManage` 的展开态才是唯一能管模型的地方，且与列表同屏。
 *   · 订阅卡内「设为默认」渲染了却没接线（死按钮）。
 *
 * 新交互（本文件逐条钉住）：**控制台 + 下钻**
 *   列表(`list`) → 订阅详情(`detail`) / 档位挑选(`tier`) / 新增编辑(`form`) → 逐模型配置(`model`)，
 *   每屏只做一件事，子页统一「返回 + 标题」栏；表单操作栏固定在最上（键盘不挡保存）。
 *
 * mutation 自证：把 `page` 状态机删掉、改回内联 `manageSubId` 展开 ⇒ §1/§2/§3 立刻红。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string; resolve(...parts: string[]): string };
declare const __dirname: string;

const ls_fs = require('fs');
const ls_path = require('path');

/** 仓库根（harness 把测试编译到 tools/tests/.out-XXX/ ⇒ 逐级上探，沿用本仓既有先例）。 */
function lsFindRoot(): string {
  const ups: string[] = ['../..', '../../..', '../../../..'];
  for (let i = 0; i < ups.length; i++) {
    const p: string = ls_path.resolve(__dirname, ups[i]);
    if (ls_fs.existsSync(ls_path.join(p, 'entry/src/main/ets/components'))) {
      return p;
    }
  }
  return '';
}
const ls_root: string = lsFindRoot();
const ls_src: string = ls_fs.readFileSync(
  ls_path.join(ls_root, 'entry/src/main/ets/components/SettingsLlm.ets'), 'utf8');

let ls_pass = 0;
let ls_fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    ls_pass++;
  } else {
    ls_fail++;
    console.log(`  ✗ ${name}${detail !== undefined ? '  [' + detail + ']' : ''}`);
  }
}
function at(needle: string): number {
  return ls_src.indexOf(needle);
}

// ── §1 下钻状态机（一屏只做一件事）────────────────────────────────────────────
console.log('\n▶ §1 下钻式页面状态机');
{
  const pages: string[] = ['PAGE_LIST', 'PAGE_DETAIL', 'PAGE_TIER', 'PAGE_FORM', 'PAGE_MODEL'];
  for (let i = 0; i < pages.length; i++) {
    ok(`${pages[i]} 常量已定义`, at(`const ${pages[i]}: string =`) >= 0);
    ok(`${pages[i]} 在 build() 的分发里被使用`, ls_src.indexOf(`this.page === ${pages[i]}`) >= 0);
  }
  ok('@State page 以 PAGE_LIST 起始', at('@State private page: string = PAGE_LIST;') >= 0);
  ok('build() 是 if/else-if 单页分发（不是同屏堆叠）',
    at('if (this.page === PAGE_LIST) {') >= 0 && at('} else if (this.page === PAGE_DETAIL) {') >= 0);
  // 子页统一返回栏
  ok('存在无参 @Builder NavBar()', at('@Builder\n  NavBar() {') >= 0);
  ok('返回栏有真实返回动作', at('this.back();') >= 0);
  // 每个入口都把 page 推到目标页
  ok('openDetail 进入 detail', at("this.page = PAGE_DETAIL;") >= 0);
  ok('openAdd/openEdit 进入 form', at("this.page = PAGE_FORM;") >= 0);
  ok('openTier 进入 tier', at("this.page = PAGE_TIER;") >= 0);
  ok('openModelConfig 进入 model', at("this.page = PAGE_MODEL;") >= 0);
}

// ── §2 旧的内联嵌套必须消失 ───────────────────────────────────────────────────
console.log('\n▶ §2 列表页不再承载管理/表单（旧交互的根因）');
{
  ok('不再有 manageSubId 展开态', at('manageSubId') < 0);
  ok('不再有 toggleManage 内联展开', at('toggleManage') < 0);
  ok('不再有 per-card 模型签名（内联模型列表用）', at('subModelSig') < 0);
  ok('列表页不再直接渲染逐模型编辑器', at('this.ModelConfigEditor()') >= 0
    && ls_src.indexOf('this.ModelConfigEditor()') > ls_src.indexOf('this.page === PAGE_MODEL'));
  // 表单只在 form 页出现（旧实现是列表 Scroll 顶部）
  const iFormBranch: number = ls_src.indexOf('} else if (this.page === PAGE_FORM) {');
  const iFormCall: number = ls_src.indexOf('this.SubFormCard()');
  ok('SubFormCard 只在 form 页被调用（不在列表页）', iFormBranch >= 0 && iFormCall > iFormBranch);
  // 表单仍在页面 Scroll 内（vertical_scroll_height §D 的既有判据不能被本次重写破坏）
  const iScroll: number = ls_src.indexOf('Scroll() {', iFormBranch);
  ok('form 页的 Scroll 在 SubFormCard 之前（表单可滚）', iScroll >= 0 && iFormCall > iScroll);
}

// ── §3 详情页 = 凭据 + 模型 + 默认 + 删除（web 的 detail drawer 功能面）─────────
console.log('\n▶ §3 详情页功能面');
{
  ok('详情页渲染 API Key（掩码只读）', at('API Key ${this.detailRow().api_key') >= 0);
  ok('详情页有「添加模型」入口', at("label: this.addModelOpen ? '收起' : '添加模型'") >= 0);
  ok('详情页有「设为默认」', at("? i18nT('当前默认') : i18nT('设为默认')") >= 0);
  ok('详情页有「删除订阅」（两步确认）', at("this.deleteId === this.detailId ? '确认删除' : '删除订阅'") >= 0);
  ok('详情页有「编辑」入口（打开表单）', at("label: i18nT('编辑')") >= 0 && at('this.openEdit(s);') >= 0);
  ok('系统订阅隐藏编辑/删除', at('isSystemSubscription(this.detailRow())') >= 0);
  ok('模型行「⋯」行内菜单（配置/启停/删除）', at('this.modelMenuKey === this.modelKey(this.detailId, e.model)') >= 0);
  ok('逐模型配置失败时禁止进入（预填闸门）', at('if (prefill === null || !this.pmPrefillOk) {') >= 0);
  ok('详情页空态（订阅被删后不崩）',
    at('Text(this.missingSubText())') >= 0 && at('private missingSubText(): string {') >= 0);
}

// ── §4 列表页 = 推理 + 档位 + 订阅（web 三段结构，搜索/导入导出齐全）────────────
console.log('\n▶ §4 列表页功能面（对齐 web）');
{
  ok('思考模式四档分段控件', at('ForEach(THINK_OPTIONS') >= 0 && at('thinkLabel(mode)') >= 0);
  ok('思考模式写专用 RPC', at('RpcMethod.setUserThinkingMode') >= 0);
  ok('最大并发步进器 ±', at('concurrencyStep(this.concurrency, -1)') >= 0
    && at('concurrencyStep(this.concurrency, 1)') >= 0);
  ok('三档模型（TIERS）可点进挑选页', at('ForEach(TIERS, (tier: string) =>') >= 0 && at('this.openTier(tier);') >= 0);
  ok('档位页写 set_setting', at('RpcMethod.setSetting') >= 0 && at('tierKey(tier)') >= 0);
  ok('档位页可清除（空值语义）', at('void this.clearTier(this.pickTier);') >= 0);
  ok('订阅搜索框', at("placeholder: i18nT('搜索订阅 / 模型')") >= 0);
  ok('刷新模型', at('RpcMethod.refreshModelEntries') >= 0);
  ok('导入', at('RPC_IMPORT_SUBSCRIPTIONS') >= 0);
  ok('导出', at('RPC_EXPORT_SUBSCRIPTIONS') >= 0);
  ok('新增订阅是主按钮', at("label: '新增订阅',\n            kind: 'primary'") >= 0);
  ok('次级操作默认收起（更多 ▾）', at('this.moreOpen = !this.moreOpen;') >= 0);
  // 死按钮判据：订阅卡「设为默认」必须接线
  ok('订阅卡 onSetDefault 已接线', at('onSetDefault: (subId: string) => {') >= 0
    && at('void this.makeDefault(subId);') >= 0);
  ok('订阅卡不再整卡吞点击（避免与开关抢手势）',
    at('// ⛔ 导航**不复用整卡点击**') >= 0 && at("i18nT('管理')") >= 0);
  ok('空态有指引文案', at("i18nT('还没有任何订阅。')") >= 0);
}

// ── §5 结构与可达性纪律 ───────────────────────────────────────────────────────
console.log('\n▶ §5 结构纪律');
{
  // 无参 @Builder：带参 @Builder 的子树不随参数重建（本仓既有铁律）
  const paramBuilder = /@Builder\s*\n\s*\w+\([^)]*[^\s)]/;
  ok('没有带参 @Builder', !paramBuilder.test(ls_src));
  // 表单保存/取消在字段之前（键盘不挡）
  const iSave: number = at("label: this.formBusy ? '保存中…' : '保存'");
  const iFirstField: number = at("label: i18nT('名称'), description: ''");
  ok('表单操作栏在第一个输入字段之前', iSave >= 0 && iFirstField > iSave, `save@${iSave} field@${iFirstField}`);
  ok('表单取消在字段之前', at("label: '取消',") > 0 && at("label: '取消',") < iFirstField);
  // 命中区
  ok('返回按钮命中区 ≥ HIT_TARGET_MIN', at('.width(HIT_TARGET_MIN)') >= 0);
  ok('行级点击目标 ≥ HIT_TARGET_MIN', (ls_src.match(/constraintSize\(\{ minHeight: HIT_TARGET_MIN \}\)/g) || []).length >= 4);
  // ForEach key 含状态（否则复用旧子树）
  ok('订阅 key 含默认/启用状态', at("`sub|${s.id}|${s.active === true ? 'd' : '-'}") >= 0);
  ok('模型 key 含状态与菜单位', at('`dm|${this.detailId}|${e.model}|${e.status') >= 0);
  // 不残留对已删辅助的引用
  ok('不再有 as SubscriptionRow 强转（改用 detailRow() 空壳）', at('as SubscriptionRow)') < 0);
}

console.log(`\n=== llm_settings_console: ${ls_pass} 通过 / ${ls_fail} 失败 ===`);
if (ls_fail > 0) {
  process.exit(1);
}

// ⛔ 必须让本文件是**模块**（`scripts` 全局作用域会与其它测试的 `declare const process/require`
//    互撞：run-all 把全部测试编进**同一个** program ⇒ TS2451 Cannot redeclare block-scoped variable）。
export {};

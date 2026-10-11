/**
 * token_migration.test.ts —— 用户气泡 / 目标横幅的**等值令牌迁移**机器判据。
 *
 * 目的（本单核心）：把"观感不变"从"人肉看截图"变成**机器可证** —— 断言
 * 「每个被替换的位置，**设计令牌的取值 == 迁移前的字面量/原值**」。
 * 值相等 ⇒ 屏幕上不可能有任何变化；一旦有人改了令牌值或把映射接错 ⇒ 本文件红。
 *
 * 覆盖（只列**值相等**因而被替换者；值不等/缺 token 的见交付清单，**故意不在此**）：
 *   UserBubble.ets：`fontSize(15)`→`type.body`；`BUBBLE.userPadX/Y`→`INSET_BUBBLE_X/Y`；
 *                   `BUBBLE.userRadiusAll`→`RADIUS_BUBBLE`；`BUBBLE.rowPadY`→`GAP_ROW_Y`。
 *   GoalBanner.ets：`BADGE_FS(10)`→`type.micro`；徽标 y 内距 `2`→`INSET_CHIP_Y`；
 *                   `FS_CAPTION(12)`→`type.caption`（目标/编辑文字）；图标 `12`→`type.caption`；
 *                   `Row.space SP_2(8)`→`SPACE_XS`。
 *
 * ── 判别力自证（mutation，各自必红）─────────────────────────────────────────────
 *   M1 把某行的令牌换成**不等值**的（如 `INSET_BUBBLE_X`→`INSET_CARD_X`=12）⇒ 该行 "==" 断言红；
 *   M2 把源码改回旧值（如 `INSET_BUBBLE_X`→`BUBBLE.userPadX`）⇒ 源码守卫红（在副本上实测）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import {
  GAP_ROW_Y, INSET_BUBBLE_X, INSET_BUBBLE_Y, INSET_CHIP_Y, RADIUS_BUBBLE, SPACE_XS,
  TYPE_CHIP, TYPE_GOAL, typeOf,
} from '../../entry/src/main/ets/core/design';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

function readSrc(rel: string): string {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..', '..', '..');   // <repo>/tools/tests/.out-one.$$/js → 4 级
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}
/** 剥注释再判源码（注释里出现旧 token 名不算违规）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** 一行迁移：`位置 → 旧值 → 令牌取值`。 */
class Row {
  file: string;
  site: string;
  old: number;
  tok: number;
  constructor(file: string, site: string, old: number, tok: number) {
    this.file = file;
    this.site = site;
    this.old = old;
    this.tok = tok;
  }
}

console.log('\n▶ 等值令牌迁移（令牌值 == 迁移前旧值 ⇒ 观感不变可证）');

const UB: string = 'entry/src/main/ets/components/UserBubble.ets';
const GB: string = 'entry/src/main/ets/components/GoalBanner.ets';

// ── Part 1：表驱动「旧值 == 令牌值」（本单核心断言）──────────────────────────────
const ROWS: Row[] = [
  new Row(UB, '正文字号 type.body', 15, typeOf('type.body').size),
  new Row(UB, '气泡内距 X INSET_BUBBLE_X', 14, INSET_BUBBLE_X),
  new Row(UB, '气泡内距 Y INSET_BUBBLE_Y', 8, INSET_BUBBLE_Y),
  new Row(UB, '气泡四角 RADIUS_BUBBLE', 16, RADIUS_BUBBLE),
  new Row(UB, '消息行带垂直间距 GAP_ROW_Y', 6, GAP_ROW_Y),
  new Row(GB, '徽标字号 type.micro', 10, typeOf(TYPE_CHIP).size),
  new Row(GB, '徽标垂直内距 INSET_CHIP_Y', 2, INSET_CHIP_Y),
  new Row(GB, '目标/编辑文字字号 type.caption', 12, typeOf(TYPE_GOAL).size),
  new Row(GB, '编辑/清除图标字号 type.caption', 12, typeOf('type.caption').size),
  new Row(GB, '带内行间距 SPACE_XS', 8, SPACE_XS),
];
for (let i = 0; i < ROWS.length; i++) {
  const r: Row = ROWS[i];
  ok(`${r.file.replace('.ets', '')} · ${r.site}：旧值 ${r.old} == 令牌值 ${r.tok}`, r.old === r.tok);
}

// ── Part 2：源码守卫（真的接了令牌 / 旧值已消失）───────────────────────────────
const ub: string = stripComments(readSrc(UB));
const gb: string = stripComments(readSrc(GB));

// UserBubble：接了 5 个令牌；4 个旧来源已消失
ok('UserBubble 接 typeOf(type.body)', ub.includes("typeOf('type.body')"));
ok('UserBubble 接 INSET_BUBBLE_X/Y', ub.includes('INSET_BUBBLE_X') && ub.includes('INSET_BUBBLE_Y'));
ok('UserBubble 接 RADIUS_BUBBLE', ub.includes('RADIUS_BUBBLE'));
ok('UserBubble 接 GAP_ROW_Y', ub.includes('GAP_ROW_Y'));
ok('UserBubble 不再有 fontSize(15)', !ub.includes('fontSize(15)'));
ok('UserBubble 不再有 BUBBLE.userPadX/userPadY',
  !ub.includes('BUBBLE.userPadX') && !ub.includes('BUBBLE.userPadY'));
ok('UserBubble 不再有 BUBBLE.userRadiusAll', !ub.includes('BUBBLE.userRadiusAll'));
ok('UserBubble 不再有 BUBBLE.rowPadY', !ub.includes('BUBBLE.rowPadY'));
// ⛔ 仍保留（值不等/缺 token，见交付清单）：right-bottom 圆角 / maxWidth / 助手外框水平内距
ok('UserBubble 仍保留 BUBBLE.userRadiusBR（值不等，待裁决）', ub.includes('BUBBLE.userRadiusBR'));
ok('UserBubble 仍保留 BUBBLE.userMaxWidthPct（缺 token）', ub.includes('BUBBLE.userMaxWidthPct'));

// GoalBanner：接了 4 类令牌；旧常量/字面量已消失
ok('GoalBanner 接 typeOf(TYPE_CHIP)', gb.includes('typeOf(TYPE_CHIP)'));
ok('GoalBanner 接 typeOf(TYPE_GOAL)', gb.includes('typeOf(TYPE_GOAL)'));
ok('GoalBanner 接 INSET_CHIP_Y', gb.includes('INSET_CHIP_Y'));
ok('GoalBanner 接 SPACE_XS', gb.includes('SPACE_XS'));
ok('GoalBanner 不再有 BADGE_FS 常量', !gb.includes('BADGE_FS'));
ok('GoalBanner 不再有 FS_CAPTION', !gb.includes('FS_CAPTION'));
ok('GoalBanner 不再有裸 fontSize(12)', !gb.includes('fontSize(12)'));
// ⛔ 仍保留（值不等/缺 token）：PAD_X/PAD_Y=10/6、ICON=14、卡片/徽标圆角
ok('GoalBanner 仍保留 PAD_X/PAD_Y（值不等，待裁决）', gb.includes('PAD_X') && gb.includes('PAD_Y'));
ok('GoalBanner 仍保留 ICON（缺 token）', gb.includes('ICON'));

console.log(`\n  token_migration: ${pass} passed, ${fail} failed`);
if (fail > 0) { process.exit(1); }
process.exit(0);

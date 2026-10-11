/**
 * panels2_visual —— 三个「从未被设计过」的面（`SubAgentTree` / `MessageNav` / `AuthImage`）
 * 的 **设计系统合规契约**（波：把它们从旧语言（原始尺度 token + `pal()` 直读）迁进
 * `core/design.ets` 的语义层：`type.*` 排版角色 + `INSET_*`/`RADIUS_*`/`HIT_TARGET_MIN`
 * + `colorOf`/`surfaceFillOf`/`hairlineOf`）。
 *
 * 为什么读**真实源码**：`tools/tests/run.sh` 只把 `core/**` 当纯 TS 编译，`components/**`
 * 不进这套 harness（无法 import）。本仓既有先例：`minsav_polish` / `moment_polish` /
 * `inflight_language.test.ts` 同法读源码做形态断言。
 *
 * ── 判据分两层 ──────────────────────────────────────────────────────────────
 *   A. **行为判据**（真函数跑）：组件里出现的每个 `colorOf(p,'role')` 的 role 必须被
 *      `core/design.colorOf` **认得**（非法 role 会被静默解析成 `transparent` ⇒ 文字不可见，
 *      编译期不报 —— 这正是 §12 要防的"幽灵 role"）。`surfaceFillOf` 的 role 必须 ∈ `surfaceRoles()`。
 *   B. **形态判据**（源码字面量）：三面都必须真的接了语义层、无颜色字面量、状态齐全。
 *
 * ⚠️ 判别力自证（改错必红）：
 *   · 把某处 `colorOf(p, 'textPrimary')` 写成 `colorOf(p, 'text.primary')` ⇒ A 组红（未知 role）；
 *   · 把 `surfaceFillOf(p, SURFACE_CARD)` 写成 `surfaceFillOf(p, 'card')` ⇒ A 组红（非 surface role）；
 *   · 任一文件里写一个 `#RRGGBB` ⇒ B 组"无颜色字面量"红；
 *   · 把 AuthImage 的加载/失败态删掉 ⇒ B 组"状态齐全"红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑，不退出会挂住整个套件）。
 * ⚠️ `export {}` 让本文件成为 **module**（顶层 declare 收进模块作用域，避免与兄弟测试撞名）。
 */
declare const process: { exit: (c: number) => void };
declare function require(m: 'fs'): { readFileSync(p: string, e: string): string };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;

import { colorOf, surfaceRoles } from '../../entry/src/main/ets/core/design';
import { paletteOf } from '../../entry/src/main/ets/core/theme';

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
const COMP = pathMod.join(repoRoot, 'entry', 'src', 'main', 'ets', 'components');
const treeSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'SubAgentTree.ets'), 'utf-8');
const navSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'MessageNav.ets'), 'utf-8');
const imgSrc: string = fsMod.readFileSync(pathMod.join(COMP, 'AuthImage.ets'), 'utf-8');

const PAL = paletteOf('dark');

/** 抽取某工厂函数调用里的 role 字面量：`fn(<expr...>, 'role')`（首参可能含 `this.pal()`）。 */
function rolesIn(src: string, fn: string): string[] {
  const out: string[] = [];
  const re = new RegExp(fn + "\\(.*?,\\s*'([^']+)'", 'g');
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

/** 该文件里的 role 字面量**全部合法**（colorOf 认得 / surfaceFillOf 有定义）。 */
function rolesLegal(name: string, src: string): void {
  const cr: string[] = rolesIn(src, 'colorOf');
  for (let i = 0; i < cr.length; i++) {
    ok(`${name}: colorOf role '${cr[i]}' 合法（非则静默 transparent ⇒ 不可见）`,
      colorOf(PAL, cr[i]) !== PAL.transparent);
  }
  const srs: string[] = surfaceRoles().map((r) => r.name);
  const sr: string[] = rolesIn(src, 'surfaceFillOf');
  for (let i = 0; i < sr.length; i++) {
    ok(`${name}: surfaceFillOf role '${sr[i]}' ∈ surfaceRoles()`, srs.indexOf(sr[i]) >= 0);
  }
  ok(`${name}: 至少用了 1 处 colorOf（真接语义层，非仅 import）`, cr.length > 0);
}

// ════════════════════════════════════════════════════════════════════════════
// A/B. 三面公共契约
// ════════════════════════════════════════════════════════════════════════════
const names: string[] = ['SubAgentTree', 'MessageNav', 'AuthImage'];
const srcs: string[] = [treeSrc, navSrc, imgSrc];
for (let i = 0; i < names.length; i++) {
  const n: string = names[i];
  const s: string = srcs[i];
  has(s, "from '../core/design'", `${n}: 接入 core/design 语义层`);
  ok(`${n}: 无颜色字面量（禁硬编码 hex）`, !/#[0-9a-fA-F]{3,8}\b/.test(s));
  rolesLegal(n, s);
}

// ════════════════════════════════════════════════════════════════════════════
// AuthImage.ets —— 迁移 + 状态齐全（加载 / 失败·重试 都有解释，§F1）
// ════════════════════════════════════════════════════════════════════════════
has(imgSrc, 'surfaceFillOf(this.pal(), SURFACE_CHIP)', 'AuthImage: 图片/骨架垫底走语义面 surface.chip');
has(imgSrc, 'hairlineOf(this.pal())', 'AuthImage: 失败卡边界走结构性发丝 hairlineOf（唯一出口）');
has(imgSrc, 'colorOf(this.pal(), \'accentSoft\')', 'AuthImage: 可点文案走 accentSoft 语义角色');
has(imgSrc, "fs('type.caption')", 'AuthImage: 文案字号走 type.caption 角色（不再写 11/12）');
has(imgSrc, 'HIT_TARGET_MIN', 'AuthImage: 可点态命中区 ≥ HIT_TARGET_MIN');
has(imgSrc, '图片加载中', 'AuthImage: 有加载态文案');
has(imgSrc, '图片加载失败', 'AuthImage: 有失败态文案（点按重试）');
hasNot(imgSrc, 'surfacesOf(', 'AuthImage: 不再直接 surfacesOf（走 hairlineOf 唯一出口）');

// ════════════════════════════════════════════════════════════════════════════
// SubAgentTree.ets —— 迁移 + 消费状态唯一真源（judgment/render 同源）
// ════════════════════════════════════════════════════════════════════════════
has(treeSrc, 'subagentVisual(this.kind)', 'SubAgentTree: 消费 subagentVisual（状态唯一真源）');
has(treeSrc, 'roleColorOf(v.toneRole, this.pal())', 'SubAgentTree: 竖条色走 roleColorOf（单一判据）');
has(treeSrc, 'roleColorOf(this.vis().iconRole, this.pal())', 'SubAgentTree: 图标色走 roleColorOf');
has(treeSrc, 'roleColorOf(this.vis().labelRole, this.pal())', 'SubAgentTree: 标签色走 roleColorOf');
has(treeSrc, 'surfaceFillOf(this.pal(), SURFACE_CARD)', 'SubAgentTree: 卡片底走语义面 surface.card');
has(treeSrc, 'colorOf(this.pal(), \'textMuted\')', 'SubAgentTree: 描述文字走 textMuted 角色');
has(treeSrc, "fs('type.subhead')", 'SubAgentTree: 标签走 type.subhead（列表标题档 13/500）');
has(treeSrc, "fs('type.caption')", 'SubAgentTree: 描述走 type.caption');
has(treeSrc, 'HIT_TARGET_MIN', 'SubAgentTree: 行命中区 ≥ HIT_TARGET_MIN');
hasNot(treeSrc, 'FS_CAPTION', 'SubAgentTree: 不再用原始刻度 FS_CAPTION');
hasNot(treeSrc, 'CARD_PAD', 'SubAgentTree: 卡片内距改走 INSET_ROW_*（旧 CARD_PAD_* 已移除）');

// ════════════════════════════════════════════════════════════════════════════
// MessageNav.ets —— 迁移（保留"静息无边框"契约）+ 不放松既有 pin
// ════════════════════════════════════════════════════════════════════════════
has(navSrc, 'RADIUS_CHIP', 'MessageNav: 圆角走 RADIUS_CHIP（语义档，非 R_MD 原始刻度）');
has(navSrc, "colorOf(this.pal(), 'textPrimary')", 'MessageNav: 用户消息文字走 textPrimary 角色');
has(navSrc, "colorOf(this.pal(), 'textMuted')", 'MessageNav: 摘要文字走 textMuted 角色');
has(navSrc, "fs('type.caption')", 'MessageNav: 正文字号走 type.caption 角色');
has(navSrc, "fs('type.micro')", 'MessageNav: 序号/摘要字号走 type.micro 角色');
has(navSrc, 'HIT_TARGET_MIN', 'MessageNav: 条目命中区 ≥ HIT_TARGET_MIN');
hasNot(navSrc, 'FS_CAPTION', 'MessageNav: 不再用原始刻度 FS_CAPTION');
hasNot(navSrc, 'FS_MICRO', 'MessageNav: 不再自持 FS_MICRO 字面量');
// 回归护栏（与 minimal_chrome / msgnav_polish 同源，独立复核）：静息**无 1px 全边框**。
hasNot(navSrc, 'BTN_BORDER_ALPHA', 'MessageNav: 仍无"遗留方框"（描边常量不复现）');
hasNot(navSrc, "withAlpha(this.pal().border, BTN_BORDER_ALPHA)", 'MessageNav: 仍无 1px 全边框（回退即红）');
has(navSrc, 'const BTN_IDLE_ALPHA: number = 0.4;', 'MessageNav: 静息低存在感（web opacity-40）');

if (fail > 0) {
  console.log(`  panels2_visual: ${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`  panels2_visual: ${pass} passed, 0 failed`);
process.exit(0);

export {};

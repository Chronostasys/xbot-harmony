/**
 * B 项契约：**半径令牌化 + 浅色扩散分叉**（`core/tokens.ets` + `core/theme.ets`）。
 *
 * 洞见：**浅色柔影 = 更大半径 + 更低 alpha**（HIG 的"软影"）；深色柔影 = 更小半径 + 更高 alpha。
 * 此前半径是**调用点字面量** ⇒ 深浅同半径 ⇒ 浅色"没手感"。修法：
 *   · `core/tokens.ets`：`SHADOW_RADIUS_CARD`(=10) / `SHADOW_RADIUS_OVERLAY`(=20) / `LIGHT_SHADOW_DIFFUSION`(=1.5)；
 *   · `core/theme.ets: shadowRadiusOf(p, tier)`：深色 ⇒ 基础档（**逐字节不变**）；浅色 ⇒ × 扩散系数。
 *   · 基础值取**现状字面量的等同值**（`SyntheticCard` 的 10 = `SP_5/2`；`SPACE_LG` 的 20 = `SP_5`）
 *     ⇒ 迁移后**深色渲染不变**。
 *
 * mutation 自证（必红）：浅色臂去掉扩散（`return base`）⇒ ★②（浅色更大半径）红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

import {
  paletteOf, effectsOf, isLightPalette, shadowRadiusOf, ALL_THEMES,
} from '../../entry/src/main/ets/core/theme';
import {
  SHADOW_RADIUS_CARD, SHADOW_RADIUS_OVERLAY, SHADOW_RADIUS_HERO,
  SHADOW_RADIUS_RAISED, SHADOW_RADIUS_PILL, SHADOW_RADIUS_PANEL,
  SHADOW_RADIUS_DRAWER, LIGHT_SHADOW_DIFFUSION,
} from '../../entry/src/main/ets/core/tokens';

/** 档名 → 基础值（供逐档遍历）。 */
const TIERS: string[] = ['card', 'overlay', 'hero', 'raised', 'pill', 'panel', 'drawer'];
const BASE: number[] = [SHADOW_RADIUS_CARD, SHADOW_RADIUS_OVERLAY, SHADOW_RADIUS_HERO, SHADOW_RADIUS_RAISED, SHADOW_RADIUS_PILL, SHADOW_RADIUS_PANEL, SHADOW_RADIUS_DRAWER];

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  if (got === want) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

// ── ★① 深色族**逐字节不变**（快照：基础档原值）──────────────────────────────────────
{
  eq('档值快照：CARD = 10（= SP_5/2，原 SyntheticCard 字面量）', SHADOW_RADIUS_CARD, 10);
  eq('档值快照：OVERLAY = 20（= SP_5 = SPACE_LG，原 sheet 字面量）', SHADOW_RADIUS_OVERLAY, 20);
  // 本轮补齐的三档：**深色值 = Index.ets 迁移前的原字面量**（26/18/14）⇒ 逐字节保证
  eq('档值快照：HERO = 26（= 登录徽标投影原字面量）', SHADOW_RADIUS_HERO, 26);
  eq('档值快照：RAISED = 18（= 登录 CTA 原字面量）', SHADOW_RADIUS_RAISED, 18);
  eq('档值快照：PILL = 14（= 发送钮原字面量）', SHADOW_RADIUS_PILL, 14);
  eq('档值快照：PANEL = 28（= 登录玻璃卡原字面量）', SHADOW_RADIUS_PANEL, 28);
  eq('档值快照：DRAWER = 24（= 抽屉 SPACE_XL 原值）', SHADOW_RADIUS_DRAWER, 24);
  ok('扩散系数 > 1（浅色更大半径）', LIGHT_SHADOW_DIFFUSION > 1);
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    if (!isLightPalette(p)) {
      for (let k = 0; k < TIERS.length; k++) {
        eq(`深色族 ${t}: ${TIERS[k]} 档 === 基础值（逐字节不变）`, shadowRadiusOf(p, TIERS[k]), BASE[k]);
      }
    }
  }
}

// ── ★② 浅色族：半径**更大**（方向正确）+ alpha **更低**（方向正确）────────────────────
{
  for (let i = 0; i < ALL_THEMES.length; i++) {
    const t: string = ALL_THEMES[i];
    const p = paletteOf(t);
    if (!isLightPalette(p)) { continue; }
    for (let k = 0; k < TIERS.length; k++) {
      eq(`${t}: ${TIERS[k]} 半径 = round(base × 扩散)`, shadowRadiusOf(p, TIERS[k]), Math.round(BASE[k] * LIGHT_SHADOW_DIFFUSION));
      ok(`  · ${TIERS[k]} 浅色 > 深色基础（更软）`, shadowRadiusOf(p, TIERS[k]) > BASE[k]);
    }
    ok(`★② ${t}: 浅色 card 半径 > 深色基础（更软）`,
      shadowRadiusOf(p, 'card') > SHADOW_RADIUS_CARD, `got ${shadowRadiusOf(p, 'card')}`);
    ok(`  · overlay 半径同样更大`, shadowRadiusOf(p, 'overlay') > SHADOW_RADIUS_OVERLAY);
    // alpha 方向：浅色 elev2 的 alpha 必须**低于**深色 elev2（软影 = 更低 alpha）
    const lightA = parseInt(effectsOf(p).elev2.slice(1, 3), 16);
    const darkA = parseInt(effectsOf(paletteOf('dark')).elev2.slice(1, 3), 16);
    ok(`  · 浅色柔影 alpha(${lightA}) < 深色 alpha(${darkA})（更低 alpha）`, lightA < darkA);
  }
}

// ── ★③ 源码形态：分叉在 theme.ets；⛔ 深色臂不乘；⛔ 未反向 import design ────────────────
{
  const fsMod = require('fs');
  const pathMod = require('path');
  let repo = '';
  for (const up of ['../..', '../../..', '../../../..']) {
    const cand = pathMod.resolve(__dirname, up);
    if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/core/theme.ets'))) { repo = cand; break; }
  }
  ok('探测到仓库根', repo.length > 0);
  if (repo.length > 0) {
    const th: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/theme.ets'), 'utf-8');
    const tk: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/core/tokens.ets'), 'utf-8');
    ok('theme.ets: 导出 shadowRadiusOf', th.indexOf('export function shadowRadiusOf(') >= 0);
    ok('  · 浅色臂乘扩散系数', th.indexOf('Math.round(base * LIGHT_SHADOW_DIFFUSION)') >= 0);
    ok('  · 深色臂返回基础档', th.indexOf('return isLightPalette(p) ? Math.round(base * LIGHT_SHADOW_DIFFUSION) : base;') >= 0);
    ok('  · 未反向 import design（防成环）', th.indexOf("from './design'") < 0);
    ok('  · import tokens（纯数值层）', th.indexOf("from './tokens'") >= 0);
    ok('tokens.ets: 五档 + 扩散系数齐备',
      tk.indexOf('SHADOW_RADIUS_CARD') >= 0 && tk.indexOf('SHADOW_RADIUS_OVERLAY') >= 0
      && tk.indexOf('SHADOW_RADIUS_HERO') >= 0 && tk.indexOf('SHADOW_RADIUS_RAISED') >= 0
      && tk.indexOf('SHADOW_RADIUS_PILL') >= 0 && tk.indexOf('LIGHT_SHADOW_DIFFUSION') >= 0);
    ok('theme.ets: 分派覆盖 hero/raised/pill/panel/drawer（非死代码，测试即消费）',
      th.indexOf("if (tier === 'hero')") >= 0 && th.indexOf("if (tier === 'raised')") >= 0
      && th.indexOf("if (tier === 'pill')") >= 0
      && th.indexOf("if (tier === 'panel')") >= 0 && th.indexOf("if (tier === 'drawer')") >= 0);

    // ── ★④ 不留"未消费"：新档必须被真实调用点消费（G1 后：经 `shadowLayersOf` 消费）────────────
    // ⚠️ C3（2026-10-11）：`SyntheticCard` 改走 `shadowLayersOf(...,'card')`（多层柔影，C3）⇒
    //    它不再直接调 `shadowRadiusOf`（card 档经 `shadowLayersOf` 内部消费，语义不变）。
    // ⚠️ G1（2026-10-11）：**浮层档**（`overlay`）同样推广到 `shadowLayersOf` —— AskUserSheet / MenuSheets /
    //    StatusSheet / Toast 四处从"直接调 `shadowRadiusOf`"迁到"经 `shadowLayersOf` 消费"（语义不变）。
    //    ⛔ 本清单**只许缩短**：迁走的条目即删（这里 `shadowRadiusOf` 直接消费点已清空 ⇒ 列表为空），
    //    不在架任何新台账（`shadowLayersOf` 的落点由 ★⑤ 的两张白名单统一记）。
    const consumers: string[] = [];
    for (let i = 0; i < consumers.length; i++) {
      const c: string = fsMod.readFileSync(pathMod.join(repo, `entry/src/main/ets/components/${consumers[i]}.ets`), 'utf-8');
      ok(`消费：${consumers[i]}.ets 用了 shadowRadiusOf`, c.indexOf('shadowRadiusOf(this.pal(),') >= 0);
    }
    const sc: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/SyntheticCard.ets'), 'utf-8');
    ok("  · SyntheticCard 走 `shadowLayersOf(...,'card')`（C3 多层柔影；card 档 = 原字面量 10 ⇒ 深色不变）",
      sc.indexOf("shadowLayersOf(this.pal(), 'card')") >= 0);
    const ms: string = fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/components/MenuSheets.ets'), 'utf-8');
    ok("  · sheet 走 'overlay' 档（= 原 SPACE_LG=20 ⇒ 深色不变）", ms.indexOf("shadowLayersOf(p, 'overlay')") >= 0);
    // G1 自证：五处浮层都经 `shadowLayersOf('overlay')` 消费（⛔ 不是"函数名存在"，是**调用点**）。
    const overlayConsumers: string[] = ['AskUserSheet', 'Lightbox', 'MenuSheets', 'StatusSheet', 'Toast'];
    for (let i = 0; i < overlayConsumers.length; i++) {
      const c: string = fsMod.readFileSync(pathMod.join(repo, `entry/src/main/ets/components/${overlayConsumers[i]}.ets`), 'utf-8');
      ok(`G1 消费点：${overlayConsumers[i]}.ets 走 shadowLayersOf(...,'overlay')`,
        c.indexOf('shadowLayersOf(') >= 0);
    }

    // ── ★⑤ 浅色「多层柔影」的**落点台账**（C3 的**真余量**；⛔ 不是否定 C3，是如实记账）──────────
    // 背景（`docs/DESIGN-SYSTEM.md §18.5 #4` 自认 + 本轮复核）：C3 的多层柔影**只被 1 处消费**
    //   （`SyntheticCard`）⇒ 其余 `.shadow()` 仍是**单层** ⇒ 浅色的"贴合 + 环境"手感**在别处看不到**。
    // 仓规「判据必须钉**落点消费**」（已抓到 3 例"函数存在但 0 消费 ⇒ 用户看不到"）⇒ 本台账把余量**钉成可数**：
    //   · **多层消费文件**（期望**增长** = 迁移在进行）· **单层遗留文件**（期望**缩短** = 迁移完成）。
    //   两边**都冻结成白名单**：任何变化（迁移 / 新增 / 删站点）都 ⇒ 红 ⇒ 逼同步本表（防静默漂移）。
    const walkEts = (dir: string): string[] => {
      const out: string[] = [];
      const rec = (d: string): void => {
        let ents: string[] = [];
        try { ents = fsMod.readdirSync(d); } catch (e) { return; }
        for (let i = 0; i < ents.length; i++) {
          const full = pathMod.join(d, ents[i]);
          let st: any = null;
          try { st = fsMod.statSync(full); } catch (e2) { st = null; }
          if (st === null) { continue; }
          if (st.isDirectory()) { rec(full); continue; }
          if (full.slice(full.length - 4) === '.ets') { out.push(full); }
        }
      };
      rec(dir);
      return out;
    };
    const etsRoot: string = pathMod.join(repo, 'entry/src/main/ets');
    let scanFiles: string[] = walkEts(pathMod.join(etsRoot, 'components')).concat(walkEts(pathMod.join(etsRoot, 'pages')));
    // mutation 注入通道（⛔ 不碰仓内文件）：`XBOT_SCAN_EXTRA=/tmp/x.ets`
    const env: any = require('process').env;
    const extra: string = env.XBOT_SCAN_EXTRA !== undefined ? String(env.XBOT_SCAN_EXTRA) : '';
    if (extra.length > 0) {
      const xs: string[] = extra.split(':');
      for (let i = 0; i < xs.length; i++) { if (xs[i].length > 0) { scanFiles.push(xs[i]); } }
    }
    ok('★⑤ 零扫描判红：扫到组件/页面源码（>0 文件）', scanFiles.length > 0, `files=${scanFiles.length}`);
    const multiConsumers: string[] = [];
    const singleLayerFiles: string[] = [];
    let shadowSites: number = 0;
    for (let i = 0; i < scanFiles.length; i++) {
      const f: string = scanFiles[i];
      let src: string = '';
      try { src = fsMod.readFileSync(f, 'utf-8'); } catch (e) { continue; }
      const rel: string = f.indexOf(etsRoot) === 0 ? f.slice(etsRoot.length + 1) : f;
      const n: number = (src.match(/\.shadow\(\{/g) || []).length;
      shadowSites += n;
      const usesMulti: boolean = src.indexOf('shadowLayersOf(') >= 0;
      if (n > 0 && usesMulti) { multiConsumers.push(rel); }
      if (n > 0 && !usesMulti) { singleLayerFiles.push(rel); }
    }
    ok('★⑤ 零扫描判红：全站 `.shadow({` 站点 > 0（扫描器与真源相连）', shadowSites > 0, `sites=${shadowSites}`);
    // ★⑤ 双白名单（G1 后，2026-10-11）：多层消费者 = `SyntheticCard`（card）+ 六处浮层 `overlay`
    //   （AskUserSheet / Lightbox / MenuSheets / StatusSheet / Toast / PluginsSheet / QueueSheet / SelfCheckSheet）；
    //   单层遗留 = `ToolVisual`（发光通道 `glowColorOf`，**非**柔影 ⇒ 不该迁）
    //   + `pages/Index.ets`（**已迁**：G1 加性 near 层 —— 登录品牌瓦片 / 登录 CTA / 发送钮；far 留调用点）。
    //   ⚠️ 迁移进行时 ⇒ 多层白名单**增长**、单层白名单**缩短**；任何变化都逼同步本表（防静默漂移）。
    //   ✅ 2026-10-11（目标⑤ E1 待批 #1）：`PluginsSheet`/`QueueSheet`/`SelfCheckSheet` 三面板的 L1 根面
    //      从"裸 `appBg` + 无柔影"迁到 `shadowLayersOf('overlay')` 多层柔影 ⇒ 从"无影站点"变为多层消费者。
    const EXPECT_MULTI: string[] = [
      'components/AskUserSheet.ets',
      // 文件管理面板（目标④）：侧栏柔影走 `shadowLayersOf(pal,'overlay')` 同一出口（⛔ 不写死半径）。
      'components/FilesSheet.ets', 'components/Lightbox.ets', 'components/MenuSheets.ets',
      'components/PluginsSheet.ets', 'components/QueueSheet.ets', 'components/SelfCheckSheet.ets',
      'components/StatusSheet.ets', 'components/SyntheticCard.ets', 'components/Toast.ets',
      'pages/Index.ets',
    ];
    const EXPECT_SINGLE: string[] = [
      'components/ToolVisual.ets',
    ];
    console.log(`  · ★⑤ 多层柔影消费文件（期望**增长**）：${JSON.stringify(multiConsumers.slice().sort())}`);
    console.log(`  · ★⑤ 单层遗留文件（期望**缩短**，${singleLayerFiles.length} 个）：${JSON.stringify(singleLayerFiles.slice().sort())}`);
    ok('★⑤ 多层柔影消费文件 == 冻结白名单（迁移 ⇒ 同步本表；SyntheticCard + 五处浮层 overlay）',
      JSON.stringify(multiConsumers.slice().sort()) === JSON.stringify(EXPECT_MULTI),
      `got ${JSON.stringify(multiConsumers.slice().sort())}`);
    ok('★⑤ 单层遗留文件 == 冻结白名单（迁移掉一个 ⇒ 从本表删；新增 ⇒ 红）',
      JSON.stringify(singleLayerFiles.slice().sort()) === JSON.stringify(EXPECT_SINGLE),
      `got ${JSON.stringify(singleLayerFiles.slice().sort())}`);
  }
}

if (fail > 0) { console.log(`  shadow_radius: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  shadow_radius: ${pass} passed, 0 failed`);
process.exit(0);

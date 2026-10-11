/**
 * 工具 pill **可辨性门禁**（色盲可用性 + 对比度 + 层级不撞色）—— 设计系统定稿前先立的护栏。
 *
 * 目标（对应 `docs/REDESIGN-INPUT-PILL.md §E`）：任何**新配色/新形态**进来，都要被自动判
 * 「抹掉颜色后仍可辨 6 档」+「每档对比度达标」。四条判据：
 *
 *  ① **色角色覆盖**：6 档用满 `statusColorRole` 声明的**全部 4 个角色**，且这 4 个角色
 *     映射到主题色后**两两不同**（防止 muted 与 accent 撞成同色）。
 *     ⚠️ 6 档 → 4 角色**是设计**（running≡generating 共用 accent、pending≡killed 共用 muted），
 *     "六档两两不同"在色角色层不可能成立 —— 它们的区分由 ② 的（形态, 文案）承担。
 *  ② **无色仍可辨**：把颜色全部抹掉后，`(markerShape(kind), statusChip(kind))` 的 6 组合
 *     **两两不同**；且**形态合并只允许发生在"在飞"同族内部**（running/generating 共用系统
 *     spinner 是刻意的；任何**新增**合并都要报警）。
 *  ③ **对比度**：复用仓内 WCAG 口径（`core/theme` 的 `contrastRatio`，与
 *     `tools/tests/theme_contrast.test.ts` 同一把尺子、同一分级）：
 *      · 名称文字（pill 底上的名称）：正文级 `T_BODY=4.5`；
 *      · chip 文字：**按语义角色分级** —— 有色彩的语义色（danger/success/accent）
 *        `T_SECOND=3.0`；`muted`（排队/终止，仓内既有口径的"最弱一档"）`T_MUTED=2.0`。
 *     深/浅全部 5 套主题都测。
 *  ④ **层级不撞色**：`chipBg ≠ pillBg`（未选中/选中**都**），防"chip 与 pill 同色 ⇒ 消失"复发。
 *
 * ⛔ 判据只来自既有唯一源（`core/toolstatus` / `core/toolvisual`）；本文件**不另写映射表**，
 *    只枚举"6 个语义档"这一**定义域**。
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  ALL_SHAPES, chipBgOf, markerShape, pillBgOf, pillTextColorOf, statusColorOf,
} from '../../entry/src/main/ets/core/toolvisual';
import {
  ROLE_ACCENT, ROLE_DANGER, ROLE_MUTED, ROLE_SUCCESS,
  ST_DONE, ST_ERROR, ST_GENERATING, ST_KILLED, ST_PENDING, ST_RUNNING,
  isLiveStatus, statusChip, statusColorRole,
} from '../../entry/src/main/ets/core/toolstatus';
import { ALL_THEMES, contrastRatio } from '../../entry/src/main/ets/core/theme';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function okMsg(name: string, cond: boolean, detail: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}  （${detail}）`); }
}
function ok(name: string, cond: boolean): void { okMsg(name, cond, ''); }

// WCAG 分级阈值（与 `theme_contrast.test.ts` 同一口径，不另立标准）
const T_BODY: number = 4.5;    // 正文级：名称（承载文字）
const T_SECOND: number = 3.0;  // 语义色文字级：有色彩的 chip（danger/success/accent）
const T_MUTED: number = 2.0;   // 最弱一档：muted chip（排队/终止 —— 仓内既有分级）

/** 定义域：6 个语义档（唯一来源 = `core/toolstatus` 的 ST_*）。 */
const KINDS: string[] = [ST_DONE, ST_RUNNING, ST_GENERATING, ST_PENDING, ST_ERROR, ST_KILLED];
const DECLARED_ROLES: string[] = [ROLE_DANGER, ROLE_SUCCESS, ROLE_MUTED, ROLE_ACCENT];

// ════════════════════════════════════════════════════════════════════════════
// ① 色角色：覆盖 + 4 角色色两两不同
// ════════════════════════════════════════════════════════════════════════════
const rolesOfKinds: string[] = KINDS.map((k: string) => statusColorRole(k));
eq('① 6 档用满全部 4 个色角色', new Set(rolesOfKinds).size, 4);
for (let i = 0; i < DECLARED_ROLES.length; i++) {
  ok(`① 角色 ${DECLARED_ROLES[i]} 被用到`, rolesOfKinds.indexOf(DECLARED_ROLES[i]) >= 0);
}
// 每个角色取一个**代表档**（从 statusColorRole 派生，不是手写映射）
const roleReps: string[] = [];
for (let i = 0; i < KINDS.length; i++) {
  const r: string = statusColorRole(KINDS[i]);
  if (roleReps.map((k: string) => statusColorRole(k)).indexOf(r) < 0) { roleReps.push(KINDS[i]); }
}
eq('① 4 个角色各有代表档', roleReps.length, 4);
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  const cols: string[] = roleReps.map((k: string) => statusColorOf(k, th));
  eq(`① [${th}] 4 个角色色两两不同`, new Set(cols).size, 4);
}

// ════════════════════════════════════════════════════════════════════════════
// ② 无色可辨：(形态, 文案) 六组合两两不同 + 形态合并只在"在飞"族内
// ════════════════════════════════════════════════════════════════════════════
const shapeOf: string[] = KINDS.map((k: string) => markerShape(k));
const chipOf: string[] = KINDS.map((k: string) => statusChip(k, undefined, 0));
// 形态档必须都来自声明的枚举（防止冒出未登记的字符串）
for (let i = 0; i < shapeOf.length; i++) {
  ok(`② 形态档已登记：${shapeOf[i]}`, ALL_SHAPES.indexOf(shapeOf[i]) >= 0);
}
const colorBlindKeys: string[] = [];
for (let i = 0; i < KINDS.length; i++) {
  colorBlindKeys.push(`${shapeOf[i]}\u0000${chipOf[i]}`);
}
eq('② 抹掉颜色后 (形态,文案) 六组合两两不同', new Set(colorBlindKeys).size, 6);
// ②b：形态合并只允许发生在"在飞"同族内部（running/generating 共用 spinner 是刻意的）
let mergedPairs = 0;
for (let i = 0; i < KINDS.length; i++) {
  for (let j = i + 1; j < KINDS.length; j++) {
    if (shapeOf[i] === shapeOf[j]) {
      mergedPairs++;
      okMsg(`②b 形态合并 ${KINDS[i]}/${KINDS[j]} 必须双方都在飞`,
        isLiveStatus(KINDS[i]) && isLiveStatus(KINDS[j]),
        `shape=${shapeOf[i]} live=${isLiveStatus(KINDS[i])}/${isLiveStatus(KINDS[j])}`);
    }
  }
}
ok('②b 形态合并恰有一处（running/generating）', mergedPairs === 1);

// ════════════════════════════════════════════════════════════════════════════
// ③ 对比度：名称（T_BODY）/ chip（按角色分级），5 套主题全测
// ════════════════════════════════════════════════════════════════════════════
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  for (let ki = 0; ki < KINDS.length; ki++) {
    const k: string = KINDS[ki];
    // 名称：pill 底上的名称（承载文字 ⇒ 正文级）
    const nameFg: string = pillTextColorOf(k, th);
    const nameBg: string = pillBgOf(k, false, th);
    const nameRatio: number = contrastRatio(nameFg, nameBg);
    okMsg(`③ [${th}] ${k} 名称对比 ≥ ${T_BODY}`,
      nameRatio >= T_BODY, `${nameFg} on ${nameBg} = ${nameRatio.toFixed(2)}`);

    // chip：按**语义角色**分级
    const chipText: string = chipOf[ki];
    if (chipText.length > 0) {
      const chipFg: string = statusColorOf(k, th);
      const chipBg: string = chipBgOf(k, false, th);
      const tier: number = statusColorRole(k) === ROLE_MUTED ? T_MUTED : T_SECOND;
      const chipRatio: number = contrastRatio(chipFg, chipBg);
      okMsg(`③ [${th}] ${k} chip 对比 ≥ ${tier}`,
        chipRatio >= tier, `"${chipText}" ${chipFg} on ${chipBg} = ${chipRatio.toFixed(2)}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ④ 层级不撞色：chipBg ≠ pillBg（未选中 / 选中，全主题）
// ════════════════════════════════════════════════════════════════════════════
for (let ti = 0; ti < ALL_THEMES.length; ti++) {
  const th: string = ALL_THEMES[ti];
  for (let ki = 0; ki < KINDS.length; ki++) {
    const k: string = KINDS[ki];
    okMsg(`④ [${th}] ${k} 未选中 chipBg ≠ pillBg`,
      chipBgOf(k, false, th) !== pillBgOf(k, false, th),
      `chipBg=${chipBgOf(k, false, th)} pillBg=${pillBgOf(k, false, th)}`);
    okMsg(`④ [${th}] ${k} 选中 chipBg ≠ pillBg（防 chip 消失）`,
      chipBgOf(k, true, th) !== pillBgOf(k, true, th),
      `chipBg=${chipBgOf(k, true, th)} pillBg=${pillBgOf(k, true, th)}`);
  }
  // 未选中 vs 选中 的**层级方向**必须真的不同（选中要提亮/换层）
  ok(`④ [${th}] 选中与未选中的 pill 底不同色`,
    pillBgOf(ST_DONE, true, th) !== pillBgOf(ST_DONE, false, th));
}

console.log(`  tool_legibility: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

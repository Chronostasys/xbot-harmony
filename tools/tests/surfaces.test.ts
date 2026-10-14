/**
 * 判据：能力面承载判定表（`core/surfaces.surfaceOf`）—— 「一个页面只有一个形态」的机器判据。
 *
 * 用户定向（2026-10-16）：「如果有原生就不要搞 web…一个页面必须只有一个形态，别入口不同展示的不同」。
 * 判别力（mutation 自证）：把 `files`/`tasks`/`terminal` 任一改回 `web` ⇒ 本判据必红。
 */
declare const process: { exit: (c: number) => void };

import {
  isNativeSurface, SURFACE_NATIVE, SURFACE_WEB, SURF_FILES, SURF_GENUI, SURF_PLUGINS,
  SURF_TASKS, SURF_TERMINAL, SURF_WEBUI, surfaceOf,
} from '../../entry/src/main/ets/core/surfaces';

let passed: number = 0;
let failed: number = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g: string = JSON.stringify(got);
  const w: string = JSON.stringify(want);
  if (g === w) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

// ── 已有原生实现 ⇒ 一律原生（⛔ 任何入口都不得再开 web 面板）──────────────────────────
eq('文件 = 原生（原生面板更全：搜/预览/加入聊天）', surfaceOf(SURF_FILES), SURFACE_NATIVE);
eq('任务 = 原生（用户定向：统一到原生运行面板）', surfaceOf(SURF_TASKS), SURFACE_NATIVE);
eq('终端 = 原生（用户定向：统一到原生终端）', surfaceOf(SURF_TERMINAL), SURFACE_NATIVE);
eq('isNativeSurface(files) = true', isNativeSurface(SURF_FILES), true);

// ── 本质就是 web 的面 ⇒ web（⛔ 不许强行原生化）────────────────────────────────────
eq('插件目录 = web（插件本体就是 web）', surfaceOf(SURF_PLUGINS), SURFACE_WEB);
eq('GenUI 面板 = web（LLM 生成的 TSX 原生不执行）', surfaceOf(SURF_GENUI), SURFACE_WEB);
eq('完整 Web UI = web（调试/fallback 逃生舱）', surfaceOf(SURF_WEBUI), SURFACE_WEB);

// ── 白绿防线：未知 id 必须落到 web（fail-safe），且不得被误判成 native ────────────────
eq('未知 id ⇒ web（fail-safe，不凭空发明原生路径）', surfaceOf('no-such-surface'), SURFACE_WEB);
eq('未知 id 的 isNativeSurface = false', isNativeSurface('no-such-surface'), false);
eq('空串 ⇒ web', surfaceOf(''), SURFACE_WEB);

// ⭐ mutation 自证：判据本体对"混合"有判别力（不是恒真）
eq('mutation：旧式硬编码（files 走 web）会被判红', isNativeSurface(SURF_FILES) === true, true);
eq('mutation：若把 files 改回 web ⇒ isNativeSurface 必为 false（判据有判别力）',
  isNativeSurface('files') !== (surfaceOf(SURF_FILES) === SURFACE_WEB), true);

console.log(`  surfaces: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

// ⛔ 必须导出：聚合 harness 把全部 `.test.ts` 编进同一输出目录，缺它会让全局声明撞名。
export {};

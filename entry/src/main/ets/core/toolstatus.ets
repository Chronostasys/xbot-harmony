/**
 * 工具状态语义 —— **live 块与 committed 块共用的唯一判定**（纯函数 ⇒ 可脱机单测）。
 *
 * 之前两端各写一份 `color/badge/live` 私有方法（MessageRow 与 LiveTailView），
 * 结果 **done 与 executing 的视觉几乎无差别**（用户 2026-10-10 截图："tool done 和
 * tool executing 没区别"）。对齐 web `statusVisual.ts` + `FoldedToolGroup.toolPill`：
 *   · 成功**安静**（描边绿勾、无 chip）；
 *   · 运行/生成中**需要注意力**（分类色脉动点 + 「执行中」/「生成中」chip）；
 *   · 失败**吵闹**（红实心叉 + 「失败」+ exit N）；
 *   · 排队空心灰点「排队」；终止灰虚线「已终止」。
 *
 * ⛔ 一律按 **raw status** 分支（不看 `isToolInProgress` 那种把 pending/generating
 *    也算 running 的粗判据，否则排队/生成中都会显示「执行中」）。
 */

export const ST_DONE: string = 'done';
export const ST_ERROR: string = 'error';
export const ST_RUNNING: string = 'running';
export const ST_PENDING: string = 'pending';
export const ST_KILLED: string = 'killed';

/**
 * raw status（+ 退出码）⇒ 语义状态档。
 *
 * 退出码非 0 ⇒ 即便 status 还是 'running'（流式阶段常见）也判定为失败 —— 与 web
 * `singleStatus` 一致（宁可早报错，也不要"绿点里藏着失败"）。
 */
export function toolStatusKind(status: string | undefined, exitCode: number | undefined): string {
  const raw: string = status !== undefined ? status.toLowerCase() : '';
  if (exitCode !== undefined && exitCode !== 0) { return ST_ERROR; }
  if (raw === 'error') { return ST_ERROR; }
  if (raw === 'killed' || raw === 'aborted' || raw === 'cancelled') { return ST_KILLED; }
  if (raw === 'pending') { return ST_PENDING; }
  if (raw === 'running' || raw === 'executing' || raw === 'generating') { return ST_RUNNING; }
  return ST_DONE;
}

/** 是否"在飞"（运行/生成中）—— 决定加不加扫光/发光与脉动点。 */
export function isLiveStatus(kind: string): boolean {
  return kind === ST_RUNNING;
}

/**
 * 状态 chip 文案（**空串 = 不显示 chip**）。
 *
 * web 只在"需要注意力/出错"时给 chip：成功态**安静无 chip**（几十枚绿 chip 就是噪音）。
 * 生成中带已生成字数（流式反馈，原生端信息更足）。
 */
export function statusChip(kind: string, exitCode: number | undefined,
  genChars: number | undefined): string {
  if (kind === ST_ERROR) {
    return exitCode !== undefined && exitCode !== 0 ? `失败 exit ${exitCode}` : '失败';
  }
  if (kind === ST_KILLED) { return '已终止'; }
  if (kind === ST_PENDING) { return '排队'; }
  if (kind === ST_RUNNING) {
    const n: number = genChars !== undefined ? genChars : 0;
    return n > 0 ? `生成中 ${n} 字` : '执行中';
  }
  return '';
}

/**
 * 工具状态语义 —— **live 块与 committed 块共用的唯一判定**（纯函数 ⇒ 可脱机单测）。
 *
 * ⛔ **本文件是全项目工具状态的唯一判据**。一个工具行的全部信号必须由**同一个
 *    `renderKind(...)` 返回值**驱动：
 *      · 文案     → `statusChip(kind, exitCode, genChars)`
 *      · 是否错误 → `kind === ST_ERROR`
 *      · 语义色   → `statusColorRole(kind)`（渲染层再映射成主题色）
 *      · 是否在飞（扫光/光球）→ `isInFlight(kind, live)`
 *      · 形态（实心/空心/虚线/勾/叉/转圈）→ 由 `kind` 直接分支（`components/ToolVisual.ets`）
 *    **任何组合都不允许出现「文案说排队、颜色/形态说在飞」这种打脸**
 *    （用户 2026-10-11 截文物证：虚线空心的点 + accent 蓝 chip + 「排队」三信号互相矛盾）。
 *
 * ── 权威表（`live` 只影响「是否在飞」，**绝不影响文案/档位/颜色**）──
 *
 * | 块         | raw status                        | 文案                                   | 是否在飞 |
 * |------------|-----------------------------------|----------------------------------------|----------|
 * | **live**   | `pending`                         | **排队**                               | **是**   |
 * | **live**   | `generating`                      | `生成中 N 字` / 缺字数 ⇒ `生成中…`     | 是       |
 * | **live**   | `running`/`executing`             | 执行中                                 | 是       |
 * | **live**   | `error` / exit≠0                  | `失败 exit N` / `失败`                 | 否       |
 * | **live**   | `killed`/`aborted`/`cancelled`    | `已终止`                               | 否       |
 * | **committed** | 严格按服务端终态               | `done`⇒无 chip；`error`⇒失败；`killed`⇒已终止；`pending`⇒排队 | 仅 running/generating |
 *
 * ── 历史沿革（**别再改回去**）──
 * ⛔ **「live 块的 pending ⇒ 执行中」这一"私有改判"已废止**（曾被 `docs/WEB-ALIGNMENT.md §13.3`
 *    依据"服务端整批先建 pending、goroutine 启动才翻 running"提出过，**但用户自己否决并回退过**）：
 *    `components/LiveTailView.ets:171-177` 现行注释即其墓志铭 ——「⛔ 不做任何"私有改判"（**曾试过
 *    把 pending 当执行中，已回退**）……`pending` 就是真的排队，私自改判会让"排队"这一档消失，
 *    反而失真（**用户 2026-10-10 明确要求「以后端数据为准」**）」。
 *    ⇒ **常驻要求：状态一律以后端为准**。客服 10-11 报的两条症状恰好是"丢了后端真相"的**两个方向**：
 *      ① executing 显示排队 = **陈旧 `pending` 快照盖掉新的 `running`/`done`** ⇒ 由 `mergeTools`
 *         的 **rank 终态优先**修（`core/streammerge.ets`）；
 *      ② generating 显示执行中 = **generating 被并进 running 档** ⇒ 由本文件的 **`ST_GENERATING`
 *         独立档** 修。
 *    **两条真因都已修复 ⇒ 无需（也**不许**）再用"私改判"打创可贴**（那会抹掉「排队」这一档）。
 *
 * ⛔ `generating` 必须自成一档 —— 它**任何情况下都不得显示「执行中」**（用户原话第 2 半）。
 * ⛔ 一律按 **raw status** 分支（不看把 pending/generating 也算 running 的粗判据）。
 */

export const ST_DONE: string = 'done';
export const ST_ERROR: string = 'error';
export const ST_RUNNING: string = 'running';
export const ST_PENDING: string = 'pending';
export const ST_GENERATING: string = 'generating';
export const ST_KILLED: string = 'killed';

// ── 语义色角色（**判据**，配色值由渲染层按主题映射）────────────────────────────
export const ROLE_DANGER: string = 'danger';   // 失败
export const ROLE_SUCCESS: string = 'success'; // 成功（安静，仅描边/图标）
export const ROLE_MUTED: string = 'muted';     // 排队 / 终止（安静）
export const ROLE_ACCENT: string = 'accent';   // 执行中 / 生成中（需要注意力）

/**
 * raw status（+ 退出码）⇒ **语义状态档**（唯一判据）。
 *
 * 退出码非 0 ⇒ 即便 status 还是 'running'（流式阶段常见）也判定为失败 —— 与 web
 * `singleStatus` 一致（宁可早报错，也不要"绿点里藏着失败"）。
 *
 * ⚠️ `generating`（工具名已知、参数仍在流式生成）**必须**单独成档：它与
 * `executing`（工具已在真正执行）是**两件事**，web `FoldedToolGroup.tsx:200-210`
 * 把它们映射到不同文案（Generating / Running）。
 *
 * ⚠️ `'failed'` 是 `'error'` 的同义档（`core/panels.ets` 的后台任务用 `'failed'`）——
 * 两种拼写统一判成 `ST_ERROR`，杜绝各处各写一份"是不是错误"。
 */
export function toolStatusKind(status: string | undefined, exitCode: number | undefined): string {
  const raw: string = status !== undefined ? status.toLowerCase() : '';
  // ⛔ 「用户主动终止」必须**抢在 exit_code 之前**判（2026-10-13 修）：
  //    被杀的进程 exit 130（SIGINT）≠ 0 ⇒ 若先问 exit_code 会返回 ST_ERROR 而显示「失败」，
  //    把「用户主动终止」误报成故障。此前 `core/panels.ets` 的 `bgTaskFailed` 靠**调用点预判**
  //    killed 绕过（只护住后台任务一条路径）；但工具 pill / live 尾 / 消息行三条路径
  //    **直接**调 `toolStatusKind`（无预判）⇒ 被杀工具照样被误报「失败」——缺陷藏在单一真源里。
  if (raw === 'killed' || raw === 'aborted' || raw === 'cancelled') { return ST_KILLED; }
  if (raw === 'error' || raw === 'failed') { return ST_ERROR; }
  if (exitCode !== undefined && exitCode !== 0) { return ST_ERROR; }
  if (raw === 'pending') { return ST_PENDING; }
  if (raw === 'generating') { return ST_GENERATING; }
  if (raw === 'running' || raw === 'executing') { return ST_RUNNING; }
  return ST_DONE;
}

/**
 * **渲染档** —— raw status(+exit) ⇒ 语义档。
 *
 * ⛔ **档位一律以后端 `status` 为准**：本函数**不因 `live` 改判**（历史上曾把 live 块的
 *    `pending` 私改判为「执行中」，**已废止** —— 见文件头「历史沿革」）。
 *    `live` 形参**保留**（渲染上下文；调用点/门控断言签名稳定），但**不参与档位判定**；
 *    「在飞」的 live 语义单独由 `isInFlight(kind, live)` 承担。
 */
export function renderKind(status: string | undefined, exitCode: number | undefined,
  live: boolean): string {
  // `live` 形参保留（渲染上下文；调用点/门控断言签名稳定）——**不参与档位判定**（后端为准）。
  return toolStatusKind(status, exitCode);
}

/**
 * 是否**语义上在飞**（运行/生成中）—— 不看 live/committed。
 *
 * ⚠️ generating 与 running **都是**在飞（web 二者都带 sweep 动效与分类色），
 *   只是**文案不同**（「生成中…」vs「执行中」）。
 */
export function isLiveStatus(kind: string): boolean {
  return kind === ST_RUNNING || kind === ST_GENERATING;
}

/**
 * 「工具在飞」—— web `isToolInProgress`（`statusVisual.ts:20-22`）：**含 `pending`**。
 *
 * ⛔ **与 `isLiveStatus` 不同、也不得合并**：`isLiveStatus` 是本仓"在飞视觉（扫光/光球）"的
 *    判据（`pending` 必须**安静** —— 排队档语义，见 `statusColorRole` 的 ⛔ 注）；
 *    本函数只服务**思考领读**那一条（web `reasoningInProgress` 的 `!hasToolInProgress`）：
 *    web 认为"哪怕工具还在排队，机器也已经在干活了" ⇒ 不该把眼睛引到「思考 N 字」上。
 *    合并二者会让"文案说排队、颜色/形态说在飞"的打脸组合回归。
 */
export function isToolInProgress(kind: string): boolean {
  return kind === ST_RUNNING || kind === ST_GENERATING || kind === ST_PENDING;
}

/**
 * 是否**加扫光/光球**（在飞视觉）—— 判据只此一处，**这是 `live` 唯一的作用**。
 *
 * web `LiveIteration`/`FoldedToolGroup.tsx:288`（`executing || tool.streaming === true`）：
 * live 块里的工具**都未完成、仍在流式** ⇒ live 块的**非终态**（`pending` 也算）都在飞；
 * committed 块只有 `running`/`generating` 在飞（历史的 `pending` 极罕见且已定格 ⇒ 安静）。
 *
 * ⛔ 本函数**只影响"是否在飞"**（扫光/光球），**绝不改变文案/档位/颜色**——
 *    否则又会滑向「文案说排队、形态说在飞」的打脸组合。
 *
 * @param live 该 pill 是否渲染在**在飞块**（LiveTailView）里。
 */
export function isInFlight(kind: string, live: boolean): boolean {
  if (kind === ST_DONE || kind === ST_ERROR || kind === ST_KILLED) { return false; }
  return isLiveStatus(kind) || live;
}

/**
 * 语义**色彩角色**（判据）—— 渲染层按主题把 role 映射成具体色值
 * （`components/ToolVisual.ets:statusColorOf`）。纯函数 ⇒ 可脱机断言六档。
 *
 * web `FoldedToolGroup.tsx:211`（statusFg）：failed→destructive；killed/pending→text-muted；
 * 其余（running/generating）→ 分类色（本仓用 accent）。done **成功要安静** ⇒ 用 success
 * （只在图标/描边层出现，名称仍中性色）。
 *
 * ⛔ `pending` ⇒ **muted**（安静），**绝不是 accent**（曾落到 accent ⇒ 颜色说在飞、文案说排队）。
 */
export function statusColorRole(kind: string): string {
  if (kind === ST_ERROR) { return ROLE_DANGER; }
  if (kind === ST_DONE) { return ROLE_SUCCESS; }
  if (kind === ST_KILLED) { return ROLE_MUTED; }
  if (kind === ST_PENDING) { return ROLE_MUTED; }
  return ROLE_ACCENT;   // running / generating
}

/**
 * 状态 chip 文案（**空串 = 不显示 chip**）—— **全项目唯一**的"状态→文案"纯函数。
 *
 * 六档逐条对齐**权威表**（见文件头）：
 *   · `pending` ⇒「排队」（live 与 committed **都是** —— 后端为准，不得私改判）；
 *   · generating 带已生成字数；**缺字数/为 0 ⇒「生成中…」**，**绝不回落「执行中」**；
 *   · running 可带**时长**（原生增强，web 没有）：`elapsedMs>0` ⇒「执行中 1.2s」；
 *     **该参数只影响 running**（generating/error/… 一律不受它影响）；
 *   · error 带退出码「失败 exit N」；
 *   · done 无 chip（成功要安静）。
 *
 * ⚠️ **向后兼容**：`elapsedMs` 可选，**3 参调用 = 旧行为**（`running` ⇒「执行中」，不带时长）。
 */
export function statusChip(kind: string, exitCode: number | undefined,
  genChars: number | undefined, elapsedMs?: number): string {
  if (kind === ST_ERROR) {
    return exitCode !== undefined && exitCode !== 0 ? `失败 exit ${exitCode}` : '失败';
  }
  if (kind === ST_KILLED) { return '已终止'; }
  if (kind === ST_PENDING) { return '排队'; }
  if (kind === ST_GENERATING) {
    const n: number = genChars !== undefined ? genChars : 0;
    return n > 0 ? `生成中 ${n} 字` : '生成中…';
  }
  if (kind === ST_RUNNING) {
    // 时长是**原生增强**（web 无）；只在 running 档生效，**绝不泄漏到 generating**。
    if (elapsedMs !== undefined && elapsedMs > 0) {
      return `执行中 ${(elapsedMs / 1000).toFixed(1)}s`;
    }
    return '执行中';
  }
  return '';
}

/**
 * 工具状态语义 —— **live 块与 committed 块共用的唯一判定**（纯函数 ⇒ 可脱机单测）。
 *
 * ⛔ **本文件是全项目工具状态的唯一判据**。一个工具行的全部信号必须由**同一个
 *    `renderKind(...)` 返回值**驱动：
 *      · 文案     → `statusChip(kind, exitCode, genChars)`
 *      · 是否错误 → `kind === ST_ERROR`
 *      · 语义色   → `statusColorRole(kind)`（渲染层再映射成主题色）
 *      · 是否在飞（扫光/呼吸）→ `isLiveStatus(kind)`
 *      · 形态（实心/空心/虚线/勾/叉/转圈）→ 由 `kind` 直接分支（`components/ToolVisual.ets`）
 *    **任何组合都不允许出现「文案说排队、颜色/形态说在飞」这种打脸**
 *    （用户 2026-10-11 截文物证：虚线空心的点 + accent 蓝 chip + 「排队」三信号互相矛盾）。
 *
 * ── 权威表（`docs/WEB-ALIGNMENT.md §13.3` 的既有裁决，**不是**本波新拍；原注释写反了，已改回）──
 *
 * | 块         | raw status                        | 文案                                   | 是否在飞 |
 * |------------|-----------------------------------|----------------------------------------|----------|
 * | **live**   | `pending`                         | **执行中**（⚠️ **不是**「排队」）       | 是       |
 * | **live**   | `generating`                      | `生成中 N 字` / 缺字数 ⇒ `生成中…`     | 是       |
 * | **live**   | `running`/`executing`             | 执行中                                 | 是       |
 * | **live**   | `error` / exit≠0                  | `失败 exit N` / `失败`                 | 否       |
 * | **live**   | `killed`/`aborted`/`cancelled`    | `已终止`                               | 否       |
 * | **committed** | 严格按服务端终态               | `done`⇒无 chip；`error`⇒失败；`killed`⇒已终止；`pending`⇒排队 | 仅 running/generating |
 *
 * 依据（服务端源码 + 真机）：`agent/engine_run_tools.go:49-64` 把**整批**工具先建为
 * `ToolPending`，随后**每条工具的 goroutine 启动时**才翻 `ToolRunning`（`:150`）——
 * 于是 **live 块里正在执行的工具经常仍是 `pending``（尚未翻档）。若直接映射成「排队」，
 * 用户会以为"还没开始"（用户 2026-10-10 实测：FileReplace 已 done、Shell 正 executing，
 * 两枚都显示「排队」）。live 块里的工具**都是本迭代已派发的（在飞）** ⇒ live 块的
 * `pending` 一律按**执行中**渲染。⇒ **`live?` 必须是判据的显式输入**（见 `renderKind`）。
 *
 * ⚠️ **经批准的有意分歧（divergence）**：web `FoldedToolGroup.tsx:200-210` 把 pending 映射成
 *    `Queued`（排队）—— 这**不适用于本仓的 live 块**（真机 + 服务端源码依据；见上）。
 *    committed 块仍与 web 一致（历史里的 pending 极罕见，语义保守按「排队」）。
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
 * raw status（+ 退出码）⇒ **原始语义档**（不看 live/committed）。
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
  if (exitCode !== undefined && exitCode !== 0) { return ST_ERROR; }
  if (raw === 'error' || raw === 'failed') { return ST_ERROR; }
  if (raw === 'killed' || raw === 'aborted' || raw === 'cancelled') { return ST_KILLED; }
  if (raw === 'pending') { return ST_PENDING; }
  if (raw === 'generating') { return ST_GENERATING; }
  if (raw === 'running' || raw === 'executing') { return ST_RUNNING; }
  return ST_DONE;
}

/**
 * **渲染档** —— 唯一判据（把 `live` 显式纳入）。
 *
 * ⛔ 唯一冲突点（§13.3 裁决）：**live 块**里的 `pending` ⇒ 按 **执行中(`ST_RUNNING`)** 渲染
 *   （服务端已把整批工具派发，只是 goroutine 未翻档 —— 见文件头依据）。committed 块不变。
 *
 * 之后所有派生（文案/颜色/在飞/形态）都只读**本函数返回的 kind** ⇒ 结构上不可能再分叉。
 *
 * @param live 该 pill 是否渲染在**在飞块**（LiveTailView）里。committed/历史块传 `false`。
 */
export function renderKind(status: string | undefined, exitCode: number | undefined,
  live: boolean): string {
  const kind: string = toolStatusKind(status, exitCode);
  if (live && kind === ST_PENDING) { return ST_RUNNING; }
  return kind;
}

/**
 * 是否"在飞"（运行/生成中）—— 决定加不加扫光/发光与脉动点。
 *
 * ⚠️ generating 与 running **都是**在飞（web 二者都带 sweep 动效与分类色），
 *   只是**文案不同**（「生成中…」vs「执行中」）。
 * ⚠️ 传**渲染档**（`renderKind` 的产物）：live 块的 pending 已被归并成 running ⇒ 在飞；
 *   committed 的 pending 仍是 pending ⇒ 不在飞。
 */
export function isLiveStatus(kind: string): boolean {
  return kind === ST_RUNNING || kind === ST_GENERATING;
}

/**
 * 语义**色彩角色**（判据）—— 渲染层按主题把 role 映射成具体色值
 * （`components/ToolVisual.ets:statusColorOf`）。纯函数 ⇒ 可脱机断言六档。
 *
 * web `FoldedToolGroup.tsx:211`（statusFg）：failed→destructive；killed/pending→text-muted；
 * 其余（running/generating）→ 分类色（本仓用 accent）。done **成功要安静** ⇒ 用 success
 * （只在图标/描边层出现，名称仍中性色）。
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
 * 传**渲染档**（`renderKind`）。六档逐条对齐**权威表**（见文件头）：
 *   · live pending → 已被 renderKind 归并成 running ⇒「执行中」；
 *   · generating 带已生成字数；**缺字数/为 0 ⇒「生成中…」**，**绝不回落「执行中」**；
 *   · error 带退出码「失败 exit N」；
 *   · done 无 chip（成功要安静）。
 */
export function statusChip(kind: string, exitCode: number | undefined,
  genChars: number | undefined): string {
  if (kind === ST_ERROR) {
    return exitCode !== undefined && exitCode !== 0 ? `失败 exit ${exitCode}` : '失败';
  }
  if (kind === ST_KILLED) { return '已终止'; }
  if (kind === ST_PENDING) { return '排队'; }
  if (kind === ST_GENERATING) {
    const n: number = genChars !== undefined ? genChars : 0;
    return n > 0 ? `生成中 ${n} 字` : '生成中…';
  }
  if (kind === ST_RUNNING) { return '执行中'; }
  return '';
}

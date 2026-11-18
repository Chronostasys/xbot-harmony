/**
 * **在飞工具并入"最后一块已提交块"的工具流**（跨容器拼行）。
 *
 * ⛔ 用户 2026-10-28：「排版有 bug，第一行只有一个 tool」——根因不是宽度，是**两个容器**：
 *   最后一枚已提交块的 pill 渲染在 `IterBlocksView` 的 Flex 里，紧接着的在飞 pill 渲染在
 *   `LiveTailView` 的另一个 Flex 里 ⇒ 前者那一行必然只剩一枚、右半空着。
 *   ⇒ 当在飞迭代**还没有正文/思考**（`liveText`/`liveReasoning` 都为空）时，它们在视觉上
 *   本来就是同一个"工具流"：把在飞工具**并在同一个 Flex** 里渲染（由已提交块承载），
 *   在飞侧不再重复画自己那一份。
 *
 * 判据：`tools/tests/tool_pill_flow.test.ts`
 *   · 在飞无正文/思考 ⇒ 合并（`merged.length = 已提交 + 在飞`，顺序保持先已提交后在飞）；
 *   · 在飞有正文/思考 ⇒ **不合并**（否则工具会跑到正文前面，顺序错乱）；
 *   · 去重口径 = `同迭代 + 同 call`（跨迭代同 `call_id` 是不同调用，**绝不能**删）。
 */
interface FlowToolLike {
  readonly name: string;
  readonly call_id?: string;
  readonly iteration?: number;
  readonly status?: string;
}

/**
 * 是否「仍在跑」的工具（`running/pending/streaming/queued` 等一切未收尾状态）。
 *
 * ⛔ 用户 2026-10-28：「运行中的工具不会单独一行了」——运行中的工具是**当前焦点**，
 *   必须独占一行、不并入"一行两枚"的网格；只有收尾（done/failed/…）的才参与合并。
 */
/** 内部判据（不导出：唯一消费者是本文件的 `anyRunning`）。 */
function isRunningStatus(status: string | undefined): boolean {
  const s: string = status !== undefined && status !== null ? status : '';
  if (s.length === 0) {
    return false;
  }
  // ⛔ 用户 2026-11-18：「tool 显示『生成 xxx 字』（= generating）时，下方还渲染一条「思考中」」。
  //   根因：本函数漏了 `generating` ⇒ `anyRunning`=false ⇒ `turnHasRunningTool()`=false
  //   ⇒ `showsBusyPlaceholder` 照常出「思考中…」 ⇒ 两条进度语义打架（与 2026-10-28 同一纪律）。
  //   `executing` 同罪：`core/toolstatus.ets` 把 `executing` 归入 running 档，这里也必须算在飞。
  return s === 'running' || s === 'pending' || s === 'streaming' || s === 'queued'
    || s === 'in_progress' || s === 'started' || s === 'generating' || s === 'executing';
}

/** 任一工具仍在跑。 */
export function anyRunning(tools: readonly { readonly status?: string }[] | undefined): boolean {
  if (tools === undefined || tools === null) {
    return false;
  }
  for (let i = 0; i < tools.length; i++) {
    if (isRunningStatus(tools[i].status)) {
      return true;
    }
  }
  return false;
}

/**
 * 是否显示「思考中…」。
 *
 * ⛔ 用户 2026-10-28（截图）：`task_wait: 执行中` 下面紧跟一条「思考中…」= 两条进度语义打架。
 *   有运行中工具时，工具本身已经表达"正在干活" ⇒ 不再显示「思考中…」。
 */
export function shouldShowThinking(liveText: string, liveReasoning: string,
  liveTools: readonly FlowToolLike[] | undefined): boolean {
  const blank = (x: string): boolean => x === undefined || x === null || x.trim().length === 0;
  // ⛔ 用户 2026-10-29 P0：「**已完成的迭代**显示思考中的 spinner icon」。
  //   旧判据只看"有没有 running 工具" ⇒ live 块里工具**已 done** 时仍被判成"机器在空想"
  //   ⇒ 光球/思考中挂在一条已经产出过的迭代上。
  //   ⇒ 语义必须是：**live 还没有任何可见内容**（无正文、无思考、无工具）才算"思考中"。
  if (liveTools !== undefined && liveTools !== null && liveTools.length > 0) {
    return false;
  }
  return blank(liveText) && blank(liveReasoning);
}

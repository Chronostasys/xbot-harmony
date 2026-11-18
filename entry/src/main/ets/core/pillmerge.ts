/**
 * pillmerge.ts —— **折叠单元抬到"回复级"**：把连续的「纯工具迭代」并成一个渲染块。
 *
 * 2026-10-25 用户 P0（截图：`Shell: cd ~/src/sglang-b300-glm52 …` 一路往下堆 20 行）：
 *   `foldPills`（>8 ⇒ 前 7 + `+N`，web `MergedPills` 同源）**是按"一个迭代"算的**，而服务端
 *   **一次工具调用就是一个迭代** ⇒ 每组只有 1 枚 pill ⇒ 阈值永远不触发 ⇒ 无限向下堆。
 *   ⇒ 正确做法是先把"连续的纯工具迭代"聚成一个渲染单元，再在那个单元上折叠
 *     （与 web `FoldedToolGroup` 的合并语义一致）；⛔ 不是改徽标样式。
 *
 * "纯工具迭代"判据（只用结构，不比内容语义）：有工具，且**没有正文/推理正文**（正文/推理为空白）。
 * 带正文的迭代保持独立（正文与 pill 的顺序不能被合并吞掉）。
 *
 * ⛔ 本文件是 `core/*.ts`：不得 import `.ets`（ArkTS 硬约束 `10605999`）。
 */
/**
 * ⛔ 不能 import `.ets`（ArkTS 硬约束 `10605999`：`Importing ArkTS files in JS and TS files is
 *   forbidden`）⇒ 这里按**结构**声明所需最小字段面，与 `types.ets` 的
 *   `PillIterationLike`/`PillToolLike` 字段兼容（调用方直接传即可）。
 */
interface PillToolLike {
  readonly name?: string;
  readonly iteration?: number;
  readonly status?: string;
}

export interface PillIterationLike {
  readonly iteration: number;
  readonly content?: string;
  readonly reasoning?: string;
  readonly stream_text?: string;
  readonly stream_reasoning?: string;
  readonly tools?: readonly PillToolLike[];
  readonly tools_folded?: boolean;
  readonly live?: boolean;
}

/**
 * 两个工具是否**同一次调用**。
 *
 * ⛔ 判据**只认 `call_id` 相等**（用户 2026-10-28「超级无敌丢迭代」）：
 *   旧实现还允许"名字+迭代号+label+状态"兜底 —— 但工具常常**没有 `iteration`**
 *   （合并块里的成员），此时所有 `Shell: ssh -o …` 的 key 完全一样 ⇒ 被当成"相邻重复"
 *   整批吸收 ⇒ 界面上只剩一两枚 pill（web 有 6 枚，原生只剩 2 枚）。
 *   ⇒ **没有 call_id 就绝不猜**（宁可少吸收一次重复，也绝不吞真调用）。
 */
function sameToolIdentity(a: PillToolLike, b: PillToolLike): boolean {
  const cidOf = (x: PillToolLike): string => (x as PillToolLike & { readonly call_id?: string }).call_id !== undefined
    ? ((x as PillToolLike & { readonly call_id?: string }).call_id as string) : '';
  const ca: string = cidOf(a);
  const cb: string = cidOf(b);
  if (ca.length === 0 || cb.length === 0 || ca !== cb) {
    return false;
  }
  // ⛔ **必须同迭代**（用户 2026-10-29：「连续的纯工具迭代，新的迭代也是纯工具时，执行完直接消失」）：
  //   服务端 `call_id` **跨迭代复用**（每迭代从 `call_0` 重新编号）⇒ 只比 id 会把下一个迭代的
  //   **真工具**当成"残留副本"吸收掉。残留副本保留**原始**迭代号 ⇒ 同号同 id 仍能被吸收。
  const itOf = (x: PillToolLike): number => x.iteration !== undefined && x.iteration !== null ? x.iteration : 0;
  return itOf(a) === itOf(b);
}

function isBlank(s: string | undefined | null): boolean {
  return s === undefined || s === null || s.trim().length === 0;
}

/** 是否「纯工具迭代」（可以并入相邻纯工具块）。 */
export function isToolOnlyIteration<T extends PillIterationLike>(it: T): boolean {
  const tools: readonly PillToolLike[] = it.tools !== undefined && it.tools !== null ? it.tools : [];
  if (tools.length === 0) {
    return false;
  }
  return isBlank(it.content) && isBlank(it.stream_text)
    && isBlank(it.reasoning) && isBlank(it.stream_reasoning);
}

/**
 * **连续「带工具」的迭代合成一个 pill 行** —— 与 web `TurnBody.mergeToolRuns` **逐字同构**。
 *
 * ⛔ 用户 2026-10-28：「不行，还是没合并，还是 1+2」。根因（此前一直搞错）：
 *   我原来只把**纯工具迭代**（无正文/思考）并进另一个纯工具块 ⇒ **头部那一枚**
 *   （"思考 N 字 + 1 枚工具"的迭代）永远自成一块 ⇒ 它那行只有一枚，下一块两枚 = `1+2`。
 *   web 的规则恰恰相反（`TurnBody.tsx:931-964`，注释里写着"折叠的**头部迭代可以带
 *   reasoning/content**；只有**后续成员**才要求只有工具"）：
 *     · `head` = 任何**带工具**的迭代（可含正文/思考）；
 *     · 向后吸收**连续**的"只有工具、无正文无思考"的迭代；
 *     · 保留 **head 的迭代号**（高度缓存/窗口 key 稳定）。
 *   ⇒ 于是「思考 + 1 枚」与紧随的「2 枚」变成同一个块 ⇒ 同一个 Flex ⇒ 3 枚排成 `2+1`。
 *
 * ⛔ 只合并"工具行"，**文本/思考不合并、不丢**（head 的正文/思考仍属于该块）。
 */
export function mergeToolOnlyIterations<T extends PillIterationLike>(iters: readonly T[]): T[] {
  const hasTools = (it: T): boolean => {
    const ts: readonly PillToolLike[] = it.tools !== undefined && it.tools !== null ? it.tools : [];
    return ts.length > 0;
  };
  // ⛔ **分组必须与状态无关**（用户 2026-10-29 P0：「迭代完成后消失」「最后那个 FileCreate 消失」）：
  //   旧实现把 `!anyRunning` 放进吸收条件 ⇒ 工具 `running→done` 时**分组结果变了**
  //   （原本单独成块的迭代被并进前一块）⇒ 合并后的 pill 数跨过折叠阈值（>8）⇒ 末尾那枚
  //   被塞进 `+N`，用户看到"完成瞬间 pill 消失"。⇒ 与 web `TurnBody.mergeToolRuns` 同源：
  //   **只看有没有正文/思考**，不看状态（状态只影响颜色）。稳定性优先。
  const absorbs = (it: T): boolean => hasTools(it)
    && isBlank(it.content) && isBlank(it.stream_text)
    && isBlank(it.reasoning) && isBlank(it.stream_reasoning);

  const out: T[] = [];
  for (let i = 0; i < iters.length; i++) {
    const head: T = iters[i];
    if (!hasTools(head)) {
      out.push(head);
      continue;
    }
    const headTools: readonly PillToolLike[] = head.tools !== undefined && head.tools !== null ? head.tools : [];
    const tools: PillToolLike[] = [];
    for (let k = 0; k < headTools.length; k++) {
      tools.push(headTools[k]);
    }
    let j: number = i;
    let folded: boolean = head.tools_folded === true;
    while (j + 1 < iters.length && absorbs(iters[j + 1])) {
      j++;
      const more: readonly PillToolLike[] = iters[j].tools !== undefined && iters[j].tools !== null
        ? (iters[j].tools as readonly PillToolLike[]) : [];
      for (let k = 0; k < more.length; k++) {
        // ⛔ 相邻重复吸收：**只吸收"跨迭代"的残留副本**（`active_tools` 跨帧残留会把同一
        //   调用留在相邻两个迭代里）。**同一迭代内**的两枚同名同参工具是两次**真实调用**
        //   （如连跑两次相同命令）⇒ 绝不能吞（用户 2026-10-28：1+2 里那两枚就是真调用）。
        // `sameToolIdentity` 已要求**同迭代 + 同 call_id**（残留副本的形态）
        const lastTool: PillToolLike | undefined = tools.length > 0 ? tools[tools.length - 1] : undefined;
        if (lastTool !== undefined && sameToolIdentity(lastTool, more[k])) {
          continue;
        }
        tools.push(more[k]);
      }
      if (iters[j].tools_folded === true) {
        folded = true;
      }
    }
    if (j === i) {
      out.push(head);
    } else {
      // `.ts` 允许断言（ArkTS 禁 any/unknown，但这是同构集合 ⇒ 无信息丢失）
      out.push({ ...head, tools, tools_folded: folded } as T);
    }
    i = j;
  }
  // ── 去重：同一个工具调用**绝不能出现两枚 pill** ──────────────────────────────────
  // 用户 2026-10-28：「点一个 badge 弹出两个详情」。根因：服务端 `active_tools` 会**跨帧残留**
  //   （`agent/engine_run_tools.go:49-64` 明确要求前端按迭代过滤），偶发同一次调用同时出现在
  //   两个相邻迭代里 ⇒ 合并块里出现**两个同 call_id 的工具** ⇒ 两枚 pill 的浮层键相同
  //   ⇒ `bindPopup` 条件**同时为真** ⇒ 一次点击弹出**两个**详情卡。
  //   ⇒ 渲染前按"调用身份"去重（`call_id` 优先，缺省 `迭代号#名字#同名序号`），保留**先出现**的
  //   那一个（与执行顺序一致）。
  const deduped: T[] = [];
  const seen: Set<string> = new Set<string>();
  for (let i = 0; i < out.length; i++) {
    const blk: T = out[i];
    const tools: readonly PillToolLike[] = blk.tools !== undefined && blk.tools !== null ? blk.tools : [];
    if (tools.length === 0) {
      deduped.push(blk);
      continue;
    }
    const keep: PillToolLike[] = [];
    const local: Map<string, number> = new Map<string, number>();
    for (let k = 0; k < tools.length; k++) {
      const t: PillToolLike = tools[k];
      const iter: number = t.iteration !== undefined && t.iteration !== null && t.iteration > 0 ? t.iteration : blk.iteration;
      let id: string;
      const cid: string = (t as PillToolLike & { readonly call_id?: string }).call_id !== undefined
        ? ((t as PillToolLike & { readonly call_id?: string }).call_id as string) : '';
      // ⛔ **不做内容级去重**（用户 2026-10-29：「新工具完成后立刻从历史消失」）：
      //   同名同参数/同输出的两次**真实调用**（grep、同名 FileReplace）会被误吞。
      //   去重只认「同迭代 + 同 call_id」；宁可留重复，也绝不吞真调用。
      if (cid.length > 0) {
        // ⛔ **必须带迭代号**：`call_id` 可能跨迭代复用（服务端每迭代重新编号，如 `call_0`）
        //   ⇒ 全局按 id 去重会把后面迭代的真工具删掉（用户 2026-10-28：「tool 不见了」）。
        //   残留副本保留**原始迭代号** ⇒ 仍能被吸收（同号同 id）。
        id = `c:${iter}#${cid}`;
      } else {
        const n: number = local.get(`${iter}#${t.name}`) !== undefined
          ? (local.get(`${iter}#${t.name}`) as number) : 0;
        local.set(`${iter}#${t.name}`, n + 1);
        id = `n:${iter}#${t.name}#${n}`;
      }
      if (seen.has(id)) {
        continue;      // 跨块重复（同一调用残留在两个迭代里）⇒ 丢弃后来的
      }
      seen.add(id);
      keep.push(t);
    }
    deduped.push({ ...blk, tools: keep } as T);
  }
  return deduped;
}

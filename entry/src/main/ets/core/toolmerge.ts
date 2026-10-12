/**
 * toolmerge.ts —— 工具列表合并的**纯逻辑**（零依赖；`.ts` 而非 `.ets`，因为 `reduce.ts`
 * 是纯 `.ts`，而 **`core/*.ts` 禁止 import `.ets`**（ArkTS 硬红 `10605999`，见 `docs/ARKTS-GOTCHAS.md`））。
 *
 * 真源：web `components/agent/progressStore.ts:339-364` 的 `dedupTools`（状态优先级 rank）。
 * 本仓是**跨帧累积**（web 每次拿当帧快照），故同一条 rank 规则必须显式应用在**跨帧合并**上。
 */

/**
 * 状态优先级：**终态优先**（error/done=4 > running=3 > generating=2 > pending=1 > 其它=0）——
 * **逐字移植** web `progressStore.dedupTools` 的 `rank`（`progressStore.ts:343-345`；web 用 3/2/1，序一致）。
 *
 * 为什么必须有优先级：同一个工具会同时出现在**陈旧快照**（active_tools，仍是 running）
 * 与**新快照**（completed_tools，已 done/error）里。旧的"后到者赢"会让陈旧的 running
 * 赢 ⇒ 工具永远不转绿；反过来也会让陈旧的 pending 盖掉"已在执行"的 running
 * （用户 2026-09-14「已完成还是渲染成进行中」/ 2026-10-11「executing 被当成排队」的根因）。
 *
 * ⛔ **`generating` 必须排在 `pending` 之上**（本表曾把它排在 0 = 低于 pending，**是移植偏差**，
 *    2026-10-11 用户亲报"有时所有工具都在排队"的根因）：
 *    web 的 `dedupTools` 把 `generating` 的工具**整体排除在 rank 比较之外**
 *    （`progressStore.ts:351-354`：`if (tool.status === 'generating') { result.push(tool); continue }`）
 *    ⇒ 在 web 里后到的 `pending` **永远盖不掉**同一调用的"生成中"。本仓是**跨帧累积**合并，
 *    没法"直接 push 不登记键"，只能在 rank 里把这一保护**等价表达**出来：
 *    语义上 排队 < 参数流式生成中 < 执行中（单调推进）。
 */
export function toolRank(status: string | undefined): number {
  const s: string = status !== undefined ? status : '';
  if (s === 'error' || s === 'done') { return 4; }
  if (s === 'running' || s === 'executing') { return 3; }
  if (s === 'generating') { return 2; }
  if (s === 'pending') { return 1; }
  return 0;                       // 未知
}

/**
 * 工具的最小结构面 —— 原生 `ToolProgress` 与 web `WebToolProgress` **都满足**。
 * （两形状的差异只在调用身份字段名：原生 `call_id` / web `callID`。）
 */
interface ActiveToolLike {
  name?: string;
  label?: string;
  status?: string;
  call_id?: string;
  callID?: string;
}

/** active 工具合并键（调用身份优先，缺省 `name#label`；与 web `dedupTools` 的键同序）。 */
function activeToolKey(t: ActiveToolLike): string {
  const cid: string = t.call_id !== undefined && t.call_id.length > 0
    ? t.call_id : (t.callID !== undefined && t.callID.length > 0 ? t.callID : '');
  if (cid.length > 0) { return cid; }
  const n: string = t.name !== undefined ? t.name : '';
  const l: string = t.label !== undefined ? t.label : '';
  return `${n}#${l}`;
}

/**
 * 合并「当前迭代 active 工具列表」：**成员以新列表为准**（服务端当帧的 in-flight 集合），
 * 但**同键状态只升不降**（web `progressStore.dedupTools:339-364` 的 `rank` 语义）。
 *
 * ── 为什么必须有（2026-10-12 用户亲报，原话「running 绝不能变回 pending，参考 web」）──────
 *   本仓是**跨帧累积**：先收到 `status:"running"`，随后可能收到一份**陈旧快照**
 *   （服务端整批先标 `pending` 的 `active_tools` 条目会**残留进后续帧**，
 *   `agent/engine_run_tools.go:49-64`）。此前 `activeTools: ev.activeTools` 是**整表替换**
 *   ⇒ 陈旧的 `pending` 把已 `running` 的**打回排队** ⇒ 画面上「正在执行的工具显示排队」，
 *   严重时「一个迭代所有 tool 都排队」。
 *   web 侧**不会**回退，因为它的 `dedupTools` 每次都对同键取 rank 更高的那个
 *   （`running` 高于 `pending`）—— 本函数把这条规则**等价应用在跨帧合并上**。
 *
 * ⛔ 不是 hack：成员集合仍由服务端当帧决定（不会滞留已完成工具），
 *    被保留的只有**同一调用已观测到的更高状态**（单调推进，与 web 同语义）。
 *
 * @returns 无任何条目需要保序时，**原样返回 `next` 引用**（保住渲染层 memo / `unchanged` 判等）。
 */
export function mergeActiveStatus<T extends ActiveToolLike>(prev: readonly T[] | undefined,
  next: readonly T[] | undefined): readonly T[] {
  const n: readonly T[] = next !== undefined ? next : [];
  const p: readonly T[] = prev !== undefined ? prev : [];
  if (p.length === 0 || n.length === 0) {
    return n;
  }
  const byKey: Map<string, T> = new Map<string, T>();
  for (let i = 0; i < p.length; i++) {
    byKey.set(activeToolKey(p[i]), p[i]);
  }
  const out: T[] = [];
  let replaced: boolean = false;
  for (let i = 0; i < n.length; i++) {
    const old: T | undefined = byKey.get(activeToolKey(n[i]));
    if (old !== undefined && toolRank(old.status) > toolRank(n[i].status)) {
      out.push(old);                // 已观测到更"靠后"的状态 ⇒ 保留（running 不被 pending 打回）
      replaced = true;
    } else {
      out.push(n[i]);
    }
  }
  return replaced ? out : n;
}

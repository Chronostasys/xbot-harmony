/**
 * toollayer.ts —— **工具详情覆盖层**（纯 TS，无 ArkUI / 无 `.ets` import）。
 *
 * 背景（用户 2026-11-17）：「有时候 tool 那个 `+N` 列表第一次点开看不到详细参数和输出，
 * 再关闭打开一次才有」。
 *
 * 根因（结构性）：`+N` 浮层是 `bindPopup` 的 builder —— **内容在打开那一刻构建**。之后
 * `/api/iteration_detail` 回来、模型把新对象换进块里，**浮层子树不会重建**（父级 builder 不重跑）
 * ⇒ 只能关闭再打开（重新构建一次）才看得到。
 *
 * 修法：详情一落进模型就按**身份键**记到这里（`rememberToolDetail`）；浮层组件自己订阅
 * `AppStorage('toolDetailGen')`（详情每到一批 +1），自渲染时用 `withToolDetail` 把覆盖层
 * 合到手上那份（可能是旧的）工具上 ⇒ 无需重开即可显示。
 *
 * ⛔ 只做**字段级补全**（本地空、覆盖层有 ⇒ 取覆盖层），绝不覆盖已有非空字段、绝不删工具。
 */

/** 覆盖层需要的字段面（`ToolProgress` 与模型 `ToolRec` 都能投影成它）。 */
export interface ToolDetailLike {
  name: string;
  label?: string;
  status?: string;
  summary?: string;
  args?: string;
  detail?: string;
  tool_hints?: string;
  elapsed_ms?: number;
  exit_code?: number;
  call_id?: string;
  iteration?: number;
}

const OVERLAY: Map<string, ToolDetailLike> = new Map<string, ToolDetailLike>();
const MAX_ENTRIES: number = 512;

/**
 * 工具**身份键**（跨帧稳定）：`迭代号 + call_id`；无 `call_id` 时退化为 `迭代号 + 名字 + label`。
 * 与渲染层去重键同源（`call_id` 跨迭代复用 ⇒ 必须带号）。
 */
export function detailKey(t: ToolDetailLike): string {
  const iter: number = t.iteration !== undefined && t.iteration !== null && t.iteration > 0 ? t.iteration : 0;
  const cid: string = t.call_id !== undefined && t.call_id !== null ? t.call_id : '';
  if (cid.length > 0) {
    return `c:${iter}#${cid}`;
  }
  const label: string = t.label !== undefined && t.label !== null ? t.label : '';
  return `n:${iter}#${t.name}#${label}`;
}

function pick(next: string | undefined, prev: string | undefined): string | undefined {
  if (next !== undefined && next !== null && next.length > 0) {
    return next;
  }
  return prev;
}

/** 记住一份"已取回详情"的工具（按身份键字段级合并；幂等）。 */
export function rememberToolDetail(t: ToolDetailLike): void {
  if (t === undefined || t === null) {
    return;
  }
  const hasBody: boolean = (t.args !== undefined && t.args.length > 0)
    || (t.detail !== undefined && t.detail.length > 0)
    || (t.summary !== undefined && t.summary.length > 0)
    || (t.tool_hints !== undefined && t.tool_hints.length > 0);
  if (!hasBody) {
    return;      // 轻字段：没有任何可补的信息 ⇒ 不入覆盖层
  }
  const key: string = detailKey(t);
  const prev: ToolDetailLike | undefined = OVERLAY.get(key);
  const merged: ToolDetailLike = prev === undefined ? {
    name: t.name, label: t.label, status: t.status, summary: t.summary, args: t.args,
    detail: t.detail, tool_hints: t.tool_hints, elapsed_ms: t.elapsed_ms, exit_code: t.exit_code,
    call_id: t.call_id, iteration: t.iteration,
  } : {
    name: t.name,
    label: pick(t.label, prev.label),
    status: pick(t.status, prev.status),
    summary: pick(t.summary, prev.summary),
    args: pick(t.args, prev.args),
    detail: pick(t.detail, prev.detail),
    tool_hints: pick(t.tool_hints, prev.tool_hints),
    elapsed_ms: t.elapsed_ms !== undefined ? t.elapsed_ms : prev.elapsed_ms,
    exit_code: t.exit_code !== undefined ? t.exit_code : prev.exit_code,
    call_id: t.call_id !== undefined && t.call_id.length > 0 ? t.call_id : prev.call_id,
    iteration: t.iteration !== undefined && t.iteration > 0 ? t.iteration : prev.iteration,
  };
  OVERLAY.set(key, merged);
  if (OVERLAY.size > MAX_ENTRIES) {
    // 有界（极长会话）：丢最早的 128 条（Map 保插入序）。
    const drop: string[] = [];
    let n: number = 0;
    OVERLAY.forEach((_v: ToolDetailLike, k: string): void => {
      if (n < 128) {
        drop.push(k);
        n++;
      }
    });
    for (let i = 0; i < drop.length; i++) {
      OVERLAY.delete(drop[i]);
    }
  }
}

/** 把覆盖层里**同身份**的已知详情合到该工具上（无覆盖 / 无变化 ⇒ 返回原对象）。 */
export function withToolDetail<T extends ToolDetailLike>(t: T): T {
  const hit: ToolDetailLike | undefined = OVERLAY.get(detailKey(t));
  if (hit === undefined) {
    return t;
  }
  const args: string | undefined = pick(t.args, hit.args);
  const detail: string | undefined = pick(t.detail, hit.detail);
  const summary: string | undefined = pick(t.summary, hit.summary);
  const hints: string | undefined = pick(t.tool_hints, hit.tool_hints);
  if (args === t.args && detail === t.detail && summary === t.summary && hints === t.tool_hints) {
    return t;
  }
  const out: T = { ...t, args, detail, summary, tool_hints: hints };
  return out;
}

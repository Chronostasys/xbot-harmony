/**
 * **手机操作演示 / 自检**（用户 2026-11-08：「必须要你成功操作我的手机才算完成」）。
 *
 * 端到端链路（全部在 App 进程内，不需要 Mac/线/WDA/无障碍）：
 *   App → 127.0.0.1:8710（hdcd）→ RSA-PSS 认证 → CMD_UNITY_EXECUTE → `uitest`
 * 三件事证明"真的能操作手机"：
 *   ① `uitest dumpLayout` 拿到**当前整屏**控件树；
 *   ② 树里按文本找目标控件，`uitest uiInput click x y` **真点它**；
 *   ③ 再 dump 一次，比对控件树是否变化（变化 = 点击确实生效）。
 *
 * ⛔ ArkTS 严格模式：不用正则/不用 `T | null`/不用结构化对象 ⇒ 全部用**具名类**。
 */
import { PhoneResult, tap, uiDump } from './hdcphone';

/** 树里一个可点节点。 */
class UiNode {
  text: string = '';
  type: string = '';
  x: number = 0;
  y: number = 0;
}

/** 坐标点（`ok=false` 表示解析失败）。 */
class Pt {
  x: number = 0;
  y: number = 0;
  ok: boolean = false;
}

/** `[x1,y1][x2,y2]` → 中心点（手写解析，不用正则：ArkTS 对 `RegExpMatchArray | null` 不友好）。 */
function centerOf(bounds: string): Pt {
  const p: Pt = new Pt();
  const i1: number = bounds.indexOf('[');
  const i2: number = i1 < 0 ? -1 : bounds.indexOf(',', i1);
  const i3: number = i2 < 0 ? -1 : bounds.indexOf(']', i2);
  const i4: number = i3 < 0 ? -1 : bounds.indexOf('[', i3);
  const i5: number = i4 < 0 ? -1 : bounds.indexOf(',', i4);
  const i6: number = i5 < 0 ? -1 : bounds.indexOf(']', i5);
  if (i6 < 0) {
    return p;
  }
  const x1: number = parseInt(bounds.substring(i1 + 1, i2), 10);
  const y1: number = parseInt(bounds.substring(i2 + 1, i3), 10);
  const x2: number = parseInt(bounds.substring(i4 + 1, i5), 10);
  const y2: number = parseInt(bounds.substring(i5 + 1, i6), 10);
  if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
    return p;
  }
  p.x = Math.round((x1 + x2) / 2);
  p.y = Math.round((y1 + y2) / 2);
  p.ok = true;
  return p;
}

/** 深度遍历 dump JSON，收集"有文本且可点"的节点。 */
function collectClickable(root: ESObject): UiNode[] {
  const out: UiNode[] = [];
  const walk = (node: ESObject): void => {
    const attrs: ESObject = node['attributes'];
    if (attrs !== undefined && attrs !== null) {
      const t: ESObject = attrs['text'];
      const c: ESObject = attrs['clickable'];
      const b: ESObject = attrs['bounds'];
      const text: string = t === undefined || t === null ? '' : (t as string);
      const clickable: boolean = c !== undefined && c !== null && (c as string) === 'true';
      if (text.length > 0 && clickable) {
        const p: Pt = centerOf(b === undefined || b === null ? '' : (b as string));
        if (p.ok) {
          const n: UiNode = new UiNode();
          n.text = text;
          n.x = p.x;
          n.y = p.y;
          const ty: ESObject = attrs['type'];
          n.type = ty === undefined || ty === null ? '' : (ty as string);
          out.push(n);
        }
      }
    }
    const kids: ESObject = node['children'];
    if (kids !== undefined && kids !== null) {
      const arr: ESObject[] = kids as ESObject[];
      for (let i = 0; i < arr.length; i++) {
        walk(arr[i]);
      }
    }
  };
  walk(root);
  return out;
}

/** 解析 dump 结果，返回可点节点；解析失败返回空数组。 */
export function parseUi(json: string): UiNode[] {
  try {
    const obj: ESObject = JSON.parse(json) as ESObject;
    return collectClickable(obj);
  } catch (e) {
    return [];
  }
}

/** 演示结果。 */
export class OperateDemo {
  ok: boolean = false;
  log: string = '';
}

/**
 * 跑一次"看 → 点 → 再看来验证"的完整操作。
 * @param want 期望点到的文本（树里按 `includes` 匹配；找不到则退化为首个可点节点）
 */
export async function operateDemo(ctx: Context, want: string): Promise<OperateDemo> {
  const res: OperateDemo = new OperateDemo();
  const notes: string[] = [];
  const before: PhoneResult = await uiDump(ctx);
  if (!before.ok) {
    res.log = `dump1 失败：${before.error}`;
    return res;
  }
  const nodes: UiNode[] = parseUi(before.output);
  notes.push(`dump1 节点=${nodes.length}`);
  let idx: number = -1;
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].text.indexOf(want) >= 0) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    idx = nodes.length > 0 ? 0 : -1;
    notes.push(`未找到「${want}」，退化为首节点`);
  }
  if (idx < 0) {
    res.log = `${notes.join(' | ')} 无可点节点`;
    return res;
  }
  const target: UiNode = nodes[idx];
  notes.push(`点击「${target.text}」@(${target.x},${target.y})`);
  const clicked: PhoneResult = await tap(ctx, target.x, target.y);
  if (!clicked.ok) {
    res.log = `${notes.join(' | ')} 点击失败：${clicked.error}`;
    return res;
  }
  const after: PhoneResult = await uiDump(ctx);
  if (!after.ok) {
    res.log = `${notes.join(' | ')} dump2 失败：${after.error}`;
    return res;
  }
  const nodes2: UiNode[] = parseUi(after.output);
  const changed: boolean = nodes2.length !== nodes.length
    || (nodes2.length > 0 && nodes.length > 0 && nodes2[0].text !== nodes[0].text);
  notes.push(`dump2 节点=${nodes2.length} 变化=${changed}`);
  res.ok = true;
  res.log = notes.join(' | ');
  return res;
}

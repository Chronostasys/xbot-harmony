#!/usr/bin/env python3
"""
row_scale.py <ui.json> —— 从 uitest dumpLayout 的布局树里，按 **ListItem（= 一行消息）**
统计：该行**被实例化**的迭代块数与节点数。

"数的是什么"（机械定义，全部来自 dump 文本本身，不靠推断）：

  节点        = 布局树里每一个带 `attributes.type` 的 dict（含 Stack/Row/Column/Text/
                SymbolGlyph/Flex/ListItem/… 全部控件类型，**不过滤**）
  行(ListItem)= `attributes.type == "ListItem"` 的节点（本仓一行消息 = 一个 ListItem）
  块(block)   = 一行内**被实例化**的迭代块的机械代理，取三者之和：
                  a) `text` 匹配 `思考 N 字` 的 Text（每个带思考的迭代恰好一条，见
                     MessageRow.ThinkingLine 的 label）
                  b) `text` 匹配 `^(Tool|Read|Shell|Grep|Edit|Write|FileReplace|Glob|Fetch|
                     TodoWrite|Task|WebFetch|NotebookEdit)` 的 Text（工具 pill 标签）
                  c) 每个 `SubAgentTree` 根（渲染为一行内独立的树）
                ⚠️ 这是**下界代理**：无思考、无工具的纯正文块不会被 a/b 命中
                （正文块的机械特征只有 MarkdownView 的容器 Column，与其它 Column 无法区分）。
                因此 a+b+c ≤ 真实块数，用它做**改前/改后同一口径**的比较是有效的
                （同一行、同一 dump 流程，两侧都低估同样的量）。

用法：python3 tools/perf/row_scale.py /tmp/ui.json
"""
import json, re, sys, collections

BLOCK_TEXT = re.compile(
    r'^(思考 \d+ 字|Tool|Read|Shell|Grep|Edit|Write|FileReplace|Glob|Fetch|TodoWrite'
    r'|Task|WebFetch|NotebookEdit|MultiEdit|Bash|Delete|Move|Copy)')

def main(path):
    d = json.load(open(path, encoding='utf-8'))
    listitems = []          # (节点数, 块数, 首文本)
    total_nodes = 0
    types = collections.Counter()

    def walk(n, li):
        """li = 当前所属 ListItem 的计数器 dict，None = 不在任何 ListItem 内。"""
        nonlocal total_nodes
        if isinstance(n, dict):
            total_nodes += 1
            a = n.get('attributes') or {}
            t = a.get('type') or '?'
            types[t] += 1
            if t == 'ListItem':
                li = {'nodes': 0, 'blocks': 0, 'head': ''}
                listitems.append(li)
            if li is not None:
                li['nodes'] += 1
                tx = a.get('text') or a.get('content') or ''
                if tx and BLOCK_TEXT.match(tx):
                    li['blocks'] += 1
                    if not li['head']:
                        li['head'] = tx[:36]
                elif tx and not li['head']:
                    li['head'] = tx[:36]
            for c in (n.get('children') or []):
                walk(c, li)
        elif isinstance(n, list):
            for c in n:
                walk(c, li)

    walk(d, None)
    print(f"屏幕节点总数 = {total_nodes}（全部控件类型，不过滤）")
    print("类型直方图 top8:", ', '.join(f"{k}:{v}" for k, v in types.most_common(8)))
    print(f"ListItem（行）= {len(listitems)}")
    if not listitems:
        print("⚠️ 当前屏没有消息列表行（空态/未登录/抽屉打开态）")
        return
    listitems.sort(key=lambda x: -x['blocks'])
    print("\n按「该行被实例化的块数」排序（块数 = 思考N字 + 工具pill + SubAgent树 的下界代理）：")
    for i, li in enumerate(listitems[:8]):
        print(f"  行#{i}  块数={li['blocks']:4d}  节点数={li['nodes']:5d}  首文本={li['head']!r}")
    worst = listitems[0]
    tot = sum(li['nodes'] for li in listitems)
    print(f"\n最重行：块数={worst['blocks']} 节点数={worst['nodes']}"
          f"  → 节点/块 ≈ {worst['nodes'] / worst['blocks']:.1f}" if worst['blocks'] else "")
    print(f"全部行合计：节点 {tot}（占屏幕 {100 * tot / total_nodes:.0f}%）")

    # 机械 grep 口径的自检（与上面 python 计数对齐，便于复制到 shell）
    raw = open(path, encoding='utf-8').read()
    g_nodes = len(re.findall(r'"type":"', raw))
    g_think = len(re.findall(r'"text":"思考 \d+ 字"', raw))
    g_li = len(re.findall(r'"type":"ListItem"', raw))
    print(f"\n[机械 grep 口径自检] \"type\": 出现 {g_nodes} 次 / \"思考 N 字\" {g_think} 个"
          f" / ListItem {g_li} 个")

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/ui.json')

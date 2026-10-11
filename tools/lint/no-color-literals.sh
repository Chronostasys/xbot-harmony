#!/usr/bin/env bash
# no-color-literals.sh —— 设计系统 §5 第 1 条「无颜色字面量（应为 0）」的**机器判据**。
#
# 为什么这个判据不能是简单的 grep（2026-10-11，我作为指挥者**连踩三次同源假报**后才做）：
#   朴素 `grep -rn '#[0-9a-fA-F]{6}'` 会把**注释里解释色值的文档**判成违规 ——
#   而本仓组件恰恰大量用注释记录「为什么用这个角色 / 这个值」（这是好实践：如
#   `MessageRow` 注释写 `白底上 #B42318 可见但不刺眼`、`AssistantOrb` 写 `porcelain 下
#   statusRunning 与 accent 同为 #0071E3`）⇒ grep 会把 7 处**文档**报成 7 处违规。
#   ⇒ 判据必须：①**剥掉注释**（`//` 与 `/* */`，且**对字符串内的 `//` 免疫**，别把 `'http://'` 当注释）
#              ②**打印命中行原文**（让人一眼分辨真假，而不是只给个计数）
#              ③支持**带理由的内联豁免**（同一行或上一行 `// allow-color-literal: <理由>`）
#              ④自带**零扫描判红**（防白绿）⑤**mutation 自证**（注释里的色值必须**不**触发）。
#
# 已知唯一的合法例外（本仓实测）：`win.setWindowSystemBarProperties({ statusBarContentColor:
#   dark ? '#FFFFFF' : '#000000' })` —— 该 API **只接受色值字符串**（不接资源引用/角色），
#   且已按 `dark` 分叉 ⇒ 用内联豁免标注，而不是放宽整条规则。
#
# 用法：bash tools/lint/no-color-literals.sh          （有命中 ⇒ 退出码 1）
# 可覆盖：SCAN_DIRS="dir…"  （供 mutation 自证 / 复用）
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ETS="$ROOT/entry/src/main/ets"
if [ -z "${SCAN_DIRS:-}" ]; then SCAN_DIRS="$ETS/components $ETS/pages"; fi

exec python3 - "$ROOT" $SCAN_DIRS <<'PY'
import re, sys, pathlib
root = sys.argv[1]
dirs = [pathlib.Path(d) for d in sys.argv[2:]]
hexpat = re.compile(r'#[0-9a-fA-F]{3,8}\b')
allowpat = re.compile(r'allow-color-literal\s*:\s*(\S.*)')

def strip_comments(src: str):
    """返回与 src **等长**的字符串：注释字符替换为空格，其余（含字符串字面量）原样保留。
    等长 ⇒ 行列号与原文一致 ⇒ 报错位置可直接对上源码。"""
    out = list(src); n = len(src); i = 0
    in_line = in_block = in_str = False; quote = ''
    while i < n:
        c = src[i]; nxt = src[i+1] if i+1 < n else ''
        if in_line:
            if c == '\n': in_line = False
            else: out[i] = ' '
        elif in_block:
            if c == '*' and nxt == '/': out[i] = out[i+1] = ' '; i += 2; in_block = False; continue
            if c != '\n': out[i] = ' '
        elif in_str:
            if c == '\\': i += 2; continue
            if c == quote: in_str = False
        else:
            if c == '/' and nxt == '/': out[i] = out[i+1] = ' '; i += 2; in_line = True; continue
            if c == '/' and nxt == '*': out[i] = out[i+1] = ' '; i += 2; in_block = True; continue
            if c in ('"', "'", '`'): in_str = True; quote = c
        i += 1
    return ''.join(out)

files = []
for d in dirs:
    files += sorted(d.rglob('*.ets')) + sorted(d.rglob('*.ts'))
scanned = 0; hits = []; seen = set()
for f in files:
    try: raw = f.read_text(errors='ignore')
    except Exception: continue
    scanned += 1
    lines = raw.split('\n')
    code = strip_comments(raw).split('\n')
    for idx, cl in enumerate(code):
        if not hexpat.search(cl): continue
        if (str(f), idx) in seen: continue          # 同一行多个色值 ⇒ 只报一次（原样打行，够看）
        reason = ''
        for cand in (idx, idx - 1):                 # 同一行 或 上一行
            if 0 <= cand < len(lines):
                a = allowpat.search(lines[cand])
                if a: reason = a.group(1).strip(); break
        if reason: continue
        seen.add((str(f), idx))
        hits.append((f, idx + 1, lines[idx].rstrip()))

if not scanned:
    print('❌ color-literals：**一个文件都没扫到** —— 这是白绿（路径与真源脱节），先修本脚本再信它'); sys.exit(2)

for f, ln, text in hits:
    print(f'  ❌ {f}:{ln}')
    print(f'       {text[:150]}')

if not hits:
    print(f'✅ color-literals：扫到 {scanned} 个文件，组件/页面里**没有颜色字面量**')
    print('   （注释里记录色值是**允许且鼓励**的：剥掉注释后判据自动忽略它们）')
    sys.exit(0)

print()
print(f'❌ color-literals：{len(hits)} 处颜色字面量（设计系统 §5 第 1 条要求 0 处）')
print('   修法：①换真源角色 core/design.ets: colorOf(p,role) / surfaceFillOf(p,role) / hairlineOf(p)；')
print('         ②白深分叉用 isLightPalette(paletteOf(theme))，⛔ 不按主题名硬判；')
print('         ③若确为「只吃色值字符串」的 API（如 setWindowSystemBarProperties）⇒')
print('           在该行或其上一行写：// allow-color-literal: <理由>')
sys.exit(1)
PY

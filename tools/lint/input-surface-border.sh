#!/usr/bin/env bash
# input-surface-border.sh —— 断言「输入框（input 面填充）必须自带**结构发丝**」。
#
# 为什么必须（2026-10-13 真机取证 · 用户「终端做的很差 / 考虑所有的面板」）：
#   `core/design.ets` 里 `surface.input` 与浮层底 `surface.overlay` **同属 `RUNG_CARD`**
#   （`new SurfaceRole('surface.input', RUNG_CARD, true)` 与
#    `new SurfaceRole('surface.overlay', RUNG_CARD, true)` 同一层级）⇒
#   `surfaceFillOf(p,'surface.input')` 与 `surfaceFillOf(p,'surface.overlay')` **逐字节同色**
#   ⇒ 只靠填充，输入框容器在**深浅两主题下都完全不可见** —— 真机截图里只剩一行浮空的占位文字。
#   `new SurfaceRole(name, rung, hairline)` 的第三参 `hairline=true` 语义正是「该面需要结构性
#   发丝来立边界」。全站输入面**同一口径**：`pages/Index.ets` composer 与 `components/SettingsRows.ets`
#   的输入框都写 `.border({ width: STROKE_HAIRLINE, color: hairlineOf(p) })`；键帽亦同（`keyRoleColor`）。
#   本轮实测抓到**恰 2 处**存量欠账（`TerminalSheet` / `StatusSheet`）⇒ 修完转**硬红**（同 ⑥c 的口径）。
#
# 判据形态（⛔ 不是朴素 grep —— 会踩同源假报，本仓 235ce62/f793c42 有血泪）：
#   ①**剥注释**（`//` 与 `/* */`，且对字符串内的 `//` 免疫）—— 否则注释里提一句 `.border(...)` 就白绿；
#   ②**只取元素调用链**（`TextInput(`/`TextArea(` 起、按括号平衡走到该 ArkUI 元素的链尾）——
#      不能"取整行"也不能"取固定行窗口"：回调和多行实参里有 `=> { … }` 与注释空行，固定窗口会被截断 ⇒ 假红；
#   ③**零扫描判红**（一个 `TextInput`/`TextArea` 都没扫到 ⇒ 路径/正则与真源脱节 = 白绿）；
#   ④**mutation 自证**（见文件末注释的注入样本）；
#   ⑤**带理由的内联豁免**：在其行或其上一行写 `// allow-input-noborder: <理由>`。
#
# 用法：bash tools/lint/input-surface-border.sh          （有命中 ⇒ 退出码 1）
# 可覆盖：SCAN_DIRS="dir…"  （供 mutation 自证 / 复用）
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ETS="$ROOT/entry/src/main/ets"
if [ -z "${SCAN_DIRS:-}" ]; then SCAN_DIRS="$ETS/components $ETS/pages"; fi

exec python3 - "$ROOT" $SCAN_DIRS <<'PY'
import os, re, sys

root = sys.argv[1]
dirs = sys.argv[2:]

INPUT_RE = re.compile(r'\bTextInput\s*\(|\bTextArea\s*\(')
BORDER_RE = re.compile(r'\.border\s*\(')
ALLOW_RE = re.compile(r'allow-input-noborder\s*:\s*(\S.*)')


def strip_comments(src: str) -> str:
    """返回与 src **等长**的字符串：注释字符替换为空格，其余（含字符串字面量）原样保留。
    等长 ⇒ 行列号与原文一致 ⇒ 报错位置可直接对上源码。"""
    out = list(src); n = len(src); i = 0
    in_line = in_block = in_str = False; quote = ''
    while i < n:
        c = src[i]; nxt = src[i + 1] if i + 1 < n else ''
        if in_line:
            if c == '\n': in_line = False
            else: out[i] = ' '
        elif in_block:
            if c == '*' and nxt == '/': out[i] = out[i + 1] = ' '; i += 2; in_block = False; continue
            if c != '\n': out[i] = ' '
        elif in_str:
            if c == '\\': i += 2; continue
            if c == quote: in_str = False
        else:
            if c == '/' and nxt == '/': out[i] = out[i + 1] = ' '; i += 2; in_line = True; continue
            if c == '/' and nxt == '*': out[i] = out[i + 1] = ' '; i += 2; in_block = True; continue
            if c in ('"', "'", '`'): in_str = True; quote = c
        i += 1
    return ''.join(out)


def element_span(code: str, start: int) -> str:
    """从 `TextInput(` / `TextArea(` 的调用起点开始，返回**整个 ArkUI 元素链**的源码片段。
    规则：按 `()[]{}` 平衡；到达 depth==0 的换行处时，向后跳过空白（含换行 ——
    注释已被替换成空格，会跨过"注释空行"）后若紧接 `.` 则续链，否则元素链到此结束。"""
    n = len(code); i = start; depth = 0
    while i < n:
        c = code[i]
        if c in '([{': depth += 1
        elif c in ')]}': depth -= 1
        elif c == '\n' and depth == 0:
            j = i + 1
            while j < n and code[j] in ' \t\r\n': j += 1
            if j < n and code[j] == '.':
                i = j; continue
            return code[start:i]
        i += 1
    return code[start:n]


files = []
for d in dirs:
    for dp, _dn, fns in os.walk(d):
        for fn in fns:
            if fn.endswith('.ets'):
                files.append(os.path.join(dp, fn))
files.sort()

scanned_files = 0
calls = 0
hits = []
for f in files:
    try:
        raw = open(f, encoding='utf-8', errors='ignore').read()
    except Exception:
        continue
    scanned_files += 1
    code = strip_comments(raw)
    src_lines = raw.split('\n')
    for m in INPUT_RE.finditer(code):
        calls += 1
        span = element_span(code, m.start())
        if ('surface.input' not in span) and ('SURFACE_COMPOSER' not in span):
            continue
        if BORDER_RE.search(span):
            continue
        ln = code.count('\n', 0, m.start())
        reason = ''
        for cand in (ln, ln - 1):
            if 0 <= cand < len(src_lines):
                a = ALLOW_RE.search(src_lines[cand])
                if a:
                    reason = a.group(1).strip(); break
        if reason:
            continue
        hits.append((f, ln + 1, src_lines[ln].rstrip()))

if scanned_files == 0 or calls == 0:
    print('❌ input-surface-border：**一个 TextInput/TextArea 都没扫到** —— 这是白绿'
          '（路径/正则与真源脱节），先修本脚本再信它')
    sys.exit(2)

for f, ln, text in hits:
    rel = f[len(root) + 1:] if f.startswith(root + '/') else f
    print('  ❌ %s:%d' % (rel, ln))
    print('       %s' % text[:150])

if not hits:
    print('✅ input-surface-border：扫到 %d 个 TextInput/TextArea（%d 个文件），'
          '用 input 面填充者**都自带结构发丝**' % (calls, scanned_files))
    sys.exit(0)

print()
print('❌ input-surface-border：%d 处输入框用 `surface.input`/`SURFACE_COMPOSER` 填充却**无 `.border(...)`**'
      % len(hits))
print('   后果：`surface.input` 与浮层底 `surface.overlay` 同属 RUNG_CARD（逐字节同色）⇒ 容器**完全不可见**；')
print('         编译零警告、其它测试全抓不到（只有真机截图能看出来）。')
print('   修法：加 `.border({ width: STROKE_HAIRLINE, color: hairlineOf(p) })`，')
print('         `p` 走**记忆化色板**（⛔ 别新增 `this.pal()`/`palOnce()` 调用点 —— 性能预算 ⑦ B 线顶格）。')
print('   确需无边框 ⇒ 在其行或上一行写：// allow-input-noborder: <理由>')
sys.exit(1)
PY

# ── mutation 自证（改本脚本或复用判据时**必须**跑一遍）────────────────────────────
#   ① 注入必红样本：造一个临时目录，放一个 `TextInput({...}).backgroundColor(surfaceFillOf(p,'surface.input'))`
#      且**无** `.border(...)` 的 `.ets` ⇒ `SCAN_DIRS=<tmp> bash tools/lint/input-surface-border.sh` **必须红**（退出 1）；
#   ② 同副本补上 `.border(...)` ⇒ **必须绿**（退出 0）；
#   ③ 空目录 ⇒ **必须红**（退出 2，零扫描白绿防线）。
#   ④ 注释里只写 `.border(` 而代码没有 ⇒ **必须红**（剥注释防线）。

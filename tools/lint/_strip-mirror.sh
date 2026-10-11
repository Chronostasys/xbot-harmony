#!/usr/bin/env bash
# _strip-mirror.sh —— 共用：把源码里的**注释替换成等长空白**做"镜像"，供判据在镜像上扫描。
# 为什么：本仓明文「**注释里记录色值/role/API 名是允许且鼓励的**」⇒ 注释不是代码。
# 纪律：① **保留换行**（行号不漂移，本仓已入库 GOTCHA）；② 字符串里的 `//`（如 `'xbot://a'`）**不剥**；
#       ③ 用**状态机**实现，不用"字符后是否有冒号"这类启发式（曾误伤 URL / 模板串）。
# 用法：source "$HERE/_strip-mirror.sh"; mirror_comments <镜像根> <目录1> [目录2 ...]   # 需先设 ROOT
mirror_comments() {
  local out="$1"; shift
  mkdir -p "$out"
  python3 - "$ROOT" "$out" "$@" <<'PYSTRIP'
import os, sys
root, out = sys.argv[1], sys.argv[2]
def strip(src):
    res = []; i = 0; n = len(src); st = 0; q = ''
    while i < n:
        c = src[i]; c2 = src[i + 1] if i + 1 < n else ''
        if st == 0:
            if c == '"' or c == "'" or c == chr(96):
                st = 3; q = c; res.append(c); i += 1; continue
            if c == '/' and c2 == '/':
                st = 1; res.append('  '); i += 2; continue
            if c == '/' and c2 == '*':
                st = 2; res.append('  '); i += 2; continue
            res.append(c); i += 1; continue
        if st == 1:
            res.append(c if c == chr(10) else ' '); 
            if c == chr(10): st = 0
            i += 1; continue
        if st == 2:
            if c == '*' and c2 == '/': st = 0; res.append('  '); i += 2; continue
            res.append(c if c == chr(10) else ' '); i += 1; continue
        if c == chr(92):
            res.append(c)
            if c2: res.append(c2)
            i += 2; continue
        if c == q: st = 0
        res.append(c); i += 1
    return ''.join(res)
for d in sys.argv[3:]:
    for dp, _dn, fns in os.walk(d):
        for fn in fns:
            if not fn.endswith(('.ets', '.ts')): continue
            p = os.path.join(dp, fn)
            dst = os.path.join(out, os.path.relpath(p, root))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, 'w', encoding='utf-8').write(strip(open(p, encoding='utf-8').read()))
PYSTRIP
}

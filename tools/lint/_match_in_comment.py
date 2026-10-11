#!/usr/bin/env python3
"""判据共用：**该字节偏移是否落在注释内**。

用法：`_match_in_comment.py <file> <byte_offset>` ⇒ 在注释内退 0，否则退 1（便于 shell `if`）。
为什么需要：本仓明文「注释里记录色值/role/API 名是**允许且鼓励**的」⇒ 注释不是代码。
⛔ 不用"行首是否是 `*`/`//`"这类启发式（会漏**行尾注释**与**块注释中间行**）。
⛔ 也**不在 python 里重放调用方的正则**（ERE 与 python `re` 语义不同 ⇒ 过滤会 fail-open，
   实测踩过：B 类注释命中没被滤掉）。⇒ 偏移由调用方的 `grep -b -o` 提供，本脚本只做"区间判定"。
实现用**状态机**（字符串里的 `//`（如 `'xbot://a'`）**不剥**），与 `_strip-mirror.sh` 同一口径。
"""
import sys


def comment_ranges(src):
    """返回 [(start, end), ...]：注释区间（start 含、end 不含）。"""
    out = []
    i = 0
    n = len(src)
    st = 0  # 0=code 1=line 2=block 3=string
    q = ''
    start = 0
    while i < n:
        c = src[i]
        c2 = src[i + 1] if i + 1 < n else ''
        if st == 0:
            if c == '"' or c == "'" or c == '`':
                st, q = 3, c
                i += 1
                continue
            if c == '/' and c2 == '/':
                st, start = 1, i
                i += 2
                continue
            if c == '/' and c2 == '*':
                st, start = 2, i
                i += 2
                continue
            i += 1
            continue
        if st == 1:
            if c == '\n':
                out.append((start, i))
                st = 0
            i += 1
            continue
        if st == 2:
            if c == '*' and c2 == '/':
                out.append((start, i + 2))
                st = 0
                i += 2
                continue
            i += 1
            continue
        if c == '\\':
            i += 2
            continue
        if c == q:
            st = 0
        i += 1
    if st in (1, 2):
        out.append((start, n))
    return out


def main():
    path, off = sys.argv[1], int(sys.argv[2])
    with open(path, encoding='utf-8') as fh:
        src = fh.read()
    for a, b in comment_ranges(src):
        if a <= off < b:
            return 0
    return 1


if __name__ == '__main__':
    sys.exit(main())

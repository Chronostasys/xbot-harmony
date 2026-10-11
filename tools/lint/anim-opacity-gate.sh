#!/usr/bin/env bash
# anim-opacity-gate.sh —— 「**可读性不得是动画的函数**」类级判据（用户亲报缺陷的防线）
#
# 事故（2026-10-11，用户亲报"白主题正文看不清"）：
#   `components/MessageRow.ets` 把**静息态**写成不可见 —— `@State entered=false` +
#   `.opacity(this.entered ? 1 : 0)` + `onAppear(()=>{ … animateTo(animMsgIn(), ()=>entered=true) })`。
#   动画被打断 / `onAppear` 未触发 ⇒ **永久停在 ≈13% 不透明度**（实测反解 α≈0.13，正文对底 1.32:1）。
#   **web 权威恰好相反**：`web/src/index.css:683-714` 的 `@keyframes msgIn` **无 `forwards`**
#   ⇒ 元素自身 opacity 仍 1 ⇒ 动画不跑就停在 1（**天然 fail-safe**）。宿主写反了。
#   同罪第二处：`pages/Index.ets` 切会话把**整张列表** .opacity 置 0.001 再 animateTo 回 1（已修）。
#
# 规则：
#   **A（硬红）**：静息态被写成"隐藏"。三条：
#     A1 `.opacity(<三元>)` 出现 `? 1 : 0` / `? 0 : 1`（隐形态即静息态）。
#        例外：`? 0 : <非0>` 之类**非隐藏**语义不误伤。
#     A2 `.visibility(<三元含 Hidden>)` **且该三元的判据字段是"动画驱动字段"**（在 `animateTo(...)`
#        / `anim(...)` 内被赋值）⇒ 静息隐藏 + 靠动画恢复 = 本缺陷类。
#        ⛔ **为什么必须带"动画驱动字段"限定**（实测证据，2026-10-11）：**裸形态**在真仓唯一命中是
#           `pages/Index.ets` 的"加载更早"头项 spinner —— `.visibility(this.loadingMore ? Visible : Hidden)`：
#           判据字段 `loadingMore` **不在任何动画闭包内**，静息隐藏对 spinner 是**正确 UI**，不是本缺陷类。
#           ⇒ 裸形态是**假阳性制造机**（我自己的自检"合法样本不误报"就会挂）。
#           想按裸形态跑：`bash tools/lint/anim-opacity-gate.sh --broad-visibility`（见下）。
#     A3 **字面量隐藏**：`.scale({x:0,y:0})` / `.height(0)` / `.width(0)` —— 静息态被写成"零尺寸"。
#   **B（警告）**：某字段**在 `animateTo(...)`/`anim(...)` 内被赋值**，且该字段**直接喂给 `.opacity(this.X)`**
#        ⇒ 不透明度由动画驱动 ⇒ 动画被中断则停在**当时值**（可能不可见）。
#        ⚠️ 与 A 不同，B 有**合法用法**（一次性过渡：初始可见 → 动画到 0，如开屏退出淡出；
#        失败方向是"停在可见"，不是不可读）⇒ 警告级 + 白名单 `tools/lint/anim-opacity-allowlist.txt`。
#
# ⚠️ 实现纪律（本仓反复踩的"判据 ≠ 信号"）：**先剥注释**（且**保留换行** ⇒ 报的行号能在真源码里
#    直接 grep 到！旧实现把块注释压掉 ⇒ 行号漂移 ~350 行）；只取**调用片段**；**零扫描判红**（白绿防线）；
#    扫描器**自证**（`--self-test` 夹具 + `--scan-report` 打印扫了哪些文件、逐形态分布）。
#
# 用法：
#   bash tools/lint/anim-opacity-gate.sh              # 检测（A 红 + B 警告）
#   bash tools/lint/anim-opacity-gate.sh --strict     # B 也判红（本仓门禁用 A 级硬红 + B 级警告）
#   bash tools/lint/anim-opacity-gate.sh --self-test   # 夹具自检（含 A2/A3 必红 + 合法不误报）
#   bash tools/lint/anim-opacity-gate.sh --scan-report # 扫描器自证（文件清单 + 逐形态分布）
#   bash tools/lint/anim-opacity-gate.sh --broad-visibility  # A2 用**裸形态**（会把良性 spinner 也报出来）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
: "${XC_ETS_DIRS:=$ROOT/entry/src/main/ets/components:$ROOT/entry/src/main/ets/pages}"
: "${XC_ALLOW:=$HERE/anim-opacity-allowlist.txt}"
export XC_ETS_DIRS XC_ALLOW
MODE="check"
for a in "$@"; do
  case "$a" in
    --strict) MODE="strict" ;;
    --self-test) MODE="selftest" ;;
    --scan-report) MODE="report" ;;
    --broad-visibility) export XC_BROAD_VIS=1 ;;
    "") ;;
    *) echo "用法: bash tools/lint/anim-opacity-gate.sh [--strict|--self-test|--scan-report|--broad-visibility]"; exit 2 ;;
  esac
done

run_scan() {
  python3 - <<'PY'
import os, re, sys

def strip_comments(t):
    """剥注释，**保留换行**（⇒ 报出的行号 = 真源码行号，可直接 grep 定位）。"""
    out=[];i=0;n=len(t)
    while i<n:
        c=t[i]
        if c=='/' and i+1<n:
            if t[i+1]=='/':
                j=t.find('\n',i); i=n if j<0 else j; continue
            if t[i+1]=='*':
                j=t.find('*/',i+2)
                if j<0: break
                out.append('\n'*t.count('\n',i,j))   # 块注释里的换行照数，行号不漂移
                i=j+2; continue
        out.append(c); i+=1
    return ''.join(out)

def anim_fields(src):
    """在 `animateTo(...)` / `anim(...)` 闭包内被赋值的 `this.X` 字段集合。"""
    fields=set()
    for m in re.finditer(r'\b(animateTo|anim)\s*\(', src):
        start=m.end()-1; depth=0; i=start
        while i < len(src):
            if src[i]=='(': depth+=1
            elif src[i]==')':
                depth-=1
                if depth==0: break
            i+=1
        for f in re.finditer(r'this\.([A-Za-z_]\w*)\s*=', src[start:i+1]):
            fields.add(f.group(1))
    return fields

dirs=[d for d in os.environ['XC_ETS_DIRS'].split(':') if d]
broad_vis = os.environ.get('XC_BROAD_VIS')=='1'
allow=set()
if os.path.isfile(os.environ['XC_ALLOW']):
    for ln in open(os.environ['XC_ALLOW'],encoding='utf-8'):
        ln=ln.split('#')[0].strip()
        if ln: allow.add(ln)

# ── 逐形态计数（扫描器自证用：证明每条规则**真的被跑过**，而不是"零命中=绿"）─────────
FORMS = [
    ('opacity',      re.compile(r'\.opacity\(')),
    ('opacity_tri',  re.compile(r'\.opacity\(\s*[^();]{0,80}\?\s*[01]\s*:\s*[01]\s*\)')),
    ('visibility',   re.compile(r'\.visibility\(')),
    ('vis_tri_hid',  re.compile(r'\.visibility\(\s*[^();]{0,120}Visibility\.Hidden[^();]*\)')),
    ('scale_zero',   re.compile(r'\.scale\(\s*\{[^}]*x\s*:\s*0(?:\.0+)?\s*,\s*y\s*:\s*0(?:\.0+)?[^}]*\}\s*\)')),
    ('wh_zero',      re.compile(r'\.(?:height|width)\(\s*0(?:\.0+)?\s*\)')),
]
form_tot = {k: 0 for k,_ in FORMS}

files=[]; scan_report=[]
hits_a=[]; hits_b=[]
for d in dirs:
    for root,_,fns in os.walk(d):
        for fn in sorted(fns):
            if not fn.endswith('.ets'): continue
            p=os.path.join(root,fn)
            raw=open(p,encoding='utf-8').read()
            src=strip_comments(raw)
            rel=os.path.relpath(p, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(d)))))
            files.append(rel)
            n_op=len(re.findall(r'\.opacity\(', src))
            af=anim_fields(src)
            n_b=0
            counts={}
            for k,rx in FORMS:
                c=len(rx.findall(src)); counts[k]=c; form_tot[k]+=c
            # A1：opacity 三元隐藏（`? 1 : 0` / `? 0 : 1`）
            for m in re.finditer(r'\.opacity\(\s*[^();]{0,80}\?\s*([01])\s*:\s*([01])\s*\)', src):
                if (m.group(1),m.group(2)) in (('1','0'),('0','1')):
                    ln=src[:m.start()].count('\n')+1
                    hits_a.append((rel,ln,'A1',m.group(0)[:60], os.path.basename(p)))
            # A2：visibility 三元含 Hidden
            for m in re.finditer(r'\.visibility\(\s*([^();]{0,120}?)\?\s*[^();]{0,60}Visibility\.Hidden[^();]*\)', src):
                sel=m.group(1)
                animated = any(('this.'+f) in sel for f in af)
                if broad_vis or animated:
                    ln=src[:m.start()].count('\n')+1
                    tag = 'A2' if animated else 'A2b'   # A2b = 裸形态命中的**良性候选**（仅 --broad-visibility）
                    hits_a.append((rel,ln,tag,m.group(0)[:60], os.path.basename(p)))
            # A3：字面量零尺寸（scale x:0,y:0 / height(0) / width(0)）
            for rx in (FORMS[4][1], FORMS[5][1]):
                for m in rx.finditer(src):
                    ln=src[:m.start()].count('\n')+1
                    hits_a.append((rel,ln,'A3',m.group(0)[:60], os.path.basename(p)))
            # B：字段在 anim 内被赋值 + 直接喂 .opacity
            for m in re.finditer(r'\.opacity\(\s*this\.([A-Za-z_]\w*)\s*\)', src):
                if m.group(1) in af:
                    ln=src[:m.start()].count('\n')+1
                    n_b+=1
                    hits_b.append((rel,ln,m.group(1), os.path.basename(p)))
            scan_report.append((rel,n_op,len(af),n_b,counts))
if len(files)==0:
    print('ZERO_SCAN'); sys.exit(0)
print('FILES\t%d' % len(files))
for rel,n_op,n_af,n_b,counts in scan_report:
    if n_op or n_af or n_b or any(counts.values()):
        print('SCAN\t%s\topacity=%d\tanim_fields=%d\tB_hits=%d\tforms=%s' % (
            rel,n_op,n_af,n_b,
            ','.join('%s:%d'%(k,counts[k]) for k,_ in FORMS if counts[k])))
for rel,ln,tag,txt,base in hits_a:
    print(('ALLOWED_A' if base in allow else 'HIT_A')+'\t%s:%d\t[%s] %s' % (rel,ln,tag,txt))
for rel,ln,fld,base in hits_b:
    print(('ALLOWED_B' if base in allow else 'HIT_B')+'\t%s:%d\tfield=%s' % (rel,ln,fld))
print('FORMS\t' + '\t'.join('%s=%d'%(k,form_tot[k]) for k,_ in FORMS))
print('SUMMARY\t%d\t%d\t%d' % (len(files),len(hits_a),len(hits_b)))
PY
}

if [ "$MODE" = "selftest" ]; then
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  mkdir -p "$TMP/components"
  # 必红样本 1：MessageRow 旧写法（三元隐藏 + onAppear 里置真）
  cat > "$TMP/components/Bad.ets" <<'E'
@State entered: boolean = false;
build() { Column() { Text('x') }.opacity(this.entered ? 1 : 0) }
aboutToAppear() { animateTo({ duration: 200 }, () => { this.entered = true; }) }
E
  # 必红样本 2：字段在 anim 内赋值 + 直接喂 opacity（危险方向）
  cat > "$TMP/components/BadB.ets" <<'E'
@State fade: number = 1;
private go() { this.fade = 0.001; anim(() => { this.fade = 1; }); }
build() { Column() { Text('y') }.opacity(this.fade) }
E
  # 必红样本 3（A2）：静息隐藏 + 判据字段**在动画闭包内**被赋值 ⇒ 本缺陷类
  cat > "$TMP/components/BadVis.ets" <<'E'
@State markUp: boolean = false;
private play() { this.markUp = false; animateTo({ duration: 220 }, () => { this.markUp = true; }); }
build() { Text('v').visibility(this.markUp ? Visibility.Visible : Visibility.Hidden) }
E
  # 必红样本 4（A3）：字面量零尺寸
  cat > "$TMP/components/BadZero.ets" <<'E'
build() { Column() { Text('w') }.height(0).width(0).scale({ x: 0, y: 0 }) }
E
  # 合法样本：静态 1 / 常量 / 与动画无关的字段 / **良性 spinner 的 Visibility 三元**（非动画判据）
  cat > "$TMP/components/Good.ets" <<'E'
@State other: number = 1;
@State loadingMore: boolean = false;
build() {
  Column() {
    Text('z').opacity(entryRestOpacity()).opacity(this.other)
    LoadingProgress().visibility(this.loadingMore ? Visibility.Visible : Visibility.Hidden)
  }.height('100%')
}
E
  OUT="$(XC_ETS_DIRS="$TMP/components" XC_ALLOW="$TMP/none.txt" run_scan)"
  fail=0
  echo "$OUT" | grep -q "^HIT_A.*\[A1\]" || { echo "❌ 自检失败：三元隐藏未报（假绿）"; fail=1; }
  echo "$OUT" | grep -q "field=fade" || { echo "❌ 自检失败：动画驱动透明度未报"; fail=1; }
  echo "$OUT" | grep -q "^HIT_A.*\[A2\]" || { echo "❌ 自检失败：可见性静息隐藏（动画驱动判据）未报"; fail=1; }
  echo "$OUT" | grep -q "^HIT_A.*\[A3\]" || { echo "❌ 自检失败：字面量零尺寸未报"; fail=1; }
  # ⚠️ 「合法样本被误报」只看**违规行**（HIT_*/ALLOWED_*），⛔ 别把 SCAN 报告里的文件名当违规
  #    （我第一版就是这么误判的 —— 又一次"断言 ≠ 信号"）。
  echo "$OUT" | grep -E "^(HIT_A|HIT_B|ALLOWED_A|ALLOWED_B)" | grep -q "Good.ets" && { echo "❌ 自检失败：合法样本被误报"; fail=1; }
  echo "$OUT" | grep -q "^FILES	5" || { echo "❌ 自检失败：文件计数错（可能零扫描）"; fail=1; }
  # 行号不漂移自证：BadVis.ets 的 Visibility 在第 3 行
  echo "$OUT" | grep -q "BadVis.ets:3" || { echo "❌ 自检失败：行号漂移（剥注释未保留换行）"; fail=1; }
  [ "$fail" = 0 ] && { echo "✅ anim-opacity 自检通过（A1 三元隐藏 / A2 可见性静息隐藏 / A3 零尺寸 / B 动画驱动 / 合法不报 / 计数对 / 行号准）"; exit 0; }
  exit 1
fi

OUT="$(run_scan)"
if printf '%s' "$OUT" | grep -q '^ZERO_SCAN'; then
  echo "❌ 零扫描（未找到任何 .ets）⇒ 判红（白绿防线）"; exit 1
fi
SUM="$(printf '%s\n' "$OUT" | grep '^SUMMARY' | head -1)"
NFILES="$(printf '%s' "$SUM" | cut -f2)"; NA="$(printf '%s' "$SUM" | cut -f3)"; NB="$(printf '%s' "$SUM" | cut -f4)"
A_LIST="$(printf '%s\n' "$OUT" | grep '^HIT_A' | cut -f2,3)"
B_LIST="$(printf '%s\n' "$OUT" | grep '^HIT_B' | cut -f2,3)"
FORMS="$(printf '%s\n' "$OUT" | grep '^FORMS' | cut -f2)"

if [ "$MODE" = "report" ]; then
  echo "=== 扫描器自证（扫了哪些文件 / 命中分布 / 逐形态计数）==="
  printf '%s\n' "$OUT" | grep '^SCAN' | sed 's/^SCAN\t//;s/\t/  /g' | sed 's/^/  /'
  echo "  逐形态总数：${FORMS}"
  echo "  合计：文件 ${NFILES}；A 命中 ${NA}；B 命中 ${NB}（A2 模式：$([ "${XC_BROAD_VIS:-0}" = "1" ] && echo '裸形态（含良性 A2b）' || echo '精确形态=判据字段须为动画驱动')）"
  exit 0
fi

echo "=== 「可读性不得是动画的函数」判据（⑨）==="
if [ "${NA:-0}" -gt 0 ]; then
  printf '%s\n' "$A_LIST" | while IFS= read -r l; do [ -n "$l" ] && echo "  ❌ [A] 静息态被写成隐藏：${l}"; done
fi
if [ "${NB:-0}" -gt 0 ]; then
  printf '%s\n' "$B_LIST" | while IFS= read -r l; do [ -n "$l" ] && echo "  ⚠ [B] 不透明度由动画驱动：${l}（若动画可被中断 ⇒ 停在当时值；合法的一次性过渡请登记 tools/lint/anim-opacity-allowlist.txt）"; done
fi
if [ "${NA:-0}" -eq 0 ] && [ "${NB:-0}" -eq 0 ]; then
  echo "  ✅ 无命中（扫 ${NFILES} 个 .ets：无 A1 三元隐藏 / 无 A2 可见性静息隐藏 / 无 A3 零尺寸 / 无 B 动画驱动 .opacity）"
else
  echo "  小结：A（硬红）${NA} · B（警告）${NB} · 扫 ${NFILES} 个 .ets"
fi
[ "${NA:-0}" -gt 0 ] && exit 1
[ "$MODE" = "strict" ] && [ "${NB:-0}" -gt 0 ] && exit 1
exit 0

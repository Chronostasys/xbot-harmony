#!/usr/bin/env bash
# readability-scan.sh —— 「可读性」**真机渲染后**采样器（一次性协议的可复跑实现）
#
# 背景：令牌层矩阵只保证"角色对"达标；**渲染后**还会被不透明度 / 混合 / 玻璃底 /
#   字号缩放 / 动画中间态二次削弱（本仓已出过 `MessageRow` 那单：正文最暗 #D4D4D6 压
#   #F2F2F2 = 1.32:1，而同一帧其它文字 21:1）。⇒ 必须量**真实像素**。
#
# 设计（为什么按**选择器**而不是硬编码框位）：
#   台账 `readability-ledger.tsv` 记的是"哪个节点"，本脚本用 `uitest dumpLayout` 取该节点的
#   **真实 bounds**，再在截图里量那个框 ⇒ 布局/分辨率/主题变化不会把它打成假红假绿。
#
# ⛔ 判据纪律（本仓反复踩的坑，逐条落实）：
#   · **零扫描判红**：一条台账都没匹配上 ⇒ `ZERO_SCAN` + exit 1（白绿防线）。
#   · **采样失败必须显式**：图缺失 / 布局缺失 / 框越界 / 框内无像素 ⇒ `SAMPLE_INVALID`，
#     计入失败并 exit 1 —— **绝不当"通过"**。
#   · **只取调用片段 / 剥注释**：台账解析剥 `#` 注释行；不猜"行里第一个引号"。
#   · 阈值**只能取自台账阶梯**（4.5 / 3.0 / 2.0）—— 本脚本**不**自带第二套阈值。
#
# 用法：
#   # ① 已有截图 + 布局（离线复算；推荐先这么自证脚本本身）
#   bash tools/device/readability-scan.sh <shot.png|jpeg> --layout <lay.json>
#   # ② 直接拉设备（⚠️ 需设备空闲：会 snapshot + dumpLayout，**不改任何状态**）
#   bash tools/device/readability-scan.sh --pull
#   # ③ 只列台账（不采样）
#   bash tools/device/readability-scan.sh --list
#
# 输出：逐条 `PASS|FAIL|SAMPLE_INVALID` + 末尾"达标/不达标清单"，并写 `--out <tsv>`。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LEDGER="${READABILITY_LEDGER:-$HERE/readability-ledger.tsv}"
SHOT=""; LAYOUT=""; OUT=""; MODE="scan"

while [ $# -gt 0 ]; do
  case "$1" in
    --layout) LAYOUT="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --ledger) LEDGER="${2:-}"; shift 2 ;;
    --pull) MODE="pull"; shift ;;
    --list) MODE="list"; shift ;;
    -h|--help) sed -n '1,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) SHOT="$1"; shift ;;
  esac
done

if [ "$MODE" = "list" ]; then
  echo "台账：$LEDGER"
  grep -v '^#' "$LEDGER" | grep -v '^$' | awk -F'\t' 'NR>1{printf "  %-6s %-9s %-28s %-26s %s\n",$1,$2,substr($4,1,28),$5,$6}'
  exit 0
fi

if [ "$MODE" = "pull" ]; then
  command -v hdc >/dev/null 2>&1 || { echo "❌ --pull 需要 hdc（先 source ~/ohos-cli/env.sh）"; exit 2; }
  T="$(hdc list targets 2>/dev/null | grep ':' | head -1)"
  [ -z "$T" ] && { echo "❌ --pull 找不到设备"; exit 2; }
  TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
  hdc -t "$T" shell "snapshot_display -f /data/local/tmp/rds.jpeg" >/dev/null 2>&1
  hdc -t "$T" file recv /data/local/tmp/rds.jpeg "$TMPD/shot.jpeg" >/dev/null 2>&1
  hdc -t "$T" shell "uitest dumpLayout -p /data/local/tmp/rds.json" >/dev/null 2>&1
  hdc -t "$T" file recv /data/local/tmp/rds.json "$TMPD/lay.json" >/dev/null 2>&1
  SHOT="$TMPD/shot.jpeg"; LAYOUT="$TMPD/lay.json"
fi

[ -n "$SHOT" ] || { echo "用法见脚本头（或 --list）"; exit 2; }
[ -f "$SHOT" ] || { echo "❌ 截图不存在：$SHOT"; exit 2; }
[ -n "$LAYOUT" ] || { echo "❌ 缺 --layout <dumpLayout.json>（框位必须来自真布局，⛔ 不许硬编码）"; exit 2; }
[ -f "$LAYOUT" ] || { echo "❌ 布局不存在：$LAYOUT"; exit 2; }
[ -f "$LEDGER" ] || { echo "❌ 台账不存在：$LEDGER"; exit 2; }
[ -z "$OUT" ] && OUT="${SHOT%.*}.readability.tsv"

python3 - "$SHOT" "$LAYOUT" "$LEDGER" "$OUT" <<'PY'
import subprocess, struct, sys, json, collections, os

shot, layp, ledger, outp = sys.argv[1:5]

# ── 0) 台账（剥 # 注释行；列数必须齐）────────────────────────────────────────
rows=[]
bad_ledger=[]
for ln in open(ledger, encoding='utf-8'):
    ln=ln.rstrip('\n')
    if not ln.strip() or ln.lstrip().startswith('#'): continue
    c=ln.split('\t')
    if c[0]=='id': continue
    if len(c) < 7: bad_ledger.append(ln); continue
    rows.append(c[:7])
if bad_ledger:
    print('❌ 台账行格式错（列数 < 7）：')
    for b in bad_ledger[:5]: print('   '+b[:120])
    sys.exit(1)
if len(rows)==0:
    print('❌ ZERO_LEDGER：台账一条有效样本都没有 ⇒ 判红（白绿防线）'); sys.exit(1)

LADDER={'4.5':'body','3.0':'large','2.0':'weak'}
bad_thr=[r for r in rows if r[5] not in LADDER]
if bad_thr:
    print('❌ 台账阈值不在阶梯 {4.5,3.0,2.0} 内（⛔ 不许自造/放宽阈值）：')
    for r in bad_thr[:5]: print('   %s min_ratio=%s' % (r[0], r[5]))
    sys.exit(1)

# ── 1) 布局 → 选择器匹配（text= 前缀 / id= 精确）─────────────────────────────
lay=json.load(open(layp, encoding='utf-8'))
nodes=[]
def walk(n):
    a=n.get('attributes',{})
    t=a.get('text',''); b=a.get('bounds','')
    if b:
        try:
            x0,y0=map(int, b.split('][')[0].strip('[').split(','))
            x1,y1=map(int, b.split('][')[1].strip(']').split(','))
            nodes.append({'type':a.get('type',''),'text':t,'id':a.get('id',''),
                          'acc':a.get('accessibilityId',''),'box':(x0,y0,x1,y1)})
        except Exception:
            pass
    for c in n.get('children',[]): walk(c)
walk(lay)

def find(sel):
    if sel.startswith('text='):
        q=sel[5:]
        exact=[n for n in nodes if n['text']==q and n['box'][2]>n['box'][0] and n['box'][3]>n['box'][1]]
        if exact: return exact[0]
        pref=[n for n in nodes if n['text'].startswith(q) and n['box'][2]>n['box'][0] and n['box'][3]>n['box'][1]]
        return pref[0] if pref else None
    if sel.startswith('id='):
        q=sel[3:]
        for n in nodes:
            if n['id']==q or n['acc']==q: return n
        return None
    return None

# ── 2) 截图 → BMP（无 PIL；⚠️ HarmonyOS 截图 32bpp、负高度=自上而下）──────────
bmp='/tmp/_rds.bmp'
subprocess.run(['sips','-s','format','bmp',shot,'--out',bmp], capture_output=True)
if not os.path.isfile(bmp):
    print('❌ SAMPLE_INVALID(ALL)：截图转 BMP 失败：%s' % shot); sys.exit(1)
d=open(bmp,'rb').read()
off=struct.unpack('<I',d[10:14])[0]
w=struct.unpack('<i',d[18:22])[0]
hh=struct.unpack('<i',d[22:26])[0]
bpp=struct.unpack('<H',d[28:30])[0]//8
topdown=hh<0; H=abs(hh); stride=((w*bpp+3)//4)*4
def px(x,y):
    yy=y if topdown else H-1-y
    p=off+yy*stride+x*bpp
    return (d[p+2],d[p+1],d[p])
def lum(c): return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def lin(c):
    def f(v):
        v=v/255.0
        return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
    return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])
def contrast(a,b):
    la,lb=lin(a),lin(b); hi,lo=max(la,lb),min(la,lb)
    return (hi+0.05)/(lo+0.05)

results=[]; n_miss=0; n_invalid=0; n_fail=0; n_pass=0
for r in rows:
    rid,surface,state,sel,rolepair,minr,fclass = r
    node=find(sel)
    if node is None:
        n_miss+=1
        results.append((rid,surface,'SAMPLE_INVALID','selector 未命中: '+sel,'','','',''))
        continue
    x0,y0,x1,y1=node['box']
    if x0<0 or y0<0 or x1>w or y1>H or x1<=x0 or y1<=y0:
        n_invalid+=1
        results.append((rid,surface,'SAMPLE_INVALID','框越界/空框: [%d,%d][%d,%d] 图 %dx%d'%(x0,y0,x1,y1,w,H),'','','',''))
        continue
    hist=collections.Counter(); darkest=(999,None)
    for y in range(y0,y1):
        for x in range(x0,x1):
            c=px(x,y); hist[c]+=1
            l=lum(c)
            if l<darkest[0]: darkest=(l,c)
    if darkest[1] is None:
        n_invalid+=1
        results.append((rid,surface,'SAMPLE_INVALID','框内无像素','','','',''))
        continue
    txt=darkest[1]; bg=hist.most_common(1)[0][0]
    cr=contrast(txt,bg); want=float(minr)
    verdict='PASS' if cr >= want else 'FAIL'
    if verdict=='PASS': n_pass+=1
    else: n_fail+=1
    results.append((rid,surface,verdict,'#%02X%02X%02X'%txt,'#%02X%02X%02X'%bg,'%.2f'%cr,minr,'%s/%s[%s]'%(rolepair,fclass,'%s,%s,%s,%s'%node['box'])))

with open(outp,'w',encoding='utf-8') as f:
    f.write('id\tsurface\tverdict\ttext\tbg\tcontrast\tmin\tnote\n')
    for r in results:
        f.write('\t'.join(str(x) for x in r)+'\n')

print('=== 可读性真机采样（%s） ===' % os.path.basename(shot))
print('  台账 %d 条：命中 %d · 选择器未命中 %d · 框无效 %d' % (len(rows), len(rows)-n_miss, n_miss, n_invalid))
for r in results:
    flag={'PASS':'✓','FAIL':'✗','SAMPLE_INVALID':'⚠'}[r[2]]
    print('  %s %-6s %-9s %-15s %s  %s / %s (want ≥ %s)' % (flag, r[0], r[1], r[2], r[3], r[4], r[5], r[6]))
print()
if n_fail==0 and n_invalid==0 and n_miss==0:
    print('✅ 台账 %d 条全部达标（无 FAIL / 无 SAMPLE_INVALID）' % len(rows))
else:
    if n_fail:   print('❌ 不达标清单：' + ', '.join(r[0] for r in results if r[2]=='FAIL'))
    if n_invalid:print('❌ 无效采样（框越界/空框）：' + ', '.join(r[0] for r in results if r[2]=='SAMPLE_INVALID' and '框' in r[3]))
    if n_miss:   print('❌ 选择器未命中（当前界面没有这些节点 —— 逐面采样，一次一个面）：' + ', '.join(r[0] for r in results if r[2]=='SAMPLE_INVALID' and 'selector' in r[3]))
    print('   （⚠️ 报告/退出码：SAMPLE_INVALID **算失败**，⛔ 绝不当通过）')
print('  报告：%s' % outp)
sys.exit(0 if (n_fail==0 and n_invalid==0 and n_miss==0) else 1)
PY

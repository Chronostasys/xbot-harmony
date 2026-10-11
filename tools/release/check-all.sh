#!/usr/bin/env bash
# tools/release/check-all.sh —— **稳定版本一键验收校验**。
#
# 目的：把"能不能交给用户验收"变成一条命令，避免人肉判断。逐项打印 PASS/FAIL 表，
#       并在结尾给 RELEASE: READY / BLOCKED + 逐条阻塞原因（谁的问题）。
#
# ⛔ 本脚本**只调用** tools/tests/run.sh、tools/gate.sh，绝不修改它们，也不改任何源码。
# ⛔ 设备：只做**只读** dump（bm dump）；绝不碰用户会话。
# ⚠️ bash 3.2 + UTF-8 locale：含中文的字符串里变量一律写 ${var}（`${var}中文` 会被吞）。
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
cd "${ROOT}"

# hdc/hvigorw 需要鸿蒙 SDK 环境（登录 shell 已 source；这里兜底再 source，失败不致命）
if [ -n "${HOME:-}" ] && [ -f "${HOME}/ohos-cli/env.sh" ]; then
  # shellcheck disable=SC1090
  source "${HOME}/ohos-cli/env.sh" >/dev/null 2>&1 || true
fi

# ⛔ 临时产物一律放**仓库之外**（mktemp -d）：`trap` 只在正常退出/可捕获信号时跑，
#    被 SIGKILL/休眠就留垃圾 ⇒ 若写在仓库根目录会污染"工作区干净"判据（也曾被 git add -A 误收）。
OUT="$(mktemp -d "${TMPDIR:-/tmp}/xbot-release.XXXXXX")"
trap 'rm -rf "${OUT}"' EXIT INT TERM HUP
RESULTS="${OUT}/check.txt"
BLOCKERS="${OUT}/blockers.txt"
NOTES="${OUT}/notes.txt"
: > "${RESULTS}"; : > "${BLOCKERS}"; : > "${NOTES}"

# record <名称> <ok|fail> <说明> <归属线索>
record() {
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "${RESULTS}"
  if [ "$2" = "fail" ]; then
    printf '  ✗ %s\n      ↳ %s\n      ↳ 归属：%s\n' "$1" "$3" "$4" >> "${BLOCKERS}"
  fi
}

printf '稳定版本验收校验中…（会依次跑 run.sh / lint / check.sh / gate.sh，约 2-5 分钟）\n\n'

# ── ① 工作区干净 ────────────────────────────────────────────────────────────
dirty="$(git status --porcelain)"
if [ -z "${dirty}" ]; then
  record "工作区干净" ok "" ""
else
  dcount="$(printf '%s\n' "${dirty}" | grep -c . || true)"
  dfiles="$(printf '%s\n' "${dirty}" | head -12 | tr '\n' ' ')"
  record "工作区干净" fail "有 ${dcount} 处在途改动（未到稳定点）：${dfiles}" "在途改动者（git status 各文件）"
fi

# ── ② 全部已推送 ────────────────────────────────────────────────────────────
ahead="$(git log --oneline origin/main..HEAD 2>/dev/null | grep -c . || true)"
if [ "${ahead:-0}" -eq 0 ]; then
  record "已全部推送 origin/main" ok "无本地领先提交" ""
else
  first="$(git log --oneline origin/main..HEAD 2>/dev/null | head -5 | tr '\n' ' ')"
  record "已全部推送 origin/main" fail "本地领先 ${ahead} 个提交未 push：${first}" "需 push（等全部线收口后）"
fi

# ── ③ 离线三条 ──────────────────────────────────────────────────────────────
# ③a run.sh（⚠️ 首个红测试处即中止 ⇒ 这里解析输出聚合，并列出**未跑到**的测试）
rout="$(bash tools/tests/run.sh 2>&1)"; rrc=$?
rfail="$(printf '%s\n' "${rout}" | grep -E '[1-9][0-9]* (failed|失败)' || true)"
rts="$(printf '%s\n' "${rout}" | grep -E 'error TS' || true)"
if [ "${rrc}" -eq 0 ] && [ -z "${rfail}" ] && [ -z "${rts}" ]; then
  record "run.sh 纯逻辑测试" ok "全部通过" ""
else
  # 未跑到的测试文件（run.sh 在首个红处中止 ⇒ 之后的都没跑）
  unrun=""
  for f in tools/tests/*.test.ts; do
    [ -f "${f}" ] || continue
    stem="$(basename "${f}" .test.ts)"
    if ! printf '%s' "${rout}" | grep -q "${stem}"; then
      unrun="${unrun} ${stem}"
    fi
  done
  # run.sh 在**首个红**处中止 ⇒ 区分"编译失败（全都没跑）"与"某测试红后中止"
  if [ -n "${rts}" ]; then
    detail="❌ 编译失败（tsc 非 0）⇒ 测试均未执行：$(printf '%s\n' "${rts}" | head -4 | tr '\n' ' ')"
  else
    detail="失败测试：$(printf '%s\n' "${rfail}" | head -8 | tr '\n' ' ')"
    if [ -n "${unrun}" ]; then
      detail="${detail}｜未跑到（run.sh 首个红后中止）：$(printf '%s' "${unrun}" | cut -c1-240)"
    fi
  fi
  record "run.sh 纯逻辑测试" fail "${detail}" "各失败测试的作者（见 tools/tests/<name>.test.ts）"
fi

# ③b lint
lout="$(bash tools/lint/render-path.sh 2>&1)"; lrc=$?
if [ "${lrc}" -eq 0 ]; then
  record "lint（渲染路径门禁）" ok "" ""
else
  record "lint（渲染路径门禁）" fail "$(printf '%s\n' "${lout}" | grep -E '✗' | head -5 | tr '\n' ' ')" "components/pages 的裸解析调用者"
fi

# ③c check.sh
cout="$(bash tools/typecheck/check.sh 2>&1)"; crc=$?
if [ "${crc}" -eq 0 ]; then
  files="$(printf '%s\n' "${cout}" | grep -oE '[0-9]+ 个文件' | head -1)"
  record "check.sh（core 静态检查）" ok "${files}" ""
else
  record "check.sh（core 静态检查）" fail "$(printf '%s\n' "${cout}" | grep -E 'error TS' | head -6 | tr '\n' ' ')" "报错文件所在线的作者"
fi

# ── ④ 真门禁 gate.sh（含假绿识别 + ④ 耗时）──────────────────────────────────
gout="$(bash tools/gate.sh 2>&1)"; grc=$?
green="$(printf '%s\n' "${gout}" | grep -c '真门禁全绿' || true)"
# ④ 的耗时（ArkTS 编译）：'BUILD SUCCESSFUL in <N> s <M> ms'
bsline="$(printf '%s\n' "${gout}" | grep -oE 'BUILD SUCCESSFUL in [0-9]+ s( [0-9]+ ms)?' | head -1)"
bsecs=0
if [ -n "${bsline}" ]; then
  bsecs="$(printf '%s' "${bsline}" | grep -oE '[0-9]+ s' | grep -oE '[0-9]+' | head -1)"
fi
if [ "${green:-0}" -ge 1 ] && [ "${bsecs:-0}" -ge 5 ]; then
  record "gate.sh 真门禁" ok "全绿；④ ArkTS ${bsline}" ""
elif [ "${green:-0}" -ge 1 ] && [ "${bsecs:-0}" -lt 5 ]; then
  record "gate.sh 真门禁" fail "④ 仅 ${bsline}（<5s = 增量空转**假绿**）⇒ 需重跑" "门禁/构建缓存"
else
  ga="$(printf '%s\n' "${gout}" | grep -E 'Error Message:|❌|BUILD FAILED' | head -6 | tr '\n' ' ')"
  record "gate.sh 真门禁" fail "未全绿：${ga}" "报错文件（ArkTS 报错路径内的线）"
fi

# ── ⑤ 产物（签名 HAP）──────────────────────────────────────────────────────
OUTDIR="entry/build/default/outputs/default"
signed="${OUTDIR}/entry-default-signed.hap"
unsigned="${OUTDIR}/entry-default-unsigned.hap"
if [ -f "${signed}" ]; then
  sz="$(du -h "${signed}" 2>/dev/null | cut -f1)"
  bt="$(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "${signed}" 2>/dev/null || date -r "${signed}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null)"
  record "签名 HAP 产物" ok "${signed}（${sz}，构建于 ${bt}）" ""
elif [ -f "${unsigned}" ]; then
  record "签名 HAP 产物" fail "只有 ${unsigned}（无签名版）⇒ 装机报 sign info inconsistent；用 ~/ohos-cli/deploy.sh 装机" "签名配置"
else
  record "签名 HAP 产物" fail "无 HAP 产物（${OUTDIR}/*.hap）⇒ 先 hvigorw assembleHap" "构建"
fi

# ── ⑥ 设备（**独立提示**：不影响 RELEASE: READY 主判定；装机验收前需用户开设备）──
if command -v hdc >/dev/null 2>&1; then
  targets="$(hdc list targets 2>&1 | tr '\n' ' ')"
  if printf '%s' "${targets}" | grep -q '127.0.0.1:5555'; then
    vc="$(hdc -t 127.0.0.1:5555 shell "bm dump -n com.chronostasys.xbot" 2>&1 | grep -oE '"versionCode": [0-9]+' | sort -u | head -3 | tr '\n' ' ')"
    record "设备在线 127.0.0.1:5555" ok "已装版本 ${vc}" ""
  else
    record "设备在线 127.0.0.1:5555" warn "设备离线：装机验收前需用户开设备（当前 targets：${targets}）—— 独立提示，不影响主判定" "环境"
  fi
else
  record "设备在线 127.0.0.1:5555" warn "未找到 hdc（source ~/ohos-cli/env.sh）—— 独立提示，不影响主判定" "环境"
fi

# ── ⑦ 未决项清点（待用户拍板）──────────────────────────────────────────────
# 统计口径：grep 关键词「待用户拍板」/「待拍板」，路径 docs/**（含 docs/PATCHES/**）。
# 用途：验收时据此**核对 AskUser 问题清单是否穷尽**。
pend="$(grep -rIcE '待用户拍板|待拍板' docs 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')"
pendfiles="$(grep -rIlE '待用户拍板|待拍板' docs 2>/dev/null | tr '\n' ' ')"
record "未决项（待用户拍板）" ok "共 ${pend} 条；口径=grep -rIcE '待用户拍板|待拍板' docs（${pendfiles}）" ""

# ── ⑧ 验收材料（供用户"看得到"；⚠️ 不参与门禁判定，是否 BLOCKED 由指挥者定）──
mock_missing=""
[ -d docs/mockups ] || mock_missing="${mock_missing} docs/mockups/"
[ -f docs/REDESIGN.md ] || mock_missing="${mock_missing} docs/REDESIGN.md"
if [ -z "${mock_missing}" ]; then
  record "验收材料 docs/mockups + REDESIGN.md" ok "齐备" ""
else
  record "验收材料 docs/mockups + REDESIGN.md" warn "⚠️ 验收材料缺失：${mock_missing}（供用户"看得到"的样张/规范）" "设计/文档线"
fi
if [ -f docs/PATCHES/background-notify.md ]; then
  record "AskUser 决策材料 background-notify.md" ok "在（后台接收方案待用户拍板）" ""
else
  record "AskUser 决策材料 background-notify.md" warn "⚠️ 缺失 docs/PATCHES/background-notify.md（AskUser 决策材料）" "通知线" 
fi

# ── 打印表 ──────────────────────────────────────────────────────────────────
printf '==================== 稳定版本验收校验 ====================\n'
printf -- '%-26s %-4s %s\n' "检查项" "结果" "说明"
printf -- '%-26s %-4s %s\n' "--------------------------" "----" "--------------------------------------------------------------"
while IFS=$(printf '\t') read -r name verdict detail owner; do
  case "${verdict}" in
    ok) mark="✅" ;;
    warn) mark="⚠️" ;;
    *) mark="❌" ;;
  esac
  printf -- '%-26s %s  %s\n' "${name}" "${mark}" "${detail}"
done < "${RESULTS}"
printf '=========================================================\n'

if [ -s "${BLOCKERS}" ]; then
  printf '\nRELEASE: BLOCKED\n\n阻塞清单：\n'
  cat "${BLOCKERS}"
  printf '\n（README：项 ①/② 属流程（收口+push）；④/③ 的红灯按"归属"找对应线的作者。）\n'
else
  printf '\nRELEASE: READY  —— 可交付用户验收（记得打 tag，见 docs/RELEASE.md）\n'
fi

# RELEASE.md — 稳定版本定义 / 验收 / 回滚

> 用户原话：「全做好后搞个稳定版本给我验收」。本文是**验收手册**；
> 一键判定用 `bash tools/release/check-all.sh`（结尾给 `RELEASE: READY` / `BLOCKED`）。

## 一、稳定版本的**定义**（全部成立才叫稳定）

| # | 条件 | 判据 |
|---|---|---|
| 1 | 门禁全绿 | `tools/gate.sh` 打印 `✅ 真门禁全绿（离线三条 + ArkTS 编译）`，且 ④ ArkTS 编译耗时是**十几秒级**（<5s 视为增量空转**假绿**，必须重跑） |
| 2 | 工作区干净 | `git status --porcelain` 为空（无在途改动） |
| 3 | 已推送 | `git log --oneline origin/main..HEAD` 为空 |
| 4 | 签名 HAP | `entry/build/default/outputs/default/entry-default-signed.hap` 存在（**不是**仅 `-unsigned.hap`） |
| 5 | 装机跑通 | 模拟器 `xbot_phone`（`127.0.0.1:5555`）装上并启动成功，App 能进会话列表 |

`bash tools/release/check-all.sh` 逐项检查：①工作区干净 ②已推送 ③离线三条（run.sh/lint/check.sh）④真门禁 gate.sh ⑤签名 HAP。
**设备在线/版本号**与**验收材料**（`docs/mockups`+`REDESIGN.md`+`background-notify.md`）为**独立提示（⚠️）**，不影响 `RELEASE: READY/BLOCKED` 主判定 —— 设备离线时脚本明确打印"装机验收前需用户开设备"，不要误判为门禁红。

## 二、版本号 / 标签约定

- 验收标签形如 **`v0.3.0-acceptance`**（`v<major>.<minor>.<patch>-acceptance`）。
- 打标签与推送（**在收到"全部收口"指令后**执行；日常开发**不 push**）：
  ```bash
  source ~/ohos-cli/env.sh
  cd /Users/bobli/src/xbot-harmony
  bash tools/release/check-all.sh          # 必须 RELEASE: READY
  git tag -a v0.3.0-acceptance -m "acceptance build: 工具状态权威表 / 单在飞动效 / 待办条 / P0 滚动 / 通知"
  git push origin main                     # ← 仅在用户确认收口后
  git push origin v0.3.0-acceptance
  ```

## 三、验收步骤（照此操作）

### 1. 装机（**必须用签名版**）
```bash
source ~/ohos-cli/env.sh
cd /Users/bobli/src/xbot-harmony
hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
~/ohos-cli/deploy.sh                      # 自动签名 + 装机（不要手动装 -unsigned.hap）
```

### 2. 强制重启 App（确保不是残留进程）
```bash
hdc -t 127.0.0.1:5555 shell "aa force-stop com.chronostasys.xbot"
hdc -t 127.0.0.1:5555 shell "aa start -a EntryAbility -b com.chronostasys.xbot"
```

### 3. 联合验收清单（**只在自己新建的会话里做**）

> ⛔ **绝不碰用户会话**（`web-4` 等）。新建一个会话（抽屉里「＋ 新建」）再逐条走。

| 项 | 期望 |
|---|---|
| **工具状态权威表（六档）** | 运行中/已完成/失败/等待/… 六档颜色与文案一致；同一工具跨帧不闪变（以服务端为准） |
| **只有一个在飞动效** | 流式期间**只有一处**「思考中/在飞」动效，不叠加、不双开 |
| **待办条（TodoPanel）** | 有 todo 即出现拉条（**全 pending 也在**）；`done/total` 与状态条 `todos x/y` 同源一致；勾选即时生效且不被旧快照回退 |
| **P0 滚动** | 流式时列表自动跟随到底；用户上滑后**不被强行拽回**底部 |
| **通知** | 回合结束/待答问题按设置触发；前台抑制正确；点通知进对应会话 |
| **渠道过滤** | 抽屉渠道 chip：选「飞书」能列出飞书会话及其 SubAgent 子会话（不再空列表） |
| **消息编辑并重发（rewind）** | user 行长按 →「编辑并重发」→ 确认后该消息及其后回复被回退并重发 |
| **待发队列** | 队列项「插队」按完整内容注入当前回合；「清空」逐条取消 |

#### 3.1 通知面（来源：`notify-pro` / `docs/PATCHES/background-notify.md` 第五节，已核）

1. 新建会话发一条**长回复** → 切后台 → 30 秒内拉通知栏，核对：
   - ① 长回复**展开多行、无 `…`**；
   - ② **问句**横幅响铃、**回合完成静默**；
   - ③ 有「**查看**」且**点击直达该会话**；
   - ④ 同会话**连发两回合仍只一条**。
2. 设置里关掉「通知显示回复内容」再发 ⇒ 正文只剩标题。
3. 点开通知 ⇒ **角标清零**。

#### 3.2 验收材料（供用户"看得到"，缺失不影响门禁但应尽量齐备）

- `docs/mockups/`（样张）与 `docs/REDESIGN.md`（规范）——`check-all.sh` 的「验收材料」项会检查（⚠️ 警告级）。
- `docs/PATCHES/background-notify.md` —— 后台接收方案的**用户拍板材料**（AskUser 决策依据）。
- 未决项口径：`grep -rIcE '待用户拍板|待拍板' docs`（含 `docs/PATCHES/**`）；验收时用它对账 AskUser 问题清单是否穷尽。

### 4. 取证
- 关键界面**截图** + `hdc ... shell "bm dump -n com.chronostasys.xbot"`（versionCode）留档。
- 有异议的项：`bash tools/release/check-all.sh` 的输出 + 截图一起贴回。

## 四、回滚

- **回代码**：`git checkout <上一个稳定 tag>`（如 `git checkout v0.2.0-acceptance`）——但注意当前 HEAD 的未推送提交会丢，先 `git stash` 或建分支。
- **只回 App**：重装旧 HAP（保留旧的 `entry-default-signed.hap`）：
  ```bash
  hdc -t 127.0.0.1:5555 install -r /path/to/old/entry-default-signed.hap
  ```
- **回 tag**：`git tag -d v0.3.0-acceptance && git push origin :refs/tags/v0.3.0-acceptance`（仅本地误打时用）。

## 五、已知**不在**本稳定版本内的项（未做项台账）

> 逐条：明确"未做"而非"假装做了"。收口前应清空本表或逐条写明移出理由。

| 项 | 状态 | 原因 / 后续 |
|---|---|---|
| 插件 widget（`web_widgets`/`plugin_widgets`）渲染 | **未做渲染** | core 侧已解析并**显式暴露**（`core/panels.ets:parseWidgetsPayload` + `WIDGETS_RENDERABLE=false`），但**无渲染组件**；接线清单已交（`core/store.ets` handleSse + `components/**`） |
| `pages/Index.ets` 拆分（原 6420 行 / 18 单元） | **P1/P2-1 已实施** | P1（`19b58bb` 抽 `StatusSheet`）、P2-1（`3aa3945` 抽 `Queue/Plugins/SelfCheck Sheet`）各带 ④ 真编译取证，`Index.ets` 6420 → 6178 行；P2-2/P2-3/P3–P6 见 `docs/INDEX-SPLIT-PLAN.md`（后续阶段） |
| 渠道过滤的 `activeChannel` 持久化**页面接线** | **未接线**（已另派） | 纯逻辑 + IO 就绪（`core/config.ets:saveActiveChannel`，键 `xbot:active-channel`，读写共用同一对纯函数）；`pages/Index.ets` 侧调用待接（`arch-split` 做） |
| 构建门禁的"并发假红" | 部分缓解 | `check.sh` 的 PID 目录 + `include: ./build*/*.ts` 并发时仍可能互扰（非阻塞，重跑即可） |

## 六、一键校验脚本

`bash tools/release/check-all.sh` —— 逐项 PASS/FAIL 表 + 阻塞清单 + `RELEASE: READY|BLOCKED`。

- 它**只调用** `tools/tests/run.sh`、`tools/lint/render-path.sh`、`tools/typecheck/check.sh`、`tools/gate.sh`，不改它们。
- `run.sh` 在**首个红测试处中止** ⇒ 脚本会**解析输出聚合**失败测试名，并列出**未跑到**的测试文件。
- ④ 假绿识别：`BUILD SUCCESSFUL in <5s` ⇒ 判 FAIL 并要求重跑。
- 设备只用**只读** `bm dump` 取版本号；**不碰用户会话**。

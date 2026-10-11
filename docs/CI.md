# CI / 构建 / 签名（Linux，无需 DevEco Studio）

## 1. 为什么不需要 DevEco Studio

DevEco Studio 只是 IDE。真正的构建链是 **command-line-tools**（内含
`hvigorw`（Node）/ `ohpm` / `sdk` / 自带 Node 与 JDK），官方提供 **Linux (x86-64)** 版本，
可以完整执行 `ohpm install` + `hvigorw assembleHap` + 签名（`hap-sign-tool.jar`，Java）。

本仓库因此把构建放在 **GitHub Actions 的 Linux 容器**里：

```
ghcr.io/dalongzhuazi/harmonyos-ci:api26r
```

该镜像 = command-line-tools 26.0.0.821（HarmonyOS 26.0.0 / API 26 正式版）打包，
社区已端到端验证：容器内 `ohpm install --all` + `hvigorw assembleHap` 能产出
`entry-default-unsigned.hap`。（来源见文末。）

## 2. 版本必须三处对齐

| 位置 | 字段 | 本仓库取值 |
|---|---|---|
| `build-profile.json5` | `products[].compatibleSdkVersion` | `"26.0.0"` |
| `oh-package.json5` | `modelVersion` | `"26.0.0"` |
| `hvigor/hvigor-config.json5` | `modelVersion` | `"26.0.0"` |
| workflow `env.CI_IMAGE` | 镜像 tag | `api26r` |

### 踩坑（镜像内实测）

- ❌ `"compatibleSdkVersion": "26.0.0(26)"` ⇒ `api version parameter is illegal!`
  必须写 **`"26.0.0"`**。
- ❌ 两处 `modelVersion` 不一致 ⇒
  `The modelVersion in hvigor-config.json5 is X, and the modelVersion in oh-package.json5 is Y`。

### 换 SDK / 适配更老的手机

可用 tag：`api26r`(API 26 正式版) / `api26b2` / `api26` / `api24`(6.1.1) / `api23`(6.1.0)。
切换时**同时**改上面三处 + workflow 的 `CI_IMAGE`。

> ⚠️ 目前这些镜像都 ≥ HarmonyOS 6.x。若目标是 **HarmonyOS 5.x（API 12–18）设备**，
> 需要自建对应版本的 command-line-tools 镜像（`harmonyos-ci` 仓库的 Dockerfile 支持
> zip/tar.gz + 分片 + sha256，含离线构建），或改在本地用 DevEco Studio 出包。

## 3. 明文 HTTP（自建服务的常见坑）

HarmonyOS 6.1（API 23）起**默认全局禁止明文 HTTP**，请求会被强制走 https 而失败。
自建 xbot 通常是 `http://<内网IP>:16000`，因此需要放行：

**正确做法**：`entry/src/main/resources/base/profile/network_config.json`
（按约定位置 + 文件名自动发现，**不需要**在 module.json5 里引用）：

```json
{
  "network-security-config": {
    "base-config": { "cleartextTrafficPermitted": true }
  }
}
```

### 踩坑（已在 CI 上实测）

❌ 把 `networkSecurityConfig` 写进 `module.json5` ⇒ hvigor 直接报
`00303038 Configuration Error / Schema validate failed`（API 26 的 module schema
**没有这个字段**，allowedValues 里只有 metadata/abilities/requestPermissions/... ）。
若要用 module.json5 的写法，需按 API 23+ 的 `networkSecurityConfig` 结构（baseConfig）
且 SDK 版本支持；本仓库采用 profile 文件方案，跨版本更稳。

公网部署请改用 HTTPS，并把 `cleartextTrafficPermitted` 改回 `false`（或用
`domain-config` 只放行内网域名）。

## 4. 签名（发布正式包才需要）

CI 里用官方 `hap-sign-tool.jar`（Java，跨平台）：

```bash
java -jar hap-sign-tool.jar sign-app \
  -mode localSign -signAlg SHA256withECDSA \
  -keyAlias <alias> -keystoreFile xbot.p12 -keystorePwd <pwd> -keyPwd <pwd> \
  -appCertFile xbot.cer -profileFile xbot.p7b -inFile entry-default-unsigned.hap \
  -outFile entry-default.hap
```

材料来源：华为开发者账号（实名）→ AppGallery Connect → 证书/Profile；
或本机 DevEco Studio 的「自动签名」生成后导出（`.p12` / `.cer` / `.p7b`）。

把三个文件 base64 后写入仓库 Secrets：

```bash
base64 -w0 xbot.p12   # → SIGNING_KEY_B64
base64 -w0 xbot.cer   # → SIGNING_CERT_B64
base64 -w0 xbot.p7b   # → SIGNING_PROFILE_B64
```

外加 `SIGNING_KEY_PASSWORD` / `SIGNING_KEY_ALIAS` /（可选）`SIGNING_PROFILE_PASSWORD`。
未配置时 `sign-and-release.yml` **干净跳过**（不报红）。

## 5. 本机签名 vs CI 签名互不干扰

用 DevEco Studio 打开本工程做自动签名时，IDE 会把**本机绝对路径**写进
`build-profile.json5` 的 `signingConfigs` —— 容器里不存在该路径，CI 必然失败。
因此本仓库的工程文件**不含** `signingConfigs`，且 workflow 第一步执行
`.github/scripts/strip_signing.py` 顺手剥离（不存在则跳过）。

## 6. 排障速查

| 现象 | 原因 / 处理 |
|---|---|
| `hvigor 版本不匹配 / unsupported model version` | 镜像 tag 与 `compatibleSdkVersion` 不匹配 |
| `api version parameter is illegal!` | `compatibleSdkVersion` 写成了 `26.0.0(26)` |
| `modelVersion ... is X, ... is Y` | 两处 `modelVersion` 不一致 |
| `Cannot find module '@kit.NetworkKit'` | SDK 与 API 版本不符（kit 化导入自 API 12 起） |
| 构建产物为 0 字节 / 非 zip | workflow 已校验 PK 魔数，直接看构建日志 |
| 手机装不上签名包 | 证书/Profile 与设备不匹配（调试证书需绑定设备 UDID） |

## 7. 参考

- `harmonyos-ci`（CI 镜像 + 消费者 workflow 模板 + 中文/英文指南）：
  https://github.com/DaLongZhuaZi/harmonyos-ci
- Phodal《在 GitHub Action 上构建 HarmonyOS 应用》：
  https://www.phodal.com/blog/github-action-for-harmonyos
- 华为官方：`hap-sign-tool` 命令行签名、`networkSecurityConfig` 明文策略

## 渲染路径门禁（`tools/lint/render-path.sh`）

CI 与本地都会跑。规则只有一条：**`entry/src/main/ets/components|pages` 里禁止直接调用
`parseMarkdown()` / `parseInline()`**，必须用带缓存的 `parseMarkdownCached()` / `parseInlineCached()`。

原因：ArkUI 的 `ForEach` 不比较内容 ⇒ 行级 key 必须带 `rev` ⇒ 数据一变整行重建 ⇒ 组件每次
渲染都会重跑 `build()` 里的解析。实测单行正文可达 274 KB（单 turn 108 个迭代块）⇒ 流式期间
每个 SSE 事件重解析几百 KB ⇒ 卡到完全没法用（见 `docs/ARKTS-GOTCHAS.md` 第 11 条）。

自证方式：往 `components/` 丢一个含裸调用的文件，门禁必须变红（脚本里带 `__mutant.ets` 的用法示例）。

⚠️ **判据形态陷阱：抽取锚点本身就是注释**（`brand-impl` 2026-10-11 报，`empty_star_glow`）：有些"待守的写法"
只出现在**注释**里（例如某处刻意留痕的旧写法）。此时**锚点必须用原文读**（否则锚点先被剥掉了、恒扫不到 ⇒
**假绿**），而**断言输入**照旧要剥注释（否则"注释里提到该名字"会被判违规 ⇒ **假红**）。
⇒ 一条判据里这两种读取**可能同时存在**，必须显式分离：**锚点取原文，断言取剥注释版**。

⚠️ **判据形态陷阱：同名不同物**（我 2026-10-11 在 `motion_budget` 自查出来的）：想守"禁循环/常驻动画"时写
`/iterations/` + `/setInterval\(/` ⇒ **恒红**。真因：本仓 `iterations` 绝大多数是**数据模型字段**
（`row.iterations.length`、`HistoryIteration`），与**动画参数** `iterations` **同名不同物**；
`setInterval(` 则是**轮询定时器**（`LiveTailView`/`SettingsChannels`/`SettingsDeveloper`/`Index`），也不是动画。
⇒ **写判据前先确认"这个词在你扫的那批文件里到底是哪种物"**：拿 2–3 个真实命中**逐条读上下文**，
不要只看 `grep -c` 的次数。真要守"唯一在飞"就交给专管的 `tools/lint/inflight-single-source.sh`，**别重复管**。

⚠️ **碰 ArkTS 侧 ⇒ 必须自跑 `assembleHap`**：脱机三条 + `lint` + `typecheck` **都抓不到编译错**
（它们只把 `core/**` 当纯 TS 编译，不碰 ArkUI 组件与页面）。最新两例见 `docs/ARKTS-GOTCHAS.md` **批次 36**：
① **注释里嵌套 `/* … */`** 会提前闭合外层块注释 ⇒ 余下文本变游离代码 ⇒ 报成一串**级联假错**
（`Unexpected token` + "私有 `#` 标识符不支持"）。② **全局 `declare namespace`（`focusControl`/`AppStorage`/`Curve`）
不要 import** —— 它不在 `@kit.*` 的导出里。

## 可选的真实服务端诊断（默认跳过）

`tools/tests/live_scale.test.ts` —— 全量渲染负载扫描（只读）：

```bash
XBOT_E2E_BASE=http://127.0.0.1:16000 XBOT_E2E_USER=<u> XBOT_E2E_PASS=<p> tools/tests/run.sh
```

报告每个会话的行数/迭代数/单行最多迭代/实际渲染块数/最大单块字符数，并断言"迭代号唯一且升序、
渲染块数 ≤ 16"。不设 env 时自动跳过，CI 无依赖。详见 `docs/RENDER-LOAD-MEASUREMENT.md`。

## ⚠️ 测试文件必须**显式 `process.exit`**

`tools/tests/run.sh` 用 `set -e` **顺序**执行：任何一个测试文件若进程不退出（开了 mock HTTP server /
`ChatStore`（含网络句柄与定时器）等），脚本会**永远卡在该文件**，**后面的测试根本不会跑**。

曾长期被掩盖为"看起来全绿"：套件在 `regions` 处卡死，`rowids`/`serverurl`/`streammerge`/`table_layout`/`upload`
全都没执行（真实断言数 44 → 修好后 **145**）。

契约：**每个** `*.test.ts` 结尾都必须 `process.exit(...)`（失败路径 `1`、成功 `0`）。

## 🔬 隔离单测：`tools/tests/run-one.sh`（多线并行时的判定工具）

### 为什么需要它（真问题）

`tools/tests/run.sh` 用 `set -e` **顺序**执行：把**所有** `core/*` 与**所有** `*.test.ts` 一起 `tsc`，
再逐个 `node`。⇒ **一遇红测试（或别人在途文件的编译错）就整体中止**，后面全部不跑。

在"多条线同改一个工作树"的实况下（本仓常态），后果是：
**只要别人的在途改动让某个测试红，所有线都拿不到自己的判定** —— 你无法区分
"我改坏了"与"别人改坏了"。实测踩到：`core/settingsplugins.ets` 的 TS1005、
`components/AssistantOrb.ets` 的 `Cannot redeclare block-scoped variable 'mode'`。

### 它做什么

把**编译范围缩到"你关心的那几个测试"**：只拷匹配 `<子串>` 的 `*.test.ts` 进临时目录编译并运行。
`core/*` 仍**全量**编译（它是测试的真实依赖，不是可选），其余编译环境与 `run.sh` **逐项等价**
（stubs / `sed` 路径改写 / `@kit.*`+`prism4j`+notify mock / 同款 `find_tsc`）。

### 用法

```bash
bash tools/tests/run-one.sh                 # 无参：列出可用测试名 + 总数（覆盖范围可数）
bash tools/tests/run-one.sh streammerge     # 只跑文件名含 streammerge 的测试
bash tools/tests/run-one.sh sse             # 子串匹配 ⇒ 跑 sse / sse_terminal / sse_watchdog …
```

**退出码**：`0` 全过 · `2` 找不到匹配的测试名（会列出可用清单）· `3` 编译失败
（打印错误尾部，并提示"这可能是**别人在途文件**的编译错误"——`core/` 是全量编译的）·
其余 = 测试失败数。

> ⚠️ 临时目录带 PID（`.out-one.$$`）⇒ 多线**并发**跑互不干扰。
> ⛔ **不改 `run.sh`**（它被多条线共用）；本脚本是**旁路工具**，共享套件的"全绿"仍是最终判据。

## 🧮 全量单测（聚合、不早退）：`tools/tests/run-all.sh`

`run.sh` 用 `set -e` ⇒ **第一个红就整体中止**（多线协作时"谁也拿不到全貌"）。`run-all.sh` 是
`gate.sh` 第 ① 步现在调用的执行器：**把所有测试跑完再判定**，输出 `共 N 个测试文件，M 个失败`
+ 失败测试名 + 失败断言行（`✗`）。**判据完全不变**：任一测试红（或 tsc 编译失败）⇒ 退出码非 0。
tsc 层失败**单独归类为「编译失败」**并打印错误尾部（点名罪魁文件）。

### 我该跑哪个？（对照表）

| 目的 | 命令 | 范围 | 遇红行为 |
|---|---|---|---|
| **只跑我的**（隔离） | `bash tools/tests/run-one.sh <子串>` | 文件名匹配 `<子串>` 的测试 | 失败即停（只看自己） |
| **跑全量 + 全貌** | `bash tools/tests/run-all.sh` | 全部测试 | **跑完**，汇总"谁的红" |
| **真门禁**（含 ArkTS 编译） | `bash tools/gate.sh` | 离线三条 + `hvigorw assembleHap` | 步①=`run-all.sh`，红即整门禁红 |
| （旧）逐个顺序、首红即停 | `bash tools/tests/run.sh` | 全部测试 | `set -e` ⇒ **首红中止** |

> ⚠️ 临时目录带 PID（`.out-all.$$`）⇒ 并发安全。`run-all.sh` **不改** `run.sh` 的既有行为。

## ⛔ 插断言时最容易踩的坑：**汇总 log 被包进 `if (fail > 0) { … }`**

**症状**（2026-10-11 实锤，`tokens-ux` 卡 3 轮）：给某个 `tools/tests/*.test.ts` 末尾加断言后，
**改前 / 改后 / mutation 后三次都是同一个 passed 数**（例如恒 `29 passed`）——看起来像"插入没生效"，
其实是**断言落进了死区**。

**根因**：本仓**大量**测试（实测 **99 个文件**）的末尾长这样：
```ts
if (fail > 0) { console.log(`  <name>: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  <name>: ${pass} passed, 0 failed`);   // ← 有的有、有的没有
process.exit(0);
```

> ⚠️ **新形态（2026-10-11 实测，来自"扫源码不剥注释"清扫）**：有的判据**抽取锚点本身就是注释**
> （如 `empty_star_glow` 的 `bodyOf(src, '// …')`）⇒ **不能**先把整份源码剥注释（锚点会消失 ⇒ 抽取断裂、
> 整批假红）。正确分工 = **锚点用原文**、**只对"断言扫描"那一步剥**（`stripSrc(extract(rawSrc))`）。
⇒ 那个**带计数的 `console.log` 在失败分支之内**。谁拿它当"末尾前"锚点插断言，断言就落在
`fail === 0` **永不执行**的分支里 ⇒ 计数不动。

**破法（二分自证，30 秒）**：先插一条 `eq('probe', 1, 1)` ——
- 插在 `if (fail > 0)` **之前** ⇒ 计数 **+1** ✓（正确锚点）；
- 插在那一行 `console.log` **之前**（= `{` 之后） ⇒ 计数**不动** ⇒ 死区坐实。

**纪律**：
1. 新写测试：汇总**无条件打印** + `process.exit(fail > 0 ? 1 : 0)`（**别**把 log 包进 `if`）；
2. 加断言时**先 `grep -n "if (fail > 0)" <file>`**，把断言插在它**之前**；
3. `console.log('...')` 只在**非** `if` 分支里才当锚点。
4. 已知**成功时完全静默**（只在 `if` 里打印）的 4 个文件待收：
   `queue_ops` / `sse` / `sse_watchdog` / `store_null`。

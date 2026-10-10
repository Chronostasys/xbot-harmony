# AGENTS.md — xbot-harmony

HarmonyOS 原生客户端，目标是与官方 webui（`/Users/bobli/src/xbot/web`，**权威基准**）功能与
视觉对齐。ArkTS/ArkUI（Stage 模型），SDK pin `compatibleSdkVersion 21`。

## 构建 / 门禁（全部必须绿）

```bash
source ~/ohos-cli/env.sh                       # hvigorw/ohpm/hdc/Emulator + JAVA_HOME + LANG=zh_CN.UTF-8
cd /Users/bobli/src/xbot-harmony
bash tools/tests/run.sh                        # 纯逻辑测试（.ets 当 TS 编译后 node 跑）
bash tools/lint/render-path.sh                 # 渲染路径门禁
bash tools/typecheck/check.sh                  # core/ 静态检查
hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon
# 装机 + 截图
hdc -t 127.0.0.1:5555 install -r entry/build/default/outputs/default/entry-default-unsigned.hap
hdc -t 127.0.0.1:5555 shell "aa force-stop com.chronostasys.xbot"; hdc -t 127.0.0.1:5555 shell "aa start -a EntryAbility -b com.chronostasys.xbot"
```

模拟器 `xbot_phone`（1320×2848，包名 `com.chronostasys.xbot`）。驱动 UI 用 `uitest uiInput`。

## ⛔ GOTCHAS（会浪费数小时的坑）

- **带参全局 `@Builder` 的子树不随参数重建**（参数是"调用那一刻的快照"）。用它承载"会变的内容"
  ⇒ 卡片/数字卡在首帧、打字机不动、**点不开**、tool pill 状态恒为初值。
  **凡需响应更新 ⇒ 真 `@Component` + `@Prop`**；`@Builder` 只用于"参数不变"的静态片段
  （或无参、读 `this` 的片段）。详见 `docs/ARKTS-GOTCHAS.md`。
- **ArkTS 禁对象字面量作类型标注**（圆角等）—— 用内联 `.borderRadius({...})`。
- **⛔ 真门禁是 `bash tools/gate.sh`**（离线三条 + **ArkTS 编译**）。脱机三条脚本全绿 **≠** 能编译：
  `run.sh` 只把 `core/**` 当纯 TS 编译，`lint`/`typecheck` 也不碰 ArkUI 组件与页面 ⇒ 组件/页面的
  ArkTS 严格性与类型错误（如 `Stack` 无 `justifyContent`、调用联合类型、SDK 版本门限）**一个都抓不到**。
  唯一判据是 `hvigorw assembleHap` 打出 `BUILD SUCCESSFUL`。
- **`build-profile.json5` 的 `products[0]` 必须引用 `"signingConfig": "default"`**，否则
  `No signingConfig found for product default` ⇒ 只产出 `*-unsigned.hap` ⇒ 装机报
  `install sign info inconsistent`(9568332)。装机请用 `~/ohos-cli/deploy.sh`。
- **实机点击是移动靶**：流式时列表自动滚动 ⇒ `dumpLayout → click → snapshot` 必须**同一条
  shell 命令原子执行**，坐标才准。
- **bytecode HAR** 要求 `useNormalizedOHMUrl: true`；依赖抬 `compatibleSdkVersion` 时需用户拍板。
- **不许自造轮子**：高亮用 `@hxa-atpc/noties_prism4j`（`core/highlight.ets`）；diff 移植 web
  `DiffView.tsx`（`core/diffparse.ets`）。自造的 `core/jsontok.ets` 已删。
- **玻璃材质必须锁深色**（`colorMode: DARK`），否则与设计系统割裂。

## 知识文件（本仓用 `docs/` 平铺；读它，别猜）

| 文件 | 内容 |
|---|---|
| `docs/ARCHITECTURE.md` | 分层与数据流（store/状态机/渲染） |
| `docs/ARKTS-GOTCHAS.md` | ArkTS/ArkUI 陷阱大全（**改 UI 前必读**） |
| `docs/WEB-ALIGNMENT.md` | 与 web 的逐条对照 + 历批修复记录（**最权威**） |
| `docs/WEB-PARITY.md` | 功能面 parity 清单 |
| `docs/DESIGN-SYSTEM.md` | 设计系统（tokens/主题/玻璃） |
| `docs/BRAND.md` | 品牌：应用图标 / 开屏的 SVG 设计与再生成 |
| `docs/TOOLPOPOVER-SPEC.md` | 工具 pill 浮层规格 |
| `docs/UI-AUDIT-CHECKLIST.md` | UI 自检清单 |
| `docs/INSTALL.md` / `docs/CI.md` / `docs/PREVIEWER-LINUX.md` | 环境/CI/预览器 |
| `docs/RENDER-LOAD-MEASUREMENT.md` | 渲染规模实测方法 |
| `docs/ROADMAP.md` | 路线图 |

## 关键约定

- **状态机是 web 的逐字移植**（`core/*.ts` 端口件，沿用 `.ts` 以避开 ArkTS 严格规则）——
  **不要重写逻辑**，改 web 侧的同一处。
- 组件只消费状态机产物；**判据与渲染必须同源**（同一个纯函数）。
- 每个纯逻辑模块都要有判别力测试（`tools/tests/*.test.ts`，结尾 `process.exit`）。
- 图标用 `SymbolGlyph($r('sys.symbol.*'))`；**HarmonyOS 无 brain 符号**，思考用 `lightbulb`。
- **动效统一走底座**：`core/motion.ets`（纯数值，可脱机单测）+ `components/anim.ets`（UI 侧 `AnimateParam`
  工厂，唯一 import `@ohos.curves` 处）。**`core/*.ets` 禁止 import ArkUI/`@ohos.*` 全局类型**
  —— `run.sh` 把它当纯 TS 编译，会 TS2307。
- **门禁并发安全**：`tools/tests/run.sh` 的产物目录带 PID（`.out.$$`），可多线并发跑互不干扰。

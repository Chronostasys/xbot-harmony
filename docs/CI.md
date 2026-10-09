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
自建 xbot 通常是 `http://<内网IP>:16000`，因此 `entry/src/main/module.json5` 里显式放行：

```json5
"networkSecurityConfig": {
  "baseConfig": { "cleartextTrafficPermitted": true }
}
```

公网部署请改用 HTTPS，并把该值改回 `false`（或按域名细粒度放行）。

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

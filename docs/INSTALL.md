# 安装到手机

> 前提：手机是 **HarmonyOS 6.x**（本工程按 API 26 编译）。若是 HarmonyOS 5.x，请先看
> [docs/CI.md](CI.md) 的「换 SDK」一节切换镜像与 `compatibleSdkVersion`。

## 0. 你需要什么

| 方式 | 需要 | 产物 |
|---|---|---|
| A. CI 签名发布 | 华为开发者账号 + 证书/Profile（写入仓库 Secrets） | **签名 HAP**（可直接装） |
| B. 本机 DevEco Studio | 一台 Windows/macOS + DevEco Studio | 本机自动签名后直接运行 |
| C. 纯命令行 + `hdc` | 已签名的 HAP（来自 A）+ 手机开启开发者模式 | `hdc install` |


## 0.1 已有产物（本机已构建，2026-10-09）

```
/home/smith/src/xbot-harmony/dist/xbot-harmony-debug-unsigned.hap     467,483 B
/home/smith/src/xbot-harmony/dist/xbot-harmony-release-unsigned.hap   216,728 B
```

- `bundleName = com.chronostasys.xbot`；`minAPIVersion = 50000012` ⇒ **需 HarmonyOS ≥ 5.0.0（API 12）**（编译用 SDK 为 5.0.5）
- 构建用 SDK：HarmonyOS 5.0.5（官方 command-line-tools，装在本机 `/home/smith/ohos-cli/command-line-tools`）
- ⚠️ **未签名**：`hdc install` 会报签名错误。两条路：
  1. **DevEco Studio 自动签名**（最省事，需 Win/Mac）：打开本工程 → 「自动签名」→ 运行/打包，IDE 会生成签名后的 HAP；
  2. **命令行签名**（本机即可，工具已就位）：

```bash
TOOL=/home/smith/ohos-cli/command-line-tools/sdk/default/openharmony/toolchains/lib/hap-sign-tool.jar
java -jar "$TOOL" sign-app \
  -mode localSign -signAlg SHA256withECDSA -keyAlias xbot \
  -keystoreFile 你的.p12 -keystorePwd 口令 -keyPwd 口令 \
  -appCertFile 你的.cer -profileFile 你的.p7b \
  -inFile  dist/xbot-harmony-release-unsigned.hap \
  -outFile dist/xbot-harmony-release.hap
```

签名材料（`.p12/.cer/.p7b`）来自华为开发者账号（实名）+ AppGallery Connect；调试证书需登记设备 UDID。
把三者 base64 写进仓库 Secrets 则可由 CI 产出签名包（见 docs/CI.md）。

## 1. 获取放行（只有方式 A/B 需要）

1. **华为开发者账号**：https://developer.huawei.com/consumer/cn/ → 实名认证。
2. **生成密钥与证书请求**（本机或 CI 均可，用 `hap-sign-tool`）：

```bash
# 生成密钥库（.p12）
java -jar hap-sign-tool.jar generate-keypair \
  -keyAlias xbot -keyAlg ECC -keySize NIST-P-256 \
  -keystoreFile xbot.p12 -keystorePwd <你的口令> -keyPwd <你的口令>

# 生成证书请求（.csr）
java -jar hap-sign-tool.jar generate-csr \
  -keyAlias xbot -keyPwd <你的口令> \
  -subject "C=CN,O=xbot,OU=dev,CN=xbot" \
  -signAlg SHA256withECDSA -keystoreFile xbot.p12 -keystorePwd <你的口令> -outFile xbot.csr
```

3. 在 **AppGallery Connect** 上传 `.csr` 申请**调试证书 `.cer`** 与 **Profile `.p7b`**
   （调试用途需在 AGC 里登记设备 UDID，或申请发布证书走正式发布）。
4. 三个文件 base64 后写入仓库 Secrets（名字见 [docs/CI.md](CI.md)「签名」）。

## 2. 方式 A：CI 出货

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`Sign & Release` workflow 会：构建 release HAP → `hap-sign-tool` 签名 → 发 Release。
在 Releases 页面下载 `entry-default.hap`。

## 3. 装到手机

1. 手机：**设置 → 关于本机 → 连续点击版本号** 打开开发者模式；在「开发者选项」打开 **USB 调试**。
2. 电脑装 `hdc`（command-line-tools 的 `toolchains/` 里，或 DevEco Studio 的 SDK 目录）。
3. 连接并安装：

```bash
hdc list targets                     # 确认设备已连接
hdc install entry-default.hap        # 签名包才能装成功
hdc shell aa start -a EntryAbility -b com.chronostasys.xbot   # 启动
```

未签名 HAP 会报 `install failed due to grant request permissions failed` 之类错误 —— 那是**签名**问题，
不是构建问题；请走方式 A/B。

## 4. 首次运行配置

App 启动后填：

- **服务端地址**：`http://<xbot 机器 IP>:16000`（默认端口 16000，见 `~/.xbot/config.json` 的 `web.port`）
- 用户名 / 密码

> 手机与 xbot 机器要在**同一网络**（或服务端有公网地址）。
> 若服务端是 HTTPS，请把 `entry/src/main/resources/base/profile/network_config.json` 的
> `cleartextTrafficPermitted` 改回 `false`。

## 5. 排障

| 现象 | 原因 |
|---|---|
| `install failed ... signature` | HAP 未签名 / 证书与设备不匹配（调试证书要登记 UDID） |
| 装上了但连不上服务端 | 明文 HTTP 被拦（检查 `network_config.json`）或 IP/端口不对 |
| 提示需要登录但密码正确 | 服务端 `web_users` 为空时只允许 bootstrap 注册；或 `invite_only` 限制 |
| 打开插件面板空白 | ArkWeb 需要联网加载服务端 `/plugins/...`；确认手机能访问服务端 |

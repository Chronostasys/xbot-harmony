# xbot AppGallery 提审前清单

> “保证过审”无法由本地代码保证；下面是能把可控项全部做完的清单。标 🔴 的项不做，审核必卡。

## A. 包与签名

- [x] `release/xbot-1.0.0-appgallery.app` 已用 `app_gallery` profile 签名（AGC 上传用 **.app**，不是 .hap）
- [x] `release/xbot-1.0.0-appgallery.hap` 仅用于本地/真机验证
- [x] profile type=`release`，distribution=`app_gallery`
- [x] App Pack 构建模式=`release`
- [x] 真机验证包已用 internal-testing profile 安装成功（仅用于自测）
- [ ] 🔴 **版本号与 AGC 发布版本一致**：当前 HAP 是 `versionName=1.0.0` / `versionCode=1000000`；正式 profile 里是 `2.0.0/2`。上传前确认 AGC 后台版本与 `AppScope/app.json5` 一致，否则可能被版本校验拒绝。
- [ ] 上传前重跑 `bash tools/gate.sh`（真 ArkTS 编译 + 门禁）

## B. AGC 必需资料

- [x] 应用图标 `xbot-app-logo-1024.png`（1024×1024）
- [ ] 🔴 **隐私政策公网 URL**（不能是 localhost/局域网；必须 HTTPS）
- [x] **审核演示账号**：`xbot-demo / xbot-demo`（已内置纯本地演示；不需要服务端地址）
- [x] 演示模式自动显示 3 个 demo 会话，任意输入产生相同固定 SSE
- [ ] 真实功能审核：如审核员要体验真实 Agent，需要另行提供公网服务端/账号；演示模式本身不依赖服务器
- [ ] 应用分类/年龄分级/联系方式
- [ ] 应用简介与版本说明（可用 `APP-STORE-LISTING.md` / `RELEASE-NOTES.md`）
- [ ] 3–5 张真机截图（会话、工具执行、实况窗、设置；不能带 token/服务器地址/个人隐私）

## C. 功能与权限

- [x] 权限仅：`ohos.permission.INTERNET`、`GET_NETWORK_INFO`、`VIBRATE`
- [x] 无广告 SDK、无第三方统计 SDK
- [ ] 🔴 Push Kit 普通通知：精准推送已开，但自分类权益未通过时 80300002
- [ ] 🔴 实况窗服务端推送：`liveview-formal-authority` 正式权益未通过时 80300002
- [ ] 实况窗本地调试截图已准备：`xbot-liveview-lockscreen.jpg`
- [ ] 如果提审版本不带 Push/LiveView，请在描述中明确，避免审核按“功能缺失”判问题

## D. 审核路径

1. 登录页填写公网服务端地址
2. 登录测试账号
3. 新建会话，发送“你好”
4. 查看流式正文/思考与工具执行
5. 打开设置 → 插件 → 鸿蒙推送
6. 实况窗：本地测试入口（如果正式权益未通过，不要把它描述成后台推送已可用）

## E. 当前明确不能保证的项

- 华为 AppGallery 人工审核结果；
- AGC 推送/实况窗权益审核结果；
- 没有公网服务端和审核账号时，审核员无法通过登录页，这是当前最大阻塞项。

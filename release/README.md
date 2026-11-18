# xbot 正式版发布包

## 产物

| 文件 | 用途 |
|---|---|
| `xbot-1.0.0-appgallery.app` | **AGC 上传用正式包**（App Pack，`.app`）；已用 `xbot-release-2026Release.p7b`（`app-distribution-type=app_gallery`, `type=release`）签名 |
| `xbot-1.0.0-appgallery.hap` | Module 包，仅供本地/真机验证；AGC「上传包」不接受 `.hap` |
| `xbot-app-logo-1024.png` | 1024×1024 应用图标，用于 AGC 素材 |
| `xbot-liveview-lockscreen.jpg` | 实况窗锁屏展示截图 |
| `RELEASE-NOTES.md` | 版本说明 |
| `APP-STORE-LISTING.md` | 应用名称/简介/分类等上架文案草稿 |
| `PRIVACY-POLICY.md` | 隐私政策草稿（必须上线到可公开访问的 URL） |
| `DEMO-ACCOUNT.md` | 审核演示账号：`xbot-demo / xbot-demo` |
| `UPLOAD-CHECKLIST.md` | AppGallery 提审前逐项检查 |

## 构建信息

```text
bundleName: com.chronostasys.xbot
versionName: 1.0.0
versionCode: 1000000
compatibleSdkVersion: 6.0.1(21)
targetSdkVersion: 6.0.1(21)
buildMode: release
```

## 签名信息

```text
profile: xbot-release-2026Release.p7b
profile type: release
distribution type: app_gallery
cert: xbot-release-2026.cer
keystore: xbot-release.p12
alias: xbot-release
```

## 重要

- `xbot-1.0.0-appgallery.hap` 的 `app_gallery` 正式 profile **不能直接 hdc 安装到真机**（会报 `9568322 not trusted app source`）；真机验证请用 internal-testing profile 签的包，AppGallery 提审只上传本目录的 app_gallery 包。
- 发布前必须完成 `UPLOAD-CHECKLIST.md` 中的 **公网服务地址/审核账号/隐私政策 URL/截图**；这些不是 HAP 能替你生成的。

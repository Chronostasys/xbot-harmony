# xbot 发布版权限与能力

## 权限

```json
[
  { "name": "ohos.permission.INTERNET" },
  { "name": "ohos.permission.GET_NETWORK_INFO" },
  { "name": "ohos.permission.VIBRATE" }
]
```

## 服务能力

- 网络：连接用户配置的 xbot 服务端（HTTP/HTTPS）
- 通知：本地通知 + Push Kit（需 AGC 权益）
- 实况窗：本地 Live View Kit；服务端 Push 更新需实况窗正式权益
- WorkScheduler：`NotifyReconcileAbility`，延迟对账后台任务
- 文件选择：用户主动选择文件上传（不读取相册/通讯录）

## 审核说明

应用是**用户自带服务端（BYOS）**的开发者客户端，不是公共 SaaS。审核必须使用可公网访问的 xbot 实例；本机 `127.0.0.1` / `192.168.31.8` 不可用于审核。

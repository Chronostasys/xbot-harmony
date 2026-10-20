package main

import (
	"context"
	"time"
)

// liveview.go —— 服务端 Push Kit 实况窗（LiveViewPayload）支持。
//
// 事实/边界（华为 Push Kit REST LiveViewPayload）：
//   - operation：0 创建（远程创建仅允许 FLIGHT/TAXI/TRAIN）、1 更新、2 结束；
//     更新/结束要求 activityId 对应的实况窗已存在（否则该 id 被限制 24h）。
//   - event：场景（TAXI/DELIVERY/FLIGHT/TRAIN/QUEUE/PICK_UP/SCORE/RENT/TIMER/WORKOUT/NAVIGATION）；
//     xbot 原生本地实况窗使用 PROGRESS（本地已创建）时，远端只做 operation=1/2 更新。
//   - activityData.notificationData（type=3）+ activityData.capsuleData（text capsule）必填。
//   - 版本：v1 -> {"message":{"liveView":...,"token":[...]}}；
//           v3 -> {"payload":{"liveView":...},"target":{"token":[...]}}（与普通通知同信封）。
//
// ⛔ 不缓存任何实况窗历史；每次调用都是一次权威 request。

type LiveViewRequest struct {
	ActivityID     int    `json:"activityId"`
	Operation      int    `json:"operation"` // 1 update / 2 end（0 create 仅 FLIGHT/TAXI/TRAIN）
	Event          string `json:"event"`
	Status         string `json:"status,omitempty"`
	Title          string `json:"title,omitempty"`
	Content        string `json:"content,omitempty"`
	CapsuleTitle   string `json:"capsuleTitle,omitempty"`
	CapsuleContent string `json:"capsuleContent,omitempty"`
	CapsuleIcon    string `json:"capsuleIcon,omitempty"`
	CapsuleBG      string `json:"capsuleBg,omitempty"`
	Version        int    `json:"version,omitempty"`
	Mute           *bool  `json:"mute,omitempty"`
	Test           bool   `json:"test,omitempty"`
	DryRun         bool   `json:"dryRun,omitempty"`
}

const defaultLiveViewActivityID = 20261017

func normalizeLiveView(req LiveViewRequest) LiveViewRequest {
	if req.ActivityID == 0 {
		req.ActivityID = defaultLiveViewActivityID
	}
	if req.Operation != 1 && req.Operation != 2 && req.Operation != 0 {
		req.Operation = 1
	}
	if req.Event == "" {
		req.Event = "PROGRESS"
	}
	if req.CapsuleIcon == "" {
		req.CapsuleIcon = "liveview_icon.png"
	}
	if req.CapsuleBG == "" {
		req.CapsuleBG = "#FF0B0B0E"
	}
	if req.CapsuleTitle == "" {
		req.CapsuleTitle = "xbot"
	}
	if req.CapsuleContent == "" {
		req.CapsuleContent = req.Content
	}
	if req.Title == "" {
		req.Title = "xbot"
	}
	if req.Content == "" {
		req.Content = "xbot 正在运行"
	}
	if req.Version < 0 {
		req.Version = 0
	}
	return req
}

// buildLiveViewPayload 生成 LiveViewPayload（纯函数，单测直接逐字段断言）。
func buildLiveViewPayload(req LiveViewRequest) map[string]any {
	req = normalizeLiveView(req)
	notif := map[string]any{
		"type":         3,
		"contentTitle": req.Title,
		"contentText":  []map[string]any{{"text": req.Content}},
		"clickAction":  map[string]any{"actionType": 0},
		// ⛔ type=3（进度可视化）在 Push Kit 侧强制要求 richProgress；
		//    缺字段会回 80100003「richProgress can't be null」，不是权限错误。
		//    progress/nodeIcons/indicatorIcon 由端侧本地实况窗决定；远端更新只传
		//    最低可校验集合，端侧会保留原有进度图形。
		"richProgress": map[string]any{
			"type":          0,
			"progress":      0,
			"indicatorType": 1,
			"color":         req.CapsuleBG,
			"bgColor":       "#19000000",
		},
	}
	capsule := map[string]any{
		"type":    1,
		"status":  1,
		"icon":    req.CapsuleIcon,
		"bgColor": req.CapsuleBG,
		"title":   req.CapsuleTitle,
		"content": req.CapsuleContent,
	}
	lv := map[string]any{
		"activityId": req.ActivityID,
		"operation":  req.Operation,
		"event":      req.Event,
		"activityData": map[string]any{
			"notificationData": notif,
			"capsuleData":      capsule,
		},
	}
	if req.Status != "" {
		lv["status"] = req.Status
	}
	if req.Version > 0 {
		lv["version"] = req.Version
	}
	if req.Mute != nil {
		lv["mute"] = *req.Mute
	}
	return lv
}

// buildLiveViewPushBody 生成 Push Kit messages:send 请求体（与普通通知同信封）。
func buildLiveViewPushBody(cfg Settings, req LiveViewRequest, tokens []string) map[string]any {
	lv := buildLiveViewPayload(req)
	if cfg.APIVersion == "v1" {
		return map[string]any{"message": map[string]any{"liveView": lv, "token": tokens}}
	}
	// ⛔ 华为 V3 的 liveView 是**场景化消息 payload 本体**，不是
	//    `{"payload":{"liveView":...}}`：正确形状是
	//    `{"payload":{"activityId":...},"target":{"token":[...]}}`。
	//    套一层 liveView 会被回 80100003 payload null（2026-10-20 文档/实测）。
	return map[string]any{
		"payload": lv,
		"target":  map[string]any{"token": tokens},
	}
}

// doLiveView 发送实况窗（工具/RPC 共用）。实况窗更新不做通知去重/静音（它本身就是
// 有状态的进度条；重复发同内容由华为侧幂等覆盖）。
func doLiveView(req LiveViewRequest, kind string) sendOutcome {
	cfg := settings.Load()
	if err := cfg.validate(); err != nil {
		return sendOutcome{Reason: err.Error()}
	}
	req = normalizeLiveView(req)
	devices := ledger.Devices()
	if len(devices) == 0 {
		out := sendOutcome{Reason: "还没有登记任何设备：请在手机上打开 xbot（设置 → 插件 → 鸿蒙推送 → 登记本机）"}
		ledger.AppendLog(LogEntry{Kind: kind, Title: "实况窗", Err: out.Reason})
		return out
	}
	sortDevicesForDisplay(devices)
	names := make([]string, 0, len(devices))
	tokens := make([]string, 0, len(devices))
	for _, d := range devices {
		tokens = append(tokens, d.Token)
		if d.Name != "" {
			names = append(names, d.Name)
		} else {
			names = append(names, maskToken(d.Token))
		}
	}
	if req.DryRun {
		return sendOutcome{Success: true, Devices: names, DryRun: true, Title: req.Title}
	}
	// ⛔ 与通知一样逐 token 发送：华为对 token 的校验是整批 all-or-nothing，
	//    一个历史失效 token 会让整批回 80300007，有效真机也收不到。
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	totalOK, totalFail := 0, 0
	var lastCode, lastHint string
	for _, tk := range tokens {
		res, err := pusher.sendLiveView(ctx, cfg, []string{tk}, req)
		if err != nil {
			totalFail++
			lastHint = err.Error()
			ledger.MarkResult(tk, false, err.Error())
			continue
		}
		if res.OK {
			totalOK++
			ledger.MarkResult(tk, true, "")
			continue
		}
		totalFail++
		lastCode, lastHint = res.Code, res.Hint
		ledger.MarkResult(tk, false, res.Code+" "+res.Hint)
	}
	out := sendOutcome{
		Success: totalOK > 0 && totalFail == 0, Sent: totalOK, Failed: totalFail, Devices: names,
		Code: lastCode, Hint: lastHint, Title: req.Title,
	}
	if totalOK == 0 && lastHint != "" {
		out.Reason = lastHint
	}
	ledger.AppendLog(LogEntry{Kind: kind, Title: "实况窗", OK: totalOK, Fail: totalFail, Code: lastCode, Err: lastHint})
	return out
}

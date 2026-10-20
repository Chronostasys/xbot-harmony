package main

// main.go —— 插件入口：stdio NDJSON（协议见 xbot `plugin/PROTOCOL.md`）。
//
// 本插件提供（全部是**新增**能力，不改服务端任何代码 ⇒ 纯非侵入）：
//   · 工具 `push_harmony_noti`（**全渠道**：由 activate 声明一次，LLM 在任何会话/渠道都能调用）
//   · 上下文注入（enricher）：提示 AI 在长任务结束时主动通知用户（可由设置关闭）
//   · 前端 RPC（`web_plugin_rpc` → `xbot.harmony-push.<method>`）：
//       status / register_token / unregister_token / list_devices / rename_device /
//       send / send_test / log_recent / clear_devices / settings_get / settings_set
//     ⇒ App 用它完成「一键登记本机 Push Token」「列出设备」「发测试推送」「看投递日志」。
//
// ⛔ 安全与纪律：
//   · 真 Push Token **绝不出现在** RPC 回执/日志/错误串里（一律 `maskToken`）；
//   · 任何失败都返回**可读中文**结论（含错误码解释），不静默吞错（用户要能自己排查）；
//   · 插件进程被杀/重启不影响任何既有功能：所有状态都在自己的目录里。

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ai-pivot/xbot/plugin/protocol"
)

const (
	pluginID     = "xbot.harmony-push"
	toolPushNoti = "push_harmony_noti"
	toolLiveView = "push_harmony_liveview"
	enricherHint = "harmony-push-hint"
	// 单次请求携带的 token 上限（超出的分批发送；华为对单次 token 数有限制）
	batchTokens = 100
	// 文案长度上限（华为通知栏限制；超出按语义截断并回执说明）
	maxTitleLen = 100
	maxBodyLen  = 500
)

var (
	root     string
	settings *settingsStore
	ledger   *Store
	pusher   *pushClient
)

func main() {
	root = resolveRoot()
	settings = newSettingsStore(filepath.Join(root, "config.json"))
	ledger = openStore(filepath.Join(root, "data.json"))
	pusher = newPushClient(nil)
	protocol.Run(&protocol.Handler{
		Activate:     activate,
		ExecuteTool:  executeTool,
		Enrich:       enrich,
		WebPluginRPC: webRPC,
		Deactivate:   func() {},
	})
}

// resolveRoot 定位插件安装目录（= host 写 config.json 的地方）。
//
// 依据：协议规定插件进程的 **cwd = 安装目录**；但为稳妥仍做多重兜底：
// ① 环境变量 XBOT_PLUGIN_DIR（测试/手工运行用）；② cwd 含 plugin.json；
// ③ 可执行文件所在目录 / 其父目录（entry 为 `./bin/xxx` 时，安装目录 = exe 的父目录）。
func resolveRoot() string {
	if v := strings.TrimSpace(os.Getenv("XBOT_PLUGIN_DIR")); v != "" {
		return v
	}
	if wd, err := os.Getwd(); err == nil && hasManifest(wd) {
		return wd
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if hasManifest(dir) {
			return dir
		}
		if hasManifest(filepath.Dir(dir)) {
			return filepath.Dir(dir)
		}
	}
	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	return "."
}

func hasManifest(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, "plugin.json"))
	return err == nil
}

// ── activate ─────────────────────────────────────────────────────────────────

func activate(params *protocol.ActivateParams) (*protocol.ActivateResult, error) {
	return &protocol.ActivateResult{
		Result: "ok",
		Tools: []protocol.ToolDef{{
			Name: toolPushNoti,
			Description: "向用户已登记的华为手机推送一条**系统通知**（服务端直推，用户无需打开 xbot 也能看到）。" +
				"适用：耗时任务结束（长命令/构建/测试/批量处理跑完）、需要用户尽快知晓的重要事件。" +
				"⛔ 不要为每条普通回复都推送，避免打扰。返回各设备投递结果。",
			Parameters: []protocol.ToolParam{
				{Name: "title", Type: "string", Description: "通知标题（建议 ≤30 字，说清是什么任务）", Required: true},
				{Name: "body", Type: "string", Description: "通知正文（结论/下一步；建议 ≤200 字）", Required: true},
				{Name: "level", Type: "string", Description: "提醒强度：info（默认）/ warn / error；error 会绕过静音时段", Required: false},
				{Name: "category", Type: "string", Description: "华为消息分类（如 IM/ACCOUNT/ORDER）；留空用设置默认", Required: false},
				{Name: "ttl", Type: "number", Description: "设备侧留存秒数（默认按设置里的天数）", Required: false},
				{Name: "silent", Type: "boolean", Description: "静默推送（只进通知栏，不亮屏不响铃）", Required: false},
				{Name: "notifyId", Type: "number", Description: "相同值会**覆盖**上一条通知（用于「进度更新」合并）", Required: false},
				{Name: "data", Type: "string", Description: "附加 JSON 字符串（应用内可解析，如 {\"kind\":\"task\"}）", Required: false},
				{Name: "dryRun", Type: "boolean", Description: "只校验与回执，不真正发送（排查用）", Required: false},
			},
		}, {
			Name: toolLiveView,
			Description: "通过 Push Kit 远程更新/结束一条**实况窗**（服务器直推；App 进程被杀也能刷新）。" +
				"activityId 必须与客户端本地已创建的实况窗 id 一致；PROGRESS 场景远端只支持 operation=1/2。",
			Parameters: []protocol.ToolParam{
				{Name: "activityId", Type: "number", Description: "实况窗 id（默认 20261017）", Required: false},
				{Name: "operation", Type: "number", Description: "1=更新（默认），2=结束；0=远程创建（仅 FLIGHT/TAXI/TRAIN）", Required: false},
				{Name: "event", Type: "string", Description: "场景 event（默认 PROGRESS；远程创建仅 FLIGHT/TAXI/TRAIN）", Required: false},
				{Name: "status", Type: "string", Description: "场景状态（可选，按场景取值）", Required: false},
				{Name: "title", Type: "string", Description: "卡片标题", Required: false},
				{Name: "content", Type: "string", Description: "卡片正文", Required: false},
				{Name: "capsuleTitle", Type: "string", Description: "胶囊标题", Required: false},
				{Name: "capsuleContent", Type: "string", Description: "胶囊副文本", Required: false},
				{Name: "version", Type: "number", Description: "更新版本号（大于上次）", Required: false},
				{Name: "test", Type: "boolean", Description: "测试消息", Required: false},
				{Name: "dryRun", Type: "boolean", Description: "只校验，不投递", Required: false},
			},
		}},
		Enrichers: []protocol.EnricherReg{{Name: enricherHint}},
	}, nil
}

// ── execute_tool ─────────────────────────────────────────────────────────────

func executeTool(params *protocol.ExecuteToolParams) (*protocol.ExecuteToolResult, error) {
	if params.ToolName == toolLiveView {
		var lv LiveViewRequest
		if strings.TrimSpace(params.Input) != "" {
			if err := json.Unmarshal([]byte(params.Input), &lv); err != nil {
				return &protocol.ExecuteToolResult{Error: "实况窗参数不是合法 JSON：" + err.Error()}, nil
			}
		}
		buf, _ := json.Marshal(doLiveView(lv, "liveview-tool"))
		return &protocol.ExecuteToolResult{Result: string(buf)}, nil
	}
	if params.ToolName != toolPushNoti {
		return &protocol.ExecuteToolResult{Error: "未知工具：" + params.ToolName}, nil
	}
	var req PushRequest
	if strings.TrimSpace(params.Input) != "" {
		if err := json.Unmarshal([]byte(params.Input), &req); err != nil {
			return &protocol.ExecuteToolResult{Error: "参数不是合法 JSON：" + err.Error()}, nil
		}
	}
	out := doSend(req, "tool")
	buf, _ := json.Marshal(out)
	if out.Reason != "" {
		// 让 LLM 看到"为什么没发出去"（附 error 字段），同时把可读结论回给模型
		return &protocol.ExecuteToolResult{Result: string(buf)}, nil
	}
	return &protocol.ExecuteToolResult{Result: string(buf)}, nil
}

// ── enrich：长任务结束提醒（设置可关）──────────────────────────────────────────

func enrich(params *protocol.EnrichParams) (*protocol.EnrichResult, error) {
	if params.EnricherName != enricherHint {
		return &protocol.EnrichResult{Result: ""}, nil
	}
	cfg := settings.Load()
	if !cfg.AgentHint || !cfg.Enabled {
		return &protocol.EnrichResult{Result: ""}, nil
	}
	tip := "用户已开启手机推送（工具 `push_harmony_noti`，服务端直推）。" +
		"当一项任务**耗时较长**（例如单条命令跑了 >60 秒、多轮工具调用、批量构建/测试/改写）且结束时用户可能不在看屏幕，" +
		"请在收尾时调用一次 `push_harmony_noti`（title=任务名，body=结论与下一步），让用户离开应用也能收到结果。" +
		"⛔ 普通问答、秒级完成的修改**不要**推送。"
	return &protocol.EnrichResult{Result: tip}, nil
}

// ── 发送主流程（工具与 RPC 共用同一实现 ⇒ 判据唯一）────────────────────────────

// sendOutcome 是一次发送的可读回执（工具回给 LLM / RPC 回给 App 用同一形态）。
type sendOutcome struct {
	// ⛔ 键名纪律：`ok` / `error` / `data` 是 host 信封的**保留键**——
	//   host 转发插件 RPC 结果时会把它们从返回体里**剥掉**再重新包信封
	//   （实测：`{"ok":true,...}` 里的 ok 丢失）⇒ 用 `ok:false` 表达业务失败会被静默改成成功的 `ok:true`。
	//   故这里一律用 success / reason（业界无保留语义），并在单测里加"保留键不得出现"的判据。
	Success bool     `json:"success"`
	Sent    int      `json:"sent"`
	Failed  int      `json:"failed"`
	Devices []string `json:"devices,omitempty"` // 掩码后的设备名
	Code    string   `json:"code,omitempty"`
	Hint    string   `json:"hint,omitempty"`
	Skipped string   `json:"skipped,omitempty"`
	DryRun  bool     `json:"dryRun,omitempty"`
	Reason  string   `json:"reason,omitempty"`
	Title   string   `json:"title,omitempty"`
}

func doSend(req PushRequest, kind string) sendOutcome {
	cfg := settings.Load()
	if err := cfg.validate(); err != nil {
		return sendOutcome{Reason: err.Error()}
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Body = strings.TrimSpace(req.Body)
	if req.Title == "" || req.Body == "" {
		return sendOutcome{Reason: "标题与正文不能为空"}
	}
	req.Title = truncateRunes(req.Title, maxTitleLen)
	req.Body = truncateRunes(req.Body, maxBodyLen)
	if req.Level == "" {
		req.Level = cfg.DefaultLevel
	}
	now := time.Now()

	// ① 静音时段（error 豁免）
	if inQuietHours(cfg.QuietHours, now) && strings.ToLower(req.Level) != "error" {
		out := sendOutcome{Skipped: "静音时段(" + cfg.QuietHours + ")内不打扰", Title: req.Title}
		ledger.AppendLog(LogEntry{Kind: kind, Title: req.Title, Err: out.Skipped})
		return out
	}
	// ② 合并窗口（同标题+正文）
	key := hashKey(req.Title + "\x00" + req.Body)
	if ledger.dedupeHit(key, cfg.CollapseWindowSec, now) {
		out := sendOutcome{Skipped: fmt.Sprintf("%d 秒内已发过相同内容（合并窗口）", cfg.CollapseWindowSec), Title: req.Title}
		ledger.AppendLog(LogEntry{Kind: kind, Title: req.Title, Err: out.Skipped})
		return out
	}
	// ③ 限流
	if !ledger.allowRate(cfg.MaxPerMinute, now) {
		out := sendOutcome{Reason: fmt.Sprintf("触发限流：每分钟最多 %d 条", cfg.MaxPerMinute)}
		ledger.AppendLog(LogEntry{Kind: kind, Title: req.Title, Err: out.Reason})
		return out
	}
	// ④ 设备
	devices := ledger.Devices()
	if len(devices) == 0 {
		out := sendOutcome{Reason: "还没有登记任何设备：请在手机上打开 xbot（设置 → 插件 → 鸿蒙推送 → 登记本机）"}
		ledger.AppendLog(LogEntry{Kind: kind, Title: req.Title, Err: out.Reason})
		return out
	}
	sortDevicesForDisplay(devices)
	names := make([]string, 0, len(devices))
	tokens := make([]string, 0, len(devices))
	for _, d := range devices {
		tokens = append(tokens, d.Token)
		label := d.Name
		if label == "" {
			label = maskToken(d.Token)
		}
		names = append(names, label)
	}
	if req.DryRun {
		out := sendOutcome{Success: true, Devices: names, DryRun: true, Title: req.Title}
		ledger.AppendLog(LogEntry{Kind: kind, Title: req.Title, OK: len(tokens)})
		return out
	}

	// ⑤ 分批发送
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	totalOK, totalFail := 0, 0
	var lastCode, lastHint string
	for start := 0; start < len(tokens); start += batchTokens {
		end := start + batchTokens
		if end > len(tokens) {
			end = len(tokens)
		}
		res, err := pusher.send(ctx, cfg, tokens[start:end], req)
		if err != nil {
			totalFail += end - start
			lastHint = err.Error()
			continue
		}
		if res.OK {
			totalOK += end - start
		} else {
			totalFail += end - start
			lastCode, lastHint = res.Code, res.Hint
			for _, tk := range tokens[start:end] {
				ledger.MarkResult(tk, false, res.Code+" "+res.Hint)
			}
		}
	}
	if totalOK > 0 {
		for _, tk := range tokens {
			ledger.MarkResult(tk, true, "")
		}
	}
	out := sendOutcome{
		Success: totalFail == 0,
		Sent:    totalOK,
		Failed:  totalFail,
		Devices: names,
		Code:    lastCode,
		Hint:    lastHint,
		Title:   req.Title,
	}
	if totalOK == 0 {
		out.Success = false
		if out.Reason == "" && lastHint != "" {
			out.Reason = lastHint
		}
	}
	ledger.AppendLog(LogEntry{
		Kind: kind, Title: req.Title, OK: totalOK, Fail: totalFail,
		Code: lastCode, Err: lastHint, Devices: strings.Join(names, ", "),
	})
	return out
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}

func hashKey(s string) string {
	sum := sha1.Sum([]byte(s))
	return hex.EncodeToString(sum[:8])
}

// ── 前端 RPC（App → web_plugin_rpc → xbot.harmony-push.<method>）──────────────

// webRPC 适配协议签名（Handler.WebPluginRPC 要求 (result, error)）；主体在 webRPCDispatch。
func webRPC(p *protocol.WebPluginRPCParams) (*protocol.WebPluginRPCResult, error) {
	return webRPCDispatch(p), nil
}

func webRPCDispatch(p *protocol.WebPluginRPCParams) *protocol.WebPluginRPCResult {
	var params map[string]any
	if len(p.Params) > 0 {
		_ = json.Unmarshal(p.Params, &params)
	}
	switch p.Method {
	case "status":
		return okRPC(statusPayload())
	case "register_token":
		return okRPC(registerToken(params))
	case "unregister_token":
		token := str(params["token"])
		removed := ledger.RemoveDevice(token)
		return okRPC(map[string]any{"success": removed, "devices": deviceList(), "count": ledger.DeviceCount()})
	case "list_devices":
		return okRPC(map[string]any{"success": true, "devices": deviceList(), "count": ledger.DeviceCount()})
	case "rename_device":
		done := ledger.Rename(str(params["token"]), str(params["name"]))
		return okRPC(map[string]any{"success": done, "devices": deviceList()})
	case "clear_devices":
		n := ledger.ClearDevices()
		return okRPC(map[string]any{"success": true, "cleared": n, "count": ledger.DeviceCount()})
	case "send":
		req := PushRequest{
			Title: str(params["title"]), Body: str(params["body"]),
			Level: str(params["level"]), Category: str(params["category"]),
			TTL: intVal(params["ttl"]), Silent: boolVal(params["silent"]),
			Data: str(params["data"]), NotifyID: intVal(params["notifyId"]),
			Test: boolVal(params["test"]), DryRun: boolVal(params["dryRun"]),
		}
		return okRPC(doSend(req, "rpc"))
	case "send_test":
		req := PushRequest{
			Title: "xbot 推送测试", Body: "如果你看到这条通知，说明服务端推送链路已打通。",
			Level: "info", Test: true,
		}
		return okRPC(doSend(req, "test"))
	case "liveview_send":
		var lv LiveViewRequest
		raw, _ := json.Marshal(params)
		_ = json.Unmarshal(raw, &lv)
		return okRPC(doLiveView(lv, "liveview-rpc"))
	case "log_recent":
		n := intVal(params["limit"])
		if n <= 0 {
			n = 20
		}
		return okRPC(map[string]any{"success": true, "log": ledger.RecentLog(n)})
	case "settings_get":
		return okRPC(settingsPayload())
	case "settings_set":
		// 兼容两种形态：{key,value} 或 {patch:{k:v,...}}
		if patch, ok := params["patch"].(map[string]any); ok && len(patch) > 0 {
			if err := mergeConfig(root, patch); err != nil {
				return errRPC(err.Error())
			}
			return okRPC(settingsPayload())
		}
		key := str(params["key"])
		if key == "" {
			return errRPC("缺少 key")
		}
		if err := mergeConfig(root, map[string]any{key: params["value"]}); err != nil {
			return errRPC(err.Error())
		}
		return okRPC(settingsPayload())
	default:
		return errRPC("未知方法：" + p.Method)
	}
}

// statusPayload 一次给全 App 需要的信息（设置是否就绪 / 设备数 / 最近投递 / 令牌缓存）。
func statusPayload() map[string]any {
	cfg := settings.Load()
	ready := cfg.validate() == nil
	status := "就绪"
	if err := cfg.validate(); err != nil {
		status = err.Error()
	}
	logs := ledger.RecentLog(1)
	var last any
	if len(logs) > 0 {
		last = logs[0]
	}
	return map[string]any{
		"success":     true,
		"plugin":      pluginID,
		"enabled":     cfg.Enabled,
		"ready":       ready,
		"status":      status,
		"apiVersion":  cfg.APIVersion,
		"hasToken":    pusher.hasToken(),
		"deviceCount": ledger.DeviceCount(),
		"devices":     deviceList(),
		"lastSend":    last,
		"quietHours":  cfg.QuietHours,
		"maxPerMin":   cfg.MaxPerMinute,
		"updatedAt":   time.Now().Unix(),
	}
}

func settingsPayload() map[string]any {
	cfg := settings.Load()
	// ⛔ Client Secret 只回掩码：App 界面展示用，真值绝不下发。
	return map[string]any{
		"success": true,
		"enabled": cfg.Enabled, "appId": cfg.AppID, "projectId": cfg.ProjectID,
		"clientId": cfg.ClientID, "clientSecret": maskSecret(cfg.ClientSecret),
		"apiVersion": cfg.APIVersion, "defaultCategory": cfg.DefaultCategory,
		"defaultLevel": cfg.DefaultLevel, "defaultTtlDays": cfg.DefaultTTLDays,
		"collapseWindowSec": cfg.CollapseWindowSec, "maxPerMinute": cfg.MaxPerMinute,
		"quietHours": cfg.QuietHours, "agentHint": cfg.AgentHint,
		"ready": cfg.validate() == nil,
	}
}

func registerToken(params map[string]any) map[string]any {
	token := strings.TrimSpace(str(params["token"]))
	if token == "" {
		return map[string]any{"success": false, "reason": "缺少 token"}
	}
	added := ledger.UpsertDevice(Device{
		Token:     token,
		ProfileID: str(params["profileId"]),
		Name:      str(params["name"]),
		Platform:  str(params["platform"]),
		Version:   str(params["version"]),
	})
	return map[string]any{
		"success": true, "added": added, "devices": deviceList(),
		"count": ledger.DeviceCount(), "masked": maskToken(token),
	}
}

func deviceList() []map[string]any {
	ds := ledger.Devices()
	sortDevicesForDisplay(ds)
	out := make([]map[string]any, 0, len(ds))
	for _, d := range ds {
		out = append(out, map[string]any{
			"masked":    maskToken(d.Token),
			"name":      d.Name,
			"platform":  d.Platform,
			"version":   d.Version,
			"lastSeen":  d.LastSeen,
			"firstSeen": d.FirstSeen,
			"sendOk":    d.SendOK,
			"sendFail":  d.SendFail,
			"lastError": d.LastError,
		})
	}
	return out
}

// maskSecret 掩码 client_secret（前 2 位 + ***）。
func maskSecret(s string) string {
	if s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) <= 2 {
		return "***"
	}
	return string(r[:2]) + "***"
}

// ── 小工具 ───────────────────────────────────────────────────────────────────

func str(v any) string {
	s, _ := v.(string)
	return strings.TrimSpace(s)
}

func intVal(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case string:
		var n int
		if _, err := fmt.Sscanf(t, "%d", &n); err == nil {
			return n
		}
	}
	return 0
}

func boolVal(v any) bool {
	b, _ := v.(bool)
	return b
}

func okRPC(payload any) *protocol.WebPluginRPCResult {
	buf, err := json.Marshal(payload)
	if err != nil {
		return errRPC(err.Error())
	}
	return &protocol.WebPluginRPCResult{Result: string(buf)}
}

// errRPC 返回**业务失败**（⛔ 不是协议错误）。
//
// ⛔ 为什么不设 `protocol.Error`：host `plugin/manager.go:938` 一旦看到 `resp.Error != ""` 就把它
//   升级成 host 级错误 ⇒ 客户端拿到 **HTTP 500**（用户亲报「一进去就 500」就是这么来的）。
//   业务失败必须是"**成功的 RPC + success:false + 可读 reason**"，让界面能正常展示。
// ⛔ 键名不用 `ok`/`error`：它们是 host 信封保留键，会被剥掉（见 sendOutcome 注释）。
func errRPC(msg string) *protocol.WebPluginRPCResult {
	buf, _ := json.Marshal(map[string]any{"success": false, "reason": msg})
	return &protocol.WebPluginRPCResult{Result: string(buf)}
}

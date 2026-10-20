package main

// plugin_test.go —— 判别力测试：把"会出错的地方"全部钉住（纯逻辑 + 假 HTTP，不联网）。
//
// 覆盖：
//  ① 设置解析（默认值/类型收敛/越界钳制/secret 掩码）
//  ② 静音时段（跨天/非法/空）
//  ③ 推送 URL 与请求体（V3/V1、逐字段：category/clickAction/foregroundShow/notifyId/ttl/data/testMessage）
//  ④ 台账（幂等登记/注销/改名/限流/合并窗口/日志环形/落盘可解析）
//  ⑤ 令牌缓存（第二次不联网）与错误码 → 中文建议
//  ⑥ `doSend` 端到端（跳过静音/合并/限流；无设备报错；dryRun；成功分批）

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ai-pivot/xbot/plugin/protocol"
)

// ── ① 设置 ────────────────────────────────────────────────────────────────────

func TestParseSettingsDefaultsAndCoercion(t *testing.T) {
	s := parseSettings(nil)
	// 默认接口版本 = v1：依据 2026-10-17 实测（本应用 + 应用级凭证，v1 被华为受理、v3 报 80200001）
	if s.APIVersion != "v1" || s.DefaultLevel != "info" || s.DefaultTTLDays != 7 ||
		s.MaxPerMinute != 12 || !s.Enabled || !s.AgentHint || s.CollapseWindowSec != 30 {
		t.Fatalf("默认值不对：%+v", s)
	}
	// 类型收敛：数字可能是 float64 / 字符串（App 写 JSON 的两种常见形态）
	raw := map[string]any{
		"enabled": false, "defaultTtlDays": float64(99), "maxPerMinute": "999",
		"apiVersion": "V1", "defaultLevel": "ERROR", "collapseWindowSec": -5,
	}
	s = parseSettings(raw)
	if s.Enabled {
		t.Fatal("enabled 未生效")
	}
	if s.DefaultTTLDays != 30 {
		t.Fatalf("天数应被钳到 30，实际 %d", s.DefaultTTLDays)
	}
	if s.MaxPerMinute != 60 {
		t.Fatalf("限流应被钳到 60，实际 %d", s.MaxPerMinute)
	}
	if s.APIVersion != "v1" || s.DefaultLevel != "error" {
		t.Fatalf("枚举未归一化：%q %q", s.APIVersion, s.DefaultLevel)
	}
	if s.CollapseWindowSec != 0 {
		t.Fatalf("负窗口应归 0，实际 %d", s.CollapseWindowSec)
	}
	// 非法枚举回落默认
	s = parseSettings(map[string]any{"apiVersion": "v9", "defaultLevel": "loud"})
	if s.APIVersion != "v3" || s.DefaultLevel != "info" {
		t.Fatalf("非法枚举应回落默认：%+v", s)
	}
}

func TestSettingsValidate(t *testing.T) {
	s := defaultSettings()
	if err := s.validate(); err == nil {
		t.Fatal("缺凭证必须报错")
	}
	s.Enabled = false
	if err := s.validate(); err == nil || !strings.Contains(err.Error(), "推送已关闭") {
		t.Fatalf("关闭时应提示已关闭，实际 %v", err)
	}
	s = defaultSettings()
	s.ClientSecret = "sec"
	s.AppID = "app1"
	s.ProjectID = "proj1"
	if err := s.validate(); err != nil {
		t.Fatalf("齐备时应通过，实际 %v", err)
	}
	// v1（默认版本）缺 App ID 必须提示
	sv1 := defaultSettings()
	sv1.ClientSecret = "sec"
	if err := sv1.validate(); err == nil || !strings.Contains(err.Error(), "App ID") {
		t.Fatalf("v1 缺 App ID 应提示，实际 %v", err)
	}
	s.QuietHours = "25:00-07:00"
	if err := s.validate(); err == nil {
		t.Fatal("非法静音时段必须报错")
	}
	// V3 需要 ProjectId（用 clientId 兜底 token client）
	s = defaultSettings()
	s.APIVersion = "v3" // 显式 v3 才要求 ProjectId（默认已是 v1，见实测依据）
	s.ClientSecret, s.ClientID, s.ProjectID = "sec", "cid", ""
	if err := s.validate(); err == nil || !strings.Contains(err.Error(), "Project ID") {
		t.Fatalf("V3 缺 ProjectId 应提示，实际 %v", err)
	}
}

func TestTokenClientIDPrefersClientID(t *testing.T) {
	s := Settings{AppID: "app", ClientID: "cid"}
	if s.tokenClientID() != "cid" {
		t.Fatal("显式 ClientID 应优先")
	}
	s.ClientID = ""
	if s.tokenClientID() != "app" {
		t.Fatal("缺 ClientID 时回落到 AppID（华为口径：client_id = AGC App ID）")
	}
}

// ── ② 静音时段 ────────────────────────────────────────────────────────────────

func TestQuietHours(t *testing.T) {
	if _, _, ok := parseQuietHours(""); !ok {
		t.Fatal("空串是合法（= 不静音）")
	}
	if inQuietHours("", time.Now()) {
		t.Fatal("空串永远不在静音时段")
	}
	cases := []struct {
		spec string
		h, m int
		want bool
	}{
		{"23:00-07:00", 23, 30, true},
		{"23:00-07:00", 6, 59, true},
		{"23:00-07:00", 7, 0, false},
		{"23:00-07:00", 12, 0, false},
		{"09:00-18:00", 10, 0, true},
		{"09:00-18:00", 18, 0, false},
	}
	for _, c := range cases {
		got := inQuietHours(c.spec, time.Date(2026, 10, 17, c.h, c.m, 0, 0, time.Local))
		if got != c.want {
			t.Fatalf("%s @ %02d:%02d = %v，期望 %v", c.spec, c.h, c.m, got, c.want)
		}
	}
	for _, bad := range []string{"23:00", "23:00-", "aa:00-07:00", "23:00-07:60", "23:00-23:00"} {
		if _, _, ok := parseQuietHours(bad); ok {
			t.Fatalf("非法时段 %q 被接受", bad)
		}
	}
}

// ── ③ URL 与请求体 ────────────────────────────────────────────────────────────

func TestPushEndpoint(t *testing.T) {
	cfg := defaultSettings()
	cfg.APIVersion, cfg.ProjectID = "v3", "123456"
	got, err := pushEndpoint(cfg)
	if err != nil || got != "https://push-api.cloud.huawei.com/v3/123456/messages:send" {
		t.Fatalf("V3 URL 不对：%s %v", got, err)
	}
	cfg = defaultSettings()
	cfg.APIVersion, cfg.AppID = "v1", "999"
	got, err = pushEndpoint(cfg)
	if err != nil || got != "https://push-api.cloud.huawei.com/v1/999/messages:send" {
		t.Fatalf("V1 URL 不对：%s %v", got, err)
	}
	if _, err := pushEndpoint(defaultSettings()); err == nil {
		t.Fatal("缺 ID 必须报错（V3 无 ProjectId）")
	}
}

func TestBuildPushPayload(t *testing.T) {
	cfg := defaultSettings()
	cfg.APIVersion = "v3" // 本用例断言的是 v3 形状（v1 形状见 TestPayloadShapePerAPIVersion）
	cfg.DefaultCategory = "IM"
	cfg.DefaultTTLDays = 7
	req := PushRequest{Title: "标题", Body: "正文", Level: "error", NotifyID: 42, Test: true}
	p := buildPushPayload(cfg, req, []string{"tok1", "tok2"})
	buf, _ := json.Marshal(p)
	var m map[string]any
	_ = json.Unmarshal(buf, &m)

	target := m["target"].(map[string]any)
	toks := target["token"].([]any)
	if len(toks) != 2 || toks[0] != "tok1" {
		t.Fatalf("token 数组不对：%v", toks)
	}
	payload := m["payload"].(map[string]any)
	n := payload["notification"].(map[string]any)
	if n["title"] != "标题" || n["body"] != "正文" {
		t.Fatal("标题/正文丢失")
	}
	if n["category"] != "IM" {
		t.Fatal("category 未用设置默认值")
	}
	ca := n["clickAction"].(map[string]any)
	if ca["actionType"].(float64) != 0 {
		t.Fatal("clickAction 必须是打开首页（actionType=0）")
	}
	if n["foregroundShow"] != true {
		t.Fatal("默认应在应用前台也展示")
	}
	if n["notifyId"].(float64) != 42 {
		t.Fatal("notifyId 未透传")
	}
	if n["importance"] != "HIGH" {
		t.Fatalf("error 应为 HIGH，实际 %v", n["importance"])
	}
	if payload["ttl"] != "604800s" {
		t.Fatalf("ttl 应为 7 天秒数，实际 %v", payload["ttl"])
	}
	opts := payload["pushOptions"].(map[string]any)
	if opts["testMessage"] != true {
		t.Fatal("testMessage 未透传")
	}

	// silent：前台不展示
	p2 := buildPushPayload(cfg, PushRequest{Title: "t", Body: "b", Silent: true}, []string{"x"})
	pl2 := p2["payload"].(map[string]any)
	if pl2["notification"].(map[string]any)["foregroundShow"] != false {
		t.Fatal("silent 应把 foregroundShow 置 false")
	}

	// 显式 ttl 覆盖设置天数；显式 category 覆盖默认
	p3 := buildPushPayload(cfg, PushRequest{Title: "t", Body: "b", TTL: 60, Category: "ACCOUNT"}, []string{"x"})
	pl3 := p3["payload"].(map[string]any)
	if pl3["ttl"] != "60s" {
		t.Fatalf("显式 ttl 未覆盖：%v", pl3["ttl"])
	}
	if pl3["notification"].(map[string]any)["category"] != "ACCOUNT" {
		t.Fatal("显式 category 未覆盖默认")
	}
	// ⛔ 华为要求 category 非空（实测 80100003 Illegal payload …should not empty）⇒
	//   任何路径都必须带非空 category（未配默认值时用兜底 IM）。
	p4 := buildPushPayload(Settings{APIVersion: "v3", DefaultTTLDays: 1}, PushRequest{Title: "t", Body: "b"}, []string{"x"})
	c4, ok4 := p4["payload"].(map[string]any)["notification"].(map[string]any)["category"]
	if !ok4 || c4 == "" {
		t.Fatalf("category 必须非空且存在，实际 %v", c4)
	}
	// 默认设置也必须是非空
	nd := defaultSettings()
	if nd.DefaultCategory == "" {
		t.Fatal("默认分类不得为空（否则每条都会被华为拒）")
	}
	nd.APIVersion = "v3"
	p5 := buildPushPayload(nd, PushRequest{Title: "t", Body: "b"}, []string{"x"})
	if p5["payload"].(map[string]any)["notification"].(map[string]any)["category"] != nd.DefaultCategory {
		t.Fatal("应使用设置的默认分类")
	}
}

// TestPayloadShapePerAPIVersion 钉住"token 放在哪"这条实测差异：
//
//	v1（HMSCore 代）⇒ message.token；v3（NEXT）⇒ target.token。
//
// 放错位置会被华为回 80300010（token count should within 1 and 1,000）——实测踩过。
func TestPayloadShapePerAPIVersion(t *testing.T) {
	cfg := defaultSettings()
	cfg.APIVersion = "v3"
	p3 := buildPushPayload(cfg, PushRequest{Title: "t", Body: "b"}, []string{"tk"})
	if _, ok := p3["target"]; !ok {
		t.Fatal("v3 必须有 target.token")
	}
	if _, ok := p3["payload"]; !ok {
		t.Fatal("v3 必须有 payload.notification")
	}
	if _, bad := p3["message"]; bad {
		t.Fatal("v3 不应出现 message（那是 v1 形态）")
	}
	cfg.APIVersion = "v1"
	p1 := buildPushPayload(cfg, PushRequest{Title: "t", Body: "b"}, []string{"tk"})
	msg, ok := p1["message"].(map[string]any)
	if !ok {
		t.Fatal("v1 必须有 message 包裹")
	}
	if _, ok := msg["token"].([]string); !ok {
		t.Fatalf("v1 的 token 必须在 message.token（放 target 会被回 80300010）：%v", msg)
	}
	if _, ok := msg["notification"].(map[string]any); !ok {
		t.Fatal("v1 的 notification 必须在 message 内")
	}
	if _, bad := p1["target"]; bad {
		t.Fatal("v1 不应出现 target（那是 v3 形态）")
	}
}

func TestMaskTokenAndSecret(t *testing.T) {
	if maskToken("") != "***" || maskToken("ab") != "***" {
		t.Fatal("短 token 掩码不对")
	}
	if maskToken("abcdefghij") != "abcdef…ghij" {
		t.Fatalf("掩码形态不对：%s", maskToken("abcdefghij"))
	}
	if maskSecret("") != "" || maskSecret("ab") != "***" || maskSecret("abcd") != "ab***" {
		t.Fatal("secret 掩码不对")
	}
}

// ── ④ 台账 ────────────────────────────────────────────────────────────────────

func TestStoreDevicesAndPersistence(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")
	st := openStore(path)
	if st.DeviceCount() != 0 {
		t.Fatal("新台账应为空")
	}
	if !st.UpsertDevice(Device{Token: "tok-a", Name: "手机"}) {
		t.Fatal("首次登记应返回 added=true")
	}
	if st.UpsertDevice(Device{Token: "tok-a", Name: "手机2"}) {
		t.Fatal("重复登记应返回 added=false（幂等）")
	}
	ds := st.Devices()
	if len(ds) != 1 || ds[0].Name != "手机2" {
		t.Fatalf("重复登记应刷新字段：%+v", ds)
	}
	if !st.Rename("tok-a", "我的手机") || st.Devices()[0].Name != "我的手机" {
		t.Fatal("改名失败")
	}
	if !st.RemoveDevice("tok-a") || st.DeviceCount() != 0 {
		t.Fatal("注销失败")
	}
	if st.RemoveDevice("nope") {
		t.Fatal("注销不存在设备应返回 false")
	}
	// 落盘可解析（原子写）
	st.UpsertDevice(Device{Token: "tok-b"})
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("台账未落盘：%v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("落盘内容不是合法 JSON：%v", err)
	}
	if _, err := os.Stat(path + ".tmp"); err == nil {
		t.Fatal("临时文件应已被 rename 掉")
	}
	st2 := openStore(path)
	if st2.DeviceCount() != 1 {
		t.Fatal("重开应读回台账")
	}
}

func TestStoreRateLimitAndDedupe(t *testing.T) {
	st := openStore(filepath.Join(t.TempDir(), "d.json"))
	now := time.Now()
	if !st.allowRate(2, now) || !st.allowRate(2, now) {
		t.Fatal("前两条应放行")
	}
	if st.allowRate(2, now) {
		t.Fatal("第三条应被限流")
	}
	if !st.allowRate(2, now.Add(61*time.Second)) {
		t.Fatal("窗口过后应恢复")
	}
	// 合并窗口
	st2 := openStore(filepath.Join(t.TempDir(), "e.json"))
	if st2.dedupeHit("k", 30, now) {
		t.Fatal("首次不应命中合并窗口")
	}
	if !st2.dedupeHit("k", 30, now.Add(10*time.Second)) {
		t.Fatal("窗口内重复应命中")
	}
	if st2.dedupeHit("k", 30, now.Add(31*time.Second)) {
		t.Fatal("窗口过后不应命中")
	}
	if st2.dedupeHit("", 30, now) {
		t.Fatal("空 key 永不命中")
	}
	if st2.dedupeHit("k2", 0, now) {
		t.Fatal("窗口 0 = 不合并")
	}
}

func TestStoreLogRing(t *testing.T) {
	st := openStore(filepath.Join(t.TempDir(), "l.json"))
	for i := 0; i < maxLogEntries+25; i++ {
		st.AppendLog(LogEntry{Kind: "tool", Title: fmt.Sprintf("t%d", i)})
	}
	all := st.RecentLog(0)
	if len(all) != maxLogEntries {
		t.Fatalf("日志应被裁到 %d 条，实际 %d", maxLogEntries, len(all))
	}
	if all[0].Title != fmt.Sprintf("t%d", maxLogEntries+24) {
		t.Fatalf("取出的第一条应是最新：%s", all[0].Title)
	}
	if got := st.RecentLog(3); len(got) != 3 {
		t.Fatal("limit 未生效")
	}
}

// ── ⑤ 假 HTTP：令牌缓存 + 错误码 ──────────────────────────────────────────────

type fakeHTTP struct {
	calls       []string
	status      int                      // push 响应状态码（0 ⇒ 200）
	body        string                   // push 响应体（空 ⇒ 80000000 成功）
	tokenStatus int                      // oauth 响应状态码（0 ⇒ 200）
	tokenBody   string                   // oauth 响应体（空 ⇒ 正常令牌）
	respond     func(body string) string // 按请求体定制 push 应答（空 ⇒ body/默认成功）
	failNext    bool
}

func (f *fakeHTTP) Do(req *http.Request) (*http.Response, error) {
	b, _ := io.ReadAll(req.Body)
	f.calls = append(f.calls, fmt.Sprintf("%s push-type=%s auth=%s body=%s",
		req.URL.String(), req.Header.Get("push-type"), authPrefix(req.Header.Get("Authorization")), string(b)))
	if f.failNext {
		return nil, fmt.Errorf("boom")
	}
	mk := func(status int, body string) *http.Response {
		if status == 0 {
			status = 200
		}
		return &http.Response{
			StatusCode: status,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     http.Header{},
		}
	}
	// ⛔ 两类请求必须分开应答：取令牌 vs 发消息（否则测试会以"令牌失败"假红）
	if strings.Contains(req.URL.String(), "oauth2/v3/token") {
		body := f.tokenBody
		if body == "" {
			body = `{"access_token":"TOK","expires_in":3600}`
		}
		return mk(f.tokenStatus, body), nil
	}
	body := f.body
	if f.respond != nil {
		body = f.respond(string(b))
	}
	if body == "" {
		body = `{"code":"80000000","msg":"Success"}`
	}
	return mk(f.status, body), nil
}

// authPrefix 只记录鉴权头的**形态**（Bearer/无），不记录令牌本身。
func authPrefix(h string) string {
	if strings.HasPrefix(h, "Bearer ") {
		return "Bearer"
	}
	if h == "" {
		return "none"
	}
	return "other"
}

func TestAccessTokenCaching(t *testing.T) {
	fake := &fakeHTTP{}
	c := newPushClient(fake)
	cfg := Settings{AppID: "app", ClientSecret: "sec"}
	tok, err := c.accessToken(context.Background(), cfg)
	if err != nil || tok != "TOK" {
		t.Fatalf("取令牌失败：%v %s", err, tok)
	}
	if !c.hasToken() {
		t.Fatal("应已缓存令牌")
	}
	// 第二次：命中缓存 ⇒ 不产生新请求
	if _, err := c.accessToken(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("缓存未生效，请求数 = %d", len(fake.calls))
	}
	if !strings.Contains(fake.calls[0], "grant_type=client_credentials") ||
		!strings.Contains(fake.calls[0], "client_id=app") {
		t.Fatalf("令牌请求体不对：%s", fake.calls[0])
	}
	// 失败路径：oauth 应答里没有 access_token（应把华为的 error_description 带出来）
	fake2 := &fakeHTTP{tokenBody: `{"error":100003,"error_description":"invalid client_id"}`}
	c2 := newPushClient(fake2)
	if _, err := c2.accessToken(context.Background(), cfg); err == nil ||
		!strings.Contains(err.Error(), "invalid client_id") {
		t.Fatalf("应把华为错误说明带出来，实际 %v", err)
	}
	if c2.hasToken() {
		t.Fatal("取令牌失败后不应标记为已有令牌")
	}
}

func TestSendMapsErrorHint(t *testing.T) {
	fake := &fakeHTTP{body: `{"code":"80300007","msg":"All the tokens are invalid"}`}
	c := newPushClient(fake)
	cfg := Settings{APIVersion: "v3", ProjectID: "p", AppID: "a", ClientSecret: "s"}
	res, err := c.send(context.Background(), cfg, []string{"tok"}, PushRequest{Title: "t", Body: "b"})
	if err != nil {
		t.Fatal(err)
	}
	if res.OK {
		t.Fatal("80300007 不应判成功")
	}
	if !strings.Contains(res.Hint, "重新登记") {
		t.Fatalf("应给出可执行建议，实际：%s", res.Hint)
	}
	// 成功
	fake2 := &fakeHTTP{body: `{"code":"80000000","msg":"Success"}`}
	c2 := newPushClient(fake2)
	res2, err := c2.send(context.Background(), cfg, []string{"tok"}, PushRequest{Title: "t", Body: "b"})
	if err != nil || !res2.OK {
		t.Fatalf("80000000 应判成功：%+v %v", res2, err)
	}
	// 请求头（push-type / Authorization）必须带
	last := fake2.calls[len(fake2.calls)-1]
	if !strings.Contains(last, "/v3/p/messages:send") {
		t.Fatalf("URL 不对：%s", last)
	}
}

// ── ⑥ doSend 端到端（假 HTTP）─────────────────────────────────────────────────

func setupPluginDir(t *testing.T, cfg map[string]any) string {
	t.Helper()
	dir := t.TempDir()
	raw, _ := json.Marshal(cfg)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	root = dir
	settings = newSettingsStore(filepath.Join(dir, "config.json"))
	ledger = openStore(filepath.Join(dir, "data.json"))
	return dir
}

func readyConfig(extra map[string]any) map[string]any {
	cfg := map[string]any{
		"enabled": true, "appId": "app", "projectId": "proj",
		"clientSecret": "sec", "apiVersion": "v3", "defaultTtlDays": 3,
		"collapseWindowSec": 0, "maxPerMinute": 60,
	}
	for k, v := range extra {
		cfg[k] = v
	}
	return cfg
}

func TestNormalizeDeviceName(t *testing.T) {
	cases := map[string]string{
		"HUAWEI HUAWEI Mate 90 Pro Max": "HUAWEI Mate 90 Pro Max",
		"HUAWEI HUAWEI HUAWEI Mate":     "HUAWEI Mate",
		"HUAWEI Mate 90 Pro Max":        "HUAWEI Mate 90 Pro Max",
		"  HUAWEI   HUAWEI  Mate  ":     "HUAWEI Mate",
		"":                              "",
	}
	for in, want := range cases {
		if got := normalizeDeviceName(in); got != want {
			t.Fatalf("normalizeDeviceName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRouteIDPerAPIVersion(t *testing.T) {
	cfg := defaultSettings()
	cfg.AppID, cfg.ProjectID, cfg.APIVersion = "app", "proj", "v1"
	if got := cfg.routeID(); got != "proj" {
		t.Fatalf("V1 路由必须是 Project ID（App ID ⇒ 80300007 假无效），实际 %q", got)
	}
	cfg.ProjectID = ""
	if got := cfg.routeID(); got != "app" {
		t.Fatalf("缺 Project ID 才回退 App ID，实际 %q", got)
	}
}

func TestDoSendEndToEnd(t *testing.T) {
	setupPluginDir(t, readyConfig(nil))
	fake := &fakeHTTP{body: `{"code":"80000000","msg":"Success"}`}
	pusher = newPushClient(fake)

	// 无设备 ⇒ 可读报错
	out := doSend(PushRequest{Title: "t", Body: "b"}, "tool")
	if out.Reason == "" || !strings.Contains(out.Reason, "还没有登记任何设备") {
		t.Fatalf("无设备应报可读错误，实际 %+v", out)
	}
	ledger.UpsertDevice(Device{Token: "tok-1234567890", Name: "手机"})
	out = doSend(PushRequest{Title: "构建完成", Body: "3 个包已发布"}, "tool")
	if !out.Success || out.Sent != 1 || out.Failed != 0 {
		t.Fatalf("应发送成功：%+v", out)
	}
	if out.Title != "构建完成" {
		t.Fatal("回执应带标题（便于日志对账）")
	}
	// 台账计数 + 日志
	ds := ledger.Devices()
	if ds[0].SendOK != 1 {
		t.Fatalf("设备成功计数应 +1：%+v", ds[0])
	}
	if len(ledger.RecentLog(5)) != 2 {
		t.Fatalf("应有 2 条日志（1 失败 + 1 成功），实际 %d", len(ledger.RecentLog(5)))
	}

	// 空标题/正文
	out = doSend(PushRequest{Title: "  ", Body: "b"}, "tool")
	if !strings.Contains(out.Reason, "标题与正文") {
		t.Fatalf("空标题应报错，实际 %+v", out)
	}

	// dryRun 不真发（请求数不变）
	before := len(fake.calls)
	out = doSend(PushRequest{Title: "t", Body: "b2", DryRun: true}, "tool")
	if !out.Success || !out.DryRun {
		t.Fatalf("dryRun 应返回成功且标记：%+v", out)
	}
	if len(fake.calls) != before {
		t.Fatal("dryRun 不应发生网络请求")
	}

	// 分批：>batchTokens 台设备 ⇒ 至少两次请求
	for i := 0; i < batchTokens+5; i++ {
		ledger.UpsertDevice(Device{Token: fmt.Sprintf("bulk-token-%04d", i)})
	}
	before = len(fake.calls)
	out = doSend(PushRequest{Title: "批量", Body: "分批发送"}, "tool")
	if out.Sent != batchTokens+6 {
		t.Fatalf("应统计全部设备：%+v", out)
	}
	if len(fake.calls)-before < 2 {
		t.Fatal("超过单批上限应分批发送")
	}
}

// ⛔ 判据（用户 2026-10-20 亲报「token 必定有效」）：
// 华为对一次请求里的 token 列表是整批 all-or-nothing；只要台账里有一个历史失效
// token，整批就回 80300007。必须逐 token 发送，坏 token 不能拖死有效真机。
func TestDoSendIsolatesInvalidToken(t *testing.T) {
	setupPluginDir(t, readyConfig(nil))
	fake := &fakeHTTP{respond: func(body string) string {
		if strings.Contains(body, "bad-token") {
			return `{"code":"80300007","msg":"All the tokens are invalid"}`
		}
		return `{"code":"80000000","msg":"Success"}`
	}}
	pusher = newPushClient(fake)
	ledger.UpsertDevice(Device{Token: "good-token-1234", Name: "真机"})
	ledger.UpsertDevice(Device{Token: "bad-token-1234", Name: "旧模拟器"})

	out := doSend(PushRequest{Title: "隔离测试", Body: "有效真机必须收到"}, "tool")
	if out.Sent != 1 || out.Failed != 1 {
		t.Fatalf("应逐 token 发送：1 成功 + 1 失败，实际 %+v", out)
	}
	if len(fake.calls) < 2 {
		t.Fatalf("两个 token 应各发一次（不能整批），实际请求 %d", len(fake.calls))
	}
	ds := ledger.Devices()
	for _, d := range ds {
		if d.Token == "good-token-1234" && d.SendOK != 1 {
			t.Fatalf("有效 token 应记成功：%+v", d)
		}
		if d.Token == "bad-token-1234" && d.SendFail == 0 {
			t.Fatalf("失效 token 应只记失败：%+v", d)
		}
	}
}

func TestDoSendSkipsQuietHoursAndDedupe(t *testing.T) {
	// 用"当前时刻必然落在其中"的静音时段：全天真不可能（from==to 被拒）⇒ 用当前小时起算
	now := time.Now()
	from := fmt.Sprintf("%02d:00", now.Hour())
	to := fmt.Sprintf("%02d:59", now.Hour())
	setupPluginDir(t, readyConfig(map[string]any{"quietHours": from + "-" + to, "collapseWindowSec": 300}))
	pusher = newPushClient(&fakeHTTP{body: `{"code":"80000000"}`})
	ledger.UpsertDevice(Device{Token: "tok-quiet-1234"})

	out := doSend(PushRequest{Title: "t", Body: "b"}, "tool")
	if out.Skipped == "" || !strings.Contains(out.Skipped, "静音时段") {
		t.Fatalf("静音时段应跳过，实际 %+v", out)
	}
	// error 级别豁免静音
	out = doSend(PushRequest{Title: "t2", Body: "b2", Level: "error"}, "tool")
	if out.Skipped != "" || !out.Success {
		t.Fatalf("error 应豁免静音，实际 %+v", out)
	}
	// 合并窗口：同标题+正文再来一次 ⇒ 跳过
	out = doSend(PushRequest{Title: "t2", Body: "b2", Level: "error"}, "tool")
	if out.Skipped == "" || !strings.Contains(out.Skipped, "合并窗口") {
		t.Fatalf("合并窗口应命中，实际 %+v", out)
	}
}

func TestDoSendRateLimit(t *testing.T) {
	setupPluginDir(t, readyConfig(map[string]any{"maxPerMinute": 1, "collapseWindowSec": 0}))
	pusher = newPushClient(&fakeHTTP{body: `{"code":"80000000"}`})
	ledger.UpsertDevice(Device{Token: "tok-rate-1234"})
	if out := doSend(PushRequest{Title: "a", Body: "1"}, "tool"); !out.Success {
		t.Fatalf("第一条应放行：%+v", out)
	}
	out := doSend(PushRequest{Title: "b", Body: "2"}, "tool")
	if out.Reason == "" || !strings.Contains(out.Reason, "限流") {
		t.Fatalf("第二条应被限流，实际 %+v", out)
	}
}

func TestWebRPCRegisterAndStatus(t *testing.T) {
	setupPluginDir(t, readyConfig(nil))
	pusher = newPushClient(&fakeHTTP{body: `{"code":"80000000"}`})

	// register_token
	res, err := webRPC(&protocol.WebPluginRPCParams{
		Method: "register_token",
		Params: json.RawMessage(`{"token":"AAAABBBBCCCCDDDD","name":"我的手机","platform":"HarmonyOS","version":"7.0.0"}`),
	})
	if err != nil || res.Error != "" {
		t.Fatalf("register_token 失败：%v %s", err, res.Error)
	}
	if strings.Contains(res.Result, "AAAABBBBCCCCDDDD") {
		t.Fatal("⛔ 真 token 绝不能出现在回执里")
	}
	if !strings.Contains(res.Result, "added") {
		t.Fatalf("回执缺字段：%s", res.Result)
	}
	// status
	res, _ = webRPC(&protocol.WebPluginRPCParams{Method: "status"})
	if !strings.Contains(res.Result, `"ready":true`) || !strings.Contains(res.Result, `"deviceCount":1`) {
		t.Fatalf("status 不对：%s", res.Result)
	}
	// settings_get：secret 必须掩码
	res, _ = webRPC(&protocol.WebPluginRPCParams{Method: "settings_get"})
	if strings.Contains(res.Result, `"clientSecret":"sec"`) {
		t.Fatal("⛔ clientSecret 明文不得下发")
	}
	if !strings.Contains(res.Result, "se***") {
		t.Fatalf("secret 应掩码：%s", res.Result)
	}
	// list/rename/clear
	res, _ = webRPC(&protocol.WebPluginRPCParams{Method: "rename_device",
		Params: json.RawMessage(`{"token":"AAAABBBBCCCCDDDD","name":"改名后"}`)})
	if !strings.Contains(res.Result, "改名后") {
		t.Fatalf("改名失败：%s", res.Result)
	}
	res, _ = webRPC(&protocol.WebPluginRPCParams{Method: "clear_devices"})
	if !strings.Contains(res.Result, `"cleared":1`) {
		t.Fatalf("清空失败：%s", res.Result)
	}
	// 未知方法：**业务失败**（success:false + reason），⛔ 不是协议 Error（那会被 host 升级成 500）
	res, _ = webRPC(&protocol.WebPluginRPCParams{Method: "nope"})
	if res.Error != "" {
		t.Fatalf("⛔ 不得置协议 Error（host 会当 500）：%q", res.Error)
	}
	if !strings.Contains(res.Result, `"success":false`) || !strings.Contains(res.Result, "未知方法") {
		t.Fatalf("未知方法应回业务失败+可读原因，实际 %s", res.Result)
	}
}

func TestExecuteToolAndEnrichAndActivate(t *testing.T) {
	setupPluginDir(t, readyConfig(nil))
	pusher = newPushClient(&fakeHTTP{body: `{"code":"80000000"}`})
	ledger.UpsertDevice(Device{Token: "tok-tool-1234"})

	res, err := executeTool(&protocol.ExecuteToolParams{
		ToolName: toolPushNoti, Input: `{"title":"工具调用","body":"来自 LLM"}`,
	})
	if err != nil || res.Error != "" {
		t.Fatalf("execute_tool 失败：%v %s", err, res.Error)
	}
	if !strings.Contains(res.Result, `"success":true`) {
		t.Fatalf("工具回执应含 ok：%s", res.Result)
	}
	// 非法 JSON
	res, _ = executeTool(&protocol.ExecuteToolParams{ToolName: toolPushNoti, Input: `{`})
	if res.Error == "" {
		t.Fatal("非法 JSON 应报错")
	}
	// 未知工具
	res, _ = executeTool(&protocol.ExecuteToolParams{ToolName: "other"})
	if res.Error == "" {
		t.Fatal("未知工具应报错")
	}
	// activate：工具名 + enricher
	act, err := activate(&protocol.ActivateParams{PluginID: pluginID})
	if err != nil || len(act.Tools) != 2 ||
		act.Tools[0].Name != toolPushNoti || act.Tools[1].Name != toolLiveView {
		t.Fatalf("activate 未声明工具：%+v %v", act, err)
	}
	if len(act.Enrichers) != 1 || act.Enrichers[0].Name != enricherHint {
		t.Fatal("activate 未声明 enricher")
	}
	if len(act.Tools[0].Parameters) < 3 {
		t.Fatal("工具参数过少（要求 title/body 等）")
	}
	// enricher：开启时给提示；关闭时为空
	e, _ := enrich(&protocol.EnrichParams{EnricherName: enricherHint})
	if !strings.Contains(e.Result, toolPushNoti) {
		t.Fatalf("开启时应提示工具名：%s", e.Result)
	}
	setupPluginDir(t, readyConfig(map[string]any{"agentHint": false}))
	e, _ = enrich(&protocol.EnrichParams{EnricherName: enricherHint})
	if e.Result != "" {
		t.Fatal("关闭 agentHint 后不应注入提示")
	}
	// 未知 enricher ⇒ 空
	e, _ = enrich(&protocol.EnrichParams{EnricherName: "other"})
	if e.Result != "" {
		t.Fatal("未知 enricher 应返回空")
	}
}

// TestRPCKeysAvoidReserved 钉住 host 契约：插件 RPC 返回体**顶层**不得出现
// ok / error / data —— 它们是 host 信封的保留键，会被 host 从返回体里剥掉再重新包信封
// （实测 register_token 的 `ok` 键丢失）⇒ 用 ok:false 表达业务失败会被静默改成成功。
func TestRPCKeysAvoidReserved(t *testing.T) {
	setupPluginDir(t, readyConfig(nil))
	pusher = newPushClient(&fakeHTTP{})
	ledger.UpsertDevice(Device{Token: "tok-reserved-1234", Name: "机"})
	cases := []struct {
		method string
		params string
	}{
		{"status", `{}`},
		{"settings_get", `{}`},
		{"list_devices", `{}`},
		{"register_token", `{"token":"AAAABBBBCCCC","name":"n"}`},
		{"rename_device", `{"token":"AAAABBBBCCCC","name":"n2"}`},
		{"unregister_token", `{"token":"AAAABBBBCCCC"}`},
		{"send", `{"title":"t","body":"b","dryRun":true}`},
		{"send_test", `{}`},
		{"log_recent", `{"limit":3}`},
		{"clear_devices", `{}`},
		{"nope", `{}`},
		{"settings_set", `{"key":"defaultTtlDays","value":5}`},
	}
	reserved := []string{"ok", "error", "data"}
	for _, c := range cases {
		res, err := webRPC(&protocol.WebPluginRPCParams{Method: c.method, Params: json.RawMessage(c.params)})
		if err != nil || res == nil {
			t.Fatalf("%s: err=%v", c.method, err)
		}
		if res.Error != "" {
			t.Fatalf("%s: ⛔ 不得置协议 Error（host 会升级成 HTTP 500）：%s", c.method, res.Error)
		}
		var m map[string]any
		if e := json.Unmarshal([]byte(res.Result), &m); e != nil {
			t.Fatalf("%s: 返回体不是 JSON 对象：%s", c.method, res.Result)
		}
		for _, k := range reserved {
			if _, bad := m[k]; bad {
				t.Fatalf("%s: ⛔ 返回体顶层出现信封保留键 %q（会被 host 剥掉）：%s", c.method, k, res.Result)
			}
		}
		// 业务失败必须能被识别：成功带 success:true，失败带 success:false + reason
		if _, has := m["success"]; !has {
			t.Fatalf("%s: 返回体必须带 success 字段：%s", c.method, res.Result)
		}
	}
}

func TestTruncateRunes(t *testing.T) {
	if got := truncateRunes("abc", 5); got != "abc" {
		t.Fatal("未超限不应改")
	}
	got := truncateRunes(strings.Repeat("字", 10), 4)
	if len([]rune(got)) != 4 || !strings.HasSuffix(got, "…") {
		t.Fatalf("截断形态不对：%q", got)
	}
}

func TestResolveRootUsesEnvOverride(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "plugin.json"), []byte("{}"), 0o600)
	t.Setenv("XBOT_PLUGIN_DIR", dir)
	if got := resolveRoot(); got != dir {
		t.Fatalf("应优先用 XBOT_PLUGIN_DIR，实际 %s", got)
	}
}

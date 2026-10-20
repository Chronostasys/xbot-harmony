package main

// push.go —— 华为 Push Kit **服务端 REST** 客户端（OAuth2 取令牌 + messages:send 下发通知）。
//
// 契约（已核实，非猜测）：
//
//	① 取令牌：POST https://oauth-login.cloud.huawei.com/oauth2/v3/token
//	     Content-Type: application/x-www-form-urlencoded
//	     grant_type=client_credentials&client_id=<AGC App ID>&client_secret=<AGC Client Secret>
//	   响应 {access_token, expires_in}；有效期约 1 小时 ⇒ 本地缓存 + 提前 5 分钟刷新。
//	   口径依据：华为官方论坛示例「client_id | your app id from AGC」。
//
//	② 发消息：POST https://push-api.cloud.huawei.com/v{3|1}/{ProjectId|AppId}/messages:send
//	     Authorization: Bearer <access_token>
//	     Content-Type: application/json; charset=UTF-8
//	     push-type: 0                       ← 0 = 通知消息（华为要求显式声明）
//	   Body：{"payload":{"notification":{...},"ttl":..,"pushOptions":{"testMessage":bool}},
//	          "target":{"token":["<PushToken>", ...]}}
//	   版本差异：HarmonyOS NEXT / 5.x+ 用 **v3 + ProjectId**；3.x/4.x 用 **v1 + AppId**（同 body）。
//
// ⛔ 分层纪律：URL 构造 / payload 构造 是**纯函数**（可脱机单测）；网络与令牌缓存单独一层，
//    `httpDoer` 接口便于注入假实现做测试（不真联网）。

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	oauthTokenURL = "https://oauth-login.cloud.huawei.com/oauth2/v3/token"
	pushBaseURL   = "https://push-api.cloud.huawei.com"
	// 令牌提前刷新余量
	tokenRefreshSlack = 5 * time.Minute
)

// PushRequest 一条待下发的通知（工具参数 / RPC 参数收敛后的形态）。
type PushRequest struct {
	Title    string `json:"title"`
	Body     string `json:"body"`
	Level    string `json:"level,omitempty"`    // info | warn | error
	Category string `json:"category,omitempty"` // 空 = 用设置默认
	TTL      int    `json:"ttl,omitempty"`      // 秒（0 = 用设置默认天数）
	Silent   bool   `json:"silent,omitempty"`   // true = 不打扰（不亮屏/不响铃，仅通知栏）
	Test     bool   `json:"test,omitempty"`     // 华为"测试消息"标记
	Data     string `json:"data,omitempty"`     // 附加 data（JSON 字符串，客户端可解析）
	NotifyID int    `json:"notifyId,omitempty"` // 相同 notifyId 会覆盖旧通知
	DryRun   bool   `json:"dryRun,omitempty"`   // 只回执，不真发
}

// pushEndpoint 构造发送 URL（纯函数）。
func pushEndpoint(cfg Settings) (string, error) {
	id := cfg.routeID()
	if id == "" {
		if cfg.APIVersion == "v3" {
			return "", fmt.Errorf("V3 接口需要 Project ID")
		}
		return "", fmt.Errorf("V1 接口需要 App ID")
	}
	ver := "v3"
	if cfg.APIVersion == "v1" {
		ver = "v1"
	}
	return fmt.Sprintf("%s/%s/%s/messages:send", pushBaseURL, ver, url.PathEscape(id)), nil
}

// buildPushPayload 构造请求体（纯函数；单测直接断言逐字段）。
func buildPushPayload(cfg Settings, req PushRequest, tokens []string) map[string]any {
	title := req.Title
	body := req.Body
	category := req.Category
	if category == "" {
		category = cfg.DefaultCategory
	}
	if category == "" {
		// ⛔ 绝不发空 category：华为会整条拒（80100003），且这是"配置没填"的表现，
		//   用兜底值让链路可用，同时把原因留在日志里（用户可在设置里改对）。
		category = lvFallbackCategory
	}
	notification := map[string]any{
		"title": title,
		"body":  body,
		// 点击进应用首页（actionType 0）
		"clickAction": map[string]any{"actionType": 0},
		// 应用在前台时是否也展示（默认展示，避免"我明明在应用里却没看到"）
		"foregroundShow": true,
	}
	notification["category"] = category
	if req.NotifyID != 0 {
		notification["notifyId"] = req.NotifyID
	}
	// 提醒强度：华为侧若不支持该字段会被忽略（不影响投递），同时它决定本地静音时段豁免。
	switch strings.ToLower(req.Level) {
	case "error":
		notification["importance"] = "HIGH"
	case "warn":
		notification["importance"] = "NORMAL"
	case "info":
		notification["importance"] = "LOW"
	}
	if req.Silent {
		notification["foregroundShow"] = false
	}

	payload := map[string]any{"notification": notification}

	// ttl：优先工具显式秒数；否则用设置里的天数
	ttl := req.TTL
	if ttl <= 0 && cfg.DefaultTTLDays > 0 {
		ttl = cfg.DefaultTTLDays * 24 * 3600
	}
	if ttl > 0 {
		payload["ttl"] = strconv.Itoa(ttl) + "s"
	}
	if req.Data != "" {
		payload["data"] = req.Data
	}
	opts := map[string]any{}
	if req.Test {
		opts["testMessage"] = true
	}
	if req.Silent {
		opts["biTag"] = "silent" // 华为侧未知字段会被忽略；标记用途
	}
	if len(opts) > 0 {
		payload["pushOptions"] = opts
	}

	// ── 请求体随接口版本而变（⛔ 实测差异，不是猜）──────────────────────────────
	//  V1（HMSCore 代 / HarmonyOS 3.x·4.x）：`{"message":{"notification":…,"token":[…]}}`
	//     —— 实测把 token 放在 `target.token` 会回 `80300010 token count should within 1 and 1,000`
	//        （= 它没在预期位置找到 token），而鉴权与其余字段都通过。
	//  V3（HarmonyOS NEXT / 5.x+）：`{"payload":{"notification":…},"target":{"token":[…]}}`
	if cfg.APIVersion == "v1" {
		msg := map[string]any{"notification": notification, "token": tokens}
		if v, ok := payload["ttl"]; ok {
			msg["ttl"] = v
		}
		if v, ok := payload["data"]; ok {
			msg["data"] = v
		}
		// 华为要求通知消息显式带 push-type（请求头已设），此处不再重复。
		return map[string]any{"message": msg}
	}
	target := map[string]any{"token": tokens}
	return map[string]any{"payload": payload, "target": target}
}

// httpDoer 抽象（便于单测注入；生产用带超时的 *http.Client）。
type httpDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// pushClient 令牌缓存 + 发送。
type pushClient struct {
	http httpDoer

	mu       sync.Mutex
	token    string
	tokenExp time.Time
}

func newPushClient(h httpDoer) *pushClient {
	if h == nil {
		h = &http.Client{Timeout: 15 * time.Second}
	}
	return &pushClient{http: h}
}

// hasToken 是否已有缓存的 access_token（status 展示用；⛔ 不暴露令牌本身）。
func (c *pushClient) hasToken() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.token != "" && time.Now().Before(c.tokenExp)
}

// accessToken 取（并缓存）OAuth2 access_token。
func (c *pushClient) accessToken(ctx context.Context, cfg Settings) (string, error) {
	c.mu.Lock()
	if c.token != "" && time.Now().Before(c.tokenExp.Add(-tokenRefreshSlack)) {
		t := c.token
		c.mu.Unlock()
		return t, nil
	}
	c.mu.Unlock()

	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", cfg.tokenClientID())
	form.Set("client_secret", cfg.ClientSecret)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, oauthTokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("取访问令牌失败（网络）：%w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Error       any    `json:"error"`
		ErrDesc     string `json:"error_description"`
	}
	_ = json.Unmarshal(raw, &out)
	if out.AccessToken == "" {
		return "", fmt.Errorf("取访问令牌失败（HTTP %d）：%s", resp.StatusCode, tokenErrHint(out.Error, out.ErrDesc, raw))
	}
	exp := time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)
	if out.ExpiresIn <= 0 {
		exp = time.Now().Add(time.Hour)
	}
	c.mu.Lock()
	c.token = out.AccessToken
	c.tokenExp = exp
	c.mu.Unlock()
	return out.AccessToken, nil
}

func tokenErrHint(e any, desc string, raw []byte) string {
	// 常见：100003 invalid client_id / 1101 invalid client_secret
	if desc != "" {
		return desc
	}
	if e != nil {
		return fmt.Sprintf("%v", e)
	}
	s := strings.TrimSpace(string(raw))
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// pushResponse 华为返回体。
type pushResponse struct {
	Code      string `json:"code"`
	Msg       string `json:"msg"`
	RequestID string `json:"requestId"`
}

// sendResult 一次发送的可读结果（进日志/回执）。
type sendResult struct {
	OK         bool
	HTTPStatus int
	Code       string
	Msg        string
	Hint       string
}

// send 下发一条通知到 tokens。
func (c *pushClient) send(ctx context.Context, cfg Settings, tokens []string, req PushRequest) (sendResult, error) {
	endpoint, err := pushEndpoint(cfg)
	if err != nil {
		return sendResult{}, err
	}
	token, err := c.accessToken(ctx, cfg)
	if err != nil {
		return sendResult{}, err
	}
	body, err := json.Marshal(buildPushPayload(cfg, req, tokens))
	if err != nil {
		return sendResult{}, err
	}
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return sendResult{}, err
	}
	hreq.Header.Set("Content-Type", "application/json; charset=UTF-8")
	hreq.Header.Set("Authorization", "Bearer "+token)
	hreq.Header.Set("push-type", "0")
	resp, err := c.http.Do(hreq)
	if err != nil {
		return sendResult{}, fmt.Errorf("发送失败（网络）：%w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var pr pushResponse
	_ = json.Unmarshal(raw, &pr)
	res := sendResult{
		OK:         resp.StatusCode == http.StatusOK && (pr.Code == "" || pr.Code == "80000000"),
		HTTPStatus: resp.StatusCode,
		Code:       pr.Code,
		Msg:        pr.Msg,
	}
	if !res.OK {
		res.Hint = pushErrorHint(res)
	}
	return res, nil
}

// sendLiveView 下发一条实况窗更新/结束（operation=1/2；远程创建仅 0+FLIGHT/TAXI/TRAIN）。
func (c *pushClient) sendLiveView(ctx context.Context, cfg Settings, tokens []string, req LiveViewRequest) (sendResult, error) {
	endpoint, err := pushEndpoint(cfg)
	if err != nil {
		return sendResult{}, err
	}
	token, err := c.accessToken(ctx, cfg)
	if err != nil {
		return sendResult{}, err
	}
	body, err := json.Marshal(buildLiveViewPushBody(cfg, req, tokens))
	if err != nil {
		return sendResult{}, err
	}
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return sendResult{}, err
	}
	hreq.Header.Set("Content-Type", "application/json; charset=UTF-8")
	hreq.Header.Set("Authorization", "Bearer "+token)
	// ⛔ 实况窗是**场景化消息**，push-type 必须为 7（不是普通通知的 0）。
	//    用 0 发 liveView 会被华为按错误场景拒绝（80300002/80100003）。
	hreq.Header.Set("push-type", "7")
	resp, err := c.http.Do(hreq)
	if err != nil {
		return sendResult{}, fmt.Errorf("发送实况窗失败（网络）：%w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var pr pushResponse
	_ = json.Unmarshal(raw, &pr)
	res := sendResult{
		OK:         resp.StatusCode == http.StatusOK && (pr.Code == "" || pr.Code == "80000000"),
		HTTPStatus: resp.StatusCode,
		Code:       pr.Code,
		Msg:        pr.Msg,
	}
	if !res.OK {
		res.Hint = pushErrorHint(res)
		// ⛔ LiveView 没有 category/自分类权益；80300002 在实况窗链路上是
		//    「实况窗场景正式权益未开通」。官方明确：不能靠调测白名单绕过。
		if res.Code == "80300002" {
			res.Hint = "实况窗权益未正式开通（80300002）：调试中/调测设备不等于正式权益；需在 AGC 申请 Live View 正式权益"
		}
	}
	return res, nil
}
func pushErrorHint(r sendResult) string {
	switch r.Code {
	case "80000000":
		return "成功"
	case "80100000":
		return "部分 Push Token 无效（该设备需重新登录应用以刷新 Token）"
	case "80200001", "80200003":
		return "访问令牌无效/已失效（检查 Client Secret，或系统时间）"
	case "80300002":
		// ⛔ 这个码**不是 Token 无效**，也不是 OAuth 凭据错误：Token 已被华为识别。
		//    用户 2026-10-20 的 AGC 推送页实证：项目正常、精准推送已开，但
		//    「自分类权益」仍为未申请 ⇒ 没有对应 category 的下发权益。
		//    不要再让用户重复开通推送服务/换 OAuth。
		return "当前应用无权限下发推送消息（80300002）：Token 有效；请检查 AGC 的「精准推送能力」和「自分类权益」是否已对该 category 生效"
	case "80300007":
		return "全部 Push Token 无效（App 重新安装/清数据后 Token 会变，请在应用里重新登记）"
	case "80300008":
		return "消息体过大"
	case "81000001":
		return "华为侧系统内部错误，稍后重试"
	}
	if r.HTTPStatus == http.StatusUnauthorized {
		return "鉴权失败（HTTP 401）：检查 App ID / Client ID / Client Secret"
	}
	if r.HTTPStatus != 0 && r.HTTPStatus != http.StatusOK {
		return fmt.Sprintf("华为返回 HTTP %d", r.HTTPStatus)
	}
	if r.Msg != "" {
		return r.Msg
	}
	return "未知错误"
}

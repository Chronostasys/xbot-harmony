package main

// settings.go —— 插件设置：**直接读写 host 的同一份 `config.json`**。
//
// 路径 = `<插件安装目录>/config.json`。这**不是**我们自造的路径：host 侧
// `plugin/config.go:configPath()` = `<xbotHome>/plugins/<pluginId>/config.json`，
// 也就是说：
//   · App 的「设置 → 插件 → 鸿蒙推送」界面（渲染 plugin.json 的 `contributes.configuration`）
//     写的就是这份文件；
//   · 插件本体读的也是这份文件。
// ⇒ 两边**永远同一份设置**，插件不需要为"设置界面"做任何事（这正是"非侵入 + 方便"的关键）。
//
// 读取策略：按 mtime 缓存（用户在界面上改完，插件下一次调用即生效，无需重启插件进程）。

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Settings 是插件运行期使用的**强类型**设置快照。
type Settings struct {
	Enabled           bool
	AppID             string
	ProjectID         string
	ClientID          string
	ClientSecret      string
	APIVersion        string
	DefaultCategory   string
	DefaultLevel      string
	DefaultTTLDays    int
	CollapseWindowSec int
	MaxPerMinute      int
	QuietHours        string
	AgentHint         bool
}

// lvFallbackCategory 华为推送接口要求 `payload.notification.category` **非空**
// （实测缺省会被拒：`80100003 Illegal payload, payload.notification.category should not empty`）。
// 默认取 `IM`（服务与通讯类）；⛔ 该值应与你实际开通的场景/权益一致，可在设置里改。
const lvFallbackCategory = "IM"

func defaultSettings() Settings {
	return Settings{
		Enabled:           true,
		DefaultCategory:   lvFallbackCategory,
		// ⛔ 实测判据（2026-10-17，本应用 com.chronostasys.xbot + 应用级凭证）：
		//   v1 → 华为受理（只报 token 无效：那是设备侧问题）；v3 → 80200001 访问令牌无效。
		//   ⇒ 默认 v1；华为后续口径变化时可在设置里切回 v3。
		APIVersion:        "v1",
		DefaultLevel:      "info",
		DefaultTTLDays:    7,
		CollapseWindowSec: 30,
		MaxPerMinute:      12,
		AgentHint:         true,
	}
}

// ── 类型宽松收敛（config.json 由 App 写入：数字可能是 float64/int/string）──────────

func asString(v any, def string) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return def
}

func asBool(v any, def bool) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return def
}

func asInt(v any, def int) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case int64:
		return int(t)
	case string:
		if n, err := strconv.Atoi(strings.TrimSpace(t)); err == nil {
			return n
		}
	}
	return def
}

// parseSettings 把 raw（config.json 的 map）收敛成 Settings，缺字段一律用默认值。
func parseSettings(raw map[string]any) Settings {
	s := defaultSettings()
	if raw == nil {
		return s
	}
	if v, ok := raw["enabled"]; ok {
		s.Enabled = asBool(v, s.Enabled)
	}
	s.AppID = asString(raw["appId"], s.AppID)
	s.ProjectID = asString(raw["projectId"], s.ProjectID)
	s.ClientID = asString(raw["clientId"], s.ClientID)
	s.ClientSecret = asString(raw["clientSecret"], s.ClientSecret)
	if v, ok := raw["apiVersion"]; ok {
		s.APIVersion = strings.ToLower(asString(v, s.APIVersion))
	}
	s.DefaultCategory = asString(raw["defaultCategory"], s.DefaultCategory)
	if v, ok := raw["defaultLevel"]; ok {
		s.DefaultLevel = strings.ToLower(asString(v, s.DefaultLevel))
	}
	if v, ok := raw["defaultTtlDays"]; ok {
		s.DefaultTTLDays = asInt(v, s.DefaultTTLDays)
	}
	if v, ok := raw["collapseWindowSec"]; ok {
		s.CollapseWindowSec = asInt(v, s.CollapseWindowSec)
	}
	if v, ok := raw["maxPerMinute"]; ok {
		s.MaxPerMinute = asInt(v, s.MaxPerMinute)
	}
	s.QuietHours = asString(raw["quietHours"], s.QuietHours)
	if v, ok := raw["agentHint"]; ok {
		s.AgentHint = asBool(v, s.AgentHint)
	}
	return s.normalized()
}

// normalized 把越界值钳回合法区间（⛔ 不静默接受任何越界输入）。
func (s Settings) normalized() Settings {
	if s.APIVersion != "v1" && s.APIVersion != "v3" {
		s.APIVersion = "v3"
	}
	switch s.DefaultLevel {
	case "info", "warn", "error":
	default:
		s.DefaultLevel = "info"
	}
	if s.DefaultTTLDays < 1 {
		s.DefaultTTLDays = 1
	}
	if s.DefaultTTLDays > 30 {
		s.DefaultTTLDays = 30
	}
	if s.CollapseWindowSec < 0 {
		s.CollapseWindowSec = 0
	}
	if s.MaxPerMinute < 1 {
		s.MaxPerMinute = 1
	}
	if s.MaxPerMinute > 60 {
		s.MaxPerMinute = 60
	}
	return s
}

// validate 给出「能否真正发送」的可读结论（RPC `status` / `send` 复用同一判据）。
func (s Settings) validate() error {
	if !s.Enabled {
		return fmt.Errorf("推送已关闭（设置里打开「启用推送」）")
	}
	if s.ClientSecret == "" {
		return fmt.Errorf("缺少 Client Secret（AGC → 项目设置 → 常规）")
	}
	if s.tokenClientID() == "" {
		return fmt.Errorf("缺少 App ID / Client ID（AGC → 项目设置 → 常规）")
	}
	if s.routeID() == "" {
		if s.APIVersion == "v3" {
			return fmt.Errorf("V3 接口需要 Project ID（AGC → 项目设置 → 常规）")
		}
		return fmt.Errorf("V1 接口需要 App ID（AGC → 项目设置 → 常规）")
	}
	if _, _, ok := parseQuietHours(s.QuietHours); !ok {
		return fmt.Errorf("静音时段格式无效：%q（应为 HH:MM-HH:MM，如 23:00-07:00）", s.QuietHours)
	}
	return nil
}

// tokenClientID 取 OAuth2 取令牌用的 client_id。
// ⛔ 华为口径：这里填 **AGC 的 App ID**（官方论坛示例 `client_id | your app id from AGC`）；
// 若显式填了 Client ID 则优先用它（两者在多数项目里同值）。
func (s Settings) tokenClientID() string {
	if s.ClientID != "" {
		return s.ClientID
	}
	return s.AppID
}

// routeID 取推送接口 URL 的路径参数：V3 = Project ID，V1 = App ID。
func (s Settings) routeID() string {
	if s.APIVersion == "v3" {
		return s.ProjectID
	}
	return s.AppID
}

// ── 静音时段 ──────────────────────────────────────────────────────────────────

// parseQuietHours 解析 `HH:MM-HH:MM`（支持跨天），返回起止分钟数（0–1439）。
// 空串 ⇒ (0,0,true) 表示"未设置"。
func parseQuietHours(spec string) (int, int, bool) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return 0, 0, true
	}
	parts := strings.Split(spec, "-")
	if len(parts) != 2 {
		return 0, 0, false
	}
	from, ok1 := parseHHMM(parts[0])
	to, ok2 := parseHHMM(parts[1])
	if !ok1 || !ok2 || from == to {
		return 0, 0, false
	}
	return from, to, true
}

func parseHHMM(s string) (int, bool) {
	s = strings.TrimSpace(s)
	hm := strings.Split(s, ":")
	if len(hm) != 2 {
		return 0, false
	}
	h, err1 := strconv.Atoi(strings.TrimSpace(hm[0]))
	m, err2 := strconv.Atoi(strings.TrimSpace(hm[1]))
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// inQuietHours 判断 t 是否落在静音时段内（空串 ⇒ 永不在）。
func inQuietHours(spec string, t time.Time) bool {
	from, to, ok := parseQuietHours(spec)
	if !ok || (from == 0 && to == 0) {
		return false
	}
	cur := t.Hour()*60 + t.Minute()
	if from < to {
		return cur >= from && cur < to
	}
	// 跨天（如 23:00-07:00）
	return cur >= from || cur < to
}

// mergeConfig 把 patch 合并进 `<插件目录>/config.json`（原子写）。
//
// 用途：RPC `settings_set`（App 或工具改设置）。⛔ 与 host 的 PluginConfigStore 写的是**同一份文件**；
// 我们直接写盘并靠 mtime 让双方下次读取时看到新值（host 侧缓存由其自身失效逻辑处理，
// 界面上的设置改动走 host RPC ⇒ 不会与这里打架）。
func mergeConfig(rootDir string, patch map[string]any) error {
	path := filepath.Join(rootDir, "config.json")
	cur := map[string]any{}
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &cur)
	}
	if cur == nil {
		cur = map[string]any{}
	}
	for k, v := range patch {
		cur[k] = v
	}
	data, err := json.MarshalIndent(cur, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ── 读写 config.json（mtime 缓存）──────────────────────────────────────────────

type settingsStore struct {
	mu       sync.Mutex
	path     string
	mtime    time.Time
	cached   Settings
	loadedAt bool
}

func newSettingsStore(path string) *settingsStore {
	return &settingsStore{path: path}
}

// Load 读设置；文件不存在/损坏时回落到默认值（⛔ 不因设置文件坏掉而让插件不可用）。
func (ss *settingsStore) Load() Settings {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	st, err := os.Stat(ss.path)
	if err == nil && ss.loadedAt && st.ModTime().Equal(ss.mtime) {
		return ss.cached
	}
	raw := map[string]any{}
	if data, rerr := os.ReadFile(ss.path); rerr == nil {
		_ = json.Unmarshal(data, &raw)
	}
	ss.cached = parseSettings(raw)
	ss.loadedAt = true
	if err == nil {
		ss.mtime = st.ModTime()
	} else {
		ss.mtime = time.Time{}
	}
	return ss.cached
}

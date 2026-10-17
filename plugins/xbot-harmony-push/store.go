package main

// store.go —— 插件私有持久化：设备 Push Token 台账 + 投递日志 + 限流/合并窗口状态。
//
// 落盘：`<插件安装目录>/data.json`（协议规定插件进程的 cwd = 安装目录）。
// ⛔ 纪律：
//   · 真 token 必须存（发送要用），但**绝不进日志/错误串**；界面展示一律走 `maskToken`；
//   · 所有写盘走「临时文件 + rename」⇒ 断电/被杀不会留下半个 JSON；
//   · 日志环形上限，避免无限增长（插件目录不该无限膨胀）。

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Device 一台已登记的华为设备。
type Device struct {
	Token     string `json:"token"`
	ProfileID string `json:"profileId,omitempty"`
	Name      string `json:"name,omitempty"`
	Platform  string `json:"platform,omitempty"`
	Version   string `json:"version,omitempty"`
	FirstSeen int64  `json:"firstSeen"`
	LastSeen  int64  `json:"lastSeen"`
	SendOK    int64  `json:"sendOk"`
	SendFail  int64  `json:"sendFail"`
	LastError string `json:"lastError,omitempty"`
}

// LogEntry 一条投递记录（成功/失败都记，便于"为什么没收到"自查）。
type LogEntry struct {
	At      int64  `json:"at"`
	Kind    string `json:"kind,omitempty"` // tool | rpc | test
	Title   string `json:"title,omitempty"`
	OK      int    `json:"ok"`
	Fail    int    `json:"fail"`
	Code    string `json:"code,omitempty"`
	Err     string `json:"err,omitempty"`
	Devices string `json:"devices,omitempty"`
}

type storeData struct {
	Devices []Device   `json:"devices"`
	Log     []LogEntry `json:"log"`
}

const maxLogEntries = 200

// Store 台账 + 日志 + 运行期窗口状态。
type Store struct {
	mu   sync.Mutex
	path string
	data storeData
	// 运行期（不落盘）：合并窗口 key → 上次发送时刻
	sent map[string]int64
	// 运行期（不落盘）：限流窗口
	rate []int64
}

func openStore(path string) *Store {
	s := &Store{path: path, sent: map[string]int64{}}
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &s.data)
	}
	if s.data.Devices == nil {
		s.data.Devices = []Device{}
	}
	if s.data.Log == nil {
		s.data.Log = []LogEntry{}
	}
	return s
}

// saveLocked 原子落盘（调用方持锁）。
func (s *Store) saveLocked() error {
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	if dir := filepath.Dir(s.path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// UpsertDevice 登记/刷新设备（同一 token 幂等 ⇒ 前端可以每次启动都上报）。
func (s *Store) UpsertDevice(d Device) (added bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().Unix()
	for i := range s.data.Devices {
		if s.data.Devices[i].Token == d.Token {
			s.data.Devices[i].LastSeen = now
			if d.ProfileID != "" {
				s.data.Devices[i].ProfileID = d.ProfileID
			}
			if d.Name != "" {
				s.data.Devices[i].Name = d.Name
			}
			if d.Platform != "" {
				s.data.Devices[i].Platform = d.Platform
			}
			if d.Version != "" {
				s.data.Devices[i].Version = d.Version
			}
			_ = s.saveLocked()
			return false
		}
	}
	if d.FirstSeen == 0 {
		d.FirstSeen = now
	}
	d.LastSeen = now
	s.data.Devices = append(s.data.Devices, d)
	_ = s.saveLocked()
	return true
}

// RemoveDevice 注销设备（App 退出登录/换机时调用）。
func (s *Store) RemoveDevice(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Devices {
		if s.data.Devices[i].Token == token {
			s.data.Devices = append(s.data.Devices[:i], s.data.Devices[i+1:]...)
			_ = s.saveLocked()
			return true
		}
	}
	return false
}

// Rename 给设备起个可读名字（"我的手机"/"平板"）。
func (s *Store) Rename(token, name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Devices {
		if s.data.Devices[i].Token == token {
			s.data.Devices[i].Name = name
			_ = s.saveLocked()
			return true
		}
	}
	return false
}

// Devices 返回副本（调用方不得改内部状态）。
func (s *Store) Devices() []Device {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Device, len(s.data.Devices))
	copy(out, s.data.Devices)
	return out
}

// DeviceCount 设备数。
func (s *Store) DeviceCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.data.Devices)
}

// MarkResult 记录某设备的投递结果（成功/失败计数 + 最近错误）。
func (s *Store) MarkResult(token string, ok bool, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Devices {
		if s.data.Devices[i].Token == token {
			if ok {
				s.data.Devices[i].SendOK++
				s.data.Devices[i].LastError = ""
			} else {
				s.data.Devices[i].SendFail++
				s.data.Devices[i].LastError = errMsg
			}
			_ = s.saveLocked()
			return
		}
	}
}

// AppendLog 追加一条投递日志（环形裁剪）。
func (s *Store) AppendLog(e LogEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e.At == 0 {
		e.At = time.Now().Unix()
	}
	s.data.Log = append(s.data.Log, e)
	if len(s.data.Log) > maxLogEntries {
		s.data.Log = s.data.Log[len(s.data.Log)-maxLogEntries:]
	}
	_ = s.saveLocked()
}

// RecentLog 最近 n 条（新的在前）。
func (s *Store) RecentLog(n int) []LogEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	total := len(s.data.Log)
	if n <= 0 || n > total {
		n = total
	}
	out := make([]LogEntry, 0, n)
	for i := total - 1; i >= 0 && len(out) < n; i-- {
		out = append(out, s.data.Log[i])
	}
	return out
}

// ClearDevices 清空设备台账，返回被清掉的数量。
func (s *Store) ClearDevices() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := len(s.data.Devices)
	s.data.Devices = []Device{}
	_ = s.saveLocked()
	return n
}

// allowRate 限流：最近 60s 内是否已达上限（滑动窗口，不落盘）。
func (s *Store) allowRate(maxPerMin int, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if maxPerMin < 1 {
		maxPerMin = 1
	}
	cut := now.Add(-time.Minute).Unix()
	kept := s.rate[:0]
	for _, ts := range s.rate {
		if ts > cut {
			kept = append(kept, ts)
		}
	}
	s.rate = kept
	if len(s.rate) >= maxPerMin {
		return false
	}
	s.rate = append(s.rate, now.Unix())
	return true
}

// dedupeHit 合并窗口：同一 key 在 windowSec 内已发过 ⇒ 命中（应跳过）。
func (s *Store) dedupeHit(key string, windowSec int, now time.Time) bool {
	if windowSec <= 0 || key == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	prev, ok := s.sent[key]
	if ok && now.Unix()-prev < int64(windowSec) {
		return true
	}
	s.sent[key] = now.Unix()
	return false
}

// maskToken 展示用掩码（前 6 后 4；短 token 只露前 2）。
// ⛔ 判据唯一：所有对外输出（RPC 返回/日志/错误串）都走它，杜绝真 token 外泄。
func maskToken(t string) string {
	r := []rune(t)
	if len(r) <= 8 {
		if len(r) <= 2 {
			return "***"
		}
		return string(r[:2]) + "***"
	}
	return string(r[:6]) + "…" + string(r[len(r)-4:])
}

// sortDevicesForDisplay 稳定展示顺序：名字 → 后登记在前。
func sortDevicesForDisplay(ds []Device) {
	sort.SliceStable(ds, func(i, j int) bool {
		if ds[i].Name != ds[j].Name {
			return ds[i].Name < ds[j].Name
		}
		return ds[i].LastSeen > ds[j].LastSeen
	})
}

// 编译期兜底：确保 fmt 被使用（错误串拼接）。
var _ = fmt.Sprintf

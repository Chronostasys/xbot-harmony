package main

import "testing"

func TestBuildLiveViewPayload(t *testing.T) {
	lv := buildLiveViewPayload(LiveViewRequest{
		ActivityID: 20261017, Operation: 1, Event: "PROGRESS",
		Title: "xbot", Content: "第 3 轮迭代 · Shell", CapsuleTitle: "Shell", CapsuleContent: "执行中",
	})
	if lv["activityId"] != 20261017 || lv["operation"] != 1 || lv["event"] != "PROGRESS" {
		t.Fatalf("identity fields wrong: %+v", lv)
	}
	data, ok := lv["activityData"].(map[string]any)
	if !ok || data["notificationData"] == nil || data["capsuleData"] == nil {
		t.Fatalf("activityData missing: %+v", lv)
	}
	capsule := data["capsuleData"].(map[string]any)
	if capsule["icon"] == "" || capsule["bgColor"] == "" || capsule["title"] != "Shell" {
		t.Fatalf("capsule fields wrong: %+v", capsule)
	}
}

func TestBuildLiveViewPushBody(t *testing.T) {
	cfg := Settings{APIVersion: "v3", AppID: "app"}
	body := buildLiveViewPushBody(cfg, LiveViewRequest{ActivityID: 7, Operation: 2, Event: "PROGRESS"}, []string{"tok"})
	if body["payload"] == nil || body["target"] == nil {
		t.Fatalf("v3 body envelope wrong: %+v", body)
	}
	cfg.APIVersion = "v1"
	body = buildLiveViewPushBody(cfg, LiveViewRequest{ActivityID: 7, Operation: 2, Event: "PROGRESS"}, []string{"tok"})
	if body["message"] == nil {
		t.Fatalf("v1 body envelope wrong: %+v", body)
	}
}

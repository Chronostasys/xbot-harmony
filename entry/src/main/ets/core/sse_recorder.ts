/**
 * sse_recorder.ts —— **全量 SSE 帧录制的核心侧**（纯 TS，零 @ohos 依赖）。
 *
 * 用户 2026-10-21 要求：「日志旁边给个开关，dump 全 sse，一个不漏」。
 * ⛔ `core/**` 在脱机 harness 里按**纯 TS** 编译（AGENTS：core 禁 import @ohos/@kit）
 *   ⇒ 写盘实现由**宿主**注入（`EntryAbility` 用 `@ohos.file.fs` 注册 writer），
 *   本文件只负责"是否录制 + 攒一行 JSON"。未注册 writer 时退化为 no-op（只打 hilog 一次）。
 *
 * 一行一帧（解析前原文，含心跳/控制帧）：`{"t":<ms>,"u":"<url>","r":"<raw>"}`
 */
export type SseWriter = (line: string) => void;

let writer: SseWriter | null = null;
let warned: boolean = false;

/** 宿主注册写盘实现（EntryAbility 启动时调用一次）。 */
export function setSseWriter(w: SseWriter): void {
  writer = w;
}

function recordingOn(): boolean {
  // ⛔ 脱机 harness（把 core 当纯 TS 跑）里没有 ArkUI 的 `AppStorage` 全局 ⇒ 必须兜住，
  //   否则每一帧都抛 ReferenceError（sse/sse_watchdog 两条判据直接红）。
  try {
    const v = AppStorage.get<boolean>('sseRecord');
    return v === undefined ? true : v === true;
  } catch (e) {
    return false;
  }
}

/** 记录**一帧原始 SSE 帧**（解析前，一个不漏）。 */
export function recordSseFrame(url: string, raw: string): void {
  if (!recordingOn() || raw.length === 0) {
    return;
  }
  if (writer === null) {
    if (!warned) {
      warned = true;
      console.warn('[SSE-REC] writer 未注册（录制关闭）');
    }
    return;
  }
  writer(JSON.stringify({ t: Date.now(), u: url, r: raw }) + '\n');
}

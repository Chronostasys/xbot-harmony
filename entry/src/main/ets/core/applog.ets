/**
 * applog —— 应用内**日志环形缓冲**（用户 2026-10-16 要求「给一个看应用日志的窗口」）。
 *
 * 设计：纯 TS（`core/*.ets` 禁止 import ArkUI，`run.sh` 当纯 TS 编译）· 模块级单例 ·
 * 定长环（满则覆盖最旧 ⇒ **内存恒定，不随运行时长增长**）。页面 `LogSheet` 直接读
 * `logLinesNewestFirst()` 渲染。
 *
 * ⛔ 为什么不接管 `console.*`：ArkTS 无法可靠改写全局 console ⇒ 统一走 `log()` 显式埋点
 *   （与 `core/sserec.ets` 的 `sseRecorder` 同思路 —— 判据/渲染同源、可脱机测）。
 */

/** 一行日志（时间戳 + 标签 + 正文）。 */
export interface LogLine {
  at: number;
  tag: string;
  msg: string;
}

/** 环容量（条）。够回看一轮排障，又不会撑爆内存。 */
export const APPLOG_MAX: number = 400;

class AppLog {
  private buf: LogLine[] = [];

  /** 追加一行（满则丢弃最旧）。 */
  push(tag: string, msg: string): void {
    this.buf.push({ at: Date.now(), tag: tag, msg: msg });
    const over: number = this.buf.length - APPLOG_MAX;
    if (over > 0) {
      this.buf.splice(0, over);
    }
  }

  /** 快照（拷贝，防调用方改内部数组）。 */
  lines(): LogLine[] {
    return this.buf.slice();
  }

  clear(): void {
    this.buf = [];
  }

  size(): number {
    return this.buf.length;
  }
}

/** 模块级单例（页面/组件共用；脱机测试可 `clear()` 复位）。 */
export const appLog: AppLog = new AppLog();

/** 便捷追加。 */
export function log(tag: string, msg: string): void {
  appLog.push(tag, msg);
}

/** 渲染用：**新→旧**（最新在最上）。 */
export function logLinesNewestFirst(): LogLine[] {
  const all: LogLine[] = appLog.lines();
  const out: LogLine[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    out.push(all[i]);
  }
  return out;
}

/** 单行展示文案（`HH:mm:ss tag  msg`；不引 locale API，纯算术 ⇒ 可脱机测）。 */
export function logLineText(l: LogLine): string {
  const d: Date = new Date(l.at);
  const p2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  const hh: string = p2(d.getHours());
  const mm: string = p2(d.getMinutes());
  const ss: string = p2(d.getSeconds());
  return `${hh}:${mm}:${ss} [${l.tag}] ${l.msg}`;
}

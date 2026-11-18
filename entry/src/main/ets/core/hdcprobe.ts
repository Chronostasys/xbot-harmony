/**
 * hdcprobe —— **临时探针**：验证「App 能不能自己连本机 hdc daemon(127.0.0.1:8710)」。
 *
 * ── 为什么问这个（用户 2026-11-08）──────────────────────────────────────────────
 *   iOS 上可以「App 自己变成受信任主机」：导入 pairing record → loopback 连自己的
 *   lockdownd(62078) → DDI/DTX → testmanagerd ⇒ 在进程内合成触摸/截图。
 *   鸿蒙对应的口子是 hdc：`hdc` 客户端二进制里写死了 `::ffff:127.0.0.1:8710`，
 *   设备侧 daemon 用 **RSA-3072-SHA512 挑战签名**认证（strings 证据：
 *   `daemon auth type is rsa_3072_sha512` / `recv get publickey cmd` / `Unauthorized`）。
 *
 * ⛔ 本文件**只做判定逻辑**（纯函数，可脱机单测）；真正的 socket 在 `hdcprobe.ets`。
 *    判定要回答的唯一问题：**应用沙箱域能不能 TCP 连上 8710**（连不上 ⇒ 整条路线死）。
 */

/** 一次端口探测的结果。 */
export class HdcPortProbe {
  port: number = 0;
  /** TCP 三次握手是否成功（= 应用域对该端口可达）。 */
  reachable: boolean = false;
  /** 连上后收到的字节数（0 = 对端静默）。 */
  bytes: number = 0;
  /** 收到内容的前若干字节（hex，便于肉眼判断是不是 hdc banner）。 */
  hex: string = '';
  /** 不可达时的错误码/文案（审计用）。 */
  error: string = '';
}

/** 要探测的端口：hdc daemon / 模拟器 adb / 本机 adb server（后两个作为"沙箱是否全封"的对照）。 */
export const HDC_PROBE_PORTS: number[] = [8710, 5555, 5037];

/** 单端口判定（⛔ 与报告渲染同源：`formatProbeReport` 只调本函数）。 */
export function probeVerdictOf(p: HdcPortProbe): string {
  if (!p.reachable) {
    return 'CLOSED';
  }
  return p.bytes > 0 ? 'OPEN+DATA' : 'OPEN+SILENT';
}

/**
 * 整轮结论（决定后续技术路线）：
 *   · `PROBE_INVALID` —— **自检失败**（连自己的本地 listener 都不通）⇒ 探针无效，不能下任何结论；
 *   · `ROUTE_DEAD`   —— 8710 不可达 ⇒ 应用域被封，"自连 hdc"路线**直接放弃**；
 *   · `ROUTE_ALIVE`  —— 8710 可连且**有回包** ⇒ daemon 在听，只差授权（值得做握手/私钥实验）；
 *   · `ROUTE_SILENT` —— 8710 可连但静默 ⇒ 端口通、协议层未确认，需要发握手包再判。
 * ⛔ 只看 8710；其它端口仅作对照，不参与结论（避免"5555 通了就以为 hdc 通"）。
 * ⛔ 自检失败**优先于**一切（否则"探针坏了"会被误读成"路线死了"，方向就判反了）。
 */
export function probeSummary(list: HdcPortProbe[], selftestOk: boolean = true): string {
  if (!selftestOk) {
    return 'PROBE_INVALID';
  }
  for (let i = 0; i < list.length; i++) {
    if (list[i].port !== 8710) {
      continue;
    }
    const v: string = probeVerdictOf(list[i]);
    if (v === 'CLOSED') {
      return 'ROUTE_DEAD';
    }
    return v === 'OPEN+DATA' ? 'ROUTE_ALIVE' : 'ROUTE_SILENT';
  }
  return 'ROUTE_DEAD';
}

/** 人可读报告（一行结论 + 自检 + 每端口明细；写 hilog / 落文件都用它，避免两套文案）。 */
export function formatProbeReport(list: HdcPortProbe[], selftestOk: boolean = true): string {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const p: HdcPortProbe = list[i];
    const detail: string = p.reachable
      ? (p.bytes > 0 ? `bytes=${p.bytes} hex=${p.hex}` : 'silent')
      : `err=${p.error}`;
    parts.push(`${p.port}:${probeVerdictOf(p)}(${detail})`);
  }
  const st: string = selftestOk ? 'OK' : 'FAIL';
  return `summary=${probeSummary(list, selftestOk)} selftest=${st} | ${parts.join(' ')}`;
}

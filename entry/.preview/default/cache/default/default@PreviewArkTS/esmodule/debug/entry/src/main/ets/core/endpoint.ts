/**
 * 服务端地址的解析与校验 —— **纯函数、零依赖**（不 import 任何 `@kit.*`）。
 *
 * 为什么单独一个文件：这些逻辑要被单元测试直接跑（tools/tests 用 node 执行，
 * 运行期没有 `@kit.ArkData` 这类 SDK 模块）。把它和 `config.ets`（依赖 preferences）
 * 分开，既让测试可跑，也让"地址规则"成为可独立验证的契约。
 */
/**
 * 把用户随手输入的地址规范化：
 *   `192.168.1.10:16000`      → `http://192.168.1.10:16000`   （补协议）
 *   `http://a:16000/`         → `http://a:16000`              （去尾斜杠）
 *   `  http://a:16000  `      → `http://a:16000`              （去首尾空白）
 * 用户只该被要求"知道 IP 和端口"，不该被要求记住协议写法。
 */
export function normalizeServerUrl(raw: string): string {
    let s: string = raw.trim();
    if (s.length === 0) {
        return '';
    }
    if (!/^https?:\/\//i.test(s)) {
        s = `http://${s}`;
    }
    while (s.endsWith('/')) {
        s = s.substring(0, s.length - 1);
    }
    return s;
}
/**
 * 校验：整体必须就是 `http(s)://主机[:端口]`。
 * ⚠️ 必须**两端锚定**：只写 `/^https?:\/\/[^\s/]+/` 时，`http://a b:1` 会因为
 * 「第一个字符 a 就满足」而被判合法（2026-10-09 单测抓到）。
 */
export function isValidServerUrl(url: string): boolean {
    return /^https?:\/\/[^\s/]+$/i.test(url);
}

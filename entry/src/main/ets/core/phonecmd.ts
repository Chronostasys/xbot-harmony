/**
 * 手机命令的**纯逻辑**（可脱机单测）—— 从 `probe/phoneclient.ets` 抽出。
 *
 * 为什么抽出来：`commandUrl()` 曾经会把 `https://host:8082` 拼成 `https://host:8791`
 * （命令口是明文 HTTP，必须强制 `http://`），这类错误在设备上只表现为"连不上"，
 * 极难定位 ⇒ 必须有判据钉住。
 */

/** 插件命令口端口（与 `~/.xbot/plugins/xbot.phone/main.js` 一致）。 */
export const PHONE_CMD_PORT: number = 8791;

/**
 * 后端地址 → 插件命令口地址。
 * 规则：取 host，丢掉原端口，**强制 http**，端口换成 8791。
 * ⛔ 无 base（未登录/未配置）⇒ 返回空串，调用方据此等待。
 */
export function commandUrl(base: string): string {
  if (base === undefined || base === null || base.length === 0) {
    return '';
  }
  let rest: string = base;
  const schemeEnd: number = rest.indexOf('://');
  if (schemeEnd >= 0) {
    rest = rest.substring(schemeEnd + 3);
  }
  const slash: number = rest.indexOf('/');
  if (slash >= 0) {
    rest = rest.substring(0, slash);
  }
  // 去掉端口（保留 IPv6 的 [..]:port 形式里的 host 部分）
  const closeBracket: number = rest.lastIndexOf(']');
  const colon: number = rest.lastIndexOf(':');
  if (colon > closeBracket) {
    rest = rest.substring(0, colon);
  }
  return `http://${rest}:${PHONE_CMD_PORT}`;
}

/** 一条待执行命令（解析后的形状）。 */
export class PhoneCmd {
  id: string = '';
  tool: string = '';
  x: number = NaN;
  y: number = NaN;
  x1: number = NaN;
  y1: number = NaN;
  x2: number = NaN;
  y2: number = NaN;
  code: number = NaN;
  text: string = '';
}

/** 取 JSON 里某个 key 的字符串值（宽松解析；只用于我们自己生成的命令体）。 */
function phonePickStr(json: string, key: string): string {
  const k: string = `"${key}"`;
  const i: number = json.indexOf(k);
  if (i < 0) {
    return '';
  }
  const c: number = json.indexOf(':', i + k.length);
  if (c < 0) {
    return '';
  }
  let j: number = json.indexOf('"', c + 1);
  if (j < 0) {
    return '';
  }
  let out: string = '';
  j++;
  while (j < json.length) {
    const ch: string = json.charAt(j);
    if (ch === '\\' && j + 1 < json.length) {
      const n: string = json.charAt(j + 1);
      out += n === 'n' ? '\n' : (n === 't' ? '\t' : n);
      j += 2;
      continue;
    }
    if (ch === '"') {
      break;
    }
    out += ch;
    j++;
  }
  return out;
}

/** 取 JSON 里某个 key 的数值（不存在 ⇒ NaN）。 */
function phonePickNum(json: string, key: string): number {
  const k: string = `"${key}"`;
  const i: number = json.indexOf(k);
  if (i < 0) {
    return NaN;
  }
  const c: number = json.indexOf(':', i + k.length);
  if (c < 0) {
    return NaN;
  }
  let j: number = c + 1;
  while (j < json.length && (json.charAt(j) === ' ' || json.charAt(j) === '\t')) {
    j++;
  }
  let s: string = '';
  while (j < json.length) {
    const ch: string = json.charAt(j);
    if ((ch >= '0' && ch <= '9') || ch === '-' || ch === '.') {
      s += ch;
      j++;
    } else {
      break;
    }
  }
  return s.length > 0 ? Number.parseFloat(s) : NaN;
}

/** 把 `/poll` 返回体里的 `commands` 数组切成一个个对象串（不依赖完整 JSON 解析器）。 */
export function splitCommands(body: string): string[] {
  const out: string[] = [];
  const i: number = body.indexOf('"commands"');
  if (i < 0) {
    return out;
  }
  const start: number = body.indexOf('[', i);
  if (start < 0) {
    return out;
  }
  let depth: number = 0;
  let cur: string = '';
  for (let j: number = start + 1; j < body.length; j++) {
    const ch: string = body.charAt(j);
    if (ch === '{') {
      depth++;
      cur += ch;
    } else if (ch === '}') {
      depth--;
      cur += ch;
      if (depth === 0) {
        out.push(cur);
        cur = '';
      }
    } else if (depth > 0) {
      cur += ch;
    } else if (ch === ']') {
      break;
    }
  }
  return out;
}

/** 解析一条命令对象。 */
export function parseCmd(raw: string): PhoneCmd {
  const c: PhoneCmd = new PhoneCmd();
  c.id = phonePickStr(raw, 'id');
  c.tool = phonePickStr(raw, 'tool');
  c.x = phonePickNum(raw, 'x');
  c.y = phonePickNum(raw, 'y');
  c.x1 = phonePickNum(raw, 'x1');
  c.y1 = phonePickNum(raw, 'y1');
  c.x2 = phonePickNum(raw, 'x2');
  c.y2 = phonePickNum(raw, 'y2');
  c.code = phonePickNum(raw, 'code');
  c.text = phonePickStr(raw, 'text');
  return c;
}

/**
 * SSE 录制器门禁 —— `core/sserec.ets` 的**有界性 / 统计 / 脱敏 / 闭态零开销**。
 *
 * 为什么必须有守护：这是**排障面板的底座**，且脱敏是**安全红线**（录制面板会被截图/分享）。
 * 判据全部可脱机（纯函数/纯类），不依赖 SDK 或 UI。
 *
 * 守护的不变量：
 *   · 条数上限 512、字节上限 512KiB —— 越界必须**丢最老的**（先入先出），且**保留最新**；
 *   · 按类型计数准确；
 *   · `redact` 递归 / 大小写不敏感 / 数组，且**绝不修改原对象**；
 *   · `toJson` 确定性（同状态必得同串）；
 *   · **关闭开关时 `push` 零开销**（不脱敏、不入队、不计数）。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  SSEE_KIND_FRAME,
  SSEE_KIND_LIFECYCLE,
  SSEE_MAX_BYTES,
  SSEE_MAX_ENTRIES,
  SSEE_REDACTED,
  SseRecorder,
  kindForName,
  redact,
  redactPayloadText,
  sseRecorder,
  utf8ByteLen,
} from '../../entry/src/main/ets/core/sserec';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function on(): SseRecorder {
  const r = new SseRecorder();
  r.setEnabled(true);
  return r;
}

// ── ① 容量与淘汰顺序 ────────────────────────────────────────────────────────
{
  eq('条数上限常量 = 512（对齐服务端环形缓冲）', SSEE_MAX_ENTRIES, 512);
  eq('字节上限常量 = 512KiB', SSEE_MAX_BYTES, 512 * 1024);

  const r = on();
  for (let i = 0; i < 600; i++) {
    r.push('frame_x', `{"i":${i}}`, 1000 + i);
  }
  eq('超出条数上限 ⇒ 只留 512 条', r.count(), 512);
  const all = r.recent(512);
  eq('淘汰顺序 = 先入先出（最老的被丢）', all[0].seq, 600 - 512); // 88
  eq('最新一条完整保留', all[511].seq, 599);
  eq('recent(1) 返回最新一条', r.recent(1)[0].seq, 599);
  ok('首条时间戳 = 第 88 次（1000+88）', all[0].atMs === 1000 + 88, `got ${all[0].atMs}`);
  eq('recent(0) = 空', r.recent(0).length, 0);

  // 字节上限：每条 ~5000 字节，超过 512KiB 后丢最老的
  const rb = on();
  const big = 'x'.repeat(4900);
  for (let i = 0; i < 200; i++) {
    rb.push('frame_big', big, i);
  }
  ok('越界后占用字节回落到上限内', rb.totalBytes() <= SSEE_MAX_BYTES, `bytes=${rb.totalBytes()}`);
  ok('字节上限生效（条数明显少于 200）', rb.count() < 200, `count=${rb.count()}`);
  ok('至少保留最新一条', rb.count() >= 1);
  eq('保留的是最新的（seq 最大）', rb.recent(1)[0].seq, 199);

  // 单条本身超限 ⇒ 保留该条（不把自己丢掉）
  const rs = on();
  rs.push('frame_huge', 'y'.repeat(SSEE_MAX_BYTES + 1000), 7);
  eq('单条超限：保留最新一条（不空）', rs.count(), 1);
  eq('单条超限：seq 保留', rs.recent(1)[0].seq, 0);

  // clear
  r.clear();
  eq('clear 后条数归零', r.count(), 0);
  eq('clear 后字节归零', r.totalBytes(), 0);
  eq('clear 后计数归零', r.countOf('frame_x'), 0);
  eq('clear 后 pushCount 归零', r.pushCount, 0);
}

// ── ② 按类型计数 ────────────────────────────────────────────────────────────
{
  const r = on();
  r.push('progress', '{}', 1);
  r.push('progress', '{}', 2);
  r.push('stream_content', '{}', 3);
  r.push('state', 'open', 4);
  eq('progress 计 2 次', r.countOf('progress'), 2);
  eq('stream_content 计 1 次', r.countOf('stream_content'), 1);
  eq('state（生命周期）计 1 次', r.countOf('state'), 1);
  eq('未出现的事件名计 0 次', r.countOf('nope'), 0);
  eq('kind：state ⇒ lifecycle', kindForName('state'), SSEE_KIND_LIFECYCLE);
  eq('kind：error ⇒ lifecycle', kindForName('error'), SSEE_KIND_LIFECYCLE);
  eq('kind：reconnect ⇒ lifecycle', kindForName('reconnect'), SSEE_KIND_LIFECYCLE);
  eq('kind：progress ⇒ frame', kindForName('progress'), SSEE_KIND_FRAME);
}

// ── ③ redact：递归 / 大小写 / 数组 / 不改原对象 ──────────────────────────────
{
  const orig: Record<string, Object> = {};
  orig['api_key'] = 'sk-real-1';
  orig['Authorization'] = 'Bearer real-2';
  orig['PASSWORD'] = 'p@ss';
  orig['Token'] = 'tok';
  orig['secret'] = 'shh';
  orig['safe'] = 'keep-me';
  const nested: Record<string, Object> = {};
  nested['refresh_token'] = 'r1';
  nested['note'] = 'ok';
  orig['inner'] = nested;
  const arr: Object[] = [];
  const a0: Record<string, Object> = {};
  a0['password'] = 'deep';
  a0['visible'] = 1;
  arr.push(a0);
  arr.push('plain-string');
  orig['list'] = arr;

  // 快照原对象（用 JSON 串证明"未被修改"）
  const before = JSON.stringify(orig);
  const red = redact(orig) as Record<string, Object>;

  eq('api_key 被抹', red['api_key'], SSEE_REDACTED);
  eq('Authorization 被抹（大小写不敏感）', red['Authorization'], SSEE_REDACTED);
  eq('PASSWORD 被抹（全大写）', red['PASSWORD'], SSEE_REDACTED);
  eq('Token 被抹（首字母大写）', red['Token'], SSEE_REDACTED);
  eq('secret 被抹', red['secret'], SSEE_REDACTED);
  eq('非敏感键原样保留', red['safe'], 'keep-me');
  const redInner = red['inner'] as Record<string, Object>;
  eq('嵌套对象里的 refresh_token 被抹', redInner['refresh_token'], SSEE_REDACTED);
  eq('嵌套对象里的普通键保留', redInner['note'], 'ok');
  const redList = red['list'] as Object[];
  eq('数组里的对象被递归抹', (redList[0] as Record<string, Object>)['password'], SSEE_REDACTED);
  eq('数组里的对象普通键保留', (redList[0] as Record<string, Object>)['visible'], 1);
  eq('数组里的基础类型原样', redList[1], 'plain-string');

  eq('原对象未被修改（安全红线：入参可继续用）', JSON.stringify(orig), before);

  // 文本入口：JSON 串脱敏
  const t1 = redactPayloadText('{"api_key":"sk-live","msg":"hi"}');
  ok('JSON 文本：api_key 抹掉', t1.indexOf('sk-live') < 0, t1);
  ok('JSON 文本：普通字段保留', t1.indexOf('hi') >= 0, t1);
  eq('纯文本（非 JSON）原样返回', redactPayloadText('idle'), 'idle');
  eq('非法 JSON 原样返回（不吞不改）', redactPayloadText('{not json'), '{not json');
  eq('非对象 JSON（数组也是对象）仍被处理', redactPayloadText('[{"token":"z"}]').indexOf('z') < 0, true);
}

// ── ④ toJson 稳定 ───────────────────────────────────────────────────────────
{
  const r = on();
  r.status.httpVer = 'HTTP/1.1';
  r.status.state = 'open';
  r.status.lastErrCode = 2300023;
  r.status.lastRespCode = 200;
  r.status.reconnectCount = 3;
  r.push('progress', '{"a":1}', 111);
  r.push('state', 'open', 222);

  const a = r.toJson();
  const b = r.toJson();
  eq('toJson 幂等（同状态同串）', a, b);
  const parsed = JSON.parse(a) as Record<string, Object>;
  const status = parsed['status'] as Record<string, Object>;
  const stats = parsed['stats'] as Record<string, Object>;
  const entries = parsed['entries'] as Object[];
  eq('status.httpVer 回读', status['httpVer'], 'HTTP/1.1');
  eq('status.lastErrCode 回读', status['lastErrCode'], 2300023);
  eq('status.lastRespCode 回读', status['lastRespCode'], 200);
  eq('status.reconnectCount 回读', status['reconnectCount'], 3);
  eq('stats.count 回读', stats['count'], 2);
  eq('stats.maxEntries 回读', stats['maxEntries'], 512);
  eq('entries 条数', entries.length, 2);
  eq('entries[0].name', (entries[0] as Record<string, Object>)['name'], 'progress');
  eq('entries[0].kind', (entries[0] as Record<string, Object>)['kind'], 'frame');
  eq('entries[1].kind（state ⇒ lifecycle）', (entries[1] as Record<string, Object>)['kind'], 'lifecycle');
  // 键顺序稳定性：人工拼串 ⇒ 前缀固定
  ok('toJson 以固定前缀开头', a.startsWith('{"status":{"state":'), a.slice(0, 40));

  // 有界性：600 条后 toJson 仍确定
  const r2 = on();
  for (let i = 0; i < 600; i++) { r2.push('f', `${i}`, i); }
  eq('toJson 幂等（满缓冲）', r2.toJson(), r2.toJson());
}

// ── ⑤ 关闭开关时 push 不被调用（性能不回归）─────────────────────────────────
{
  const r = new SseRecorder(); // 默认关
  eq('默认开关 = 关', r.isEnabled(), false);
  for (let i = 0; i < 1000; i++) {
    const recorded = r.push('progress', `{"secret":"leak-${i}"}`, i);
    ok(`关闭态 push 返回 false（第 ${i} 次）`, recorded === false);
    if (recorded !== false) { break; }
  }
  eq('关闭态：pushCount 恒为 0（push 没被真正执行）', r.pushCount, 0);
  eq('关闭态：条数恒为 0', r.count(), 0);
  eq('关闭态：字节恒为 0', r.totalBytes(), 0);
  eq('关闭态：按类型计数恒为 0', r.countOf('progress'), 0);

  // 打开后立即生效（同一个实例）
  r.setEnabled(true);
  eq('打开后 push 生效', r.push('progress', '{}', 1), true);
  eq('打开后 pushCount = 1', r.pushCount, 1);
  eq('打开后再关闭：不再入队', (() => { r.setEnabled(false); return r.push('progress', '{}', 2); })(), false);
  eq('关闭后 pushCount 仍 = 1', r.pushCount, 1);
}

// ── 附：utf8ByteLen / 单例 ──────────────────────────────────────────────────
{
  eq('utf8：纯 ASCII 长度 = 字符数', utf8ByteLen('abc'), 3);
  eq('utf8：中文 3 字节', utf8ByteLen('中'), 3);
  eq('utf8：emoji（代理对）4 字节', utf8ByteLen('😀'), 4);
  eq('utf8：空串 0', utf8ByteLen(''), 0);
  ok('导出单例存在且默认关', sseRecorder !== undefined && sseRecorder.isEnabled() === false);
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
if (fail > 0) { console.log(`  sserec: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  sserec: ${pass} passed, 0 failed`);
process.exit(0);

export {};

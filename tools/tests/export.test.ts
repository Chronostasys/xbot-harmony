/**
 * 会话导出门禁 —— `core/export.ets` 的**判别力测试**。
 *
 * 权威：web `src/components/agent/api.ts:378-582`（native/openai/codex/multica/benchmark
 * + 文件名清理）+ `src/components/settings/SettingsDeveloper.tsx:60-92`（turn+iter 文本）。
 *
 * 守护的不变量（各配一条"必红"样本 —— 见每条注释里的 mutation 提示）：
 *   · **文件名**：非法字符 → `_`、空 chatID → `session`、**先替换后截断**（60 位）；
 *   · **openai**：字段序 `role→content→[tool_calls]→[tool_call_id]→[name]`、
 *     `model||'gpt-4o'`、空 system 不产行；
 *   · **codex**：`input_text`/`output_text` 由 role 定、**无**结尾换行、字段序
 *     `type→role→content→[reasoning]→[tool_calls]→…`；
 *   · **multica**：session 头 → model_change → parentId 链、contentParts 顺序
 *     `thinking→toolCall→text`、**有**结尾换行；
 *   · **转义**：正文含 `"` 与 `\n` ⇒ JSON 必须转义（naive 拼串会红）；
 *   · **超长/换行预览**：turn+iter 的 80/60 截断 + `\n`→空格 + `...`；
 *   · **空会话**：不崩、行数正确。
 *
 * ⚠️ 结尾必须 `process.exit(...)`：`tools/tests/run.sh` 用 `set -e` 且逐文件 `node`。
 */
declare const process: { exit: (c: number) => void };

import {
  EXPORT_BENCHMARK,
  EXPORT_CODEX,
  EXPORT_MULTICA,
  EXPORT_NATIVE,
  EXPORT_OPENAI,
  DemoMessage,
  DemoPart,
  DemoRecord,
  ExportedMessage,
  ExportedRecord,
  ExportedSession,
  ExportedUsage,
  ExportClock,
  exportFilename,
  extForFormat,
  mimeForFormat,
  sanitizeExportLabel,
  toBenchmarkJsonl,
  toCodexJsonl,
  toMulticaJsonl,
  toNativeJson,
  toOpenAiJson,
  toTurnIterTxt,
  turnIterFilename,
  EXPORT_TURN_ITER,
  ExportAction,
  demoRecordsFrom,
  exportActionExt,
  exportActionFilename,
  exportActions,
  exportedSessionFrom,
  renderExportText,
} from '../../entry/src/main/ets/core/export';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

function msg(role: string, content: Object): ExportedMessage {
  const m = new ExportedMessage();
  m.role = role;
  m.content = content;
  return m;
}

// ═══ 1. 文件名（web api.ts:570-572 / SettingsDeveloper:88）═══════════════════════════
// mutation：把 `replace(...).slice(60)` 顺序对调、或去掉 replace ⇒ 必红。
eq('sanitize: 全非法字符 → 全 _', sanitizeExportLabel('a/b c:d'), 'a_b_c_d');
eq('sanitize: 空 chatID → session', sanitizeExportLabel(''), 'session');
eq('sanitize: 60 位截断（先替换）', sanitizeExportLabel('x'.repeat(200)).length, 60);
eq('sanitize: 替换后才截断（200 个非法字符 → 60 个 _）', sanitizeExportLabel('/'.repeat(200)), '_'.repeat(60));
eq('filename: <label>.<ext>', exportFilename('chat/one', 'jsonl'), 'chat_one.jsonl');
eq('turnIter filename（无空值兜底、40 位）', turnIterFilename('a/b'), 'session-a_b-turn-iter.txt');
eq('extForFormat codex=jsonl', extForFormat(EXPORT_CODEX), 'jsonl');
eq('extForFormat multica=jsonl', extForFormat(EXPORT_MULTICA), 'jsonl');
eq('extForFormat benchmark=jsonl', extForFormat(EXPORT_BENCHMARK), 'jsonl');
eq('extForFormat native=json', extForFormat(EXPORT_NATIVE), 'json');
eq('extForFormat openai=json', extForFormat(EXPORT_OPENAI), 'json');
eq('mimeForFormat codex', mimeForFormat(EXPORT_CODEX), 'application/x-jsonlines');
eq('mimeForFormat openai', mimeForFormat(EXPORT_OPENAI), 'application/json');

// ═══ 2. native（web api.ts:560-566）：JSON.stringify(session, null, 2) ═══════════════
{
  const s = new ExportedSession();
  s.id = 'abc';
  s.model = 'gpt-4o';
  const m = msg('user', 'hi');
  s.messages = [m];
  const out = toNativeJson(s);
  ok('native: 2 空格缩进', out.indexOf('\n  "model"') >= 0, out);
  const parsed = JSON.parse(out) as Record<string, Object>;
  eq('native: id 原样', parsed['id'], 'abc');
  eq('native: messages 数组', (parsed['messages'] as Object[]).length, 1);
  // 字段序：id 必须在 model 之前（web ExportedSession 声明序）
  ok('native: 字段序 id<model<system_instructions<messages', out.indexOf('"id"') < out.indexOf('"model"'));
}

// ═══ 3. openai（web api.ts:396-422）═════════════════════════════════════════════════
{
  const s = new ExportedSession();
  s.model = 'gpt-4o-mini';
  s.system_instructions = 'You are X.';
  const u = msg('user', 'hi');
  const a = msg('assistant', '');
  a.tool_calls = [{
    id: 'call_1',
    type: 'function',
    function: { name: 'shell', arguments: '{"cmd":"ls"}' },
  }];
  const t = msg('tool', 'out');
  t.tool_call_id = 'call_1';
  t.name = 'shell';
  s.messages = [u, a, t];

  const out = toOpenAiJson(s);
  const parsed = JSON.parse(out) as Record<string, Object>;
  eq('openai: model 取 session.model', parsed['model'], 'gpt-4o-mini');
  const msgs = parsed['messages'] as Record<string, Object>[];
  eq('openai: 4 条（system+3）', msgs.length, 4);
  eq('openai: [0] system', msgs[0]['role'], 'system');
  eq('openai: [0] content=system_instructions', msgs[0]['content'], 'You are X.');
  eq('openai: [1] user content 直传', msgs[1]['content'], 'hi');
  eq('openai: [2] assistant tool_calls 原样透传', (msgs[2]['tool_calls'] as Object[])[0], {
    id: 'call_1', type: 'function', function: { name: 'shell', arguments: '{"cmd":"ls"}' },
  });
  eq('openai: [3] tool_call_id', msgs[3]['tool_call_id'], 'call_1');
  eq('openai: [3] name', msgs[3]['name'], 'shell');
  // 字段序：role → content → tool_calls（用解析后的键序判定，避免 JSON 美化换行干扰）
  eq('openai: assistant 键序 role,content,tool_calls',
    Object.keys(msgs[2]), ['role', 'content', 'tool_calls']);
  eq('openai: tool 消息键序 role,content,tool_call_id,name',
    Object.keys(msgs[3]), ['role', 'content', 'tool_call_id', 'name']);
  eq('openai: user 消息键序 role,content', Object.keys(msgs[1]), ['role', 'content']);
}
{
  // 空 model ⇒ 回落 gpt-4o（web `data.model || 'gpt-4o'`）；无 system ⇒ 首条不是 system
  const s = new ExportedSession();
  s.messages = [msg('user', 'x')];
  const parsed = JSON.parse(toOpenAiJson(s)) as Record<string, Object>;
  eq('openai: 空 model 回落 gpt-4o', parsed['model'], 'gpt-4o');
  const msgs = parsed['messages'] as Record<string, Object>[];
  eq('openai: 无 system_instructions ⇒ 只 1 条', msgs.length, 1);
  eq('openai: 首条是 user', msgs[0]['role'], 'user');
}
{
  // 转义样本：正文含 `"` 与 `\n` —— naive 拼串会漏转义 ⇒ 必红
  const s = new ExportedSession();
  s.model = 'm';
  s.messages = [msg('user', 'He said "hi"\nnext')];
  const parsed = JSON.parse(toOpenAiJson(s)) as Record<string, Object>;
  const msgs = parsed['messages'] as Record<string, Object>[];
  eq('openai: 含引号/换行的正文正确转义（round-trip）', msgs[0]['content'], 'He said "hi"\nnext');
  ok('openai: 原始串里引号被转义为 \\"', toOpenAiJson(s).indexOf('\\"hi\\"') >= 0);
}

// ═══ 4. codex（web api.ts:424-462）══════════════════════════════════════════════════
{
  const s = new ExportedSession();
  s.system_instructions = 'SYS';
  const u = msg('user', 'hi');
  const a = msg('assistant', 'yo');
  a.reasoning = 'think';
  s.messages = [u, a];

  const out = toCodexJsonl(s);
  const lines = out.split('\n');
  eq('codex: 3 行', lines.length, 3);
  const l0 = JSON.parse(lines[0]) as Record<string, Object>;
  eq('codex: [0] system 行', l0, { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'SYS' }] });
  const l1 = JSON.parse(lines[1]) as Record<string, Object>;
  eq('codex: [1] user ⇒ input_text', l1['content'], [{ type: 'input_text', text: 'hi' }]);
  const l2 = JSON.parse(lines[2]) as Record<string, Object>;
  eq('codex: [2] assistant ⇒ output_text', l2['content'], [{ type: 'output_text', text: 'yo' }]);
  eq('codex: [2] reasoning 附加', l2['reasoning'], 'think');
  // 字段序 type→role→content→reasoning
  eq('codex: 键序 type,role,content,reasoning', Object.keys(l2), ['type', 'role', 'content', 'reasoning']);
  // ⚠️ codex 无结尾换行（与 multica 相反）
  ok('codex: 无结尾换行', out.charAt(out.length - 1) !== '\n', JSON.stringify(out.slice(-3)));
}
{
  // 数组型 content ⇒ JSON.stringify（web `JSON.stringify(msg.content)`）
  const s = new ExportedSession();
  const m = msg('user', [{ type: 'text', text: 'a' }]);
  s.messages = [m];
  const l = JSON.parse(toCodexJsonl(s)) as Record<string, Object>;
  eq('codex: 数组 content 折叠为 JSON 文本', (l['content'] as Record<string, Object>[])[0]['text'], '[{"type":"text","text":"a"}]');
}
{
  // 转义样本（codex）：正文含 `"` 与 `\n` ⇒ JSON.stringify 必须转义（naive 拼串必红）
  const s = new ExportedSession();
  s.messages = [msg('user', 'say "hi"\nNEXT')];
  const raw = toCodexJsonl(s);
  const l = JSON.parse(raw) as Record<string, Object>;
  eq('codex: 含引号/换行的正文 round-trip', (l['content'] as Record<string, Object>[])[0]['text'], 'say "hi"\nNEXT');
  ok('codex: 原始串里换行被转义为 \\n', raw.indexOf('say \\"hi\\"\\nNEXT') >= 0, raw);
}

// ═══ 5. multica（web api.ts:464-558）════════════════════════════════════════════════
{
  const clock = new ExportClock('2026-01-01T00:00:00.000Z', 1234567890);
  const s = new ExportedSession();
  s.id = 'sess-1';
  s.model = 'gpt-4o';
  s.created_at = '2026-01-01T00:00:00.000Z';
  const u = msg('user', 'hi');
  u.timestamp = '2026-01-01T00:00:01.000Z';
  const a = msg('assistant', 'done');
  a.reasoning = 'rm';
  a.tool_calls = [{ id: 'c1', type: 'function', function: { name: 'sh', arguments: '{"a":1}' } }];
  s.messages = [u, a];

  const out = toMulticaJsonl(s, clock);
  eq('multica: 有结尾换行', out.charAt(out.length - 1), '\n');
  const lines = out.split('\n');
  // 末元素为空串（结尾换行产生）
  eq('multica: 4 行 + 末尾空串', lines.length, 5);
  eq('multica: [0] session 头', JSON.parse(lines[0]), {
    type: 'session', version: 3, id: 'sess-1', timestamp: '2026-01-01T00:00:00.000Z', cwd: '',
  });
  eq('multica: [1] model_change 键序', Object.keys(JSON.parse(lines[1]) as Object),
    ['type', 'id', 'parentId', 'timestamp', 'provider', 'modelId']);
  const mc = JSON.parse(lines[1]) as Record<string, Object>;
  eq('multica: model_change parentId=null', mc['parentId'], null);
  eq('multica: model_change provider=macaronai', mc['provider'], 'macaronai');
  const m0 = JSON.parse(lines[2]) as Record<string, Object>;
  eq('multica: [2] 首条消息 parentId=null', m0['parentId'], null);
  eq('multica: [2] 消息外层键序 type,id,parentId,timestamp,message',
    Object.keys(m0), ['type', 'id', 'parentId', 'timestamp', 'message']);
  const inner0 = m0['message'] as Record<string, Object>;
  eq('multica: [2] 普通消息 inner 键序 role,content,timestamp',
    Object.keys(inner0), ['role', 'content', 'timestamp']);
  eq('multica: [2] msg.timestamp 透传', m0['timestamp'], '2026-01-01T00:00:01.000Z');
  eq('multica: [2] inner.timestamp=nowMs', inner0['timestamp'], 1234567890);
  // contentParts 顺序：thinking → toolCall → text
  const inner1 = (JSON.parse(lines[3]) as Record<string, Object>)['message'] as Record<string, Object>;
  const parts = inner1['content'] as Record<string, Object>[];
  eq('multica: [3] contentParts 顺序 thinking,toolCall,text',
    parts.map((p) => p['type']), ['thinking', 'toolCall', 'text']);
  eq('multica: toolCall.arguments 被 JSON.parse', parts[1]['arguments'], { a: 1 });
  // parentId 链：第二条的 parentId = 第一条的 id
  eq('multica: parentId 链', (JSON.parse(lines[3]) as Record<string, Object>)['parentId'],
    m0['id']);
}
{
  // toolResult 分支（tool_call_id 存在）+ contentParts 为空时兜底
  const clock = new ExportClock('T', 1);
  const s = new ExportedSession();
  s.id = 'x';
  const t = msg('tool', 'out');
  t.tool_call_id = 'c9';
  s.messages = [t];
  const lines = toMulticaJsonl(s, clock).split('\n');
  const inner = (JSON.parse(lines[1]) as Record<string, Object>)['message'] as Record<string, Object>;
  eq('multica: toolResult 键序 role,toolCallId,toolName,content,isError,timestamp',
    Object.keys(inner), ['role', 'toolCallId', 'toolName', 'content', 'isError', 'timestamp']);
  eq('multica: toolResult role', inner['role'], 'toolResult');
  eq('multica: toolResult isError=false', inner['isError'], false);
}
{
  // 空会话：只有 session 头（无 model ⇒ 无 model_change、无消息）
  const clock = new ExportClock('T', 1);
  const s = new ExportedSession();
  s.id = 'only';
  const out = toMulticaJsonl(s, clock);
  eq('multica: 空会话仅 session 头 + 换行', out, JSON.stringify({
    type: 'session', version: 3, id: 'only', timestamp: 'T', cwd: '',
  }) + '\n');
}

// ═══ 6. benchmark（web api.ts:383-391）══════════════════════════════════════════════
{
  const p = new DemoPart();
  p.part_kind = 'user-prompt';
  p.content = 'Q';
  p.tool_name = '';
  p.tool_call_id = '';
  p.args = '';
  const dm = new DemoMessage();
  dm.kind = 'request';
  dm.parts = [p];
  const r = new DemoRecord();
  r.uuid = 'u1';
  r.question = 'Q';
  r.answer = 'A';
  r.domain = 'd';
  r.messages = [dm];
  r.correct = false;
  r.judge_applied = false;

  const out = toBenchmarkJsonl([r]);
  eq('benchmark: 非空 ⇒ 末尾补换行', out.charAt(out.length - 1), '\n');
  const line = JSON.parse(out.split('\n')[0]) as Record<string, Object>;
  eq('benchmark: DemoRecord 键序', Object.keys(line),
    ['uuid', 'question', 'answer', 'domain', 'messages', 'correct', 'judge_applied']);
  const dm0 = (line['messages'] as Record<string, Object>[])[0];
  const parts0 = dm0['parts'] as Record<string, Object>[];
  eq('benchmark: DemoPart 键序', Object.keys(parts0[0]),
    ['part_kind', 'content', 'tool_name', 'tool_call_id', 'args']);
}
eq('benchmark: 空数组 ⇒ 空串（无换行）', toBenchmarkJsonl([]), '');

// ═══ 7. 开发者 turn+iter 文本（web SettingsDeveloper.tsx:60-92）════════════════════════
{
  const s = new ExportedSession();
  s.model = 'gpt-4o';
  const u = msg('user', 'a'.repeat(100)); // 超长 → 80 截断 + ...
  const a = msg('assistant', 'line1\nline2'); // 换行 → 空格
  const rec = new ExportedRecord();
  rec.history_id = 7;
  rec.record_type = 'message';
  rec.turn_id = 3;
  rec.role = 'user';
  rec.content = 'c'.repeat(70); // 超长 → 60 截断
  s.messages = [u, a];
  s.records = [rec];

  const out = toTurnIterTxt(s, 'web', 'chat-1', '2026-01-01T00:00:00.000Z');
  const lines = out.split('\n');
  eq('turnIter: 头行 1', lines[0], '# Session: web:chat-1');
  eq('turnIter: 头行 2', lines[1], '# Model: gpt-4o');
  eq('turnIter: 头行 3', lines[2], '# Messages: 2');
  eq('turnIter: 头行 4', lines[3], '# Exported: 2026-01-01T00:00:00.000Z');
  eq('turnIter: 空行分隔', lines[4], '');
  eq('turnIter: 超长正文 80 截断 + ...', lines[5], `role=user content="${'a'.repeat(80)}..."`);
  eq('turnIter: 正文换行 → 空格', lines[6], 'role=assistant content="line1 line2"');
  eq('turnIter: 空行', lines[7], '');
  eq('turnIter: records 标题', lines[8], '# Records (append-only history):');
  eq('turnIter: record 行（turn=3, 60 截断）', lines[9], `  hid=7 type=message turn=3 role=user content="${'c'.repeat(60)}..."`);
}
{
  // 空会话 + 无 records
  const s = new ExportedSession();
  const out = toTurnIterTxt(s, 'cli', 'c', 'T');
  ok('turnIter: 无 model ⇒ unknown', out.indexOf('# Model: unknown') >= 0, out);
  ok('turnIter: 无 records ⇒ (no records)', out.indexOf('  (no records)') >= 0, out);
}

// ═══ 8. 转义红线：正文含引号的 turnIter 预览必须被 JSON 语义安全的字符串承载 ═══════════
{
  // turn+iter 用 `content="..."` 包裹，web **不做**转义（原样塞入）⇒ 复刻 web 行为。
  const s = new ExportedSession();
  s.messages = [msg('user', 'say "hi"')];
  const out = toTurnIterTxt(s, 'c', 'x', 'T');
  ok('turnIter: 引号原样（复刻 web，不转义）', out.indexOf('content="say "hi""') >= 0, out);
}

// ═══ 9. 导出动作表 + 命名 + 分派（2026-10-11 目标④ UI 接线；G2/G3 补 openai/codex）═════
// 判据与渲染同源：设置页的按钮 / 文件名 / RPC 全从 `exportActions()` 派生。
// ★ 判别力（mutation 必红）：
//   ① 删 openai/codex 任一新项 ⇒「动作数」「id 序列」「含新项」「格式→实现」全红
//      （**零扫描判红**：动作数/id 序列是硬编码期望 ⇒ 空表或漏项都必红）；
//   ② 把某项 `format` 改成一个**不存在的实现名**（如 `'openaiX'`）⇒ `renderExportText` 回落 native，
//      与该形态的**直接实现**产物不再逐字相同 ⇒「格式→实现」红（防"列了但没实现"）。
{
  const acts: ExportAction[] = exportActions();
  // 零扫描防线：动作数 + id 序列均为硬编码期望（空表/漏项/多项都必红）。
  eq('动作数 = 6（native+openai json / multica+benchmark+codex jsonl / turn-iter txt）', acts.length, 6);
  eq('  id 稳定且互异（含 openai/codex）', acts.map((a) => a.id).join(','),
    'json,json-openai,jsonl-multica,jsonl-benchmark,jsonl-codex,txt-turn-iter');
  eq('  format 覆盖 5 种形态 + turn-iter', acts.map((a) => a.format).join(','),
    `${EXPORT_NATIVE},${EXPORT_OPENAI},${EXPORT_MULTICA},${EXPORT_BENCHMARK},${EXPORT_CODEX},${EXPORT_TURN_ITER}`);
  // G2/G3：必须**显式**含 openai / codex（存在性断言 ⇒ 单独删任一项也必红）
  ok('含 openai 导出动作（G2）', acts.some((a) => a.format === EXPORT_OPENAI));
  ok('含 codex 导出动作（G3）', acts.some((a) => a.format === EXPORT_CODEX));
  eq('  只有 benchmark 走 jsonl RPC', acts.filter((a) => a.viaJsonlRpc).map((a) => a.id).join(','),
    'jsonl-benchmark');

  // 按 id 取（不靠下标 ⇒ 顺序调整不假红）；找不到 ⇒ format 非法 ⇒ 下游断言必红
  const byId = (id: string): ExportAction => {
    const found = acts.filter((a) => a.id === id);
    return found.length === 1 ? found[0] : new ExportAction('', 'MISSING', '', '', false);
  };
  eq('扩展名：native ⇒ json', exportActionExt(byId('json')), 'json');
  eq('扩展名：openai ⇒ json', exportActionExt(byId('json-openai')), 'json');
  eq('扩展名：multica ⇒ jsonl', exportActionExt(byId('jsonl-multica')), 'jsonl');
  eq('扩展名：benchmark ⇒ jsonl', exportActionExt(byId('jsonl-benchmark')), 'jsonl');
  eq('扩展名：codex ⇒ jsonl', exportActionExt(byId('jsonl-codex')), 'jsonl');
  eq('扩展名：turn-iter ⇒ txt', exportActionExt(byId('txt-turn-iter')), 'txt');

  eq('文件名：native ⇒ <label>.json', exportActionFilename(byId('json'), 'web/abc'), 'web_abc.json');
  eq('文件名：openai ⇒ <label>.json', exportActionFilename(byId('json-openai'), 'web/abc'), 'web_abc.json');
  eq('文件名：codex ⇒ <label>.jsonl', exportActionFilename(byId('jsonl-codex'), 'web/abc'), 'web_abc.jsonl');
  eq('文件名：turn-iter ⇒ session-<label>-turn-iter.txt', exportActionFilename(byId('txt-turn-iter'), 'web/abc'),
    'session-web_abc-turn-iter.txt');
  ok('文件名不含时间戳（唯一来源 = chatID）', exportActionFilename(byId('json'), 'x').indexOf('20') < 0);

  // ★ 核心：每个动作的 `format` 必须路由到一个**真实存在**的实现
  //   （产物 = 该形态「直接实现」的逐字产物；若 format 不存在 ⇒ 回落 native ⇒ 不等 ⇒ 红）。
  const s = new ExportedSession();
  s.id = 's1';
  s.model = 'm';
  s.messages = [msg('user', 'hi')];
  const nowIso = '2026-01-01T00:00:00.000Z';
  // ⚠️ multica 用注入 clock；每次调用必须给**全新同初值** clock（内部 seq 有状态 ⇒ 复用会漂）
  const mkClock = (): ExportClock => new ExportClock(nowIso, 0);
  const direct: Record<string, string> = {};
  direct[EXPORT_NATIVE] = toNativeJson(s);
  direct[EXPORT_OPENAI] = toOpenAiJson(s);
  direct[EXPORT_CODEX] = toCodexJsonl(s);
  direct[EXPORT_MULTICA] = toMulticaJsonl(s, mkClock());
  direct[EXPORT_TURN_ITER] = toTurnIterTxt(s, 'ch', 'id', nowIso);
  for (const a of acts) {
    if (a.viaJsonlRpc) {
      continue; // benchmark：记录来自服务端 `export_session_jsonl`，不经 `renderExportText`
    }
    eq(`动作 ${a.id} 的 format 指向存在的实现（未回落 native）`,
      renderExportText(a.format, s, 'ch', 'id', nowIso, mkClock()), direct[a.format]);
  }
  // 判别力反证：不存在的 format ⇒ 回落 native（≠ 直接实现）——证明上一条能抓"列了但没实现"
  ok('不存在的 format 回落 native（反证）',
    renderExportText('openai-not-implemented', s, 'ch', 'id', nowIso, mkClock()) === toNativeJson(s));
  ok('不存在的 format 产物 ≠ openai 直接实现（反证）',
    renderExportText('openai-not-implemented', s, 'ch', 'id', nowIso, mkClock()) !== toOpenAiJson(s));

  eq('未知 format 回落 native（不抛）', renderExportText('weird', s, 'ch', 'id', 'T', mkClock()), toNativeJson(s));
}

// ═══ 10. RPC 响应收窄（全容错；脏数据不抛）═══════════════════════════════════════════
// ★ 判别力（mutation 必红）：删 `exportedSessionFrom` 的 messages 循环 ⇒「消息条数」红。
{
  const sessRaw: Record<string, Object> = {
    id: 'c1',
    model: 'gpt-x',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'yo' }], tool_calls: [{ id: 't1' }], reasoning: 'r' },
    ],
    records: [{ history_id: 7, record_type: 'message', content: 'x', turn_id: 2, role: 'user' }],
    created_at: '2026-01-01T00:00:00.000Z',
    junk: 123,
  };
  const s2 = exportedSessionFrom(sessRaw);
  eq('收窄：id', s2.id, 'c1');
  eq('收窄：model', s2.model, 'gpt-x');
  eq('收窄：消息条数', s2.messages.length, 2);
  eq('收窄：数组 content 原样透传', JSON.stringify(s2.messages[1].content), '[{"type":"text","text":"yo"}]');
  eq('收窄：tool_calls 原样透传', JSON.stringify(s2.messages[1].tool_calls), '[{"id":"t1"}]');
  eq('收窄：reasoning', s2.messages[1].reasoning, 'r');
  eq('收窄：records 条数', s2.records === undefined ? -1 : s2.records.length, 1);
  eq('收窄：record.turn_id', s2.records === undefined ? -1 : s2.records[0].turn_id, 2);
  ok('未声明字段被丢弃（不污染导出）', JSON.stringify(s2).indexOf('junk') < 0);

  // 脏数据：全容错、不抛（⛔ 不用 `null` 字面量 —— 与 `Record<string, Object>` 的索引签名不兼容）
  const dirtyIn: Record<string, Object> = {};
  dirtyIn['id'] = 42;
  dirtyIn['messages'] = 'nope';
  const dirty = exportedSessionFrom(dirtyIn);
  eq('脏数据：非字符串 id ⇒ 空串', dirty.id, '');
  eq('脏数据：非数组 messages ⇒ 空数组', dirty.messages.length, 0);
  const noRecs: Record<string, Object> = {};
  noRecs['records'] = 'nope';
  eq('脏数据：records 非数组 ⇒ 不设（undefined）', exportedSessionFrom(noRecs).records === undefined, true);

  const recsRaw: Record<string, Object> = {
    records: [{ uuid: 'u1', question: 'q', answer: 'a', correct: true,
      messages: [{ kind: 'k', parts: [{ part_kind: 'text', content: 'c' }] }] }],
    count: 1,
  };
  const recs = demoRecordsFrom(recsRaw);
  eq('benchmark 收窄：条数', recs.length, 1);
  eq('benchmark 收窄：uuid/correct', `${recs[0].uuid}:${recs[0].correct}`, 'u1:true');
  eq('benchmark 收窄：嵌套 parts', recs[0].messages[0].parts[0].content, 'c');
  eq('benchmark 脏数据不抛', demoRecordsFrom({ records: 'x' } as Record<string, Object>).length, 0);
}

console.log(fail === 0 ? `✅ export: ${pass} passed` : `❌ export: ${fail} failed / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);

export {};

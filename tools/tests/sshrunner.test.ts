/**
 * sshrunner 纯逻辑测试 —— 原生「远程机器」面板（web 内置插件 `xbot.ssh-runner` 的原生落地）。
 *
 * 判别力要点（错一个字就会误导用户 / 让服务端拒收 / 泄漏凭据）：
 * ① **RPC 参数线格式**：插件方法名含点号 ⇒ 必须包 `web_plugin_rpc`；每个参数类的
 *    JSON 键名必须**逐字**等于服务端 tag（`connect_cmd` / `download_base` / `install_dir` /
 *    `job_id` / `uninstall` / `chat_id` vs `chatID` 的区别——后者是 git 面板的口径）。
 * ② **连接态权威**：`connected` 布尔优先，`service_state` 只作补充；空 status ⇒ 未连接。
 * ③ **配置解析的容错**：targets JSON 损坏/单条坏 ⇒ 跳过而不是崩；camelCase 别名；
 *    用户手改的 `'true'` 字符串也得认。
 * ④ **脱敏**：`maskSSH` 必须只摘 `user@host` —— `-i /path/key` 这类**凭据绝不能进列表行**。
 * ⑤ **空值口径**：`remote_port` 只在 tunnel 且 > 0 时出现；`connected_at` 空则不画行。
 */
declare const process: { exit: (c: number) => void };

import {
  CONNECT_POLL_INTERVAL_MS, CONNECT_POLL_MAX_ATTEMPTS, CONN_CONNECTED, CONN_DISCONNECTED,
  CONN_RECONNECTING, JOB_POLL_INTERVAL_MS, MachineTarget, MODE_DIRECT, MODE_TUNNEL,
  RPC_RUNNER_CREATE, RPC_RUNNER_DELETE, RPC_RUNNER_REGISTRY, RPC_RUNNER_SESSION_GET,
  RPC_RUNNER_SESSION_SET, RPC_WEB_PLUGIN, RunnerCreateParams, RunnerCreateRekeyParams,
  RunnerDeleteParams, RunnerRegistryParams, RunnerRegistryView, RunnerSessionGetParams,
  RunnerSessionParams, SSH_BAR_VIEW_ID, SSH_LOG_LINES, SSH_PANEL_TITLE, SSH_PANEL_VIEW_ID,
  SSH_RUNNER_PLUGIN_ID, SshConnectParams, SshJobStartParams, SshJobStatusParams,
  SshLogsParams, SshPluginRpcParams, SshProbeParams, SshTargetParams, connectionStateLabel,
  connectionStateOf, connectionStateTone, defaultConfigValues, jobDone, jobErrorText,
  jobFailed, jobLastStepName, jobRunning, jobSteps, maskSSH, mergeConfigValues,
  modeLongLabel, modeShort, normalizeConnectionMode, parseTargets, serializeTargets,
  sessionLineText, sshMethod, targetMetaText, statusFacts, unmanagedEntries, unmanagedStateText,
  validateNewTarget, viewFromEntries, runnerCreateParamsFor,
} from '../../entry/src/main/ets/core/sshrunner';
// 原生落地注册表（wiring 判据）—— `pluginhost.ets` 是纯 TS ⇒ 直接调，不用静态扫描。
import { nativeViewKind } from '../../entry/src/main/ets/core/pluginhost';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// ── ① 通道常量 / 方法名（wire 格式钉死）──────────────────────────────────────
eq('插件 id', SSH_RUNNER_PLUGIN_ID, 'xbot.ssh-runner');
eq('面板视图 id（nativeViewKind 注册键）', SSH_PANEL_VIEW_ID, 'xbot.ssh-runner.panel');
eq('信息栏视图 id', SSH_BAR_VIEW_ID, 'xbot.ssh-runner.bar');
eq('面板标题', SSH_PANEL_TITLE, '远程机器');
eq('外层方法名复用 git 面板同一常量', RPC_WEB_PLUGIN, 'web_plugin_rpc');
eq('插件方法全名', sshMethod('status'), 'xbot.ssh-runner.status');
eq('核心 RPC 名（直接当外层 method）', [RPC_RUNNER_CREATE, RPC_RUNNER_DELETE, RPC_RUNNER_REGISTRY],
  ['runner_create', 'runner_delete', 'runner_registry']);
eq('会话 RPC 名', [RPC_RUNNER_SESSION_GET, RPC_RUNNER_SESSION_SET],
  ['runner_session_get', 'runner_session_set']);
eq('日志行数 100', SSH_LOG_LINES, 100);

// ── ①b 参数类的 wire 键名（⛔ 服务端按 tag 收，错一个键 = 静默无效）──────────
eq('web_plugin_rpc 外层形态', JSON.stringify(new SshPluginRpcParams(sshMethod('status'), new SshTargetParams('ssh a@b', 'm1'))),
  '{"method":"xbot.ssh-runner.status","params":{"ssh":"ssh a@b","name":"m1"}}');
eq('probe 只带 ssh', JSON.stringify(new SshProbeParams('ssh a@b')), '{"ssh":"ssh a@b"}');
eq('provision 键名 download_base/install_dir（ snake ）',
  JSON.stringify(new SshJobStartParams('ssh a@b', 'm1', 'https://x/y', '/usr/local/bin', false)),
  '{"ssh":"ssh a@b","name":"m1","download_base":"https://x/y","install_dir":"/usr/local/bin","uninstall":false}');
eq('connect 键名 connect_cmd/connection_mode/auto_connect',
  JSON.stringify(new SshConnectParams('ssh a@b', 'm1', 'xbot-runner --token t', '/usr/local/bin', 'tunnel', true)),
  '{"ssh":"ssh a@b","name":"m1","connect_cmd":"xbot-runner --token t","install_dir":"/usr/local/bin","connection_mode":"tunnel","auto_connect":true}');
eq('logs 带 lines', JSON.stringify(new SshLogsParams('ssh a@b', 'm1')), '{"ssh":"ssh a@b","name":"m1","lines":100}');
eq('job_status 键名 job_id', JSON.stringify(new SshJobStatusParams('j-1')), '{"job_id":"j-1"}');
eq('runner_create 仅名字', JSON.stringify(new RunnerCreateParams('m1')), '{"name":"m1"}');
eq('runner_create re-key 回传 7 个既有设置', JSON.stringify(new RunnerCreateRekeyParams('m1', 'docker', 'img:1', '/ws', 'openai', 'k', 'gpt', 'https://api')),
  '{"name":"m1","mode":"docker","docker_image":"img:1","workspace":"/ws","llm_provider":"openai","llm_api_key":"k","llm_model":"gpt","llm_base_url":"https://api"}');
eq('runner_delete', JSON.stringify(new RunnerDeleteParams('m1')), '{"name":"m1"}');
eq('runner_registry 带 managed', JSON.stringify(new RunnerRegistryParams(['a', 'b'])), '{"managed":["a","b"]}');
// ⚠️ 核心 RPC 用 `chat_id`（下划线）；git 面板口径是 `chatID` —— 混用 = 服务端读不到会话。
eq('runner_session_set 用 chat_id 且带 name', JSON.stringify(new RunnerSessionParams('web', 'c-1', 'm1')),
  '{"channel":"web","chat_id":"c-1","name":"m1"}');
eq('runner_session_get 不带 name', JSON.stringify(new RunnerSessionGetParams('web', 'c-1')),
  '{"channel":"web","chat_id":"c-1"}');

// ── ② 连接方式 / 连接态（权威口径）────────────────────────────────────────────
eq('未知连接方式 ⇒ tunnel（不静默选 direct）', [normalizeConnectionMode(undefined), normalizeConnectionMode(''), normalizeConnectionMode('nope')],
  [MODE_TUNNEL, MODE_TUNNEL, MODE_TUNNEL]);
eq('direct 原样', normalizeConnectionMode('direct'), MODE_DIRECT);
eq('空 status ⇒ 未连接', connectionStateOf(null), CONN_DISCONNECTED);
eq('空对象 ⇒ 未连接（后端未武装时就是空）', connectionStateOf({}), CONN_DISCONNECTED);
eq('connected=true 是权威', connectionStateOf({ connected: true, service_state: 'disconnected' }), CONN_CONNECTED);
eq('service_state=connected 亦可', connectionStateOf({ service_state: 'connected' }), CONN_CONNECTED);
eq('reconnecting', connectionStateOf({ connected: false, service_state: 'reconnecting' }), CONN_RECONNECTING);
eq('connected=false 且无 service_state ⇒ 未连接', connectionStateOf({ connected: false }), CONN_DISCONNECTED);
eq('文案', [connectionStateLabel(CONN_CONNECTED), connectionStateLabel(CONN_RECONNECTING), connectionStateLabel(CONN_DISCONNECTED)],
  ['已连接', '重连中', '未连接']);
eq('色调名（组件经 colorOf 解析）', [connectionStateTone(CONN_CONNECTED), connectionStateTone(CONN_RECONNECTING), connectionStateTone(CONN_DISCONNECTED)],
  ['success', 'warn', 'muted']);

// ── ③ 配置解析（容错是**安全**判据：配置可被用户手改）────────────────────────
eq('null ⇒ manifest 默认值', JSON.stringify(mergeConfigValues(null)), JSON.stringify(defaultConfigValues()));
eq('空串视为缺省（不被空值顶掉默认）', mergeConfigValues({ downloadBase: '', installDir: '   ' }).installDir, '/usr/local/bin');
eq('有值则采纳', mergeConfigValues({ installDir: '/opt/bin' }).installDir, '/opt/bin');
eq('connectionMode 归一化', mergeConfigValues({ connectionMode: 'weird' }).connectionMode, MODE_TUNNEL);

const goodTargets = JSON.stringify([
  { name: 'm1', ssh: 'ssh a@b', install_dir: '/usr/local/bin', connection_mode: 'direct', auto_connect: true, added_at: '2026-01-01T00:00:00Z' },
  { name: 'm2', ssh: 'ssh c@d', connectionMode: 'tunnel', autoConnect: 'true' },
]);
const parsed = parseTargets(goodTargets);
eq('两条目标', parsed.length, 2);
eq('首条字段', [parsed[0].name, parsed[0].ssh, parsed[0].connection_mode, parsed[0].auto_connect], ['m1', 'ssh a@b', MODE_DIRECT, true]);
eq('camelCase 别名被接受 + 字符串 "true" 认作真', [parsed[1].connection_mode, parsed[1].auto_connect], [MODE_TUNNEL, true]);
eq('坏 JSON ⇒ 空数组（不崩）', parseTargets('{not json').length, 0);
eq('非数组 ⇒ 空数组', parseTargets('{"a":1}').length, 0);
eq('空串 ⇒ 空数组', parseTargets('').length, 0);
eq('缺 name/ssh 的条目被跳过', parseTargets('[{"ssh":"x"},{"name":"y"},{"name":"z","ssh":"s"}]').length, 1);
eq('null 元素被跳过', parseTargets('[null,{"name":"z","ssh":"s"}]').length, 1);
eq('未知键不落盘（serialize 只写规范字段）',
  serializeTargets(parseTargets('[{"name":"z","ssh":"s","evil":{"x":1}}]')), '[{"name":"z","ssh":"s","install_dir":"","connection_mode":"tunnel","auto_connect":false,"added_at":""}]');
eq('序列化→解析 往返稳定', serializeTargets(parseTargets(serializeTargets(parseTargets(goodTargets)))),
  serializeTargets(parseTargets(goodTargets)));

// ── ④ 脱敏（凭据绝不进列表行）────────────────────────────────────────────────
eq('常规 ssh', maskSSH('ssh user@host -p 22'), 'user@host');
eq('带 -i 私钥 ⇒ 只摘 user@host', maskSSH('ssh -i /home/me/.ssh/id_ed25519 user@host'), 'user@host');
eq('带 ProxyCommand ⇒ 只摘 user@host', maskSSH('ssh -o ProxyCommand="nc %h %p" user@host'), 'user@host');
eq('别名形态', maskSSH('ssh gpu-box'), 'gpu-box');
eq('裸主机', maskSSH('ssh 10.0.0.5'), '10.0.0.5');
eq('非 ssh 前缀（用户直接写别名）', maskSSH('gpu-box'), 'gpu-box');
eq('空串', maskSSH(''), '');
// ⛔ 判别点：私钥路径**不得**出现在脱敏结果里。
eq('私钥路径不出现在结果里', maskSSH('ssh -i /secret/key user@host').indexOf('/secret'), -1);

// ── ⑤ 注册表分类（只做投影，判定由核心给）────────────────────────────────────
const entries = [
  { name: 'm1', managed: true, state: 'managed', selectable: true, bound_count: 0 },
  { name: 'm2', managed: false, state: 'live', selectable: true, bound_count: 2 },
  { name: 'ghost', managed: false, state: 'orphan', selectable: false, bound_count: 0 },
];
const view = viewFromEntries(entries, ['ghost', 'stale-name']);
eq('selectable 只含 selectable=true', view.selectable.map((r) => r.name), ['m1', 'm2']);
eq('孤儿名只在 entries 里存在时才保留（陈旧名丢弃）', view.orphans, ['ghost']);
eq('未纳管 = 不在 managed 且 state !== managed', unmanagedEntries(view, ['m1']).map((r) => r.name), ['m2', 'ghost']);
eq('全部在 managed 里 ⇒ 无未纳管', unmanagedEntries(view, ['m1', 'm2', 'ghost']).length, 0);
eq('null 视图 ⇒ 空', unmanagedEntries(null, []).length, 0);
eq('未纳管状态文案', [unmanagedStateText(entries[1]), unmanagedStateText(entries[2])], ['已连接但未纳管', '遗留登记']);

// ── ⑥ 作业状态 ───────────────────────────────────────────────────────────────
eq('仅 running 继续轮询', [jobRunning({ state: 'running' }), jobRunning({ state: 'done' }), jobRunning(null)], [true, false, false]);
eq('终态判定', [jobDone({ state: 'done' }), jobFailed({ state: 'failed' })], [true, true]);
eq('steps 缺省 ⇒ 空数组', jobSteps({}).length, 0);
eq('最后一步名', jobLastStepName({ state: 'running', steps: [{ name: 'download', ok: true }, { name: 'install', ok: false }] }), 'install');
eq('无步骤 ⇒ 空串', jobLastStepName({ state: 'running' }), '');
eq('失败原因优先用服务端的', jobErrorText({ state: 'failed', error: 'sha256 mismatch' }, '安装失败'), 'sha256 mismatch');
eq('服务端没给原因 ⇒ 回退兜底（绝不给空白错误行）', jobErrorText({ state: 'failed' }, '安装失败'), '安装失败');

// ── ⑦ 行内视图（判据与渲染同源）──────────────────────────────────────────────
const stFull = {
  installed_version: '1.2.3', service_state: 'connected', detail: 'ok', connected: true,
  connection_mode: 'tunnel', restarts: 3, connected_at: '2026-01-02T03:04:05Z', remote_port: 8443, last_error: '',
};
eq('诊断事实行顺序', statusFacts(stFull).map((f) => f.label), ['连接状态', '连接方式', '重连次数', '隧道端口', '连接时间', '版本']);
eq('隧道端口带 127.0.0.1', statusFacts(stFull)[3].value, '127.0.0.1:8443');
// ⛔ direct 模式**不画**隧道端口行（那个端口不存在）。
eq('direct ⇒ 无隧道端口行', statusFacts({ ...stFull, connection_mode: 'direct' }).map((f) => f.label).indexOf('隧道端口'), -1);
// ⛔ remote_port=0 ⇒ 不画（0 不是"端口 0"，是"没有"）。
eq('remote_port=0 ⇒ 无隧道端口行', statusFacts({ ...stFull, remote_port: 0 }).map((f) => f.label).indexOf('隧道端口'), -1);
eq('connected_at 空 ⇒ 不画该行', statusFacts({ ...stFull, connected_at: '' }).map((f) => f.label).indexOf('连接时间'), -1);
eq('null status ⇒ 无事实行', statusFacts(null).length, 0);
// ⛔ 判别点：连不上时**只有**这 4 行（连接态/方式/次数/版本）—— 端口与连接时间必须缺席。
eq('空连接态只有 4 行', statusFacts({ connected: true }).map((f) => f.label),
  ['连接状态', '连接方式', '重连次数', '版本']);
function factValue(status: Record<string, Object>, label: string): string {
  const rows = statusFacts(status);
  for (let i = 0; i < rows.length; i++) { if (rows[i].label === label) { return rows[i].value; } }
  return '<missing>';
}
eq('版本缺失 ⇒ 破折号（不是空白）', factValue({ connected: true }, '版本'), '—');
eq('连接方式缺失 ⇒ 破折号', factValue({ connected: true }, '连接方式'), '—');

eq('副行：重连+隧道+版本', targetMetaText(stFull), '重连 3 次 · 隧道 :8443 · 1.2.3');
eq('null status ⇒ 副行空串（不伪造 0 次重连）', targetMetaText(null), '');
eq('干净连接 ⇒ 副行空', targetMetaText({ connected: true, service_state: 'connected', restarts: 0, installed_version: '' }), '');

eq('会话行：未就绪', sessionLineText(false, ''), '当前目标：本机（会话身份未就绪）');
eq('会话行：本机', sessionLineText(true, ''), '当前目标：本机');
eq('会话行：目标机', sessionLineText(true, 'gpu-box'), '当前目标：gpu-box');

// ── ⑧ 表单校验 + 文案 ────────────────────────────────────────────────────────
eq('空名', validateNewTarget('', 'ssh a@b', []), '请填写名称');
eq('空 ssh', validateNewTarget('m1', '', []), '请填写 SSH 命令（例如 ssh user@host -p 22）');
eq('重名', validateNewTarget('m1', 'ssh a@b', ['m1']), '名称已存在：m1');
eq('通过', validateNewTarget('m2', 'ssh a@b', ['m1']), '');
eq('模式短名', [modeShort('tunnel'), modeShort('direct')], ['tunnel', 'direct']);
eq('模式长名含取舍说明', [modeLongLabel('tunnel').indexOf('server') >= 0, modeLongLabel('direct').indexOf('server') >= 0], [true, true]);
eq('新增目标用 installDir 兜底（表单没填时）',
  new MachineTarget('m1', 'ssh a@b', '', MODE_TUNNEL, false, '').install_dir, '');

// ── ⑨ 轮询节奏（与 web 逐字：1.5s / 24 次 ≈36s）──────────────────────────────
eq('作业轮询 1.5s', JOB_POLL_INTERVAL_MS, 1500);
eq('连接等待间隔/上限', [CONNECT_POLL_INTERVAL_MS, CONNECT_POLL_MAX_ATTEMPTS], [1500, 24]);
eq('等待上限 ≈36s', Math.round(CONNECT_POLL_INTERVAL_MS * CONNECT_POLL_MAX_ATTEMPTS / 1000), 36);

// ── ⑩ re-key：重连不重置既有机器设置（☠️ 判据错 = 悄悄清掉用户的 LLM/workspace 配置）──
const knownRunners = [
  { name: 'm1', mode: 'docker', docker_image: 'img:1', workspace: '/ws', llm_provider: 'openai', llm_api_key: 'sk', llm_model: 'gpt-5', llm_base_url: 'https://api' },
  { name: 'm2', mode: 'native' },
];
eq('已有行 ⇒ 回传 7 个既有设置（只轮换 token）',
  JSON.stringify(runnerCreateParamsFor('m1', knownRunners)),
  '{"name":"m1","mode":"docker","docker_image":"img:1","workspace":"/ws","llm_provider":"openai","llm_api_key":"sk","llm_model":"gpt-5","llm_base_url":"https://api"}');
eq('已有行但字段缺省 ⇒ 空串补齐（不送 undefined）',
  JSON.stringify(runnerCreateParamsFor('m2', knownRunners)),
  '{"name":"m2","mode":"native","docker_image":"","workspace":"","llm_provider":"","llm_api_key":"","llm_model":"","llm_base_url":""}');
eq('新机器 ⇒ 只发名字（首次登记）', JSON.stringify(runnerCreateParamsFor('fresh', knownRunners)), '{"name":"fresh"}');
eq('注册表为空 ⇒ 只发名字', JSON.stringify(runnerCreateParamsFor('x', [])), '{"name":"x"}');

// ── ⑪ 原生落地注册表（`nativeViewKind` —— **wiring 的正确性判据**）──────────────────
// ☠️ 删掉任一条分支 ⇒ 点「远程机器 → 打开」静默落回**整个 web 宿主页**（用户明确否掉的形态），
//    且没有任何别的测试会红 ⇒ 这三条断言是这条接线的**唯一**判别力来源。
eq('注册：远程机器面板 ⇒ 原生面板', nativeViewKind(SSH_PANEL_VIEW_ID), 'ssh.panel');
eq('注册：信息栏徽章 ⇒ 同一原生面板（顶部那行就是目标切换入口）', nativeViewKind(SSH_BAR_VIEW_ID), 'ssh.panel');
eq('未注册视图仍返回空（放行 WebView 兜底，⛔ 别把默认值写成某个原生面板）', nativeViewKind('xbot.unknown.panel'), '');
eq('空串入参返回空（不崩）', nativeViewKind(''), '');
eq('git 的两个既有注册未被回归', [nativeViewKind('xbot.git-fancy.panel'), nativeViewKind('xbot.git-fancy.commit')],
  ['git.panel', 'git.commit']);

console.log(`\nsshrunner: ${pass} passed / ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

export {};

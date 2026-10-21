/**
 * protocol_coverage.test.ts —— **事件联合闭合覆盖**（"没有事件能被静默丢掉"）。
 *
 * 动机（第 8 轮确证项的形状）：`turnID` 未知的 `text_final` 曾经被**静默 `return s`**
 * 丢弃 —— 事件类型存在、reduce 也有分支，但某条**子路径**悄悄吞掉了它。同类还有：
 * 后端新增字段（`turn_id` / `seq` / `omitempty` 修复）而前端 normalize 不解析 ⇒
 * 状态机永远拿不到那个信息，全链路"绿"但没有效果。
 *
 * 判据（三条，全部读源码做静态断言，不依赖后端仓库是否在当前机器上）：
 *   C1 **闭包**：`chat_types_full.ts` 的 `DomainEvent` 联合里出现的每个 `type: 'x'`，
 *      都必须在 `reduce.ts` 里有一个 `case 'x':` —— 否则那个事件根本不被处理。
 *   C2 **来源**：每个 `type: 'x'` 必须要么在 `normalize.ts` 的 `case 'x':` 里被生产，
 *      要么在**本地构造台账**（`LOCAL_ONLY`，附理由）里 —— 防止"新增一个无人生产的事件"
 *      （死类型 ⇒ 对应渲染/状态永远不会发生）。
 *   C3 **反孤儿**：`normalize.ts` 里每个 `case 'x':` 产出的 `type: 'x'` 必须在
 *      DomainEvent 联合里（防止 normalize 产出状态机不认识的事件 —— 会被 never 检查
 *      挡住，但 normalize 内部常写成 `as never`，所以仍需要这条）。
 *
 * ⚠️ 这是**源码文本**判据（不是运行时），因此必须剥注释、只取调用片段形态，
 *    并对"扫到 0 处"判红（白绿防线，见 AGENTS.md 的「判据 ≠ 信号」）。
 */

export {};

declare function require(m: 'fs'): { readFileSync(p: string, e: string): string; existsSync(p: string): boolean };
declare function require(m: 'path'): { join(...parts: string[]): string };
declare const __dirname: string;
declare const process: { exit: (c: number) => void };

const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`);
  }
}

function findRoot(start: string): string {
  let cur: string = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(cur, 'entry', 'src', 'main', 'ets', 'core'))) {
      return cur;
    }
    cur = path.join(cur, '..');
  }
  return '';
}
const ROOT: string = findRoot(__dirname);
const CORE: string = path.join(ROOT, 'entry', 'src', 'main', 'ets', 'core');

/** 剥掉块注释与行注释（判据必须先剥注释：注释里提到事件名不算实现）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function read(rel: string): string {
  return stripComments(fs.readFileSync(path.join(CORE, rel), 'utf8'));
}

/** 取所有 `type: 'x'`（对象字面量里的判别式）—— 只认单引号形态。 */
function typeLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /type:\s*'([a-z_]+)'/g;
  let m = re.exec(src);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

/** 取所有 `case 'x':` 标签（switch 分支）。 */
function caseLabels(src: string): string[] {
  const out: string[] = [];
  const re = /case\s+'([a-z_]+)'\s*:/g;
  let m = re.exec(src);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(src);
  }
  return out;
}

function uniq(xs: string[]): string[] {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  for (const x of xs) {
    if (!seen[x]) {
      seen[x] = true;
      out.push(x);
    }
  }
  return out.sort();
}

function diff(a: string[], b: string[]): string[] {
  const set: Record<string, boolean> = {};
  for (const x of b) {
    set[x] = true;
  }
  return uniq(a.filter((x) => !set[x]));
}

/**
 * 本地构造台账 —— 这些事件**不由 normalize 生产**，而是 store/页面在本地合成的
 * （乐观行、对账状态、历史重放）。每条形如 `类型: 理由`；新增条目必须能说清"谁生产"。
 */
const LOCAL_ONLY: Record<string, string> = {
  user_sent: 'store.send() 的乐观行（POST 前本地插入）',
  user_ack: 'store 的 REST ack 回执（本地合成）',
  user_fail: 'store 的 POST 失败回执（本地合成）',
  session_running: 'store 的对账/乐观 running（session-tree 只读快照 ⇒ 本地合成事件）',
  history_replaced: 'store 的历史快照合并（loadHistory / mergeTurnData）',
  iterations_loaded: 'store 的分页/详情拉取回填（loadEarlierRegions / fetchIterationDetail）',
  queue_state: 'normalize 的 queue_state（既有）',
};

const typesSrc: string = read('chat_types_full.ts');
const reduceSrc: string = read('reduce.ts');
const normSrc: string = read('normalize.ts');

// DomainEvent 联合：从 `export type DomainEvent` 到文件里下一个顶层 `export`
const unionStart: number = typesSrc.indexOf('export type DomainEvent');
ok('能定位 DomainEvent 联合（静态解析的前提）', unionStart >= 0)
const unionSrc: string = unionStart >= 0 ? typesSrc.slice(unionStart) : ''
const declared: string[] = uniq(typeLiterals(unionSrc))

// reduce 的分支：取 reduceInner 之后的部分（含全部 case）
const innerAt: number = reduceSrc.indexOf('function reduceInner')
const reduceCases: string[] = uniq(caseLabels(innerAt >= 0 ? reduceSrc.slice(innerAt) : ''))
// normalize 的分支与产出
const normCases: string[] = uniq(caseLabels(normSrc))
const normProduces: string[] = uniq(typeLiterals(normSrc))

console.log(`  · DomainEvent 声明 ${declared.length} 种：${declared.join(' ')}`)
console.log(`  · reduce 分支 ${reduceCases.length} 种：${reduceCases.join(' ')}`)

// ── 白绿防线：扫到 0 处必须判红（否则判据空转）──────────────────
// ⛔ 并且**硬钉声明集**（名字 + 数量）：只判"case 存在"无法发现"声明集漂移"
//   （gates-audit 确证：事件类型 15→11 也静默）。新增/删除事件必须同时改这里。
const EXPECTED_TYPES: readonly string[] = [
  'history_replaced', 'iteration', 'iterations_loaded', 'phase_done', 'queue_state',
  'session', 'session_fields', 'session_running', 'stream', 'text_final',
  'turn_started', 'user_ack', 'user_echo', 'user_fail', 'user_sent',
]
ok('C0 声明集指纹与台账逐字一致（新增/删除事件必须同步更新判据）',
  JSON.stringify(declared) === JSON.stringify(EXPECTED_TYPES.slice().sort()),
  `实测 ${declared.length}：${declared.join(' ')} ｜ 期望 ${EXPECTED_TYPES.length}：${EXPECTED_TYPES.slice().sort().join(' ')}`)
ok('C0 扫到了事件类型（非空扫描）', declared.length >= 10, `declared=${declared.length}`)
ok('C0 扫到了 reduce 分支（非空扫描）', reduceCases.length >= 10, `cases=${reduceCases.length}`)

// ── C1 闭包：每个声明的事件都必须被 reduce 处理 ──────────────────
const unhandled: string[] = diff(declared, reduceCases)
ok('C1 每个 DomainEvent 都有 reduce 分支（否则事件被静默忽略）', unhandled.length === 0,
  `缺少分支：${unhandled.join(' ')}`)

// ── C2 来源：每个事件都必须有人生产（normalize 或本地台账）───────
const noProducer: string[] = declared.filter((t) => normProduces.indexOf(t) < 0 && LOCAL_ONLY[t] === undefined)
ok('C2 每个 DomainEvent 都有生产者（normalize 或台账里说明的本地合成）', noProducer.length === 0,
  `无生产者：${noProducer.join(' ')}`)

// ── C3 反孤儿：normalize 产出的事件必须在联合里 ──────────────────
const orphan: string[] = diff(normProduces, declared)
ok('C3 normalize 产出的事件必须在 DomainEvent 联合里', orphan.length === 0,
  `孤儿事件：${orphan.join(' ')}`)

// ── C4 台账卫生：台账里不许残留已不存在的事件（防止台账腐烂成遮羞布）──
const stale: string[] = Object.keys(LOCAL_ONLY).filter((k) => declared.indexOf(k) < 0)
ok('C4 台账里不许有已删除的事件类型（台账必须同步缩短）', stale.length === 0,
  `过期台账项：${stale.join(' ')}`)

// ── C5 normalize 的分支必须都在 DomainEvent 里（有的 case 是别名，如 inject_user）──
// `progress_structured`/`stream_content`/`text` 是**线协议入参**的 case 标签（switch(env.type)），
// 不是产出事件 —— 它们由 `typeLiterals` 的产出侧断言（C3）覆盖，这里显式登记。
const normAlias: Record<string, string> = {
  inject_user: 'user_echo',
  progress_structured: '线协议入参（产出 iteration/phase_done）',
  stream_content: '线协议入参（产出 stream）',
  text: '线协议入参（产出 text_final）',
}
const deadCase: string[] = normCases.filter(
  (t) => declared.indexOf(t) < 0 && normProduces.indexOf(t) < 0 && normAlias[t] === undefined,
)
ok('C5 normalize 的 case 都必须要么产出已知事件、要么是登记过的别名', deadCase.length === 0,
  `可疑分支：${deadCase.join(' ')}`)

process.exit(fail > 0 ? 1 : 0)

/**
 * 设置「llm → 模型推理（思考模式 + 最大并发）」的契约测试。
 *
 * 分两段：
 *  A. **纯逻辑**（显示↔库值映射、并发钳位/回落）—— 用户点名的三类：键映射 / 取值域 / 默认值回落。
 *  B. **端到端契约**（`rpc()` 发出的 body 形状）—— 方法名与参数名写错 ⇒ 服务端 400 / 静默失败。
 *
 * 为什么必须有判别力（全部逐字核对服务端，非猜测）：
 *  1. **键映射（显示↔库）**：思考模式在库内是 `|think|think-max|disabled|enabled` 且
 *     **空串就是 auto**（`channel/setting_keys.go:105`），而界面是 `auto/think/think-max/disabled`。
 *     web 的换算在 `SettingsLLM.tsx:102`（读）与 `:120-121`（写），只有 `think → enabled` 一条别名。
 *     映射错 ⇒ 用户在"思考"档实际写进一个库里不认的值。
 *  2. **`auto` 归一必须由服务端做**：`SetUserThinkingMode` 会把 `"auto"` 折成 `""`
 *     （`agent/llm_config_handler.go:630-632`）。客户端若自己折成空串，就是在复制服务端语义。
 *  3. **参数名**：`set_llm_concurrency` 的字段是 **`personal`**（`rpc_table.go:716`），
 *     不是 `n`/`value`/`concurrency` —— 写错服务端会当零值（严格解码下直接 400）。
 *  4. **取值域**：`max_concurrency` 域 `1-100`、默认 `5`（`setting_keys.go:154`）。
 */
declare const process: { exit: (c: number) => void };

import {
  clampConcurrency, concurrencyFrom, concurrencyStep, isKnownThinkOption, LLM_CONCURRENCY_DEFAULT,
  LLM_CONCURRENCY_MAX, LLM_CONCURRENCY_MIN, thinkDbFromDisplay, thinkDisplayFromDb, thinkHint,
  thinkLabel, THINK_AUTO, THINK_DB_ENABLED, THINK_DISABLED, THINK_OPTIONS, THINK_THINK,
  THINK_THINK_MAX,
} from '../../entry/src/main/ets/core/settings';
import {
  LlmConcurrencyParams, rpc, RPC_GET_LLM_CONCURRENCY, RPC_GET_USER_THINKING_MODE, RpcMethod,
  RPC_SET_LLM_CONCURRENCY, RPC_SET_USER_THINKING_MODE, ThinkingModeParams,
} from '../../entry/src/main/ets/core/rpc';
import { XbotHttp } from '../../entry/src/main/ets/core/http';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}

// ── ① method 名常量（逐个核对 rpc_table.go，非猜测）────────────────────────────

eq('并发 method 字面量', [RPC_GET_LLM_CONCURRENCY, RPC_SET_LLM_CONCURRENCY],
  ['get_llm_concurrency', 'set_llm_concurrency']);
eq('思考模式 method 字面量', [RPC_GET_USER_THINKING_MODE, RPC_SET_USER_THINKING_MODE],
  ['get_user_thinking_mode', 'set_user_thinking_mode']);
eq('静态访问与常量一致',
  [RpcMethod.getLlmConcurrency, RpcMethod.setLlmConcurrency, RpcMethod.getUserThinkingMode,
    RpcMethod.setUserThinkingMode],
  [RPC_GET_LLM_CONCURRENCY, RPC_SET_LLM_CONCURRENCY, RPC_GET_USER_THINKING_MODE,
    RPC_SET_USER_THINKING_MODE]);
ok('四个都进了 RpcMethod.ALL 完整性清单',
  [RPC_GET_LLM_CONCURRENCY, RPC_SET_LLM_CONCURRENCY, RPC_GET_USER_THINKING_MODE,
    RPC_SET_USER_THINKING_MODE].every((m: string) => RpcMethod.ALL.indexOf(m) >= 0));
eq('ALL 无重复', new Set(RpcMethod.ALL).size, RpcMethod.ALL.length);

// ── ② 显示 ↔ 库 映射（web SettingsLLM.tsx:102 / :120-121）───────────────────

eq('库值四档 → 显示', [thinkDisplayFromDb(''), thinkDisplayFromDb('think'),
  thinkDisplayFromDb('think-max'), thinkDisplayFromDb('disabled')],
  ['auto', 'think', 'think-max', 'disabled']);
eq('历史别名 enabled → think', thinkDisplayFromDb('enabled'), 'think');
eq('undefined/空白 → auto（默认值回落）',
  [thinkDisplayFromDb(undefined), thinkDisplayFromDb('   ')], ['auto', 'auto']);
eq('未知值原样透传', thinkDisplayFromDb('weird'), 'weird');

eq('显示 → 待写库：think ⇒ enabled', thinkDbFromDisplay('think'), 'enabled');
eq('显示 → 待写库：auto 原样交给服务端归一', thinkDbFromDisplay('auto'), 'auto');
eq('显示 → 待写库：其余原样', [thinkDbFromDisplay('think-max'), thinkDbFromDisplay('disabled')],
  ['think-max', 'disabled']);
// 往返幂等：display → db → display 必须回到同一个 display
eq('往返幂等（四档）', THINK_OPTIONS.map((d: string) => thinkDisplayFromDb(thinkDbFromDisplay(d))),
  THINK_OPTIONS);
eq('四档顺序 = web THINK_OPTS', THINK_OPTIONS, ['auto', 'think', 'think-max', 'disabled']);
eq('档位中文名', THINK_OPTIONS.map((d: string) => thinkLabel(d)), ['自动', '思考', '最大思考', '关闭']);
ok('四档都有说明', THINK_OPTIONS.every((d: string) => thinkHint(d).length > 0));
eq('已知档判定', [isKnownThinkOption('auto'), isKnownThinkOption('weird')], [true, false]);
eq('库内别名常量', THINK_DB_ENABLED, 'enabled');

// ── ③ 并发钳位 / 回落（域 1-100，默认 5）─────────────────────────────────────

eq('域常量', [LLM_CONCURRENCY_MIN, LLM_CONCURRENCY_MAX, LLM_CONCURRENCY_DEFAULT], [1, 100, 5]);
eq('域内原样', [clampConcurrency(1), clampConcurrency(50), clampConcurrency(100)], [1, 50, 100]);
eq('低于下界 ⇒ 下界', clampConcurrency(0), 1);
eq('负数 ⇒ 下界', clampConcurrency(-7), 1);
eq('高于上界 ⇒ 上界（服务端域 1-100）', clampConcurrency(101), 100);
eq('超大值 ⇒ 上界', clampConcurrency(100000), 100);
eq('非数字 ⇒ 默认', [clampConcurrency(NaN), clampConcurrency(undefined as unknown as number)], [5, 5]);
eq('小数向下取整', clampConcurrency(7.9), 7);

eq('生效值回落：undefined ⇒ 5', concurrencyFrom(undefined), 5);
eq('生效值回落：0 ⇒ 5', concurrencyFrom(0), 5);
eq('生效值回落：负数 ⇒ 5', concurrencyFrom(-3), 5);
eq('生效值：域内原样', concurrencyFrom(12), 12);
eq('生效值：超上界 ⇒ 100', concurrencyFrom(999), 100);

eq('步进：＋1', concurrencyStep(5, 1), 6);
eq('步进：−1', concurrencyStep(5, -1), 4);
eq('步进：下界不再减', [concurrencyStep(1, -1), concurrencyStep(2, -5)], [1, 1]);
eq('步进：上界不再加', [concurrencyStep(100, 1), concurrencyStep(99, 5)], [100, 100]);
eq('步进：起点无效 ⇒ 从默认 5 出发', concurrencyStep(0, 1), 6);

// ── ④ 端到端契约：rpc() 发出的 body 形状 ────────────────────────────────────

const bodies: string[] = [];
function fakeHttp(response: string): XbotHttp {
  const f = {
    post: async (path: string, body: object): Promise<string> => {
      bodies.push(JSON.stringify(body));
      return response;
    },
  };
  return f as unknown as XbotHttp;
}

(async (): Promise<void> => {
  // 读并发：无参（服务端 rpc0）⇒ params 必须是 {}
  await rpc<number>(fakeHttp('5'), RpcMethod.getLlmConcurrency);
  eq('get_llm_concurrency body', bodies[0], '{"method":"get_llm_concurrency","params":{}}');

  // 读思考模式：无参
  await rpc<string>(fakeHttp('"enabled"'), RpcMethod.getUserThinkingMode);
  eq('get_user_thinking_mode body', bodies[1], '{"method":"get_user_thinking_mode","params":{}}');

  // 写并发：字段名必须是 `personal`（rpc_table.go:716）
  await rpc<void>(fakeHttp('{}'), RpcMethod.setLlmConcurrency, new LlmConcurrencyParams(7));
  eq('set_llm_concurrency body（personal）', bodies[2],
    '{"method":"set_llm_concurrency","params":{"personal":7}}');
  eq('LlmConcurrencyParams 键集', Object.keys(JSON.parse(JSON.stringify(new LlmConcurrencyParams(7))) as object),
    ['personal']);

  // 写思考模式：字段名 `mode`；显示值 think 应发出 enabled
  await rpc<void>(fakeHttp('{}'), RpcMethod.setUserThinkingMode,
    new ThinkingModeParams(thinkDbFromDisplay(THINK_THINK)));
  eq('set_user_thinking_mode body（think ⇒ enabled）', bodies[3],
    '{"method":"set_user_thinking_mode","params":{"mode":"enabled"}}');
  eq('ThinkingModeParams 键集', Object.keys(JSON.parse(JSON.stringify(new ThinkingModeParams('x'))) as object),
    ['mode']);

  // 四档写库形状（端到端：显示值 → body）
  const wantModes: string[] = ['auto', 'enabled', 'think-max', 'disabled'];
  for (let i = 0; i < THINK_OPTIONS.length; i++) {
    await rpc<void>(fakeHttp('{}'), RpcMethod.setUserThinkingMode,
      new ThinkingModeParams(thinkDbFromDisplay(THINK_OPTIONS[i])));
    eq(`写库形状 ${THINK_OPTIONS[i]}`, bodies[4 + i],
      `{"method":"set_user_thinking_mode","params":{"mode":"${wantModes[i]}"}}`);
  }

  // 错误必须原样抛出（不能被吞成默认值）
  const failingPost = async (): Promise<string> => {
    throw new Error('settings unavailable');
  };
  const failing = { post: failingPost } as unknown as XbotHttp;
  let threw = '';
  try {
    await rpc<number>(failing, RpcMethod.getLlmConcurrency);
  } catch (e) {
    threw = (e as Error).message;
  }
  eq('错误透传', threw, 'settings unavailable');

  console.log(`\n${fail === 0 ? '✅' : '❌'} settings 推理（思考/并发）契约测试：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();

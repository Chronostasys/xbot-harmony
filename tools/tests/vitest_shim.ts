/**
 * 极小 vitest 垫片 —— 让**逐字移植**过来的 web 测试（vitest 风格）能在本仓的
 * 脱机 TS 测试跑法里直接执行。
 *
 * 为什么值得这么做：web 的状态机测试（2302 行）就是"逻辑一比一"的**判别标准**。
 * 移植测试而不是重写测试，才能证明原生端的状态机与 web 是同一套行为。
 */
export function describe(name: string, fn: () => void): void {
  console.log(`\n▶ ${name}`);
  fn();
}

/** vitest 风格的 it.todo / it.skip（移植用例里可能用到）。 */
function itTodo(_name: string, _fn?: () => void): void {
  // 待办用例：不计入 pass/fail（与 vitest 的 todo 语义一致）
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(it as unknown as { todo: typeof itTodo }).todo = itTodo;

export function it(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
  }
}

export function beforeEach(_fn: () => void): void {
  // 本仓测试不依赖钩子（移植用例里很罕见）
}

export function afterEach(_fn: () => void): void {
}

export let pass = 0;
export let fail = 0;

export function summary(label: string): number {
  if (fail > 0) {
    console.log(`  ${label}: ${pass} passed, ${fail} failed`);
    return 1;
  }
  console.log(`  ${label}: ${pass} passed, 0 failed`);
  return 0;
}

function show(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return false;
  }
  const aa = a as Record<string, unknown>;
  const bb = b as Record<string, unknown>;
  const ka = Object.keys(aa);
  const kb = Object.keys(bb);
  if (ka.length !== kb.length) {
    return false;
  }
  for (let i = 0; i < ka.length; i++) {
    if (!deepEq(aa[ka[i]], bb[ka[i]])) {
      return false;
    }
  }
  return true;
}

class Expectation {
  private neg: boolean = false;
  constructor(private value: unknown, private message?: string) {
  }

  get not(): Expectation {
    const e = new Expectation(this.value, this.message);
    e.neg = !this.neg;
    return e;
  }

  /** 把断言失败信息与调用方自定义 message 串联（移植用例大量带 message）。 */
  private check(ok: boolean, msg: string): void {
    const finalOk = this.neg ? !ok : ok;
    if (!finalOk) {
      const suffix = this.message !== undefined && this.message.length > 0 ? ` — ${this.message}` : '';
      throw new Error(`${this.neg ? 'not ' : ''}${msg}${suffix}`);
    }
  }

  private num(what: string): { v: number; ok: boolean } {
    const v = typeof this.value === 'number' ? this.value : NaN;
    return { v, ok: !Number.isNaN(v) };
  }

  toBe(want: unknown): void {
    this.check(this.value === want, `expected ${show(this.value)} toBe ${show(want)}`);
  }

  toEqual(want: unknown): void {
    this.check(deepEq(this.value, want), `expected ${show(this.value)} toEqual ${show(want)}`);
  }

  toStrictEqual(want: unknown): void {
    this.toEqual(want);
  }

  toContain(want: unknown): void {
    const v = this.value;
    const ok = Array.isArray(v) ? v.indexOf(want) >= 0 : String(v).indexOf(String(want)) >= 0;
    this.check(ok, `expected ${show(v)} toContain ${show(want)}`);
  }

  toHaveLength(n: number): void {
    const v = this.value as { length?: number };
    const len = v !== null && v !== undefined && typeof v.length === 'number' ? v.length : -1;
    this.check(len === n, `expected length ${len} toBe ${n}`);
  }

  toBeNull(): void {
    this.check(this.value === null, `expected ${show(this.value)} toBeNull`);
  }

  toBeUndefined(): void {
    this.check(this.value === undefined, `expected ${show(this.value)} toBeUndefined`);
  }

  toBeDefined(): void {
    this.check(this.value !== undefined, `expected value toBeDefined`);
  }

  toBeTruthy(): void {
    this.check(Boolean(this.value), `expected ${show(this.value)} toBeTruthy`);
  }

  toBeFalsy(): void {
    this.check(!this.value, `expected ${show(this.value)} toBeFalsy`);
  }

  toBeGreaterThan(n: number): void {
    const { v, ok } = this.num('toBeGreaterThan');
    this.check(ok && v > n, `expected ${show(this.value)} toBeGreaterThan ${n}`);
  }

  toBeGreaterThanOrEqual(n: number): void {
    const { v, ok } = this.num('toBeGreaterThanOrEqual');
    this.check(ok && v >= n, `expected ${show(this.value)} toBeGreaterThanOrEqual ${n}`);
  }

  toBeLessThan(n: number): void {
    const { v, ok } = this.num('toBeLessThan');
    this.check(ok && v < n, `expected ${show(this.value)} toBeLessThan ${n}`);
  }

  toBeLessThanOrEqual(n: number): void {
    const { v, ok } = this.num('toBeLessThanOrEqual');
    this.check(ok && v <= n, `expected ${show(this.value)} toBeLessThanOrEqual ${n}`);
  }

  toMatch(re: RegExp | string): void {
    const s = String(this.value);
    const ok = re instanceof RegExp ? re.test(s) : s.indexOf(re) >= 0;
    this.check(ok, `expected ${show(this.value)} toMatch ${show(re)}`);
  }

  toHaveProperty(key: string, want?: unknown): void {
    const v = this.value as Record<string, unknown> | null;
    const has = v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, key);
    if (want === undefined) {
      this.check(has, `expected value toHaveProperty ${key}`);
      return;
    }
    this.check(has && deepEq((v as Record<string, unknown>)[key], want),
      `expected property ${key} to be ${show(want)}`);
  }

  toThrow(): void {
    let threw = false;
    try {
      (this.value as () => void)();
    } catch (e) {
      threw = true;
    }
    this.check(threw, 'expected function toThrow');
  }
}

/** vitest 的 expect（兼容移植用例里的 `expect(value, message)` 两参形式）。 */
export function expect(value: unknown, message?: string): Expectation {
  return new Expectation(value, message);
}

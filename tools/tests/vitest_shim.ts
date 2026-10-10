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
  constructor(private value: unknown) {
  }

  get not(): Expectation {
    const e = new Expectation(this.value);
    e.neg = !this.neg;
    return e;
  }

  private check(ok: boolean, msg: string): void {
    const finalOk = this.neg ? !ok : ok;
    if (!finalOk) {
      throw new Error(`${this.neg ? 'not ' : ''}${msg}`);
    }
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

export function expect(value: unknown): Expectation {
  return new Expectation(value);
}

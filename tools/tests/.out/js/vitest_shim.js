"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fail = exports.pass = void 0;
exports.describe = describe;
exports.it = it;
exports.beforeEach = beforeEach;
exports.afterEach = afterEach;
exports.summary = summary;
exports.expect = expect;
/**
 * 极小 vitest 垫片 —— 让**逐字移植**过来的 web 测试（vitest 风格）能在本仓的
 * 脱机 TS 测试跑法里直接执行。
 *
 * 为什么值得这么做：web 的状态机测试（2302 行）就是"逻辑一比一"的**判别标准**。
 * 移植测试而不是重写测试，才能证明原生端的状态机与 web 是同一套行为。
 */
function describe(name, fn) {
    console.log(`\n▶ ${name}`);
    fn();
}
/** vitest 风格的 it.todo / it.skip（移植用例里可能用到）。 */
function itTodo(_name, _fn) {
    // 待办用例：不计入 pass/fail（与 vitest 的 todo 语义一致）
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;
it.todo = itTodo;
function it(name, fn) {
    try {
        fn();
        exports.pass++;
    }
    catch (e) {
        exports.fail++;
        console.log(`  ✗ ${name}\n      ${e.message}`);
    }
}
function beforeEach(_fn) {
    // 本仓测试不依赖钩子（移植用例里很罕见）
}
function afterEach(_fn) {
}
exports.pass = 0;
exports.fail = 0;
function summary(label) {
    if (exports.fail > 0) {
        console.log(`  ${label}: ${exports.pass} passed, ${exports.fail} failed`);
        return 1;
    }
    console.log(`  ${label}: ${exports.pass} passed, 0 failed`);
    return 0;
}
function show(v) {
    try {
        return JSON.stringify(v);
    }
    catch (e) {
        return String(v);
    }
}
function deepEq(a, b) {
    if (a === b) {
        return true;
    }
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        return false;
    }
    const aa = a;
    const bb = b;
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
    constructor(value, message) {
        this.value = value;
        this.message = message;
        this.neg = false;
    }
    get not() {
        const e = new Expectation(this.value, this.message);
        e.neg = !this.neg;
        return e;
    }
    /** 把断言失败信息与调用方自定义 message 串联（移植用例大量带 message）。 */
    check(ok, msg) {
        const finalOk = this.neg ? !ok : ok;
        if (!finalOk) {
            const suffix = this.message !== undefined && this.message.length > 0 ? ` — ${this.message}` : '';
            throw new Error(`${this.neg ? 'not ' : ''}${msg}${suffix}`);
        }
    }
    num(what) {
        const v = typeof this.value === 'number' ? this.value : NaN;
        return { v, ok: !Number.isNaN(v) };
    }
    toBe(want) {
        this.check(this.value === want, `expected ${show(this.value)} toBe ${show(want)}`);
    }
    toEqual(want) {
        this.check(deepEq(this.value, want), `expected ${show(this.value)} toEqual ${show(want)}`);
    }
    toStrictEqual(want) {
        this.toEqual(want);
    }
    toContain(want) {
        const v = this.value;
        const ok = Array.isArray(v) ? v.indexOf(want) >= 0 : String(v).indexOf(String(want)) >= 0;
        this.check(ok, `expected ${show(v)} toContain ${show(want)}`);
    }
    toHaveLength(n) {
        const v = this.value;
        const len = v !== null && v !== undefined && typeof v.length === 'number' ? v.length : -1;
        this.check(len === n, `expected length ${len} toBe ${n}`);
    }
    toBeNull() {
        this.check(this.value === null, `expected ${show(this.value)} toBeNull`);
    }
    toBeUndefined() {
        this.check(this.value === undefined, `expected ${show(this.value)} toBeUndefined`);
    }
    toBeDefined() {
        this.check(this.value !== undefined, `expected value toBeDefined`);
    }
    toBeTruthy() {
        this.check(Boolean(this.value), `expected ${show(this.value)} toBeTruthy`);
    }
    toBeFalsy() {
        this.check(!this.value, `expected ${show(this.value)} toBeFalsy`);
    }
    toBeGreaterThan(n) {
        const { v, ok } = this.num('toBeGreaterThan');
        this.check(ok && v > n, `expected ${show(this.value)} toBeGreaterThan ${n}`);
    }
    toBeGreaterThanOrEqual(n) {
        const { v, ok } = this.num('toBeGreaterThanOrEqual');
        this.check(ok && v >= n, `expected ${show(this.value)} toBeGreaterThanOrEqual ${n}`);
    }
    toBeLessThan(n) {
        const { v, ok } = this.num('toBeLessThan');
        this.check(ok && v < n, `expected ${show(this.value)} toBeLessThan ${n}`);
    }
    toBeLessThanOrEqual(n) {
        const { v, ok } = this.num('toBeLessThanOrEqual');
        this.check(ok && v <= n, `expected ${show(this.value)} toBeLessThanOrEqual ${n}`);
    }
    toMatch(re) {
        const s = String(this.value);
        const ok = re instanceof RegExp ? re.test(s) : s.indexOf(re) >= 0;
        this.check(ok, `expected ${show(this.value)} toMatch ${show(re)}`);
    }
    toHaveProperty(key, want) {
        const v = this.value;
        const has = v !== null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, key);
        if (want === undefined) {
            this.check(has, `expected value toHaveProperty ${key}`);
            return;
        }
        this.check(has && deepEq(v[key], want), `expected property ${key} to be ${show(want)}`);
    }
    toThrow() {
        let threw = false;
        try {
            this.value();
        }
        catch (e) {
            threw = true;
        }
        this.check(threw, 'expected function toThrow');
    }
}
/** vitest 的 expect（兼容移植用例里的 `expect(value, message)` 两参形式）。 */
function expect(value, message) {
    return new Expectation(value, message);
}

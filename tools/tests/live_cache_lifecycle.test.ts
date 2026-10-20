/**
 * live 行缓存的**生命周期**判据（用户 2026-10-20：思考中卡住与客户端缓存有关）。
 *
 * `rowCache` 以行 id 为 key；live 行 id 会跨 turn/迭代复用（缺 turn id 时 `turn-0-live`）。
 * 若缓存只按 id 命中，新迭代会拿到旧 ChatRow，`appliedRowByRow` 误判未变化，reasoning
 * 永远不落行 ⇒ 页面停在「思考中…」。缓存必须有 turn/iteration 生命周期键。
 */
declare const require: (m: string) => any;
declare const process: { cwd: () => string; exit: (c: number) => void };
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
const src = fs.readFileSync(path.join(process.cwd(), 'entry/src/main/ets/core/store.ets'), 'utf8');
const rbStart = src.indexOf('private rebuildRows(): void {');
const rbEnd = src.indexOf('  /** 清空行缓存', rbStart);
const rb = rbStart >= 0 && rbEnd > rbStart ? src.substring(rbStart, rbEnd) : '';

ok('存在 liveCacheKey 生命周期键', /private liveCacheKey: string/.test(src));
ok('重建时按 state.turns.size/turnID/lastIter 计算 key',
  /state\.turns\.size[\s\S]{0,120}dr\.turnID[\s\S]{0,120}dr\.lastIter/.test(rb));
ok('key 变化时失效旧 live 行缓存',
  /liveCacheKey !== this\.liveCacheKey[\s\S]{0,200}invalidateLiveRowCache\(\)/.test(rb));
ok('invalidateLiveRowCache 只删 isLive 行', /r\.isLive[\s\S]{0,120}rowCache\.delete/.test(src));
ok('history 重载使 live 缓存失效', /this\.liveCacheKey = ''[\s\S]{0,120}this\.invalidateLiveRowCache\(\)/.test(src));
console.log(`live_cache_lifecycle: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

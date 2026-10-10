"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rowdiff_1 = require("./rowdiff");
const types_1 = require("./types");
let pass = 0, fail = 0;
function ok(name, cond) {
    if (cond) {
        pass++;
    }
    else {
        fail++;
        console.log('  x ' + name);
    }
}
function row(id, rev) {
    const r = new types_1.ChatRow();
    r.id = id;
    r.rev = rev;
    r.role = 'assistant';
    return r;
}
// ── ① 键：两个会话里**同形**的行（id/rev 逐字相同）必须得到不同的 LazyForEach 键 ──
const a = row('live-1', 1), b = row('live-1', 1);
ok('判别前提：裸 rowKey 同形必碰撞（说明为何必须加会话维度）', (0, rowdiff_1.rowKey)(a) === (0, rowdiff_1.rowKey)(b));
ok('会话作用域键：同形行跨会话必须不同', (0, rowdiff_1.sessionScopedRowKey)('A', a) !== (0, rowdiff_1.sessionScopedRowKey)('B', b));
ok('会话作用域键：同会话内仍随 rev 变化（不能反向失效）', (0, rowdiff_1.sessionScopedRowKey)('A', row('live-1', 1)) !== (0, rowdiff_1.sessionScopedRowKey)('A', row('live-1', 2)));
// ── ② 指纹：两个会话同形 rows 必须得到不同指纹（旧实现只由 id#rev 组成 => 相等 => 切会话不刷新）──
const shape = [row('u-1', 1), row('a-2', 1)];
ok('行指纹：同形 rows 跨会话必须不同', (0, rowdiff_1.rowsFpOf)(shape, 'A') !== (0, rowdiff_1.rowsFpOf)(shape, 'B'));
ok('行指纹：同会话内内容变化必须不同', (0, rowdiff_1.rowsFpOf)([row('u-1', 1)], 'A') !== (0, rowdiff_1.rowsFpOf)([row('u-1', 2)], 'A'));
ok('行指纹：同会话内内容相同必须相同（不多余重投影）', (0, rowdiff_1.rowsFpOf)(shape, 'A') === (0, rowdiff_1.rowsFpOf)([row('u-1', 1), row('a-2', 1)], 'A'));
// ── ③ 骨架重建判据（最致命一处）：同 id 序列 + 换会话 => 必须整表重建 ──
ok('骨架重建：同 id 序列但换会话 => 必须 reload（旧实现返回 false => 零通知 => 显示上个会话）', (0, rowdiff_1.needsFullReload)(shape, [row('u-1', 1), row('a-2', 1)], 'A', 'B') === true);
ok('骨架重建：同会话同 id 序列 => 不整表重建（保留滚动锚点）', (0, rowdiff_1.needsFullReload)(shape, [row('u-1', 1), row('a-2', 1)], 'A', 'A') === false);
ok('骨架重建：同会话 id 序列变了 => 必须 reload', (0, rowdiff_1.needsFullReload)(shape, [row('u-1', 1)], 'A', 'A') === true);
// ── ④ 身份变化判据 ──
ok('身份变化：不同 => true', (0, rowdiff_1.identityChanged)('A', 'B') === true);
ok('身份变化：相同 => false', (0, rowdiff_1.identityChanged)('A', 'A') === false);
ok('身份变化：空 -> 首个会话 => true', (0, rowdiff_1.identityChanged)('', 'A') === true);
console.log('session_identity: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
    process.exit(1);
}

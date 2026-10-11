/**
 * 抽屉性能热点契约（`pages/Index.ets` 的 `drawerGroups` 一族；contrast-ux 从 faultlog 定位的 6s 阻塞嫌疑点）。
 *
 * 改前的复杂度形状（评审要钉住的就是"形状"）：
 *   · `drawerGroups` 对**每个分组项**调一次 `sessionById`（**线性扫描**）⇒ **O(n²)**；
 *   · 每帧调 `starredIds()` **两次**（`filteredSessions` 内一次 + 这里一次），而它是
 *     `parseStarred(settingOf(...))` = **每次 JSON 解析**；
 *   · 重名消歧是**双层循环** ⇒ O(g²)。
 * 改后：`sessionIndex()`（O(n) 建一次、**首命中优先**）+ `starred` 只算一次 + `titleCount` 计数 O(g)。
 * ⛔ 行为必须**逐字不变**（同输入 ⇒ 同分组/排序/消歧）。
 *
 * mutation 自证（必红）：在分组循环里重新写 `this.sessionById(this.sessions[i].chat_id)` ⇒ ★①②⑤ 红；
 *   把 `starred` 传参去掉、改回 `this.filteredSessions()` ⇒ ★② 红。
 *
 * ⚠️ 结尾必须 `process.exit(...)`（`run.sh` 用 `set -e` 顺序跑）。
 */
declare const process: { exit: (c: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
export {};

/**
 * **剥注释**（本仓约定：注释里记代码片段/色值是**允许且鼓励**的 ⇒ 判据扫源码前**必须**先剥，
 * 否则两个方向都会错：禁串被注释提及 ⇒ **假红**；要求串只在注释里出现 ⇒ **假绿**）。
 * ⚠️ 保留换行（不压行）⇒ 行号不漂移（本仓已入库 GOTCHA）。
 */
function stripSrc(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m: string) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m: string, p: string) => p + ' '.repeat(m.length - p.length));
}


let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: string): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? `\n      ${extra}` : ''}`); }
}
const fsMod = require('fs');
const pathMod = require('path');
let repo = '';
for (const up of ['../..', '../../..', '../../../..']) {
  const cand = pathMod.resolve(__dirname, up);
  if (fsMod.existsSync(pathMod.join(cand, 'entry/src/main/ets/pages/Index.ets'))) { repo = cand; break; }
}
ok('探测到仓库根', repo.length > 0);

if (repo.length > 0) {
  const src: string = stripSrc(fsMod.readFileSync(pathMod.join(repo, 'entry/src/main/ets/pages/Index.ets'), 'utf-8'));
  const body = (name: string): string => {
    const i: number = src.indexOf(`private ${name}(`);
    return i < 0 ? '' : src.substring(i, src.indexOf('\n  }', i));
  };
  const draw: string = body('drawerGroups');
  const idx: string = body('sessionIndex');
  ok('drawerGroups 可定位', draw.length > 200);
  ok('sessionIndex 可定位', idx.length > 80);

  // ── ★① O(n²) 形状消失：分组循环里不再线性回查 ─────────────────────────────────
  ok('★① drawerGroups 内**无** `this.sessionById(` 调用（O(n²) 形状已除）', draw.indexOf('this.sessionById(') < 0);
  ok('  · 改用预建索引 `idx.get(`', draw.indexOf('idx.get(') >= 0);
  ok('  · 索引每帧**只建一次**（`const idx = this.sessionIndex()` 恰 1 处）',
    (draw.match(/this\.sessionIndex\(\)/g) || []).length === 1);

  // ── ★② `starredIds()` 每帧只算一次（它是 JSON 解析）─────────────────────────────
  ok('★② drawerGroups 内 `this.starredIds()` 恰 1 处（原 2 处：filteredSessions 内 + 这里）',
    (draw.match(/this\.starredIds\(\)/g) || []).length === 1);
  ok('  · 且把 starred **传参**给 filteredSessions（`this.filteredSessions(starred)`）',
    draw.indexOf('this.filteredSessions(starred)') >= 0);
  ok('  · `filteredSessions` 接受可选入参（签名含 `starredIn?: string[]`）',
    src.indexOf('private filteredSessions(starredIn?: string[]): SessionItem[]') >= 0);
  ok('  · 缺省时仍自行计算（其余调用点行为不变）', body('filteredSessions').indexOf('starredIn !== undefined ? starredIn : this.starredIds()') >= 0);

  // ── ★③ 等价性：索引**首命中优先**（与线性扫描同取首个 ⇒ 重复 id 时逐字等价）────────
  ok('★③ sessionIndex 首命中优先（`!idx.has(` 才 set）', idx.indexOf('!idx.has(') >= 0);

  // ── ★④ 消歧 O(g²) → O(g) ────────────────────────────────────────────────────
  ok('★④ drawerGroups 内**无** O(g²) 消歧（不再有 `out[j].title === out[i].title`）',
    draw.indexOf('out[j].title === out[i].title') < 0);
  ok('  · 改用 `titleCount` 计数（>1 即重名）', draw.indexOf('titleCount') >= 0);

  // ── ★⑤ 调用点计数（静态）：全文件 `this.sessionById(` 调用点 = 0（方法已删）──────────
  ok('★⑤ 全文件 `this.sessionById(` 调用点 = 0（死代码已删，只剩注释）',
    (src.match(/this\.sessionById\(/g) || []).length === 0);
}

// ── 剥注释的**判别力自证**（防"剥注释把扫描也剥没了"这类白绿）────────────────────────
{
  ok('判别力：**注释里**的禁串被剥掉（不误红）',
    stripSrc('// .fontColor([this.pal().textMuted])').indexOf('.fontColor(') < 0);
  ok('判别力：**代码里**的同一串仍在（不误绿）',
    stripSrc('const a = 1; .fontColor([this.pal().textMuted])').indexOf('.fontColor(') >= 0);
  ok('判别力：剥注释**保留换行**（行号不漂移）',
    stripSrc('a\n// x\nb').split('\n').length === 3);
}

if (fail > 0) { console.log(`  drawer_hotpath: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  drawer_hotpath: ${pass} passed, 0 failed`);
process.exit(0);

/**
 * 测试进程的 **文件读取缓存**（供 `-r` 预加载）。
 *
 * 为什么（实测）：全量 428 个测试里有几十个是"静态扫描"——每个都 `readFileSync` 一遍
 * `pages/Index.ets`（≈354KB）再做正则；重复读同一个大文件是纯浪费（OS 缓存也救不了 JS 字符串
 * 解码与拷贝）。这里把**仓库内只读文件**的读取结果 memo 住，跨测试复用。
 *
 * ⛔ 安全性：
 *   · 只缓存 `readFileSync` 的**字符串/JSON**结果，且**不缓存** `/tmp`、不缓存可变路径；
 *   · `writeFileSync` / `unlinkSync` / `renameSync` 命中同一路径 ⇒ **立刻失效**该键；
 *   · 默认只对 `entry/`、`tools/tests/`（源码/夹具）生效；其它路径走原生实现。
 */
const fs = require('fs');
const path = require('path');

const CACHEABLE_PREFIXES = ['/entry/', '/tools/typecheck/', '/tools/tests/'];
const cache = new Map();

const origRead = fs.readFileSync;
const origWrite = fs.writeFileSync;
const origUnlink = fs.unlinkSync;
const origRename = fs.renameSync;

function keyOf(p, enc) {
  return `${p}::${enc === undefined ? '(buffer)' : enc}`;
}
function cacheable(p) {
  if (typeof p !== 'string') return false;
  if (!path.isAbsolute(p)) return false;
  return CACHEABLE_PREFIXES.some((pre) => p.includes(pre)) && !p.includes('.build-cache');
}
function invalidate(p) {
  if (typeof p !== 'string') return;
  for (const k of cache.keys()) {
    if (k.startsWith(`${p}::`)) cache.delete(k);
  }
}

fs.readFileSync = function patchedRead(p, enc) {
  // 只缓存"文本/JSON"读取（Buffer 读取保持原样，避免可变对象被共享后篡改）
  const isText = enc === 'utf8' || enc === 'utf-8' || enc === 'latin1' || enc === 'ascii';
  if (!isText || !cacheable(p)) return origRead.apply(fs, arguments);
  const k = keyOf(p, enc);
  if (cache.has(k)) return cache.get(k);
  const v = origRead.apply(fs, arguments);
  cache.set(k, v);
  return v;
};

fs.writeFileSync = function patchedWrite(p) {
  invalidate(p);
  return origWrite.apply(fs, arguments);
};
fs.unlinkSync = function patchedUnlink(p) {
  invalidate(p);
  return origUnlink.apply(fs, arguments);
};
fs.renameSync = function patchedRename(a, b) {
  invalidate(a);
  invalidate(b);
  return origRename.apply(fs, arguments);
};

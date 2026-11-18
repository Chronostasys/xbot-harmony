#!/usr/bin/env node
/**
 * 全量测试执行器：**分批并行（进程内）+ 真隔离 + 增量缓存 + 预算**。
 *
 * 实测教训（本机，2026-11-08）：
 *   · 一测一进程：428 次 node 启动 ≈ 30–38s（机器 load 高时更慢）⇒ 达不到 20s；
 *   · 进程内批量：单进程跑完 428 个 ≈ 17s，但**共享模块状态串味** ⇒ 曾假红 91 个；
 *   · 修法：**每测前清空 dir 下全部模块缓存**（真隔离），再把测试切成 N 批并行。
 *
 * 模式：
 *   · 默认（主控）：算增量签名 → 切批 → 并行 spawn 自己（`--run-manifest`）→ 汇总 → 预算判定；
 *   · `--run-manifest <file>`（worker）：进程内按清单顺序跑，每测前清缓存。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dir = process.argv[2];
const budgetMs = Number(process.env.XBOT_TEST_BUDGET_MS || 20000);
const jobs = Number(process.env.XBOT_TEST_JOBS || 8);
const manifestArg = process.argv.includes('--run-manifest')
  ? process.argv[process.argv.indexOf('--run-manifest') + 1]
  : '';

if (!dir || !fs.existsSync(dir)) {
  console.error(`❌ 测试产物目录不存在: ${dir}`);
  process.exit(2);
}

// ── worker ────────────────────────────────────────────────────────────────────
if (manifestArg.length > 0) {
  const mine = JSON.parse(fs.readFileSync(manifestArg, 'utf8')).map((n) => `${n}.test.js`);
  const origExit = process.exit.bind(process);
  process.exit = (code) => {
    const err = new Error('__XBOT_TEST_EXIT__');
    err.__code = typeof code === 'number' ? code : 0;
    throw err;
  };
  let failed = 0;
  for (const f of mine) {
    const name = f.replace(/\.test\.js$/, '');
    // ⛔ 真隔离：清掉 dir 下**全部**模块缓存（共享模块的模块级状态会串味）
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(dir)) {
        delete require.cache[key];
      }
    }
    try {
      require(path.join(dir, f));
    } catch (e) {
      if (e && String(e.message) === '__XBOT_TEST_EXIT__') {
        if (e.__code !== 0) {
          failed++;
          console.log(`❌ ${name}（exit ${e.__code}）`);
        }
      } else {
        failed++;
        console.log(`❌ ${name}（crash: ${e && e.message ? e.message : e}）`);
      }
    }
  }
  process.exit = origExit;
  origExit(failed > 0 ? 1 : 0);
}

// ── 主控 ──────────────────────────────────────────────────────────────────────
const base = path.dirname(dir);
const repoRoot = path.resolve(base, '..', '..', '..');
const cacheFile = path.join(base, 'results.json');
const decorators = path.join(base, 'js', '__decorators.js');
const fsCache = path.join(repoRoot, 'tools', 'tests', 'fs_cache.js');

let prev = {};
try {
  prev = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
} catch (e) {
  prev = {};
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();

function sigOf(file) {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}`;
  } catch (e) {
    return 'missing';
  }
}
function depsClosure(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length > 0) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let src = '';
    try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const re = /require\("(\.[^"]+)"\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const p = path.resolve(path.dirname(f), m[1]);
      let target = p.endsWith('.js') ? p : `${p}.js`;
      if (!fs.existsSync(target)) target = path.join(p, 'index.js');
      if (fs.existsSync(target)) stack.push(target);
    }
  }
  return Array.from(seen);
}
function sigFor(file) {
  return depsClosure(file).sort().map((d) => `${path.basename(d)}:${sigOf(d)}`).join('|');
}

const started = Date.now();
const results = {};
const dirty = [];
for (const f of files) {
  const name = f.replace(/\.test\.js$/, '');
  const sig = sigFor(path.join(dir, f));
  const old = prev[name];
  if (old && old.ok === true && old.sig === sig) {
    results[name] = old;
  } else {
    dirty.push(name);
  }
}

const failed = [];
/**
 * 批内假红兜底：批处理里**共享全局状态**（AppStorage/globalThis）无法 100% 清干净，
 * 极少数测试会互相串味。对失败项**逐个在独立进程里重跑**：
 *   · 重跑通过 ⇒ 判为"批内串味"，从失败列表移除（并打印 RETRY-PASS 便于审计）；
 *   · 重跑仍红 ⇒ 真失败。
 * 这样既保住 8s 级的全量速度，又不会把"隔离问题"误报成"代码坏了"。
 */
function retryFailed(done) {
  if (failed.length === 0) {
    done();
    return;
  }
  const queue = failed.slice();
  const still = [];
  let i = 0;
  const nextOne = () => {
    if (i >= queue.length) {
      failed.length = 0;
      for (const n of still) {
        failed.push(n);
      }
      done();
      return;
    }
    const name = queue[i++];
    let out = '';
    const child = spawn(process.execPath, ['-r', fsCache, '-r', decorators, path.join(dir, `${name}.test.js`)], {
      stdio: ['ignore', 'pipe', 'pipe'], cwd: repoRoot,
    });
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`↻ ${name}: 批内串味（隔离重跑通过）`);
      } else {
        still.push(name);
        const tail = out.trimEnd().split('\n').slice(-4).join('\n');
        if (tail.length > 0) console.log(tail.split('\n').map((l) => `     ${l}`).join('\n'));
      }
      nextOne();
    });
  };
  nextOne();
}

function finish() {
  try { fs.writeFileSync(cacheFile, JSON.stringify(results)); } catch (e) { /* ignore */ }
  const ms = Date.now() - started;
  console.log('');
  console.log(`共 ${files.length} 个测试文件（本次执行 ${dirty.length} / 沿用 ${files.length - dirty.length}），` +
    `${failed.length} 个失败（耗时 ${ms}ms / 预算 ${budgetMs}ms）`);
  if (failed.length > 0) console.log(`失败测试：${failed.join(', ')}`);
  if (ms > budgetMs) {
    console.log(`❌ 超过预算：${ms}ms > ${budgetMs}ms`);
    process.exit(1);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

if (dirty.length === 0) {
  finish();
} else {
  const slices = Math.max(1, Math.min(jobs, dirty.length));
  const buckets = Array.from({ length: slices }, () => []);
  dirty.forEach((name, i) => buckets[i % slices].push(name));

  let pending = slices;
  for (let k = 0; k < slices; k++) {
    const manifest = path.join(base, `.slice-${k}.json`);
    fs.writeFileSync(manifest, JSON.stringify(buckets[k]));
    const child = spawn(
      process.execPath,
      ['-r', fsCache, '-r', decorators, __filename, dir, '--run-manifest', manifest],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: repoRoot },
    );
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', () => {
      pending--;
      for (const line of out.split('\n')) {
        const m = line.match(/^❌ (\S+)（/);
        if (m !== null) {
          failed.push(m[1]);
        }
      }
      if (out.trim().length > 0) {
        process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
      }
      try { fs.unlinkSync(manifest); } catch (e) { /* ignore */ }
      if (pending === 0) {
        retryFailed(() => {
          for (const name of dirty) {
            const ok = !failed.includes(name);
            results[name] = { ok, sig: sigFor(path.join(dir, `${name}.test.js`)) };
          }
          finish();
        });
      }
    });
  }
}

declare const process: { cwd: () => string; exit: (c: number) => void };
declare const require: (m: string) => any;
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
import { setLocale, t } from '../../entry/src/main/ets/core/i18n';

function raw(rel: string): string {
  const p = path.join(process.cwd(), rel);
  try { return cp.execFileSync('cat', [p], { encoding: 'utf8' }); } catch (e) { return ''; }
}
const files: string[] = [];
function addDir(d: string): void {
  let ents: any[] = [];
  try { ents = fs.readdirSync(path.join(process.cwd(), d), { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.isDirectory()) addDir(d + '/' + e.name);
    else if (e.name.endsWith('.ets')) files.push(d + '/' + e.name);
  }
}
addDir('entry/src/main/ets/components');
addDir('entry/src/main/ets/pages');
const lits = new Map<string, string>();
for (const f of files) {
  const s = raw(f);
  const re = /i18nT\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  let m = re.exec(s);
  while (m !== null) {
    const lit = m[2];
    if (/[\u4e00-\u9fff]/.test(lit) && !lits.has(lit)) lits.set(lit, f);
    m = re.exec(s);
  }
}
const missingEn: string[] = [];
const missingJa: string[] = [];
// 日文与中文同形的合法词（不是未翻译）。
const JA_SAME_OK = new Set<string>(['保存', '更新', '保存中…', '管理', '内容', '停止']);
for (const lit of lits.keys()) {
  setLocale('en');
  const en = t(lit);
  setLocale('ja');
  const ja = t(lit);
  if (en === lit) missingEn.push(lit);
  if (ja === lit && !JA_SAME_OK.has(lit)) missingJa.push(lit);
}
setLocale('zh-CN');

// ── 原始 UI 文案扫描（简单字符串；模板/错误日志另由人工覆盖）──
const rawUi: string[] = [];
for (const f of files) {
  const src = raw(f);
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const ls = clean.split('\n');
  for (let i = 0; i < ls.length; i++) {
    const st = ls[i].trim();
    const isUi = ['Text(', 'placeholder:', 'accessibilityText(', 'Label('].some((k) => st.indexOf(k) >= 0);
    const wrapperName = 'i18n' + 'T(';
    const notifName = 'tNotification(';
    const wrapped = st.indexOf(wrapperName) >= 0 || st.indexOf(notifName) >= 0 || st.indexOf('`') >= 0;
    if (isUi && !wrapped && /[\u4e00-\u9fff]/.test(st)) rawUi.push(`${f}:${i + 1}: ${st}`);
  }
}
console.log(`i18n scan: ${lits.size} literals; missing en=${missingEn.length} ja=${missingJa.length}; raw simple UI=${rawUi.length}`);
for (const s of missingEn) console.log('EN  ' + s);
for (const s of missingJa) console.log('JA  ' + s);
for (const s of rawUi.slice(0, 40)) console.log('RAW ' + s);
if (lits.size < 300) { console.log('i18n scan: 零扫描防线失败（i18nT 字面量过少）'); process.exit(1); }
if (missingEn.length > 0 || missingJa.length > 0 || rawUi.length > 0) process.exit(1);
process.exit(0);

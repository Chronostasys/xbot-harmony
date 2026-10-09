/**
 * 表格布局判定测试（"渲染错乱"的一类真凶，必须有守护）。
 *
 * 背景（真实数据实测）：会话里存在 5/7/8 列宽表格，而等宽网格在手机上会把每列压成
 * ~40dp 的竖条 ⇒ 完全不可读。因此**列数 > 4 必须改用堆叠形态**。
 */
declare const process: { exit: (c: number) => void };

import { useTableGrid, tableRowFields, TABLE_GRID_MAX_COLS, TableField } from '../../entry/src/main/ets/core/markdown';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name}`); }
}
function eq(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// 阈值：≤4 列用网格，≥5 列用堆叠
ok('阈值常量 = 4', TABLE_GRID_MAX_COLS === 4);
ok('2 列 → 网格', useTableGrid(2));
ok('4 列 → 网格', useTableGrid(4));
ok('5 列 → 堆叠', !useTableGrid(5));
ok('7 列 → 堆叠', !useTableGrid(7));
ok('8 列 → 堆叠', !useTableGrid(8));
ok('0 列 → 堆叠（不渲染表头网格）', !useTableGrid(0));

// 字段配对
const hdr = ['#', 'tenant', '渠道', '会话名', '显示名', '主库里有多少', '会话库', '备注'];
const row = ['1', 'adm', 'web', 'chat_X', '演示', '3', '3', ''];
const f: TableField[] = tableRowFields(hdr, row);
eq('字段数 = max(header,row)', f.length, 8);
eq('首个字段 label', f[0].label, '#');
eq('末个字段 label', f[7].label, '备注');
eq('值逐项对齐', f.map((x) => x.value), row);

// 表头缺失 → 显式回落 列N（不留空）
const f2 = tableRowFields([], ['a', 'b']);
eq('无表头时回落 列N', f2.map((x) => x.label), ['列1', '列2']);
eq('无表头时不丢值', f2.map((x) => x.value), ['a', 'b']);

// 单元格少于表头 → 补空串（不丢字段名）
const f3 = tableRowFields(['甲', '乙', '丙'], ['x']);
eq('短行补空值', f3.map((x) => x.value), ['x', '', '']);
eq('短行保留全部表头', f3.map((x) => x.label), ['甲', '乙', '丙']);

// 单元格多于表头 → 用 列N 兜底（不丢数据）
const f4 = tableRowFields(['甲'], ['x', 'y']);
eq('长行兜底 label', f4.map((x) => x.label), ['甲', '列2']);
eq('长行不丢数据', f4.map((x) => x.value), ['x', 'y']);

// 空白表头项也回落
const f5 = tableRowFields(['', '乙'], ['x', 'y']);
eq('空表头回落 列1', f5[0].label, '列1');

if (fail > 0) { console.log(`  table_layout: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`  table_layout: ${pass} passed, 0 failed`);

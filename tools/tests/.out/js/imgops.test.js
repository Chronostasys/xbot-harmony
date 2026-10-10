"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const imgops_1 = require("./imgops");
let pass = 0, fail = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) {
        pass++;
    }
    else {
        fail++;
        console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
    }
}
eq('下界', (0, imgops_1.minScale)(), 0.5);
eq('上界', (0, imgops_1.maxScale)(), 6);
eq('夹取下界', (0, imgops_1.clampScale)(0.1), 0.5);
eq('夹取上界', (0, imgops_1.clampScale)(99), 6);
eq('正常保留', (0, imgops_1.clampScale)(2.5), 2.5);
eq('NaN 回落 1', (0, imgops_1.clampScale)(Number.NaN), 1);
eq('0/负数回落 1', (0, imgops_1.clampScale)(0), 1);
eq('未放大双击放大', (0, imgops_1.nextZoom)(1), 2.5);
eq('已放大双击复位', (0, imgops_1.nextZoom)(2.5), 1);
eq('接近 1 也算未放大', (0, imgops_1.nextZoom)(1.005), 2.5);
eq('未放大不许平移', (0, imgops_1.panLimit)(1, 400, 1000), 0);
eq('放大后可平移（(1000*2-400)/2）', (0, imgops_1.panLimit)(2, 400, 1000), 800);
eq('图比视口小则无平移', (0, imgops_1.panLimit)(1.2, 1000, 400), 0);
eq('夹取位移', (0, imgops_1.clampOffset)(999, 100), 100);
eq('夹取负位移', (0, imgops_1.clampOffset)(-999, 100), -100);
eq('无上限归零', (0, imgops_1.clampOffset)(50, 0), 0);
eq('NaN 归零', (0, imgops_1.clampOffset)(Number.NaN, 100), 0);
eq('文件名含日期时间', (0, imgops_1.saveImageName)(new Date(2026, 9, 10, 8, 5, 3).getTime()), 'xbot-20261010-080503');
eq('缩放文本', (0, imgops_1.scaleText)(2.5), '250%');
eq('缩放文本夹取', (0, imgops_1.scaleText)(99), '600%');
eq('是否放大', (0, imgops_1.isZoomed)(2), true);
eq('是否放大（1）', (0, imgops_1.isZoomed)(1), false);
if (fail > 0) {
    console.log(`  imgops: ${pass} passed, ${fail} failed`);
    process.exit(1);
}
console.log(`  imgops: ${pass} passed, 0 failed`);
process.exit(0);

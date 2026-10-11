#!/usr/bin/env node
/*
 * 品牌资源 **emitter** —— 从编译好的 `core/brand.ets`(+`theme.ets`) 生成 SVG 中间件。
 *
 * 由 `tools/brand/gen.sh` 调用；把"写文件"这件事与"几何真源"分开：
 * 真源在 `core/brand.ets`（可单测），本脚本只负责落盘 + 组装 proof。
 *
 * argv: <jsDir> <outDir> <mode> <appscopeSvg> <entrySvg> <entryPng>
 */
'use strict';
const fs = require('fs');
const path = require('path');

const jsDir = process.argv[2];
const outDir = process.argv[3];
const brand = require(path.join(jsDir, 'brand.js'));
const theme = require(path.join(jsDir, 'theme.js'));

fs.mkdirSync(outDir, { recursive: true });

const accent = brand.brandAccent();
const onAccent = brand.brandOnAccent();

// 1) 启动器图标（满幅方块）—— AppScope 与 entry 各一份（模块级覆盖 app 级同名资源，不算冲突）
const icon = brand.appIconSvg(accent, onAccent);
fs.writeFileSync(path.join(outDir, 'AppScope_app_icon.svg'), icon);
fs.writeFileSync(path.join(outDir, 'entry_app_icon.svg'), icon);

// 2) 开屏标记（透明底）—— 交给 sips 栅格化成 512×512 PNG
const splash = brand.splashMarkSvg(accent, onAccent);
fs.writeFileSync(path.join(outDir, 'start_icon.svg'), splash);

// 2b) 降级链第 3 档：单色轮廓（零填充零发光；无障碍/黑白/低对比时用）
fs.writeFileSync(path.join(outDir, 'brand_mark_outline.svg'), brand.outlineMarkSvg(accent));

// 2c) 分层图标（adaptive / layered icon）：前景（缩进 313 安全区）+ 背景（满幅色底）
//     单层图标（当前 app_icon）不经过这里；启用分层需改 app.json5（见 docs/BRAND.md §9 待拍板）。
fs.writeFileSync(path.join(outDir, 'brand_foreground.svg'), brand.layeredForegroundSvg(accent, onAccent));
fs.writeFileSync(path.join(outDir, 'brand_background.svg'), brand.layeredBackgroundSvg(accent));

// 3) proof：把标记压在**浅/深两套基准画布**上，人工走查"两种主题都成立"
function proofSvg(bg) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1024 1024">`,
    `  <rect x="0" y="0" width="1024" height="1024" fill="${bg}"/>`,
    `  <path fill="${accent}" d="${brand.bubblePath()}"/>`,
    `  <path fill="${onAccent}" d="${brand.starPath()}"/>`,
    '</svg>',
    '',
  ].join('\n');
}
fs.writeFileSync(path.join(outDir, 'proof_light.svg'), proofSvg(theme.lightPalette().appBg));
fs.writeFileSync(path.join(outDir, 'proof_dark.svg'), proofSvg(theme.darkPalette().appBg));

process.stdout.write(`emitter: accent=${accent} onAccent=${onAccent} markRadius=${brand.markMaxRadius().toFixed(1)} outlineRadius=${brand.outlineMaxRadius().toFixed(1)} circleSafe=${brand.fitsInscribedCircle()} layeredSafe=${brand.fitsLayeredSafeZone()} fgScale=${brand.layeredForegroundScale().toFixed(4)} fgRadius=${brand.foregroundMarkMaxRadius().toFixed(1)} fgLayeredSafe=${brand.foregroundFitsLayeredSafeZone()}\n`);

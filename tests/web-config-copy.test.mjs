// ============================================================
// web-config-copy.test.mjs — WEB服务配置弹窗「复制」按钮（回归锁）
//
// 判例（2026-10-13 用户截图报告「这里的复制也没用」）：
// 按钮从写出之日起从未绑定任何事件——main.js 只绑了打开弹窗/启停服务，
// btnCopyFrontendWebUrl 零绑定，点击无任何反应。
//
// 修复三件套 + 体验一致性：
//  ① main.js 补 click 绑定 → copyFrontendWebUrl；
//  ② 未运行时复制回退到与二维码一致的预览地址（resolveFrontendWebQrUrl），
//    消除「二维码有地址、复制却不可用」的断裂；
//  ③ 复制按钮恒可用（原 disabled=!frontendWebURL 与二维码预览自相矛盾），
//    无地址时点击给 toast 提示而非静默禁用。
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'frontend', 'dist');
const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');

test('main.js：btnCopyFrontendWebUrl 有 click 绑定且指向 copyFrontendWebUrl', () => {
    const src = read('main.js');
    const m = src.match(/getElementById\('btnCopyFrontendWebUrl'\)\.addEventListener\('click',\s*([^)]+)\)/);
    assert.ok(m, '复制按钮必须有 click 绑定（本判例的病灶就是零绑定）');
    assert.ok(m[1].includes('copyFrontendWebUrl'), '绑定目标应是 copyFrontendWebUrl');
});

test('config.js：未运行时复制回退到二维码同款预览地址', () => {
    const src = read(path.join('chat', 'config.js'));
    const m = src.match(/export async function copyFrontendWebUrl\(\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'copyFrontendWebUrl 应存在');
    assert.ok(m[0].includes('resolveFrontendWebQrUrl'), '空 running URL 时应回退预览地址（与二维码一致）');
    assert.ok(/store\.frontendWebURL\s*\|\|\s*''/.test(m[0]), '运行中仍以实际生效地址为准');
});

test('config.js：复制按钮不再按 frontendWebURL 置灰（与二维码预览自相矛盾）', () => {
    const src = read(path.join('chat', 'config.js'));
    assert.ok(!/btnCopy\.disabled\s*=\s*!store\.frontendWebURL/.test(src), '不应再按 running URL 禁用复制按钮');
});

test('index.html：复制按钮无静态 disabled 属性', () => {
    const html = read('index.html');
    const m = html.match(/<button[^>]*id="btnCopyFrontendWebUrl"[^>]*>/);
    assert.ok(m, '按钮应存在');
    assert.ok(!/\sdisabled[\s=>]/.test(m[0]) && !m[0].endsWith('disabled>'), '不应带静态 disabled');
});

test('copyToClipboard 保留 execCommand 兜底（非安全上下文 webview 可达）', () => {
    const src = read(path.join('core', 'utils.js'));
    const m = src.match(/export async function copyToClipboard[\s\S]*?\n\}/);
    assert.ok(m, 'copyToClipboard 应存在');
    assert.ok(m[0].includes('navigator.clipboard'), '优先 clipboard API');
    assert.ok(m[0].includes("execCommand('copy')"), '必须有 execCommand 兜底');
});

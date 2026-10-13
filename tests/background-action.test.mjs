// ============================================================
// background-action.test.mjs — 「⏏ 后台运行」界面按钮（回归锁）
//
// 判例（2026-10-13 用户要求）：「应该是在某个回复或运行上显示后台运行，
// 点击就可以，不一定要快捷键，手机上没 ctrl」——此前「移到后台」只有
// Ctrl+B 键位，触屏/手机端完全不可达。
//
// 修复形态：
//  ① 动作抽到 chat/background.js（Ctrl+B 键位与界面按钮共用同一实现）；
//  ② render.js 在飞助手消息（未完成 + 会话忙）挂 .oc-bg-run-btn；
//  ③ cache.js 等待占位（发送后、消息未回）同样挂按钮；
//  ④ main.js 事件委托（按钮随 SSE 重建，不能逐个绑定）；
//  ⑤ CSS 按钮样式。
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'frontend', 'dist');
const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');

test('chat/background.js：导出 backgroundSession，含端点与繁忙守卫', () => {
    const src = read(path.join('chat', 'background.js'));
    assert.ok(/export async function backgroundSession\(/.test(src), '应导出 backgroundSession');
    assert.ok(src.includes('/background'), '应调用 /api/session/{id}/background 端点');
    assert.ok(/isSessionBusy/.test(src), '空闲时应守卫提示（服务端 no-op，不做假按钮）');
});

test('keybinds.js 复用共享实现，不再内联端点调用', () => {
    const src = read(path.join('chat', 'keybinds.js'));
    assert.ok(/import\s*{\s*backgroundSession\s*}\s*from\s*'\.\/background\.js'/.test(src), '应从 background.js 导入');
    assert.ok(!src.includes("OpenCodeCall('POST'"), '键位模块不应再内联端点调用（防双实现漂移）');
});

test('render.js：仅在「未完成 + 会话忙」的在飞助手消息上挂按钮', () => {
    const src = read(path.join('chat', 'render.js'));
    assert.ok(src.includes('oc-bg-run-btn'), '应渲染 .oc-bg-run-btn');
    const m = src.match(/if \(role === 'assistant'[^)]*isSessionBusy[^)]*\)/);
    assert.ok(m, '按钮应有条件挂载');
    assert.ok(m[0].includes('!info.time?.completed'), '必须限定未完成消息（否则历史助手消息全挂按钮）');
});

test('cache.js 等待占位也带按钮（发送后、消息未回的空窗期可达）', () => {
    const src = read(path.join('chat', 'cache.js'));
    const m = src.match(/renderPendingAssistantPlaceholder[\s\S]*?\n}/);
    assert.ok(m, '占位函数应存在');
    assert.ok(m[0].includes('oc-bg-run-btn'), '占位内应含 .oc-bg-run-btn');
});

test('main.js：事件委托绑定按钮 → backgroundSession（按钮随 SSE 重建）', () => {
    const src = read('main.js');
    assert.ok(/import\s*{\s*backgroundSession\s*}\s*from\s*'\.\/chat\/background\.js'/.test(src), 'main.js 应导入 backgroundSession');
    assert.ok(src.includes("closest('.oc-bg-run-btn')"), '应用事件委托匹配按钮');
    assert.ok(/closest\('\.oc-bg-run-btn'\)[\s\S]{0,200}backgroundSession\(\)/.test(src), '委托命中后应调用 backgroundSession');
});

test('CSS 具备按钮样式（accent 幽灵底 + hover）', () => {
    const css = read(path.join('css', 'style.css'));
    assert.ok(/\.oc-bg-run-btn\s*\{/.test(css), '缺 .oc-bg-run-btn 基础规则');
    assert.ok(/\.oc-bg-run-btn:hover/.test(css), '缺 hover 规则');
});

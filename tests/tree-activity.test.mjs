// ============================================================
// tree-activity.test.mjs — 会话树「运行中」活动动画（回归锁）
//
// 判例（2026-10-13 用户截图要求）：左侧项目树里正在运行的会话要有动画，
// 与右侧面板的运行状态观感一致。此前树节点只有静态 💬 图标，busy 状态
// 在树里完全不可见（store.sessionStatuses 有数据但没接到树上）。
//
// 修复：core/utils.js updateTreeSessionActivity() 按 store.sessionStatuses
// 切换 .oc-tree-session 的 is-busy 类；renderTree 渲染期带上初值；SSE
// session.status/session.idle 与两处状态轮询写入后调用；CSS 角标脉动点
// + 卡片呼吸光。
// ============================================================

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'frontend', 'dist');
const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8');

// ---------- DOM mock：树容器 + 两个会话节点 ----------
function fakeNode(sessionId) {
    return {
        dataset: { sessionId },
        classes: new Set(),
        classList: {
            toggle(name, on) { on ? this.owner.add(name) : this.owner.delete(name); },
        },
    };
}
function bindClassList(node) {
    node.classes.owner = null;
    node.classList.owner = node.classes;
    node.classList.toggle = node.classList.toggle.bind(node.classList);
    return node;
}

let treeContainer;
globalThis.document = {
    getElementById: (id) => (id === 'ocTree' ? treeContainer : null),
};

const { store } = await import('../frontend/dist/core/state.js');
const { updateTreeSessionActivity } = await import('../frontend/dist/core/utils.js');

beforeEach(() => {
    store.sessionStatuses = {};
    treeContainer = null;
});

test('updateTreeSessionActivity：busy 会话加 is-busy，idle/未知移除', () => {
    const a = bindClassList(fakeNode('A'));
    const b = bindClassList(fakeNode('B'));
    const c = bindClassList(fakeNode('C'));
    treeContainer = { querySelectorAll: (sel) => (sel === '.oc-tree-session' ? [a, b, c] : []) };
    store.sessionStatuses = { A: 'busy', B: 'idle' /* C 无状态 */ };
    updateTreeSessionActivity();
    assert.ok(a.classes.has('is-busy'), 'busy 的 A 应有 is-busy');
    assert.ok(!b.classes.has('is-busy'), 'idle 的 B 不应有');
    assert.ok(!c.classes.has('is-busy'), '无状态的 C 不应有');
    // 状态翻转：A 转 idle、B 转 busy
    store.sessionStatuses = { A: 'idle', B: 'busy' };
    updateTreeSessionActivity();
    assert.ok(!a.classes.has('is-busy'), 'A 转 idle 后应移除');
    assert.ok(b.classes.has('is-busy'), 'B 转 busy 后应加上');
});

test('updateTreeSessionActivity：树不存在/为空时安全返回', () => {
    treeContainer = null;
    assert.doesNotThrow(() => updateTreeSessionActivity());
});

// ---------- 源码级结构门禁 ----------

test('renderTree 渲染期即带 is-busy 初值与活动角标元素', () => {
    const src = read(path.join('chat', 'tree.js'));
    assert.ok(/sessionStatuses\[[^\]]*ses\.id\]\s*===\s*'busy'/.test(src), '渲染期应读 sessionStatuses 判定 busy');
    assert.ok(src.includes("isBusy ? ' is-busy' : ''"), '渲染期应带 is-busy 初值');
    assert.ok(src.includes('oc-tree-activity'), '会话卡片应有活动角标元素');
});

test('renderTree 结尾重挂状态类（innerHTML 重建会清掉 active/is-busy）', () => {
    const src = read(path.join('chat', 'tree.js'));
    const tail = src.match(/applyTreeSearchFilter\(\);[\s\S]{0,300}/);
    assert.ok(tail, 'renderTree 结尾应调 applyTreeSearchFilter');
    assert.ok(tail[0].includes('updateTreeActiveSession()'), '结尾应重挂选中高亮');
    assert.ok(tail[0].includes('updateTreeSessionActivity()'), '结尾应重挂活动动画');
});

test('SSE session.status 与 session.idle 写入后都驱动树活动动画', () => {
    const src = read(path.join('chat', 'events.js'));
    assert.ok(/import\s*{[^}]*\bupdateTreeSessionActivity\b[^}]*}\s*from\s*'\.\.\/core\/utils\.js'/.test(src), 'events.js 应导入 updateTreeSessionActivity');
    const statusBlock = src.match(/if \(type === 'session\.status' && sid\) \{[\s\S]*?\n    \}/);
    const idleBlock = src.match(/if \(type === 'session\.idle' && sid\) \{[\s\S]*?\n    \}/);
    assert.ok(statusBlock && statusBlock[0].includes('updateTreeSessionActivity()'), 'session.status 分支应调用');
    assert.ok(idleBlock && idleBlock[0].includes('updateTreeSessionActivity()'), 'session.idle 分支应调用');
});

test('两处状态轮询（session.js / tabs.js）写入后同样驱动', () => {
    const ses = read(path.join('chat', 'session.js'));
    const tabs = read(path.join('chat', 'tabs.js'));
    assert.ok(ses.includes('updateTreeSessionActivity()'), 'session.js 轮询应调用');
    assert.ok(tabs.includes('updateTreeSessionActivity()'), 'tabs.js 轮询应调用');
});

test('CSS 具备活动动画：角标脉动 + 卡片呼吸光 + is-busy 选择器', () => {
    const css = read(path.join('css', 'style.css'));
    assert.ok(/@keyframes ocTreeActivityPulse/.test(css), '缺角标脉动 keyframes');
    assert.ok(/@keyframes ocTreeBusyGlow/.test(css), '缺卡片呼吸光 keyframes');
    assert.ok(/\.oc-tree-session\.is-busy \.oc-tree-activity/.test(css), '缺 is-busy 角标显示规则');
    assert.ok(/\.oc-tree-session\.is-busy\s*\{/.test(css), '缺 is-busy 卡片规则');
});

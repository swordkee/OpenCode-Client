// ============================================================
// composer-drafts.test.mjs — 输入框草稿按会话隔离
//
// 判例：#ocPrompt 全局单例，A 会话输入一半切到 B 会话文字残留（易误发）。
// 修复：chat/composer-drafts.js 在四个切换入口（selectSession / switchTab /
// closeSessionTab / createNewSession）stash+restore。
//
// composer-drafts.js 顶层无 DOM 访问（promptEl 在函数内取值），state.js 为
// 纯状态模块，均可直接 import；document/Event 用最小 mock。
// ============================================================

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const fakeTa = {
    value: '',
    dispatched: [],
    dispatchEvent(e) { this.dispatched.push(e.type); return true; },
};

globalThis.document = { getElementById: (id) => (id === 'ocPrompt' ? fakeTa : null) };
globalThis.Event = class {
    constructor(type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles); }
};

const { store } = await import('../frontend/dist/core/state.js');
const {
    draftKeyFor, applyDraft, currentDraftKey,
    stashComposerDraft, restoreComposerDraft, clearComposer, suppressNextStash,
    consumeComposerIfMatches,
} = await import('../frontend/dist/chat/composer-drafts.js');

beforeEach(() => {
    store.currentSessionId = '';
    store.pendingWorkDir = '';
    store.composerDrafts = {};
    fakeTa.value = '';
    fakeTa.dispatched = [];
});

/** 模拟 hook 序列：stash（旧上下文）→ 改 store → restore（新上下文）。 */
function switchTo(sessionId, pendingDir) {
    stashComposerDraft();
    store.currentSessionId = sessionId;
    store.pendingWorkDir = pendingDir ?? store.pendingWorkDir;
    restoreComposerDraft();
}

test('draftKeyFor：会话与新建态两种形态', () => {
    assert.equal(draftKeyFor('ses_1', '/d1'), 'ses:ses_1');
    assert.equal(draftKeyFor('', '/d1'), 'new:/d1');
    assert.equal(draftKeyFor('', ''), 'new:');
    assert.equal(draftKeyFor(null, undefined), 'new:');
});

test('applyDraft：非空覆盖存、空则删', () => {
    const drafts = {};
    applyDraft(drafts, 'k', '文字');
    assert.equal(drafts.k, '文字');
    applyDraft(drafts, 'k', '改写');
    assert.equal(drafts.k, '改写');
    applyDraft(drafts, 'k', '');
    assert.ok(!('k' in drafts));
});

test('A 输入 → 切 B 不见 → 切回 A 恢复', () => {
    switchTo('A', '/d1');
    fakeTa.value = '给 A 的半成品';
    switchTo('B', '/d1');
    assert.equal(fakeTa.value, '', '切到 B 应为空输入框');
    fakeTa.value = '给 B 的';
    switchTo('A', '/d1');
    assert.equal(fakeTa.value, '给 A 的半成品', '切回 A 应恢复 A 的草稿');
    switchTo('B', '/d1');
    assert.equal(fakeTa.value, '给 B 的', '切回 B 应恢复 B 的草稿');
});

test('清空后再切走 = 明确丢弃草稿', () => {
    switchTo('A', '/d1');
    fakeTa.value = '草稿';
    switchTo('B', '/d1');
    switchTo('A', '/d1');
    fakeTa.value = '';
    switchTo('B', '/d1');
    assert.ok(!('ses:A' in store.composerDrafts), '清空后切走应删除 A 的草稿');
});

test('新建态草稿按待用目录隔离，且与会话草稿互不串扰', () => {
    switchTo('A', '/d1');
    fakeTa.value = 'A 的文字';
    switchTo('', '/d2');            // createNewSession('/d2')
    assert.equal(fakeTa.value, '', '新建态（/d2）应为空');
    fakeTa.value = '新会话草稿-d2';
    switchTo('', '/d3');            // 换到另一个目录的新建态
    assert.equal(fakeTa.value, '', '新建态（/d3）应为空');
    switchTo('', '/d2');
    assert.equal(fakeTa.value, '新会话草稿-d2', '回到 /d2 新建态应恢复其草稿');
    switchTo('A', '/d1');
    assert.equal(fakeTa.value, 'A 的文字', '切回 A 不受新建态影响');
});

test('closeSessionTab 序列：suppressNextStash 吞掉连锁 stash，不误删 new: 草稿', () => {
    // 前置：新建态 /d1 有草稿
    switchTo('', '/d1');
    fakeTa.value = '新建草稿';
    // 打开并切到会话 A（此时 new:/d1 草稿已 stash）
    switchTo('A', '/d1');
    fakeTa.value = 'A 未发送';
    // closeSessionTab(A) 的 hook 序列：stash(A) → clearComposer → suppressNextStash → 清 id → switchTab/恢复
    stashComposerDraft();
    clearComposer();
    suppressNextStash();
    store.currentSessionId = '';
    store.activeTabId = '';
    // 无剩余 tab：switchTab 不调用；若有 switchTab，其入口 stash 应被吞——这里直接验证吞没语义
    stashComposerDraft(); // 应被 suppress 吞掉（输入框已空，若执行会删掉 new:/d1 草稿）
    restoreComposerDraft();
    assert.equal(store.composerDrafts['new:/d1'], '新建草稿', 'new: 草稿不应被连锁 stash 删除');
    assert.equal(store.composerDrafts['ses:A'], 'A 未发送', '被关 tab 的草稿应已保存');
    assert.equal(fakeTa.value, '新建草稿', '空 tab 态应恢复 new: 草稿');
    // suppress 只吞一次：下一次 stash 正常执行
    fakeTa.value = '改写新建';
    stashComposerDraft();
    assert.equal(store.composerDrafts['new:/d1'], '改写新建');
});

test('restore 触发 input 事件（发送按钮态等监听者刷新）', () => {
    switchTo('A', '/d1');
    fakeTa.dispatched = [];
    restoreComposerDraft();
    assert.deepEqual(fakeTa.dispatched, ['input']);
});

test('currentDraftKey 跟随 store 上下文', () => {
    store.currentSessionId = 'X';
    assert.equal(currentDraftKey(), 'ses:X');
    store.currentSessionId = '';
    store.pendingWorkDir = '/proj';
    assert.equal(currentDraftKey(), 'new:/proj');
});

// ---------- 跨窗口消费检测（consumeComposerIfMatches） ----------
// 判例：Wails 应用 + 浏览器各持一份输入框 DOM，窗口 1 入队/发送后，
// 窗口 2 同会话的输入框仍留同文（用户报告「切到别的窗口还有刚才的问题」）。
// SSE 新用户消息到达时逐字匹配 → 清；不同文 → 保留。

test('消费检测：当前会话输入框同文 → 清空 + 派发 input', () => {
    switchTo('A', '/d1');
    fakeTa.value = '刚才的问题';
    fakeTa.dispatched = [];
    const consumed = consumeComposerIfMatches('A', '刚才的问题');
    assert.equal(consumed, true);
    assert.equal(fakeTa.value, '');
    assert.deepEqual(fakeTa.dispatched, ['input']);
});

test('消费检测：输入框不同文 → 保留（防误杀正在输入的新内容）', () => {
    switchTo('A', '/d1');
    fakeTa.value = '正在输入的新内容';
    const consumed = consumeComposerIfMatches('A', '刚才的问题');
    assert.equal(consumed, false);
    assert.equal(fakeTa.value, '正在输入的新内容');
});

test('消费检测：非当前会话的同文存稿 → 删存稿，当前输入框不动', () => {
    // 在 A 输入后切到 B（A 存稿留下，B 输入框里有别的内容）
    switchTo('A', '/d1');
    fakeTa.value = '刚才的问题';
    switchTo('B', '/d1');
    fakeTa.value = 'B 的内容';
    const consumed = consumeComposerIfMatches('A', '刚才的问题');
    assert.equal(consumed, true, 'A 的同文存稿应被消费');
    assert.ok(!('ses:A' in store.composerDrafts));
    assert.equal(fakeTa.value, 'B 的内容', 'B 的输入框不受影响');
    // 切回 A：存稿已删，不再复活
    switchTo('A', '/d1');
    assert.equal(fakeTa.value, '');
});

test('消费检测：空文本一律不动', () => {
    switchTo('A', '/d1');
    fakeTa.value = '内容';
    assert.equal(consumeComposerIfMatches('A', ''), false);
    assert.equal(consumeComposerIfMatches('A', '   '), false);
    assert.equal(consumeComposerIfMatches('', '内容'), false);
    assert.equal(fakeTa.value, '内容');
});

test('消费检测：发送方窗口自身收到 SSE 回执是 no-op（输入框已清、无同文存稿）', () => {
    switchTo('A', '/d1');
    fakeTa.value = '刚才的问题';
    // 模拟发送：L1242 清空输入框（不触碰存稿——此处本就没有存稿）
    fakeTa.value = '';
    const consumed = consumeComposerIfMatches('A', '刚才的问题');
    assert.equal(consumed, false, '发送方窗口无可消费对象');
});

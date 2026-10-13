// ============================================================
// inbox-bar-switch.test.mjs — 队列条按会话隔离（回归锁）
//
// 判例（2026-10-13 用户截图报告）：A 会话有排队消息时，队列条
// 「N 条排队中 + 预览」切到 B 会话/新建态后仍然挂着——#ocInboxBar
// 是全局单例 DOM，切换路径（switchTab 快速切换尤甚）不重渲染也不隐藏。
// 修复：switchTab / selectSession / createNewSession / closeSessionTab
// 四个切换入口同步调用 renderInboxBar()（按新会话缓存渲染，无缓存即隐藏）。
//
// renderInboxBar 是 DOM 粘合函数，inbox.js 顶层无 DOM 访问，可直接 import；
// document 用最小 mock（ocInboxBar / ocInboxManageBtn）。
// ============================================================

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const fakeBar = {
    style: { display: 'none' },
    innerHTML: '',
};
const fakeManageBtn = { onclick: null };

globalThis.document = {
    getElementById: (id) => {
        if (id === 'ocInboxBar') return fakeBar;
        if (id === 'ocInboxManageBtn') return fakeManageBtn;
        return null;
    },
    // utils.escapeHtml 用 div.textContent→innerHTML 做转义，mock 同语义的最小实现
    createElement: () => {
        const el = {
            _text: '',
            set textContent(v) { this._text = String(v); },
            get textContent() { return this._text; },
            get innerHTML() {
                return this._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            },
        };
        return el;
    },
};

const { store } = await import('../frontend/dist/core/state.js');
const { renderInboxBar, inboxItemsOf } = await import('../frontend/dist/chat/inbox.js');

beforeEach(() => {
    store.currentSessionId = '';
    store.inboxItems = {};
    fakeBar.style.display = 'none';
    fakeBar.innerHTML = '';
    fakeManageBtn.onclick = null;
});

function queueItem(text) {
    return { id: 'inb_' + Math.random().toString(36).slice(2, 8), type: 'user', delivery: 'queue', payload: { text } };
}

test('A 有排队、B 无排队：切到 B 队列条必须隐藏且清空', () => {
    store.inboxItems = { A: [queueItem('给 A 的问题'), queueItem('第二条')] };
    store.currentSessionId = 'A';
    renderInboxBar();
    assert.notEqual(fakeBar.style.display, 'none', 'A 的队列条应显示');
    assert.ok(fakeBar.innerHTML.includes('2 条排队中'));
    assert.ok(fakeBar.innerHTML.includes('给 A 的问题'));

    // 模拟切换（switchTab/selectSession 的同步重渲染）
    store.currentSessionId = 'B';
    renderInboxBar();
    assert.equal(fakeBar.style.display, 'none', '切到无排队的 B，队列条必须隐藏');
    assert.equal(fakeBar.innerHTML, '', '不得残留 A 的横幅内容');
});

test('A、B 各有排队：切换后内容跟随各自会话', () => {
    store.inboxItems = { A: [queueItem('A 的排队')], B: [queueItem('B 的排队')] };
    store.currentSessionId = 'A';
    renderInboxBar();
    assert.ok(fakeBar.innerHTML.includes('A 的排队'));
    store.currentSessionId = 'B';
    renderInboxBar();
    assert.ok(fakeBar.innerHTML.includes('B 的排队'));
    assert.ok(!fakeBar.innerHTML.includes('A 的排队'), '不得显示上一会话的预览');
});

test('新建态（无会话）：队列条隐藏', () => {
    store.inboxItems = { A: [queueItem('A 的排队')] };
    store.currentSessionId = 'A';
    renderInboxBar();
    assert.notEqual(fakeBar.style.display, 'none');
    // createNewSession / 关光 tab：currentSessionId 置空
    store.currentSessionId = '';
    renderInboxBar();
    assert.equal(fakeBar.style.display, 'none');
    assert.equal(fakeBar.innerHTML, '');
});

test('inboxItemsOf：无会话/无缓存均返回空数组', () => {
    assert.deepEqual(inboxItemsOf(''), []);
    assert.deepEqual(inboxItemsOf('不存在的会话'), []);
    store.inboxItems = { A: [queueItem('x')] };
    assert.equal(inboxItemsOf('A').length, 1);
});

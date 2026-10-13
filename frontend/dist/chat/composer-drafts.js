// ============================================================
// chat-composer-drafts.js — 输入框草稿按会话隔离
//
// 问题（2026-10-13 用户报告）：#ocPrompt 是全局单例 textarea，在会话 A
// 输入一半切到会话 B，A 的文字原样留在输入框——容易把给 A 的内容误发到 B。
//
// 方案：切换会话/新建态前把输入框文本按「旧上下文 key」存下，切换后按
// 「新上下文 key」恢复。key 形态：
//   - 会话：ses:<sessionID>
//   - 新建态（无会话）：new:<pendingWorkDir>（按待用工作目录分）
// 语义：stash 时文本非空→覆盖存；为空→删该 key 草稿（用户在上下文里
// 手动清空后再切走 = 明确丢弃草稿）。
//
// 关闭活动 tab 的特殊处理：closeSessionTab 会先 stash（文本归属被关 tab），
// 随后清空输入框再走 switchTab/空态恢复——但 switchTab 入口的 stash 会把
// 「已清空的输入框」存到中间态 key，误删 new: 草稿。用 suppressNextStash
// 一次性守卫吞掉这次连锁 stash。
//
// 纯函数（draftKeyFor / applyDraft）与 DOM 粘合分离，纯函数进 node 单测。
// ============================================================

import { store } from '../core/state.js';

// ---------- 纯函数（可测） ----------

/** 草稿 key：会话 → ses:<id>；新建态 → new:<dir>（dir 可空）。 */
export function draftKeyFor(sessionId, pendingDir) {
    if (sessionId) return 'ses:' + sessionId;
    return 'new:' + (pendingDir || '');
}

/** 写入一条草稿：非空覆盖存，空则删除。返回 drafts（便于链式断言）。 */
export function applyDraft(drafts, key, text) {
    if (text && text.length > 0) drafts[key] = text;
    else delete drafts[key];
    return drafts;
}

// ---------- DOM 粘合 ----------

function promptEl() { return document.getElementById('ocPrompt'); }

/** 当前上下文的草稿 key（无会话时取待用工作目录）。 */
export function currentDraftKey() {
    return draftKeyFor(store.currentSessionId, store.pendingWorkDir);
}

let stashSuppressed = false;

/** 吞掉下一次 stash（closeSessionTab 连锁切换专用，一次性）。 */
export function suppressNextStash() { stashSuppressed = true; }

/** 切换前调用：把输入框当前文本存到当前上下文 key。 */
export function stashComposerDraft() {
    if (stashSuppressed) { stashSuppressed = false; return; }
    const el = promptEl();
    if (!el) return;
    applyDraft(store.composerDrafts, currentDraftKey(), el.value);
}

/** 切换后调用：恢复当前上下文 key 的草稿（无则清空）。 */
export function restoreComposerDraft() {
    const el = promptEl();
    if (!el) return;
    el.value = store.composerDrafts[currentDraftKey()] || '';
    // 触发 input 监听（发送按钮态/字数等以 input 事件为触发源的逻辑）
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 清空输入框（不触碰草稿；配合 stash/suppress 使用）。 */
export function clearComposer() {
    const el = promptEl();
    if (el) el.value = '';
}

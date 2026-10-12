// ============================================================
// OpenCode 管理中心 - 会话收件箱（排队消息）管理
// ============================================================
// v2 的 inbox 是「已送达服务端、等待投递」的消息队列：会话忙时发送的
// prompt（delivery=queue，见 session.js 发送路径）与 steer 插话都停在
// 这里，空闲后按序消化。官方 Web 提供队列可见性，本模块对齐该体验：
//   - 输入区上方的队列条：N 条排队中 + 最早一条预览 + 管理入口（无排队时隐藏）；
//   - 管理弹窗：每条可「立即插话」（PATCH delivery=steer，服务端随即唤醒执行）
//     或「撤回」（DELETE，从队列移除、不会送达）。
// 刷新时机：SSE 的 session.inbox.* 事件（防抖，见 events.js）+ 发送入队后
// + 切换会话后。契约：GET/PATCH/DELETE /api/session/{id}/inbox[/{inboxID}]。
// ============================================================

import { api } from '../core/apicall.js';
import { store } from '../core/state.js';
import { escapeHtml, showToast, showApiError, bindOverlayClose } from '../core/utils.js';
import { unwrapList } from '../core/v2compat.js';

/** 当前会话的队列条目（无则空数组） */
export function inboxItemsOf(sid) {
    return (sid && store.inboxItems && store.inboxItems[sid]) || [];
}

/** 队列条目的中文类型标签（纯函数，供单测） */
export function inboxItemLabel(item) {
    switch (item && item.type) {
        case 'user': return '消息';
        case 'compaction': return '压缩上下文';
        case 'move': return '移动会话';
        case 'synthetic': return '系统注入';
        default: return '未知项';
    }
}

/** 队列条目的正文预览（纯函数，供单测）：user 取 payload.text 并压平空白，其余回退类型标签 */
export function inboxItemPreview(item) {
    if (!item) return '';
    if (item.type === 'user') {
        const text = (item.payload && item.payload.text) || '';
        const flat = text.replace(/\s+/g, ' ').trim();
        return flat || '（空消息）';
    }
    return inboxItemLabel(item);
}

/** delivery 的中文标签（纯函数，供单测） */
export function deliveryLabel(delivery) {
    return delivery === 'steer' ? '插话' : '排队';
}

function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 拉取指定会话的队列并刷新队列条。失败保留旧值（避免列表闪烁），不打扰用户。 */
export async function loadInbox(sid) {
    if (!sid || !store.webRunning) return;
    try {
        const res = await api.OpenCodeCall('GET', '/api/session/' + encodeURIComponent(sid) + '/inbox');
        store.inboxItems[sid] = unwrapList(res);
    } catch (_) {
        return;
    }
    if (sid === store.currentSessionId) renderInboxBar();
}

// 防抖：inbox 事件成群出现（enqueued→delivered→updated），合并为一次拉取
const refreshTimers = {};

/** 由 SSE 事件驱动的防抖刷新（events.js 在 session.inbox.* 时调用） */
export function scheduleInboxRefresh(sid) {
    if (!sid) return;
    if (refreshTimers[sid]) return;
    refreshTimers[sid] = setTimeout(function () {
        delete refreshTimers[sid];
        loadInbox(sid);
    }, 300);
}

/** 渲染输入区上方的队列条（无排队时隐藏） */
export function renderInboxBar() {
    const bar = document.getElementById('ocInboxBar');
    if (!bar) return;
    const items = inboxItemsOf(store.currentSessionId);
    if (!items.length) {
        bar.style.display = 'none';
        bar.innerHTML = '';
        return;
    }
    bar.style.display = '';
    bar.innerHTML = '<span class="oc-inbox-bar-icon" aria-hidden="true">⏳</span>'
        + '<span class="oc-inbox-bar-count">' + items.length + ' 条排队中</span>'
        + '<span class="oc-inbox-bar-preview" title="' + escapeHtml(inboxItemPreview(items[0])) + '">'
        + escapeHtml(truncate(inboxItemPreview(items[0]), 36)) + '</span>'
        + '<button type="button" class="btn btn-sm" id="ocInboxManageBtn">管理</button>';
    document.getElementById('ocInboxManageBtn').onclick = openInboxModal;
}

function renderInboxModal() {
    const list = document.getElementById('ocInboxList');
    if (!list) return;
    const items = inboxItemsOf(store.currentSessionId);
    if (!items.length) {
        list.innerHTML = '<div class="oc-empty">没有排队中的消息</div>';
        return;
    }
    list.innerHTML = items.map(function (item, i) {
        const steerable = item.delivery === 'queue';
        return '<div class="oc-inbox-item" data-inbox-id="' + escapeHtml(item.id) + '">'
            + '<span class="oc-inbox-item-type">' + inboxItemLabel(item) + '</span>'
            + '<span class="oc-inbox-item-text" title="' + escapeHtml(inboxItemPreview(item)) + '">'
            + escapeHtml(truncate(inboxItemPreview(item), 80)) + '</span>'
            + '<span class="oc-inbox-item-delivery' + (steerable ? '' : ' is-steer') + '">' + deliveryLabel(item.delivery) + '</span>'
            + '<span class="oc-inbox-item-actions">'
            + (steerable ? '<button type="button" class="btn btn-sm" data-act="steer" data-i="' + i + '" title="改为插话：插到当前执行的下一步边界，服务端随即唤醒">立即插话</button>' : '')
            + '<button type="button" class="btn btn-sm oc-inbox-cancel" data-act="cancel" data-i="' + i + '" title="从队列移除，不会送达">撤回</button>'
            + '</span></div>';
    }).join('');
}

/** 打开队列管理弹窗 */
export function openInboxModal() {
    const modal = document.getElementById('ocInboxModal');
    if (!modal) {
        showToast('队列管理不可用（缺少 #ocInboxModal）', 'error');
        return;
    }
    renderInboxModal();
    modal.style.display = 'flex';
    bindOverlayClose(modal, closeInboxModal);
    // 打开期间队列可能继续变化（其它窗口/事件）：借列表刷新同步一次
    loadInbox(store.currentSessionId).then(renderInboxModal);
}

export function closeInboxModal() {
    const modal = document.getElementById('ocInboxModal');
    if (modal) modal.style.display = 'none';
}

/** 立即插话：queue → steer（服务端唤醒执行；409 表示已被消化，按成功口径刷新） */
export async function steerInboxItem(inboxID) {
    const sid = store.currentSessionId;
    if (!sid || !inboxID) return;
    try {
        await api.OpenCodeCall('PATCH', '/api/session/' + encodeURIComponent(sid) + '/inbox/' + encodeURIComponent(inboxID), { delivery: 'steer' });
        showToast('已改为插话，将优先执行', 'success');
    } catch (e) {
        showApiError('插话失败: ', e);
    }
    await loadInbox(sid);
    renderInboxModal();
}

/** 撤回：从队列删除（已投递的会 404/409，同样只刷新） */
export async function cancelInboxItem(inboxID) {
    const sid = store.currentSessionId;
    if (!sid || !inboxID) return;
    try {
        await api.OpenCodeCall('DELETE', '/api/session/' + encodeURIComponent(sid) + '/inbox/' + encodeURIComponent(inboxID));
        showToast('已从队列撤回', 'success');
    } catch (e) {
        showApiError('撤回失败: ', e);
    }
    await loadInbox(sid);
    renderInboxModal();
}

/** 弹窗内按钮事件委托（main.js 初始化时挂一次） */
export function initInbox() {
    const modal = document.getElementById('ocInboxModal');
    if (!modal) return;
    bindOverlayClose(modal, closeInboxModal);
    const list = document.getElementById('ocInboxList');
    if (list) {
        list.addEventListener('click', function (e) {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const row = btn.closest('.oc-inbox-item');
            const inboxID = row ? row.dataset.inboxId : '';
            if (!inboxID) return;
            if (btn.dataset.act === 'steer') steerInboxItem(inboxID);
            else if (btn.dataset.act === 'cancel') cancelInboxItem(inboxID);
        });
    }
    const closeBtn = modal.querySelector('.oc-inbox-close');
    if (closeBtn) closeBtn.onclick = closeInboxModal;
}

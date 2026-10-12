// ============================================================
// OpenCode 管理中心 - 本轮改动（turn diff）视图
// ============================================================
// v2 的 GET /api/session/{id}/diff 返回「一轮」改动的结构化文件 diff：
// 一轮 = 从会话上次空闲后的第一条 prompt 到下一次空闲标记之间触碰的文件。
// from/to 省略时取最新一条用户消息所在的那一轮（覆盖最常见的
// 「刚跑完，看看改了什么」场景）。
// 界面：会话头部「改动」按钮 → 弹窗列出文件（状态徽标 + +增/−删），
// 点击文件行展开 unified diff 补丁（着色：+绿 −红 @@青 元信息灰）。
// ============================================================

import { api } from '../core/apicall.js';
import { store } from '../core/state.js';
import { escapeHtml, showToast, showApiError, bindOverlayClose } from '../core/utils.js';
import { unwrapList } from '../core/v2compat.js';

/** unified diff 行分类（纯函数，供单测）：
 *  注意 '+++'/'---' 是文件头不是增删行，必须先于 '+'/'-' 判定。 */
export function diffLineClass(line) {
    if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
    if (line.startsWith('diff ') || line.startsWith('index ')
        || line.startsWith('new file') || line.startsWith('deleted file')
        || line.startsWith('similarity') || line.startsWith('rename ')) return 'meta';
    if (line.startsWith('@@')) return 'hunk';
    if (line.startsWith('+')) return 'add';
    if (line.startsWith('-')) return 'del';
    return 'ctx';
}

/** 文件状态的中文徽标（纯函数，供单测） */
export function diffStatusLabel(status) {
    switch (status) {
        case 'added': return '新增';
        case 'deleted': return '删除';
        case 'modified': return '修改';
        default: return status || '未知';
    }
}

// 纯文本转义（escapeHtml 是纯 DOM 实现，本模块的 renderPatchHtml 要在 node 单测里
// 跑，不能依赖 document）。只转义文本上下文必需的四字符。
function escText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 补丁文本 → 着色行 HTML（纯函数，供单测） */
export function renderPatchHtml(patch) {
    return String(patch || '').split('\n').map(function (line) {
        return '<span class="oc-diff-line oc-diff-' + diffLineClass(line) + '">'
            + (escText(line) || ' ') + '</span>';
    }).join('');
}

function renderTurnDiff(files) {
    const list = document.getElementById('ocTurnDiffList');
    const title = document.getElementById('ocTurnDiffCount');
    if (!list) return;
    if (title) title.textContent = files.length ? '（' + files.length + ' 个文件）' : '';
    if (!files.length) {
        list.innerHTML = '<div class="oc-empty">本轮没有文件改动</div>';
        return;
    }
    list.innerHTML = files.map(function (f, i) {
        return '<div class="oc-diff-file" data-i="' + i + '">'
            + '<div class="oc-diff-file-head">'
            + '<span class="oc-diff-status oc-diff-status-' + escapeHtml(f.status) + '">' + diffStatusLabel(f.status) + '</span>'
            + '<span class="oc-diff-file-path" title="' + escapeHtml(f.file) + '">' + escapeHtml(f.file) + '</span>'
            + '<span class="oc-diff-stat"><span class="oc-diff-add">+' + (f.additions || 0) + '</span>'
            + ' <span class="oc-diff-del">−' + (f.deletions || 0) + '</span></span>'
            + '</div>'
            + '<pre class="oc-diff-patch" style="display:none">' + renderPatchHtml(f.patch) + '</pre>'
            + '</div>';
    }).join('');
}

/** 打开本轮改动弹窗（默认最新一轮；context=3 行上下文） */
export async function openTurnDiff() {
    const modal = document.getElementById('ocTurnDiffModal');
    if (!modal) {
        showToast('改动视图不可用（缺少 #ocTurnDiffModal）', 'error');
        return;
    }
    if (!store.webRunning || !store.currentSessionId) {
        showToast('请先启动服务并选择会话', 'error');
        return;
    }
    const sid = store.currentSessionId;
    const list = document.getElementById('ocTurnDiffList');
    if (list) list.innerHTML = '<div class="oc-empty">加载中…</div>';
    modal.style.display = 'flex';
    bindOverlayClose(modal, closeTurnDiff);
    try {
        const res = await api.OpenCodeCall('GET', '/api/session/' + encodeURIComponent(sid) + '/diff?context=3');
        renderTurnDiff(unwrapList(res));
    } catch (e) {
        if (list) list.innerHTML = '<div class="oc-empty error">加载失败：' + escapeHtml(e && e.message || String(e)) + '</div>';
        showApiError('获取本轮改动失败: ', e);
    }
}

export function closeTurnDiff() {
    const modal = document.getElementById('ocTurnDiffModal');
    if (modal) modal.style.display = 'none';
}

/** 文件行点击展开/收起补丁 + 头部按钮与关闭（main.js 初始化时挂一次） */
export function initTurnDiff() {
    const btn = document.getElementById('btnTurnDiff');
    if (btn) btn.onclick = openTurnDiff;
    const modal = document.getElementById('ocTurnDiffModal');
    if (!modal) return;
    bindOverlayClose(modal, closeTurnDiff);
    const closeBtn = modal.querySelector('.oc-turn-diff-close');
    if (closeBtn) closeBtn.onclick = closeTurnDiff;
    const list = document.getElementById('ocTurnDiffList');
    if (list) {
        list.addEventListener('click', function (e) {
            const head = e.target.closest('.oc-diff-file-head');
            if (!head) return;
            const patch = head.parentElement.querySelector('.oc-diff-patch');
            if (patch) patch.style.display = patch.style.display === 'none' ? '' : 'none';
        });
    }
}

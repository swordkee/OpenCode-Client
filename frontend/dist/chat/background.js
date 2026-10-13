// ============================================================
// chat-background.js — 「移到后台」动作（Ctrl+B 键位与界面按钮共用）
//
// 端点已实测存在：POST /api/session/{id}/background → 204 No Content，
// 语义（服务端自述）是「Move active foreground backgroundable tools for this
// session into background observation. Idle requests are a no-op.」——
// 会话空闲时是空操作，因此只在会话繁忙时才提示，避免做成一个假按钮。
//
// 界面入口（2026-10-13 用户要求）：手机端没有 Ctrl，运行中的助手消息/
// 等待占位上挂「⏏ 后台运行」按钮（.oc-bg-run-btn，main.js 事件委托），
// 与 Ctrl+B 键位（chat/keybinds.js）共用本模块的同一实现。
// ============================================================

import { api } from '../core/apicall.js';
import { store } from '../core/state.js';
import { showToast } from '../core/utils.js';
import { isSessionBusy } from './render.js';

/** 把当前会话的阻塞中工具移到后台观察 */
export async function backgroundSession() {
    const sid = store.currentSessionId;
    if (!sid) {
        showToast('请先选择会话', 'error');
        return;
    }
    if (!isSessionBusy(sid)) {
        showToast('当前会话没有在后台运行的工具', 'info');
        return;
    }
    try {
        await api.OpenCodeCall('POST', `/api/session/${encodeURIComponent(sid)}/background`, {});
        showToast('已将会话中的阻塞工具移到后台', 'success');
    } catch (e) {
        showToast('移到后台失败: ' + (e && e.message ? e.message : e), 'error');
    }
}

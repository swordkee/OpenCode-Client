// ============================================================
// OpenCode 管理中心 - 会话统计视图（experimental）
// ============================================================
// 数据源：GET /api/experimental/session/stats（v2 experimental 端点），
// 参数 from/to（YYYY-MM-DD）、tools=summary、timezone（IANA）。
// 界面：范围切换（今天/近7天/近30天）+ 概览卡片 + 每日活跃条形图
// + 模型用量表 + 工具调用汇总。纯 CSS 条形图，不引入图表库。
// 端点是 experimental：字段或可用性可能随版本变化，渲染全部走防御式取值。
// ============================================================

import { api } from '../core/apicall.js';
import { escapeHtml, showApiError } from '../core/utils.js';
import { unwrap } from '../core/v2compat.js';

/** token 数缩写（纯函数，供单测）：1234 → 1.2K；2,500,000 → 2.5M */
export function fmtTokens(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}

/** 成本格式化（纯函数，供单测）：>=0.01 两位小数，否则四位（小额不显示成 $0.00） */
export function fmtCost(usd) {
    const n = Number(usd) || 0;
    if (n === 0) return '$0.00';
    return '$' + (n >= 0.01 ? n.toFixed(2) : n.toFixed(4));
}

/** token 合计（纯函数，供单测）：input+output+reasoning（cache 单列不入合计） */
export function tokenTotal(t) {
    if (!t) return 0;
    return (Number(t.input) || 0) + (Number(t.output) || 0) + (Number(t.reasoning) || 0);
}

/** 范围键 → from/to 日期串（YYYY-MM-DD，本地时区；now 可注入便于单测） */
export function rangeDates(key, now) {
    const end = new Date(now === undefined ? Date.now() : now);
    const start = new Date(end);
    if (key === '7d') start.setDate(end.getDate() - 6);
    else if (key === '30d') start.setDate(end.getDate() - 29);
    // 'today' 与缺省：起止同日
    const ymd = (d) => d.getFullYear() + '-'
        + String(d.getMonth() + 1).padStart(2, '0') + '-'
        + String(d.getDate()).padStart(2, '0');
    return { from: ymd(start), to: ymd(end) };
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function renderStats(info) {
    setText('ocStatSessions', String(info.sessions || 0));
    setText('ocStatSubagents', String(info.subagents || 0));
    setText('ocStatPrompts', String(info.prompts || 0));
    setText('ocStatSteps', String(info.steps || 0));
    setText('ocStatTokens', fmtTokens(tokenTotal(info.tokens)));
    const tok = document.getElementById('ocStatTokens');
    if (tok && info.tokens) {
        tok.title = '输入 ' + fmtTokens(info.tokens.input)
            + ' / 输出 ' + fmtTokens(info.tokens.output)
            + ' / 推理 ' + fmtTokens(info.tokens.reasoning)
            + ' / 缓存读 ' + fmtTokens(info.tokens.cache && info.tokens.cache.read);
    }
    setText('ocStatCost', fmtCost(info.cost));
    setText('ocStatActiveDays', String(info.activeDays || 0));
    setText('ocStatStreak', String(info.streak || 0));

    // 每日活跃条形图（按 steps 归一到最大值；日期只标首尾与中间几个，避免拥挤）
    const actBox = document.getElementById('ocStatsActivity');
    if (actBox) {
        const days = Array.isArray(info.activity) ? info.activity : [];
        if (!days.length) {
            actBox.innerHTML = '<div class="oc-empty">范围内无活跃记录</div>';
        } else {
            const max = Math.max.apply(null, days.map(d => d.steps || 0).concat([1]));
            actBox.innerHTML = days.map(function (d) {
                const h = Math.max(2, Math.round(((d.steps || 0) / max) * 72));
                return '<div class="oc-stats-bar-col" title="' + escapeHtml(d.date) + '：' + (d.steps || 0) + ' 步">'
                    + '<div class="oc-stats-bar" style="height:' + h + 'px"></div>'
                    + '<div class="oc-stats-bar-date">' + escapeHtml(String(d.date || '').slice(5)) + '</div>'
                    + '</div>';
            }).join('');
        }
    }

    // 模型用量表
    const modelBox = document.getElementById('ocStatsModels');
    if (modelBox) {
        const models = Array.isArray(info.models) ? info.models : [];
        if (!models.length) {
            modelBox.innerHTML = '<div class="oc-empty">范围内无模型用量</div>';
        } else {
            modelBox.innerHTML = '<div class="oc-stats-row oc-stats-row-head">'
                + '<span>模型</span><span>步骤</span><span>Tokens</span><span>成本</span></div>'
                + models.map(function (m) {
                    const ref = m.model && m.model.providerID ? (m.model.providerID + '/' + m.model.id) : (m.model && m.model.id) || '未知模型';
                    return '<div class="oc-stats-row">'
                        + '<span class="oc-stats-model" title="' + escapeHtml(ref) + '">' + escapeHtml(ref) + '</span>'
                        + '<span>' + (m.steps || 0) + '</span>'
                        + '<span>' + fmtTokens(tokenTotal(m.tokens)) + '</span>'
                        + '<span>' + fmtCost(m.cost) + '</span>'
                        + '</div>';
                }).join('');
        }
    }

    // 工具调用汇总（tools=summary）
    const toolBox = document.getElementById('ocStatsTools');
    if (toolBox) {
        const t = info.tools && info.tools.totals;
        if (!t || !(t.calls > 0)) {
            toolBox.innerHTML = '<div class="oc-empty">范围内无工具调用</div>';
        } else {
            const rate = Math.round((t.succeeded / t.calls) * 1000) / 10;
            toolBox.innerHTML = '<div class="oc-stats-tools-line">'
                + '共 <b>' + t.calls + '</b> 次调用：成功 <b>' + t.succeeded + '</b>、'
                + '失败 <b>' + t.failed + '</b>、未完成 <b>' + (t.unfinished || 0) + '</b>'
                + '（成功率 ' + rate + '%）</div>';
        }
    }
}

/** 拉取并渲染（切到视图/改范围/点刷新时调用） */
export async function loadStatsView() {
    const rangeEl = document.getElementById('ocStatsRange');
    const key = rangeEl ? rangeEl.value : '7d';
    const { from, to } = rangeDates(key);
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { /* 无 Intl 环境时省略 */ }
    const qs = '?from=' + from + '&to=' + to + '&tools=summary' + (tz ? '&timezone=' + encodeURIComponent(tz) : '');
    try {
        const res = await api.OpenCodeCall('GET', '/api/experimental/session/stats' + qs);
        renderStats(unwrap(res) || {});
    } catch (e) {
        showApiError('加载会话统计失败: ', e);
    }
}

/** 绑定范围切换与刷新（main.js 初始化时挂一次） */
export function initStats() {
    const rangeEl = document.getElementById('ocStatsRange');
    if (rangeEl) rangeEl.onchange = loadStatsView;
    const btn = document.getElementById('btnRefreshStats');
    if (btn) btn.onclick = loadStatsView;
}

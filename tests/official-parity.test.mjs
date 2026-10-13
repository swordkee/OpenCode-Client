// 官方功能 parity 批的回归测试：排队队列管理 / 本轮改动（turn diff）/ 会话统计。
//
// 背景：「都抄」批——对齐官方 opencode web 的 v2 能力：
//   - inbox 管理（GET/PATCH/DELETE /api/session/{id}/inbox[/{inboxID}]）：
//     排队消息可见、可改插话（steer）、可撤回；
//   - turn diff（GET /api/session/{id}/diff）：最新一轮的文件改动弹窗；
//   - 会话统计（GET /api/experimental/session/stats）：范围概览视图。
// 纯函数直接 import 单测；接线（事件钩子/视图注册/DOM 锚点）用源码断言锁死。
//
// 运行：node tests/official-parity.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inboxItemLabel, inboxItemPreview, deliveryLabel } from "../frontend/dist/chat/inbox.js";
import { diffLineClass, diffStatusLabel, renderPatchHtml } from "../frontend/dist/chat/turn-diff.js";
import { fmtTokens, fmtCost, tokenTotal, rangeDates } from "../frontend/dist/views/stats.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, "..", "frontend", "dist", rel), "utf8");
const eventsSrc = read("chat/events.js");
const sessionSrc = read("chat/session.js");
const navSrc = read("chat/navigation.js");
const mainSrc = read("main.js");
const htmlSrc = read("index.html");
const cssSrc = read("css/style.css");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ============ inbox：纯函数 ============

test("inboxItemLabel 覆盖四类条目与未知兜底", () => {
    assert.equal(inboxItemLabel({ type: "user" }), "消息");
    assert.equal(inboxItemLabel({ type: "compaction" }), "压缩上下文");
    assert.equal(inboxItemLabel({ type: "move" }), "移动会话");
    assert.equal(inboxItemLabel({ type: "synthetic" }), "系统注入");
    assert.equal(inboxItemLabel({ type: "xyz" }), "未知项");
    assert.equal(inboxItemLabel(null), "未知项");
});

test("inboxItemPreview：user 取 payload.text 并压平空白，其余回退类型标签", () => {
    assert.equal(inboxItemPreview({ type: "user", payload: { text: "  hello\n\nworld  " } }), "hello world");
    assert.equal(inboxItemPreview({ type: "user", payload: { text: "   " } }), "（空消息）");
    assert.equal(inboxItemPreview({ type: "compaction", payload: {} }), "压缩上下文");
    assert.equal(inboxItemPreview(null), "");
});

test("deliveryLabel：steer=插话，queue=排队", () => {
    assert.equal(deliveryLabel("steer"), "插话");
    assert.equal(deliveryLabel("queue"), "排队");
});

// ============ turn diff：纯函数 ============

test("diffLineClass：文件头优先于 +/- 判定（+++ 不是新增行）", () => {
    assert.equal(diffLineClass("+++ b/app.js"), "meta");
    assert.equal(diffLineClass("--- a/app.js"), "meta");
    assert.equal(diffLineClass("diff --git a/x b/x"), "meta");
    assert.equal(diffLineClass("index 123..456 100644"), "meta");
    assert.equal(diffLineClass("@@ -1,3 +1,4 @@"), "hunk");
    assert.equal(diffLineClass("+added"), "add");
    assert.equal(diffLineClass("-removed"), "del");
    assert.equal(diffLineClass(" context"), "ctx");
});

test("diffStatusLabel：added/deleted/modified 中文徽标", () => {
    assert.equal(diffStatusLabel("added"), "新增");
    assert.equal(diffStatusLabel("deleted"), "删除");
    assert.equal(diffStatusLabel("modified"), "修改");
});

test("renderPatchHtml：逐行着色且 HTML 转义", () => {
    const html = renderPatchHtml("@@ -1 +1 @@\n-old\n+new\n<meta>");
    assert.ok(html.includes('oc-diff-hunk'), "hunk 行应有着色类");
    assert.ok(html.includes('oc-diff-del'), "删除行应有着色类");
    assert.ok(html.includes('oc-diff-add'), "新增行应有着色类");
    assert.ok(html.includes("&lt;meta&gt;"), "内容必须转义，防注入");
    assert.ok(!html.includes("<meta>"), "原始标签不得进入 HTML");
});

// ============ stats：纯函数 ============

test("fmtTokens：K/M 缩写与整数直出", () => {
    assert.equal(fmtTokens(999), "999");
    assert.equal(fmtTokens(1500), "1.5K");
    assert.equal(fmtTokens(2000), "2K");
    assert.equal(fmtTokens(2500000), "2.5M");
    assert.equal(fmtTokens(0), "0");
});

test("fmtCost：>=0.01 两位、非零小额四位、零 $0.00", () => {
    assert.equal(fmtCost(0), "$0.00");
    assert.equal(fmtCost(1.5), "$1.50");
    assert.equal(fmtCost(0.0034), "$0.0034");
});

test("tokenTotal：input+output+reasoning，cache 不入合计", () => {
    assert.equal(tokenTotal({ input: 100, output: 50, reasoning: 10, cache: { read: 9999, write: 0 } }), 160);
    assert.equal(tokenTotal(null), 0);
    assert.equal(tokenTotal({}), 0);
});

test("rangeDates：today 起止同日，7d 含今共 7 天，YYYY-MM-DD 格式", () => {
    const now = new Date(2026, 9, 13, 15, 30).getTime(); // 2026-10-13 15:30 本地
    assert.deepEqual(rangeDates("today", now), { from: "2026-10-13", to: "2026-10-13" });
    assert.deepEqual(rangeDates("7d", now), { from: "2026-10-07", to: "2026-10-13" });
    assert.deepEqual(rangeDates("30d", now), { from: "2026-09-14", to: "2026-10-13" });
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(rangeDates("7d", now).from), "必须是服务端要的 YYYY-MM-DD");
});

// ============ 接线：事件钩子 / 发送路径 / 视图注册 ============

test("events.js 监听 session.inbox.* 并防抖刷新队列", () => {
    assert.ok(eventsSrc.includes("startsWith('session.inbox.')"), "应有 inbox 事件前缀判断");
    assert.ok(eventsSrc.includes("scheduleInboxRefresh"), "应调用防抖刷新");
});

test("session.js 选会话与入队后都刷新队列", () => {
    assert.ok(/import\s*{[^}]*\bloadInbox\b[^}]*}\s*from\s*'\.\/inbox\.js'/.test(sessionSrc), "应导入 loadInbox");
    assert.ok(/markSessionViewed\(id, info\?\.idle\);\s*\r?\n\s*\/\/[^\n]*\r?\n\s*loadInbox\(id\)/.test(sessionSrc),
        "selectSession 标记已读后应拉队列");
});

test("navigation.js 注册 view-stats 懒加载", () => {
    assert.ok(navSrc.includes("view-stats"), "switchView 应有 view-stats 分支");
    assert.ok(navSrc.includes("loadStatsView"), "应调用 loadStatsView");
});

test("main.js 初始化三个新模块", () => {
    assert.ok(mainSrc.includes("initInbox()"), "应初始化队列管理");
    assert.ok(mainSrc.includes("initTurnDiff()"), "应初始化改动视图");
    assert.ok(mainSrc.includes("initStats()"), "应初始化统计视图");
});

// ============ DOM / 样式锚点 ============

test("index.html 具备全部新锚点", () => {
    for (const id of ["ocInboxBar", "ocInboxModal", "ocInboxList", "btnTurnDiff", "ocTurnDiffModal", "ocTurnDiffList",
        "view-stats", "ocStatsRange", "ocStatsActivity", "ocStatsModels", "ocStatsTools", "btnRefreshStats"]) {
        assert.ok(htmlSrc.includes('id="' + id + '"'), "缺少锚点 #" + id);
    }
    assert.ok(htmlSrc.includes('data-view="view-stats"'), "缺少统计导航项");
});

test("style.css 具备统计导航图标与新组件样式", () => {
    assert.ok(cssSrc.includes('[data-view="view-stats"] .nav-icon'), "统计导航图标样式缺失");
    assert.ok(cssSrc.includes(".oc-inbox-bar"), "队列条样式缺失");
    assert.ok(cssSrc.includes(".oc-diff-patch"), "diff 补丁样式缺失");
    assert.ok(cssSrc.includes(".oc-stats-activity"), "活跃条形图样式缺失");
});

// ============ 运行 ============

let failed = 0;
for (const [name, fn] of tests) {
    try {
        fn();
        passed++;
        console.log("  ok   " + name);
    } catch (e) {
        failed++;
        console.log("  FAIL " + name + "\n         " + (e && e.message ? e.message.split("\n")[0] : e));
    }
}
console.log("");
console.log(`${passed}/${tests.length} 通过` + (failed ? `，${failed} 失败` : ""));
process.exit(failed ? 1 : 0);

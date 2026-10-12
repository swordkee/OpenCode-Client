// 会话忙时消息排队（delivery=queue）与活动 tab 视觉区分的回归测试。
//
// 背景：v2 的 prompt 端点在会话忙时不接受默认投递（会被拒绝），须显式带
// delivery=queue 把消息停进 inbox，空闲后由服务端按序消化；官方 Web 的
// 对应体验是「忙时发送自动排队」。同时活动 tab 此前只有 6~8% 透明度的
// 底色差异，用户无法分辨当前 tab，需要底部指示条兜底。
//
// 运行：node tests/prompt-queue.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toPromptBody } from "../frontend/dist/core/v2compat.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sessionSrc = fs.readFileSync(path.join(HERE, "..", "frontend", "dist", "chat", "session.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(HERE, "..", "frontend", "dist", "css", "style.css"), "utf8");

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ============ toPromptBody：delivery 透传 ============

test("toPromptBody 透传 delivery=queue", () => {
    const out = toPromptBody({ parts: [{ type: "text", text: "hi" }], delivery: "queue" });
    assert.equal(out.delivery, "queue");
});

test("toPromptBody 不带 delivery 时输出无该键（闲时默认立即执行）", () => {
    const out = toPromptBody({ parts: [{ type: "text", text: "hi" }] });
    assert.ok(!("delivery" in out), "闲时不得带 delivery 字段");
});

// ============ 发送路径：忙时排队 ============

test("会话忙时 prompt 带 delivery=queue（服务端才会收下）", () => {
    assert.ok(
        /if \(isSessionBusy\(sid\)\) body\.delivery = 'queue'/.test(sessionSrc),
        "发送路径应在 isSessionBusy 时置 body.delivery='queue'"
    );
});

test("排队消息给出可见提示", () => {
    assert.ok(sessionSrc.includes("消息已排队"), "排队时应有 toast 提示");
});

test("排队消息不启动无响应看门狗（空闲前的静默是必然而非异常）", () => {
    assert.ok(
        /if \(body\.delivery !== 'queue'\) armPromptWatch\(sid\)/.test(sessionSrc),
        "排队消息应跳过 armPromptWatch"
    );
});

// ============ 活动 tab 视觉区分 ============

test("活动 tab 有底部指示条（accent-ghost 底色只有 6~8% 透明度，不足以分辨）", () => {
    const m = /\.oc-tab\.active\s*\{([^}]*)\}/.exec(cssSrc);
    assert.ok(m, "应存在 .oc-tab.active 规则");
    assert.ok(/box-shadow:\s*inset 0 -3px 0 var\(--accent\)/.test(m[1]), "活动 tab 应有 3px 底部指示条");
});

test("活动 tab 与 hover 态可区分（hover 无指示条）", () => {
    const m = /\.oc-tab:hover\s*\{([^}]*)\}/.exec(cssSrc);
    assert.ok(m, "应存在 .oc-tab:hover 规则");
    assert.ok(!/box-shadow/.test(m[1]), "hover 不得带指示条（否则与活动态混淆）");
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

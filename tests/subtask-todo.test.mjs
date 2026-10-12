// 子任务/代办提取的回归测试。
// 这两处依赖 V1 的工具名（task / todowrite），而 V2 改了名或直接移除，
// 是「界面恒空」类缺陷，只能靠测试守住。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "frontend", "dist", "chat", "sidepanel.js");
const src = fs.readFileSync(SRC, "utf8");

let passed = 0;
const tests = [];
const test = (n, f) => tests.push([n, f]);

// ===== 子任务提取：工具名 task → subagent =====

test("识别 v2 的 subagent 工具名（v1 为 task）", () => {
    assert.ok(src.includes("'subagent'"), "应识别 subagent");
    assert.ok(src.includes("'task'"), "应保留 v1 的 task 以兼容混合版本");
});

test("子任务判定不再写死 part.tool（改用 part.tool || part.name）", () => {
    assert.ok(
        !/part\.type !== 'tool' \|\| part\.tool !== 'task'/.test(src),
        "仍存在写死 part.tool !== 'task' 的判定"
    );
});

// 上游 35ca995 重构：子任务卡片不再扫描消息缓存里的 task/subagent tool part
//（打开会话只拉最近 20 条时面板恒空），改用会话列表字段作为数据源；
// 描述/原始任务不再从 tool state.input 捕获，弹窗改放子会话消息流。
test("子任务摘要取自会话列表字段（v2 新数据源）", () => {
    assert.ok(src.includes("childSessionId"), "列表项须带 childSessionId（点击定位/弹窗都靠它）");
    assert.ok(src.includes("s?.agent"), "agent 取自会话列表字段");
    assert.ok(src.includes("providerID"), "模型取自 s.model.providerID");
});

test("模型标签经 modelDisplayLabel 归一，缺省落 unknown", () => {
    // providerID/modelID 成对才拼 modelRef；缺任一侧落 'unknown'，不显示半截标签
    assert.ok(src.includes("modelDisplayLabel(modelRef)"), "模型标签经 modelDisplayLabel 归一");
    assert.ok(src.includes("'unknown'"), "agent/model 缺省有 unknown 兜底");
});

test("描述与原始任务为空时对应行隐藏（不显示空占位行）", () => {
    // 列表数据源下 description/promptPreview 恒为空串；弹窗须隐藏对应区块
    assert.ok(/descRow\.style\.display = desc \? '' : 'none'/.test(src), "desc 空时隐藏描述行");
    assert.ok(/promptCollapse\.style\.display = prompt \? '' : 'none'/.test(src), "prompt 空时隐藏原始任务折叠区");
});

// ===== 代办提取：todowrite 在 v2 被移除 =====

test("代办识别 todowrite 及其常见别名", () => {
    assert.ok(src.includes("TODO_TOOL_NAMES"), "应集中定义工具名列表");
    assert.ok(src.includes("'todowrite'"), "应保留 todowrite");
    assert.ok(src.includes("todo_write"), "应兼容 todo_write");
});

test("代办取值兼容 state.input.todos / state.todos / state.content", () => {
    assert.ok(/state\.input\s*&&\s*state\.input\.todos/.test(src), "应优先取 state.input.todos");
    assert.ok(/state\.todos/.test(src), "应兼容 state.todos");
    assert.ok(/state\.content/.test(src), "应兼容 state.content");
});

test("代办工具名不再写死 part.tool", () => {
    assert.ok(
        !/part\.tool !== 'todowrite' && part\.name !== 'todowrite'/.test(src),
        "仍存在写死 todowrite 的判定"
    );
});

// ===== 权限动作名覆盖 v2 全部动作 =====

test("ACTION_LABEL 覆盖 V2 官方工具文档中的全部动作", () => {
    const perm = fs.readFileSync(path.join(HERE, "..", "frontend", "dist", "chat", "permission.js"), "utf8");
    const m = perm.match(/const ACTION_LABEL = \{[\s\S]*?\};/);
    assert.ok(m, "未找到 ACTION_LABEL");
    const block = m[0];
    // V2 工具文档列出的动作
    for (const a of ["read", "edit", "write", "patch", "shell", "webfetch", "websearch",
                     "question", "skill", "subagent", "execute", "external_directory"]) {
        assert.ok(new RegExp("\\b" + a + "\\s*:").test(block), "ACTION_LABEL 缺少 v2 动作: " + a);
    }
    // v1 动作名保留以兼容混合版本
    for (const a of ["bash", "task", "glob", "grep"]) {
        assert.ok(new RegExp("\\b" + a + "\\s*:").test(block), "应保留 v1 动作: " + a);
    }
});

test("V2 动作名不再暴露为英文（bash→shell、task→subagent 都有中文）", () => {
    const perm = fs.readFileSync(path.join(HERE, "..", "frontend", "dist", "chat", "permission.js"), "utf8");
    const block = perm.match(/const ACTION_LABEL = \{[\s\S]*?\};/)[0];
    const get = (k) => (block.match(new RegExp("\\b" + k + "\\s*:\\s*'([^']+)'")) || [])[1];
    assert.ok(/[一-龥]/.test(get("shell") || ""), "shell 应有中文标签");
    assert.ok(/[一-龥]/.test(get("subagent") || ""), "subagent 应有中文标签");
});

// ===== 适配层：treeSession / 消息形状 =====

test("适配层不丢弃子会话（供侧栏按需取用）", async () => {
    const { adaptMessages } = await import("../frontend/dist/core/v2compat.js");
    const out = adaptMessages("ses_root", {
        data: [
            { id: "m1", type: "user", time: { created: 1 }, text: "hi" },
            { id: "m2", type: "assistant", time: { created: 2 }, content: [] },
        ],
    });
    assert.equal(out.length, 2, "消息层不做父子过滤（子会话是独立会话，需能单独打开）");
});

let failed = 0;
for (const [name, fn] of tests) {
    try {
        await fn();
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

// 待办（todo）能力检测的回归测试。
//
// 背景：OpenCode v2 移除了内置 todowrite 工具，改由配套插件
// （plugins/manager-todo.ts，id = oc-manager.todo）提供 todo_write。
// 右栏「代办」分区的显隐由此决定：插件在 → 显示；未装 → 整块隐藏
// （而不是留一个恒空标题，看起来像坏了）。
//
// 本文件覆盖：
//   1. core/utils.js 的 todoPluginAvailable 纯函数（真实 import，行为级断言）；
//   2. refreshTodoPanel / setTodoPanelRefreshHandler 的注册-触发-注销链路；
//   3. 源级守卫：service.js 必须由插件列表推导 todoSupported，
//      sidepanel.js 必须按 todoSupported 整块隐藏，且工具名集合需含 todo_write。
//
// 反向断言（重新引入 bug 必须让本文件失败）：
//   - 把 todoPluginAvailable 改成恒 true → 「其他插件不得误判为已加载」失败；
//   - 把 todoPluginAvailable 改成恒 false → 「识别配套插件」失败；
//   - 删掉 service.js 里的 store.todoSupported 赋值 → 源级守卫失败；
//   - 删掉 sidepanel.js 的 display:none 分支 → 源级守卫失败；
//   - TODO_TOOL_NAMES 去掉 todo_write → 源级守卫失败。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const { todoPluginAvailable, refreshTodoPanel, setTodoPanelRefreshHandler } =
    await import(pathToFileURL(path.join(ROOT, "frontend", "dist", "core", "utils.js")).href);
function pathToFileURL(p) {
    // 兼容 Windows 盘符路径，避免手写 file:// 前缀出错
    const resolved = path.resolve(p).replace(/\\/g, "/");
    return new URL("file://" + (resolved.startsWith("/") ? resolved : "/" + resolved));
}

const serviceSrc = fs.readFileSync(path.join(ROOT, "frontend", "dist", "chat", "service.js"), "utf8");
const sidepanelSrc = fs.readFileSync(path.join(ROOT, "frontend", "dist", "chat", "sidepanel.js"), "utf8");
const pluginSrc = fs.readFileSync(path.join(ROOT, "plugins", "manager-todo.ts"), "utf8");

let passed = 0;
const tests = [];
const test = (n, f) => tests.push([n, f]);

// ===== todoPluginAvailable：正常识别 =====

test("识别配套插件 id（oc-manager.todo）", () => {
    assert.equal(todoPluginAvailable([{ name: "oc-manager.todo", state: "loaded" }]), true);
});

test("识别部署文件名回退形态（路径含 manager-todo）", () => {
    // service.js 的 extractPluginList 在插件 id 缺失时会回退为 source.target（文件路径）
    assert.equal(
        todoPluginAvailable([{ name: "C:/Users/me/.config/opencode/plugins/manager-todo.ts" }]),
        true,
        "按文件名特征也要能识别，否则便携模式部署后分区不显示"
    );
});

test("对象形态的插件列表也支持（Object.values 兜底）", () => {
    assert.equal(todoPluginAvailable({ a: { id: "oc-manager.todo" } }), true);
});

test("字符串条目形态也支持", () => {
    assert.equal(todoPluginAvailable(["oc-manager.todo"]), true);
});

// ===== todoPluginAvailable：反向断言（不得误判） =====

test("其他插件不得误判为待办插件已加载", () => {
    assert.equal(todoPluginAvailable([{ name: "mcp-fetch" }, { name: "some-other" }]), false);
    assert.equal(todoPluginAvailable([{ name: "manager-todo-X".replace("-X", "") }]), true, "前缀含 manager-todo 应算命中");
});

test("空列表 / null / undefined / 非数组均判为未加载", () => {
    assert.equal(todoPluginAvailable([]), false);
    assert.equal(todoPluginAvailable(null), false);
    assert.equal(todoPluginAvailable(undefined), false);
    assert.equal(todoPluginAvailable(0), false);
    assert.equal(todoPluginAvailable(""), false);
});

test("条目缺 name 与 id 时不得抛错，判为未加载", () => {
    assert.equal(todoPluginAvailable([{}, null, undefined, 42]), false);
});

// ===== 刷新通道：注册 → 触发 → 注销 =====

test("注册后 refreshTodoPanel 触发回调；注销后不再触发且不抛错", () => {
    let hits = 0;
    setTodoPanelRefreshHandler(() => { hits++; });
    refreshTodoPanel();
    assert.equal(hits, 1, "注册后应触发一次");

    setTodoPanelRefreshHandler(null);
    refreshTodoPanel();
    assert.equal(hits, 1, "注销后不应再触发");

    // 未注册时调用不得抛错（service.js 的失败分支会走到这里）
    setTodoPanelRefreshHandler(undefined);
    assert.doesNotThrow(() => refreshTodoPanel());
    setTodoPanelRefreshHandler(function () { hits += 100; });
    refreshTodoPanel();
    assert.equal(hits, 101, "应接受函数并触发");
    setTodoPanelRefreshHandler(null);
});

// ===== 源级守卫：装配必须到位 =====

test("service.js 由插件列表推导 todoSupported（而非写死）", () => {
    assert.ok(
        serviceSrc.includes("todoPluginAvailable(store.pluginStatus)"),
        "必须从 /api/plugin 的插件列表推导待办能力"
    );
    assert.ok(serviceSrc.includes("refreshTodoPanel()"), "插件状态变化后必须触发面板刷新");
    // 三条关闭路径：加载失败、无目录、停止服务
    const closes = serviceSrc.match(/store\.todoSupported = false;/g) || [];
    assert.ok(closes.length >= 3, "加载失败/无目录/停止服务三条路径都要关闭待办能力，当前 " + closes.length + " 处");
});

test("sidepanel.js 按 todoSupported 整块隐藏代办分区", () => {
    assert.ok(sidepanelSrc.includes("setTodoPanelRefreshHandler(renderTodos)"), "必须向 core 层注册刷新入口");
    assert.ok(
        sidepanelSrc.includes("store.todoSupported === false ? 'none' : ''"),
        "未加载插件时必须整块分区隐藏（含标题），而不是渲染占位"
    );
    assert.ok(/TODO_TOOL_NAMES\s*=\s*\[[^\]]*'todo_write'/.test(sidepanelSrc), "工具名集合必须含 todo_write");
});

test("plugs/manager-todo.ts 插件存在且遵守零依赖约定", () => {
    assert.ok(pluginSrc.includes('id: "oc-manager.todo"'), "插件 id 必须与检测逻辑一致");
    assert.ok(pluginSrc.includes('name: "write"'), "工具名必须为 todo_write（命名空间 todo + write）");
    assert.ok(pluginSrc.includes("codemode: false"), "工具必须直接暴露，保证事件流中工具名干净");
    assert.ok(!/^\s*import\s/m.test(pluginSrc), "裸单文件插件禁止 import（否则服务端加载失败）");
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

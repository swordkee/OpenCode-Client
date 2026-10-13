// ============================================================
// module-imports.test.mjs — 静态导出/导入一致性检查
//
// 判例（2026-10-13 实证）：chat/btw.js 从 './render.js' 具名导入
// sanitizeMarkedHtml，而该函数早已迁往 core/sanitize.js——浏览器加载
// 模块图时抛 SyntaxError，**整个前端 init 静默死亡**（服务状态恒离线、
// 后端零调用），而 node 单测全绿（各套件按文件隔离 mock，看不见跨文件
// 具名导出漂移）。
//
// 本套件对 frontend/dist 下全部本地相对 import / re-export 做静态校验：
//   ① 目标文件存在；② 具名导入在目标文件里确有对应 export。
// 跳过 bindings/（wails 生成物）与 lib/（第三方压缩包，非模块图一环）。
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../frontend/dist');
const SKIP_DIRS = new Set(['bindings', 'lib', 'assets', 'css']);

/** 递归收集 dist 下参与模块图的 .js 文件。 */
function listModuleFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) listModuleFiles(full, out);
        else if (name.endsWith('.js')) out.push(full);
    }
    return out;
}

// import 子句解析：import/export 一律锚定行首（本仓静态导入的标准书写位置），
// 防止匹配到注释里出现的 "import ... from" 字样（判例：cmd-palette.js 头注释
// 「原先静态 import chat/session.js 造成循环依赖」曾跨行吞出幽灵 default 导入）。
// 覆盖 side-effect / default / namespace / named 四种形态：
//   `import def, { a, b as c } from './x.js'`、`import './x.js'`、
//   `import * as ns from './x.js'`、`export { a } from './x.js'`
const IMPORT_RE = /(?:^|\r?\n)[ \t]*(?:import|export)[ \t]+([^'";]*?)[ \t]+from[ \t]+['"](\.[^'"]+)['"]/g;
const SIDE_EFFECT_RE = /(?:^|\r?\n)[ \t]*import[ \t]*['"](\.[^'"]+)['"]/g;

/** 收集目标文件的具名导出（含 export { a, b as c } 与 export default）。 */
function collectExports(src) {
    const names = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
        names.add(m[1]);
    }
    for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
        for (const part of m[1].split(',')) {
            const p = part.trim();
            if (!p) continue;
            const as = p.split(/\s+as\s+/);
            names.add((as[1] || as[0]).trim());
        }
    }
    if (/export\s+default/.test(src)) names.add('default');
    return names;
}

/** 从 import 子句中取出需要校验的具名符号（default 按 'default' 校验）。 */
function namedSymbolsOf(clause) {
    const symbols = [];
    const brace = clause.match(/\{([^}]*)\}/);
    const head = clause.replace(/\{[^}]*\}/, '').trim().replace(/,$/, '');
    if (head && !head.startsWith('*')) symbols.push('default');
    if (brace) {
        for (const part of brace[1].split(',')) {
            const p = part.trim();
            if (!p) continue;
            symbols.push(p.split(/\s+as\s+/)[0].trim());
        }
    }
    return symbols;
}

test('dist 模块图：本地具名导入与目标导出一致', () => {
    const files = listModuleFiles(DIST);
    assert.ok(files.length > 30, `dist 模块文件数异常（${files.length}），目录定位可能错了`);
    const exportCache = new Map();
    const violations = [];
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        const seen = new Set();
        for (const m of src.matchAll(IMPORT_RE)) seen.add(JSON.stringify([m[1] ?? null, m[2]]));
        for (const m of src.matchAll(SIDE_EFFECT_RE)) seen.add(JSON.stringify([null, m[1]]));
        for (const item of seen) {
            const [clause, spec] = JSON.parse(item);
            if (!spec) continue;
            let target = resolve(dirname(file), spec);
            if (!target.endsWith('.js')) target += '.js';
            const relFile = file.slice(DIST.length + 1);
            if (!existsSync(target)) {
                violations.push(`${relFile}: 导入不存在的文件 ${spec}`);
                continue;
            }
            if (clause === null) continue; // side-effect import，只验文件存在
            if (!exportCache.has(target)) exportCache.set(target, collectExports(readFileSync(target, 'utf8')));
            const exports = exportCache.get(target);
            for (const sym of namedSymbolsOf(clause)) {
                if (!exports.has(sym)) {
                    violations.push(`${relFile}: 从 ${spec} 导入的 '${sym}' 不存在（该文件无此具名导出）`);
                }
            }
        }
    }
    assert.deepEqual(violations, [], `发现 ${violations.length} 处导入/导出漂移：\n  - ${violations.join('\n  - ')}`);
});

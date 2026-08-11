---
title: isFullUrl 字段重命名实施计划
covers_file: [src/modules/store.js, src/modules/attachments.js, src/modules/shared.js, src/modules/main.js, tests/endpoint-tree.test.js]
depends_on: [../modules/ui.md, ../modules/store.md]
api_signature: isFullUrl endpoint flag and request arguments
last_updated: 2026-08-07
why_exists: 将含义不清的 directUrl 布尔字段统一改为 isFullUrl 并兼容已有数据
---

# isFullUrl 字段重命名实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将端点的 `directUrl` 布尔字段统一改名为语义明确的 `isFullUrl`，保留旧数据读取能力并修正显式 `false` 的继承。

**Architecture:** 数据模型只在写入时使用 `isFullUrl`；配置解析在读取旧数据时把 `directUrl` 作为一次性兼容来源，并用“字段是否存在”区分未设置和显式 false。请求层、表单层和测试全部使用 `isFullUrl`，构建脚本重新生成单页和扩展产物。

**Tech Stack:** 原生 JavaScript、Node.js `node:test`/`vm`、浏览器 localStorage、现有单页构建脚本。

## Global Constraints

- 新字段名称必须是 `isFullUrl`，值必须是布尔语义。
- 读取已有数据时兼容 `directUrl`；`isFullUrl` 存在时优先，旧字段只作 fallback。
- 子节点显式 `isFullUrl: false` 必须覆盖父节点 `true`；字段未设置才继承父值。
- 不改变完整 URL 与 provider 路径拼接的现有行为。
- 不修改 `restoreEndpoints`、清空流程或 storage facade import rollback；这些属于独立后续问题。
- 修改代码后使用 Tab/LF；验收前不提交、不更新版本号。

---

### Task 1: 数据模型与解析链路改名

**Files:**
- Modify: `src/modules/store.js`（节点默认值、继承解析、cloneNode、配置字段兼容）
- Modify: `src/modules/attachments.js`（连接测试配置字段）
- Modify: `src/modules/shared.js`（请求函数参数与完整 URL 分支）
- Modify: `src/modules/main.js`（调用请求函数时的参数名）
- Modify: `src/modules/attachments.js`（表单读取、保存和连接测试字段）
- Test: `tests/endpoint-tree.test.js`

**Interfaces:**
- Consumes: 节点对象可能包含 `isFullUrl`、旧数据可能包含 `directUrl`。
- Produces: `resolveNodeConfig(nodeId)` 返回 `isFullUrl`；`callProvider`、`callAPI`、`callEmbedding`、`callImageGeneration`、`callVideoGeneration`、`callTTS`、`callASR` 的布尔参数统一命名/传递为 `isFullUrl`。

- [x] **Step 1: 写失败测试**

在 `tests/endpoint-tree.test.js` 增加最小测试，直接加载真实 `store.js` 相关函数或使用现有 VM harness，覆盖：

```js
assert.equal(resolveNodeConfig('child-false').isFullUrl, false);
assert.equal(resolveNodeConfig('child-inherited').isFullUrl, true);
assert.equal(resolveNodeConfig('legacy').isFullUrl, true);
assert.equal(resolveNodeConfig('new-wins').isFullUrl, false);
```

其中：父节点设置 `isFullUrl: true`；`child-false` 显式设置 false；`child-inherited` 不设置新字段；`legacy` 只设置 `directUrl: true`；`new-wins` 同时设置 `isFullUrl: false` 与 `directUrl: true`。再增加保存/复制断言：新节点数据只写 `isFullUrl`，`cloneNode` 保留该字段且不产生 `directUrl`。

- [x] **Step 2: 运行测试确认 RED**

Run: `node --test --test-name-pattern="isFullUrl" tests/endpoint-tree.test.js`

Expected: FAIL，因为当前解析仍返回 `directUrl`，显式 false 会被父值覆盖，新增/复制路径仍写旧字段。

- [x] **Step 3: 修改节点数据模型和继承解析**

将节点字段写入从：

```js
directUrl: data.directUrl || false
```

改为：

```js
isFullUrl: data.isFullUrl === undefined ? !!data.directUrl : !!data.isFullUrl
```

解析继承使用字段存在性，而不是 truthy：

```js
function hasOwn(object, key) {
	return Object.prototype.hasOwnProperty.call(object, key);
}

function resolveInheritedBoolean(node, key, legacyKey, parentValue) {
	if (hasOwn(node, key)) return !!node[key];
	if (legacyKey && hasOwn(node, legacyKey)) return !!node[legacyKey];
	return parentValue;
}
```

实际实现可复用项目已有辅助函数，但必须保持以下结果：`isFullUrl: false` 不被父值覆盖，未设置新字段时才读取 `directUrl` 或父值。`cloneNode` 的深拷贝字段改为 `isFullUrl`。

- [x] **Step 4: 修改表单和请求链路**

将 `selected-endpoints.js` 的 checkbox、保存对象和相关注释从 `directUrl` 改为 `isFullUrl`；将请求函数参数、调用处和 `rcfg` 读取统一改为 `isFullUrl`。所有完整 URL 分支保持原条件：

```js
if (isFullUrl) request.url = baseUrl.replace(/\/+$/, '');
```

读取旧数据只在解析边界兼容，不在每个请求函数内散落 `directUrl` fallback。

- [x] **Step 5: 运行测试确认 GREEN**

Run: `node --test --test-name-pattern="isFullUrl" tests/endpoint-tree.test.js`

Expected: 新增字段、旧字段 fallback、显式 false 继承覆盖、保存和复制测试全部 PASS。

- [x] **Step 6: 运行既有回归测试**

Run: `node --test tests/storage.test.js tests/endpoint-tree.test.js`

Expected: 全部通过，且原有端点树/存储回归无新增失败。

---

### Task 2: 文档、构建和一致性验证

**Files:**
- Modify: `docs/modules/ui.md`（字段命名和完整 URL 语义）
- Modify: `docs/modules/store.md`（端点数据模型和旧字段兼容说明）
- Modify: `docs/superpowers/specs/2026-08-06-is-full-url-design.md`（若创建设计记录）
- Modify: `src/layout.html`、`kuai-lian-ai.html`、`dist/`（由构建脚本生成）

- [x] **Step 1: 更新模块文档**

记录 `isFullUrl` 是布尔开关，描述旧 `directUrl` 仅在读取时兼容；追加 `2026-08-06` 决策日志，不保留误导性的 `directUrl` 主命名。

- [x] **Step 2: 静态检查和构建**

Run:

```bash
node --check src/modules/store.js
node --check src/modules/attachments.js
node --check src/modules/api.js
node --check src/modules/main.js
node --check src/modules/selected-endpoints.js
node --check tests/endpoint-tree.test.js
node build.js
python3 scripts/check-docs-format.py
git diff --check HEAD
```

Expected: 语法、构建、文档格式和 diff 检查全部通过。

- [x] **Step 3: 核对旧字段残留与产物**

已对源码模块搜索 `directUrl`：仅保留在旧数据兼容读取、迁移和归一化说明中；请求分支、表单字段、节点写入和构建产物均使用 `isFullUrl`。已确认根单页与 `dist/kuai-lian-ai.html` 一致，扩展 `app.js` 与源码模块包含同名字段。`restoreEndpoints`、清空流程、`storage.importAll` 仍按 Global Constraints 保留为后续问题。

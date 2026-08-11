---
title: 端点删除失败后的 UI 状态回滚实施计划
covers_file: [src/modules/main.js, src/modules/store.js, src/modules/attachments.js, tests/endpoint-tree.test.js]
depends_on: [../modules/main.md, ../modules/store.md]
api_signature: handleNodeDelete and deleteNode failure behavior
last_updated: 2026-08-11
why_exists: 删除端点持久化失败时保持端点树、选中端点、连接状态、折叠状态和 DOM 一致
---

# 端点删除失败后的 UI 状态回滚实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 端点删除持久化失败时不提前改变 UI 和选择状态，成功后再执行局部 DOM 清理。

**Architecture:** `deleteNode()` 继续作为端点树和 selectedEndpoints 的事务边界；`handleNodeDelete()` 在调用事务前只保存删除后 UI 清理需要的节点 ID 与 DOM 引用，不执行任何副作用。事务成功后再失效连接测试、清理状态、移除 DOM 并刷新其余 UI，失败则原样保留当前页面。

**Tech Stack:** 原生 JavaScript、Node.js `node:test`/`vm` harness、浏览器 DOM、现有构建脚本。

## Global Constraints

- 删除失败时不移除端点 DOM，不修改 `selectedEndpoints`，不删除 `connectionStatus`，不改变折叠状态，不使正在进行的连接测试失效。
- 删除成功时保持当前局部 DOM 删除和滚动位置行为。
- 不重构 Store mutation queue，不扩大到删除会话或 storage facade 问题。
- 每个独立问题只增加 1 个最小根因回归测试；不建设完整异常矩阵。
- 使用 Tab/LF；版本号仅在用户验收通过后更新；本计划执行阶段不提交。

---

### Task 1: 删除失败不提前产生 UI 副作用

**Files:**
- Modify: `src/modules/main.js:439-467`
- Test: `tests/endpoint-tree.test.js`

**Interfaces:**
- Consumes: `collectDescendantIds(nodeId)`、`deleteNode(nodeId)`、`clearTestResults(nodeId)`、`invalidateConnectionTest()`、`connectionStatus`、`collapsedEndpoints`、`refreshUI()`。
- Produces: `handleNodeDelete(nodeId)`：先等待 `deleteNode(nodeId)` 成功，再执行 UI/连接状态清理；删除失败直接抛出原错误且不改变 UI 状态。

- [x] **Step 1: 写失败测试**

增加一个只抽取真实 `handleNodeDelete` 的 VM harness。初始状态包含：

```js
selectedEndpoints: ['node-1', 'other-1'],
connectionStatus: new Map([['node-1', 'connected']]),
collapsedEndpoints: new Set(['node-1']),
nodeElement: { remove() { removed = true; }, closest() { return parentContainer; } }
```

让 `deleteNode()` 记录调用但返回 rejected Promise；调用 `handleNodeDelete('node-1')`，断言 rejection 为原始错误，并断言：

```js
assert.deepEqual(selectedEndpoints, ['node-1', 'other-1']);
assert.equal(connectionStatus.has('node-1'), true);
assert.equal(collapsedEndpoints.has('node-1'), true);
assert.equal(removed, false);
assert.equal(clearTestResultsCalls, 0);
assert.equal(refreshUICalls, 0);
```

- [x] **Step 2: 运行测试确认 RED**

Run:

```bash
node --test --test-name-pattern="handleNodeDelete keeps UI state when persistence fails" tests/endpoint-tree.test.js
```

Expected: FAIL，因为当前实现会在 `deleteNode()` rejection 前先过滤 selectedEndpoints、清理状态并移除 DOM。

- [x] **Step 3: 实现最小顺序修复**

将 `handleNodeDelete()` 调整为：

```js
async function handleNodeDelete(nodeId) {
	const allIds = collectDescendantIds(nodeId);
	const nodeEl = document.querySelector('.one.endpoint[data-node-id="' + nodeId + '"]');
	const parentContainer = nodeEl ? nodeEl.closest('ol') : null;

	await deleteNode(nodeId);

	allIds.forEach(function(id) {
		invalidateConnectionTest(id);
		connectionStatus.delete(id);
		collapsedEndpoints.delete(id);
	});
	if (nodeEl) nodeEl.remove();
	if (parentContainer) {
		const parentEndpoint = parentContainer.closest('.one.endpoint');
		if (parentEndpoint) updateEndpointTestUI(parentEndpoint.dataset.nodeId);
	}
	await refreshUI({ skipEndpointTree: true });
	updateEmptyState();
}
```

不要在 `handleNodeDelete()` 中再次过滤或保存 `selectedEndpoints`；成功删除时由 `deleteNode()` 的事务逻辑完成选择清理。不要 catch 后吞掉错误，保留现有 rejection 语义。

- [x] **Step 4: 运行 focused 测试确认 GREEN**

Run:

```bash
node --test --test-name-pattern="handleNodeDelete keeps UI state when persistence fails" tests/endpoint-tree.test.js
```

Expected: PASS。

- [x] **Step 5: 运行相关回归**

Run:

```bash
node --test tests/storage.test.js tests/endpoint-tree.test.js
```

Expected: 全部通过。

---

### Task 2: 文档、构建与最终验证

**Files:**
- Modify: `docs/modules/main.md`
- Modify: `docs/superpowers/plans/2026-08-11-endpoint-delete-rollback.md`
- Generated: `kuai-lian-ai.html`, `dist/` via `node build.js`

- [x] **Step 1: 更新模块文档**

在 `docs/modules/main.md` 的 `handleNodeDelete` 函数说明和决策日志中记录：删除事务成功后才清理连接/折叠状态、移除 DOM；持久化失败保留页面和选择状态。

- [x] **Step 2: 运行静态验证和构建**

Run:

```bash
node --check src/modules/main.js
node --check tests/endpoint-tree.test.js
python3 scripts/check-docs-format.py
git diff --check HEAD
node build.js
```

Expected: 全部命令成功。

- [x] **Step 3: 核对产物和运行时**

确认根单页与 `dist/kuai-lian-ai.html` 内容一致，扩展 `app.js` 包含修复；使用 Chrome/Playwright 加载页面并检查 console.error。真实失败回滚交互如无法构造持久化失败，记录为未覆盖，不用伪造通过证据。

- [x] **Step 4: 更新计划和验证证据**

把本计划完成步骤改为 `[x]`，在 `findings.md` 和 `task_plan.md` 追加根因、测试和构建证据；不更新版本号、不提交，直到用户明确验收通过。

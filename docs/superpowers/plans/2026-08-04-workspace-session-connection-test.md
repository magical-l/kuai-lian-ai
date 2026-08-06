---
title: Workspace/Session 参数一致性与连接测试单飞实施计划
covers_file: [src/modules/selected-endpoints.js, src/modules/attachments.js, src/modules/main.js, tests/endpoint-tree.test.js]
depends_on: [../specs/2026-08-04-workspace-session-and-connection-test-design.md]
api_signature: Task 1-3 implementation plan
last_updated: 2026-08-05
why_exists: 将参数双写和连接测试并发修复拆为可验证任务
---

# Workspace/Session 参数一致性与连接测试单飞实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 workspace/session 参数双写分叉，并让同一端点的连接测试在同一时间只发起一个请求且忽略过期结果。

**Architecture:** 在 `selected-endpoints.js` 增加只服务参数编辑器的局部事务 helper，保存/重置共用它，不改 storage/store 全局事务。`attachments.js` 维护按 nodeId 的 in-flight Promise 和 generation；重复调用复用 Promise，清理/编辑/删除/移动时递增 generation 使旧请求不能回写。

**Tech Stack:** 原生 JavaScript、Node.js `node:test`/`vm` 测试、浏览器 `localStorage`、现有 `updateSession()` 与 `connectionStatus`。

## Global Constraints

- 不把 localStorage workspace 参数纳入 storage facade/store 的全局事务。
- 不引入批量测试调度器或全局取消请求 UI。
- 保存和重置任一步骤失败都恢复 workspace 内存与 localStorage，弹窗保持打开；非空 `sessionId` 的 `updateSession()` 返回 `null` 也视为失败并抛出“目标会话不存在或未保存”，空 `sessionId` 不调用它。
- 同一 `nodeId` 重复测试复用同一 Promise；失效仅增加 generation，不取消 fetch 或移除 in-flight Promise。清除后同节点再测仍复用 P1，P1 settled 的 `finally` 清理后才允许 P2，且 P1 结果不得回写已清除/编辑后的状态。
- 每个问题只增加最小根因回归测试，不建设完整异常矩阵。
- 使用 Tab 缩进；文件使用 LF；不更新版本号，不提交。

---

### Task 1: 参数编辑器双写事务

**Files:**
- Modify: `src/modules/selected-endpoints.js:1-145`
- Test: `tests/endpoint-tree.test.js`（新增 selected-endpoints harness 与最小回归测试）
- Reference: `docs/superpowers/specs/2026-08-04-workspace-session-and-connection-test-design.md`

**Interfaces:**
- Consumes: 当前全局 `defaultSelectedEndpointParams`、dialog 打开时快照并固定传入的 `sessionId`、`updateSession(sessionId, mutator)`、`saveDefaultSelectedEndpointParams()`。
- Produces: 一个供保存和重置共同调用的局部 async helper；失败时恢复 workspace 内存/localStorage 并重新抛出原错误，调用方负责保持 dialog 打开。

- [x] **Step 1: 写失败测试 harness**

已在 `tests/endpoint-tree.test.js` 增加 `selected-endpoints.js` 源码路径和一个只暴露 helper 的 VM harness。使用内存 `localStorage`（`getItem/setItem/removeItem`），覆盖 `setItem` 成功、`updateSession` 修改 session 后抛出错误，以及非空 `sessionId` 下 `updateSession()` 返回 `null` 的失败路径。断言 helper 失败后：

```js
assert.deepEqual(defaultSelectedEndpointParams, workspaceBefore);
assert.equal(localStorage.getItem('defaultSelectedEndpointParams'), rawWorkspaceBefore);
assert.deepEqual(currentSession.modelParams, sessionBefore);
```

同一测试再调用重置目标，确认重置也经过相同 helper，并在 `updateSession` 失败后恢复 endpoint workspace 项和 localStorage 原始字符串。

- [x] **Step 2: 运行测试确认 RED**

已运行：`node --test tests/endpoint-tree.test.js --test-name-pattern="workspace/session parameter transaction"`。

结果：初始实现未将 `updateSession()` 返回 `null` 视为失败，随后按最小修复完成。

- [x] **Step 3: 实现最小事务 helper**

已在 `src/modules/selected-endpoints.js` 中增加局部函数：

```js
async function persistEndpointParamsTransaction(endpointId, nextWorkspaceParams, sessionId, updateSessionParams) {
	const previousWorkspaceParams = Object.prototype.hasOwnProperty.call(defaultSelectedEndpointParams, endpointId)
		? JSON.parse(JSON.stringify(defaultSelectedEndpointParams[endpointId]))
		: undefined;
	const previousWorkspaceRaw = localStorage.getItem('defaultSelectedEndpointParams');
	try {
		if (nextWorkspaceParams === undefined) delete defaultSelectedEndpointParams[endpointId];
		else defaultSelectedEndpointParams[endpointId] = JSON.parse(JSON.stringify(nextWorkspaceParams));
		saveDefaultSelectedEndpointParams(defaultSelectedEndpointParams);
		if (sessionId) await updateSession(sessionId, updateSessionParams);
	} catch (error) {
		if (previousWorkspaceParams === undefined) delete defaultSelectedEndpointParams[endpointId];
		else defaultSelectedEndpointParams[endpointId] = previousWorkspaceParams;
		if (previousWorkspaceRaw === null) localStorage.removeItem('defaultSelectedEndpointParams');
		else localStorage.setItem('defaultSelectedEndpointParams', previousWorkspaceRaw);
		throw error;
	}
}
```

若 workspace 写入抛错，`updateSession` 不得被调用；非空 `sessionId` 下若 `updateSession` 抛错或返回 `null`，helper 均恢复 workspace 后抛出（`null` 对应“目标会话不存在或未保存”）。空 `sessionId` 不调用 `updateSession`。不要在 helper 中重复回滚 session，由现有 `updateSession` 负责。

- [x] **Step 4: 接入保存和重置**

将保存 handler 中直接执行的：

```js
defaultSelectedEndpointParams[endpointId] = params;
saveDefaultSelectedEndpointParams(defaultSelectedEndpointParams);
if (sessionId) await updateSession(sessionId, ...);
```

替换为一次 `persistEndpointParamsTransaction(endpointId, params, sessionId, session => { ... })` 调用；四个参数中的 `sessionId` 必须是 dialog 打开时快照的固定值，保存时不得再读取 action-time 的 `currentSession`。成功后才关闭 dialog。catch 中调用现有错误提示（若项目没有专用函数，使用 `alert('参数保存失败：' + error.message)`），不关闭 dialog。

将 reset handler 的 workspace 删除和 session 删除也改为同一四参数调用 `persistEndpointParamsTransaction(endpointId, undefined, sessionId, session => { ... })`；其中 `sessionId` 沿用 dialog 打开时快照的固定值，不得在重置时读取 action-time 的 `currentSession`。成功后才重新渲染默认参数；失败时不覆盖当前编辑控件内容，保留 dialog 打开并提示错误。

- [x] **Step 5: 运行参数事务测试确认 GREEN**

已运行：`node --test tests/endpoint-tree.test.js --test-name-pattern="workspace/session parameter transaction"`。

结果：PASS。

- [x] **Step 6: 运行相关回归测试**

已运行：`node --test tests/storage.test.js tests/endpoint-tree.test.js`。

结果：所有相关测试通过。

---

### Task 2: 连接测试单飞与过期结果失效

**Files:**
- Modify: `src/modules/attachments.js:1153-1284`
- Modify: `src/modules/main.js:410-480`（确保编辑/删除/移动路径调用失效逻辑，不改变已有 UI 顺序）
- Test: `tests/endpoint-tree.test.js`（扩展现有 testConnection VM harness）
- Reference: `docs/superpowers/specs/2026-08-04-workspace-session-connection-test-design.md`

**Interfaces:**
- Consumes: `connectionStatus`、`updateEndpointTestUI()`、现有 `testConnection()` 测试请求逻辑、`clearTestResults()` 调用点。
- Produces: `testConnection(nodeId)` 返回可共享的 Promise；`invalidateConnectionTest(nodeId)` 使当前请求结果失效；`clearTestResults(nodeId)` 清理后代状态并失效对应请求。

- [x] **Step 1: 写单飞失败测试**

已在现有 `testConnection` VM harness 中，将 `fetchWithTimeout` 改为返回一个可控 Promise，并连续调用：

```js
const first = testContext.__testConnection('chat');
const second = testContext.__testConnection('chat');
assert.strictEqual(first, second);
assert.equal(fetchCalls, 1);
resolveFetch({ ok: true, headers: { get() { return 'text/plain'; } } });
await first;
```

再调用一次，断言上一请求完成后新调用会发起第二次 fetch。测试名称：`testConnection reuses one in-flight Promise per node and allows a later retry`。

- [x] **Step 2: 运行测试确认 RED**

已运行：`node --test tests/endpoint-tree.test.js --test-name-pattern="in-flight Promise"`。

结果：初始实现会创建两个 Promise 并调用两次 fetch，随后按最小修复完成。

- [x] **Step 3: 写过期结果失败测试**

已让请求挂起，启动 `testConnection('chat')`，调用 `clearTestResults('chat')`，再让 fetch 完成。断言 `connectionStatus.has('chat') === false`，且不会因旧请求完成重新调用 `updateEndpointTestUI` 写入新状态；同时覆盖清除后同节点再测仍复用 P1、仅待 P1 settled 的 `finally` 清理后才允许 P2。

Run: `node --test tests/endpoint-tree.test.js --test-name-pattern="stale connection test"`

Expected: FAIL，现有实现会在请求完成后重新写入 `connected`。

- [x] **Step 4: 实现 in-flight/generation 保护**

已在 `attachments.js` 的 `connectionStatus` 旁增加：

```js
const connectionTestsInFlight = new Map();
const connectionTestGenerations = new Map();
```

提供：

```js
function getConnectionTestGeneration(nodeId) {
	return connectionTestGenerations.get(nodeId) || 0;
}

function invalidateConnectionTest(nodeId) {
	connectionTestGenerations.set(nodeId, getConnectionTestGeneration(nodeId) + 1);
}
```

已重构 `testConnection(nodeId)`：外层负责资格检查和复用已有 Promise，内部 Promise 捕获现有请求逻辑，并在每次状态写入前检查 generation。`finally` 只删除仍对应当前 Promise 的 map 项。重复调用返回同一个 Promise；失效不取消 fetch、不删除 in-flight Promise，只阻止旧结果写入。因此清除后同节点再测继续复用 P1，P1 settled 的 `finally` 清理后才允许 P2。

- [x] **Step 5: 让清理路径失效旧请求**

在 `clearTestResults(nodeId)` 中，对 nodeId 及后代先调用 `invalidateConnectionTest(id)`，再删除 `connectionStatus`。确认 `main.js` 的编辑、删除、移动路径继续调用 `clearTestResults()`，必要时只补充缺失的调用，不重排现有 DOM/Store 操作。

- [x] **Step 6: 运行单飞与过期测试确认 GREEN**

已运行：`node --test tests/endpoint-tree.test.js --test-name-pattern="in-flight Promise|stale connection test"`。

结果：新增测试全部通过。

- [x] **Step 7: 运行相关回归测试**

已运行：`node --test tests/storage.test.js tests/endpoint-tree.test.js`。

结果：所有相关测试通过。

---

### Task 3: 文档、静态检查与构建验证

**Files:**
- Modify: `docs/modules/selected-endpoints.md`（若该文档存在；若不存在，在 `docs/index.md` 对应模块索引中登记本次决策）
- Modify: `docs/modules/ui.md`（更新连接测试单飞/过期结果行为）
- Modify: `task_plan.md`、`findings.md`、`progress.md`（追加本批结果）

- [x] **Step 1: 更新模块文档**

已记录参数编辑器的 workspace/session 双写回滚边界、连接测试单飞与失效规则，并追加 `2026-08-05` 决策日志；不写行号。

- [x] **Step 2: 运行最终验证**

Run:

```bash
node --test tests/storage.test.js tests/endpoint-tree.test.js
node --check src/modules/selected-endpoints.js
node --check src/modules/attachments.js
node --check src/modules/main.js
node build.js
python3 scripts/check-docs-format.py
git diff --check HEAD
```

Expected: 定向测试全通过、语法检查通过、构建成功、文档格式正确、diff 无空白错误。

- [x] **Step 3: 核对构建产物与工作树**

已确认 `kuai-lian-ai.html` 与 `dist/kuai-lian-ai.html` 同步，`dist/extension/app.js` 包含新 helper 和 in-flight map；工作树保留本批收尾改动，版本已更新为 v6.32.5，待用户验收后提交。

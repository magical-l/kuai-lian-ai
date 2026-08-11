---
title: 删除生成中会话异步失效实施计划
covers_file: [src/modules/api.js, src/modules/shared.js, src/modules/main.js, tests/endpoint-tree.test.js]
depends_on: [../specs/2026-08-09-session-delete-invalidation-design.md]
api_signature: session invalidation and abort lifecycle
last_updated: 2026-08-11
why_exists: 记录删除生成中会话的分步实现、测试和验证边界
---

# 删除生成中会话异步失效实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除正在生成的会话后立即 abort 其请求，并丢弃所有迟到结果，避免会话被异步消息重新写回或复活。

**Architecture:** 在 `api.js` 增加内存级 session invalidation 集合，并让生成状态保存可统一 abort 的控制器。`main.js` 在删除入口先失效会话，在所有非流式/流式回写边界检查失效状态；`shared.js` 负责把 AbortSignal 传给聊天和非流式请求的实际 fetch，`attachments.js` 只保留现有 fetch 工具，不承载会话业务判断。

**Tech Stack:** 原生 JavaScript、浏览器 `AbortController`/`fetch`、Node.js `node:test` + `vm` harness、现有单页构建脚本。

## Global Constraints

- 保留现有会话删除二次确认，不改为禁用删除。
- 删除生成中会话采用“失效标记 + abort + 回写边界拦截”。
- 不引入持久化 tombstone，不重构 Store mutation queue。
- 已失效会话不得更新卡片、写入 assistant 消息或在 finally 中重新加载。
- 正常会话生成、停止、失败和删除行为保持不变。
- 每个独立问题只增加一个直接复现根因的最小回归测试，不扩展完整 provider/错误矩阵。
- 使用 Tab/LF；验收前不更新版本号、不提交。

---

### Task 1: 会话失效状态与聊天生成 abort

**Files:**
- Modify: `src/modules/api.js`
- Modify: `src/modules/shared.js`
- Modify: `src/modules/main.js`
- Test: `tests/endpoint-tree.test.js`

**Interfaces:**
- Produces in `api.js`: `invalidateSession(sessionId)`, `isSessionInvalidated(sessionId)`, `clearSessionInvalidation(sessionId)`.
- `deleteSessionGenerations(sessionId)` continues to abort and remove endpoint generation states.
- `callAllModels(..., sessionId)` must not call `onChunk` after `isSessionInvalidated(sessionId)` becomes true.
- `handleSessionDelete(sessionId)` invalidates before aborting/deleting.

- [x] **Step 1: Add a failing invalidation test**

在 `tests/endpoint-tree.test.js` 的 API/生成 harness 中增加最小测试，暴露 `api.js` 的函数：

```js
test('deleting a generating session invalidates it before aborting generation', () => {
	const harness = createGenerationApiHarness();
	const controller = new AbortController();
	harness.api.getSessionGenerations('session-1').set('endpoint-1', {
		abortController: controller,
		status: 'generating'
	});

	harness.api.invalidateSession('session-1');
	harness.api.deleteSessionGenerations('session-1');

	assert.equal(harness.api.isSessionInvalidated('session-1'), true);
	assert.equal(controller.signal.aborted, true);
});
```

Harness 只提供真实 `api.js` 源码和最小 `sessionGenerations` Map，不 mock 生产函数。

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test --test-name-pattern="invalidates it before aborting" tests/endpoint-tree.test.js`

Expected: FAIL because invalidation functions are not defined/exposed.

- [x] **Step 3: Implement the in-memory invalidation set**

在 `src/modules/api.js` 的 `sessionGenerations` 附近增加：

```js
const invalidatedSessionIds = new Set();

function invalidateSession(sessionId) {
	invalidatedSessionIds.add(sessionId);
}

function isSessionInvalidated(sessionId) {
	return invalidatedSessionIds.has(sessionId);
}

function clearSessionInvalidation(sessionId) {
	invalidatedSessionIds.delete(sessionId);
}
```

`deleteSessionGenerations` 保持先调用 `clearSessionGenerations` 再删除 generation Map；删除入口负责在它之前调用 `invalidateSession`。

- [x] **Step 4: Make chat stream callbacks discard invalidated sessions**

在 `src/modules/shared.js` 的 `callAllModels` 中，调用 `onChunk` 前增加 session check：

```js
if (!isSessionInvalidated(sessionId)) {
	onChunk(endpointId, chunkState, firstTokenTime);
}
```

在 `src/modules/main.js` 的 chat `onChunk` 回调中保留同一保护，避免已进入编排层的回调更新 DOM：

```js
if (isSessionInvalidated(targetSessionId)) return;
updateStreamingCard(endpointId, partialContent, firstTokenTime, groups, targetSessionId);
```

- [x] **Step 5: Abort and invalidate in session deletion**

将 `handleSessionDelete` 的顺序改成：

```js
async function handleSessionDelete(sessionId) {
	invalidateSession(sessionId);
	deleteSessionGenerations(sessionId);
	await deleteSession(sessionId);
	if (currentSession?.id === sessionId) currentSession = null;
	await refreshUI();
}
```

不要在删除失败时清除 invalidation；旧异步链即使迟到也必须继续被丢弃。新建一个全新的 session ID 时无需清除旧 ID；若现有测试需要复用同一 ID，显式调用 `clearSessionInvalidation`。

- [x] **Step 6: Run Task 1 tests**

Run: `node --test --test-name-pattern="invalidat|generation|stream" tests/endpoint-tree.test.js`

Expected: focused tests pass, existing generation tests remain green.

---

### Task 2: 非流式请求 signal 与统一回写拦截

**Files:**
- Modify: `src/modules/shared.js`
- Modify: `src/modules/main.js`
- Modify: `src/modules/api.js`
- Test: `tests/endpoint-tree.test.js`

**Interfaces:**
- `fetchWithTimeout(url, options, timeout)` preserves the existing signature; callers pass `options.signal`.
- Non-stream request functions gain an optional final `signal` parameter:
  - `callEmbedding(..., isFullUrl, params, signal)`
  - `callImageGeneration(..., isFullUrl, params, signal)`
  - `callVideoGeneration(..., isFullUrl, params, signal)`
  - `callTTS(..., instruction, isFullUrl, signal)`
  - `callASR(..., params, isFullUrl, signal)`
- `handleSend` obtains the session-level controller/signal for `targetSessionId` and passes it to every non-stream branch.

- [x] **Step 1: Add a failing non-stream abort test**

在现有 endpoint test harness 中增加一个最小测试，验证非流式请求收到 signal，并且已失效会话不保存最终消息：

```js
test('invalidated session aborts non-stream generation and skips assistant persistence', async () => {
	const calls = [];
	const harness = createNonStreamGenerationHarness({
		fetchImpl(url, options) {
			calls.push({ url, signal: options.signal });
			return new Promise(() => {});
		}
	});
	const controller = new AbortController();
	harness.startEmbedding('session-1', controller.signal);
	harness.invalidate('session-1');
	controller.abort();
	await harness.flush();

	assert.equal(calls[0].signal.aborted, true);
	assert.equal(harness.addMessageCalls(), 0);
});
```

测试 harness 使用现有 VM 风格，只 stub `fetch`/`addMessage`，不创建新的 provider 矩阵。

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test --test-name-pattern="invalidated session aborts non-stream" tests/endpoint-tree.test.js`

Expected: FAIL because non-stream request functions do not accept/pass the signal and the harness observes no abort propagation.

- [x] **Step 3: Pass signal through non-stream request functions**

在 `src/modules/shared.js` 的每个非流式请求 `fetchWithTimeout` 调用中，把 signal 放入 options：

```js
const res = await fetchWithTimeout(req.url, {
	method: 'POST',
	headers: req.headers,
	body: JSON.stringify(req.body),
	signal
}, 120000);
```

ASR、TTS 同样把 `signal` 放进 options；所有新增参数放在原签名末尾，保持旧调用兼容。

- [x] **Step 4: Create a session-level controller for non-stream branches**

在 `api.js` 增加会话级 controller Map，提供：

```js
function getSessionAbortController(sessionId) {
	if (!sessionAbortControllers.has(sessionId)) {
		sessionAbortControllers.set(sessionId, new AbortController());
	}
	return sessionAbortControllers.get(sessionId);
}

function abortSessionRequests(sessionId) {
	const controller = sessionAbortControllers.get(sessionId);
	if (controller) controller.abort();
	sessionAbortControllers.delete(sessionId);
}
```

`handleSend` 在开始生成时取得 `getSessionAbortController(targetSessionId).signal`；`handleSessionDelete` 在 `deleteSessionGenerations` 后调用 `abortSessionRequests(sessionId)`。正常 finally 删除该 controller，不影响下一次独立生成。

- [x] **Step 5: Pass signal from main and guard all non-stream writes**

在 `src/modules/main.js` 中把 session signal 传给 embedding/image/video/TTS/ASR 调用；每个结果回写前加：

```js
if (isSessionInvalidated(targetSessionId)) return {
	endpointId: id,
	status: 'stopped',
	content: ''
};
```

同时保护 `updateCardAsEmbedding`、`updateCardAsImage`、`updateCardAsVideo`、`updateCardAsAudio`、`updateCardAsText` 和 `updateCardStatus` 调用。

- [x] **Step 6: Guard final assistant persistence and finally refresh**

在 `handleSend` 的最终保存和 finally 中使用同一边界：

```js
if (!isSessionInvalidated(targetSessionId)) {
	await addMessage(targetSessionId, 'assistant', null, { responses: allResults });
}

sessionGenerations.delete(targetSessionId);
if (isSessionInvalidated(targetSessionId)) return;
setButtonState(false, false);
renderSelectedEndpoints(groups, selectedEndpoints, false);
if (currentSession?.id === targetSessionId) {
	currentSession = await loadSession(targetSessionId);
	await refreshUI();
}
```

如果 `deleteSession` 已经把当前会话清空，finally 不得重新加载被删除的 session。

- [x] **Step 7: Run focused and full regression tests**

Run:

```bash
node --test --test-name-pattern="invalidated session|generation|stream|non-stream" tests/endpoint-tree.test.js
node --test tests/storage.test.js tests/endpoint-tree.test.js
```

Expected: focused tests and the full suite pass with zero failures.

---

### Task 3: 文档、构建与运行时验证

**Files:**
- Modify: `docs/modules/api.md`
- Modify: `docs/modules/main.md`
- Modify: `docs/superpowers/specs/2026-08-09-session-delete-invalidation-design.md`
- Modify: `docs/superpowers/plans/2026-08-09-session-delete-invalidation.md`
- Generated: `kuai-lian-ai.html`, `dist/kuai-lian-ai.html`, `dist/extension/app.js`, `dist/kuai-lian-ai.zip`

**Interfaces:**
- Documentation describes `invalidateSession`, `isSessionInvalidated`, abort propagation, and deletion ordering.
- Generated artifacts contain the same production implementation as `src/`.

- [x] **Step 1: Update module documentation**

在 `docs/modules/api.md` 的函数索引和决策日志加入 session invalidation/abort helpers；在 `docs/modules/main.md` 的删除和生成流程加入：

```text
删除确认 → invalidateSession → abortSessionRequests/deleteSessionGenerations → deleteSession → refreshUI
```

追加 `2026-08-09` 决策日志，明确迟到回调不更新 DOM、不调用 `addMessage`，不引入 tombstone。

- [x] **Step 2: Update the spec and plan status**

把设计 spec 的“决策日志”保留为最终行为；将本计划中的完成步骤改为 `[x]`，记录实际测试数字和任何未覆盖的运行时限制。

- [x] **Step 3: Run static verification**

Run:

```bash
node --check src/modules/api.js
node --check src/modules/shared.js
node --check src/modules/attachments.js
node --check src/modules/main.js
node --check tests/endpoint-tree.test.js
python3 scripts/check-docs-format.py
git diff --check HEAD
```

Expected: all commands exit 0; documentation checker prints `✅ 全部文档格式正确`.

- [x] **Step 4: Build generated artifacts**

Run: `node build.js`

Expected: root single-page, `dist/kuai-lian-ai.html`, extension `app.js`, and zip are regenerated successfully.

- [x] **Step 5: Verify generated implementation parity**

Run:

```bash
sha256sum kuai-lian-ai.html dist/kuai-lian-ai.html
git grep -n "invalidateSession\|abortSessionRequests" -- kuai-lian-ai.html dist/kuai-lian-ai.html dist/extension/app.js
```

Expected: root and dist single-page hashes match; all three artifacts contain the invalidation and abort implementation.

- [x] **Step 6: Run the real UI path**

Start the local HTTP server and use the browser surface with a controllable slow endpoint:

1. Start a generation in a session.
2. Confirm the session shows generating state.
3. Click delete and confirm the existing dialog.
4. Observe the request is aborted, the session disappears, and no late assistant message restores it.
5. Check the browser console for unhandled rejection/error.

Expected: the session remains deleted, the request terminates, and no console error is produced by the invalidated generation.

- [x] **Step 7: Stop the test server and record evidence**

Stop only the server started for this verification. Record test count, build exit status, artifact parity, and runtime observations in `findings.md` without changing version or committing.

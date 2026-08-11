---
title: storage 导入、模式校验与 session schema 防御实施计划
covers_file: [src/modules/storage-core.js, src/extension/storage-core.js, tests/storage.test.js]
depends_on: [../modules/storage-core.md]
api_signature: storage.importAll, storage.selectMode, storage.switchMode, session import validation
last_updated: 2026-08-11
status: complete
why_exists: 保护公共存储 facade 的回滚边界，拒绝非法模式和无效 session 导入数据
---

# storage 导入、模式校验与 session schema 防御实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 storage facade 绕过导入回滚、非法 mode 被持久化以及导入 session 无效 ID 写入存储的问题。

**Architecture:** facade `storage.importAll()` 委托当前后端的公共 `importAll()`，不再直接调用 `_importAllNow()`；`selectMode/switchMode` 在进入队列前只接受 `browser` 或 `directory`；BrowserStorage 与 DirectoryStorage 共用同一 session 输入校验规则，在任何写入前拒绝非对象、空 ID、非字符串 ID 或重复 ID。

**Tech Stack:** 原生 JavaScript、Node.js `node:test`/`vm` harness、BrowserStorage、File System Access API、Chrome extension storage。

## Global Constraints

- 不修改底层 BrowserStorage/DirectoryStorage 已有 checkpoint/rollback 结构。
- 非法 mode 必须在任何状态或 `__mode` 写入前拒绝，并返回 rejected Promise。
- session 导入校验失败必须发生在 endpoints/session 写入前，避免半导入；保留现有错误传播。
- session ID 必须是非空字符串，去除首尾空白后仍非空；重复 ID 拒绝。
- 标准版与扩展版实现保持一致；每个独立问题只增加一个最小回归测试组。
- 使用 Tab/LF；本批不更新版本号、不提交，等待验收。

---

### Task 1: facade importAll 回滚边界

**Files:**
- Modify: `src/modules/storage-core.js`
- Modify: `src/extension/storage-core.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- `storage.importAll(data)` 必须调用当前 backend 的公共 `importAll(data)`，而不是 `_importAllNow(data)`。
- `storage.selectMode(mode, handle)` 与 `storage.switchMode(target, handle)` 在队列入口拒绝非法 mode。

- [x] **Step 1: 写 facade 回滚和非法 mode 失败测试**

增加标准版和扩展版参数化测试：

```js
for (const method of ['selectMode', 'switchMode']) {
	test(`${implementation} ${method} rejects an invalid mode without writing preference`, async () => {
		const harness = loadHarness();
		installBrowserMap(harness.BrowserStorage, [['__mode', 'browser']]);
		harness.setMode('browser');
		await assert.rejects(harness.storage[method]('invalid-mode'), /非法存储模式/);
		assert.equal(harness.storage.mode, 'browser');
		assert.equal(await harness.BrowserStorage._get('__mode'), 'browser');
	});
}
```

增加 facade rollback 代理测试：将 backend `importAll` 替换为会抛错且记录调用的函数，将 backend `_importAllNow` 替换为抛出“facade bypassed”错误；调用 `storage.importAll()`，断言调用公共 `importAll`、没有调用 `_importAllNow`。

- [x] **Step 2: 运行 focused 测试确认 RED**

Run:

```bash
node --test --test-name-pattern="facade|invalid mode|invalid-mode" tests/storage.test.js
```

Expected: facade 测试显示公共入口未被调用，非法 mode 测试显示当前实现接受非法值。

- [x] **Step 3: 实现最小 facade 委托和 mode 校验**

标准版与扩展版公共 facade 的入口改为：

```js
async importAll(data) {
	return this._enqueueModeOperation(() => getBackend().importAll(data));
}
```

在 `_selectModeNow` 和 `_switchModeNow` 的第一行加入：

```js
if (mode !== 'browser' && mode !== 'directory') {
	throw new Error('非法存储模式: ' + mode);
}
```

`switchMode` 使用 `target`，保持相同校验。校验放在读取 handle、导出数据和写 `__mode` 之前。

- [x] **Step 4: 运行 focused 测试确认 GREEN**

Run:

```bash
node --test --test-name-pattern="facade|invalid mode|invalid-mode" tests/storage.test.js
```

Expected: 新增测试通过，已有模式切换测试继续通过。

---

### Task 2: session schema/ID 校验

**Files:**
- Modify: `src/modules/storage-core.js`
- Modify: `src/extension/storage-core.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- 新增内部 `validateImportedSessions(data)`，返回规范化 session 数组或抛错；标准版和扩展版行为一致。
- `_importAllNow` 在第一次 endpoint/session/settings 写入前调用该校验。

- [x] **Step 1: 写无效 session 导入测试**

标准版和扩展版各覆盖同一组输入：

```js
const invalidSnapshots = [
	{ sessions: [null] },
	{ sessions: [{}] },
	{ sessions: [{ id: '   ' }] },
	{ sessions: [{ id: 123 }] },
	{ sessions: [{ id: 'same' }, { id: 'same' }] }
];
```

对每个 snapshot 断言 `importAll()` rejected，并断言原有数据保持不变；另测一个合法 session `{ id: 'valid', messages: [] }` 成功导入。

- [x] **Step 2: 运行 focused 测试确认 RED**

Run:

```bash
node --test --test-name-pattern="invalid imported session|session schema|duplicate session" tests/storage.test.js
```

Expected: 旧实现接受 null/缺 ID/重复 ID，或在写入过程中抛出不明确错误。

- [x] **Step 3: 实现共享规则的本地校验 helper**

在标准版和扩展版各自 storage 模块中加入：

```js
function validateImportedSessions(data) {
	const sessions = Array.isArray(data?.sessions)
		? data.sessions
		: Object.values(data?.sessions || {});
	const ids = new Set();
	for (const session of sessions) {
		if (!session || typeof session !== 'object' || Array.isArray(session)) {
			throw new Error('导入会话无效');
		}
		if (typeof session.id !== 'string' || !session.id.trim()) {
			throw new Error('导入会话 ID 无效');
		}
		if (ids.has(session.id)) throw new Error('导入会话 ID 重复: ' + session.id);
		ids.add(session.id);
	}
	return sessions;
}
```

`_importAllNow` 在写 endpoints 前调用并使用返回的 `sessions`，避免重复解析和避免任何写入发生在校验前。对 map 形式使用对象 value，但仍以 session 自身 `id` 为准。

- [x] **Step 4: 运行 focused 测试确认 GREEN**

Run:

```bash
node --test --test-name-pattern="invalid imported session|session schema|duplicate session" tests/storage.test.js
```

Expected: 无效输入全部拒绝且原快照保持；合法输入成功。

- [x] **Step 5: 运行完整回归**

Run:

```bash
node --test tests/storage.test.js tests/endpoint-tree.test.js
```

Expected: 全部通过。

---

### Task 3: 文档、构建与验证

**Files:**
- Modify: `docs/modules/storage-core.md`
- Modify: `docs/modules/main.md` if public mode/import behavior is referenced
- Modify: this plan and local recovery records
- Generated: `kuai-lian-ai.html`, `dist/` via `node build.js`

- [x] **Step 1: 更新 storage-core 文档**

记录：facade import 委托公共 backend rollback；mode 只允许 browser/directory；导入 session 要求非空字符串 ID 且不可重复，校验先于写入。

- [x] **Step 2: 运行最终验证**

Run:

```bash
node --check src/modules/storage-core.js
node --check src/extension/storage-core.js
node --check tests/storage.test.js
python3 scripts/check-docs-format.py
git diff --check HEAD
node build.js
```

Expected: 全部通过；根单页与 dist 单页一致，扩展产物包含三项修复。

- [x] **Step 3: Chrome 页面加载检查

使用 Chrome/Playwright 加载构建页，检查版本、端点/会话区域和 console.error；不伪造浏览器文件系统故障场景，导入异常由 Node harness 覆盖。

- [x] **Step 4: 更新计划和 findings**

记录三项修复根因、测试数量、构建和 Chrome 证据；不更新版本号、不提交，等待用户验收。

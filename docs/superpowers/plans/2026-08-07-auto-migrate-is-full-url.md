---
title: 加载时自动迁移 isFullUrl 旧字段实施计划
covers_file: [src/modules/store.js, tests/endpoint-tree.test.js, tests/storage.test.js]
depends_on: [../specs/2026-08-07-auto-migrate-is-full-url-design.md, ../modules/store.md, ../modules/storage-core.md]
api_signature: normalizeEndpointFullUrlFlags, loadEndpoints, tryRestoreDirectory
last_updated: 2026-08-11
why_exists: 将检测到的旧 directUrl 在加载时自动迁移为 isFullUrl 并立即持久化
---

# 加载时自动迁移 isFullUrl 旧字段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 加载端点树时发现旧 `directUrl` 就递归转换为 `isFullUrl` 并立即保存，避免旧字段长期残留。

**Architecture:** 在 `store.js` 增加纯递归归一化函数，原地修改节点并返回是否变更；`loadEndpoints()` 和 `tryRestoreDirectory()` 共享一个加载后处理函数，在有变更时调用一次 `saveEndpoints()`。保存失败只记录错误，不阻塞当前内存加载，下次加载继续重试。

**Tech Stack:** 原生 JavaScript、Node.js `node:test`/`vm`、现有 BrowserStorage/DirectoryStorage facade。

## Global Constraints

- 新字段名称必须是 `isFullUrl`，旧 `directUrl` 只作为兼容读取来源。
- `isFullUrl` 存在时优先；两个字段都不存在时保持字段缺失，不写入 `false`。
- 只修改完整 URL 字段，不改变节点 ID、顺序、children、params、customParams 或其他属性。
- 发现迁移后立即保存一次；没有迁移时不得额外保存。
- 迁移保存失败不阻塞页面加载，使用 `console.error` 记录，下一次加载重试。
- 浏览器存储和目录存储共用同一 Store 加载逻辑。
- 不修改请求链路、`restoreEndpoints`、清空流程或 `storage.importAll`。
- 使用 Tab/LF；验收前不提交、不更新版本号。

---

### Task 1: 递归归一化与加载入口

**Files:**
- Modify: `src/modules/store.js:154-261`
- Test: `tests/endpoint-tree.test.js`（纯归一化测试）
- Test: `tests/storage.test.js`（loadEndpoints 保存行为测试）

**Interfaces:**
- Consumes: `storage.loadEndpoints()`、现有 `migrateEndpoints()`/`stripModels()`、`storage.saveEndpoints(data)`。
- Produces: `normalizeEndpointFullUrlFlags(data)` 返回 Boolean changed；统一加载 helper 返回归一化的 `endpointsData` 并在 changed 时保存。

- [x] **Step 1: 写纯函数失败测试**

在 `tests/endpoint-tree.test.js` 的 Store harness 暴露 `normalizeEndpointFullUrlFlags`，增加测试：

```js
const data = { nodes: [{
	id: 'root',
	directUrl: true,
	children: [{
		id: 'child',
		isFullUrl: false,
		directUrl: true,
		children: [{ id: 'legacy-deep', directUrl: false, children: [] }]
	}]
}] };
const changed = harness.api.normalizeEndpointFullUrlFlags(data);
assert.equal(changed, true);
assert.equal(data.nodes[0].isFullUrl, true);
assert.equal(Object.hasOwn(data.nodes[0], 'directUrl'), false);
assert.equal(data.nodes[0].children[0].isFullUrl, false);
assert.equal(Object.hasOwn(data.nodes[0].children[0], 'directUrl'), false);
assert.equal(data.nodes[0].children[0].children[0].isFullUrl, false);
```

另测一个没有 `isFullUrl/directUrl` 的节点，断言 `changed === false` 且不新增 `isFullUrl`。

- [x] **Step 2: 运行纯函数测试确认 RED**

Run: `node --test --test-name-pattern="normalizeEndpointFullUrlFlags" tests/endpoint-tree.test.js`

Expected: FAIL，因为生产模块没有暴露该函数。

- [x] **Step 3: 实现原地递归归一化**

在 `src/modules/store.js` 增加：

```js
function normalizeEndpointFullUrlFlags(data) {
	let changed = false;
	function visit(node) {
		if (Object.prototype.hasOwnProperty.call(node, 'isFullUrl')) {
			const normalized = !!node.isFullUrl;
			if (node.isFullUrl !== normalized) {
				node.isFullUrl = normalized;
				changed = true;
			}
			if (Object.prototype.hasOwnProperty.call(node, 'directUrl')) {
				delete node.directUrl;
				changed = true;
			}
		} else if (Object.prototype.hasOwnProperty.call(node, 'directUrl')) {
			node.isFullUrl = !!node.directUrl;
			delete node.directUrl;
			changed = true;
		}
		if (node.children) node.children.forEach(visit);
	}
	if (data && data.nodes) data.nodes.forEach(visit);
	return changed;
}
```

Expose the function through the existing Store VM test API. Preserve node and children references by mutating in place.

- [x] **Step 4: 接入统一加载后处理**

增加一个内部 async helper：

```js
async function loadAndNormalizeEndpoints() {
	endpointsData = migrateEndpoints(await storage.loadEndpoints());
	stripModels(endpointsData);
	if (normalizeEndpointFullUrlFlags(endpointsData)) {
		try {
			await saveEndpoints();
		} catch (error) {
			console.error('保存端点字段迁移失败:', error);
		}
	}
	return endpointsData;
}
```

让 `tryRestoreDirectory()` 和 `loadEndpoints()` 都调用 `loadAndNormalizeEndpoints()`，删除两处重复的 load/migrate/strip 代码。迁移保存失败只记录错误，仍返回当前内存数据。

- [x] **Step 5: 写加载保存行为失败测试**

在 Store harness 的 storage stub 增加 `loadEndpoints`、`saveEndpoints` 计数与错误注入，测试：

```js
const loaded = await harness.api.loadEndpoints();
assert.equal(loaded.nodes[0].isFullUrl, true);
assert.equal(harness.getSaveEndpointsCalls(), 1);
```

再用无旧字段数据加载，断言 `getSaveEndpointsCalls() === 0`。最后让保存抛出 Error，断言 `loadEndpoints()` 仍 resolve，内存节点已为 `isFullUrl`，且 `console.error` 被调用一次。

- [x] **Step 6: 运行 Task 1 测试确认 GREEN**

Run: `node --test --test-name-pattern="normalizeEndpointFullUrlFlags|loadEndpoints normalizes" tests/endpoint-tree.test.js tests/storage.test.js`

Expected: 新增纯函数、加载保存、无变更不保存、保存失败不阻塞测试全部通过。

- [x] **Step 7: 运行相关回归测试**

Run: `node --test tests/storage.test.js tests/endpoint-tree.test.js`

Expected: 全部通过。

---

### Task 2: 文档与最终验证

**Files:**
- Modify: `docs/modules/store.md`
- Modify: `docs/modules/storage-core.md`（补充加载层负责字段迁移的边界说明）
- Modify: `docs/superpowers/specs/2026-08-07-auto-migrate-is-full-url-design.md`
- Modify: `docs/superpowers/plans/2026-08-07-auto-migrate-is-full-url.md`
- Generated: `kuai-lian-ai.html`, `dist/` via `node build.js`

- [x] **Step 1: 更新模块文档**

追加 `2026-08-07` 决策日志，说明：Store 加载端点后递归归一化 `directUrl`，发现变化立即保存；保存失败只记录并下次重试；无旧字段不额外保存。

- [x] **Step 2: 运行最终验证**

Run:

```bash
node --test tests/storage.test.js tests/endpoint-tree.test.js
node --check src/modules/store.js
node --check tests/endpoint-tree.test.js
python3 scripts/check-docs-format.py
git diff --check HEAD
node build.js
```

Expected: 测试、语法、文档格式、diff、构建全部通过。

- [x] **Step 3: 核对产物和工作树**

确认根单页与 `dist/kuai-lian-ai.html` 内容一致，扩展产物包含归一化函数；确认只涉及本任务文件和第三批未提交改动，不更新版本号、不提交。

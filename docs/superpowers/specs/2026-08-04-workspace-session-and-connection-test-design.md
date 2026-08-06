---
title: Workspace/Session 参数一致性与连接测试单飞设计
covers_file: [src/modules/selected-endpoints.js, src/modules/attachments.js, src/modules/main.js]
depends_on: [../modules/ui.md, ../modules/store.md]
api_signature: persistEndpointParamsTransaction, testConnection, clearTestResults
last_updated: 2026-08-05
why_exists: 约束参数双写回滚与端点连接测试并发状态的一致性
---

# Workspace/Session 参数一致性与连接测试单飞设计

## 背景

当前参数编辑器先写 workspace 的 `localStorage`，再异步更新当前 session。session 持久化失败时，workspace 已经改变，会产生两层参数不一致。

当前连接测试没有记录进行中的请求。同一 `nodeId` 可从节点按钮、祖先批量按钮或全局按钮重复触发多个请求，旧请求也可能在编辑、删除或清理结果后回写过期状态。

## 目标

1. workspace 参数和当前 session 参数更新要么全部成功，要么恢复到操作前状态。
2. 保存和重置使用相同的失败回滚行为。
3. 同一 `nodeId` 同时最多发起一个连接测试；重复触发复用同一 Promise。
4. 编辑、删除、移动或清除测试结果后，旧请求不能回写新状态。
5. 每个问题只增加最小根因回归测试，不扩展完整异常矩阵或存储架构。

## 非目标

- 不把 localStorage workspace 参数纳入 storage facade/store 的全局事务。
- 不引入批量测试调度器。
- 不增加取消所有请求的复杂 UI。
- 不处理删除会话 tombstone 或端点删除失败的 UI 回滚问题。

## 设计

### 参数双写

在 `selected-endpoints.js` 增加局部事务辅助函数，封装 workspace 快照、workspace 写入、session 更新和失败恢复。

保存和重置都调用同一 helper：

- 操作前保存 workspace 内存值和 `localStorage` 原始字符串。
- 先更新 workspace 内存并写 `localStorage`。
- 有当前 session 时调用 `updateSession()`。
- 成功后关闭弹窗；重置成功后刷新为端点默认参数。
- 任一步骤失败时恢复 workspace 内存和 `localStorage`，保留弹窗和当前编辑内容，并显示失败提示。
- 若 workspace 写入本身失败，不调用 session 更新。
- `updateSession()` 负责恢复 session 对象；helper 不重复实现 session 回滚。

### 连接测试单飞

在 `attachments.js` 中维护 `nodeId -> { promise, generation }` 的进行中测试表。

`testConnection(nodeId)`：

1. 不具备测试资格时直接返回。
2. 若该 nodeId 已有进行中的 Promise，直接返回该 Promise。
3. 首次调用创建 Promise，设置 `testing` 状态并更新 UI。
4. 请求结束后只允许当前 generation 更新 `connectionStatus`；完成后从表中移除记录。
5. 外部重复触发共享同一 Promise，不发起第二个请求。

`clearTestResults(nodeId)` 及编辑、删除、移动路径在清除状态时同时递增 generation，使旧请求的完成结果失效。清理动作不强制取消底层 fetch，只阻止过期结果回写，避免引入 AbortController 生命周期重构。

## 错误处理

- 参数双写失败：恢复两层可恢复状态，弹窗保持打开，调用现有错误提示机制；不吞掉 session 持久化错误。
- 连接测试请求失败：沿用现有 `failed`/`cors_blocked` 状态和 UI 更新。
- 过期连接测试完成：不改变当前状态；若没有新状态，不重新创建已清除的状态。

## 测试设计

1. 参数事务最小回归测试：模拟 workspace 写入成功、session 更新失败，断言 workspace 内存与 localStorage 恢复，session 保持原值；重置复用同一路径。
2. 连接测试单飞最小回归测试：让第一次请求挂起，连续调用同一 nodeId 两次，断言 provider/fetch 只调用一次且两个调用共享同一 Promise；完成后允许下一次测试重新发起。
3. 连接测试失效最小回归测试：测试进行中清除结果，完成旧 Promise 后断言不会重新写入状态。

## 收尾记录

- 2026-08-06: 完成参数双写事务和连接测试单飞实现；版本升至 v6.32.5。

## 验证

- 先运行新增最小测试，确认失败后实现并确认通过。
- 批次完成运行：
  - `node --test tests/storage.test.js tests/endpoint-tree.test.js`
  - 相关 JavaScript `node --check`
  - `node build.js`
  - `python3 scripts/check-docs-format.py`
  - `git diff --check HEAD`
- 不更新版本号，不提交，直到用户明确验收通过。

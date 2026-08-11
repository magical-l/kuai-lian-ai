---
title: 删除生成中会话的异步失效设计
covers_file: [src/modules/api.js, src/modules/shared.js, src/modules/main.js, tests/endpoint-tree.test.js, tests/storage.test.js]
depends_on: [../modules/main.md, ../modules/api.md, ../modules/store.md]
api_signature: session generation invalidation and abort behavior
last_updated: 2026-08-09
why_exists: 删除正在生成的会话后立即停止请求并丢弃迟到结果，避免异步消息重新写回复或复活会话
---

# 删除生成中会话的异步失效设计

## 背景

当前删除会话时会清理 `sessionGenerations` 并删除存储会话，但已经启动的异步生成链仍可能在删除之后完成，并继续更新卡片或调用 `addMessage`。这会造成删除后的会话被迟到结果重新写入，甚至重新出现在缓存或持久化存储中。

## 目标

1. 用户确认删除后，立即使该会话的所有生成结果失效。
2. 通过现有 abort controller 停止聊天流及非流式生成请求。
3. 迟到的流式片段、非流式结果、最终 assistant 保存和删除后的刷新都不得写回已删除会话。
4. 不引入持久化 tombstone，不改变正常会话生成和删除行为。
5. 删除失败时保留现有错误语义，不让失效标记导致不可恢复的内存状态。

## 非目标

- 不重构 Store mutation queue。
- 不改变用户删除前的二次确认交互。
- 不为所有异步任务建设通用任务调度器。
- 不处理端点删除失败回滚等其他延期问题。

## 设计

### 会话失效状态

在 API/共享状态层维护一个仅存在于内存的 `invalidatedSessionIds` 集合，并提供：

- `invalidateSession(sessionId)`：加入集合。
- `isSessionInvalidated(sessionId)`：查询状态。
- `clearSessionInvalidation(sessionId)`：正常创建或重新进入一个合法会话时清理状态（具体调用边界由实现确定，不能让旧会话 ID 的后续新会话误继承失效状态）。

删除流程先调用 `invalidateSession(sessionId)`，再调用现有的 `deleteSessionGenerations(sessionId)`，确保 abort 触发和迟到回调检查之间没有空窗。

### 请求停止

扩展现有会话生成状态，使同一 session 的非流式请求也持有会话级 `AbortController` 或共享 signal。删除时统一 abort：

- 聊天流沿用每个 endpoint 的 abort controller。
- embedding、image、video、TTS、ASR 使用同一会话级 signal，或按端点保存 controller，但必须由 `deleteSessionGenerations(sessionId)` 统一停止。

Abort 后的 catch/finally 路径不得把 stopped/failed 结果保存到已失效会话。

### 异步回写边界

以下写入或 UI 更新在执行前检查 `isSessionInvalidated(sessionId)`：

- `updateStreamingCard` / 流式 `onChunk`。
- embedding、image、video、TTS、ASR 的卡片更新。
- `addMessage(targetSessionId, 'assistant', ...)`。
- 生成结束后的 `loadSession`、`refreshUI`、按钮状态恢复。

检查应集中在少数现有编排边界，避免在每个 provider API 函数中散落会话业务判断。

### 删除流程

`handleSessionDelete(sessionId)` 的顺序：

1. 标记 session invalidated。
2. abort 并清理该 session 的生成状态。
3. 删除持久化会话和缓存。
4. 若当前会话仍是该 ID，清空 `currentSession`。
5. 刷新 UI。

删除成功后失效标记保留到本次异步链全部结束；不需要写入 storage。若应用重新创建同一 ID，必须显式清理旧标记。

## 错误处理

- 删除过程中 storage 删除失败：保持现有 rejection/错误传播；失效标记仍阻止正在运行的旧请求写回，避免删除失败时旧异步链继续覆盖状态。
- AbortError：按停止处理，但已失效会话不更新卡片、不保存消息。
- 非 AbortError：正常会话仍显示 failed；已失效会话静默丢弃，不产生新的会话写入。

## 测试

只增加直接证明根因的最小测试：

1. 删除生成中会话调用现有 abort controller，并标记 session invalidated。
2. 已失效会话的迟到流式回调不更新卡片，最终结果不调用 `addMessage`。
3. 已失效会话的非流式结果不更新卡片、不保存 assistant 消息。
4. 正常完成的会话仍保存 assistant 消息并清理生成状态。

测试不扩展完整 provider/错误组合矩阵；复用已有 generation harness 和最小的 abort stub。

## 验证

- 运行 `node --test tests/storage.test.js tests/endpoint-tree.test.js`。
- 对改动 JS 运行 `node --check`。
- 运行 `python3 scripts/check-docs-format.py` 和 `git diff --check HEAD`。
- 运行 `node build.js`，核对根单页、dist 单页和扩展 bundle 包含同一实现。
- 通过真实页面启动一个可控的慢请求，确认删除后请求被 abort、会话列表不复活、控制台无未处理 rejection。

不更新版本号，不提交，直到用户明确验收通过。

## 决策日志

- 2026-08-09: 删除生成中会话采用“失效标记 + abort + 回写边界拦截”，保留现有二次确认，不引入持久化 tombstone。
- 2026-08-10: 非流式请求复用 session-level AbortController；删除和“全部停止”统一取消 chat 与 embedding/image/video/TTS/ASR，并在 RAF 执行边界再次检查失效状态。

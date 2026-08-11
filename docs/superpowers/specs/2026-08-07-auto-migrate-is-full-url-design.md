---
title: 加载时自动迁移 isFullUrl 旧字段设计
covers_file: [src/modules/store.js, src/modules/storage-core.js, src/extension/storage-core.js, tests/storage.test.js, tests/endpoint-tree.test.js]
depends_on: [../modules/store.md, ../modules/storage-core.md]
api_signature: loadEndpoints and tryRestoreDirectory migration behavior
last_updated: 2026-08-07
why_exists: 检测到旧 directUrl 后立即规范化为 isFullUrl 并持久化，避免旧字段长期残留
---

# 加载时自动迁移 isFullUrl 旧字段设计

## 背景

当前端点配置解析已经能够兼容旧 `directUrl`，但部分已是 `nodes` 格式的旧数据只在内存中被兼容读取，存储原文仍保留 `directUrl`。用户每次加载都会重复遇到旧格式，旧字段也可能继续出现在导出数据中。

## 目标

1. 加载端点树时递归检测并把旧 `directUrl` 归一化为 `isFullUrl`。
2. `isFullUrl` 已存在时优先保留其布尔值，并删除同节点旧 `directUrl`。
3. 两个字段都不存在时保持字段缺失，不把继承语义固化为 `isFullUrl: false`。
4. 发现实际变更后立即保存一次归一化后的端点树。
5. 迁移保存失败不阻塞页面加载，记录错误并在下次加载重试。
6. 同时覆盖浏览器存储和目录存储，因为两者共用 Store 加载边界。

## 非目标

- 不修改请求链路和 `resolveNodeConfig` 的运行时兼容逻辑。
- 不修改 `restoreEndpoints`、清空流程或 `storage.importAll` 的事务行为。
- 不改变端点树其他字段、节点顺序、节点 ID、参数或自定义参数。
- 不为没有旧字段的正常加载额外写入存储。

## 设计

在 `store.js` 增加递归归一化函数，例如 `normalizeEndpointFullUrlFlags(data)`，返回是否发生变更：

- 遍历 `nodes` 及所有 `children`。
- 有自有 `isFullUrl` 时转为 Boolean；若原值不是 Boolean，视为变更。
- 没有 `isFullUrl` 但有 `directUrl` 时写入 Boolean `isFullUrl`。
- 删除 `directUrl`。
- 两者都不存在时不增加字段。
- 只改变字段，不替换节点对象和 children 数组引用。

加载入口统一使用：

```text
storage.loadEndpoints()
→ migrateEndpoints()
→ stripModels()
→ normalizeEndpointFullUrlFlags()
→ 若 changed：saveEndpoints()
```

`tryRestoreDirectory()` 和 `loadEndpoints()` 共用同一入口逻辑，避免浏览器存储与目录存储行为分叉。保存失败时：

- 保留内存中的归一化数据，让当前页面继续使用新字段；
- `console.error` 记录失败；
- 不向用户弹窗，不让加载失败；
- 下次加载再次检测并重试。

## 测试

1. `nodes` 格式递归迁移：根节点和深层子节点只有 `directUrl` 时都转换为 `isFullUrl` 并删除旧字段；同时存在新旧字段时新字段优先。
2. 缺少两个字段的节点保持字段缺失。
3. `loadEndpoints()` 检测变更后只调用一次 `saveEndpoints()`；无变更时不保存。
4. `saveEndpoints()` 失败时 `loadEndpoints()` 仍返回归一化内存数据，并记录错误。
5. `tryRestoreDirectory()` 与 `loadEndpoints()` 使用同一归一化行为。

## 验证

- 先运行新增测试确认 RED，再实现并确认 GREEN。
- 运行 `node --test tests/storage.test.js tests/endpoint-tree.test.js`。
- 运行相关 JavaScript `node --check`、`python3 scripts/check-docs-format.py`、`git diff --check HEAD`。
- 构建并确认根单页与 `dist` 产物同步。
- 不更新版本号、不提交，直到用户明确验收通过。

---
name: 数据管理层 — store.js
description: 端点树 CRUD、会话管理、旧数据迁移、继承链配置解析
type: architecture
---

# 数据管理层

## 设计意图

`store.js` 位于 storage-core 之上，是应用数据和业务逻辑的中枢层：

- **端点 CRUD**：维护一棵 N 层树形节点结构（原为扁平 groups + models，迁移后统一为 nodes 树），支持增删改排序和跨级拖拽
- **会话管理**：内存缓存（`sessionsCache` Map）+ 委托 storage 持久化
- **旧数据迁移**：`migrateEndpoints()` 将旧版 `groups → models` 扁平格式转换为新版 `nodes` 树形格式
- **配置继承**：`resolveNodeConfig()` 沿祖先链向上搜索字段，子节点可继承父节点的 `baseUrl/style/key`

数据流：`store.js` -> `storage` 对象 -> `BrowserStorage | DirectoryStorage`

## 数据结构

```js
// 端点树节点
{
  id: "uuid",
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  style: "openai",
  key: "sk-...",           // API key
  modelId: "gpt-4",       // 叶子节点：实际模型 ID；父节点：空
  remark: "备注文本",
  children: [ /* 子节点 */ ]
}
```

- 根层节点：代表 Provider（如 OpenAI、Claude）
- 二层节点：代表模型（如 gpt-4、claude-3）；也可以是分组（中间层）
- 节点通过 `modelId` 字段区分是模型节点还是分组节点

## 函数索引

### 树形工具函数

| 函数 | 功能 | 复杂度 |
|------|------|--------|
| `findNodeWithAncestors(nodes, nodeId, ancestors?)` | 递归查找节点，返回 `{ node, ancestors }`（祖先链从近到远） | O(n) DFS |
| `findNodeInTree(nodes, nodeId)` | 只查找节点对象，不返回祖先链 | O(n) |
| `resolveNodeConfig(nodeId)` | 合并节点自身及祖先链的配置字段，返回 `{ baseUrl, style, key, modelId }` | O(n + d) |
| `findModelById(nodes, nodeId)` | 同 `findNodeWithAncestors`，语义别名 | O(n) |
| `detectModelType(name)` | 从模型名推断 `chat` / `embedding` / `rerank` | 字符串匹配 |

### 数据加载与迁移

| 函数 | 功能 |
|------|------|
| `tryRestoreDirectory()` | 初始化存储、加载端点（含迁移）、加载会话索引、更新 UI |
| `loadEndpoints()` | 从 storage 加载端点，执行迁移 + 清洗 |
| `saveEndpoints()` | 持久化当前端点内存数据 |
| `getGroups()` | 返回 `endpointsData.nodes`（根层列表） |
| `clearDirectory()` | 清空内存 + storage，刷新 UI |

### 旧数据迁移

```js
migrateEndpoints(data)
```

- 检测 `data.groups` 存在而 `data.nodes` 不存在 → 触发迁移
- 每个旧 group 转为根节点，其 `models[]` 转为子节点
- 子节点自动调用 `detectModelType()` 设置 `type` 字段
- 迁移后删除 `data.groups`

```js
stripModels(node)
```

- 递归删除节点上的 `models` 遗留字段（确保新旧格式不会混存）

### 节点 CRUD

| 函数 | 功能 | 持久化 |
|------|------|--------|
| `addNode(parentId, data)` | 在指定父节点下新增子节点（parentId 为空则加到根），生成 UUID | 实时 save |
| `updateNode(nodeId, updates)` | 更新节点字段（Object.assign），支持任意顶层字段 | 实时 save |
| `deleteNode(nodeId)` | 递归删除节点及其所有子代，同步清理 `selectedEndpoints` 中的引用 | 实时 save |
| `reorderNode(draggedId, targetId, insertBefore)` | 同级重排序：从当前位置移除 dragged，插入到 target 前/后 | 实时 save |
| `moveNodeAsChild(draggedId, targetParentId)` | 跨级移动：移除 dragged，追加到 targetParentId 的 children 中 | 实时 save |

### 节点查询

| 函数 | 功能 |
|------|------|
| `getNode(nodeId)` | 从内存树中查询节点 |

### 会话管理

| 函数 | 功能 |
|------|------|
| `loadSessionsIndex()` | 从 storage 加载全部会话到 `sessionsCache` |
| `getAllSessions()` | 返回 `sessionsCache` 全部值（数组） |
| `createSession(firstMessage?, targetModels?)` | 创建新会话，自动提取首条消息前 20 字符为标题 |
| `loadSession(sessionId)` | 加载单会话（先查缓存，miss 则查 storage 并缓存） |
| `saveSession(session)` | 持久化到 storage（缓存已在 addMessage/createSession 中更新） |
| `addMessage(sessionId, role, content, options?)` | 追加消息，自动处理首条消息标题更新 |
| `getSession(sessionId)` | 从缓存获取会话 |
| `deleteSession(sessionId)` | 从缓存和 storage 删除会话 |

| 辅助函数 | 功能 |
|----------|------|
| `normalizeMessageContent(msg)` | 统一消息 content 格式为 `[{ type, text }]` 数组 |

### 工具函数

| 函数 | 功能 |
|------|------|
| `generateUUID()` | RFC 4122 v4 UUID 生成 |

## 继承链解析（resolveNodeConfig）

`resolveNodeConfig` 是树形结构的核心能力。给定一个节点 ID，它：

1. 在树中找到该节点及其所有祖先（`findNodeWithAncestors`）
2. 先从节点自身读取 `{ baseUrl, style, key, modelId }`
3. 从最近祖先向根遍历，对每个空字段尝试从祖先继承

**示例**：

```
Root (baseUrl: "https://api.openai.com/v1", style: "openai")
├── GPT-4 (modelId: "gpt-4", key: "sk-xxx")
├── GPT-3.5 (modelId: "gpt-3.5-turbo")  // 继承 key 和 baseUrl
```

- `resolveNodeConfig("GPT-3.5")` → `{ baseUrl: "https://api.openai.com/v1", style: "openai", key: "", modelId: "gpt-3.5-turbo" }`
- `resolveNodeConfig("GPT-4")` → `{ baseUrl: "https://api.openai.com/v1", style: "openai", key: "sk-xxx", modelId: "gpt-4" }`

树中节点可以任意深度，继承链按长度决定优先级（近者优先）。

## 全局状态

| 变量 | 初始值 | 用途 |
|------|--------|------|
| `endpointsData` | `null` | 内存中的端点树根对象 `{ nodes: [...] }` |
| `sessionsCache` | `new Map()` | sessionId -> session 对象的 LRU 缓存 |
| `selectedEndpoints` | (imported) | 当前选中模型 ID 列表 |

## 决策日志

| 决策 | 原因 |
|------|------|
| 端点树在内存中只维护一份 `endpointsData` | 应用为 SP 单用户，无需多实例；减少异步同步复杂度 |
| 会话用 Map 缓存 + 委托 storage | 频繁读写会话列表时避免每次都全量重查 storage；`addMessage` 高频调用需快速更新 |
| `migrateEndpoints` 在 `loadEndpoints` 和 `tryRestoreDirectory` 中各执行一次 | 双重保障确保旧格式数据在首次加载时被迁移；幂等（第二次 `data.groups` 已不存在） |
| 继承链解析不含 `modelId` 空值检查 | 空 `modelId` 表示分组节点，继承父节点 `modelId` 无意义；调用方在 `api.js` 中会过滤无 `modelId` 的节点 |
| `deleteNode` 同步清理 `selectedEndpoints` | 避免删除后选中列表中有悬空引用导致 UI 异常 |
| 首条消息自动设为会话标题 | 减少用户操作步骤；取前 20 字符足够在侧边栏展示 |
| `addMessage` 将 content 统一转为 `[{ type, text }]` 数组格式 | 兼容旧版字符串格式和未来扩展（多模态）；`normalizeMessageContent` 保障向下兼容 |

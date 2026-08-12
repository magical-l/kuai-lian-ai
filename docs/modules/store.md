---
title: 数据管理层
covers_file: [src/modules/store.js]
depends_on: [storage-core.md]
api_signature: getGroups, getNode, addNode, updateNode, deleteNode, cloneNode, reorderNode, moveNodeAsChild, resolveNodeConfig, createSession, updateSession, addMessage, getAllSessions, loadSession, saveSession, deleteSession
last_updated: 2026-08-12
why_exists: DB 式数据 CRUD 接口、端点树继承链解析、会话生命周期管理
---

# 数据管理层

## 设计意图

`store.js` 位于 storage-core 之上，是应用数据和业务逻辑的中枢层：

- **端点 CRUD**：维护一棵 N 层树形节点结构（原为扁平 groups + models，迁移后统一为 nodes 树），支持增删改、复刻、排序和跨级拖拽
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
  type: "chat",           // chat | embedding | image-generation | video-generation | reranking；空串=自动检测
  isFullUrl?: false,       // 可选覆盖：缺失时继承父级；true 时 baseUrl 已是最终请求 URL
  children: [ /* 子节点 */ ]
}
```

- 根层节点：代表 Provider（如 OpenAI、Claude）
- 二层节点：代表模型（如 gpt-4、claude-3）；也可以是分组（中间层）
- 节点通过 `modelId` 字段区分是模型节点还是分组节点
- 新写入统一使用 `isFullUrl`；读取旧节点时仅在配置解析边界兼容 `directUrl`，不会再生成该旧字段

## 函数索引

### 树形工具函数

| 函数 | 功能 | 复杂度 |
|------|------|--------|
| `findNodeWithAncestors(nodes, nodeId, ancestors?)` | 递归查找节点，返回 `{ node, ancestors }`（祖先链从近到远） | O(n) DFS |
| `findNodeInTree(nodes, nodeId)` | 只查找节点对象，不返回祖先链 | O(n) |
| `resolveTreeMove(nodes, draggedId, targetId)` | 在修改树前解析源和目标；拒绝不存在、自身或源子树内的目标 | O(n) DFS |
| `resolveNodeConfig(nodeId)` | 合并节点自身及祖先链的配置字段，归一化旧 `directUrl` 后返回 `{ baseUrl, style, key, modelId, type, isFullUrl, params }` | O(n + d) |
| `findModelById(nodes, nodeId)` | 同 `findNodeWithAncestors`，语义别名 | O(n) |
| `detectModelType(name)` | 从模型名推断 `chat` / `embedding` / `image-generation` / `video-generation` / `reranking` | 字符串匹配 |

### 数据加载与迁移

| 函数 | 功能 |
|------|------|
| `tryRestoreDirectory()` | 初始化存储、加载端点（含迁移和完整 URL 字段归一化持久化）、加载会话索引、更新 UI |
| `loadEndpoints()` | 从 storage 加载端点，执行迁移、清洗和完整 URL 字段归一化持久化 |
| `loadAndNormalizeEndpoints()` | 统一执行端点加载后的迁移、清洗和完整 URL 字段归一化；发生旧字段迁移时尝试保存，失败只记录错误 |
| `normalizeEndpointFullUrlFlags(data)` | 原地递归把 `directUrl` 迁移为 `isFullUrl`，保留显式 `isFullUrl`（含 `false`），返回是否变更 |
| `saveEndpoints()` | 持久化当前端点内存数据；清空屏障期间拒绝保存，跨清空 generation 的结果不回写 |
| `getGroups()` | 返回 `endpointsData.nodes`（根层列表） |
| `clearDirectory()` | 设置清空屏障；等待已有 endpoint/session mutation 与直接 storage save 完成后清空 storage 和内存，刷新 UI；清空期间拒绝新写入 |

### 旧数据迁移

```js
migrateEndpoints(data)
```

- 检测 `data.groups` 存在而 `data.nodes` 不存在 → 触发迁移
- 每个旧 group 转为根节点，其 `models[]` 转为子节点
- 子节点自动调用 `detectModelType()` 设置 `type` 字段
- 迁移时优先保留 `isFullUrl`，否则把旧 `directUrl` 归一为 `isFullUrl`；两者都缺失则不写覆盖字段
- 迁移后删除 `data.groups`

```js
stripModels(node)
```

- 递归删除节点上的 `models` 遗留字段（确保新旧格式不会混存）

### 节点 CRUD

| 函数 | 功能 | 持久化 |
|------|------|--------|
| `addNode(parentId, data)` | 在指定父节点下新增子节点（parentId 为空则加到根），生成 UUID；仅 source 显式提供开关时写入归一化的 `isFullUrl`，否则保留字段缺失；成功返回创建的节点对象，失败返回 `null` | 实时 save |
| `updateNode(nodeId, updates)` | 更新节点字段；`isFullUrl` 优先，旧 `directUrl` 更新归一化为 `isFullUrl`，两种情况都会删除旧字段 | 实时 save |
| `deleteNode(nodeId)` | 递归删除节点及其所有子代，同步清理 `selectedEndpoints` 中的引用 | 实时 save |
| `cloneNode(nodeId)` | 深拷贝节点及其所有子代，保留每个源节点的 `isFullUrl` 字段存在性、重新生成每个节点 UUID，并把根副本插到原节点之后；不生成 `directUrl` | 实时 save |
| `reorderNode(draggedId, targetId, insertBefore)` | 同级重排序：校验移动关系后，从当前位置移除 dragged，插入到 target 前/后 | 合法时 save |
| `moveNodeAsChild(draggedId, targetParentId)` | 跨级移动：校验移动关系后，移除 dragged 并追加到 targetParentId 的 children 中 | 合法时 save |

### 节点查询

| 函数 | 功能 |
|------|------|
| `getNode(nodeId)` | 从内存树中查询节点 |

### 会话管理

| 函数 | 功能 |
|------|------|
| `loadSessionsIndex()` | 从 storage 加载全部会话到 `sessionsCache` |
| `getAllSessions()` | 返回 `sessionsCache` 全部值（数组） |
| `createSession(firstMessage?, targetModels?, modelParams?)` | 创建新会话，自动提取首条消息前 20 字符为标题；可将会话级参数深拷贝写入首个持久化载荷；清空屏障期间或跨清空保存不进入缓存 |
| `updateSession(sessionId, mutate)` | 串行执行指定会话的缓存变更和持久化；保存失败时恢复变更前的缓存快照；会话进入删除队列后返回 `null`，不再排队写回 |
| `loadSession(sessionId)` | 加载单会话（先查缓存，miss 则查 storage 并缓存） |
| `saveSession(session)` | 底层持久化委托；清空屏障期间拒绝保存，跨清空 generation 的结果返回 `null`；调用方应优先使用 `updateSession` / `addMessage` 等事务性入口修改已缓存会话 |
| `addMessage(sessionId, role, content, options?)` | 追加消息，自动处理首条消息标题更新 |
| `getSession(sessionId)` | 从缓存获取会话 |
| `deleteSession(sessionId)` | 标记会话进入删除状态，串行从 storage 和缓存删除；删除完成或失败后解除标记 |

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
2. 先从节点自身读取 `{ baseUrl, style, key, modelId, type }`，并将完整 URL 开关归一为 `isFullUrl`
3. 从最近祖先向根遍历，对每个空字符串配置字段尝试继承；`isFullUrl` 按字段是否存在判断，节点显式 `false` 与 `true` 都会覆盖父级值
4. 节点未设置 `isFullUrl` 时，读取旧 `directUrl` 作为兼容值；解析结果只暴露统一后的 `isFullUrl`
5. type 继承后仍为空 → 从 modelId 启发式推断（`detectModelType`）
6. 类型别名规范化：`img-generate`/`image` → `image-generation`，`embed` → `embedding`，`rerank` → `reranking`

**示例**：

```
Root (baseUrl: "https://api.openai.com/v1", style: "openai")
├── GPT-4 (modelId: "gpt-4", key: "sk-xxx")
├── GPT-3.5 (modelId: "gpt-3.5-turbo")  // 继承 key 和 baseUrl
```

- `resolveNodeConfig("GPT-3.5")` → `{ baseUrl: "https://api.openai.com/v1", style: "openai", key: "", modelId: "gpt-3.5-turbo", type: "chat", isFullUrl: false }`
- `resolveNodeConfig("GPT-4")` → `{ baseUrl: "https://api.openai.com/v1", style: "openai", key: "sk-xxx", modelId: "gpt-4", type: "chat", isFullUrl: false }`

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
| 2026-08-03: 已缓存会话的修改经 `persistSessionMutation` 串行化，公开为 `updateSession` | 每次写入前保留深拷贝；持久化失败时恢复相同缓存对象，且同会话后续操作在恢复后继续执行，避免 UI 与持久层分叉 |
| 2026-08-11 | 会话删除期间拒绝新的 `updateSession` | `deleteSession` 入队前加入内存删除标记，更新入口发现标记立即返回 `null`；删除队列成功或失败后清除标记，避免删除后的更新排队复活会话。 |
| 2026-08-11 | 端点回滚兼容缺失 live reference | `restoreEndpoints` 对 checkpoint 中没有 live reference 的 snapshot 节点创建独立副本；已有节点仍原地恢复并保留 `children` 数组引用，避免回滚异常遮蔽原始持久化错误。 |
| 2026-08-11 | 清空期间建立 store mutation 屏障 | `clearDirectory` 先设置 `clearInProgress`/`clearGeneration`，等待已有 endpoint/session mutation 与直接 storage save，再清空持久化数据；清空期间拒绝新写入，跨清空保存不回写 cache，避免清空完成后数据复活。 |
| `migrateEndpoints` 在 `loadEndpoints` 和 `tryRestoreDirectory` 中各执行一次 | 双重保障确保旧格式数据在首次加载时被迁移；幂等（第二次 `data.groups` 已不存在） |
| 继承链解析不含 `modelId` 空值检查 | 空 `modelId` 表示分组节点，继承父节点 `modelId` 无意义；调用方在 `api.js` 中会过滤无 `modelId` 的节点 |
| 2026-07-17: assistant 消息改为 flat 格式，每条 response 是独立消息 | 原 `msg.responses` 嵌套冗余，`msg.content` 始终为空；新格式直接 `{role:"assistant", endpointId, content, status, ...}`，无 `responses` 中间层。`migrateSession` 在 `loadSession`/`loadSessionsIndex`/`tryRestoreDirectory` 三入口各执行一次 |
| `deleteNode` 同步清理 `selectedEndpoints` | 避免删除后选中列表中有悬空引用导致 UI 异常 |
| 2026-07-08 | `cloneNode` 只修改根副本名称为”原名（副本）”，子节点保持原名和配置；全树重生成 UUID，避免与原树 ID 冲突 |
| 2026-07-14 | 新增 `batchAddNodes` 批量创建子树，一次 `saveEndpoints` 插入所有节点 |
| 首条消息自动设为会话标题 | 减少用户操作步骤；取前 20 字符足够在侧边栏展示 |
| `addMessage` 将 content 统一转为 `[{ type, text }]` 数组格式 | 兼容旧版字符串格式和未来扩展（多模态）；`normalizeMessageContent` 保障向下兼容 |
| 2026-07-03 | `type` 字段加入节点数据模型和继承链 | 每个端点独立标注用途（chat/embedding/image/rerank），取代全局 inputMode 切换；inherit 后为空时 fallback 到 `detectModelType` 保证向后兼容 |
| 2026-07-12 | `resolveNodeConfig` 增加类型别名归一 | 旧数据中 `img-generate`/`image`/`embed`/`rerank` 统一转为标准值；修复端点树图标和筛选 |
| 2026-07-12 | `detectModelType` 增加 image-generation 检测 | 按关键词 `image`/`dall-e`/`diffusion`/`flux` 识别生图模型，自动设为 `image-generation` |
| 2026-07-22 | `resolveNodeConfig` 增加 voice/instruction 向后兼容 | 旧版 TTS 节点将 voice/instruction 存为顶层字段而非 `node.params`，`config.params` 构建时补充读取顶层字段 |
| 2026-07-24 | 增加 `video-generation` 类型 + `video` 别名 | 关键词 `video`/`seedance`/`kling` → `video-generation` |
| 2026-07-27 | `reorderNode` / `moveNodeAsChild` 在修改树前统一调用 `resolveTreeMove` | 祖先拖向自身后代时，原流程先移除源再查目标，可能丢失子树或错误重根；非法移动现在不改树、不持久化 |
| 2026-07-28 | `addNode` 返回创建的节点对象，失败返回 `null`；`batchAddNodes` 仍返回 ID 数组 | 局部 UI 插入需要节点完整数据，批量导入保留 ID 数组契约以区分两类调用 |
| 2026-08-06 | 完整 URL 直连字段统一为 `isFullUrl` | 旧 `directUrl` 只在解析边界读取兼容；新建、更新、复制和请求链路只使用 `isFullUrl`。继承按字段存在性而非 truthy 判断，使子节点显式 `false` 能覆盖父节点的 `true`。 |
| 2026-08-06 | 完整 URL 覆盖字段仅在源节点显式设置时持久化 | 未设置并非 `false`，而是继承父级；新增、批量新增、复制与旧 groups/models 迁移保留此三态。`updateNode` 把兼容写入的 `directUrl` 一次性归一，避免双字段继续分叉。 |
| 2026-08-07 | 端点加载时递归归一化并持久化完整 URL 字段 | `loadEndpoints` 与 `tryRestoreDirectory` 共用加载后处理；检测到旧 `directUrl` 或非布尔 `isFullUrl` 时原地修复并尝试保存，保存失败不阻塞加载，保留内存结果供下次重试。 |
| 2026-08-11 | restoreEndpoints 防御 checkpoint/live reference 不一致 | 已有节点原地恢复并保留 children 引用；缺失 live reference 的 snapshot 节点独立重建，避免回滚异常遮蔽原始持久化错误。 |

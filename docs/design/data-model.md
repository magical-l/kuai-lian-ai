---
title: 数据模型
covers_file: [src/modules/store.js, src/modules/storage-core.js, src/extension/storage-core.js]
depends_on: [architecture.md]
api_signature: endpointsData / sessionsCache / storage.loadEndpoints / storage.saveEndpoints / storage.loadSession / storage.saveSession
last_updated: 2026-07-17
why_exists: 定义端点树、会话和消息的数据结构及存储抽象层，确保前后端存储迁移的正确性
---

## 设计意图

数据模型分为两个域：(1) 端点树（端点和模型的层次结构），(2) 会话（对话历史）。前者是树形结构支持继承，后者是线性消息列表。两者的存储由统一抽象层 window.__STORAGE__ 封装，支持三种后端：目录存储（File System Access API）、浏览器存储（IndexedDB）、扩展存储（chrome.storage）。

### 端点树数据结构

```json
{
  "nodes": [
    {
      "id": "uuid",
      "name": "组/端点名称",
      "baseUrl": "https://api.example.com",
      "style": "openai | claude | gemini | ''",
      "key": "api-key-string",
      "modelId": "gpt-4o",
      "remark": "仅用于显示的备注",
      "type": "chat",
      "children": [
        {
          "id": "uuid",
          "name": "子节点名称",
          "baseUrl": "",
          "style": "",
          "key": "",
          "modelId": "gpt-4o",
          "remark": "",
          "type": "",
          "children": []
        }
      ]
    }
  ]
}
```

**继承机制**：resolveNodeConfig(nodeId) 沿祖先链向上查找缺失字段，覆盖顺序：节点自身 > 父 > 祖父 > ...（从最近祖先开始）。继承字段包括 baseUrl、style、key、modelId、type。其中 type 继承后仍为空时，从 modelId 启发式推断（detectModelType）。只有 baseUrl、key、modelId 都解析到有效值（不含空串），该节点才能作为可用的端点。

一个节点可以作为"端点容器"（有 children 但自身无 modelId），也可以作为"端点叶子"（无 children，有 modelId），或同时兼具两者。

**节点有效性判断**（isNodeTestable）：resolveNodeConfig 返回的配置中 baseUrl、key、modelId 均非空，且 config.type 为 chat 或 embedding。

### 会话和消息结构

```json
{
  "id": "uuid",
  "title": "会话标题（自动从首条消息截取20字）",
  "createdAt": 1700000000000,
  "messages": [
    {
      "role": "user | assistant | system",
      "timestamp": 1700000000000,
      "content": [{ "type": "text", "text": "内容" }],
      "targetEndpoints": ["uuid1", "uuid2"],
      "responses": [{ "endpointId": "uuid1", "content": "...", "usage": {} }],
      "endpointId": "uuid",
      "usage": { "prompt_tokens": 10, "completion_tokens": 20 }
    }
  ]
}
```

content 字段统一使用 content blocks 数组格式（[{type, text}]）。字符串和数组的兼容由 normalizeMessageContent 处理。旧格式的 content 字符串在加载时归一化为数组。

多端点对话时，user 消息记录 targetEndpoints 指明发送给哪些端点；assistant 消息通过 responses 数组存储各端点的独立回复。单端点模式则使用 endpointId 字段。

### 存储后端切换模式

`window.__STORAGE__` 是统一存储接口。通过 `getBackend()` 路由：

- **currentMode === 'directory'** → DirectoryStorage
  - 端点：endpoints.json（JSON 文件）
  - 会话：sessions/<uuid>.json（每个会话独立文件）
  - 目录句柄：持久化到 IndexedDB（endpoint-manager DB）
  - API：File System Access API

- **其他情况** → BrowserStorage
  - 端点：IndexedDB key 'endpoints'（或 chrome.storage.local）
  - 会话：IndexedDB key 'sessions'（每个会话存为一个 keyspace）
  - 非扩展：IndexedDB（kuai-lian-ai-browser DB）
  - 扩展：chrome.storage.local

模式偏好存于 `__mode` key 中。switchMode 方法支持两种模式间的数据迁移（exportAll → 切换 → importAll）。

*注意：非扩展版 src/modules/storage-core.js 是旧版，不作为构建输入——构建时扩展版用 src/extension/storage-core.js，独立版完全内联。*

### 旧 groups 到 nodes 的数据迁移

旧数据结构使用 `groups` 字段（每组含 group 属性 + models 数组列表），新结构统一为 `nodes` 树形。迁移在 migrateEndpoints 中处理：

```javascript
function migrateEndpoints(data) {
  if (data.groups && !data.nodes) {
    // 每个 group 转为一个父节点
    // 每个 model 转为子节点（携带 modelId）
    // 删除旧 groups 字段
  }
  return data;
}
```

迁移后，stripModels 递归清理遗留的 models 字段（旧兼容字段）。迁移发生在每次 loadEndpoints 和 tryRestoreDirectory 调用中。

## 函数索引

| 函数 | 所在文件 | 功能 | 可见性 | 备注 |
|------|----------|------|--------|------|
| findNodeWithAncestors | src/modules/store.js | 递归查找节点及其祖先链 | 内部 | 返回 {node, ancestors} |
| resolveNodeConfig | src/modules/store.js | 沿祖先链继承解析端点配置 | 全局 | 五个字段继承 + type 回退 detectModelType |
| detectModelType | src/modules/store.js | 从模型名推断类型 | 全局 | embedding/rerank/chat |
| migrateEndpoints | src/modules/store.js | 旧 groups→nodes 迁移 | 全局 | 自动运行 |
| addNode | src/modules/store.js | 创建节点 | 全局 | 支持指定父节点 |
| updateNode | src/modules/store.js | 更新节点字段 | 全局 | Object.assign |
| deleteNode | src/modules/store.js | 递归删除节点及子代 | 全局 | 同步清理 selectedEndpoints |
| cloneNode | src/modules/store.js | 深拷贝节点及子树 | 全局 | 插入到原节点之后，根副本名加“（副本）” |
| reorderNode | src/modules/store.js | 跨级拖动排序 | 全局 | 插入到目标前后 |
| moveNodeAsChild | src/modules/store.js | 节点跨级移动 | 全局 | 变为目标子节点 |
| createSession | src/modules/store.js | 创建新会话 | 全局 | 自动从首消息生成标题 |
| addMessage | src/modules/store.js | 追加消息 | 全局 | 处理多端点 responses |
| switchMode | src/extension/storage-core.js | 切换存储后端 | 全局 | 含数据迁移 |

## 决策日志

- 2026-07-01: 初始文档创建
- 2026-07-14: 新增 `batchAddNodes` 批量插入子树一次 save
- 2026-07-03: 节点数据结构新增 type 字段（chat/embedding/image/rerank），resolveNodeConfig 继承五个字段 + type 回退 detectModelType
- 2026-07-08: 新增节点复刻能力，数据层深拷贝整棵子树并为每个节点重新生成 UUID，根副本名称追加”（副本）”
- 2026-07-17: 助手消息格式变更——移除 `msg.responses` 嵌套，每条 response 为独立 `{role:”assistant”, endpointId, content, status, ...}` 消息。`msg.content` 不再写入。存量数据在加载时由 `migrateSession` 自动 flat
- 2026-07-17: 迁移函数 `migrateSession` 处理 3 种存量格式：(1) `responses` 数组→flat, (2) 老单端点 `endpointId` + 字符串 content (保持), (3) 远古无 endpointId 格式 (保留 content 字符串)

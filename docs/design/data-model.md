---
title: 数据模型
covers_file: [src/modules/store.js, src/modules/storage-core.js, src/extension/storage-core.js]
depends_on: [architecture.md]
api_signature: endpointsData / sessionsCache / storage.loadEndpoints / storage.saveEndpoints / storage.loadSession / storage.saveSession
last_updated: 2026-08-18
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
      "style": "openai | claude | gemini | responses | ''",
      "key": "api-key-string",
      "modelId": "gpt-4o",
      "remark": "仅用于显示的备注",
      "type": "chat",
      "isFullUrl": false,
      "params": { "temperature": 0.7, "max_tokens": null },
      "customParams": [{ "key": "vendor_option", "value": "value" }],
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

**继承机制**：`resolveNodeConfig(nodeId)` 沿祖先链向上查找缺失字段，覆盖顺序为节点自身 > 父 > 祖父 > ...。`findNodeWithAncestors()` 返回的祖先数组顺序是根节点到最近父节点，解析时从数组尾部向根遍历。继承字段包括 baseUrl、style、key、modelId、type、isFullUrl 和 params；type 继承后仍为空时，从 modelId 启发式推断（detectModelType）。只有 baseUrl、key、modelId 都解析到有效值（不含空串），该节点才能作为可用的端点。

节点 `type` 的当前标准值包括 `chat`、`embedding`、`image-generation`、`video-generation`、`reranking`、`tts`、`asr`；`style` 当前可见值包括 `openai`、`claude`、`gemini`、`responses`、`jimeng` 和空串。一个节点可以作为“端点容器”（有 children 但自身无 modelId），也可以作为“端点叶子”（无 children，有 modelId），或同时兼具两者。

### 节点参数与自定义参数

`params` 保存注册参数，按 key 使用三态协议：字段缺失表示当前节点不决定并继续读取祖先，具体值表示当前节点覆盖，`null` 表示明确由模型决定并阻断同名祖先参数。`customParams` 是用户显式添加的自定义参数数组（元素为 `{key, value}`），不参与注册参数控件的三态；Chat 请求会把它与会话/workspace 的 `_custom` 一起展开，其他请求路径当前并未全部展开 `_custom`。`addNode()` 对缺失或 `null` 的 `customParams` 使用空数组，`cloneNode()` 对缺失或 `null` 也复制为空数组；这与 `params` 容器对缺失、`null`、空对象和普通对象的保真规则不同。

旧 TTS 节点可能把 `voice` / `instruction` 直接保存在节点顶层，`resolveNodeConfig()` 仅在 `params` 缺少对应键时读取这些旧字段作为兼容值；新保存仍使用 `params`。

**节点测试资格判断**（`isEndpointTestable`）：`resolveNodeConfig()` 返回的 `baseUrl` 非空、`key` 不是 `undefined/null`、`modelId` 非空，且 `type` 为 `chat`、`embedding/embed`、`tts` 或 `asr`。该判断只决定节点是否进入连接测试 UI/批量 ID 集合；实际请求还要经过 provider 对应 `test*Config` 方法检查。`video-generation`、image、reranking 当前不进入连接测试集合。

### 会话和消息结构

```json
{
  "id": "uuid",
  "title": "会话标题（自动从首条消息截取20字）",
  "createdAt": 1700000000000,
  "modelParams": {
    "endpointId1": { "temperature": 0.7, "max_tokens": 4096 },
    "endpointId2": { "top_p": 0.9 }
  },
  "messages": [
    {
      "role": "user",
      "timestamp": 1700000000000,
      "content": [{ "type": "text", "text": "内容" }],
      "targetEndpoints": ["uuid1", "uuid2"]
    },
    {
      "role": "assistant",
      "timestamp": 1700000000000,
      "endpointId": "uuid1",
      "status": "completed",
      "usage": { "prompt_tokens": 10, "completion_tokens": 20 }
    }
  ]
}
```

新增消息的 content 使用 content blocks 数组格式（`[{type, text}]`），字符串和数组的兼容由 `normalizeMessageContent` 在新增/请求等消费路径处理。`migrateSession()` 负责拆平旧 `responses` 聚合消息，但不会保证把所有历史字符串 content 在加载时统一改写为数组。

多端点对话时，user 消息记录 `targetEndpoints` 指明发送给哪些端点；每个端点回复持久化为独立的 flat assistant 消息，并通过 `endpointId` 标识。旧数据中的 `responses` 聚合消息只作为迁移输入，`migrateSession()` 加载时拆平为多条 assistant 消息。

`modelParams` 字段存储该会话的 API 参数覆盖（如 temperature、max_tokens），以 endpointId 为 key；覆盖对象内部同样使用字段缺失/具体值/`null` 三态。创建新会话时，`createSession()` 将 workspace 的 `defaultSelectedEndpointParams` 整体深拷贝到会话首个持久化载荷，因此它包含 workspace 中已有的所有 endpointId 覆盖，不只包含本次首条消息的 `targetEndpoints`；首条 user 消息另以 `targetEndpoints` 记录本轮实际发送端点。会话参数弹窗可以继续修改或删除单个 endpointId 的会话覆盖。

请求生成时，当前代码的优先级是：会话 `modelParams[endpointId]`（存在该 endpoint 覆盖时） > workspace `defaultSelectedEndpointParams[endpointId]` > 端点 `resolveNodeConfig().params`。会话覆盖中的字段缺失会使用端点结果，具体值覆盖端点结果，`null` 阻断端点结果；若整个会话 endpoint 覆盖缺失，仍会回退到 workspace 覆盖。会话参数编辑器的显示只读取当前会话自身覆盖（无会话时读取 workspace），不把 workspace 混入当前会话控件；显示用的端点结果单独作为 fallback。

### 工作空间参数覆盖

工作空间（localStorage）维护当前选中的端点列表及其 API 参数覆盖，与会话分离：

- 端点 ID 列表：`localStorage key 'defaultSelectedEndpoints'`
- 参数覆盖：`localStorage key 'defaultSelectedEndpointParams'`，以 endpointId 为 key
- 无会话时设置的参数仅存于工作空间，刷新不丢失
- 取消选择端点时删除该 endpointId 的 workspace 参数覆盖；端点树删除成功时删除目标节点及全部后代的覆盖，删除失败时保留覆盖
- 上述清理只作用于 workspace 参数，不修改已有会话的 `modelParams`
- 发首条消息创建新会话时，工作空间 `defaultSelectedEndpointParams` 整体同步到新会话的 `modelParams`；本轮实际发送范围由首条消息的 `targetEndpoints` 单独记录
- 会话参数编辑器打开已有会话时，仅以会话自身的 `modelParams` 作为当前层 own 值，workspace 不混入控件；这是编辑器显示语义，不等于所有请求路径的读取语义。请求阶段 Chat/生图/视频/TTS/ASR 在会话 endpoint 覆盖整体缺失时仍会回退 workspace；embedding 当前只使用端点解析参数，不读取 session/workspace 覆盖

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
| resolveNodeConfig | src/modules/store.js | 沿祖先链解析普通配置和 `params` | 全局 | 参数按缺失/具体值/`null` 三态解析；type 回退 detectModelType |
| detectModelType | src/modules/store.js | 从模型名推断类型 | 全局 | chat/embedding/reranking/asr/tts/image-generation/video-generation |
| migrateEndpoints | src/modules/store.js | 旧 groups→nodes 迁移 | 全局 | 自动运行 |
| addNode | src/modules/store.js | 创建节点 | 全局 | `params` 按存在性深拷贝；`customParams` 缺失/null 归一为空数组 |
| updateNode | src/modules/store.js | 复制可枚举自有数据属性并安全更新节点 | 全局 | 特殊动态键不用原型链赋值语义 |
| deleteNode | src/modules/store.js | 递归删除节点及子代 | 全局 | 同步清理 selectedEndpoints |
| cloneNode | src/modules/store.js | 深拷贝节点及子树 | 全局 | `params` 保留四种容器状态；`customParams` 缺失/null 归一为空数组；根副本名加“（副本）” |
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
- 2026-07-23: 新增 asr 端点类型（Whisper 风格 API），detectModelType 加 whisper/transcribe/asr 关键词
- 2026-07-23: 新增 asr 端点类型（Whisper API），detectModelType 加 whisper/transcribe/asr 关键词
- 2026-07-22: 会话新增 `modelParams` 字段（API 参数覆盖），新增工作空间参数覆盖系统（localStorage + `defaultSelectedEndpointParams`），用于无会话时/新建会话时的参数持久化
- 2026-08-12: 明确新会话参数快照范围 | `createSession()` 整体复制 workspace 参数覆盖；`targetEndpoints` 独立记录首条消息实际发送端点
- 2026-08-12: 明确 workspace 参数覆盖生命周期 | 取消选择删除对应 endpointId 覆盖，删除分组递归删除根节点及后代覆盖；删除失败和已有会话 `modelParams` 均不受影响
- 2026-08-18: 按最终代码记录节点 `params/customParams`、参数缺失/具体值/`null` 三态、`endpointId` own-property 安全判断，以及 `params` 在 `addNode`/`cloneNode` 中对字段缺失、`null`、空对象和普通对象的容器保真；明确 `customParams` 数组缺失/null 会归一为空数组、会话编辑器的 own/fallback 分离与请求阶段仍存在的 workspace fallback。

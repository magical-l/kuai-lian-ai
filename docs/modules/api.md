---
title: API 层
covers_file: [src/modules/api.js, src/modules/shared.js]
depends_on: [providers.md]
api_signature: callAllModels, callAPI, callProvider, callEmbedding, stopAllGenerations
last_updated: 2026-07-20
why_exists: 流式 SSE 处理、多模型并发调度、停止机制和 Provider 格式转换
---

# API 层（src/modules/shared.js + src/modules/api.js）

## 设计意图

API 层将"构建请求 -> 发送 HTTP -> 解析 SSE 流 -> 提取内容"的管线与 Provider 抽象解耦。`providers` 对象只负责格式差异（openai/claude/gemini 各自如何构造请求体、如何解析 chunk），API 层负责通用的流处理、并发调度、取消、错误恢复和首 token 计时。

核心流水线：

```
callAllModels → callAPI → callProvider → mergeParams(config.body, params, style)
                                       → fetchWithTimeout → processSSEStream → handleParsedChunk → onChunk
                                       └─ createInitialState / createTagParser / processWithTagParser
```

参数配置（temperature、max_tokens 等）通过 `mergeParams()` 在 `buildRequest` 之后注入请求 body。Gemini 风格的参数放入 `body.generationConfig`，其他风格直接 merge 到顶层。

所有逻辑集中在这两个文件中，不分散到 UI 层。

### 职责边界

| 层 | 职责 | 不负责 |
|---|---|---|
| `callAllModels` | 并发调度、每个 endpoint 独立 AbortController、状态聚合、UI 回调 | 构造请求体、解析 chunk 格式 |
| `callAPI` | 按 style 查 provider、路由到 `callProvider` | 并发管理、UI 更新 |
| `callProvider` | 调用 provider.buildRequest、处理 HTTP 响应（含非流式 fallback）、启动 SSE 解析、finalizeState | 格式解析细节 |
| `processSSEStream` | `data:` 行提取、JSON parse、调用 provider.parseChunk | 状态跟踪、UI 回调 |
| `handleParsedChunk` | 将 parsed chunk 写入 state（thinking/content）、触发 onChunk | SSE 行解析 |
| `processWithTagParser` | <thinking> 标签的缓冲区匹配 | 结构化 API 事件（如 claude 的 content_block_start） |

## 函数索引

### 流式 SSE 处理

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `processSSEStream` | shared.js | `(res, provider, state, tagParser, onChunk) => Promise<void>` |
| `handleParsedChunk` | shared.js | `(parsed, state, tagParser, onChunk) => void` |
| `createInitialState` | shared.js | `() => ThinkingState` |
| `finalizeState` | shared.js | `(state) => void` |

`processSSEStream` 从 `ReadableStream<Uint8Array>` 逐块读取，按 `\n` 分行，过滤 `data:` 前缀，跳过 `[DONE]`。每行 JSON 传给 `provider.parseChunk` 得到结构化的 `parsed` 对象（`{content?, reasoning?, event?}`），再交 `handleParsedChunk` 写入 state。

`handleParsedChunk` 处理三种 parsed 类型：
- `parsed.event === 'thinking_start'` / `'content_start'` — 阶段切换（claude 结构化 thinking）
- `parsed.reasoning` — thinking 内容追加
- `parsed.content` — 正文内容追加，若需标签解析则走 `processWithTagParser`

### 多模型并发

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `callAllModels` | api.js | `(groups, endpointIds, messages, onChunk, sessionId) => Promise<Result[]>` |
| `callAPI` | shared.js | `(style, baseUrl, apiKey, model, messages, onChunk, signal, params) => Promise<ThinkingState>` |
| `callProvider` | shared.js | `(provider, baseUrl, apiKey, model, messages, onChunk, signal, style, params) => Promise<ThinkingState>` |
| `mergeParams` | shared.js | `(body, params, style) => void` |
| `getSessionGenerations` | api.js | `(sessionId) => Map<string, GenerationState>` |
| `clearSessionGenerations` | api.js | `(sessionId) => void` |
| `deleteSessionGenerations` | api.js | `(sessionId) => void` |

`callAllModels` 是为"多模型并行对话"设计的顶层入口：
1. 清空该 session 的旧 generation 记录
2. 为每个 endpointId 创建独立的 `GenerationState`（含独立的 `AbortController`）
3. `Promise.all` 并发执行所有 endpoint 请求
4. 每个 endpoint 的 `onChunk` 回调中更新 `GenerationState` 并触发外部 UI 回调
5. 返回结果数组，每个结果含 `{endpointId, status, content, thinking, firstTokenTime, totalDuration}`

`callProvider` 是单次 API 调用的完整生命周期：
1. `provider.buildRequest` 构造请求参数
2. `mergeParams(config.body, params, style)` 注入用户配置的参数（temperature、max_tokens 等）
3. `fetchWithTimeout` 发送（60s 超时）
3. 检测 `text/html` 响应（代理返回错误页面时直接报错，避免解析非 JSON）
4. 检测 `application/json` 响应（非流式 fallback — 有些代理返回 200 + JSON 错误）
5. `processSSEStream` 解析流
6. `finalizeState` 确保 thinkingDuration 已闭合

### 停止生成机制

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `stopSingleGeneration` | api.js | `(sessionId, endpointId) => void` |
| `stopSessionGenerations` | api.js | `(sessionId) => void` |
| `stopAllGenerations` | api.js | `() => void` |

三层停止粒度，均通过 `AbortController.abort()` 实现：

- `stopSingleGeneration` — 停止某个 session 的某个 endpoint。从 `sessionGenerations` Map 中查对应 `AbortController` 并 abort。
- `stopSessionGenerations` — 停止某个 session 下所有正在生成的 endpoint。遍历 Map 逐个 abort。
- `stopAllGenerations` — 停止当前活跃 session 的所有生成。委托给 `stopSessionGenerations(currentSession.id)`。

Abort 后 `callProvider` 的 catch 块捕获 `AbortError`，返回当前已累积的 state（不重新抛出），`callAllModels` 将其标记为 `status: 'stopped'`。

`currentAbortController` 是全局单例，仅当 `callProvider` 未传入外部 signal 时使用（为 `callAPI` 这个单一路由提供兜底取消能力）。

### 格式转换

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `toOpenAIContent` | api.js | `(contentArray) => Array` |
| `toClaudeContent` | api.js | `(contentArray) => Array` |
| `toGeminiContent` | api.js | `(contentArray) => Array` |

三个函数将统一的内部附件格式（`{type:'text'|'image'|'file', source:{type,media_type,data}}`）转换为各自 API 体的 `content` 数组格式。

转换矩阵：

| 内部 type | toOpenAIContent | toClaudeContent | toGeminiContent |
|---|---|---|---|
| `text` / `file_text` | `{type:'text', text}` | `{type:'text', text}` | `{text}` |
| `image` (base64) | `{type:'image_url', image_url:{url:'data:...'}}` | `{type:'image', source:{type:'base64',...}}` | `{inline_data:{mime_type,data}}` |
| `image` (URL) | `{type:'image_url', image_url:{url}}` | `{type:'image', source:{type:'url', url}}` | `{text:'[图片 URL: ...]'}` (降级为文字) |
| `file` | `{type:'image_url', image_url:{url:'data:...'}}` | `{type:'image', source:{type:'base64',...}}` | `{inline_data:{mime_type,data}}` |
| 不支持 | `{type:'text', text:'[附件 ...]'}` | `{type:'text', text:'[附件 ...]'}` | `{text:'[附件 ...]'}` |

Gemini 对 URL 来源的图片不做内联，因为 Gemini API 本身支持 URL，但当前实现降级为文字占位符。

### thinking 标签解析

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `createTagParser` | shared.js | `() => TagParser` |
| `processWithTagParser` | shared.js | `(chunk, state, parser, onChunk) => void` |
| `THINKING_TAGS` | storage-core.js | `[{start:'<thinking>', end:'</thinking>'}]` |

用于第三方 API 在 content 流中嵌入 `<thinking>...</thinking>` 标签（如 DeepSeek）。结构化 API（claude）自带 `content_block_start/thinking_delta` 事件，设置 `needsTagParsing: false` 跳过此处理。

`createTagParser` 返回 `{buffer, inThinking, currentTag}` 状态机。`processWithTagParser` 逐 chunk 追加到 buffer，扫描 `THINKING_TAGS` 的 start/end 边界，将匹配到的 thinking 内容与正文内容分别写入 `state.thinking` 和 `state.content`。

处理逻辑：
1. 非 thinking 状态 -> 在 buffer 中查找 `tag.start` -> 找到则切片，切换 thinking 状态，记录 `thinkingStartTime`
2. thinking 状态 -> 在 buffer 中查找 `tag.end` -> 找到则提取 thinking 内容，切换回 content 状态，记录 `thinkingDuration`；未找到则整个 buffer 追加到 thinking
3. 非 thinking 状态且不在查找中 -> 整个 buffer 追加到 content
4. 每次调用都触发 `onChunk(state)` 使 UI 能实时更新

`handleParsedChunk` 对 `parsed.content` 分支，根据 `tagParser` 是否为 null 决定走 `processWithTagParser` 还是直接追加。

### 首 token 计时

首 token 时间的计算位置在 `callAllModels` 的 `onChunk` 包装器内：

```js
if (chunkState.phase === 'thinking' && genState.firstTokenTime === null) {
    genState.firstTokenTime = Date.now() - startTime;
} else if (chunkState.phase === 'content' && genState.firstTokenTime === null) {
    genState.firstTokenTime = chunkState.firstContentTokenTime
        ? chunkState.firstContentTokenTime - startTime
        : Date.now() - startTime;
}
```

- `state.firstContentTokenTime` 在 `handleParsedChunk` / `processWithTagParser` 中设置——第一次收到 `parsed.content` 或 content 阶段第一次调用 `onChunk` 时记录 `Date.now()`
- thinking 阶段的第一个 token 也算"首 token"
- 最终 `genState.firstTokenTime` 是相对 `startTime` 的毫秒偏移量，供 UI 排序（快的在上）

### 生图请求

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `callImageGeneration` | shared.js | `(style, baseUrl, apiKey, model, messages) => Promise<{url?, b64_json?, imageData?, revised_prompt?}>` |

非流式请求路径，用于图片生成：
1. 按 style 查 provider，检查 `buildImageRequest` 方法存在
2. `provider.buildImageRequest` 构造请求
3. `fetchWithTimeout` 发送（120s 超时）
4. 验证非 200 / text/html → 抛错
5. JSON parse 响应，检查 `data.error`
6. 优先调用 `provider.parseImageResponse(data)`（Gemini 自定义格式解析），fallback 到 OpenAI 标准格式 `data.data[0].url` / `data.data[0].b64_json`
7. 若返回 URL 则 fetch 下载转 blob URL + base64，若直接返回 base64 则拼接 data URL

### 嵌入请求

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `callEmbedding` | shared.js | `(style, baseUrl, apiKey, model, input) => Promise<{embedding, model?, usage?}>` |

专用嵌入请求路径，不经过流式管线：
1. 按 style 查 provider，检查 `buildEmbeddingRequest` 方法存在
2. `provider.buildEmbeddingRequest` 构造请求
3. `fetchWithTimeout` 发送（60s 超时）
4. 验证 content-type 非 HTML、是 JSON
5. 验证 JSON 无 `error` 字段
6. `provider.parseEmbeddingResponse` 提取 embedding 向量

### TTS 语音合成请求

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `callTTS` | shared.js | `(style, baseUrl, apiKey, model, input, voice?, instruction?) => Promise<{blobUrl, audioData, contentType, size}>` |
| `base64ToBlob` | shared.js | `(b64, mimeType?) => Blob` |

非流式请求路径，类似 `callImageGeneration`：
1. 按 style 查 provider，检查 `buildTTSRequest` 方法存在
2. `provider.buildTTSRequest` 构造请求
3. `fetchWithTimeout` 发送（120s 超时）
4. 验证非 200 → 抛错
5. 验证非 text/html → 抛错
6. `res.blob()` 获取二进制音频 → `blobToBase64` 转 base64（去 data URL 前缀后存储）→ `URL.createObjectURL` 创建 blobUrl
7. 返回 `{ blobUrl, audioData, contentType, size }`

`base64ToBlob` 是 `blobToBase64` 的逆操作，兼容带 `data:...` 前缀和不带前缀两种 base64 格式。由 `messages.js` 在渲染已持久化的音频时调用。
1. 按 style 查 provider，检查 `buildEmbeddingRequest` 方法存在
2. `provider.buildEmbeddingRequest` 构造请求
3. `fetchWithTimeout` 发送（60s 超时）
4. 验证 content-type 非 HTML、是 JSON
5. 验证 JSON 无 `error` 字段
6. `provider.parseEmbeddingResponse` 提取 embedding 向量

## 错误处理策略

| 错误场景 | 处理方式 |
|---|---|
| HTTP 非 200 | 读取响应体文本，抛出 `'API错误: {status} - {body}'` |
| HTTP 200 + text/html | 提取 `<title>` 或前 100 字符，抛出 `'服务器返回了HTML页面: ...'`（代理地址错误） |
| HTTP 200 + application/json | 尝试解析，若有 `json.error` 则抛出；否则重包装为 Response 供 SSE 解析（兼容非流式代理） |
| SSE 行 JSON 解析失败 | `try/catch` 静默跳过（单行损坏不影响后续） |
| AbortError | `callProvider` 返回已累积的 state，不抛出 |
| 响应体为空 | 抛出 `'Response body is empty'` |

## 决策日志

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-07-19 | 新增 `callTTS` / `base64ToBlob` | 支持 TTS 语音合成模型类型，非流式请求，二进制响应 |
| 2026-07-19 | callTTS 使用 `blobToBase64` 后 `split(',')[1]` 去前缀 | `FileReader.readAsDataURL` 返回带 `data:` 前缀的 data URL，持久化时需纯 base64 |

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-04-23 | Provider 格式抽象采用 buildRequest/parseChunk 接口 | 三种 API 格式差异大，统一接口让 API 层零耦合于具体格式 |
| 2026-04-23 | 并发使用 `Promise.all` 而非手动协调 | 各 endpoint 独立，无需相互同步，Promise.all 最简单 |
| 2026-04-23 | 每个 endpoint 独立 AbortController | 支持单 endpoint 停止，不干扰其他 |
| 2026-04-23 | fetch 超时 60s | 首 token 通常几秒内返回，60s 足够覆盖慢模型和网络抖动 |
| 2026-04-23 | thinking 标签解析用 buffer 状态机 | <thinking> 可能跨 chunk 边界，buffer 方式不依赖 chunk 对齐 |
| 2026-04-23 | 首 token 计时分 thinking/content 两阶段 | thinking 阶段也算"首次响应"的一部分，UI 排序需要在 thinking 阶段就开始 |
| 2026-04-26 | non-streaming JSON fallback | 部分代理（如某些中转站）不支持 streaming 但返回 200 + JSON，重包装后走同一解析路径 |
| 2026-04-26 | content-type 检测优先于状态码 | 代理可能返回 200 但内容是 HTML 错误页面，仅靠状态码无法区分 |
| 2026-07-20 | `mergeParams` 新增 Gemini keyMap | Gemini `generationConfig` 字段名是 camelCase，注册表用 snake_case，需要映射（`max_tokens`→`maxOutputTokens`, `top_p`→`topP` 等） |
| 2026-07-20 | `callImageGeneration` 新增 `provider.parseImageResponse` 优先路径 | Gemini 生图响应格式不同于 OpenAI（`candidates[0].content.parts[].inlineData` 而非 `data.data[0].url`），由各 provider 自定义解析 |

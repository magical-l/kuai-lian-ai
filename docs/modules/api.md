---
title: API 层
covers_file: [src/modules/api.js, src/modules/shared.js]
depends_on: [providers.md]
api_signature: callAllModels, callAPI, callProvider, callEmbedding, stopAllGenerations
last_updated: 2026-08-20
why_exists: 流式 SSE 处理、多模型并发调度、停止机制和 Provider 格式转换
---

# API 层（src/modules/shared.js + src/modules/api.js）

## 设计意图

API 层将“构建请求 → 发送 HTTP → 解析 SSE 流 → 提取内容”的管线与 Provider 抽象解耦。`providers` 对象负责格式差异（openai/claude/gemini 的聊天/生图格式、OpenAI Responses 聊天格式，以及 jimeng 的视频请求构造），API 层负责通用的流处理、并发调度、取消、错误恢复和首 token 计时。

核心流水线：

```
callAllModels → callAPI → callProvider → mergeParams(config.body, params, style)
                                       → fetchWithTimeout → processSSEStream → handleParsedChunk → onChunk
                                       └─ createInitialState / createTagParser / processWithTagParser
```

参数配置（temperature、max_tokens 等）通过 `mergeParams(body, params, style)` 在 `buildRequest` 之后注入请求 body。参数为 `null` 或空字符串时跳过；Gemini 风格的参数放入 `body.generationConfig`，其他风格直接 merge 到顶层。Responses 风格把 `max_tokens` 映射为 `max_output_tokens`，把具体的 `reasoning_effort` 合并为 `body.reasoning.effort`；不为 `null`/空字符串创建空 `reasoning`，已有普通 `body.reasoning` 对象的可枚举字段会保留。特殊键通过 own-property 检查，避免 `__proto__`、`constructor` 等键改变合并语义。聊天请求的 endpoint、workspace、session 和 `_custom` 参数在编排层合并后再进入这里；生图、视频、TTS、ASR 只合并普通覆盖键，embedding 只接收调用方传入的 endpoint 参数。完整 URL 开关统一接收解析后的 `isFullUrl`：为 `true` 时以去除末尾 `/` 的 `baseUrl` 覆盖 Provider 构造的默认路径，为 `false` 时保留 Provider 路径；API 请求函数不兼容旧 `directUrl`，兼容归一化集中在配置解析边界。

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

`processSSEStream` 从 `ReadableStream<Uint8Array>` 逐块读取，按 `\n` 分行，过滤 `data:` 前缀，兼容 `data:` 后可选空格，跳过 `[DONE]`，并在 EOF 时处理最后一条无换行残行。坏 JSON 行静默跳过；`provider.parseChunk` 的异常不在此处吞掉，会沿请求链路传播。每行 JSON 传给 `provider.parseChunk` 得到结构化的 `parsed` 对象（`{content?, reasoning?, event?, terminal?}`），再交 `handleParsedChunk` 写入 state。`terminal` 支持 `completed`、`failed`、`incomplete`、`refused`；终态按优先级聚合，`failed` 优先于其他终态，未提供终态或未知 reason 保持兼容。

`handleParsedChunk` 处理三种 parsed 类型：
- `parsed.event === 'thinking_start'` / `'content_start'` — 阶段切换（claude 结构化 thinking）
- `parsed.reasoning` — thinking 内容追加
- `parsed.content` — 正文内容追加，若需标签解析则走 `processWithTagParser`

### 多模型并发

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `callAllModels` | shared.js | `(groups, endpointIds, messages, onChunk, sessionId) => Promise<Result[]>` |
| `callAPI` | shared.js | `(style, baseUrl, apiKey, model, messages, onChunk, signal = null, params, isFullUrl) => Promise<ThinkingState>` |
| `callProvider` | shared.js | `(provider, baseUrl, apiKey, model, messages, onChunk, signal, style, params, isFullUrl) => Promise<ThinkingState>` |
| `mergeParams` | shared.js | `(body, params, style) => void` |
| `callImageGeneration` | shared.js | `(style, baseUrl, apiKey, model, messages, isFullUrl, params, signal, onInitialResult) => Promise<ImageResult>` |
| `callEmbedding` | shared.js | `(style, baseUrl, apiKey, model, input, isFullUrl, params, signal) => Promise<EmbeddingResult>` |
| `callVideoGeneration` | shared.js | `(style, baseUrl, apiKey, model, messages, isFullUrl, params, signal) => Promise<VideoResult>`；当前响应读取按 OpenAI `data[0]` 形态，Gemini `candidates[].content.parts[]` 尚未完整解析 |
| `callTTS` | shared.js | `(style, baseUrl, apiKey, model, input, voice, instruction, isFullUrl, signal) => Promise<TTSResult>` |
| `callASR` | shared.js | `(style, baseUrl, apiKey, model, audioFile, params, isFullUrl, signal) => Promise<ASRResult>` |
| `invalidateSession` | api.js | `(sessionId) => void` |
| `isSessionInvalidated` | api.js | `(sessionId) => boolean` |
| `clearSessionInvalidation` | api.js | `(sessionId) => void` |
| `getSessionAbortController` | api.js | `(sessionId) => AbortController` |
| `abortSessionRequests` | api.js | `(sessionId) => void` |
| `finishSessionAbortController` | api.js | `(sessionId, controller) => void` |
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
2. `isFullUrl === true` 时以 `baseUrl.replace(/\/+$/, '')` 覆盖 `config.url`；否则保留 Provider 构造的默认路径
3. `mergeParams(config.body, params, style)` 注入用户配置的参数（temperature、max_tokens 等）
4. `fetchWithTimeout` 发送（60s 超时），并沿用调用方传入的 AbortSignal
5. 检测 `text/html` 响应（代理返回错误页面时直接报错，避免解析非 JSON）
6. 检测 `application/json` 响应（非流式 fallback — 有些代理返回 200 + JSON 错误）
7. `processSSEStream` 解析流
8. `finalizeState` 确保 thinkingDuration 已闭合

### 会话失效与停止生成机制

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `stopSingleGeneration` | api.js | `(sessionId, endpointId) => void` |
| `stopSessionGenerations` | api.js | `(sessionId) => void` |
| `stopAllGenerations` | api.js | `() => void` |

会话删除使用内存级失效集合和两条 AbortController 路径：

- `invalidateSession` / `isSessionInvalidated` / `clearSessionInvalidation` — 标记、查询、清理 session 失效状态。失效标记不写入 storage；删除入口先标记，再停止请求，阻断迟到回调。
- `getSessionAbortController` — 为同一 session 的非流式请求提供共享 controller；同一 controller 按并发发送次数引用计数，已 abort 或不存在时创建新的 controller。
- `abortSessionRequests` — abort 并移除 session 级非流式请求 controller。
- `finishSessionAbortController` — 当前 controller 仍匹配时递减引用计数；计数归零后移除 controller，避免正常完成的请求影响下一次独立发送。
- `stopSingleGeneration` — 停止某个 session 的某个 chat endpoint，从 `sessionGenerations` Map 中查对应 AbortController 并 abort。
- `stopSessionGenerations` — 同时调用 `abortSessionRequests` 和 `clearSessionGenerations`，停止该 session 的非流式请求及所有 chat endpoint。
- `stopAllGenerations` — 停止当前活跃 session 的全部请求，委托给 `stopSessionGenerations(currentSession.id)`。

`callAllModels` 入口和每次 `onChunk` 前均检查 `isSessionInvalidated(sessionId)`；完成、停止、失败的状态更新也不会写回已失效 session。`main.js` 的非流式分支在结果回写前检查 `signal.aborted || isSessionInvalidated(sessionId)`，最终 assistant 保存和 finally 中的 reload/refresh 同样受保护。`updateCardStatus` 在 `requestAnimationFrame` 实际执行 DOM 写入前再次检查失效状态。

所有请求函数将 signal 传给 `fetchWithTimeout`；`fetchWithTimeout` 再将外部 signal 与自身超时 controller 组合，因此删除或停止会话时可中止 embedding、image、video、TTS、ASR 请求。

Abort 后，`callAllModels` 将 chat 的 `AbortError` 标记为 `status: 'stopped'` 并保留已累积内容；已失效 session 不更新卡片、不保存 assistant 消息。非失效 session 的 chat AbortError 仍由 `callAllModels` 返回 stopped 结果。

`currentAbortController` 是全局单例，仅当 `callProvider` 未传入外部 signal 时使用（为 `callAPI` 的单一路由提供兜底取消能力）。

### 格式转换

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `toOpenAIContent` | api.js | `(contentArray) => Array` |
| `toClaudeContent` | api.js | `(contentArray) => Array` |
| `toGeminiContent` | api.js | `(contentArray) => Array` |

三个函数将统一的内部附件格式（`text`/`file_text`/`image`/`file`，附件二进制带 `source:{type,media_type,data}`）转换为各自 API 体的 `content` 数组格式。`file_text` 保持为文本，不转发文件；二进制文件先由附件层用可靠的 `File.type` 或扩展名归一 MIME，预览与上传载荷均使用归一后的 MIME。

转换矩阵：

| 内部 type | OpenAI Chat | Claude | OpenAI Responses | Gemini |
|---|---|---|---|---|
| `text` / `file_text` | `{type:'text', text}` | `{type:'text', text}` | `{type:'input_text', text}` | `{text}` |
| `image`（base64） | `{type:'image_url', image_url:{url:'data:...'}}` | `{type:'image', source:{type:'base64',...}}` | `{type:'input_image', image_url:'data:...'}` | `{inline_data:{mime_type,data}}` |
| `image`（URL） | `{type:'image_url', image_url:{url}}` | `{type:'image', source:{type:'url', url}}` | `{type:'input_image', image_url:url}` | `{text:'[图片 URL: ...]'}`（降级为文字） |
| `file`（PDF/Word/Excel/PPT） | `{type:'file', file:{filename,file_data:'data:...'}}` | 仅 PDF → `{type:'document', source:{type:'base64',...}}` | `{type:'input_file', filename, file_data:'data:...'}` | `{inline_data:{mime_type,data}}` |
| `file`（MP3/WAV） | `{type:'input_audio', input_audio:{format,data}}` | 明确失败（不支持音频） | 明确失败（不支持音频） | `{inline_data:{mime_type,data}}` |
| `file`（其他类型） | 明确失败 | 明确失败 | `{type:'input_file', filename, file_data:'data:...'}`（非音频） | `{inline_data:{mime_type,data}}`（保留归一 MIME） |

Gemini 对 URL 来源的图片不做内联，因为 Gemini API 本身支持 URL，但当前实现降级为文字占位符。附件 MIME 归一包含 `.ppt`→`application/vnd.ms-powerpoint`、`.pptx`→`application/vnd.openxmlformats-officedocument.presentationml.presentation`；音频只有 MP3/WAV 映射到 OpenAI Chat 的 `input_audio`，其他音频格式明确失败。

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
| `callImageGeneration` | shared.js | `(style, baseUrl, apiKey, model, messages, isFullUrl, params, signal, onInitialResult?) => Promise<{url?, b64_json?, imageData?, revised_prompt?}>` |

非流式请求路径，用于图片生成：
1. 按 style 查 provider，检查 `buildImageRequest` 方法存在
2. `provider.buildImageRequest` 构造请求
3. `isFullUrl === true` 时用去掉末尾 `/` 的 `baseUrl` 覆盖请求 URL；否则保留 Provider 默认路径
4. `fetchWithTimeout` 发送（120s 超时）
5. 验证非 200 / text/html → 抛错
6. JSON parse 响应，检查 `data.error`
7. 优先调用 `provider.parseImageResponse(data)`（Gemini 自定义格式解析），fallback 到 OpenAI 标准格式 `data.data[0].url` / `data.data[0].b64_json`
8. 解析出 URL/base64 初始结果后调用可选 `onInitialResult(result)`，让 UI 先显示已返回的图片；若返回 URL 则继续 fetch 下载转 blob URL + base64，若直接返回 base64 则拼接 data URL

### 嵌入请求

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `callEmbedding` | shared.js | `(style, baseUrl, apiKey, model, input, isFullUrl, params, signal) => Promise<{embedding, model?, usage?}>` |

专用嵌入请求路径，不经过流式管线：
1. 按 style 查 provider，检查 `buildEmbeddingRequest` 方法存在
2. `provider.buildEmbeddingRequest` 构造请求
3. `isFullUrl === true` 时用去掉末尾 `/` 的 `baseUrl` 覆盖请求 URL；否则保留 Provider 默认路径
4. 将调用方传入的解析后端点 `params` 合并进请求体；当前 `main.js` 的 embedding 分支不读取 session/workspace 参数覆盖
5. `fetchWithTimeout` 发送（60s 超时）
6. 验证 content-type 非 HTML、是 JSON
7. 验证 JSON 无 `error` 字段
8. `provider.parseEmbeddingResponse` 提取 embedding 向量

### TTS 语音合成请求

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `callTTS` | shared.js | `(style, baseUrl, apiKey, model, input, voice, instruction, isFullUrl, signal) => Promise<{blobUrl, audioData, contentType, size}>` |
| `base64ToBlob` | shared.js | `(b64, mimeType?) => Blob` |

非流式请求路径，类似 `callImageGeneration`：
1. 按 style 查 provider，检查 `buildTTSRequest` 方法存在
2. `provider.buildTTSRequest` 构造请求
3. `isFullUrl === true` 时用去掉末尾 `/` 的 `baseUrl` 覆盖请求 URL；否则保留 Provider 默认路径
4. `fetchWithTimeout` 发送（120s 超时）
5. 验证非 200 → 抛错
6. 验证非 text/html → 抛错
7. `res.blob()` 获取二进制音频 → `blobToBase64` 转 base64（去 data URL 前缀后存储）→ `URL.createObjectURL` 创建 blobUrl
8. 返回 `{ blobUrl, audioData, contentType, size }`

`base64ToBlob` 是 `blobToBase64` 的逆操作，兼容带 `data:...` 前缀和不带前缀两种 base64 格式。由 `messages.js` 在渲染已持久化的音频时调用。

### 视频生成与 ASR 请求

| 函数 | 所在文件 | 签名 |
|---|---|---|
| `callVideoGeneration` | shared.js | `(style, baseUrl, apiKey, model, messages, isFullUrl, params, signal) => Promise<VideoResult>`；当前响应读取按 OpenAI `data[0]` 形态，Gemini `candidates[].content.parts[]` 尚未完整解析 |
| `callASR` | shared.js | `(style, baseUrl, apiKey, model, audioFile, params, isFullUrl, signal) => Promise<ASRResult>` |

两者均为非流式请求：先由 Provider 构造默认请求 URL，再仅在 `isFullUrl === true` 时改用去除末尾 `/` 的 `baseUrl`。该布尔值已由 store 归一化，API 层不读取旧 `directUrl`。当前 ASR 的 `language`、`prompt`、`temperature` 仅在 truthy 时发送，`response_format` 固定为 `json`；因此注册表中的 `temperature: 0` 不会通过当前 ASR 请求链路发送。TTS 的注册参数 `speed` 当前也未传入 `callTTS` 或 Provider body。

## 错误处理策略

| 错误场景 | 处理方式 |
|---|---|
| HTTP 非 200 | 读取响应体文本，抛出 `'API错误: {status} - {body}'` |
| HTTP 200 + text/html | 提取 `<title>` 或前 100 字符，抛出 `'服务器返回了HTML页面: ...'`（代理地址错误） |
| HTTP 200 + application/json | 尝试解析，若有 `json.error` 则抛出；否则重包装为 Response 供 SSE 解析（兼容非流式代理） |
| SSE 行 JSON 解析失败 | `try/catch` 静默跳过（单行损坏不影响后续） |
| Provider `parseChunk` 异常 | 不在 SSE 层吞掉，直接传播到调用方 |
| Provider 终态 | `completed` 正常结束；`failed`、`incomplete`、`refused` 映射为失败卡片并保留 partial thinking/content；未知 reason 或缺少 terminal 仍按已有内容兼容处理 |
| AbortError | `callProvider` 的实际行为是沿 finally 清理 controller 后将 AbortError 继续抛出；`callAllModels` 捕获 chat AbortError 并返回 `status: 'stopped'`，非流式编排分支在 signal 已 abort 或 session 已失效时丢弃结果 |
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
| 2026-08-06 | 请求函数的完整 URL 开关统一为 `isFullUrl` | 所有流式和非流式请求在 Provider 构造默认路径后，仅在 `isFullUrl` 为真时将 URL 替换为 `baseUrl`；旧 `directUrl` 的兼容集中在 store 配置解析边界，避免请求链路分散兼容。 |
| 2026-08-12 | 生图请求增加初始结果回调 | 生图 URL 的二次下载和 base64 转换可能较慢；解析出初始 URL/base64 后先通知 UI 显示预览，再返回完整结果供会话持久化。 |
| 2026-08-06 | `callEmbedding` 接收并合并解析后的 `params` | 嵌入请求此前引用未声明变量，且主编排层未传参数；签名显式接收 `params`，使行为与其他非流式请求一致。 |
| 2026-08-10 | 会话失效统一覆盖 chat 与非流式请求 | 删除或停止会话时通过 session-level AbortController 取消 embedding/image/video/TTS/ASR；迟到结果在卡片、assistant 持久化和 finally 刷新边界丢弃。 |
| 2026-08-12 | Provider 能力按协议分层 | API 层不把 Jimeng 当作聊天 provider；Jimeng 视频请求由 `buildVideoRequest` 单独构造，连接测试由端点资格层和 provider `test*Config` 能力共同决定。 |
| 2026-08-18 | `mergeParams` 统一处理显式参数与 Responses 特殊键 | 空字符串和 `null` 不进入请求；Responses 的 `max_tokens` 映射到 `max_output_tokens`，具体 `reasoning_effort` 合并到 `reasoning.effort`，并用 own-property 检查保护特殊键。按最终调用链记录 embedding、TTS、ASR 的参数覆盖边界；不将附件或失败事件未完成项写成已解决。 |
| 2026-08-20 | 按实际协议补齐附件转换、流式终态与 SSE 容错说明 | 内部 `file` 不再概括为图片：OpenAI Chat 区分文档和 MP3/WAV 音频，Claude 仅接受 PDF，Responses 使用 `input_file` 且拒绝音频；MIME 由可靠类型或扩展名归一。Provider 终态映射为失败时保留 partial 内容，SSE 仅跳过坏 JSON，Provider 异常继续传播。 |

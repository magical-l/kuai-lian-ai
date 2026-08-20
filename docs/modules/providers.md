---
title: Provider 抽象层 + DOM 工具集
covers_file: [src/modules/providers.js]
depends_on: []
api_signature: providers.openai, providers.jimeng, providers.claude, providers.gemini, providers.responses, $, $$, mk, fromTemplate, setValues, onClick, createTooltip, handleCopyValueClick
last_updated: 2026-08-20
why_exists: 五种 Provider 格式差异的封装（Jimeng 专用于视频生成）和公共 DOM 辅助函数的复用
---

# Provider 抽象层 + DOM 工具集（src/modules/providers.js）

## 设计意图

`providers` 对象将 API 格式差异封装在五个 provider 内部：`openai`、`jimeng`、`claude`、`gemini`、`responses`。其中 Jimeng 目前只提供视频生成请求构造，聊天/连接测试等通用方法不在该 provider 中；API 层（`callProvider`/`callAllModels`）无需感知具体格式。通用聊天 provider 通常实现以下核心方法：

- **`buildRequest`** — 将通用参数（baseUrl, apiKey, model, messages）转换为该 API 的 fetch 请求结构 `{url, headers, body}`
- **`parseChunk`** — 将 SSE 流中的单行 JSON 解析为统一结构 `{content?, reasoning?, event?, terminal?}`；`terminal.outcome` 可为 `completed`、`failed`、`incomplete` 或 `refused`，未知 reason 或没有 terminal 时保持兼容
- **`testConfig`** — 构建轻量测试请求；实际请求会先合并节点 customParams 与 workspace 参数，再对 chat 施加 3 token 上限，非 chat 不注入该上限

嵌入能力通过可选方法 `testEmbeddingConfig` / `buildEmbeddingRequest` / `parseEmbeddingResponse` 扩展，provider 可以不实现（嵌入功能对其不可用）。

DOM 工具集（文件后半部分）提供类 jQuery 简写、模板克隆、批量绑定、tooltip 组件等，保持 UI 代码简洁。

## TTS 支持

仅 openai provider 实现了 `buildTTSRequest` / `testTTSConfig` 方法，用于语音合成（`/v1/audio/speech`）。与 `buildRequest` 的区别：

- URL 路径：`{baseUrl}/v1/audio/speech`
- Body：`{ model, input, response_format: 'mp3' }`，可选补 `voice` / `instruction`
- 非流式调用，由 `callTTS`（shared.js）处理
- 响应为二进制 audio/mpeg，而非 JSON

claude 和 gemini provider 不实现此方法。

## 视频生成支持

### OpenAI 兼容视频

`openai.buildVideoRequest()` 请求 `{baseUrl}/v1/videos`，body 为 `{ model, prompt, n: 1 }`，并可合并 `duration`、`ratio`、`resolution` 参数。

### Gemini 视频

`gemini.buildVideoRequest()` 使用 `{baseUrl}/v1beta/models/{model}:generateContent`，以 `generationConfig.response_modalities: ['VIDEO']` 请求视频响应；当前通用 `callVideoGeneration()` 的响应解析仍按 OpenAI `data[0]` 形态读取，Gemini 视频响应的 `candidates[].content.parts[]` 尚未在 API 层完整接通。

### Jimeng / Seedance

`jimeng` provider 只实现 `buildVideoRequest()`，请求 `{baseUrl}/v1/videos/generations`，body 结构与 OpenAI 兼容视频相同，并支持相同的三个视频参数。它没有 `buildRequest` 或 `testConfig`，因此视频发送可用，但当前连接测试资格层不会把 `video-generation` 纳入可测试集合，也不会把 Jimeng 当成聊天接口测试。

## 生图支持

### OpenAI

URL 路径 `{baseUrl}/v1/images/generations`，Body：`{ model, prompt, n: 1 }`（从 messages 中提取最后一条 user 文本作为 prompt），响应含 `data[0].url` 或 `data[0].b64_json`。

### Gemini

使用与聊天相同的 `:generateContent` 端点，Body 中 `generationConfig` 加 `response_modalities: ["IMAGE"]`，响应中图片以 `candidates[0].content.parts[].inlineData`（base64）返回。

Gemini 额外实现了 `parseImageResponse(data)` 方法，供 `callImageGeneration` 解析其独特的响应格式。

claude provider 不实现此方法，`callImageGeneration` 通过 `if (!provider.buildImageRequest) throw` 做前置检查。

## Responses 支持（OpenAI 新一代接口）

`responses` provider 面向 OpenAI 的 `/v1/responses` 端点，只实现聊天能力（`buildRequest` / `parseChunk` / `testConfig` / `transformMessages`），不实现生图/视频/嵌入/TTS。当前 `responses` 不是参数注册表的独立全量集合，而是 `chat.common + chat.responses`。

与 OpenAI 聊天格式的关键差异在于消息体和附件部件：

- 端点：`{baseUrl}/v1/responses`，认证同 openai（`Authorization: Bearer {key}`）
- Body：`{ model, input, stream: true }`，system 角色消息提取到顶层 `instructions` 字段；API 层随后把 `chat.common` 参数注入同一 body
- **消息变换 `transformMessages`**：内部消息是统一内部格式（文本 `text`/`file_text`，二进制 `image`/`file`），Responses API 要求 content 部件用 `input_text` / `input_image` / `input_file` 类型，且每条 input item 带 `type: 'message'`：
  - user / 非 assistant → 文本为 `{type:'input_text', text}`，图片为 `{type:'input_image', image_url}`，文档为 `{type:'input_file', filename, file_data}`
  - assistant → 使用简单 `{type:'message', role:'assistant', content: string}` 契约，历史正文不转换为 `output_text` 部件
  - system → 不进 input，拼接进 `instructions`
  - 音频明确失败，避免将 MP3/WAV 伪装为可读文件
- `needsTagParsing: false`：reasoning 通过 SSE 事件流式返回，无需 text 标签扫描

Responses 的参数由 API 层 `mergeParams(body, params, 'responses')` 处理：`max_tokens` 映射到 `max_output_tokens`，具体 `reasoning_effort` 合并到 `body.reasoning.effort`；`null` 和空字符串不创建空 reasoning，已有普通 reasoning 对象的自有字段保留。参数合并使用 own-property 判断特殊键，避免 `__proto__`/`constructor` 等键被误当作继承属性。

`parseChunk` 处理的 SSE 事件：

- `response.output_text.delta` → `{content: delta}`
- `response.reasoning_summary_text.delta` / `response.reasoning_text.delta` → `{reasoning: delta}`
- `response.completed` / `response.failed` / `response.incomplete` / `response.refusal.*` → 对应 `terminal`；终态包含正文增量时由 API 层保留 partial 内容，`failed` 优先

`testConfig` 构造非流式最小请求，body 初始为 `{model, input:[{type:'message', role:'user', content:[{type:'input_text', text:'hi'}]}]}`；连接测试流程合并 customParams 与 workspace 参数后，再把 chat 的 `max_output_tokens` 固定为 `3`。

注意：Responses API 无历史 `system` 消息字段，多轮对话里旧 assistant 回复使用简单 `content: string` 契约，不包装为 `output_text` 部件；当前实现明确拒绝音频附件。

## 聊天/生图 Provider 对比

以下对比覆盖实现聊天或生图通用方法的 OpenAI、Claude、Gemini、Responses；Jimeng 只提供视频生成构造器，单独见“视频生成支持”。

### buildRequest

| 维度 | openai | claude | gemini | responses |
|---|---|---|---|---|
| URL 路径 | `{baseUrl}/v1/chat/completions` | `{baseUrl}/v1/messages` | `{baseUrl}/v1beta/models/{model}:streamGenerateContent?alt=sse` | `{baseUrl}/v1/responses` |
| 认证方式 | `Authorization: Bearer {key}` | `x-api-key: {key}` + `Authorization: Bearer {key}` | `X-Goog-Api-Key` header | `Authorization: Bearer {key}` |
| 额外头 | 无 | `anthropic-version: 2023-06-01`<br>`anthropic-dangerous-direct-browser-access: true` | 无 | 无 |
| 消息体 | `{model, messages, stream:true}` | `{model, max_tokens:4096, messages: transformMessages(msg), stream:true}` | `{contents: transformMessages(msg)}` | `{model, input: transformMessages(msg).input, stream:true}`<br>system → 顶层 `instructions` |
| 消息变换 | `toOpenAIContent` 转换附件 | `toClaudeContent` 转换 content 数组 | `toGeminiContent` 转换 + 相邻同角色合并 | `input_text`/`input_image`/`input_file`；assistant 历史为简单 message string |
| stream 标记 | `stream: true` | `stream: true` | URL 参数 `alt=sse`（非 body 字段） | `stream: true` |

Claude 的 `transformMessages` 将内部消息格式转为 claude 期望的角色 + content 格式，content 数组通过 `toClaudeContent`（见 api.md）转换。

Gemini 的 `transformMessages` 额外做了**相邻同角色合并**：如果连续两条消息 role 相同，合并它们的 parts 数组——因为 Gemini API 不允许相邻的同角色消息。

### parseChunk

| 维度 | openai | claude | gemini | responses |
|---|---|---|---|---|
| 输入 JSON | `choices[0].delta` | `type: 'content_block_delta'` 等事件 | `candidates[0].content.parts[0].text` | `response.output_text.delta` 等事件 |
| content 来源 | `delta.content` | `delta.type==='text_delta' -> delta.text` | `parts[0].text` | `json.delta` |
| reasoning 来源 | `delta.reasoning_content` | `delta.type==='thinking_delta' -> delta.thinking` | 不支持 | `response.reasoning_summary_text.delta` / `response.reasoning_text.delta` 的 `delta` |
| 事件标记 | finish/refusal → `terminal` | `content_block_start` → `thinking_start`/`content_start`；`message_delta.stop_reason` / error → `terminal` | finishReason / blockReason → `terminal` | response terminal/refusal/error → `terminal` |
| 空 chunk | `json.choices[0].delta` 为空时返回 null | 不匹配的事件返回 null | `candidates[0].content` 不存在时返回 null | 不匹配的事件返回 null |

OpenAI、Claude、Gemini、Responses 四个聊天 provider 的 `parseChunk` 输出格式统一为 `{content: string|null, reasoning: string|null, event: string|null, terminal?: {outcome, reason?, message?}}`，使 `handleParsedChunk` 可以统一处理；`failed` 终态优先于其他终态；无 terminal 或未知 reason 不破坏旧响应兼容。Jimeng 不提供聊天流解析。

### testConfig

| 维度 | openai | claude | gemini | responses |
|---|---|---|---|---|
| URL | `{baseUrl}/v1/chat/completions` | `{baseUrl}/v1/messages` | `{baseUrl}/v1beta/models/{model}:generateContent` | `{baseUrl}/v1/responses` |
| body（Provider 初始） | `{model, messages:[{role:'user', content:'hi'}], max_tokens:3}` | `{model, messages:[{role:'user', content:'hi'}], max_tokens:3}` | `{contents:[{role:'user', parts:[{text:'hi'}]}]}` | `{model, input:[{type:'message', role:'user', content:[{type:'input_text', text:'hi'}]}]}` |
| chat 上限 | `max_tokens:3`；若已有 `max_completion_tokens` 则使用该键并删除 `max_tokens` | `max_tokens:3` | `generationConfig.maxOutputTokens:3` | `max_output_tokens:3` |
| 非 chat | 不注入测试长度上限 | 不注入测试长度上限 | 不注入测试长度上限 | 不注入测试长度上限 |
| stream | 否（不设 stream） | 否（不设 stream） | 否（用 `generateContent` 而非 `streamGenerateContent`） | 否（不设 stream） |

连接测试先合并节点 `customParams` 与 workspace 参数，再施加 chat 上限，因此用户参数不会覆盖测试限制；embedding、TTS、ASR 等非 chat 测试不注入聊天长度字段。

### 嵌入方法

| 方法 | openai | claude | gemini |
|---|---|---|---|
| `testEmbeddingConfig` | `{url}/v1/embeddings`, body: `{model, input:'hi', encoding_format:'float'}` | 未实现 | 未实现 |
| `buildEmbeddingRequest` | `{url}/v1/embeddings`, body: `{model, input, encoding_format:'float'}` | 未实现 | 未实现 |
| `parseEmbeddingResponse` | 从 `json.data[0].embedding` 提取，返回 `{embedding, model, usage}` | 未实现 | 未实现 |

嵌入当前仅 openai 格式支持。claude 和 gemini provider 不存在这三个方法，`callEmbedding` 通过 `if (!provider.buildEmbeddingRequest) throw` 做前置检查。

### needsTagParsing

| provider | 值 | 理由 |
|---|---|---|
| openai | 默认 true | `delta.reasoning_content` 仅标记 thinking 阶段，不包含标签文本；部分第三方 API 会在 content 中嵌入 <thinking> |
| claude | `false` | claude 使用结构化事件 `thinking_delta`，`handleParsedChunk` 通过 `reasoning` 字段直接处理，无需标签扫描 |
| gemini | 默认 true | gemini 不支持 reasoning 事件，content 流中不会出现 thinking 标签，但 tag parser 对纯 content 无害 |
| responses | `false` | reasoning 通过 `response.reasoning_summary_text.delta` / `response.reasoning_text.delta` 事件流式返回，无需标签扫描 |

## 函数索引

### Provider 方法

| 方法 | provider | 签名 |
|---|---|---|
| `buildRequest` | openai | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `buildVideoRequest` | openai | `(baseUrl, apiKey, model, messages, params?) => {url, headers, body}` |
| `buildVideoRequest` | jimeng | `(baseUrl, apiKey, model, messages, params?) => {url, headers, body}` |
| `buildVideoRequest` | gemini | `(baseUrl, apiKey, model, messages, params?) => {url, headers, body}` |
| `buildImageRequest` | openai | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `buildTTSRequest` | openai | `(baseUrl, apiKey, model, input, voice?, instruction?) => {url, headers, body}` |
| `parseChunk` | openai | `(json) => {content?, reasoning?, terminal?} | null` |
| `testConfig` | openai | `(baseUrl, apiKey, model) => {url, headers, body}` |
| `testTTSConfig` | openai | `(baseUrl, apiKey, model) => {url, headers, body}` |
| `testASRConfig` | openai | `(baseUrl, apiKey, model) => {url, headers, body}` |
| `buildRequest` | claude | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `transformMessages` | claude | `(messages) => Array` |
| `parseChunk` | claude | `(json) => {content?, reasoning?, event?, terminal?} | null` |
| `testConfig` | claude | `(baseUrl, apiKey, model) => {url, headers, body}` |
| `buildRequest` | gemini | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `transformMessages` | gemini | `(messages) => Array` |
| `parseChunk` | gemini | `(json) => {content?, terminal?} | null` |
| `testConfig` | gemini | `(baseUrl, apiKey, model) => {url, headers, body}` |
| `buildImageRequest` | gemini | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `parseImageResponse` | gemini | `(data) => {imageData, revised_prompt} | null` |
| `buildRequest` | responses | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `transformMessages` | responses | `(messages) => {input, instructions}` |
| `parseChunk` | responses | `(json) => {content?, reasoning?, terminal?} | null` |
| `testConfig` | responses | `(baseUrl, apiKey, model) => {url, headers, body}` |

### 嵌入方法

| 方法 | provider | 签名 |
|---|---|---|
| `testEmbeddingConfig` | openai | `(baseUrl, apiKey, model) => {url, headers, body}` |
| `buildEmbeddingRequest` | openai | `(baseUrl, apiKey, model, input) => {url, headers, body}` |
| `parseEmbeddingResponse` | openai | `(json) => {embedding, model?, usage?}` |

### DOM 工具函数

| 函数 | 签名 | 说明 |
|---|---|---|
| `$` | `(selector, ctx?) => Element|null` | `querySelector` 简写，默认 ctx=document |
| `$$` | `(selector, ctx?) => NodeList` | `querySelectorAll` 简写 |
| `mk` | `(tag, className?) => Element` | `document.createElement` + 可选 className |
| `fromTemplate` | `(templateId, selector) => Element` | 从 `<template id>` 克隆并 querySelector |
| `setValues` | `(ctx, vals)` | 批量设置表单值：`{'.input': 'value'}` |
| `onClick` | `(handlers, ctx?)` | 批量绑定 click：`{'.btn': fn}` |
| `handleCopyValueClick` | `(btn)` | tooltip 复制按钮点击，读取 `dataset.copy` 写入剪贴板并显示 copied 状态 |
| `show` | `(el)` | `el.style.display = ''` |
| `hide` | `(el)` | `el.style.display = 'none'` |
| `toggle` | `(el, visible)` | `el.style.display = visible ? '' : 'none'` |
| `confirmAction` | `(msg, action)` | `if(confirm(msg)) action()` |
| `text` | `(el, txt) => el` | `el.textContent = txt`（返回 el 支持链式） |
| `createTooltip` | `(id, triggerEl, populate) => {show, hide, remove}` | 通用 tooltip 组件；由调用方传入触发元素与内容填充函数 |

### HTMLElement.prototype 扩展

| 方法 | 说明 |
|---|---|
| `H.addChild` | `this.appendChild(child)` |
| `H.on` / `D.on` | `this.addEventListener(event, handler)` + `return this`（支持链式） |

## DOM 工具设计说明

### 设计原则

- **全称而非缩写，除非是社区标准**：`mk`（对标 jQuery 的 `$('<div>')`）、`$`/`$$`（社区标准）、其余用全称 `show`/`hide`/`toggle`
- **返回元素以支持链式**：`text(el, 'hello')` 返回 el，`mk('div', 'cls')` 返回 el
- **原型扩展只做最小必要**：`addChild` 和 `on` 挂到 `HTMLElement.prototype` 和 `Document.prototype`，避免污染全局

### createTooltip 组件

tooltip 是独立的可复用组件，非单例但通常每页只用一个实例：

1. `show(triggerEl)` — 创建或显示 tooltip，定位在 triggerEl 下方（空间不够则上方），自动计算视口边界
2. `hide()` — 100ms 延迟隐藏（给鼠标移动到 tooltip 内的时间）
3. `remove()` — 从 DOM 移除

tooltip 内含 copy 按钮（`button.copy`），复制按钮由 `createTooltip()` 创建后通过 `addEventListener` 绑定 `handleCopyValueClick`，不依赖模板内联事件属性。

挂载位置优先选择最近的 `.one.endpoint` 祖先，因为 `<span>` 标签内不允许嵌套 `<div>`（tooltip 是 div），fallback 到 `document.body`。

## 决策日志

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-04-23 | Provider 用对象字面量而非 class | Provider 数量固定且无运行时扩展需求，对象字面量更简单 |
| 2026-04-23 | Claude 同时发 `x-api-key` 和 `Authorization` | 兼容不同代理实现，部分代理只认其中一个 |
| 2026-04-23 | Gemini 的 apiKey 放在 URL query param | Gemini API 规范要求 key 在 URL 而非 header |
| 2026-04-23 | Gemini 合并相邻同角色消息 | Gemini API 不允许相邻同 role 消息，UI 层不保证消息交替 |
| 2026-04-23 | 嵌入仅 openai 实现 | 当前需求只覆盖 OpenAI 兼容的嵌入服务，claude 和 gemini 的嵌入 API 未用到 |
| 2026-04-23 | claude 设置 `needsTagParsing: false` | claude 使用结构化 thinking 事件，无需 text-level 标签扫描，节省 buffer 开销 |
| 2026-04-23 | H.addChild / H.on 挂在 prototype 上 | 避免在每个组件中重复 `el.appendChild(child)`，`return this` 支持链式 |
| 2026-04-23 | tooltip 挂到 `.one.endpoint` 而非 body | 避免 `<span>` 嵌套 `<div>` 的 HTML 规范违规，同时减少 DOM 层级 |
| 2026-07-04 | openai 新增 buildImageRequest 方法 | 支持生图端点，URL 使用 `/v1/images/generations`，body 从 messages 提取 prompt，非流式 |
| 2026-07-08 | createTooltip show 先测量再定位 | tooltip 初始 `display: none` 导致 `offsetWidth` 为 0，改用 `visibility: hidden` 临时显示测量实际尺寸后再计算位置 |
| 2026-07-08 | 所有 provider 函数开头 strip baseUrl 尾部斜杠 | 防止 baseUrl 以 `/` 结尾时拼接出 `//` 双斜杠 URL |
| 2026-07-08 | createTooltip 从 `createElement` + `innerHTML` 改为克隆 `tooltip-content` 模板 + `appendChild` | tooltip 容器和行结构直接定义在 HTML 模板中，JS 不构造 HTML |
| 2026-07-12 | tooltip 复制按钮事件从 JS 绑定移到 HTML onclick 属性 | 模板 `#tooltip-content` 中 button 的 onclick 设为 `handleCopyValueClick(this)`，移除 createTooltip 中的 click 绑定；`handleCopyValueClick` 提取为全局函数 |
| 2026-07-20 | Gemini apiKey 从 URL query param 改为 `X-Goog-Api-Key` header | URL 中的 API key 可能被日志/历史记录泄露，header 更安全 |
| 2026-07-20 | Gemini 新增 `buildImageRequest` / `parseImageResponse` | 支持 Gemini 生图模型（如 gemini-3.1-flash-lite-image），使用同 `generateContent` 端点 + `response_modalities: ["IMAGE"]` |
| 2026-07-24 | 新增 `jimeng` provider + `buildVideoRequest` | 即梦/Seedance 视频生成用 `/v1/videos/generations`；openai 视频用 `/v1/videos`；gemini 用 `:generateContent` + `VIDEO` |
| 2026-08-12 | 明确 Jimeng 的 provider 边界 | `jimeng` 只实现视频生成构造器，不实现聊天或连接测试方法；视频发送可用，但连接测试不会把 `video-generation` 当作 chat 测试 |
| 2026-08-14 | 新增 `responses` provider | 支持 OpenAI 新一代 `/v1/responses` 接口；`transformMessages` 将内部消息转为 `input_text`/`input_image`，system 提取到 `instructions`；`parseChunk` 解析 `output_text.delta` 与 `reasoning_summary_text.delta`/`reasoning_text.delta`；只实现聊天能力 |
| 2026-08-18 | 按最终代码补齐 Responses 参数映射与 DOM tooltip 契约 | Responses 请求复用 `chat.common`，`max_tokens` 映射到 `max_output_tokens`，`reasoning_effort` 合并到 `reasoning.effort`；`createTooltip(id, triggerEl, populate)` 通过事件监听器绑定复制行为。明确 TTS `speed`、ASR `response_format` 等注册项不代表所有 provider 方法都已完整透传，并记录 Gemini 视频响应尚未接入通用解析。 |
| 2026-08-20 | 按实际 Provider 行为修正附件、终态和连接测试契约 | OpenAI Chat 文档与 MP3/WAV 音频分别使用 `file` 与 `input_audio`，Claude 仅接受 PDF，Responses 使用 `input_file` 并以简单 message string 保存 assistant 历史；Gemini 保留归一 MIME。四种聊天 Provider 都能返回终态，连接测试合并覆盖参数后再固定 chat 输出上限，非 chat 不注入。 |

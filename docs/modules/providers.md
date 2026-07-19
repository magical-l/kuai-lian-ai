---
title: Provider 抽象层 + DOM 工具集
covers_file: [src/modules/providers.js]
depends_on: []
api_signature: providers.openai, providers.claude, providers.gemini, $, 43852, mk, fromTemplate, setValues, onClick, createTooltip, handleCopyValueClick
last_updated: 2026-07-12
why_exists: 三种 Provider 格式差异的封装和公共 DOM 辅助函数的复用
---

# Provider 抽象层 + DOM 工具集（src/modules/providers.js）

## 设计意图

`providers` 对象将 API 格式差异封装在三个 provider 内部，使 API 层（`callProvider`/`callAllModels`）无需感知具体格式。每个 provider 实现三个核心方法：

- **`buildRequest`** — 将通用参数（baseUrl, apiKey, model, messages）转换为该 API 的 fetch 请求结构 `{url, headers, body}`
- **`parseChunk`** — 将 SSE 流中的单行 JSON 解析为统一结构 `{content?, reasoning?, event?}`
- **`testConfig`** — 构建轻量测试请求，不流式、max_tokens=3，用于"测试连接"功能

嵌入能力通过可选方法 `testEmbeddingConfig` / `buildEmbeddingRequest` / `parseEmbeddingResponse` 扩展，provider 可以不实现（嵌入功能对其不可用）。

DOM 工具集（文件后半部分）提供类 jQuery 简写、模板克隆、批量绑定、tooltip 组件等，保持 UI 代码简洁。

## TTS 支持

仅 openai provider 实现了 `buildTTSRequest` / `testTTSConfig` 方法，用于语音合成（`/v1/audio/speech`）。与 `buildRequest` 的区别：

- URL 路径：`{baseUrl}/v1/audio/speech`
- Body：`{ model, input, response_format: 'mp3' }`，可选补 `voice` / `instruction`
- 非流式调用，由 `callTTS`（shared.js）处理
- 响应为二进制 audio/mpeg，而非 JSON

claude 和 gemini provider 不实现此方法。

## TTS 支持

仅 openai provider 实现了 `buildTTSRequest` / `testTTSConfig` 方法，用于语音合成（`/v1/audio/speech`）。与 `buildRequest` 的区别：

- URL 路径：`{baseUrl}/v1/audio/speech`
- Body：`{ model, input, response_format: "mp3" }`，可选补 `voice` / `instruction`
- 非流式调用，由 `callTTS`（shared.js）处理
- 响应为二进制 audio/mpeg，而非 JSON

claude 和 gemini provider 不实现此方法。

## 生图支持

仅 openai provider 实现了 `buildImageRequest` 方法，用于图片生成（`/v1/images/generations`）。与 `buildRequest` 的区别：

- URL 路径：`{baseUrl}/v1/images/generations`
- Body：`{ model, prompt, n: 1 }`（从 messages 中提取最后一条 user 文本作为 prompt）
- 非流式调用，由 `callImageGeneration`（shared.js）处理

claude 和 gemini provider 不实现此方法，`callImageGeneration` 通过 `if (!provider.buildImageRequest) throw` 做前置检查。

## 三 Provider 对比

### buildRequest

| 维度 | openai | claude | gemini |
|---|---|---|---|
| URL 路径 | `{baseUrl}/v1/chat/completions` | `{baseUrl}/v1/messages` | `{baseUrl}/v1beta/models/{model}:streamGenerateContent?key={apiKey}&alt=sse` |
| 认证方式 | `Authorization: Bearer {key}` | `x-api-key: {key}` + `Authorization: Bearer {key}` | URL query param `?key=` |
| 额外头 | 无 | `anthropic-version: 2023-06-01`<br>`anthropic-dangerous-direct-browser-access: true` | 无 |
| 消息体 | `{model, messages, stream:true}` | `{model, max_tokens:4096, messages: transformMessages(msg), stream:true}` | `{contents: transformMessages(msg)}` |
| 消息变换 | 直接透传 | `toClaudeContent` 转换 content 数组 | `toGeminiContent` 转换 + 相邻同角色合并 |
| stream 标记 | `stream: true` | `stream: true` | URL 参数 `alt=sse`（非 body 字段） |

Claude 的 `transformMessages` 将内部消息格式转为 claude 期望的角色 + content 格式，content 数组通过 `toClaudeContent`（见 api.md）转换。

Gemini 的 `transformMessages` 额外做了**相邻同角色合并**：如果连续两条消息 role 相同，合并它们的 parts 数组——因为 Gemini API 不允许相邻的同角色消息。

### parseChunk

| 维度 | openai | claude | gemini |
|---|---|---|---|
| 输入 JSON | `choices[0].delta` | `type: 'content_block_delta'` 等事件 | `candidates[0].content.parts[0].text` |
| content 来源 | `delta.content` | `delta.type==='text_delta' -> delta.text` | `parts[0].text` |
| reasoning 来源 | `delta.reasoning_content` | `delta.type==='thinking_delta' -> delta.thinking` | 不支持 |
| 事件标记 | 无 | `content_block_start(type:'thinking')` → `{event:'thinking_start'}`<br>`content_block_start(type:'text')` → `{event:'content_start'}` | 无 |
| 空 chunk | `json.choices[0].delta` 为空时返回 null | 不匹配的事件返回 null | `candidates[0].content` 不存在时返回 null |

三个 provider 的 parseChunk 输出格式统一为 `{content: string|null, reasoning: string|null, event: string|null}`，使 `handleParsedChunk` 可以统一处理。

### testConfig

| 维度 | openai | claude | gemini |
|---|---|---|---|
| URL | `{baseUrl}/v1/chat/completions` | `{baseUrl}/v1/messages` | `{baseUrl}/v1beta/models/{model}:generateContent?key={apiKey}` |
| body | `{model, messages:[{role:'user', content:'hi'}], max_tokens:3}` | 同 buildRequest 但 `max_tokens:3` | `{contents:[{role:'user', parts:[{text:'hi'}]}]}` |
| stream | 否（不设 stream） | 否（不设 stream） | 否（用 `generateContent` 而非 `streamGenerateContent`） |

三个 testConfig 均设置 `max_tokens:3` 或等价最小输出，确保测试轻量快速。

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

## 函数索引

### Provider 方法

| 方法 | provider | 签名 |
|---|---|---|
| `buildRequest` | openai | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `buildImageRequest` | openai | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `buildTTSRequest` | openai | `(baseUrl, apiKey, model, input, voice?, instruction?) => {url, headers, body}` |
| `parseChunk` | openai | `(json) => {content?, reasoning?} | null` |
| `testConfig` | openai | `(baseUrl, apiKey, model) => {url, headers, body}` |
| `testTTSConfig` | openai | `(baseUrl, apiKey, model) => {url, headers, body}` |
| `buildRequest` | claude | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `transformMessages` | claude | `(messages) => Array` |
| `parseChunk` | claude | `(json) => {content?, reasoning?, event?} | null` |
| `testConfig` | claude | `(baseUrl, apiKey, model) => {url, headers, body}` |
| `buildRequest` | gemini | `(baseUrl, apiKey, model, messages) => {url, headers, body}` |
| `transformMessages` | gemini | `(messages) => Array` |
| `parseChunk` | gemini | `(json) => {content?} | null` |
| `testConfig` | gemini | `(baseUrl, apiKey, model) => {url, headers, body}` |

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
| `createTooltip` | `(id, html) => {show, hide, remove, el}` | 通用 tooltip 组件 |

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

tooltip 内含 copy 按钮（`button.copy`），复制按钮点击已移至模板 `#tooltip-content` 的 `onclick="handleCopyValueClick(this)"` 属性，JS 不再绑定 click 事件。

挂载位置优先选择最近的 `.one.endpoint` 祖先，因为 `<span>` 标签内不允许嵌套 `<div>`（tooltip 是 div），fallback 到 `document.body`。

## 决策日志

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-04-23 | Provider 用对象字面量而非 class | 三个 provider 固定，无运行时扩展需求，对象字面量更简单 |
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

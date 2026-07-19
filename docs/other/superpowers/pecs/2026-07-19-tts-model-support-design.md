---
title: TTS 语音合成模型支持
covers_file:
  - src/modules/store.js
  - src/modules/providers.js
  - src/modules/shared.js
  - src/modules/main.js
  - src/modules/messages.js
  - src/modules/endpoint-tree.js
  - src/modules/selected-endpoints.js
  - src/modules/attachments.js
  - src/layout.html
depends_on: [architecture.md, data-model.md, api.md]
api_signature: callTTS / buildTTSRequest / updateCardAsAudio / audioResult
last_updated: 2026-07-19
why_exists: 为快连AI新增语音合成（TTS）模型类型，支持纯文本转语音的独立使用模式
---

# TTS 语音合成模型支持

## 设计概要

新增 `tts` 模型类型（与 `chat` / `embedding` / `image-generation` / `reranking` 同级），遵循与 `image-generation` 相同的调用模式：非流式请求、二进制响应、结果以独立字段存入 assistant 消息、在消息卡片中渲染 `<audio>` 播放器。

首期只支持 OpenAI `/v1/audio/speech` 格式。不支持 voice/speed 等参数（使用 API 默认值）。

## 数据模型

### 模型类型

新增 `tts` 类型。`detectModelType` 新增关键词匹配（大小写不敏感）：
- `tts`（如 tts-1, tts-1-hd）
- `audio`（如 openai-audio）
- `speech`
- `voice`

类型别名归一：无额外别名需求。

### 消息中的音频数据

assistant 消息沿用 `imageResult` 模式，新增 `audioResult` 字段：

```js
{
  endpointId: "uuid",
  role: "assistant",
  status: "completed",
  content: '',                          // TTS 不需要文本回复
  audioResult: {
    audioData: "base64-encoded-mpeg",   // 持久化用
    blobUrl: "blob:..."                 // 当前会话 Object URL（刷新后由 audioData 重建）
  }
}
```

- `audioData`：API 返回的二进制 mp3 经 blobToBase64 转码后存储（类似 imageResult.imageData）
- `blobUrl`：`URL.createObjectURL(blob)` 创建，写入消息时供 `<audio>` 播放；会话重新加载后从 audioData 重建

## 实现计划

### 1. store.js — detectModelType 新增 tts 匹配

函数 `detectModelType` 在 `reranking` 分支后添加：

```js
if (lower.indexOf("tts") >= 0 || lower.indexOf("audio") >= 0 ||
    lower.indexOf("speech") >= 0 || lower.indexOf("voice") >= 0)
    return "tts";
```

### 2. providers.js — OpenAI provider 新增 TTS 方法

`providers.openai` 新增两个方法：

- **`buildTTSRequest(baseUrl, apiKey, model, input)`**：构造 POST 到 `/v1/audio/speech`，body `{ model, input }`，不传 voice/speed/response_format
- **`testTTSConfig(baseUrl, apiKey, model)`**：同 buildTTSRequest 但 input 为 `"."`（短探测）

### 3. shared.js — callTTS 函数 + base64ToBlob 工具

新增 `callTTS(style, baseUrl, apiKey, model, input)`：

1. 查 provider，确认 buildTTSRequest 存在
2. 调用 buildTTSRequest 构造请求
3. fetchWithTimeout 发送（120s 超时）
4. 检查非 200 → 抛出 `TTS请求失败: {status} - {body}`
5. 检查 text/html → 抛出 `TTS请求失败: 返回了HTML`
6. `res.blob()` 获取二进制 → `blobToBase64` 转 base64 → `URL.createObjectURL` 创建 blobUrl
7. 返回 `{ blobUrl, audioData, contentType, size }`

新增 `base64ToBlob(b64, mimeType)`：将 base64 字符串转为 Blob（消息渲染时由 audioData 重建 blobUrl）。

### 4. main.js — Send 分流 + updateCardAsAudio

**handleSend 函数**（约第 460 行）：
- 声明 `const ttsIds = []`
- `forEach` 分流中加 `else if (cfg.type === 'tts') ttsIds.push(id)`
- 新增 `ttsPromises` 数组，与 `imgGeneratePromises` 同理
- Promise.all 结果包含音频结果
- assistant 消息写入 `audioResult`

新增 `updateCardAsAudio(endpointId, result, sessionId)`：
- 定位 card
- 清空 `.say`
- 在 `.content` 中插入带 `<audio controls>` 的 div

### 5. messages.js — audioResult 渲染

在 `appendMessages` 的 response 渲染循环中，`imageResult` 分支后新增 `audioResult` 分支：

- 查找或创建 `.audio-result` div
- 如果已有 `<audio>` 则跳过重复渲染
- 从 `r.audioResult.audioData` 通过 `base64ToBlob` 创建临时 blobUrl
- 创建 `<audio controls>` 元素插入

### 6. endpoint-tree.js — 类型图标 + isNodeTestable

**类型→图标**映射（约第 207 行）：
```js
else if (type === 'tts') { typeEl.classList.add('speaker'); }
```

**图标→类型**逆向（约第 485 行）：
```js
else if (typeEl.classList.contains('speaker')) type = 'tts';
```

**isNodeTestable**（两处：第 237、385 行）：在 `cfg.type === "chat"` 条件后加 `|| cfg.type === "tts"`。

### 7. selected-endpoints.js — typeIconMap

```js
const typeIconMap = { ... , tts: 'speaker' };
```

### 8. attachments.js — 类型选择列表 + 测试路由

类型选择列表新增：
```js
{ value: 'tts', icon: 'speaker', text: '语音' },
```

测试连接路由（约第 816 行）新增 `tts` 分支：
```js
var testFn = (modelType === 'embedding' && provider.testEmbeddingConfig) ? provider.testEmbeddingConfig :
             (modelType === 'tts' && provider.testTTSConfig) ? provider.testTTSConfig :
             provider.testConfig;
```

### 9. layout.html — 筛选 checkbox + 编辑 radio

类型筛选区新增 `<input type="checkbox" value="tts" checked>`

编辑弹窗 type radio 组新增 `<input type="radio" name="type" value="tts">`

## CSS

### 端类型图标

需要改两个 CSS 文件：

**common.css** — 字符变量区和端类型类定义区各新增一项：

```css
/* 字符变量区（约第 380 行附近） */
--char-speaker: '🔊';  /* U+1F50A &#x1F50A; */

/* 端类型类定义区（约第 473 行附近） */
.speaker { --icon-char: var(--char-speaker); }
```

**项目内样式** — 原生 `<audio controls>` 播放器自带样式，与现有卡片布局兼容，无需额外 CSS。

## 边界情况

| 场景 | 行为 |
|------|------|
| TTS API 返回非音频（JSON 错误） | `callTTS` 在 `await res.blob()` 前先检查 `content-type`，非 audio/ 则 readAsText 抛错 |
| 长文本输入 | 交由 API 处理（无前端截断） |
| 旧会话不含 audioResult | appendMessages 查不到 audioResult 分支不渲染，无异常 |
| 音频 base64 较大 | 同 imageResult，不设体积限制。后续可引入压缩或分离存储 |
| TTS 端点 testConnection | provider.testTTSConfig 走短文本探测 |

## 不包含（后续考虑）

- voice/speed 等参数控制
- 非 OpenAI 格式的 TTS 支持（如火山引擎、Azure）
- 音频持久化分离存储
- 音频可视化（波形）
- 下载按钮（浏览器 `<audio>` 控件自带下载）

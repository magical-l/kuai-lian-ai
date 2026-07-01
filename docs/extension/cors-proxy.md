---
title: CORS Proxy Architecture
created: 2026-07-01
status: active
depends_on: background.js, cors-proxy.js
---

# CORS Proxy Architecture

## 设计意图

CORS 代理是快连AI 扩展版的核心差异。由于 AI API 端点（如 `api.openai.com`）不允许浏览器端跨域请求，扩展版通过 Service Worker 的扩展特权发起 `fetch()`（不受 CORS 限制），再将结果通过 `chrome.runtime` 通信传回页面进程。

架构分两层：

1. **Service Worker**（`src/extension/background.js`）— 在扩展进程执行 fetch，无 CORS 限制
2. **CORS 代理桥接**（`src/extension/cors-proxy.js`）— 注入页面进程，封装与 SW 的通信，暴露 `window.__EXTENSION_FETCH__`

cors-proxy.js 作为自执行 IIFE 注入页面上下文。构建时 `build.js` 的 `buildExtension` 函数将 `<script src="cors-proxy.js">` 写入扩展版 HTML，加载顺序在 `storage-core.js` 之后、`app.js` 之前，确保存储层和代理层先就绪。

## 端口通信协议

通信基于 `chrome.runtime.connect({ name: 'cors-proxy' })` 建立的命名端口，端口名 `cors-proxy` 是两端约定的标识符。

### 连接建立

```
页面进程 (cors-proxy.js)           Service Worker (background.js)
        │                                  │
        ├── chrome.runtime.connect() ──────┤
        │   { name: 'cors-proxy' }         │
        │                                  ├── port.onConnect 触发
        │                                  │   port.name === 'cors-proxy' 时接受
        │                                  │
        ├── port.postMessage() ────────────┤
        │   { type, id, url, options }     │
        │                                  │
```

`connectPort()` 使用懒连接模式（闭包变量 `port`），首次请求时创建，后续复用。端口断开时自动置 `null`，下次请求重新连接：

```js
let port = null;
function connectPort() {
    if (!port) {
        port = chrome.runtime.connect({ name: 'cors-proxy' });
        port.onDisconnect.addListener(() => { port = null; });
    }
}
```

### 消息类型

| 方向 | type | 方向 | payload |
|------|------|------|---------|
| page→SW | `fetch-stream` | 发起流式请求 | `{ id, url, options: { method, headers, body } }` |
| SW→page | `stream-start` | 响应头就绪 | `{ id, status, ok, headers }` |
| SW→page | `stream-chunk` | SSE 数据块 | `{ id, data: string }` |
| SW→page | `stream-end` | 流结束 | `{ id, done: true }` 或 `{ id, error: string }` |
| page→SW | `fetch-abort` | 取消流 | `{ id }` |
| page→SW | `fetch` (sendMessage) | 非流式请求 | `{ type: 'fetch', url, options }` |
| SW→page | sendResponse | 非流式响应 | `{ success, data:{status,ok,body,headers} }` 或 `{ success: false, error }` |

## fetchStream — 流式代理实现

`fetchStream()` 是核心函数，在页面进程创建一个 `ReadableStream`，通过端口接收 SW 返回的数据块。

### 数据流

```
页面进程                           Service Worker
  │                                    │
  │  port.postMessage({                │
  │    type: 'fetch-stream',           │
  │    id, url, options                │
  │  })                                │
  │                                    ├── fetch(url, fetchOptions)
  │                                    │   (扩展进程，无CORS限制)
  │                                    │
  │  port.onMessage ← ──────────────── ├── port.postMessage({ type: 'stream-start', id, status, ok, headers })
  │                                    │
  │  resolve({ ok, status, headers,    │
  │    body: readableStream })         │
  │                                    │
  │                       [开始流式读取]
  │                                    ├── reader.read() 循环
  │                                    │
  │  port.onMessage ← ──────────────── ├── stream-chunk { id, data }
  │  streamController.enqueue(data)    │
  │  (写入 readableStream)             │
  │                                    │
  │  port.onMessage ← ──────────────── ├── stream-end { id, done: true }
  │  streamController.close()          │
  │                                    │
```

### 关键实现细节

1. **ID 计数器**（`streamIdCounter`）：单调递增，每个流式请求分配唯一 ID，用于消息路由
2. **消息过滤器**：`handleMessage(msg)` 中 `if (msg.id !== id) return;` 确保同一端口上多个并发流不串扰
3. **ReadableStream 封装**：`new ReadableStream({ start(controller) { ... }, cancel() { port.postMessage(...) } })` — `cancel()` 回调在消费者调用 `reader.cancel()` 时自动发出 `fetch-abort`
4. **TextDecoder/TextEncoder 编解码**：SW 端 `TextDecoder.decode(value, { stream: true })` 将 Uint8Array 转为字符串；页面端 `TextEncoder.encode(msg.data)` 将字符串转为 Uint8Array 写入 stream
5. **text()/json() 兼容**：`text()` 和 `json()` 方法在 `stream-end` 时从缓存 `chunks` 数组拼接结果，确保未消费 stream 的调用方也能获取完整响应

### AbortController 集成

```js
// 页面端：支持外部 signal 和外置取消按钮
if (externalSignal) {
    externalSignal.addEventListener('abort', () => {
        port.postMessage({ type: 'fetch-abort', id });
    });
}
// readableStream.cancel() 自动触发

// SW 端：activeStreams Map 管理
activeStreams.set(id, controller);
// fetch-abort → controller.abort()
// port.onDisconnect → 清理所有活跃流
```

## fetchSimple — 非流式代理

对测试连接等无需流式响应的请求，使用 `chrome.runtime.sendMessage` 而非命名端口。差异：

| 特性 | fetchStream (端口) | fetchSimple (sendMessage) |
|------|-------------------|--------------------------|
| 响应体 | ReadableStream | 完整 text/JSON |
| 超时 | 无 SW 侧超时 | 30 秒默认超时 |
| 重连 | 自动重建端口 | 不适用 |
| 实现复杂度 | 高（stream + message routing） | 低（单次 request→response） |
| 适用场景 | 聊天 SSE | 测试连接、嵌入请求 |

### 超时机制

SW 侧使用 `setTimeout(() => controller.abort(), timeout)`（默认 30 秒），请求超时后返回 `{ success: false, error: '请求超时或已取消' }`。页面端检测到该错误时将错误对象的 `name` 改为 `'AbortError'`，与浏览器原生 `fetch` 的 `AbortError` 行为对齐。

## `window.__EXTENSION_FETCH__` 的注入和使用

cors-proxy.js 自执行 IIFE 的结尾将 `extensionFetch` 暴露为全局变量：

```js
window.__EXTENSION_FETCH__ = extensionFetch;
```

### 路由逻辑

```js
async function extensionFetch(url, options = {}) {
    if (options._noStream) {
        return await fetchSimple(url, options);
    }
    return await fetchStream(url, options);
}
```

- 默认走流式路径（兼容 SSE 聊天场景）
- `_noStream` 标记强制走非流式路径
- 当前模块代码未直接消费 `__EXTENSION_FETCH__`（模块中的 `fetchWithTimeout` 使用原生 `fetch()`），此钩子为增量接入预留

### 与模块代码的配合方式

虽然模块代码的 `fetchWithTimeout` 在扩展页面上下文可直接调用 `fetch()`（扩展页面的 `chrome-extension://` 域属特权上下文，不受 CORS 限制），但 `__EXTENSION_FETCH__` 的消费场景包括：

1. 需从页面进程发起但 SW 转发的可取消流式请求
2. 需要精细超时控制的非流式请求
3. 未来模块重构时统一 fetch 入口

## 错误处理机制

### 断连恢复

| 场景 | 行为 |
|------|------|
| SW 终止（空闲超时） | `port.onDisconnect` 触发 → `port = null` → 下次 `extensionFetch` 调用时 `connectPort()` 重新连接 |
| SW 重新激活 | 新 SW 实例注册新 `onConnect` 监听器，旧端口已断开 |
| 活跃流丢失 | SW 的 `port.onDisconnect` 遍历 `activeStreams` 逐一遍历 `controller.abort()` |
| `chrome.runtime.lastError` | `fetchSimple` 中检查 `chrome.runtime.lastError` → `reject(new Error(...))` |
| ReadableStream 被取消 | `cancel()` 回调 → 自动发送 `fetch-abort` → SW 侧 `controller.abort()` → `fetch()` 抛出 `AbortError` |

### 超时控制

- **流式请求**：无 SW 侧超时（SSE 连接可能持续数分钟）。页面侧可通过 AbortSignal 控制
- **非流式请求**：SW 侧 30 秒超时，页面侧可通 `options.timeout` 覆盖
- **端口消息超时**：由 Port.postMessage 内部机制处理，cors-proxy 不额外加超时

### 错误响应格式

```
流式:
  SW → { type: 'stream-end', id, error: 'AbortError' ? 'aborted' : err.message }
  页面 → streamController.error(new Error(msg))

非流式:
  SW → { success: false, error: '请求超时或已取消' | err.message }
  页面 → err.name = error === '请求超时或已取消' ? 'AbortError' : 'Error'
```

## 函数索引

| 函数 | 所在文件 | 行号 | 作用 |
|------|---------|------|------|
| `connectPort()` | cors-proxy.js | 11-15 | 懒建立命名端口连接 |
| `fetchSimple()` | cors-proxy.js | 19-51 | 非流式代理请求（sendMessage） |
| `fetchStream()` | cors-proxy.js | 54-139 | 流式代理请求（命名端口 + ReadableStream） |
| `extensionFetch()` | cors-proxy.js | 141-148 | 统一入口，路由到 fetchStream/fetchSimple |
| `chrome.runtime.onConnect` | background.js | 14-92 | 接收命名端口，处理流式/中止消息 |
| `chrome.runtime.onMessage` | background.js | 95-131 | 接收非流式请求，超时控制 |

## 设计决策日志

| 日期 | 决策 | 理由 |
|------|------|------|
| 2025-Q1 | 命名端口 + sendMessage 双路径 | 流式需持续双向通信，sendMessage 单次响应适合短请求 |
| 2025-Q1 | 端口名硬编码为 `'cors-proxy'` | 仅一个代理端口，无需动态路由 |
| 2025-Q1 | 页面端缓存 `chunks` 数组 | 实现 `text()`/`json()` 回溯兼容 |
| 2025-Q1 | SW 侧 TextDecoder 逐块解码 | 正确处理多字节字符在分块边界被截断的情况 |
| 2025-Q1 | 非流式超时默认 30 秒 | 与浏览器 fetch 默认行为对齐 |
| 2025-Q2 | `_noStream` 标记优先 | 兼容非 SSE 请求（如嵌入）走同一入口 |
| 2025-Q2 | 端口断开时清理 `activeStreams` | 避免 SW 终止后流泄露 |
| 2025-Q3 | `__EXTENSION_FETCH__` 当前未被模块消费 | 扩展页面的 `chrome-extension://` 域本身是特权上下文，原生 `fetch()` 可直接跨域。代理架构为更复杂的网络场景预留 |

---
title: Chrome Extension 概览
covers_file: [src/extension/manifest.json, src/extension/background.js, src/extension/storage-core.js, src/extension/_locales/zh_CN/messages.json, src/modules/boot.js]
depends_on: []
api_signature: chrome.runtime, chrome.action, chrome.runtime.connect
last_updated: 2026-08-28
why_exists: 双产物中 Chrome 扩展的生命周期、权限模型和 CORS 代理架构概览
---

# Chrome Extension Overview

## 设计意图

快连AI 的 Chrome 扩展基于 Manifest V3 构建，核心目标是将单页面应用封装为浏览器扩展，利用 Service Worker 的扩展特权绕过 AI 端点 API 的 CORS 限制。扩展与单页面版本共享同一套源码（`src/modules/`），仅在构建时替换 boot 加载层和存储层，实现"同一份源码，两个分发形态"。

扩展版相对于单页面版的关键差异：

1. **CORS 代理**：通过 Service Worker + 端口通信，使页面可以调用跨域 AI API
2. **存储扩展**：扩展版存储层使用 `chrome.storage.local` 替代纯浏览器的 IndexedDB，在本机 Chrome 配置文件中持久化数据；不使用跨设备同步
3. **独立分发**：打包为 `.zip`，可发布到 Chrome Web Store

## Manifest V3 配置详解

### `permissions` — 权限声明

```json
["storage"]
```

仅申请 `storage` 权限，用于存储端点和会话的配置数据。MV3 下 `storage` 权限的配额为 10 MB（单 key 5 MB），超出时使用 `chrome.storage.local` 的 `QUOTA_BYTES_PER_ITEM` 限制。

### `host_permissions` — 主机权限

```json
["https://*/*", "http://*/*"]
```

全通配配主机权限，作用是允许 Service Worker 的 `fetch()` 访问任意目标。这是 CORS 代理得以工作的基础——SW 运行在扩展进程，其 `fetch()` 不受跨域限制，而扩展页面的 `fetch()` 在页面进程仍需遵守 CORS（见 [cors-proxy.md](./cors-proxy.md) 的端口通信架构）。

### `content_security_policy` — CSP

```json
{
  "extension_pages": "script-src 'self'; style-src 'self' 'unsafe-inline' http://css.document.cool; font-src 'self'; img-src 'self' data: blob: https://github.com https://github.githubassets.com https://gitee.com"
}
```

- `script-src 'self'`：禁止内联脚本，所有 JS 以外部文件形式加载（`storage-core.js`/`cors-proxy.js`/`app.js`/`boot.js`/`vendor/*.js`）
- `style-src 'unsafe-inline'`：允许内联 `<style>`（构建时 style.css 被内联）和远程样式表
- `font-src 'self'`：字体仅从扩展包内加载（Google Fonts 被构建时内联或纯扩展版跳过）
- `img-src`：允许 data URI、blob、GitHub/Gitee 图标（用于 Markdown 渲染中的图片）

## Service Worker 生命周期

文件：`src/extension/background.js`

| 阶段 | 行为 |
|------|------|
| 安装 | 无持久状态安装，SW 注册后即就绪 |
| 激活 | 无额外激活逻辑 |
| `chrome.action.onClicked` | 用户点击工具栏图标 → `chrome.tabs.create({ url: chrome.runtime.getURL('kuai-lian-ai.html') })` |
| 空闲后终止 | MV3 SW 约 30 秒无事件触发后终止。`chrome.runtime.onConnect` 和 `chrome.runtime.onMessage` 监听器在 SW 唤醒时重新注册 |
| 重新启动 | 所有活跃端口自动断开（`port.onDisconnect` 触发 → 清理 `activeStreams` Map），连接状态由 `cors-proxy.js` 的懒重连处理 |

注意：SW 未使用 `chrome.runtime.onInstalled` 或 `chrome.runtime.onStartup`，因此首次安装后需用户点击图标触发页面创建。

## CORS 代理通信架构

```
扩展页面 (chrome-extension://)
    │
    ├── cors-proxy.js (injected into page)
    │      └── chrome.runtime.connect({ name: 'cors-proxy' })
    │             │
    │             ▼
    ├── background.js (Service Worker)
    │      ├── chrome.runtime.onConnect → named port 'cors-proxy'
    │      │      ├── 流式请求: fetch-stream / stream-chunk / stream-end / fetch-abort
    │      │      └── ReadableStream piping via chrome.runtime.Port.postMessage
    │      │
    │      └── chrome.runtime.onMessage
    │             └── 非流式请求: type 'fetch' → sendResponse
    │
    ▼
AI API 端点 (跨域)
```

cors-proxy.js 使用 `chrome.runtime.connect({ name: 'cors-proxy' })` 建立命名端口，而非 `chrome.runtime.sendMessage`（仅用于非流式请求）。两种路径的对比：

| 特性 | Named Port (流式) | sendMessage (非流式) |
|------|------------------|----------------------|
| 双向消息流 | 支持（分块回传） | 单次 request→response |
| 流式 SSE | 是 | 否 |
| 自动重连 | 手动实现 | 不适用 |
| `chrome.runtime.lastError` | 端口关闭时触发 | 支持 |
| 超时控制 | background 侧无内置超时 | 30 秒默认超时 |

## 环境检测机制

`src/modules/boot.js` 在页面加载时立即执行：

1. **检测扩展环境**：检查 `chrome.runtime?.id` 是否存在。若存在，设置 `window.__IS_EXTENSION__ = true`。
2. **字体处理**：扩展环境下移除已有的 Google Fonts 节点；非扩展环境动态注入字体样式。
3. **CORS 代理钩子随后注册**：页面底部加载 `cors-proxy.js` 时，将 `window.__EXTENSION_FETCH__` 设为 `extensionFetch()`，供需要 Service Worker 中转的路径使用。

这两个标志影响其他模块的行为：
- **存储层**：扩展模式下 `storage-core.js` 使用 `chrome.storage.local` 替代 IndexedDB
- **API 层**：模块代码当前使用原生 `fetch()` 通过扩展页面特权上下文直接跨域访问；`__EXTENSION_FETCH__` 是预留钩子，用于需要 Service Worker 中介的特定场景

## 与单页面版本的配合方式

| 维度 | 单页面 HTML | Chrome 扩展 |
|------|------------|-------------|
| 源码 | `src/modules/*`（共享） | `src/modules/*`（共享） |
| 存储层 | `src/modules/storage-core.js`（IndexedDB） | `src/extension/storage-core.js`（chrome.storage） |
| 加载方式 | 全部内联到 HTML | 外部 `script src` |
| fetch 路径 | 原生 `fetch()`（受 CORS 限制） | 当前模块代码使用扩展页特权上下文中的原生 `fetch()`；`__EXTENSION_FETCH__` 保留为按需走 Service Worker 代理的钩子 |
| 字体加载 | Google Fonts 内联 | 跳过（扩展包内无 Google Fonts） |
| 分发形态 | 单文件 `.html` | `.zip` 扩展包 |
| 更新 | 替换 HTML | 通过 Chrome Web Store |

## 构建物差异

扩展版构建（`build.js` 的 `buildExtension` 函数）对 `layout.html` 做以下替换：

| 占位符 | 单页面处理 | 扩展版处理 |
|--------|-----------|-----------|
| `{CSS}` | 内联 `style.css` | 同（内联） |
| `modules/boot.js` | 内联 | 改为 `<script src="boot.js">`（外部文件） |
| `<!-- app-modules -->` | 逐个内联所有模块 `.js` | 替换为 3 个 `<script src>`：`storage-core.js`、`cors-proxy.js`、`app.js` |
| `vendor/` JS | 内联 | 保持 `<script src>` 引用 |
| 高亮 CSS | 内联 | 同（内联） |
| 远程 CSS | 构建时 fetch 内联 | 保留 `<link>` 外链，运行时从 `http://css.document.cool/css/*.css` 加载 |
| SVG logo | Base64 内联 | 保持文件引用 |

决定：扩展版不内联 vendor JS 的原因是 `script-src 'self'` 不允许内联脚本，所以 vendor JS 必须以外部文件形式存在于扩展包中。

## 关键函数索引

| 函数 / 文件 | 作用 |
|------------|------|
| `background.js` | |
| `chrome.action.onClicked` | 打开扩展主页面 |
| `chrome.runtime.onConnect` | 注册流式代理命名端口 |
| `chrome.runtime.onMessage` | 注册非流式代理 |
| `activeStreams` Map | 活跃流连接集合 |

| `cors-proxy.js` | | |
| `connectPort()` | 懒建立命名端口 | 11-15 |
| `fetchSimple()` | 非流式请求代理 | 19-51 |
| `fetchStream()` | 流式请求代理 + ReadableStream 封装 | 54-139 |
| `extensionFetch()` | 统一入口，路由到 fetchStream/fetchSimple | 141-148 |

| `storage-core.js` (扩展版) | | |
| `BrowserStorage._get/_set` | chrome.storage.local 封装 | 30-55 |
| storage.init() | 恢复模式偏好 | 415-447 |
| storage.switchMode() | 带数据迁移的模式切换 | 465-488 |

## 决策日志

| 日期 | 决策 | 理由 |
|------|------|------|
| 2025-Q1 | 采用 MV3 而非 MV2 | Chrome 逐步淘汰 MV2 |
| 2025-Q1 | 使用 chrome.runtime.connect 命名端口而非 sendMessage 流式 | 双向流支持 SSE 分块回传 |
| 2025-Q1 | 扩展版不内联 vendor JS | CSP `script-src 'self'` 禁止内联 |
| 2025-Q1 | host_permissions 用全通配符而非白名单 | AI 端点 URL 用户自定义，不可预知 |
| 2025-Q2 | 扩展版跳过 Google Fonts 加载 | 扩展包体积约束，且 Web Store 审核要求无外部字体引用 |
| 2025-Q3 | extensionFetch 当前未被模块代码消费 | cors-proxy.js 注册的 `window.__EXTENSION_FETCH__` 是预留钩子，模块代码当前使用原生 `fetch()` 通过扩展页面的特权上下文直接跨域访问。此钩子可用于需要 Service Worker 中介的特定场景 |
| 2026-07-18 | 远程 CSS 域名切换 | 从 `css.lwj621.workers.dev` 切换到 `css.document.cool`，manifest.json 和文档中 CSP 同步更新 |
| 2026-08-24 | 修正环境标志与代理钩子的注册归属 | boot.js 只负责 `__IS_EXTENSION__` 和字体处理；`cors-proxy.js` 随页面底部模块加载时注册 `__EXTENSION_FETCH__`。 |
| 2026-08-28 | 发布 v6.33.4 | 共享 UI 的输入区拖拽、持久化键与帮助弹窗关闭行为不改变扩展的 CORS、存储或权限边界。 |

# 快连AI 项目概要

浏览器端大模型端点管理+多模型对话工具，纯原生 JS 单页面应用及 Chrome 扩展。

## 项目结构

src/ 是唯一源码目录，build.js 将其构建为 dist/ 下的两个产物：

- **单页面 HTML**（dist/kuai-lian-ai.html + 根目录副本）
- **Chrome 扩展**（dist/extension/，含 zip 包）

```
src/
├── layout.html           # HTML 模板，含 {CSS} {BOOT} {APP} 三个占位符
├── style.css             # 样式（被 build 内联到 HTML）
├── boot.js               # 启动脚本：检测扩展/非扩展环境
├── modules/              # JS 模块，按严格顺序加载
│   ├── storage-core.js   # 存储抽象层（双后端：目录/浏览器）
│   ├── providers.js      # Provider 定义 + DOM 辅助工具
│   ├── ui-utils.js
│   ├── model-selector.js
│   ├── attachments.js
│   ├── store.js          # 数据/状态管理
│   ├── api.js            # API 请求 + SSE 流式处理
│   ├── shared.js
│   └── main.js           # 主入口逻辑
├── extension/            # Chrome 扩展专用源码
│   ├── manifest.json     # Manifest V3
│   ├── background.js     # Service Worker（CORS 代理）
│   ├── cors-proxy.js     # 注入页面的 CORS 代理桥接
│   ├── storage-core.js   # 扩展版存储（chrome.storage + IndexedDB + File System Access）
│   ├── icons/
│   └── _locales/zh_CN/messages.json
vendor/                   # 第三方库（构建时复制到扩展包）
├── marked.min.js
├── highlight.min.js
└── highlight-github.min.css
```

## 技术栈

- **零框架**：纯原生 JS，无 npm/package.json，无构建工具依赖
- **存储**：File System Access API（目录模式）/ IndexedDB（浏览器模式）/ chrome.storage（扩展模式）
- **第三方**：marked.js（Markdown 渲染）、highlight.js（代码高亮）
- **Chrome 扩展**：Manifest V3，Service Worker 做 CORS 代理
- **API 格式**：OpenAI / Claude / Gemini

## 关键约定

### 构建
- 单命令：`node build.js`，无 watch/dev 模式
- 模块加载顺序严格固定（MODULE_ORDER）：
  `storage-core → providers → ui-utils → model-selector → attachments → store → api → shared → main`
- 扩展版的 HTML 中额外插入了 `storage-core.js` 和 `cors-proxy.js` 的 `<script src=`
- 每次改动后必须更新版本号（manifest.json 的 version + layout.html 中的显示版本）

### 存储
- 全局变量 `window.__STORAGE__` 提供统一存储接口
- 通过 `getBackend()` 路由到 DirectoryStorage 或 BrowserStorage
- 模式偏好存于 `__mode` key 中

### 环境检测
- `window.__IS_EXTENSION__` 区分扩展环境/独立页面
- `window.__EXTENSION_FETCH__` 在扩展环境下替代原生 fetch 绕过 CORS
- `boot.js` 中还会根据环境动态注入/移除 Google Fonts

### DOM 辅助（见 providers.js）
- `$(sel, ctx)` / `$$(sel, ctx)` — 类 jQuery 查询
- `mk(tag, className)` — 创建元素
- `fromTemplate(id, sel)` — 从 `<template>` 克隆
- `setValues(ctx, vals)` / `onClick(handlers, ctx)` — 批量绑定
- `H.addChild()` / `H.on()` — 挂载到 HTMLElement.prototype

### CSS 变量体系（style.css :root）
- `--bg-*` / `--text-*` / `--border-*` / `--accent-*` 统一 Design Tokens
- 尺寸：`--radius-*` `--space-*` `--shadow-*`
- 字体：`--font-sans`（Plus Jakarta Sans + fallback）

### 数据结构
- 端点配置：`{ groups: [{ id, name, baseUrl, style, key, models: [{ id, name }] }] }`
- 会话：`{ id, title, createdAt, messages: [{ role, content, timestamp, targetModels?, responses?, modelId? }] }`
- 目录存储：`endpoints.json` + `sessions/<uuid>.json`
- 浏览器存储：IndexedDB 的 `endpoints` / `sessions` key

### 不可修改
- `vendor/` 目录 — 第三方代码，由包管理器管理

## 文档层（自愈文档）

`docs/` 目录包含从源代码反向推导的自愈文档层。改代码前后的读/写规则：

### 改代码前
- 在 `docs/index.md` 找到受影响模块对应的文档
- 读对应文档的「设计意图」和「函数索引」，理解模块边界和设计约束

### 改代码后（文档同步）
每次改完代码后，必须更新本次改动涉及的所有文档：
1. 定位：通过 `covers_file` 元数据找到被改文件对应的文档
2. 更新函数功能描述：如果改动改变了函数的行为或签名
3. 追加决策日志：记录变更原因（性能/新需求/规范/重构等），按 `YYYY-MM-DD: 原因` 格式
4. 更新 `last_updated` 字段

**不追踪行号**——函数索引的定位由 AI 实时 grep 完成，无需维护。

文档格式示例：
```yaml
---
title: 模块名
covers_file: [src/modules/xxx.js]    # 对应源文件
depends_on: []                         # 依赖的其他文档
api_signature: 对外接口                # 外部可见的函数/变量
last_updated: 2026-07-01
why_exists: 一句话说清设计目的
---

## 设计意图
（prose：这个模块解决什么问题、为什么这么设计、关键约束）

## 函数索引
| 函数 | 所在文件 | 功能 | 可见性 | 备注 |
|------|----------|------|--------|------|

## 决策日志
- 2026-07-01: 初始文档创建
```
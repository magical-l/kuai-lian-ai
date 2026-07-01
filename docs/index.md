---
title: 快连AI 项目文档入口
covers_file: [所有 src/ 下源文件]
depends_on: []
api_signature: 无（项目文档索引）
last_updated: 2026-07-01（+dark-mode）
why_exists: 浏览器端大模型端点管理+多模型对话工具，纯原生JS单页面及Chrome扩展
---

# 快连AI 项目文档

## 项目目的

浏览器端大模型端点管理工具。核心功能：管理多个AI提供商（OpenAI/Claude/Gemini）的端点配置，支持多模型同时对话、流式响应对比、嵌入请求。

## 架构概览

UI Layer（分隔条布局/消息渲染/端点树）→ Store Layer（数据CRUD/会话管理/状态）→ Storage Layer（IndexedDB/FS API/扩展）→ API Layer（SSE流式/多模型并发/Provider格式抽象）→ Chrome Extension（CORS代理/端口通信）

## 文档阅读路线

| 文档 | 适用场景 |
|------|----------|
| design/architecture.md | 理解技术选型和整体架构 |
| design/css-architecture.md | CSS 文件结构、变量体系、布局系统、类名命名 |
| design/data-model.md | 理解端点树和会话数据结构 |
| design/build.md | 构建流程和双产物差异 |
| modules/storage-core.md | 存储层实现细节 |
| modules/store.md | 数据CRUD和状态管理 |
| modules/api.md | API通信和流式多模型并发 |
| modules/providers.md | Provider格式抽象和DOM工具函数 |
| modules/ui.md | UI组件和交互 |
| modules/endpoint-tree.md | 端点树渲染和拖拽 |
| modules/main.md | 主入口逻辑 |
| extension/overview.md | Chrome扩展架构 |
| extension/cors-proxy.md | CORS代理设计 |

## 构建产物

- 单页面 HTML: dist/kuai-lian-ai.html
- Chrome 扩展: dist/extension/（含 zip 包）
- 构建命令: node build.js

当前版本: 6.3.1

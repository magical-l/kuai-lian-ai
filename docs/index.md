---
title: 快连AI 项目文档入口
covers_file: [所有 src/ 下源文件]
depends_on: []
api_signature: 无（项目文档索引）
last_updated: 2026-07-02
why_exists: 浏览器端大模型端点管理+多模型对话工具，纯原生JS单页面及Chrome扩展
---

# 快连AI 项目文档

## 项目目的

浏览器端大模型端点管理工具。核心功能：管理多个AI提供商（OpenAI/Claude/Gemini）的端点配置，支持多模型同时对话、流式响应对比、嵌入请求。

## 架构概览

UI Layer（分隔条布局/消息渲染/端点树）→ Store Layer（数据CRUD/会话管理/状态）→ Storage Layer（IndexedDB/FS API/扩展）→ API Layer（SSE流式/多模型并发/Provider格式抽象）→ Chrome Extension（CORS代理/端口通信）

## 产物形态

本项目有三种运行形态：

| 形态 | 位置 | 说明 |
|------|------|------|
| **基础版** | `src/layout.html` | 该文件作为源码，本身就可以直接打开使用，无需构建。适用于开发/调试。 |
| **单页面 HTML** | `dist/kuai-lian-ai.html` | 构建产物，所有资源内联，可独立分发。`node build.js` 生成。 |
| **Chrome/edge 扩展** | `dist/extension/` | 构建产物，含 manifest.json。加载为 unpacked extension 或安装 zip。 |

**构建命令**：`node build.js`（生成以上两种分布式产物，源码版无需构建）

## 阅读路线

从入口文档开始，遇到不理解的引用时点击链接深入。

| 入口文档 | 适合什么场景 |
|----------|-------------|
| [架构总览](design/architecture.md) | 理解技术选型、数据流向、模块依赖——所有问题的起点 |
| [数据模型](design/data-model.md) | 理解端点树结构、会话/消息格式、存储后端切换 |
| [构建流程](design/build.md) | 了解构建命令、双产物差异、版本管理 |
| [CSS 体系](design/css-architecture.md) | 需要改样式时——变量体系、布局系统、类名命名 |
| [Chrome 扩展架构](extension/overview.md) | 处理扩展相关的问题——环境检测、CORS 代理、权限 |

当前版本: 6.3.5

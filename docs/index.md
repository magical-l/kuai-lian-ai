---
title: 快连AI 项目文档入口
covers_file: [所有 src/ 下源文件]
depends_on: []
api_signature: 无（项目文档索引）
last_updated: 2026-08-28
why_exists: 浏览器端大模型端点管理+多模型对话工具，纯原生JS单页面及Chrome扩展
---

# 快连AI 项目文档

## 项目目的

浏览器端大模型端点管理工具。核心功能：管理多个AI提供商（OpenAI Chat/Responses、Claude、Gemini，以及视频 provider）的端点配置，支持多模型同时对话、流式响应对比、嵌入请求和多种非流式请求。

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

当前版本: 6.33.4

## 决策日志

- 2026-07-27: 修复端点树拖放目标事件丢失与非法祖先→后代移动，发布 v6.32.3
- 2026-07-28: 验收新增节点局部插入、筛选与批量测试状态同步，以及保存期间 DOM 重绘回退，发布 v6.32.4
- 2026-08-12: 同步存储可靠性审查修复、清空屏障、端点回滚、测试资格、workspace 参数生命周期和 modelParams 数据语义说明；页面、构建产物与扩展 manifest 均为 v6.32.11
- 2026-08-12: 验收 workspace 参数取消选择与递归删除清理修复，发布 v6.32.12
- 2026-08-13: 修复流式卡片正文选择器歧义——`$('.content', card)` 误命中 header 的 `.copy.content` 按钮，导致生图/失败提示写进隐藏元素、正文停留在"等待回复..."；改用 `.one.response.msg > .content`，生图提前显示与失败提示立即生效。发布 v6.32.13
- 2026-08-13: 修复发送按钮行与 streaming-hint 被挤出视口。输入区布局从 `flex:1` 撑满改为 `flex:0 0 auto` 纯“向上撑”（输入区完整、不内部滚动，消息区让位）；已选区 `max-height` 由 JS `syncSelectedAreaLimit()` 动态设置，消息区 `min-height` 100→50。后续高度拖拽模型由 v6.33.4 统一为调整输入区高度。发布 v6.32.14。
- 2026-08-18: 验收大功能 9，发布 v6.33.0：新增 OpenAI `/v1/responses` 接口格式；端点和会话参数改为“继承/沿用、自己设置、由模型决定”三态，未明确设置的建议值不保存、不发送；补齐参数空值过滤、Responses `reasoning` 合并、特殊参数键及持久化失败回滚安全。
- 2026-08-24: 修复远程 CSS 路径，恢复 `/css/common.css` 和 `/css/layout.css`，发布 v6.33.2。
- 2026-08-24: 去除 `setOwnEnumerableDataProperty` 重复顶层声明，统一由 `shared.js` 提供公共实现，并新增生产模块顶层函数唯一性回归检查，发布 v6.33.3。
- 2026-08-28: 发布 v6.33.4；水平分隔条改为调整 `#chat-input` 高度，`.msg.list` 保持弹性填充；输入区高度迁移到 `chat-input-height`，初始化清理旧消息区布局键；首次存储目录弹窗的关闭按钮保持可见，遮罩点击仍可关闭。

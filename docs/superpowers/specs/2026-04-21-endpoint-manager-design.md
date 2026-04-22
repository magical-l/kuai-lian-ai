---
name: 聊天模型端点管理器
description: 本地聊天模型API端点管理和测试工具
---

# 聊天模型端点管理器 - 设计文档

## 概述

一个纯前端本地应用，用于管理多个AI模型API端点并进行聊天测试。数据通过File System Access API存储在用户指定的目录中。

## 整体布局

三栏布局，侧栏全高度，分界线可拖动调整宽度：

| 左侧栏 | 中间区域 | 右侧栏 |
|--------|----------|--------|
| 端点列表（两级分组） | 聊天界面 | 聊天记录列表 |
| 可拖动调整宽度（拖动右边界） | 自适应剩余宽度 | 可拖动调整宽度（拖动左边界） |

### 交互规则
- 点击左侧**模型**：在当前会话中使用该模型（无会话则新建），消息发送时调用该模型的API
- 点击右侧**聊天记录**：加载历史会话，恢复当时选中的模型
- 右侧聊天记录列表：显示全部会话，按时间倒序排列

## 端点管理

### 两级分组结构

**大组（Endpoint Group）** 配置公共信息：
- id：唯一标识（uuid）
- 名字：自定义名称（如"OpenAI官方"、"本地Ollama"）
- base_url：API基础地址
- 接口风格：OpenAI / Claude / Gemini（单选）
- 密码：API Key / Token

**模型（Model）** 配置：
- id：唯一标识（uuid）
- 模型名：如"gpt-4o"、"claude-sonnet"（仅显示名称，不唯一）

> 注：同一个模型名可能出现在多个大组中（如"OpenAI官方"和"第三方代理"都提供gpt-4o），因此模型需要独立ID而非用模型名作为标识。

### 操作
- 新增/修改/删除大组
- 新增/修改/删除模型
- 排序（大组内模型排序、大组间排序）

## 聊天功能

### MVP功能
1. 发送消息
2. 流式显示回复（实时显示）
3. 停止生成（中断流式输出）
4. 重新生成（让模型再回答一次）

### 多轮对话
- 发送新消息时带上全部历史记录作为上下文
- 不自动截断，用户自行管理

### 消息显示
- MVP阶段：纯文本显示
- 后续迭代：Markdown渲染

## 数据存储

### 存储方式
使用 **File System Access API**，用户首次使用时选择一个目录，所有数据存储在该目录下。

### 文件结构（用户目录下）
```
<用户目录>/
  endpoints.json      # 端点配置（大组+模型）
  sessions/
    <session-id>.json # 每个聊天会话
```

### 会话数据结构
```json
{
  "id": "uuid",
  "title": "第一条消息前20字...",
  "createdAt": "timestamp",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "...", "endpointGroupId": "...", "modelId": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "...", "endpointGroupId": "...", "modelId": "..." }
  ]
}
```

> 注：
> - 用户消息不记录模型信息（用户自己输入）
> - 助手消息记录 `(endpointGroupId, modelId)` 组合，标识当时使用的模型
> - 同一会话内可切换模型

### 聊天记录标题
截取第一条用户消息的前20个字符作为标题。

## API适配

MVP阶段硬编码适配三种接口风格：

### OpenAI风格
- 请求：`POST /v1/chat/completions`
- 认证：`Authorization: Bearer <key>`
- 流式：`stream: true`

### Claude风格
- 请求：`POST /v1/messages`
- 认证：`x-api-key: <key>` + `anthropic-version` header
- 流式：`stream: true`

### Gemini风格
- 请求：`POST /v1beta/models/<model>:generateContent` 或 `streamGenerateContent`
- 认证：URL参数 `key=<api_key>`
- 流式：通过streamGenerateContent端点

### Fallback处理
请求流式但API返回完整响应时，直接完整显示。

## 实现方案

### 技术栈
- 纯HTML + CSS + JavaScript（无框架）
- ES模块原生支持（无需构建工具）

### 文件结构
```
index.html       # 主页面入口
styles.css       # 样式
js/
  api.js         # API调用逻辑（流式处理、三种风格适配）
  store.js       # 数据存储逻辑（File System Access API、端点/会话管理）
  ui.js          # UI渲染和交互（三栏布局、拖动调整、消息显示）
  main.js        # 入口，初始化和协调各模块
```

### 模块职责

**api.js**
- 统一的API调用接口
- 流式响应处理
- OpenAI/Claude/Gemini风格适配
- 停止生成、重新生成支持

**store.js**
- File System Access API封装
- 端点配置读写
- 会话数据读写
- 初始化目录选择

**ui.js**
- 三栏布局渲染
- 可拖动分界线实现
- 端点列表渲染（两级分组）
- 聊天记录列表渲染
- 聊天界面渲染（消息列表、输入框、控制按钮）
- 事件绑定和处理

**main.js**
- 初始化流程
- 模块间协调
- 状态管理

## MVP范围边界

### 包含
- 端点两级分组管理（大组+模型，模型有唯一ID）
- 聊天（发送、流式、停止、重新生成）
- 同一会话内可切换模型
- 数据持久化（File System Access API）
- 三栏可拖动布局

### 不包含（后续迭代）
- Markdown渲染
- 模型参数配置（temperature、max_tokens等）
- 会话历史截断配置
- 自定义API字段映射
- 导入/导出功能
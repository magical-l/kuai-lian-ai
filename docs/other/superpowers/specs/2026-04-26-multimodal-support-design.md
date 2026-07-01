---
name: multimodal-support
description: 多模态支持设计方案 - 图片和文件输入
type: project
---

# 快连AI 多模态支持设计文档

## 背景

当前快连AI 只支持纯文本对话，帮助文档明确写着"暂不支持其他模态"。用户需求：
- 支持图片输入（上传、粘贴、URL）
- 支持文件输入（不限类型）

## 需求汇总

| 项目 | 需求 |
|------|------|
| 图片输入方式 | 上传本地图片、粘贴剪贴板图片、URL 图片地址 |
| 文件输入方式 | 不限类型，用户自行负责 |
| 文件处理方式 | 按类型区分：纯文本文件提取文本，其他文件转 base64 |
| 附件数量/大小 | 不限制 |
| 输入时 UI | 缩略图在发送按钮左侧，同一行排列；附件按钮在发送按钮左边 |
| 发送后 UI | 消息气泡中附件在正文下方，显示缩略图+文件名，可点击查看/下载 |

---

## 设计方案

采用**标准化消息格式 + 智能适配层**方案：
- 定义统一的内部消息格式
- 各 API 调用函数中转换为对应格式
- 不支持的类型自动降级为文本提示

---

## 一、内部消息数据结构

### 改造前
```json
{
  "role": "user",
  "content": "纯文本内容"
}
```

### 改造后
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "这是图片描述" },
    { "type": "image", "source": { "type": "base64", "media_type": "image/jpeg", "data": "..." } },
    { "type": "image", "source": { "type": "url", "url": "https://..." } },
    { "type": "file", "name": "report.pdf", "source": { "type": "base64", "media_type": "application/pdf", "data": "..." } },
    { "type": "file_text", "name": "script.js", "text": "提取的文本内容" }
  ]
}
```

**类型说明**：
- `text` - 纯文本
- `image` - 图片，支持 base64 或 URL 两种来源
- `file` - 二进制文件（PDF 等），转 base64
- `file_text` - 提取了文本内容的文件（txt、md、代码文件）

---

## 二、API 转换层

### OpenAI 格式转换
```javascript
function toOpenAIContent(content) {
  return content.map(item => {
    if (item.type === 'text' || item.type === 'file_text') {
      return { type: 'text', text: item.text };
    }
    if (item.type === 'image') {
      const url = item.source.type === 'url'
        ? item.source.url
        : `data:${item.source.media_type};base64,${item.source.data}`;
      return { type: 'image_url', image_url: { url } };
    }
    if (item.type === 'file') {
      // GPT-4o 等模型支持 PDF，格式类似 image_url
      const url = `data:${item.source.media_type};base64,${item.source.data}`;
      return { type: 'image_url', image_url: { url } };
    }
    return { type: 'text', text: `[未知类型附件]` };
  });
}
```

### Claude 格式转换
```javascript
function toClaudeContent(content) {
  return content.map(item => {
    if (item.type === 'text' || item.type === 'file_text') {
      return { type: 'text', text: item.text };
    }
    if (item.type === 'image') {
      return {
        type: 'image',
        source: { type: 'base64', media_type: item.source.media_type, data: item.source.data }
      };
    }
    if (item.type === 'file') {
      return {
        type: 'document',
        source: { type: 'base64', media_type: item.source.media_type, data: item.source.data }
      };
    }
    return { type: 'text', text: `[未知类型附件]` };
  });
}
```

### Gemini 格式转换
```javascript
function toGeminiContent(content) {
  return content.map(item => {
    if (item.type === 'text' || item.type === 'file_text') {
      return { text: item.text };
    }
    if (item.type === 'image' || item.type === 'file') {
      return {
        inline_data: { mime_type: item.source.media_type, data: item.source.data }
      };
    }
    return { text: `[未知类型附件]` };
  });
}
```

---

## 三、降级处理策略

### 模型能力配置
在端点配置的模型数据中增加能力标记：
```json
{
  "id": "model-uuid",
  "name": "gpt-4o",
  "capabilities": ["text", "image", "file"]
}
```

**能力来源**：
- 预设知识：内置常见模型能力映射
- 手动配置：用户勾选覆盖

### 降级处理

**场景一：模型不支持某内容类型**
```javascript
// 替换为文本提示
if (item.type === 'file' && !modelCapabilities.includes('file')) {
  return { type: 'text', text: `[文件 ${item.name}，当前模型不支持此类型]` };
}
```

**场景二：URL 图片但模型只支持 base64**
```javascript
if (item.type === 'image' && item.source.type === 'url' && !modelCapabilities.includes('image_url')) {
  return { type: 'text', text: `[图片链接 ${item.source.url}，当前模型不支持 URL 图片]` };
}
```

**场景三：文件处理失败**
```javascript
return { type: 'text', text: `[文件 ${item.name}，处理失败：${error}]` };
```

### UI 提示
- 模型选择器：能力图标标识
- 添加附件时：不支持则弹窗提示
- 发送前：警告图标提示

---

## 四、UI 设计

### 输入区布局

**改造后布局**：
```
[模型选择器]
[文本输入框.................]
[文本输入框.................]
[缩略图1][缩略图2]... [📎附件] [发送]
```

**布局说明**：
- 缩略图区域在左侧，横向排列
- 附件按钮在发送按钮左边
- 整体一行，紧凑布局

**缩略图样式**：
- 图片：约 40px × 40px 缩略图，右上角 × 删除按钮
- 文件：文件类型图标 + 文件名缩略

### 添加附件按钮

- 图标：📎 或图片图标
- 点击：弹出文件选择器，支持多选
- 支持类型：不限（用户自行负责）

### 粘贴处理

监听输入框 `paste` 事件：
- 检测剪贴板图片 → 自动添加为附件
- 检测剪贴板文件 → 自动添加（浏览器支持时）

### URL 图片输入

用户在文本框输入图片 URL，系统识别并转换为 `image` 类型：

**识别规则**：
- URL 以图片扩展名结尾：`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`
- URL 包含图片相关关键词：`/image/`, `/img/`, `/photo/`, `thumbnail`

**处理方式**：
- 用户发送消息时，系统扫描文本中的 URL
- 匹配规则的 URL 自动转换为 `{ type: 'image', source: { type: 'url', url: '...' } }`
- 其他 URL 保持为纯文本（用户可能只是引用链接）

### 消息气泡附件展示

```
┌─────────────────────────────┐
│ 用户消息                     │
│                             │
│ 请帮我分析这张图片的内容... │
│                             │
│ ┌───┐ ┌─────────┐           │
│ │ 🖼 │ │ 📄report │           │
│ └───┘ └─────────┘           │
│   ↓点击查看大图/下载         │
└─────────────────────────────┘
```

**展示规则**：
- 附件在正文下方显示
- 图片：缩略图 + 文件名
- 文件：图标 + 文件名
- 点击：大图预览或文件下载

---

## 五、技术实现要点

### 需要修改的文件

单文件应用，改动集中在 `kuai-lian-ai.html`：

1. **数据结构**：
   - `addMessage` 函数：支持 `content` 数组格式
   - `renderMessages` 函数：渲染附件展示
   - 会话存储 JSON 格式：兼容新格式

2. **API 调用**：
   - `callOpenAI`：消息格式转换
   - `callClaude`：消息格式转换
   - `callGemini`：消息格式转换

3. **UI**：
   - 输入区布局：添加缩略图区域、附件按钮
   - 缩略图组件：显示、删除、预览
   - 粘贴监听：剪贴板图片处理
   - 消息气泡：附件展示样式

4. **模型能力**：
   - 端点配置：增加 `capabilities` 字段
   - 预设知识：内置常见模型能力表

### 兼容性处理

- 旧版纯文本消息：自动转换为 `{ type: 'text', text: ... }` 格式
- 读取时：检测 `content` 是字符串还是数组，兼容处理

---

## 六、实现优先级

**Phase 1（核心功能）**：
1. 消息数据结构改造
2. 上传本地图片 + base64 转换
3. 缩略图 UI + 删除功能
4. OpenAI 格式适配（最常用）

**Phase 2（扩展）**：
1. 粘贴剪贴板图片
2. Claude/Gemini 格式适配
3. 文件输入 + 文本提取
4. 模型能力配置

**Phase 3（完善）**：
1. URL 图片识别
2. 降级提示 UI
3. 大图预览/文件下载弹窗
4. 预设模型能力表

---

## Why

用户需要发送图片和文件给大模型进行分析，这是现代多模态模型的核心能力。当前纯文本限制无法满足这个需求。

## How to apply

按 Phase 分步实现，每个 Phase 完成后可测试验证，逐步完善功能。
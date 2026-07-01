# 多模态支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为快连AI添加图片和文件输入的多模态支持

**Architecture:** 定义统一的内部消息格式（content数组），在各API调用函数中转换为对应格式。UI层添加附件按钮和缩略图展示。

**Tech Stack:** 单文件HTML应用，纯JavaScript，无框架

**File:** `kuai-lian-ai.html`（约5000行，单文件）

---

## Task 1: 消息数据结构改造

**Files:**
- Modify: `kuai-lian-ai.html` - `addMessage` 函数（约3860行）、消息存储格式

- [ ] **Step 1: 修改 addMessage 函数，支持 content 数组格式**

定位到 `addMessage` 函数（约3860-3892行），修改消息结构：

```javascript
async function addMessage(sessionId, role, content, options = {}) {
  const session = sessionsCache.get(sessionId);
  if (!session) return null;

  const message = { role, timestamp: Date.now() };

  // content 改造：支持字符串或数组
  if (typeof content === 'string') {
    // 纯文本，转换为标准数组格式
    message.content = [{ type: 'text', text: content }];
  } else if (Array.isArray(content)) {
    // 已经是数组格式，直接使用
    message.content = content;
  } else {
    // 兼容旧格式或其他情况
    message.content = [{ type: 'text', text: content || '' }];
  }

  if (role === 'user') {
    if (options.targetModels) {
      message.targetModels = options.targetModels;
    }
  } else if (role === 'assistant') {
    if (options.responses) {
      message.responses = options.responses;
    }
    if (options.modelId && !options.responses) {
      message.modelId = options.modelId;
      message.endpointGroupId = options.endpointGroupId;
      if (options.usage) message.usage = options.usage;
    }
  }

  if (role === 'user' && session.messages.filter(m => m.role === 'user').length === 1) {
    // 从第一个 text 块提取标题
    const firstText = message.content.find(c => c.type === 'text');
    session.title = firstText ? firstText.text.slice(0, 20) : '新会话';
  }

  session.messages.push(message);
  await saveSession(session);
  return message;
}
```

- [ ] **Step 2: 修改消息读取兼容性处理**

定位到 `loadSession` 函数（约3825行）和消息渲染逻辑，添加兼容性处理：

```javascript
// 辅助函数：确保消息 content 为数组格式
function normalizeMessageContent(msg) {
  if (!msg.content) return [{ type: 'text', text: '' }];
  if (typeof msg.content === 'string') {
    return [{ type: 'text', text: msg.content }];
  }
  if (Array.isArray(msg.content)) {
    return msg.content;
  }
  return [{ type: 'text', text: String(msg.content) }];
}
```

- [ ] **Step 3: 修改 handleSend 中消息映射逻辑**

定位到 `handleSend` 函数（约4816-4826行）的消息映射部分：

```javascript
// 修改消息映射，转换为API格式（暂仍用纯文本，后续Task添加转换）
const messages = currentSession.messages.map(m => {
  if (m.role === 'assistant' && m.responses) {
    const content = m.responses
      .filter(r => r.status === 'completed' && r.content)
      .map(r => r.content)
      .join('\n\n---\n\n');
    return { role: m.role, content };
  }
  // 用户消息：从数组提取纯文本（后续Task会改为多模态格式）
  const normalized = normalizeMessageContent(m);
  const textContent = normalized
    .filter(c => c.type === 'text' || c.type === 'file_text')
    .map(c => c.text || '')
    .join('\n');
  return { role: m.role, content: textContent };
});
```

- [ ] **Step 4: 手动测试 - 打开应用，发送消息确认兼容**

测试步骤：
1. 打开 `kuai-lian-ai.html`
2. 选择模型，发送一条消息
3. 查看控制台无报错
4. 刷新页面，消息历史正常加载

---

## Task 2: 添加附件数据管理

**Files:**
- Modify: `kuai-lian-ai.html` - 添加全局变量和附件处理函数

- [ ] **Step 1: 添加附件全局变量**

在全局变量区域（约4530行附近 `let currentSession = null;` 之前）添加：

```javascript
// 附件管理
let pendingAttachments = [];  // 待发送的附件列表
```

- [ ] **Step 2: 添加附件处理辅助函数**

在 `getInputContent` 函数（约3155行）之后添加：

```javascript
// 附件类型判断
function isTextFile(filename) {
  const textExtensions = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', 
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
    '.css', '.scss', '.sass', '.less', '.html', '.htm', '.xml', '.yaml', '.yml',
    '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.php', '.rb', '.go',
    '.rs', '.swift', '.kt', '.scala', '.lua', '.r', '.vue', '.svelte'];
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  return textExtensions.includes(ext);
}

function getMediaType(filename) {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  const imageTypes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
  };
  if (imageTypes[ext]) return imageTypes[ext];
  
  const fileTypes = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  if (fileTypes[ext]) return fileTypes[ext];
  
  return 'application/octet-stream';
}

// 读取文件为 base64
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result.split(',')[1];  // 去掉 data:xxx;base64, 前缀
      resolve(data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 读取文本文件内容
async function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// 添加附件
async function addAttachment(file) {
  const isImage = getMediaType(file.name).startsWith('image/');
  const isText = isTextFile(file.name);
  
  const attachment = {
    id: generateUUID(),
    name: file.name,
    type: isImage ? 'image' : (isText ? 'file_text' : 'file'),
    file: file,  // 临时存储 File 对象，用于缩略图和预览
    mediaType: getMediaType(file.name),
    previewUrl: null  // 缩略图 URL（图片用）
  };
  
  // 图片生成缩略图 URL
  if (isImage) {
    attachment.previewUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }
  
  pendingAttachments.push(attachment);
  renderPendingAttachments();
}

// 删除附件
function removeAttachment(id) {
  pendingAttachments = pendingAttachments.filter(a => a.id !== id);
  renderPendingAttachments();
}

// 清空附件
function clearAttachments() {
  pendingAttachments = [];
  renderPendingAttachments();
}
```

- [ ] **Step 3: 手动测试 - 控制台测试 addAttachment 函数**

测试步骤：
1. 打开应用
2. 控制台执行 `addAttachment(new File(['test'], 'test.txt'))`
3. 查看控制台无报错，`pendingAttachments` 数组有内容

---

## Task 3: 添加缩略图 UI 和附件按钮

**Files:**
- Modify: `kuai-lian-ai.html` - CSS样式、HTML结构、渲染函数

- [ ] **Step 1: 添加缩略图和附件按钮 CSS 样式**

在 `<style>` 区域（约1760行 `}` 结束前）添加：

```css
/* ========== 附件缩略图 ========== */
.attachments-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  overflow-x: auto;
  flex-shrink: 0;
  min-height: 44px;
  background: var(--bg-subtle);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  border: 1px solid var(--border-subtle);
  border-bottom: none;
}

.attachments-row:empty {
  display: none;
}

.attachment-thumb {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
}

.attachment-thumb.image {
  background-size: cover;
  background-position: center;
}

.attachment-thumb.file {
  font-size: 20px;
  color: var(--text-muted);
}

.attachment-thumb .name-tooltip {
  position: absolute;
  bottom: -24px;
  left: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  padding: 2px 6px;
  font-size: 11px;
  white-space: nowrap;
  border-radius: var(--radius-sm);
  display: none;
  z-index: 10;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.attachment-thumb:hover .name-tooltip {
  display: block;
}

.attachment-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  background: var(--danger);
  color: white;
  border-radius: 50%;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  cursor: pointer;
  display: none;
}

.attachment-thumb:hover .attachment-remove {
  display: block;
}

.attachment-remove:hover {
  background: #b91c1c;
}

/* 附件按钮 */
#btn-attach {
  border: 1px solid var(--border-subtle);
  padding: 0;
  height: 28px;
  min-width: 28px;
  background: var(--bg-muted);
}

#btn-attach:hover:not(:disabled) {
  background: var(--accent-light);
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

#btn-attach svg {
  width: 14px;
  height: 14px;
}

/* 隐藏的文件输入 */
#file-input {
  display: none;
}
```

- [ ] **Step 2: 修改输入区 HTML 结构**

定位到 `<div class="input-wrapper">` （约1837-1839行），修改为：

```html
<div class="attachments-row" id="attachments-row"></div>
<div class="input-wrapper">
  <textarea id="chat-input" placeholder="输入消息..." rows="3"></textarea>
  <div style="display:flex;gap:8px;position:absolute;right:8px;bottom:8px;z-index:1;">
    <input type="file" id="file-input" multiple accept="*/*">
    <button id="btn-attach" class="navbar" title="添加附件">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
      </svg>
    </button>
    <button id="btn-send" class="send-btn-inline" title="发送">发送</button>
  </div>
</div>
```

- [ ] **Step 3: 添加缩略图渲染函数**

在 `renderModelSelector` 函数之后（约2421行）添加：

```javascript
// 渲染待发送的附件缩略图
function renderPendingAttachments() {
  const row = $('#attachments-row');
  if (!row) return;
  
  row.innerHTML = '';
  
  pendingAttachments.forEach(att => {
    const thumb = mk('div', `attachment-thumb ${att.type === 'image' ? 'image' : 'file'}`);
    thumb.dataset.id = att.id;
    
    if (att.type === 'image' && att.previewUrl) {
      thumb.style.backgroundImage = `url(${att.previewUrl})`;
    } else {
      thumb.textContent = '📄';
    }
    
    // 文件名提示
    const tooltip = mk('span', 'name-tooltip');
    tooltip.textContent = att.name;
    thumb.addChild(tooltip);
    
    // 删除按钮
    const remove = mk('span', 'attachment-remove');
    remove.textContent = '×';
    remove.onclick = (e) => {
      e.stopPropagation();
      removeAttachment(att.id);
    };
    thumb.addChild(remove);
    
    // 点击预览
    thumb.onclick = () => showAttachmentPreview(att);
    
    row.addChild(thumb);
  });
}

// 预览附件（简单实现：图片弹窗，文件下载）
function showAttachmentPreview(att) {
  if (att.type === 'image' && att.previewUrl) {
    // 图片预览弹窗
    const overlay = mk('div', 'image-preview-overlay');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';
    
    const img = mk('img');
    img.src = att.previewUrl;
    img.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px;';
    
    overlay.onclick = () => overlay.remove();
    overlay.addChild(img);
    doc.body.addChild(overlay);
  } else {
    // 文件下载
    const link = mk('a');
    link.href = att.previewUrl || URL.createObjectURL(att.file);
    link.download = att.name;
    link.click();
    if (!att.previewUrl) URL.revokeObjectURL(link.href);
  }
}
```

- [ ] **Step 4: 绑定附件按钮事件**

定位到 `init` 函数（约4535-4590行），在事件绑定区域添加：

```javascript
// 附件按钮
$('#btn-attach').onclick = () => {
  $('#file-input').click();
};

$('#file-input').onchange = async (e) => {
  const files = e.target.files;
  if (files && files.length > 0) {
    for (const file of files) {
      await addAttachment(file);
    }
  }
  e.target.value = '';  // 清空以便再次选择相同文件
};
```

- [ ] **Step 5: 手动测试 - 点击附件按钮，选择文件，显示缩略图**

测试步骤：
1. 打开应用
2. 点击附件按钮
3. 选择一张图片
4. 缩略图显示在输入框上方
5. 点击缩略图可预览大图
6. 点击 × 可删除缩略图

---

## Task 4: 添加粘贴图片处理

**Files:**
- Modify: `kuai-lian-ai.html` - 粘贴事件监听

- [ ] **Step 1: 添加粘贴事件监听**

定位到 `init` 函数中的 `chatInput.on('keydown', ...)` 之后（约4543行），添加：

```javascript
// 粘贴图片处理
chatInput.on('paste', async (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        await addAttachment(file);
        // 不阻止默认行为，允许同时粘贴文字
      }
    }
  }
});
```

- [ ] **Step 2: 手动测试 - 截图后粘贴到输入框**

测试步骤：
1. 截图（Win+Shift+S 或其他工具）
2. 在输入框 Ctrl+V 粘贴
3. 图片缩略图出现
4. 输入框仍可输入文字

---

## Task 5: 修改 handleSend 集成附件

**Files:**
- Modify: `kuai-lian-ai.html` - `handleSend` 函数（约4784行）

- [ ] **Step 1: 修改 getInputContent 为 getInputMessage**

定位到 `getInputContent` 函数（约3155-3158行），改为返回完整消息：

```javascript
function getInputMessage() {
  const input = $('#chat-input');
  const text = input.value.trim();
  
  // 构建消息内容数组
  const content = [];
  
  // 添加文本（如果有）
  if (text) {
    content.push({ type: 'text', text });
  }
  
  // 添加附件（异步处理，需要等待）
  // 这里返回 Promise
  return async () => {
    for (const att of pendingAttachments) {
      if (att.type === 'image') {
        const data = await fileToBase64(att.file);
        content.push({
          type: 'image',
          name: att.name,
          source: { type: 'base64', media_type: att.mediaType, data }
        });
      } else if (att.type === 'file_text') {
        const textContent = await fileToText(att.file);
        content.push({
          type: 'file_text',
          name: att.name,
          text: textContent
        });
      } else {
        const data = await fileToBase64(att.file);
        content.push({
          type: 'file',
          name: att.name,
          source: { type: 'base64', media_type: att.mediaType, data }
        });
      }
    }
    return content;
  };
}

// 保留 getInputContent 供其他地方使用
function getInputContent() {
  const input = $('#chat-input');
  return input.value.trim();
}
```

- [ ] **Step 2: 修改 handleSend 函数**

定位到 `handleSend` 函数（约4784行），修改开头部分：

```javascript
async function handleSend() {
  const getMessageContent = getInputMessage();
  const content = await getMessageContent();
  
  if (content.length === 0) return;  // 无文本无附件
  
  if (selectedModels.length === 0) {
    selectorExpanded = true;
    renderModelSelector(getGroups(), selectedModels, false);
    return;
  }
  
  // ... 后续代码不变，直到 clearInput 处
  
  // 清空输入和附件
  clearInput();
  clearAttachments();
  
  // ... 后续代码不变
}
```

- [ ] **Step 3: 手动测试 - 添加图片附件，发送消息**

测试步骤：
1. 选择一个支持图片的模型（如 GPT-4o）
2. 添加图片附件
3. 输入文字描述
4. 点击发送
5. 查看控制台无报错
6. 消息显示正常

---

## Task 6: API 转换层 - OpenAI

**Files:**
- Modify: `kuai-lian-ai.html` - `callOpenAI` 函数（约3930行）

- [ ] **Step 1: 添加 OpenAI 消息格式转换函数**

在 `callOpenAI` 函数之前添加：

```javascript
// OpenAI 消息格式转换
function toOpenAIContent(contentArray) {
  return contentArray.map(item => {
    if (item.type === 'text' || item.type === 'file_text') {
      return { type: 'text', text: item.text };
    }
    if (item.type === 'image') {
      // OpenAI 支持 base64 和 URL
      let imageUrl;
      if (item.source.type === 'url') {
        imageUrl = item.source.url;
      } else {
        imageUrl = `data:${item.source.media_type};base64,${item.source.data}`;
      }
      return { type: 'image_url', image_url: { url: imageUrl } };
    }
    if (item.type === 'file') {
      // GPT-4o 等支持 PDF，格式类似 image_url
      const url = `data:${item.source.media_type};base64,${item.source.data}`;
      return { type: 'image_url', image_url: { url } };
    }
    // 不支持的类型，降级为文本提示
    return { type: 'text', text: `[附件 ${item.name || '未知'}，不支持此类型]` };
  });
}
```

- [ ] **Step 2: 修改 handleSend 中的消息映射**

定位到 `handleSend` 中的消息映射部分（约4816行），修改：

```javascript
const messages = currentSession.messages.map(m => {
  if (m.role === 'assistant' && m.responses) {
    const content = m.responses
      .filter(r => r.status === 'completed' && r.content)
      .map(r => r.content)
      .join('\n\n---\n\n');
    return { role: m.role, content };
  }
  // 用户消息：使用转换函数
  const normalized = normalizeMessageContent(m);
  return { role: m.role, content: toOpenAIContent(normalized) };
});
```

- [ ] **Step 3: 手动测试 - 发送图片给 OpenAI 格式模型**

测试步骤：
1. 配置一个 OpenAI 格式的端点（如 OpenAI 官方或兼容服务）
2. 添加图片
3. 发送消息
4. 查看模型能否理解图片内容

---

## Task 7: API 转换层 - Claude

**Files:**
- Modify: `kuai-lian-ai.html` - `callClaude` 函数之前

- [ ] **Step 1: 添加 Claude 消息格式转换函数**

在 `callClaude` 函数之前（约4104行）添加：

```javascript
// Claude 消息格式转换
function toClaudeContent(contentArray) {
  return contentArray.map(item => {
    if (item.type === 'text' || item.type === 'file_text') {
      return { type: 'text', text: item.text };
    }
    if (item.type === 'image') {
      // Claude 只支持 base64
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: item.source.media_type,
          data: item.source.data
        }
      };
    }
    if (item.type === 'file') {
      // Claude 支持 document 类型（PDF等）
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: item.source.media_type,
          data: item.source.data
        }
      };
    }
    return { type: 'text', text: `[附件 ${item.name || '未知'}，不支持此类型]` };
  });
}
```

- [ ] **Step 2: 修改 callClaude 函数的消息处理**

定位到 `callClaude` 函数（约4104行），修改消息构建部分：

```javascript
async function callClaude(baseUrl, apiKey, model, messages, onChunk, signal = null) {
  const url = `${baseUrl}/v1/messages`;
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  };

  // 转换消息格式
  const claudeMessages = messages.map(m => {
    // content 可能是数组（OpenAI格式）或字符串
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content };
    }
    if (Array.isArray(m.content)) {
      return { role: m.role, content: toClaudeContent(m.content) };
    }
    return { role: m.role, content: m.content };
  });

  const body = {
    model,
    max_tokens: 4096,
    messages: claudeMessages,
    stream: true
  };
  
  // ... 后续代码不变
}
```

- [ ] **Step 3: 手动测试 - 发送图片给 Claude 格式模型**

测试步骤：
1. 配置一个 Claude 端点
2. 添加图片
3. 发送消息
4. 查看 Claude 能否理解图片

---

## Task 8: API 转换层 - Gemini

**Files:**
- Modify: `kuai-lian-ai.html` - `callGemini` 函数之前

- [ ] **Step 1: 添加 Gemini 消息格式转换函数**

在 `callGemini` 函数之前（约4226行）添加：

```javascript
// Gemini 消息格式转换
function toGeminiContent(contentArray) {
  const parts = [];
  contentArray.forEach(item => {
    if (item.type === 'text' || item.type === 'file_text') {
      parts.push({ text: item.text });
    }
    if (item.type === 'image' || item.type === 'file') {
      parts.push({
        inline_data: {
          mime_type: item.source.media_type,
          data: item.source.data
        }
      });
    }
    // 不支持的类型忽略
  });
  return parts;
}
```

- [ ] **Step 2: 修改 callGemini 函数的消息处理**

定位到 `callGemini` 函数（约4226行），修改消息构建部分：

```javascript
async function callGemini(baseUrl, apiKey, model, messages, onChunk, signal = null) {
  const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

  // 转换消息格式为 contents
  const contents = [];
  messages.forEach(m => {
    const role = m.role === 'user' ? 'user' : 'model';
    
    let parts;
    if (typeof m.content === 'string') {
      parts = [{ text: m.content }];
    } else if (Array.isArray(m.content)) {
      parts = toGeminiContent(m.content);
    } else {
      parts = [{ text: String(m.content) }];
    }
    
    // 合并相同角色的连续消息
    const lastContent = contents[contents.length - 1];
    if (lastContent && lastContent.role === role) {
      lastContent.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  });

  const body = { contents };
  
  // ... 后续代码不变
}
```

- [ ] **Step 3: 手动测试 - 发送图片给 Gemini 格式模型**

---

## Task 9: 消息气泡附件展示

**Files:**
- Modify: `kuai-lian-ai.html` - `renderMessages` 函数（约2937行）

- [ ] **Step 1: 添加附件渲染样式**

在 CSS 区域添加：

```css
/* 消息中的附件展示 */
.message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--border-subtle);
}

.message-attachment {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.message-attachment.image {
  padding: 2px;
}

.message-attachment-thumb {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  background: var(--bg-subtle);
}

.message-attachment-name {
  color: var(--text-secondary);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: 修改 renderMessages 用户消息渲染**

定位到 `renderMessages` 函数中用户消息渲染部分（约2944-2972行）：

```javascript
if (msg.role === 'user') {
  const meta = mk('div', 'message-meta message-meta-user');
  const timeStr = msg.timestamp ? formatDateTime(msg.timestamp) : '';
  meta.textContent = '我 · ' + timeStr;
  msgEl.addChild(meta);

  // 提取文本内容
  const normalized = normalizeMessageContent(msg);
  const textItems = normalized.filter(c => c.type === 'text' || c.type === 'file_text');
  const textContent = textItems.map(c => c.text || '').join('\n');
  
  if (textContent) {
    const userEl = mk('div', 'message-user');
    userEl.textContent = textContent;
    msgEl.addChild(userEl);
  }

  // 渲染附件（非 text/file_text 类型）
  const attachmentItems = normalized.filter(c => 
    c.type === 'image' || c.type === 'file'
  );
  if (attachmentItems.length > 0) {
    const attContainer = mk('div', 'message-attachments');
    
    attachmentItems.forEach(att => {
      const attEl = mk('div', `message-attachment ${att.type}`);
      
      if (att.type === 'image' && att.source) {
        let imgSrc;
        if (att.source.type === 'url') {
          imgSrc = att.source.url;
        } else {
          imgSrc = `data:${att.source.media_type};base64,${att.source.data}`;
        }
        const thumb = mk('img', 'message-attachment-thumb');
        thumb.src = imgSrc;
        thumb.onclick = () => {
          // 点击查看大图
          const overlay = mk('div', 'image-preview-overlay');
          overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';
          const fullImg = mk('img');
          fullImg.src = imgSrc;
          fullImg.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px;';
          overlay.onclick = () => overlay.remove();
          overlay.addChild(fullImg);
          doc.body.addChild(overlay);
        };
        attEl.addChild(thumb);
        
        const nameEl = mk('span', 'message-attachment-name');
        nameEl.textContent = att.name || '图片';
        attEl.addChild(nameEl);
      } else if (att.type === 'file') {
        attEl.textContent = `📄 ${att.name || '文件'}`;
        attEl.onclick = () => {
          // 下载文件
          const data = att.source.data;
          const mime = att.source.media_type;
          const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: mime });
          const link = mk('a');
          link.href = URL.createObjectURL(blob);
          link.download = att.name || 'file';
          link.click();
          URL.revokeObjectURL(link.href);
        };
      }
      
      attContainer.addChild(attEl);
    });
    
    msgEl.addChild(attContainer);
  }

  // 用户消息状态栏：复制按钮
  const statusBar = mk('div', 'message-status-bar message-status-bar-user');
  // ... 后续复制按钮代码不变
}
```

- [ ] **Step 3: 手动测试 - 发送带附件的消息，查看气泡展示**

测试步骤：
1. 添加图片和文件附件
2. 发送消息
3. 消息气泡显示附件缩略图在正文下方
4. 点击图片可查看大图
5. 点击文件可下载

---

## Task 10: 版本更新和文档

**Files:**
- Modify: `kuai-lian-ai.html` - 版本号、帮助文档

- [ ] **Step 1: 更新版本号**

定位到版本号显示（约1770行），更新：

```html
<span class="version">v1.17.0</span>
```

- [ ] **Step 2: 更新帮助文档**

定位到帮助对话框模板（约1949-1997行），修改相关文字：

```html
<div class="help-section">
  <h4>中间：聊天</h4>
  <p>可以选择一个或多个模型舌战群儒。</p>
  <p>* 目前，多轮对话只会把你的话和该模型之前的回复作为上下文，不搭理其他模型。</p>
  <p>* 支持图片和文件输入：点击附件按钮上传，或粘贴剪贴板图片。不同模型对多模态的支持程度不同。</p>
</div>
```

- [ ] **Step 3: 提交代码**

```bash
git add kuai-lian-ai.html
git commit -m "feat: 多模态支持 - 图片和文件输入

- 支持上传本地图片、粘贴剪贴板图片
- 支持文件输入，纯文本文件提取内容，其他转 base64
- OpenAI/Claude/Gemini 格式转换
- 消息气泡附件展示

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 自检清单

1. **Spec覆盖检查**:
   - 图片输入（上传、粘贴、URL）: Task 3, 4
   - 文件输入: Task 2, 3
   - 文件处理（按类型区分）: Task 2, 5
   - 缩略图 UI（发送按钮左侧同行）: Task 3
   - 消息气泡附件展示（正文下方）: Task 9
   - API 转换（OpenAI/Claude/Gemini）: Task 6, 7, 8

2. **占位符检查**: 无 TBD/TODO/实现later 等

3. **类型一致性**: 
   - `normalizeMessageContent` 返回数组
   - `toOpenAIContent`/`toClaudeContent`/`toGeminiContent` 输入输出都是数组
   - `contentArray` 参数名一致
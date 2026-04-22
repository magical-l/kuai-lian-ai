# 聊天模型端点管理器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地聊天模型API端点管理和测试工具，支持多端点管理、流式聊天、会话持久化。

**Architecture:** 纯前端三栏布局应用，左侧端点列表（两级分组），中间聊天界面，右侧聊天记录。使用ES模块组织代码，File System Access API存储数据。

**Tech Stack:** HTML + CSS + JavaScript（ES模块），无框架，无构建工具。

---

## 文件结构

```
index.html           # 主页面入口
styles.css           # 全局样式
js/
  store.js           # 数据存储（File System Access API）
  api.js             # API调用（流式、三种风格适配）
  ui.js              # UI渲染和交互
  main.js            # 入口，状态管理
```

---

### Task 1: 基础HTML结构和CSS布局

**Files:**
- Create: `index.html`
- Create: `styles.css`

- [ ] **Step 1: 创建HTML骨架**

创建 `index.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>聊天模型端点管理器</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="app-container">
    <!-- 左侧栏：端点列表 -->
    <div class="sidebar-left" id="sidebar-left">
      <div class="sidebar-header">端点列表</div>
      <div class="sidebar-content" id="endpoint-list"></div>
      <div class="sidebar-footer">
        <button id="btn-add-group">+ 新增大组</button>
        <button id="btn-add-model">+ 新增模型</button>
      </div>
    </div>
    <!-- 左侧拖动分界线 -->
    <div class="divider-left" id="divider-left"></div>
    
    <!-- 中间：聊天界面 -->
    <div class="main-content" id="main-content">
      <div class="chat-header" id="chat-header">
        <span id="current-model-name">未选择模型</span>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-area">
        <textarea id="chat-input" placeholder="输入消息..." rows="3"></textarea>
        <div class="chat-controls">
          <button id="btn-send">发送</button>
          <button id="btn-stop" disabled>停止</button>
          <button id="btn-regenerate" disabled>重新生成</button>
        </div>
      </div>
    </div>
    
    <!-- 右侧拖动分界线 -->
    <div class="divider-right" id="divider-right"></div>
    
    <!-- 右侧栏：聊天记录 -->
    <div class="sidebar-right" id="sidebar-right">
      <div class="sidebar-header">聊天记录</div>
      <div class="sidebar-content" id="session-list"></div>
    </div>
  </div>
  
  <script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: 创建基础CSS样式**

创建 `styles.css`:

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  height: 100vh;
  overflow: hidden;
}

.app-container {
  display: flex;
  height: 100vh;
}

/* 侧栏通用样式 */
.sidebar-left, .sidebar-right {
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
  border-right: 1px solid #ddd;
  min-width: 150px;
  max-width: 400px;
}

.sidebar-right {
  border-right: none;
  border-left: 1px solid #ddd;
}

.sidebar-header {
  padding: 12px;
  font-weight: bold;
  border-bottom: 1px solid #ddd;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.sidebar-footer {
  padding: 8px;
  border-top: 1px solid #ddd;
  display: flex;
  gap: 4px;
}

.sidebar-footer button {
  flex: 1;
  padding: 6px 10px;
  cursor: pointer;
}

/* 拖动分界线 */
.divider-left, .divider-right {
  width: 6px;
  background: #e0e0e0;
  cursor: col-resize;
  flex-shrink: 0;
}

.divider-left:hover, .divider-right:hover {
  background: #bdbdbd;
}

/* 中间聊天区域 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 300px;
  background: #fff;
}

.chat-header {
  padding: 12px;
  font-weight: bold;
  border-bottom: 1px solid #ddd;
  background: #f9f9f9;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.chat-input-area {
  padding: 12px;
  border-top: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

#chat-input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  resize: none;
  font-family: inherit;
}

.chat-controls {
  display: flex;
  gap: 8px;
}

.chat-controls button {
  padding: 8px 16px;
  cursor: pointer;
}

.chat-controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 消息样式 */
.message {
  margin-bottom: 16px;
}

.message-user {
  background: #e3f2fd;
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 8px;
}

.message-assistant {
  background: #f5f5f5;
  padding: 10px 14px;
  border-radius: 8px;
}

.message-meta {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

/* 端点列表样式 */
.endpoint-group {
  margin-bottom: 8px;
}

.group-header {
  padding: 6px 8px;
  background: #e8e8e8;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.group-header:hover {
  background: #ddd;
}

.group-models {
  padding-left: 12px;
  margin-top: 4px;
}

.model-item {
  padding: 4px 8px;
  margin-bottom: 2px;
  cursor: pointer;
  border-radius: 4px;
}

.model-item:hover {
  background: #e0e0e0;
}

.model-item.selected {
  background: #bbdefb;
}

/* 聊天记录列表样式 */
.session-item {
  padding: 8px;
  margin-bottom: 4px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
}

.session-item:hover {
  background: #e0e0e0;
}

.session-item.selected {
  background: #bbdefb;
}

.session-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-time {
  font-size: 11px;
  color: #999;
}

/* 通用按钮 */
button {
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
}

button:hover:not(:disabled) {
  background: #f0f0f0;
}
```

- [ ] **Step 3: 手动测试 - 打开页面确认布局**

操作：在浏览器中打开 `index.html`
预期：看到三栏布局，左中右区域正确显示，分界线可见

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat: 基础HTML结构和CSS三栏布局"
```

---

### Task 2: 实现拖动分界线调整宽度

**Files:**
- Modify: `styles.css`
- Create: `js/ui.js`（部分）

- [ ] **Step 1: 在ui.js中添加拖动功能**

创建 `js/ui.js`:

```javascript
// 拖动分界线调整侧栏宽度
export function initDividers() {
  const dividerLeft = document.getElementById('divider-left');
  const dividerRight = document.getElementById('divider-right');
  const sidebarLeft = document.getElementById('sidebar-left');
  const sidebarRight = document.getElementById('sidebar-right');
  
  let isDragging = false;
  let currentDivider = null;
  let startX = 0;
  let startWidth = 0;
  
  function startDrag(e, divider, sidebar, isLeft) {
    isDragging = true;
    currentDivider = { divider, sidebar, isLeft };
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  
  function doDrag(e) {
    if (!isDragging || !currentDivider) return;
    
    const dx = e.clientX - startX;
    const newWidth = currentDivider.isLeft 
      ? startWidth + dx 
      : startWidth - dx;
    
    // 限制最小和最大宽度
    const minWidth = 150;
    const maxWidth = 400;
    const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    
    currentDivider.sidebar.style.width = clampedWidth + 'px';
  }
  
  function stopDrag() {
    if (isDragging) {
      isDragging = false;
      currentDivider = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }
  
  dividerLeft.addEventListener('mousedown', (e) => {
    startDrag(e, dividerLeft, sidebarLeft, true);
  });
  
  dividerRight.addEventListener('mousedown', (e) => {
    startDrag(e, dividerRight, sidebarRight, false);
  });
  
  document.addEventListener('mousemove', doDrag);
  document.addEventListener('mouseup', stopDrag);
}

// 渲染端点列表（两级分组）
export function renderEndpointList(groups, selectedModelId, onModelSelect, onGroupEdit, onModelEdit) {
  const container = document.getElementById('endpoint-list');
  container.innerHTML = '';
  
  groups.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'endpoint-group';
    
    const headerEl = document.createElement('div');
    headerEl.className = 'group-header';
    headerEl.innerHTML = `
      <span>${group.name}</span>
      <span class="group-toggle">▼</span>
    `;
    headerEl.addEventListener('click', () => {
      const modelsEl = groupEl.querySelector('.group-models');
      const toggleEl = headerEl.querySelector('.group-toggle');
      if (modelsEl.style.display === 'none') {
        modelsEl.style.display = 'block';
        toggleEl.textContent = '▼';
      } else {
        modelsEl.style.display = 'none';
        toggleEl.textContent = '▶';
      }
    });
    
    const modelsEl = document.createElement('div');
    modelsEl.className = 'group-models';
    
    group.models.forEach(model => {
      const modelEl = document.createElement('div');
      modelEl.className = 'model-item';
      if (model.id === selectedModelId) {
        modelEl.classList.add('selected');
      }
      modelEl.textContent = model.name;
      modelEl.addEventListener('click', () => {
        onModelSelect(group.id, model.id);
      });
      modelsEl.appendChild(modelEl);
    });
    
    groupEl.appendChild(headerEl);
    groupEl.appendChild(modelsEl);
    container.appendChild(groupEl);
  });
}

// 渲染聊天记录列表
export function renderSessionList(sessions, selectedSessionId, onSessionSelect) {
  const container = document.getElementById('session-list');
  container.innerHTML = '';
  
  sessions.sort((a, b) => b.createdAt - a.createdAt);
  
  sessions.forEach(session => {
    const sessionEl = document.createElement('div');
    sessionEl.className = 'session-item';
    if (session.id === selectedSessionId) {
      sessionEl.classList.add('selected');
    }
    
    const titleEl = document.createElement('div');
    titleEl.className = 'session-title';
    titleEl.textContent = session.title || '新会话';
    
    const timeEl = document.createElement('div');
    timeEl.className = 'session-time';
    timeEl.textContent = new Date(session.createdAt).toLocaleString('zh-CN');
    
    sessionEl.appendChild(titleEl);
    sessionEl.appendChild(timeEl);
    sessionEl.addEventListener('click', () => {
      onSessionSelect(session.id);
    });
    
    container.appendChild(sessionEl);
  });
}

// 渲染聊天消息
export function renderMessages(messages, groups) {
  const container = document.getElementById('chat-messages');
  container.innerHTML = '';
  
  messages.forEach(msg => {
    const msgEl = document.createElement('div');
    msgEl.className = 'message';
    
    if (msg.role === 'user') {
      const userEl = document.createElement('div');
      userEl.className = 'message-user';
      userEl.textContent = msg.content;
      msgEl.appendChild(userEl);
    } else {
      const metaEl = document.createElement('div');
      metaEl.className = 'message-meta';
      if (msg.endpointGroupId && msg.modelId) {
        const group = groups.find(g => g.id === msg.endpointGroupId);
        const model = group?.models.find(m => m.id === msg.modelId);
        metaEl.textContent = model ? `${group?.name} / ${model.name}` : '未知模型';
      }
      msgEl.appendChild(metaEl);
      
      const assistantEl = document.createElement('div');
      assistantEl.className = 'message-assistant';
      assistantEl.textContent = msg.content;
      msgEl.appendChild(assistantEl);
    }
    
    container.appendChild(msgEl);
  });
  
  // 滚动到底部
  container.scrollTop = container.scrollHeight;
}

// 追加单条消息（用于流式显示）
export function appendMessage(role, content, meta = null) {
  const container = document.getElementById('chat-messages');
  
  const msgEl = document.createElement('div');
  msgEl.className = 'message';
  
  if (role === 'user') {
    const userEl = document.createElement('div');
    userEl.className = 'message-user';
    userEl.textContent = content;
    msgEl.appendChild(userEl);
  } else {
    if (meta) {
      const metaEl = document.createElement('div');
      metaEl.className = 'message-meta';
      metaEl.textContent = meta;
      msgEl.appendChild(metaEl);
    }
    
    const assistantEl = document.createElement('div');
    assistantEl.className = 'message-assistant';
    assistantEl.id = 'streaming-message';
    assistantEl.textContent = content;
    msgEl.appendChild(assistantEl);
  }
  
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
  
  return msgEl;
}

// 更新流式消息内容
export function updateStreamingMessage(content) {
  const el = document.getElementById('streaming-message');
  if (el) {
    el.textContent = content;
    el.parentElement.parentElement.scrollTop = el.parentElement.parentElement.scrollHeight;
  }
}

// 完成流式消息（移除临时ID）
export function finishStreamingMessage() {
  const el = document.getElementById('streaming-message');
  if (el) {
    el.removeAttribute('id');
  }
}

// 更新当前模型显示
export function updateCurrentModel(groupName, modelName) {
  const el = document.getElementById('current-model-name');
  el.textContent = groupName && modelName 
    ? `${groupName} / ${modelName}` 
    : '未选择模型';
}

// 获取输入内容
export function getInputContent() {
  const input = document.getElementById('chat-input');
  return input.value.trim();
}

// 清空输入
export function clearInput() {
  const input = document.getElementById('chat-input');
  input.value = '';
}

// 设置按钮状态
export function setButtonState(sendDisabled, stopDisabled, regenerateDisabled) {
  document.getElementById('btn-send').disabled = sendDisabled;
  document.getElementById('btn-stop').disabled = stopDisabled;
  document.getElementById('btn-regenerate').disabled = regenerateDisabled;
}
```

- [ ] **Step 2: 创建空的main.js入口**

创建 `js/main.js`:

```javascript
import { initDividers } from './ui.js';

// 初始化
initDividers();
```

- [ ] **Step 3: 手动测试 - 拖动分界线**

操作：打开页面，拖动左右分界线
预期：侧栏宽度随之调整，有最小/最大宽度限制

- [ ] **Step 4: Commit**

```bash
git add js/ui.js js/main.js
git commit -m "feat: 实现拖动分界线调整侧栏宽度"
```

---

### Task 3: 实现数据存储模块（store.js）

**Files:**
- Create: `js/store.js`

- [ ] **Step 1: 创建store.js基础结构**

创建 `js/store.js`:

```javascript
// File System Access API 封装
let directoryHandle = null;
let endpointsData = null;
let sessionsCache = new Map();

// 生成UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 选择存储目录
export async function selectDirectory() {
  try {
    directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await ensureDirectoryStructure();
    await loadEndpoints();
    await loadSessionsIndex();
    return true;
  } catch (err) {
    console.error('选择目录失败:', err);
    return false;
  }
}

// 确保目录结构存在
async function ensureDirectoryStructure() {
  try {
    await directoryHandle.getDirectoryHandle('sessions', { create: true });
  } catch (err) {
    console.error('创建sessions目录失败:', err);
  }
}

// 加载端点配置
export async function loadEndpoints() {
  try {
    const fileHandle = await directoryHandle.getFileHandle('endpoints.json', { create: true });
    const file = await fileHandle.getFile();
    const text = await file.text();
    endpointsData = text ? JSON.parse(text) : { groups: [] };
    return endpointsData;
  } catch (err) {
    console.error('加载端点配置失败:', err);
    endpointsData = { groups: [] };
    return endpointsData;
  }
}

// 保存端点配置
export async function saveEndpoints() {
  try {
    const fileHandle = await directoryHandle.getFileHandle('endpoints.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(endpointsData, null, 2));
    await writable.close();
    return true;
  } catch (err) {
    console.error('保存端点配置失败:', err);
    return false;
  }
}

// 获取所有端点组
export function getGroups() {
  return endpointsData?.groups || [];
}

// 新增端点组
export async function addGroup(name, baseUrl, style, key) {
  const group = {
    id: generateUUID(),
    name,
    baseUrl,
    style, // 'openai' | 'claude' | 'gemini'
    key,
    models: []
  };
  endpointsData.groups.push(group);
  await saveEndpoints();
  return group;
}

// 修改端点组
export async function updateGroup(groupId, updates) {
  const group = endpointsData.groups.find(g => g.id === groupId);
  if (group) {
    Object.assign(group, updates);
    await saveEndpoints();
    return group;
  }
  return null;
}

// 删除端点组
export async function deleteGroup(groupId) {
  const index = endpointsData.groups.findIndex(g => g.id === groupId);
  if (index >= 0) {
    endpointsData.groups.splice(index, 1);
    await saveEndpoints();
    return true;
  }
  return false;
}

// 新增模型
export async function addModel(groupId, modelName) {
  const group = endpointsData.groups.find(g => g.id === groupId);
  if (group) {
    const model = {
      id: generateUUID(),
      name: modelName
    };
    group.models.push(model);
    await saveEndpoints();
    return model;
  }
  return null;
}

// 修改模型
export async function updateModel(groupId, modelId, newName) {
  const group = endpointsData.groups.find(g => g.id === groupId);
  const model = group?.models.find(m => m.id === modelId);
  if (model) {
    model.name = newName;
    await saveEndpoints();
    return model;
  }
  return null;
}

// 删除模型
export async function deleteModel(groupId, modelId) {
  const group = endpointsData.groups.find(g => g.id === groupId);
  if (group) {
    const index = group.models.findIndex(m => m.id === modelId);
    if (index >= 0) {
      group.models.splice(index, 1);
      await saveEndpoints();
      return true;
    }
  }
  return false;
}

// 获取模型信息
export function getModel(groupId, modelId) {
  const group = endpointsData.groups.find(g => g.id === groupId);
  return group?.models.find(m => m.id === modelId);
}

// 获取组信息
export function getGroup(groupId) {
  return endpointsData.groups.find(g => g.id === groupId);
}

// 加载会话索引
export async function loadSessionsIndex() {
  try {
    const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
    sessionsCache.clear();
    
    for (const [name, handle] of sessionsDir.entries()) {
      if (handle.kind === 'file' && name.endsWith('.json')) {
        const file = await handle.getFile();
        const text = await file.text();
        const session = JSON.parse(text);
        sessionsCache.set(session.id, session);
      }
    }
    
    return Array.from(sessionsCache.values());
  } catch (err) {
    console.error('加载会话索引失败:', err);
    return [];
  }
}

// 获取所有会话
export function getAllSessions() {
  return Array.from(sessionsCache.values());
}

// 新建会话
export async function createSession(firstMessage = null) {
  const session = {
    id: generateUUID(),
    title: firstMessage ? firstMessage.slice(0, 20) : '新会话',
    createdAt: Date.now(),
    messages: []
  };
  
  if (firstMessage) {
    session.messages.push({ role: 'user', content: firstMessage });
  }
  
  sessionsCache.set(session.id, session);
  await saveSession(session);
  return session;
}

// 加载单个会话
export async function loadSession(sessionId) {
  if (sessionsCache.has(sessionId)) {
    return sessionsCache.get(sessionId);
  }
  
  try {
    const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
    const fileHandle = await sessionsDir.getFileHandle(`${sessionId}.json`);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const session = JSON.parse(text);
    sessionsCache.set(session.id, session);
    return session;
  } catch (err) {
    console.error('加载会话失败:', err);
    return null;
  }
}

// 保存会话
export async function saveSession(session) {
  try {
    const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
    const fileHandle = await sessionsDir.getFileHandle(`${session.id}.json`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(session, null, 2));
    await writable.close();
    return true;
  } catch (err) {
    console.error('保存会话失败:', err);
    return false;
  }
}

// 添加消息到会话
export async function addMessage(sessionId, role, content, endpointGroupId = null, modelId = null) {
  const session = sessionsCache.get(sessionId);
  if (session) {
    const message = { role, content };
    if (role === 'assistant' && endpointGroupId && modelId) {
      message.endpointGroupId = endpointGroupId;
      message.modelId = modelId;
    }
    session.messages.push(message);
    
    // 更新标题（第一条用户消息）
    if (role === 'user' && session.messages.filter(m => m.role === 'user').length === 1) {
      session.title = content.slice(0, 20);
    }
    
    await saveSession(session);
    return message;
  }
  return null;
}

// 获取会话
export function getSession(sessionId) {
  return sessionsCache.get(sessionId);
}

// 删除会话
export async function deleteSession(sessionId) {
  try {
    sessionsCache.delete(sessionId);
    const sessionsDir = await directoryHandle.getDirectoryHandle('sessions');
    await sessionsDir.removeEntry(`${sessionId}.json`);
    return true;
  } catch (err) {
    console.error('删除会话失败:', err);
    return false;
  }
}

// 检查是否已选择目录
export function hasDirectory() {
  return directoryHandle !== null;
}
```

- [ ] **Step 2: 手动测试 - 目录选择**

操作：修改main.js临时测试代码，打开页面后点击选择目录
预期：弹出目录选择对话框，选择后无报错

临时测试代码（添加到main.js）：
```javascript
import { selectDirectory, getGroups } from './store.js';

document.body.addEventListener('click', async () => {
  if (!await selectDirectory()) {
    console.log('未选择目录');
    return;
  }
  console.log('已选择目录，端点组:', getGroups());
}, { once: true });
```

- [ ] **Step 3: Commit**

```bash
git add js/store.js
git commit -m "feat: 实现数据存储模块（File System Access API）"
```

---

### Task 4: 实现API调用模块（api.js）

**Files:**
- Create: `js/api.js`

- [ ] **Step 1: 创建api.js - OpenAI风格适配**

创建 `js/api.js`:

```javascript
// AbortController 用于停止生成
let currentAbortController = null;

// 停止当前请求
export function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

// 检查是否正在生成
export function isGenerating() {
  return currentAbortController !== null;
}

// OpenAI风格API调用
async function callOpenAI(baseUrl, apiKey, model, messages, onChunk) {
  const url = `${baseUrl}/v1/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
  const body = {
    model,
    messages,
    stream: true
  };
  
  currentAbortController = new AbortController();
  
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: currentAbortController.signal
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API错误: ${response.status} - ${error}`);
  }
  
  // 处理流式响应
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
            onChunk(fullContent);
          }
        } catch (e) {
          // 解析错误，忽略
        }
      }
    }
  }
  
  currentAbortController = null;
  return fullContent;
}

// Claude风格API调用
async function callClaude(baseUrl, apiKey, model, messages, onChunk) {
  const url = `${baseUrl}/v1/messages`;
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  };
  
  // 转换消息格式
  const claudeMessages = messages.map(m => ({
    role: m.role,
    content: m.content
  }));
  
  const body = {
    model,
    max_tokens: 4096,
    messages: claudeMessages,
    stream: true
  };
  
  currentAbortController = new AbortController();
  
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: currentAbortController.signal
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API错误: ${response.status} - ${error}`);
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        
        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta' && json.delta?.text) {
            fullContent += json.delta.text;
            onChunk(fullContent);
          }
        } catch (e) {
          // 解析错误，忽略
        }
      }
    }
  }
  
  currentAbortController = null;
  return fullContent;
}

// Gemini风格API调用
async function callGemini(baseUrl, apiKey, model, messages, onChunk) {
  const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
  
  // 转换消息格式
  const contents = [];
  let currentRole = null;
  let currentParts = [];
  
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'user' : 'model';
    if (currentRole !== role) {
      if (currentRole !== null) {
        contents.push({ role: currentRole, parts: currentParts });
      }
      currentRole = role;
      currentParts = [];
    }
    currentParts.push({ text: msg.content });
  }
  if (currentRole !== null) {
    contents.push({ role: currentRole, parts: currentParts });
  }
  
  const body = { contents };
  
  currentAbortController = new AbortController();
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: currentAbortController.signal
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API错误: ${response.status} - ${error}`);
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullContent += text;
            onChunk(fullContent);
          }
        } catch (e) {
          // 解析错误，忽略
        }
      }
    }
  }
  
  currentAbortController = null;
  return fullContent;
}

// 统一API调用接口
export async function callAPI(style, baseUrl, apiKey, model, messages, onChunk) {
  switch (style) {
    case 'openai':
      return await callOpenAI(baseUrl, apiKey, model, messages, onChunk);
    case 'claude':
      return await callClaude(baseUrl, apiKey, model, messages, onChunk);
    case 'gemini':
      return await callGemini(baseUrl, apiKey, model, messages, onChunk);
    default:
      throw new Error(`不支持的接口风格: ${style}`);
  }
}

// 非流式调用（备用）
export async function callAPISync(style, baseUrl, apiKey, model, messages) {
  return await callAPI(style, baseUrl, apiKey, model, messages, () => {});
}
```

- [ ] **Step 2: 手动测试 - API调用**

操作：配置一个真实端点，发送消息测试流式响应
预期：消息流式显示在聊天区域

- [ ] **Step 3: Commit**

```bash
git add js/api.js
git commit -m "feat: 实现API调用模块（OpenAI/Claude/Gemini流式适配）"
```

---

### Task 5: 整合main.js实现完整功能

**Files:**
- Modify: `js/main.js`
- Modify: `js/ui.js`（添加编辑弹窗）

- [ ] **Step 1: 添加编辑弹窗到ui.js**

在 `js/ui.js` 末尾添加：

```javascript
// 显示编辑端点组弹窗
export function showEditGroupDialog(group = null, onSave, onDelete = null) {
  const existing = document.getElementById('edit-dialog');
  if (existing) existing.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'edit-dialog';
  dialog.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    z-index: 1000; min-width: 300px;
  `;
  
  dialog.innerHTML = `
    <h3 style="margin-bottom: 16px;">${group ? '编辑端点组' : '新增端点组'}</h3>
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <label>名称: <input id="dialog-group-name" value="${group?.name || ''}" style="width: 100%; padding: 6px;"></label>
      <label>Base URL: <input id="dialog-group-url" value="${group?.baseUrl || ''}" style="width: 100%; padding: 6px;"></label>
      <label>接口风格:
        <select id="dialog-group-style" style="width: 100%; padding: 6px;">
          <option value="openai" ${group?.style === 'openai' ? 'selected' : ''}>OpenAI</option>
          <option value="claude" ${group?.style === 'claude' ? 'selected' : ''}>Claude</option>
          <option value="gemini" ${group?.style === 'gemini' ? 'selected' : ''}>Gemini</option>
        </select>
      </label>
      <label>API Key: <input id="dialog-group-key" type="password" value="${group?.key || ''}" style="width: 100%; padding: 6px;"></label>
    </div>
    <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end;">
      ${group && onDelete ? '<button id="dialog-delete" style="background: #ffebee;">删除</button>' : ''}
      <button id="dialog-cancel">取消</button>
      <button id="dialog-save" style="background: #e3f2fd;">保存</button>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  document.getElementById('dialog-cancel').onclick = () => dialog.remove();
  document.getElementById('dialog-save').onclick = () => {
    const name = document.getElementById('dialog-group-name').value.trim();
    const baseUrl = document.getElementById('dialog-group-url').value.trim();
    const style = document.getElementById('dialog-group-style').value;
    const key = document.getElementById('dialog-group-key').value.trim();
    
    if (!name || !baseUrl || !key) {
      alert('请填写完整信息');
      return;
    }
    
    onSave({ name, baseUrl, style, key });
    dialog.remove();
  };
  
  if (group && onDelete) {
    document.getElementById('dialog-delete').onclick = () => {
      if (confirm('确定删除该端点组及其所有模型？')) {
        onDelete();
        dialog.remove();
      }
    };
  }
}

// 显示编辑模型弹窗
export function showEditModelDialog(groupId, model = null, onSave, onDelete = null) {
  const existing = document.getElementById('edit-dialog');
  if (existing) existing.remove();
  
  const dialog = document.createElement('div');
  dialog.id = 'edit-dialog';
  dialog.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    z-index: 1000; min-width: 250px;
  `;
  
  dialog.innerHTML = `
    <h3 style="margin-bottom: 16px;">${model ? '编辑模型' : '新增模型'}</h3>
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <label>模型名: <input id="dialog-model-name" value="${model?.name || ''}" style="width: 100%; padding: 6px;"></label>
    </div>
    <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: flex-end;">
      ${model && onDelete ? '<button id="dialog-delete" style="background: #ffebee;">删除</button>' : ''}
      <button id="dialog-cancel">取消</button>
      <button id="dialog-save" style="background: #e3f2fd;">保存</button>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  document.getElementById('dialog-cancel').onclick = () => dialog.remove();
  document.getElementById('dialog-save').onclick = () => {
    const name = document.getElementById('dialog-model-name').value.trim();
    if (!name) {
      alert('请输入模型名');
      return;
    }
    onSave(name);
    dialog.remove();
  };
  
  if (model && onDelete) {
    document.getElementById('dialog-delete').onclick = () => {
      if (confirm('确定删除该模型？')) {
        onDelete();
        dialog.remove();
      }
    };
  }
}

// 显示选择目录提示
export function showDirectoryPrompt() {
  const existing = document.getElementById('directory-prompt');
  if (existing) existing.remove();
  
  const prompt = document.createElement('div');
  prompt.id = 'directory-prompt';
  prompt.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    z-index: 1000; text-align: center;
  `;
  prompt.innerHTML = `
    <h3 style="margin-bottom: 12px;">选择存储目录</h3>
    <p style="margin-bottom: 16px; color: #666;">请选择一个目录来存储端点配置和聊天记录</p>
    <button id="btn-select-dir" style="padding: 10px 20px; background: #e3f2fd;">选择目录</button>
  `;
  document.body.appendChild(prompt);
  
  return prompt;
}

export function hideDirectoryPrompt() {
  const prompt = document.getElementById('directory-prompt');
  if (prompt) prompt.remove();
}
```

- [ ] **Step 2: 完整的main.js**

重写 `js/main.js`:

```javascript
import { initDividers, renderEndpointList, renderSessionList, renderMessages, 
         appendMessage, updateStreamingMessage, finishStreamingMessage,
         updateCurrentModel, getInputContent, clearInput, setButtonState,
         showEditGroupDialog, showEditModelDialog, showDirectoryPrompt, hideDirectoryPrompt } from './ui.js';
import { selectDirectory, getGroups, addGroup, updateGroup, deleteGroup,
         addModel, updateModel, deleteModel, getGroup, getModel,
         getAllSessions, createSession, loadSession, addMessage, hasDirectory } from './store.js';
import { callAPI, stopGeneration, isGenerating } from './api.js';

// 状态
let currentSession = null;
let currentGroupId = null;
let currentModelId = null;
let lastUserMessage = null; // 用于重新生成

// 初始化
async function init() {
  initDividers();
  
  if (!hasDirectory()) {
    const prompt = showDirectoryPrompt();
    document.getElementById('btn-select-dir').onclick = async () => {
      const success = await selectDirectory();
      hideDirectoryPrompt();
      if (success) {
        await refreshUI();
      }
    };
  } else {
    await refreshUI();
  }
  
  // 绑定按钮事件
  document.getElementById('btn-add-group').onclick = handleAddGroup;
  document.getElementById('btn-add-model').onclick = handleAddModel;
  document.getElementById('btn-send').onclick = handleSend;
  document.getElementById('btn-stop').onclick = handleStop;
  document.getElementById('btn-regenerate').onclick = handleRegenerate;
}

// 刷新UI
async function refreshUI() {
  const groups = getGroups();
  renderEndpointList(groups, currentModelId, handleModelSelect, handleGroupEdit, handleModelEdit);
  
  const sessions = getAllSessions();
  renderSessionList(sessions, currentSession?.id, handleSessionSelect);
  
  if (currentSession) {
    renderMessages(currentSession.messages, groups);
  } else {
    document.getElementById('chat-messages').innerHTML = '';
  }
  
  updateCurrentModelDisplay();
}

// 更新当前模型显示
function updateCurrentModelDisplay() {
  if (currentGroupId && currentModelId) {
    const group = getGroup(currentGroupId);
    const model = getModel(currentGroupId, currentModelId);
    updateCurrentModel(group?.name, model?.name);
  } else {
    updateCurrentModel(null, null);
  }
}

// 选择模型
async function handleModelSelect(groupId, modelId) {
  currentGroupId = groupId;
  currentModelId = modelId;
  updateCurrentModelDisplay();
  
  // 刷新端点列表显示选中状态
  renderEndpointList(getGroups(), currentModelId, handleModelSelect, handleGroupEdit, handleModelEdit);
}

// 选择会话
async function handleSessionSelect(sessionId) {
  currentSession = await loadSession(sessionId);
  
  // 恢复最后一条助手消息的模型
  const lastAssistant = currentSession.messages.filter(m => m.role === 'assistant').pop();
  if (lastAssistant?.endpointGroupId && lastAssistant?.modelId) {
    currentGroupId = lastAssistant.endpointGroupId;
    currentModelId = lastAssistant.modelId;
  }
  
  await refreshUI();
  setButtonState(false, true, currentSession.messages.length > 0);
}

// 新增端点组
function handleAddGroup() {
  showEditGroupDialog(null, async (data) => {
    await addGroup(data.name, data.baseUrl, data.style, data.key);
    await refreshUI();
  });
}

// 编辑端点组（双击触发）
function handleGroupEdit(groupId) {
  const group = getGroup(groupId);
  showEditGroupDialog(group, async (data) => {
    await updateGroup(groupId, data);
    await refreshUI();
  }, async () => {
    await deleteGroup(groupId);
    if (currentGroupId === groupId) {
      currentGroupId = null;
      currentModelId = null;
    }
    await refreshUI();
  });
}

// 新增模型
function handleAddModel() {
  if (!currentGroupId) {
    alert('请先选择一个端点组');
    return;
  }
  showEditModelDialog(currentGroupId, null, async (name) => {
    await addModel(currentGroupId, name);
    await refreshUI();
  });
}

// 编辑模型（双击触发）
function handleModelEdit(groupId, modelId) {
  const model = getModel(groupId, modelId);
  showEditModelDialog(groupId, model, async (name) => {
    await updateModel(groupId, modelId, name);
    await refreshUI();
  }, async () => {
    await deleteModel(groupId, modelId);
    if (currentModelId === modelId) {
      currentModelId = null;
    }
    await refreshUI();
  });
}

// 发送消息
async function handleSend() {
  const content = getInputContent();
  if (!content) return;
  
  if (!currentGroupId || !currentModelId) {
    alert('请先选择一个模型');
    return;
  }
  
  // 创建或使用现有会话
  if (!currentSession) {
    currentSession = await createSession(content);
  } else {
    await addMessage(currentSession.id, 'user', content);
  }
  
  lastUserMessage = content;
  clearInput();
  setButtonState(true, false, true);
  
  // 显示用户消息
  const groups = getGroups();
  renderMessages(currentSession.messages, groups);
  
  // 凇备调用API
  const group = getGroup(currentGroupId);
  const model = getModel(currentGroupId, currentModelId);
  
  // 显示助手消息占位
  appendMessage('assistant', '', `${group.name} / ${model.name}`);
  
  try {
    const messages = currentSession.messages.map(m => ({
      role: m.role,
      content: m.content
    }));
    
    const fullResponse = await callAPI(
      group.style,
      group.baseUrl,
      group.key,
      model.name,
      messages,
      updateStreamingMessage
    );
    
    finishStreamingMessage();
    await addMessage(currentSession.id, 'assistant', fullResponse, currentGroupId, currentModelId);
    
    // 刷新会话标题
    currentSession = await loadSession(currentSession.id);
    
    setButtonState(false, true, true);
    await refreshUI();
    
  } catch (err) {
    finishStreamingMessage();
    if (err.name === 'AbortError') {
      // 用户停止，不显示错误
      setButtonState(false, true, true);
    } else {
      alert(`API调用失败: ${err.message}`);
      setButtonState(false, true, true);
    }
  }
}

// 停止生成
function handleStop() {
  stopGeneration();
  setButtonState(false, true, true);
}

// 重新生成
async function handleRegenerate() {
  if (!lastUserMessage || !currentGroupId || !currentModelId) return;
  
  // 删除最后一条助手消息
  if (currentSession && currentSession.messages.length > 0) {
    const lastMsg = currentSession.messages[currentSession.messages.length - 1];
    if (lastMsg.role === 'assistant') {
      currentSession.messages.pop();
    }
  }
  
  // 重新发送
  setButtonState(true, false, true);
  
  const groups = getGroups();
  renderMessages(currentSession.messages, groups);
  
  const group = getGroup(currentGroupId);
  const model = getModel(currentGroupId, currentModelId);
  
  appendMessage('assistant', '', `${group.name} / ${model.name}`);
  
  try {
    const messages = currentSession.messages.map(m => ({
      role: m.role,
      content: m.content
    }));
    
    const fullResponse = await callAPI(
      group.style,
      group.baseUrl,
      group.key,
      model.name,
      messages,
      updateStreamingMessage
    );
    
    finishStreamingMessage();
    await addMessage(currentSession.id, 'assistant', fullResponse, currentGroupId, currentModelId);
    
    setButtonState(false, true, true);
    await refreshUI();
    
  } catch (err) {
    finishStreamingMessage();
    if (err.name !== 'AbortError') {
      alert(`API调用失败: ${err.message}`);
    }
    setButtonState(false, true, true);
  }
}

// 启动
init();
```

- [ ] **Step 3: 更新ui.js添加双击编辑事件**

在 `renderEndpointList` 函数中，为 group-header 和 model-item 添加双击事件：

修改 `js/ui.js` 中 `renderEndpointList` 函数，添加双击编辑：

```javascript
// 渲染端点列表（两级分组）
export function renderEndpointList(groups, selectedModelId, onModelSelect, onGroupEdit, onModelEdit) {
  const container = document.getElementById('endpoint-list');
  container.innerHTML = '';
  
  groups.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'endpoint-group';
    
    const headerEl = document.createElement('div');
    headerEl.className = 'group-header';
    headerEl.innerHTML = `
      <span>${group.name}</span>
      <span class="group-toggle">▼</span>
    `;
    
    // 单击展开/折叠
    headerEl.addEventListener('click', () => {
      const modelsEl = groupEl.querySelector('.group-models');
      const toggleEl = headerEl.querySelector('.group-toggle');
      if (modelsEl.style.display === 'none') {
        modelsEl.style.display = 'block';
        toggleEl.textContent = '▼';
      } else {
        modelsEl.style.display = 'none';
        toggleEl.textContent = '▶';
      }
    });
    
    // 双击编辑组
    headerEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      onGroupEdit(group.id);
    });
    
    const modelsEl = document.createElement('div');
    modelsEl.className = 'group-models';
    
    group.models.forEach(model => {
      const modelEl = document.createElement('div');
      modelEl.className = 'model-item';
      if (model.id === selectedModelId) {
        modelEl.classList.add('selected');
      }
      modelEl.textContent = model.name;
      
      // 单击选择模型
      modelEl.addEventListener('click', () => {
        onModelSelect(group.id, model.id);
      });
      
      // 双击编辑模型
      modelEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        onModelEdit(group.id, model.id);
      });
      
      modelsEl.appendChild(modelEl);
    });
    
    groupEl.appendChild(headerEl);
    groupEl.appendChild(modelsEl);
    container.appendChild(groupEl);
  });
}
```

- [ ] **Step 4: 手动测试 - 完整功能**

操作：
1. 打开页面，选择存储目录
2. 新增端点组，填写配置
3. 新增模型
4. 选择模型，发送消息，确认流式显示
5. 测试停止生成、重新生成
6. 切换模型，继续对话
7. 选择聊天记录，加载历史会话

预期：所有功能正常工作

- [ ] **Step 5: Commit**

```bash
git add js/main.js js/ui.js
git commit -m "feat: 整合完整功能，实现端点管理、聊天、会话切换"
```

---

### Task 6: 最终测试和修复

**Files:**
- Modify: `index.html`（如需要）
- Modify: `styles.css`（如需要）
- Modify: `js/*.js`（修复问题）

- [ ] **Step 1: 完整功能测试**

测试清单：
- [ ] 目录选择和初始化
- [ ] 新增/编辑/删除端点组
- [ ] 新增/编辑/删除模型
- [ ] 选择模型发送消息
- [ ] 流式显示正常
- [ ] 停止生成功能
- [ ] 重新生成功能
- [ ] 会话列表显示正确
- [ ] 切换会话加载历史
- [ ] 同会话内切换模型
- [ ] 数据持久化（刷新页面后数据保留）
- [ ] 拖动分界线调整宽度

- [ ] **Step 2: 修复发现的问题**

根据测试结果修复bug

- [ ] **Step 3: 最终Commit**

```bash
git add -A
git commit -m "feat: 完成聊天模型端点管理器MVP版本"
```

---

## Self-Review Checklist

**Spec覆盖检查：**
- ✅ 三栏布局 → Task 1
- ✅ 拖动调整宽度 → Task 2
- ✅ 端点两级分组 → Task 3, Task 5
- ✅ 新增/修改/删除端点/模型 → Task 5
- ✅ 流式聊天 → Task 4, Task 5
- ✅ 停止生成 → Task 4, Task 5
- ✅ 重新生成 → Task 5
- ✅ 会话内切换模型 → Task 5
- ✅ File System Access API存储 → Task 3
- ✅ OpenAI/Claude/Gemini适配 → Task 4
- ✅ 聊天记录列表 → Task 5
- ✅ 消息纯文本显示 → Task 1 CSS
- ✅ 会话标题截取前20字 → Task 3 store.js

**Placeholder扫描：** 无TBD/TODO/未定义步骤

**类型一致性：** groupId/modelId/sessionId均为UUID字符串，函数调用匹配
# Markdown 渲染实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 回复添加 Markdown 渲染和代码块复制按钮功能

**Architecture:** 引入 marked.js 解析 Markdown，highlight.js 实现代码高亮（GitHub Light 主题）。只渲染 AI 回复，用户消息保持纯文本。代码块右上角添加复制按钮。

**Tech Stack:** marked.js (CDN), highlight.js (CDN), GitHub Light 主题

---

## 文件结构

**修改文件：**
- `kuai-lian-ai.html` — 单文件应用，所有改动在此文件

**改动位置：**
- CDN 引入：`<head>` 标签末尾（约第7行 `<style>` 前）
- CSS 样式：`<style>` 标签内，`.message-assistant` 样式附近（约第588行）
- 渲染函数：`renderSingleModelResponse()` (约第2799行), `renderMultiModelResponse()` (约第2835行)
- 新增辅助函数：`renderMarkdown()` (插入在 renderMessages 附近)

---

### Task 1: 引入 CDN 依赖

**Files:**
- Modify: `kuai-lian-ai.html` 第6-7行之间

- [ ] **Step 1: 在 `<head>` 中添加 CDN 引入**

在 `<title>快连AI</title>` 之后、`<style>` 之前添加：

```html
  <!-- Markdown 渲染 -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js"></script>
  <!-- 代码高亮 -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
```

---

### Task 2: 添加 Markdown 样式

**Files:**
- Modify: `kuai-lian-ai.html` CSS 部分，在 `.message-assistant` 后面

- [ ] **Step 1: 在 `.message-assistant` 样式块后添加 Markdown 渲染样式**

找到 `.message-assistant { ... }` 样式块（约第588行），在其闭合 `}` 后添加：

```css

/* ========== Markdown 渲染样式 ========== */
.message-assistant pre {
  background: #f6f8fa;
  border-radius: 6px;
  padding: 12px 16px;
  margin: 8px 0;
  overflow-x: auto;
  position: relative;
}

.message-assistant code {
  font-family: 'Consolas', 'Monaco', 'Menlo', monospace;
  font-size: 13px;
}

.message-assistant pre code {
  background: transparent;
  padding: 0;
}

.message-assistant p code {
  background: #f6f8fa;
  padding: 2px 6px;
  border-radius: 4px;
}

.message-assistant ul,
.message-assistant ol {
  margin: 8px 0;
  padding-left: 24px;
}

.message-assistant li {
  margin: 4px 0;
}

.message-assistant h1,
.message-assistant h2,
.message-assistant h3,
.message-assistant h4 {
  margin: 16px 0 8px;
  font-weight: 600;
}

.message-assistant h1 { font-size: 1.5em; }
.message-assistant h2 { font-size: 1.3em; }
.message-assistant h3 { font-size: 1.1em; }

.message-assistant blockquote {
  border-left: 4px solid var(--border-default);
  margin: 8px 0;
  padding-left: 16px;
  color: var(--text-secondary);
}

.message-assistant table {
  border-collapse: collapse;
  margin: 8px 0;
}

.message-assistant th,
.message-assistant td {
  border: 1px solid var(--border-subtle);
  padding: 8px 12px;
}

.message-assistant th {
  background: var(--bg-muted);
  font-weight: 600;
}

.message-assistant a {
  color: var(--accent-primary);
  text-decoration: none;
}

.message-assistant a:hover {
  text-decoration: underline;
}

/* 代码块复制按钮 */
.code-copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.code-copy-btn:hover {
  opacity: 1;
  background: var(--bg-hover);
}

.code-copy-btn.copy-success {
  opacity: 1;
  color: var(--success);
  border-color: var(--success);
}
```

---

### Task 3: 创建 renderMarkdown 辅助函数

**Files:**
- Modify: `kuai-lian-ai.html` JavaScript 部分，在 `renderMessages` 函数前

- [ ] **Step 1: 在 renderMessages 函数前添加 renderMarkdown 函数**

找到 `function renderMessages(messages, groups, onCopy)` （约第2748行），在其前面添加：

```javascript
function renderMarkdown(text) {
  if (!text) return '';
  // 配置 marked
  marked.setOptions({
    breaks: true,      // 支持换行
    gfm: true          // GitHub Flavored Markdown
  });
  const html = marked.parse(text);
  return html;
}

function addCodeCopyButtons(container) {
  const codeBlocks = container.querySelectorAll('pre code');
  codeBlocks.forEach(codeEl => {
    const preEl = codeEl.parentElement;
    // 创建复制按钮
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.innerHTML = SVG.copy;
    copyBtn.title = '复制代码';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(codeEl.textContent).then(() => {
        copyBtn.innerHTML = '✓';
        copyBtn.classList.add('copy-success');
        setTimeout(() => {
          copyBtn.innerHTML = SVG.copy;
          copyBtn.classList.remove('copy-success');
        }, 1500);
      });
    };
    preEl.appendChild(copyBtn);
  });
  // 高亮代码
  container.querySelectorAll('pre code').forEach(block => {
    hljs.highlightElement(block);
  });
}
```

---

### Task 4: 修改 renderSingleModelResponse

**Files:**
- Modify: `kuai-lian-ai.html` 第2821-2822行

- [ ] **Step 1: 将 textContent 改为 Markdown 渲染**

找到 `renderSingleModelResponse` 函数中的：

```javascript
  const assistantEl = mk('div', 'message-assistant');
  assistantEl.textContent = msg.content || '';
  msgEl.addChild(assistantEl);
```

改为：

```javascript
  const assistantEl = mk('div', 'message-assistant');
  assistantEl.innerHTML = renderMarkdown(msg.content || '');
  msgEl.addChild(assistantEl);
  addCodeCopyButtons(assistantEl);
```

---

### Task 5: 修改 renderMultiModelResponse

**Files:**
- Modify: `kuai-lian-ai.html` 第2923-2931行

- [ ] **Step 1: 将 card content 的 textContent 改为 Markdown 渲染**

找到 `renderMultiModelResponse` 函数中的：

```javascript
    const content = mk('div', 'response card-content');
    if (r.status === 'failed') {
      content.textContent = '';  // Error shown in meta row, content area empty
    } else if (r.status === 'stopped') {
      content.textContent = r.content || '';  // Show partial content if available
    } else {
      content.textContent = r.content || '';
    }
    card.addChild(content);
```

改为：

```javascript
    const content = mk('div', 'response card-content');
    if (r.status === 'failed') {
      content.innerHTML = '';  // Error shown in meta row, content area empty
    } else {
      content.innerHTML = renderMarkdown(r.content || '');
      addCodeCopyButtons(content);
    }
    card.addChild(content);
```

---

### Task 6: 更新版本号

**Files:**
- Modify: `kuai-lian-ai.html`

- [ ] **Step 1: 找到版本号并更新**

搜索版本号位置（可能在文件开头注释或变量定义中），将版本号递增。

若版本格式为 `vX.Y.Z`，增加功能时递增 `Y`（如 `v1.2.0` → `v1.3.0`）。

---

### Task 7: 测试验证

- [ ] **Step 1: 打开页面测试基本功能**

用浏览器打开 `kuai-lian-ai.html`，发送包含 Markdown 格式的消息给 AI：
- 代码块（```python 等）
- 列表（- item）
- 标题（## heading）
- 粗体（**text**）
- 链接（[text](url)）

检查渲染效果和代码块复制按钮功能。

- [ ] **Step 2: 提交代码**

```bash
git add kuai-lian-ai.html
git commit -m "feat: AI回复Markdown渲染 + 代码块复制按钮

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
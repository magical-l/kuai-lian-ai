# Thinking Chain Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在LLM回复中区分思考链和正式回答，流式时实时显示思考链，完成后可折叠。

**Architecture:** API层分离thinking/content，渲染层统一展示折叠组件。修改三个callAPI函数解析thinking，修改渲染函数显示折叠区块。

**Tech Stack:** 纯JavaScript + CSS，无外部依赖。单文件HTML应用。

---

## Task 1: CSS样式 - 思考链折叠组件

**Files:**
- Modify: `styles.css`（末尾追加）

- [ ] **Step 1: 添加thinking-block样式**

在 `styles.css` 文件末尾追加以下样式：

```css
/* ========== Thinking Block ========== */
.thinking-block {
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-2);
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  cursor: pointer;
  color: var(--text-muted);
  font-size: 12px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}

.thinking-header:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.thinking-icon {
  font-size: 10px;
  transition: transform var(--transition-fast);
  width: 12px;
  text-align: center;
}

.thinking-block.collapsed .thinking-icon::before {
  content: "▶";
}

.thinking-block:not(.collapsed) .thinking-icon::before {
  content: "▼";
}

.thinking-label {
  color: var(--text-secondary);
  font-weight: 500;
}

.thinking-duration {
  color: var(--text-muted);
  font-size: 11px;
  margin-left: auto;
}

.thinking-content {
  padding: var(--space-2) var(--space-3);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  border-top: 1px solid var(--border-subtle);
}

.thinking-block.collapsed .thinking-content {
  display: none;
}

/* 流式思考状态 - 实时显示时不折叠 */
.thinking-block.streaming {
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
}

.thinking-block.streaming .thinking-content {
  display: block;
  border-top: none;
}
```

- [ ] **Step 2: 验证CSS语法正确**

检查CSS无语法错误，样式变量引用正确（如 `var(--bg-muted)`）。

- [ ] **Step 3: 提交**

```bash
git add styles.css
git commit -m "style: 添加思考链折叠组件样式"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 2: JavaScript - toggleThinking函数

**Files:**
- Modify: `index.html`（在UI Functions区域，约行95）

- [ ] **Step 1: 添加toggleThinking函数**

在 `initDividers()` 函数之后（约行164），添加新函数：

```javascript
// ========== Thinking Block Toggle ==========

function toggleThinking(headerEl) {
  const block = headerEl.closest('.thinking-block');
  if (!block) return;
  
  const isCollapsed = block.classList.contains('collapsed');
  if (isCollapsed) {
    block.classList.remove('collapsed');
  } else {
    block.classList.add('collapsed');
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: 添加思考链折叠切换函数"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 3: JavaScript - showThinkingCards改动

**Files:**
- Modify: `index.html:2581-2618`（showThinkingCards函数）

- [ ] **Step 1: 修改showThinkingCards添加thinking区块**

找到 `showThinkingCards` 函数（约行2581），修改 `card.innerHTML` 部分：

**原代码**（约行2604-2610）：
```javascript
    card.innerHTML = `
      <div class="response-meta">
        <span class="response-model-name">${name}</span>
        <span class="model-status-icon spinning">◐</span>
      </div>
      <div class="response-card-content thinking-content">等待回复...</div>
    `;
```

**改为**：
```javascript
    card.innerHTML = `
      <div class="response-meta">
        <span class="response-model-name">${name}</span>
        <span class="model-status-icon spinning">◐</span>
      </div>
      <div class="thinking-block streaming" style="display:none;">
        <div class="thinking-content">等待思考...</div>
      </div>
      <div class="response-card-content thinking-content">等待回复...</div>
    `;
```

注意：新增了 `.thinking-block.streaming` 区块，初始隐藏。移除了原有的 `thinking-content` 类名重复问题（content区块改用默认类名）。

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: showThinkingCards添加thinking区块HTML结构"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 4: JavaScript - updateStreamingCard改动

**Files:**
- Modify: `index.html:2620-2652`（updateStreamingCard函数）

- [ ] **Step 1: 重写updateStreamingCard函数**

找到 `updateStreamingCard` 函数（约行2620），完整替换为：

```javascript
function updateStreamingCard(modelId, state, firstTokenTime, groups) {
  requestAnimationFrame(() => {
    const card = document.querySelector(`.response-card[data-model-id="${modelId}"]`);
    if (!card) return;

    // thinking区块处理
    const thinkingBlock = card.querySelector('.thinking-block');
    if (thinkingBlock) {
      if (state.thinking) {
        thinkingBlock.style.display = 'block';
        const thinkingContent = thinkingBlock.querySelector('.thinking-content');
        if (thinkingContent) {
          thinkingContent.textContent = state.thinking;
        }
      } else {
        thinkingBlock.style.display = 'none';
      }
    }

    // content区块处理
    const contentEl = card.querySelector('.response-card-content');
    if (contentEl) {
      contentEl.textContent = state.content || '';
      contentEl.classList.remove('thinking-content');
    }

    // meta信息处理（duration等）
    const metaEl = card.querySelector('.response-meta');
    if (metaEl && firstTokenTime !== null) {
      const icon = metaEl.querySelector('.model-status-icon');
      if (icon) {
        icon.classList.remove('spinning');
      }

      // 添加duration显示（如果不存在）
      if (!metaEl.querySelector('.response-duration')) {
        const durationEl = document.createElement('span');
        durationEl.className = `response-duration ${getSpeedClass(firstTokenTime)}`;
        durationEl.textContent = `${(firstTokenTime/1000).toFixed(1)}s回应`;
        const modelNameEl = metaEl.querySelector('.response-model-name');
        if (modelNameEl) {
          modelNameEl.insertAdjacentElement('afterend', durationEl);
        }
      }
    }
  });
}
```

关键改动：
- 参数从 `(modelId, content, firstTokenTime, groups)` 改为 `(modelId, state, firstTokenTime, groups)`
- `state` 包含 `{ thinking, content, phase }`
- 处理thinking区块显示/隐藏

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: updateStreamingCard支持thinking/content分离显示"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 5: JavaScript - updateCardStatus改动

**Files:**
- Modify: `index.html:2655-2694`（updateCardStatus函数）

- [ ] **Step 1: 修改updateCardStatus添加thinking折叠**

找到 `updateCardStatus` 函数（约行2655），在函数内添加thinking区块处理逻辑。

**在现有代码基础上，在 `card.classList.remove('thinking');` 之后添加**：

```javascript
function updateCardStatus(modelId, status, error, state = null) {
  requestAnimationFrame(() => {
    const card = document.querySelector(`.response-card[data-model-id="${modelId}"]`);
    if (!card) return;

    card.classList.remove('thinking');

    const contentEl = card.querySelector('.response-card-content');
    const metaEl = card.querySelector('.response-meta');

    // Update status icon with color class
    const icon = metaEl?.querySelector('.model-status-icon');
    if (icon) {
      icon.classList.remove('spinning', 'completed', 'failed', 'stopped');
      icon.classList.add(status);
      icon.textContent = getStatusText(status);
    }

    // Update content and add error message for failed models
    if (status === 'failed') {
      if (contentEl) {
        contentEl.textContent = '';  // Empty content for failed
      }
      if (metaEl && error && !metaEl.querySelector('.response-error')) {
        const errorEl = document.createElement('span');
        errorEl.className = 'response-error';
        errorEl.textContent = error;
        const statusEl = metaEl.querySelector('.response-status') || icon;
        if (statusEl) {
          statusEl.insertAdjacentElement('afterend', errorEl);
        }
      }
    } else if (status === 'stopped') {
      // Keep partial content if exists
    } else if (status === 'completed') {
      // Content already updated via updateStreamingCard
      
      // 处理thinking区块折叠
      if (state && state.thinking) {
        const thinkingBlock = card.querySelector('.thinking-block');
        if (thinkingBlock) {
          thinkingBlock.classList.remove('streaming');
          thinkingBlock.classList.add('collapsed');
          
          // 添加折叠header（如果不存在）
          if (!thinkingBlock.querySelector('.thinking-header')) {
            const header = document.createElement('div');
            header.className = 'thinking-header';
            header.onclick = function() { toggleThinking(this); };
            
            const durationStr = state.thinkingDuration 
              ? `${(state.thinkingDuration/1000).toFixed(1)}s` 
              : '';
            
            header.innerHTML = `
              <span class="thinking-icon"></span>
              <span class="thinking-label">思考过程</span>
              <span class="thinking-duration">${durationStr}</span>
            `;
            
            thinkingBlock.insertBefore(header, thinkingBlock.firstChild);
          }
        }
      } else {
        // 无thinking内容，隐藏thinking区块
        const thinkingBlock = card.querySelector('.thinking-block');
        if (thinkingBlock) {
          thinkingBlock.style.display = 'none';
        }
      }
    }
  });
}
```

注意：
- 函数签名新增 `state = null` 参数
- 完成时添加折叠header结构
- 无thinking时隐藏区块

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: updateCardStatus添加thinking折叠功能"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 6: JavaScript - callClaude改动（核心）

**Files:**
- Modify: `index.html:1958-2039`（callClaude函数）

- [ ] **Step 1: 重写callClaude函数支持thinking**

找到 `callClaude` 函数（约行1958），完整替换为：

```javascript
async function callClaude(baseUrl, apiKey, model, messages, onChunk, signal = null) {
  const url = `${baseUrl}/v1/messages`;
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  };

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

  const useSignal = signal || (currentAbortController = new AbortController()).signal;
  
  // 初始化state对象
  const state = {
    thinking: '',
    content: '',
    phase: 'content',
    thinkingStartTime: null,
    firstContentTokenTime: null
  };
  
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: useSignal
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API错误: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
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
            
            // Claude thinking事件处理
            if (json.type === 'content_block_start' && json.content_block?.type === 'thinking') {
              state.phase = 'thinking';
              state.thinkingStartTime = Date.now();
            }
            else if (json.type === 'content_block_delta' && json.delta?.type === 'thinking_delta') {
              state.thinking += json.delta.thinking || '';
              state.phase = 'thinking';
              onChunk(state);
            }
            else if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
              if (state.firstContentTokenTime === null) {
                state.firstContentTokenTime = Date.now();
                // 计算thinkingDuration
                if (state.thinkingStartTime) {
                  state.thinkingDuration = state.firstContentTokenTime - state.thinkingStartTime;
                }
              }
              state.content += json.delta.text || '';
              state.phase = 'content';
              onChunk(state);
            }
            else if (json.type === 'content_block_start' && json.content_block?.type === 'text') {
              state.phase = 'content';
              if (state.firstContentTokenTime === null) {
                state.firstContentTokenTime = Date.now();
              }
            }
          } catch (e) {}
        }
      }
    }

    // 计算最终thinkingDuration（如果还没计算）
    if (state.thinkingStartTime && state.thinkingDuration === undefined) {
      state.thinkingDuration = Date.now() - state.thinkingStartTime;
    }

    return state;
  } catch (e) {
    if (e.name === 'AbortError') {
      return state;
    }
    throw e;
  } finally {
    if (!signal) {
      currentAbortController = null;
    }
  }
}
```

关键改动：
- 返回 `state` 对象而非 `fullContent` 字符串
- 解析 `thinking_delta` 和 `text_delta` 事件类型
- 计算 `thinkingDuration` 和 `firstContentTokenTime`

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: callClaude支持thinking事件解析"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 7: JavaScript - callOpenAI改动

**Files:**
- Modify: `index.html:1882-1956`（callOpenAI函数）

- [ ] **Step 1: 重写callOpenAI函数支持thinking标签**

找到 `callOpenAI` 函数（约行1882），完整替换为：

```javascript
async function callOpenAI(baseUrl, apiKey, model, messages, onChunk, signal = null) {
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

  const useSignal = signal || (currentAbortController = new AbortController()).signal;
  
  // 初始化state对象
  const state = {
    thinking: '',
    content: '',
    phase: 'content',
    thinkingStartTime: null,
    firstContentTokenTime: null
  };
  
  const startTime = Date.now();
  
  // thinking标签解析状态
  let inThinking = false;
  let buffer = '';
  const THINKING_START = '<thinking>';
  const THINKING_END = '</thinking>';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: useSignal
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API错误: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split('\n');
      streamBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            const chunk = json.choices?.[0]?.delta?.content;
            if (chunk) {
              buffer += chunk;
              
              // 检测thinking开始
              if (!inThinking) {
                const startIdx = buffer.indexOf(THINKING_START);
                if (startIdx !== -1) {
                  inThinking = true;
                  state.thinkingStartTime = Date.now();
                  state.phase = 'thinking';
                  // 标签前的内容归入content
                  state.content += buffer.slice(0, startIdx);
                  buffer = buffer.slice(startIdx + THINKING_START.length);
                }
              }
              
              // 检测thinking结束
              if (inThinking) {
                const endIdx = buffer.indexOf(THINKING_END);
                if (endIdx !== -1) {
                  inThinking = false;
                  // 标签内内容归入thinking
                  state.thinking += buffer.slice(0, endIdx);
                  buffer = buffer.slice(endIdx + THINKING_END.length);
                  state.phase = 'content';
                  
                  if (state.firstContentTokenTime === null) {
                    state.firstContentTokenTime = Date.now();
                  }
                  if (state.thinkingStartTime) {
                    state.thinkingDuration = state.firstContentTokenTime - state.thinkingStartTime;
                  }
                } else {
                  // 还在thinking阶段，继续累积
                  state.thinking += buffer;
                  buffer = '';
                }
              }
              
              // 非thinking阶段的内容归入content
              if (!inThinking && buffer) {
                if (state.firstContentTokenTime === null) {
                  state.firstContentTokenTime = Date.now();
                }
                state.content += buffer;
                buffer = '';
              }
              
              onChunk(state);
            }
          } catch (e) {}
        }
      }
    }

    // 处理剩余buffer（无结束标签的情况）
    if (inThinking) {
      state.thinking += buffer;
    } else if (buffer) {
      state.content += buffer;
    }

    // 计算thinkingDuration（如果还没计算）
    if (state.thinkingStartTime && state.thinkingDuration === undefined) {
      state.thinkingDuration = Date.now() - state.thinkingStartTime;
    }

    return state;
  } catch (e) {
    if (e.name === 'AbortError') {
      return state;
    }
    throw e;
  } finally {
    if (!signal) {
      currentAbortController = null;
    }
  }
}
```

关键改动：
- 返回 `state` 对象
- 使用buffer累积处理标签分片问题
- 检测 `<thinking>` 开始/结束标签

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: callOpenAI支持thinking标签解析"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 8: JavaScript - callGemini改动

**Files:**
- Modify: `index.html:2041-2126`（callGemini函数）

- [ ] **Step 1: 重写callGemini函数支持thinking标签**

找到 `callGemini` 函数（约行2041），完整替换为：

```javascript
async function callGemini(baseUrl, apiKey, model, messages, onChunk, signal = null) {
  const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

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

  const useSignal = signal || (currentAbortController = new AbortController()).signal;
  
  // 初始化state对象
  const state = {
    thinking: '',
    content: '',
    phase: 'content',
    thinkingStartTime: null,
    firstContentTokenTime: null
  };
  
  const startTime = Date.now();
  
  // thinking标签解析状态（同OpenAI）
  let inThinking = false;
  let buffer = '';
  const THINKING_START = '<thinking>';
  const THINKING_END = '</thinking>';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: useSignal
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API错误: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let streamBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      streamBuffer += decoder.decode(value, { stream: true });
      const lines = streamBuffer.split('\n');
      streamBuffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          try {
            const json = JSON.parse(data);
            const chunk = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (chunk) {
              buffer += chunk;
              
              // 检测thinking开始（同OpenAI逻辑）
              if (!inThinking) {
                const startIdx = buffer.indexOf(THINKING_START);
                if (startIdx !== -1) {
                  inThinking = true;
                  state.thinkingStartTime = Date.now();
                  state.phase = 'thinking';
                  state.content += buffer.slice(0, startIdx);
                  buffer = buffer.slice(startIdx + THINKING_START.length);
                }
              }
              
              // 检测thinking结束
              if (inThinking) {
                const endIdx = buffer.indexOf(THINKING_END);
                if (endIdx !== -1) {
                  inThinking = false;
                  state.thinking += buffer.slice(0, endIdx);
                  buffer = buffer.slice(endIdx + THINKING_END.length);
                  state.phase = 'content';
                  
                  if (state.firstContentTokenTime === null) {
                    state.firstContentTokenTime = Date.now();
                  }
                  if (state.thinkingStartTime) {
                    state.thinkingDuration = state.firstContentTokenTime - state.thinkingStartTime;
                  }
                } else {
                  state.thinking += buffer;
                  buffer = '';
                }
              }
              
              // 非thinking阶段
              if (!inThinking && buffer) {
                if (state.firstContentTokenTime === null) {
                  state.firstContentTokenTime = Date.now();
                }
                state.content += buffer;
                buffer = '';
              }
              
              onChunk(state);
            }
          } catch (e) {}
        }
      }
    }

    // 处理剩余buffer
    if (inThinking) {
      state.thinking += buffer;
    } else if (buffer) {
      state.content += buffer;
    }

    if (state.thinkingStartTime && state.thinkingDuration === undefined) {
      state.thinkingDuration = Date.now() - state.thinkingStartTime;
    }

    return state;
  } catch (e) {
    if (e.name === 'AbortError') {
      return state;
    }
    throw e;
  } finally {
    if (!signal) {
      currentAbortController = null;
    }
  }
}
```

关键改动：
- 返回 `state` 对象
- 同OpenAI的标签解析逻辑

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: callGemini支持thinking标签解析"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 9: JavaScript - callAPI改动

**Files:**
- Modify: `index.html:2128-2139`（callAPI函数）

- [ ] **Step 1: 修改callAPI函数返回state**

找到 `callAPI` 函数（约行2128），修改为：

```javascript
async function callAPI(style, baseUrl, apiKey, model, messages, onChunk, signal = null) {
  switch (style) {
    case 'openai':
      return await callOpenAI(baseUrl, apiKey, model, messages, onChunk, signal);
    case 'claude':
      return await callClaude(baseUrl, apiKey, model, messages, onChunk, signal);
    case 'gemini':
      return await callGemini(baseUrl, apiKey, model, messages, onChunk, signal);
    default:
      throw new Error(`不支持的接口风格: ${style}`);
  }
}
```

注意：函数签名不变，但返回值从 `fullContent` 字符串变为 `state` 对象。调用方需适配。

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: callAPI返回state对象"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 10: JavaScript - callAllModels改动（关键整合）

**Files:**
- Modify: `index.html:2142-2218`（callAllModels函数）

- [ ] **Step 1: 修改callAllModels适配state对象**

找到 `callAllModels` 函数（约行2142），修改关键部分：

**修改state初始化**（约行2148-2155）：

```javascript
  // 初始化每个模型的状态和AbortController
  modelIds.forEach(id => {
    activeGenerations.set(id, {
      abortController: new AbortController(),
      status: 'generating',
      firstTokenTime: null,
      startTime,
      content: '',
      thinking: '',
      thinkingDuration: null
    });
  });
```

**修改callAPI调用和返回值处理**（约行2168-2198）：

```javascript
    try {
      const state = await callAPI(
        info.group.style,
        info.group.baseUrl,
        info.group.key,
        info.model.name,
        messages,
        chunkState => {
          // 更新activeGenerations中的state
          const genState = activeGenerations.get(id);
          if (genState) {
            genState.content = chunkState.content;
            genState.thinking = chunkState.thinking;
            
            // firstTokenTime：第一个thinking token或第一个content token
            if (chunkState.phase === 'thinking' && genState.firstTokenTime === null) {
              genState.firstTokenTime = Date.now() - startTime;
            } else if (chunkState.phase === 'content' && genState.firstTokenTime === null) {
              genState.firstTokenTime = chunkState.firstContentTokenTime 
                ? chunkState.firstContentTokenTime - startTime 
                : Date.now() - startTime;
            }
            
            // thinkingDuration
            if (chunkState.thinkingDuration) {
              genState.thinkingDuration = chunkState.thinkingDuration;
            }
          }
          
          // 调用外部onChunk（传递完整state）
          const firstTokenTime = genState?.firstTokenTime;
          onChunk(id, chunkState, firstTokenTime);
        },
        state.abortController.signal
      );

      state.status = 'completed';
      renderModelSelector(groups, selectedModels, true);
      updateCardStatus(id, 'completed', null, state);
      
      const completionTime = Date.now();
      return {
        modelId: id,
        status: 'completed',
        thinking: state.thinking,
        content: state.content,
        thinkingDuration: state.thinkingDuration,
        firstTokenTime: activeGenerations.get(id)?.firstTokenTime,
        totalDuration: completionTime - startTime,
        timestamp: completionTime
      };
```

**修改catch块**（约行2200-2215）：

```javascript
    } catch (err) {
      const completionTime = Date.now();
      const genState = activeGenerations.get(id);
      
      if (err.name === 'AbortError') {
        state.status = 'stopped';
        renderModelSelector(groups, selectedModels, true);
        updateCardStatus(id, 'stopped', null, { 
          thinking: genState?.thinking || '', 
          content: genState?.content || '' 
        });
        return { 
          modelId: id, 
          status: 'stopped', 
          thinking: genState?.thinking || '', 
          content: genState?.content || '', 
          totalDuration: completionTime - startTime, 
          timestamp: completionTime 
        };
      }
      
      state.status = 'failed';
      state.error = err.message;
      renderModelSelector(groups, selectedModels, true);
      updateCardStatus(id, 'failed', err.message, { 
        thinking: genState?.thinking || '', 
        content: '' 
      });
      return { 
        modelId: id, 
        status: 'failed', 
        error: err.message, 
        thinking: '', 
        content: '', 
        totalDuration: completionTime - startTime, 
        timestamp: completionTime 
      };
    }
```

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: callAllModels适配state对象，整合thinking显示"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 11: JavaScript - renderMultiModelResponse改动

**Files:**
- Modify: `index.html:792-861`（renderMultiModelResponse函数）

- [ ] **Step 1: 修改renderMultiModelResponse支持thinking显示**

找到 `renderMultiModelResponse` 函数（约行792），在 `card.appendChild(metaEl)` 之后、`card.appendChild(content)` 之前添加thinking区块：

**修改card内容构建**（约行805-856）：

```javascript
    const card = document.createElement('div');
    card.className = 'response-card';

    const info = findModelById(groups, r.modelId);
    const name = info ? `${info.group.name} / ${info.model.name}` : '未知';

    // Response meta row
    const metaEl = document.createElement('div');
    metaEl.className = 'response-meta';

    const durationStr = r.firstTokenTime ? `${(r.firstTokenTime/1000).toFixed(1)}s回应` : '';
    const totalStr = r.totalDuration ? `${(r.totalDuration/1000).toFixed(1)}s耗时` : '';
    const statusText = getStatusText(r.status);
    const responseTimeStr = r.timestamp ? formatDateTime(r.timestamp) : '';
    const errorText = r.status === 'failed' ? (r.error || '未知错误') : '';
    const speedClass = getSpeedClass(r.firstTokenTime);

    const copyBtnHtml = (r.status === 'completed' && r.content) ? `
      <button class="btn-icon copy-btn" title="复制">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    ` : '';

    metaEl.innerHTML = `
      <span class="response-model-name">${name}</span>
      <span class="response-time">${responseTimeStr}</span>
      <span class="response-duration ${speedClass}">${durationStr}</span>
      <span class="response-total">${totalStr}</span>
      <span class="response-status ${r.status}">${statusText}</span>
      ${errorText ? `<span class="response-error">${errorText}</span>` : ''}
      ${copyBtnHtml}
    `;
    const copyBtn = metaEl.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => onCopy(r.content || ''));
    }

    card.appendChild(metaEl);

    // Thinking block（如果有thinking内容）
    if (r.thinking) {
      const thinkingBlock = document.createElement('div');
      thinkingBlock.className = 'thinking-block collapsed';
      
      const thinkingHeader = document.createElement('div');
      thinkingHeader.className = 'thinking-header';
      thinkingHeader.onclick = function() { toggleThinking(this); };
      
      const thinkingDurationStr = r.thinkingDuration 
        ? `${(r.thinkingDuration/1000).toFixed(1)}s` 
        : '';
      
      thinkingHeader.innerHTML = `
        <span class="thinking-icon"></span>
        <span class="thinking-label">思考过程</span>
        <span class="thinking-duration">${thinkingDurationStr}</span>
      `;
      
      const thinkingContent = document.createElement('div');
      thinkingContent.className = 'thinking-content';
      thinkingContent.textContent = r.thinking;
      
      thinkingBlock.appendChild(thinkingHeader);
      thinkingBlock.appendChild(thinkingContent);
      card.appendChild(thinkingBlock);
    }

    // Content block
    const content = document.createElement('div');
    content.className = 'response-card-content';
    if (r.status === 'failed') {
      content.textContent = '';
    } else if (r.status === 'stopped') {
      content.textContent = r.content || '';
    } else {
      content.textContent = r.content || '';
    }
    card.appendChild(content);

    cards.appendChild(card);
```

- [ ] **Step 2: 提交**

```bash
git add index.html
git commit -m "feat: renderMultiModelResponse支持thinking折叠显示"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Task 12: 最终测试和清理

**Files:**
- Modify: `index.html`
- Modify: `styles.css`

- [ ] **Step 1: 检查所有改动一致性**

确认：
- 所有函数返回state对象而非字符串
- onChunk参数传递正确
- thinking区块HTML结构统一
- CSS样式完整

- [ ] **Step 2: 功能测试**

手动测试：
1. 选择Claude模型，发送消息，观察thinking实时显示和折叠
2. 选择OpenAI模型，手动输入包含 `<thinking>` 标签的测试内容
3. 点击折叠按钮，确认展开/收起功能正常

- [ ] **Step 3: 最终提交（版本号更新）**

```bash
git add index.html styles.css
git commit -m "feat: 完成思考链显示功能，支持三种API风格"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

- [ ] **Step 4: 更新版本号**

在 `index.html` 中更新版本号（约行17）：

```html
<span class="navbar-version">v1.1.0</span>
```

```bash
git add index.html
git commit -m "+版本号"

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```
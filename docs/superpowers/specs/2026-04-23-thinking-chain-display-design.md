---
name: Thinking Chain Display
description: 区分并折叠显示LLM回复中的思考链和正式回答，支持Claude/OpenAI/Gemini三种API风格
---

# Thinking Chain Display Design

## 目标

在LLM回复中区分思考链（thinking）和正式回答（content），提供统一折叠展示体验：
- 流式输出时：思考链实时显示（不折叠）
- 输出完成后：思考链可折叠（点击展开/收起）

支持三种API风格，界面统一呈现。

---

## 数据结构改动

### response对象扩展

```javascript
response = {
  modelId: "group:model",
  status: "completed" | "failed" | "stopped",
  
  // 新增字段
  thinking: "思考链完整内容",      // 思考过程
  thinkingDuration: 1500,         // 思考链耗时（毫秒）
  
  // 原有字段
  content: "正式回答内容",
  firstTokenTime: 800,
  totalDuration: 3000,
  timestamp: Date.now(),
  error: null
}
```

### 流式状态对象（onChunk参数）

```javascript
streamState = {
  thinking: "累积的思考链",
  content: "累积的回答",
  phase: "thinking" | "content" | "mixed",  // 当前阶段
  thinkingStartTime: Date.now(),            // thinking开始时间（用于计算thinkingDuration）
  firstContentTokenTime: null               // 第一个content token时间（用于firstTokenTime）
}
```

**时间定义**：
- `thinkingDuration`：thinking开始 → 第一个content token出现（思考阶段耗时）
- `firstTokenTime`：请求开始 → 第一个thinking token出现（总首token响应时间）
- 如果无thinking：`firstTokenTime` = 第一个content token时间
```

---

## API层改动

### callClaude（重点）

Claude官方支持thinking blocks，流式事件类型明确：

```javascript
// 流式事件处理逻辑
if (json.type === "thinking") {
  state.thinking += json.thinking || "";
  state.phase = "thinking";
  onChunk(state);
}
else if (json.type === "content_block_delta" && json.delta?.text) {
  state.content += json.delta.text;
  state.phase = "content";
  onChunk(state);
}
```

**计时**：记录第一个thinking事件时间 → thinkingStartTime，计算 thinkingDuration。

### callOpenAI

无官方thinking支持，依赖模型在内容中使用 `<thinking>` 标签：

```javascript
// 流式内容处理 - 使用buffer处理标签分片问题
buffer += chunk;

// 标签可能被分片（如 "<think" + "ing>"），使用缓冲检测
const THINKING_START = "<thinking>";
const THINKING_END = "</thinking>";

// 检测thinking开始
if (!inThinking) {
  const startIdx = buffer.indexOf(THINKING_START);
  if (startIdx !== -1) {
    inThinking = true;
    thinkingStartTime = Date.now();
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
    state.thinking = buffer.slice(0, endIdx);
    buffer = buffer.slice(endIdx + THINKING_END.length);
    state.phase = "content";
  } else {
    // 还在thinking阶段，继续累积
    state.thinking += buffer;
    buffer = "";
  }
}

// 非thinking阶段的内容归入content
if (!inThinking && buffer) {
  state.content += buffer;
  buffer = "";
}

onChunk(state);
```

**关键点**：
- 使用buffer累积，避免标签被分片导致匹配失败
- 标签本身不显示，只显示内部内容
- 完成后content不含thinking标签及其内容

### callGemini

Gemini有官方thinking模式（thinkingConfig），但流式格式与Claude不同。暂按OpenAI正则方式处理：

```javascript
// 同OpenAI逻辑，正则实时匹配 <thinking> 标签
// 后续可查阅Gemini API文档，如有官方thinking支持则优先使用
```

---

## 渲染层改动

### updateStreamingCard

接收 `{ thinking, content, phase }` 状态对象：

```javascript
function updateStreamingCard(modelId, state, firstTokenTime, groups) {
  const card = document.querySelector(`.response-card[data-model-id="${modelId}"]`);
  
  // thinking区块
  const thinkingEl = card.querySelector('.thinking-block');
  if (state.thinking) {
    thinkingEl.textContent = state.thinking;
    thinkingEl.style.display = 'block';
    // 流式时不折叠
    thinkingEl.classList.remove('collapsed');
  }
  
  // content区块
  const contentEl = card.querySelector('.response-card-content');
  contentEl.textContent = state.content;
}
```

### 思考链折叠组件

**HTML结构**：
```html
<div class="thinking-block collapsed">
  <div class="thinking-header" onclick="toggleThinking(this)">
    <span class="thinking-icon">▶</span>
    <span class="thinking-label">思考过程</span>
    <span class="thinking-duration">1.5s</span>
  </div>
  <div class="thinking-content">思考链内容...</div>
</div>
```

**CSS样式**：
- thinking-block：淡灰色背景，区分于回答
- collapsed状态：thinking-content隐藏，图标显示▶
- 展开状态：thinking-content显示，图标显示▼
- thinking-duration：显示思考链耗时

**行为**：
- 流式输出时：不折叠（collapsed移除）
- 输出完成后：添加折叠功能（添加collapsed类）
- 点击header：切换展开/收起

### 卡片HTML结构扩展

```html
<div class="response-card">
  <div class="response-meta">
    <span class="response-model-name">模型名</span>
    <span class="response-duration">响应时间</span>
    ...
  </div>
  
  <!-- 新增thinking区块 -->
  <div class="thinking-block collapsed" style="display:none;">
    <div class="thinking-header">
      <span class="thinking-icon">▶</span>
      <span class="thinking-label">思考过程</span>
      <span class="thinking-duration"></span>
    </div>
    <div class="thinking-content"></div>
  </div>
  
  <!-- 原有content区块 -->
  <div class="response-card-content"></div>
</div>
```

---

## showThinkingCards改动

初始化时创建thinking区块：

```javascript
card.innerHTML = `
  <div class="response-meta">...</div>
  <div class="thinking-block" style="display:none;">
    <div class="thinking-content thinking-active">等待思考...</div>
  </div>
  <div class="response-card-content thinking-content">等待回复...</div>
`;
```

流式时thinking区块显示并实时更新。

---

## updateCardStatus改动

完成时添加折叠功能：

```javascript
if (status === 'completed' && state.thinking) {
  const thinkingBlock = card.querySelector('.thinking-block');
  thinkingBlock.classList.add('collapsed');
  thinkingBlock.querySelector('.thinking-duration').textContent = 
    `${(state.thinkingDuration/1000).toFixed(1)}s`;
  
  // 添加header结构（如果不存在）
  if (!thinkingBlock.querySelector('.thinking-header')) {
    const header = document.createElement('div');
    header.className = 'thinking-header';
    header.onclick = () => toggleThinking(header);
    header.innerHTML = `
      <span class="thinking-icon">▶</span>
      <span class="thinking-label">思考过程</span>
      <span class="thinking-duration">${(state.thinkingDuration/1000).toFixed(1)}s</span>
    `;
    thinkingBlock.insertBefore(header, thinkingBlock.firstChild);
  }
}
```

---

## CSS新增样式

```css
/* 思考链区块 */
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
}

.thinking-header:hover {
  background: var(--bg-hover);
}

.thinking-icon {
  font-size: 10px;
  transition: transform var(--transition-fast);
}

.thinking-block.collapsed .thinking-icon {
  transform: rotate(0deg);
}

.thinking-block:not(.collapsed) .thinking-icon {
  transform: rotate(90deg);
}

.thinking-label {
  color: var(--text-secondary);
}

.thinking-duration {
  color: var(--text-muted);
  font-size: 11px;
}

.thinking-content {
  padding: var(--space-2) var(--space-3);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.thinking-block.collapsed .thinking-content {
  display: none;
}

/* 流式思考状态 */
.thinking-active {
  background: var(--bg-subtle);
}
```

---

## callAllModels改动

传递完整state而非仅content：

```javascript
const content = await callAPI(
  info.group.style,
  info.group.baseUrl,
  info.group.key,
  info.model.name,
  messages,
  state => {
    // 更新state.phase用于UI判断
    onChunk(id, state, state.phase === "thinking" ? null : firstTokenTime);
  },
  signal
);

// 返回完整response对象
return {
  modelId: id,
  status: 'completed',
  thinking: state.thinking,
  content: state.content,
  thinkingDuration: state.thinkingDuration,
  firstTokenTime,
  totalDuration,
  timestamp
};
```

---

## 数据存储改动

session消息中的responses数组每个元素需包含thinking字段：

```javascript
// addMessage调用
await addMessage(sessionId, 'assistant', null, {
  responses: [{
    modelId, status,
    thinking: "思考链",
    content: "回答",
    thinkingDuration,
    firstTokenTime,
    totalDuration,
    timestamp
  }]
});
```

---

## 格式化处理

正式回答内容中的markdown格式需要渲染：
- 代码块 → `<pre><code>`
- 标题 → `<h1-6>`
- 列表 → `<ul>/<ol>`
- 链接 → `<a>`
- 粗体/斜体 → `<strong>/<em>`

**方案**：引入轻量markdown解析库（如marked.js），在渲染层转换。

思考链内容暂不格式化，保持原文本显示（思考链通常是模型内部推理，非markdown格式）。

---

## 实现优先级

1. **callClaude改动** - 最重要，Claude是主流thinking API
2. **渲染层折叠组件** - 用户可见的核心功能
3. **callOpenAI/callGemini改动** - 正则匹配，次要
4. **markdown格式化** - 提升回答可读性，最后

---

## 测试验证

- Claude API：使用支持thinking的模型（如claude-3.5-sonnet）测试流式thinking显示
- OpenAI：手动构造包含 `<thinking>` 标签的测试场景
- 折叠功能：点击展开/收起，确认状态保持
- 流式体验：确认thinking实时显示，完成后正确折叠
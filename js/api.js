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
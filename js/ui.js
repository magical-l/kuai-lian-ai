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
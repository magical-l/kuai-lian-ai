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
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

  // 准备调用API
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
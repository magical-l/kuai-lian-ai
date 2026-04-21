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
  if (!directoryHandle) return;
  try {
    await directoryHandle.getDirectoryHandle('sessions', { create: true });
  } catch (err) {
    console.error('创建sessions目录失败:', err);
  }
}

// 加载端点配置
export async function loadEndpoints() {
  if (!directoryHandle) {
    endpointsData = { groups: [] };
    return endpointsData;
  }
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
  if (!directoryHandle) return false;
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
  return endpointsData?.groups?.find(g => g.id === groupId);
}

// 加载会话索引
export async function loadSessionsIndex() {
  if (!directoryHandle) return [];
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

  if (!directoryHandle) return null;
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
  if (!directoryHandle) return false;
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
  if (!directoryHandle) return false;
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
// ========== Store Functions ==========
let endpointsData = null;
let sessionsCache = new Map();
async function clearDirectory() {
	endpointsData = {
		groups: []
	};
	sessionsCache.clear();
	await storage.clearAll();
	updateDirectoryDisplay();
	await refreshUI();
}
// 尝试恢复已保存的目录
async function tryRestoreDirectory() {
	const result = await storage.init();
	if (result.mode === null) {
		return {
			success: false,
			needUserAction: true
		};
	}
	endpointsData = await storage.loadEndpoints();
	const sessions = await storage.loadSessions();
	sessions.forEach(s => sessionsCache.set(s.id, s));
	updateDirectoryDisplay();
	await refreshUI();
	return {
		success: true
	};
} // 用户点击后请求权限并恢复目录
function generateUUID() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}
async function selectDirectory() {
	try {
		const handle = await window.showDirectoryPicker({
			mode: 'readwrite'
		});
		await storage.selectMode('directory', handle);
		await loadEndpoints();
		await loadSessionsIndex();
		return true;
	} catch (err) {
		console.error('选择目录失败:', err);
		return false;
	}
}
async function loadEndpoints() {
	endpointsData = await storage.loadEndpoints();
	return endpointsData;
}
async function saveEndpoints() {
	return await storage.saveEndpoints(endpointsData);
}

function getGroups() {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	return endpointsData.groups || [];
}
async function addGroup(name, baseUrl, style, key) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	if (storage.mode !== 'browser' && !storage.getDirectoryName()) {
		alert('请先选择存储位置');
		return null;
	}
	const group = {
		id: generateUUID(),
		name,
		baseUrl,
		style,
		key,
		models: []
	};
	endpointsData.groups.push(group);
	await saveEndpoints();
	return group;
}
async function updateGroup(groupId, updates) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	const group = endpointsData.groups.find(g => g.id === groupId);
	if (group) {
		Object.assign(group, updates);
		await saveEndpoints();
		return group;
	}
	return null;
}
async function deleteGroup(groupId) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	const index = endpointsData.groups.findIndex(g => g.id === groupId);
	if (index >= 0) {
		endpointsData.groups.splice(index, 1);
		await saveEndpoints();
		return true;
	}
	return false;
}
async function reorderGroups(draggedId, targetId, insertBefore = true) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	const draggedIndex = endpointsData.groups.findIndex(g => g.id === draggedId);
	const targetIndex = endpointsData.groups.findIndex(g => g.id === targetId);
	if (draggedIndex >= 0 && targetIndex >= 0) {
		const [draggedGroup] = endpointsData.groups.splice(draggedIndex, 1);
		// 如果从前往后拖且insertBefore为true，需要调整位置
		// 如果从后往前拖且insertBefore为false，也需要调整
		let insertIndex = targetIndex;
		if (draggedIndex < targetIndex) {
			insertIndex = insertBefore ? targetIndex - 1 : targetIndex;
		} else if (draggedIndex > targetIndex) {
			insertIndex = insertBefore ? targetIndex : targetIndex + 1;
		}
		endpointsData.groups.splice(insertIndex, 0, draggedGroup);
		await saveEndpoints();
		return true;
	}
	return false;
}
async function addModel(groupId, modelName) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
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
async function updateModel(groupId, modelId, newName) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	const group = endpointsData.groups.find(g => g.id === groupId);
	const model = group?.models?.find(m => m.id === modelId);
	if (model) {
		model.name = newName;
		await saveEndpoints();
		return model;
	}
	return null;
}
async function deleteModel(groupId, modelId) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	const group = endpointsData.groups.find(g => g.id === groupId);
	if (group) {
		const index = group.models?.findIndex(m => m.id === modelId) ?? -1;
		if (index >= 0) {
			group.models.splice(index, 1);
			await saveEndpoints();
			return true;
		}
	}
	return false;
}
async function reorderModels(groupId, draggedModelId, targetModelId, insertBefore) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	const group = endpointsData.groups.find(g => g.id === groupId);
	if (!group || !group.models) return false;
	const draggedIndex = group.models.findIndex(m => m.id === draggedModelId);
	const targetIndex = group.models.findIndex(m => m.id === targetModelId);
	if (draggedIndex >= 0 && targetIndex >= 0) {
		const [draggedModel] = group.models.splice(draggedIndex, 1);
		let insertIndex = targetIndex;
		if (draggedIndex < targetIndex) {
			insertIndex = insertBefore ? targetIndex - 1 : targetIndex;
		} else if (draggedIndex > targetIndex) {
			insertIndex = insertBefore ? targetIndex : targetIndex + 1;
		}
		group.models.splice(insertIndex, 0, draggedModel);
		await saveEndpoints();
		return true;
	}
	return false;
}

function getModel(groupId, modelId) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	const group = endpointsData.groups.find(g => g.id === groupId);
	return group?.models?.find(m => m.id === modelId);
}

function getGroup(groupId) {
	if (!endpointsData) endpointsData = {
		groups: []
	};
	return endpointsData.groups.find(g => g.id === groupId);
}
async function loadSessionsIndex() {
	const sessions = await storage.loadSessions();
	sessionsCache.clear();
	for (const s of sessions) {
		sessionsCache.set(s.id, s);
	}
	return sessions;
}

function getAllSessions() {
	return Array.from(sessionsCache.values());
}
async function createSession(firstMessage = null, targetModels = null) {
	let title = '新会话';
	if (firstMessage) {
		if (Array.isArray(firstMessage)) {
			const firstText = firstMessage.find(c => c.type === 'text' || c.type === 'file_text');
			title = firstText ? firstText.text.slice(0, 20) : '新会话';
		} else if (typeof firstMessage === 'string') {
			title = firstMessage.slice(0, 20);
		}
	}
	const session = {
		id: generateUUID(),
		title,
		createdAt: Date.now(),
		messages: []
	};
	if (firstMessage) {
		let content;
		if (Array.isArray(firstMessage)) {
			content = firstMessage;
		} else if (typeof firstMessage === 'string') {
			content = [{
				type: 'text',
				text: firstMessage
			}];
		} else {
			content = [{
				type: 'text',
				text: String(firstMessage)
			}];
		}
		const msg = {
			role: 'user',
			content,
			timestamp: Date.now()
		};
		if (targetModels) {
			msg.targetModels = targetModels;
		}
		session.messages.push(msg);
	}
	sessionsCache.set(session.id, session);
	await saveSession(session);
	return session;
}
async function loadSession(sessionId) {
	if (sessionsCache.has(sessionId)) {
		return sessionsCache.get(sessionId);
	}
	const session = await storage.loadSession(sessionId);
	if (session) {
		sessionsCache.set(session.id, session);
	}
	return session;
}
async function saveSession(session) {
	return await storage.saveSession(session);
}
// 辅助函数：确保消息 content 为数组格式
function normalizeMessageContent(msg) {
	if (!msg.content) return [{
		type: 'text',
		text: ''
	}];
	if (typeof msg.content === 'string') {
		return [{
			type: 'text',
			text: msg.content
		}];
	}
	if (Array.isArray(msg.content)) {
		return msg.content;
	}
	return [{
		type: 'text',
		text: String(msg.content)
	}];
}
async function addMessage(sessionId, role, content, options = {}) {
	const session = sessionsCache.get(sessionId);
	if (!session) return null;
	const message = {
		role,
		timestamp: Date.now()
	};
	// content 改造：支持字符串或数组
	if (typeof content === 'string') {
		message.content = [{
			type: 'text',
			text: content
		}];
	} else if (Array.isArray(content)) {
		message.content = content;
	} else {
		message.content = [{
			type: 'text',
			text: content || ''
		}];
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
		const firstText = message.content.find(c => c.type === 'text');
		session.title = firstText ? firstText.text.slice(0, 20) : '新会话';
	}
	session.messages.push(message);
	await saveSession(session);
	return message;
}

function getSession(sessionId) {
	return sessionsCache.get(sessionId);
}
async function deleteSession(sessionId) {
	sessionsCache.delete(sessionId);
	return await storage.deleteSession(sessionId);
}

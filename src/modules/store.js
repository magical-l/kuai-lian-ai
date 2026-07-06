// ========== Store Functions ==========
let endpointsData = null;
let sessionsCache = new Map();

// ========== 树形工具函数 ==========

// 递归查找节点及其祖先链
function findNodeWithAncestors(nodes, nodeId, ancestors = []) {
	for (const node of nodes) {
		if (node.id === nodeId) return { node, ancestors };
		if (node.children && node.children.length > 0) {
			const found = findNodeWithAncestors(node.children, nodeId, [...ancestors, node]);
			if (found) return found;
		}
	}
	return null;
}

function findNodeInTree(nodes, nodeId) {
	const r = findNodeWithAncestors(nodes, nodeId);
	return r ? r.node : null;
}

// 解析节点的有效配置（沿祖先链继承）
function resolveNodeConfig(nodeId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const result = findNodeWithAncestors(endpointsData.nodes, nodeId);
	if (!result) return null;
	const { node, ancestors } = result;
	const fields = ["baseUrl", "style", "key", "modelId", "type"];
	const config = {};
	for (const f of fields) config[f] = node[f] || '';
	// 从最近祖先往上走，填补缺失字段
	for (let i = ancestors.length - 1; i >= 0; i--) {
		for (const f of fields) {
			if (!config[f] && ancestors[i][f]) config[f] = ancestors[i][f];
		}
	}
	// type 继承后仍为空 → 从 modelId 启发式推断
	if (!config.type) {
		config.type = detectModelType(config.modelId);
	}
	// style 继承后仍为空 → 默认 OpenAI
	if (!config.style) {
		config.style = "openai";
	}
	return config;
}

function findModelById(nodes, nodeId) {
	const result = findNodeWithAncestors(nodes, nodeId);
	if (!result) return null;
	const { node, ancestors } = result;
	return { node, ancestors };
}

// 从模型名自动推断类型
function detectModelType(name) {
	if (!name) return 'chat';
	var lower = name.toLowerCase();
	if (lower.indexOf('embedding') >= 0 || lower.indexOf('text-embedding') >= 0 || lower === 'embed') return 'embed';
	if (lower.indexOf('rerank') >= 0 || lower.indexOf('re-rank') >= 0) return 'rerank';
	return 'chat';
}

// ========== 旧数据迁移 ==========
function migrateEndpoints(data) {
	if (!data) data = { nodes: [] };
	if (data.groups && !data.nodes) {
		console.log('[store] 迁移旧 groups 格式到 nodes（旧 models 逐个转节点）');
		data.nodes = data.groups.map(g => ({
			id: g.id,
			name: g.name,
			baseUrl: g.baseUrl || '',
			style: g.style || 'openai',
			key: g.key || '',
			modelId: '',
			remark: '',
			children: (g.models || []).map(m => ({
				id: m.id,
				name: m.name,
				type: detectModelType(m.name),
				baseUrl: '',
				style: '',
				key: '',
				modelId: m.name,
				remark: m.remark || '',
				children: []
			}))
		}));
		delete data.groups;
	}
	return data;
}

// 清洗：移除旧的 models 字段
function stripModels(node) {
	delete node.models;
	if (node.children) node.children.forEach(stripModels);
}

// ========== 数据操作 ==========

async function clearDirectory() {
	endpointsData = { nodes: [] };
	sessionsCache.clear();
	await storage.clearAll();
	updateDirectoryDisplay();
	await refreshUI();
}

async function tryRestoreDirectory() {
	const result = await storage.init();
	if (result.mode === null) {
		return { success: false, needUserAction: true };
	}
	endpointsData = migrateEndpoints(await storage.loadEndpoints());
	stripModels(endpointsData);
	const sessions = await storage.loadSessions();
	sessions.forEach(s => sessionsCache.set(s.id, s));
	updateDirectoryDisplay();
	return { success: true };
}

function generateUUID() {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

async function selectDirectory() {
	try {
		const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
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
	endpointsData = migrateEndpoints(await storage.loadEndpoints());
	stripModels(endpointsData);
	return endpointsData;
}

async function saveEndpoints() {
	return await storage.saveEndpoints(endpointsData);
}

function getGroups() {
	if (!endpointsData) endpointsData = { nodes: [] };
	return endpointsData.nodes || [];
}

// ========== 节点 CRUD ==========

async function addNode(parentId, data) {
	if (!endpointsData) endpointsData = { nodes: [] };
	if (storage.mode !== 'browser' && !storage.getDirectoryName()) {
		alert('请先选择存储位置');
		return null;
	}
	const node = {
		id: generateUUID(),
		name: data.name,
		baseUrl: data.baseUrl || '',
		style: data.style || '',
		key: data.key || '',
		modelId: data.modelId || '',
		remark: data.remark || '',
		type: data.type || '',
		children: []
	};
	if (parentId) {
		const parent = findNodeInTree(endpointsData.nodes, parentId);
		if (parent) {
			parent.children.push(node);
		} else {
			endpointsData.nodes.push(node);
		}
	} else {
		endpointsData.nodes.push(node);
	}
	await saveEndpoints();
	return node;
}

async function updateNode(nodeId, updates) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const node = findNodeInTree(endpointsData.nodes, nodeId);
	if (node) {
		Object.assign(node, updates);
		await saveEndpoints();
		return node;
	}
	return null;
}

// 递归删除节点及其所有子代
async function deleteNode(nodeId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const removeRecursive = (nodes, id) => {
		const index = nodes.findIndex(n => n.id === id);
		if (index >= 0) {
			// 收集要删除的所有模型引用 key
			const keysToRemove = new Set();
			const collectKeys = (node) => {
				if (node.modelId) keysToRemove.add(node.id);
				node.children?.forEach(collectKeys);
			};
			collectKeys(nodes[index]);
			// 从 selectedEndpoints 中移除
			selectedEndpoints = selectedEndpoints.filter(id => !keysToRemove.has(id));
			saveDefaultSelectedEndpoints(selectedEndpoints);
			nodes.splice(index, 1);
			return true;
		}
		for (const n of nodes) {
			if (n.children && removeRecursive(n.children, id)) return true;
		}
		return false;
	};
	const ok = removeRecursive(endpointsData.nodes, nodeId);
	if (ok) await saveEndpoints();
	return ok;
}

// 重新排序：将节点插入到目标位置（同级或跨级均可）
async function reorderNode(draggedId, targetId, insertBefore = true) {
	if (!endpointsData) endpointsData = { nodes: [] };

	// 从当前位置移除 dragged 节点
	let dragged = null;
	const removeNode = (siblings) => {
		const idx = siblings.findIndex(n => n.id === draggedId);
		if (idx >= 0) { dragged = siblings.splice(idx, 1)[0]; return true; }
		for (const n of siblings) {
			if (n.children && removeNode(n.children)) return true;
		}
		return false;
	};

	// 在 target 所在层级插入
	let ok = false;
	const insertAtTarget = (siblings) => {
		const idx = siblings.findIndex(n => n.id === targetId);
		if (idx >= 0) {
			siblings.splice(insertBefore ? idx : idx + 1, 0, dragged);
			ok = true;
			return true;
		}
		for (const n of siblings) {
			if (n.children && insertAtTarget(n.children)) return true;
		}
		return false;
	};

	if (!removeNode(endpointsData.nodes)) return false;
	insertAtTarget(endpointsData.nodes);
	if (ok) await saveEndpoints();
	return ok;
}

// 将节点移动为另一个节点的子节点
async function moveNodeAsChild(draggedId, targetParentId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const removeRecursive = (siblings) => {
		const idx = siblings.findIndex(n => n.id === draggedId);
		if (idx >= 0) return siblings.splice(idx, 1)[0];
		for (const n of siblings) {
			if (n.children) {
				const found = removeRecursive(n.children);
				if (found) return found;
			}
		}
		return null;
	};
	const dragged = removeRecursive(endpointsData.nodes);
	if (!dragged) return false;
	const target = findNodeInTree(endpointsData.nodes, targetParentId);
	if (target) {
		if (!target.children) target.children = [];
		target.children.push(dragged);
	} else {
		endpointsData.nodes.push(dragged);
	}
	await saveEndpoints();
	return true;
}

// ========== 节点查询 ==========

function getNode(nodeId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	return findNodeInTree(endpointsData.nodes, nodeId);
}

// ========== 会话管理（不变） ==========

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
			content = [{ type: 'text', text: firstMessage }];
		} else {
			content = [{ type: 'text', text: String(firstMessage) }];
		}
		const msg = { role: 'user', content, timestamp: Date.now() };
		if (targetModels) msg.targetEndpoints = targetModels;
		session.messages.push(msg);
	}
	sessionsCache.set(session.id, session);
	await saveSession(session);
	return session;
}

async function loadSession(sessionId) {
	if (sessionsCache.has(sessionId)) return sessionsCache.get(sessionId);
	const session = await storage.loadSession(sessionId);
	if (session) sessionsCache.set(session.id, session);
	return session;
}

async function saveSession(session) {
	return await storage.saveSession(session);
}

function normalizeMessageContent(msg) {
	if (!msg.content) return [{ type: 'text', text: '' }];
	if (typeof msg.content === 'string') return [{ type: 'text', text: msg.content }];
	if (Array.isArray(msg.content)) return msg.content;
	return [{ type: 'text', text: String(msg.content) }];
}

async function addMessage(sessionId, role, content, options = {}) {
	const session = sessionsCache.get(sessionId);
	if (!session) return null;
	const message = { role, timestamp: Date.now() };
	if (typeof content === 'string') {
		message.content = [{ type: 'text', text: content }];
	} else if (Array.isArray(content)) {
		message.content = content;
	} else {
		message.content = [{ type: 'text', text: content || '' }];
	}
	if (role === 'user') {
		if (options.targetEndpoints) message.targetEndpoints = options.targetEndpoints;
	} else if (role === 'assistant') {
		if (options.responses) message.responses = options.responses;
		if (options.endpointId && !options.responses) {
			message.endpointId = options.endpointId;
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

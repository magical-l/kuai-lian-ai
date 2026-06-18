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
	const fields = ['baseUrl', 'style', 'key', 'modelId'];
	const config = {};
	for (const f of fields) config[f] = node[f] || '';
	// 从最近祖先往上走，填补缺失字段
	for (let i = ancestors.length - 1; i >= 0; i--) {
		for (const f of fields) {
			if (!config[f] && ancestors[i][f]) config[f] = ancestors[i][f];
		}
	}
	return config;
}

function findModelById(nodes, referenceId) {
    const [nodeId, modelId] = referenceId.split(":");
    const result = findNodeWithAncestors(nodes, nodeId);

    if (!result)
        return null;

    const {
        node,
        ancestors
    } = result;

    if (modelId === "__node__") {
        return {
            node,
            ancestors,

            model: {
                id: "__node__",
                name: node.modelId || "",
                remark: "",
                type: "chat"
            }
        };
    }

    const model = node.models?.find(m => m.id === modelId);

    if (model) return {
        node,
        ancestors,
        model
    };

    return null;
}

// 从模型名自动推断类型
function detectModelType(name) {
	if (!name) return 'chat';
	var lower = name.toLowerCase();
	if (lower.indexOf('embedding') >= 0 || lower.indexOf('text-embedding') >= 0) return 'embedding';
	if (lower.indexOf('rerank') >= 0 || lower.indexOf('re-rank') >= 0) return 'rerank';
	return 'chat';
}

// 递归展平所有模型引用（用于清理已删除的引用）
function collectAllModelRefs(nodes) {
	const refs = [];
	for (const n of nodes) {
		if (n.models) n.models.forEach(m => refs.push(`${n.id}:${m.id}`));
		if (n.modelId) refs.push(`${n.id}:__node__`);
		if (n.children) refs.push(...collectAllModelRefs(n.children));
	}
	return refs;
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
			models: [],
			children: (g.models || []).map(m => ({
				id: m.id,
				name: m.name,
				type: detectModelType(m.name),
				baseUrl: '',
				style: '',
				key: '',
				modelId: m.name,
				remark: m.remark || '',
				models: [],
				children: []
			}))
		}));
		delete data.groups;
	}
	return data;
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
	const sessions = await storage.loadSessions();
	sessions.forEach(s => sessionsCache.set(s.id, s));
	updateDirectoryDisplay();
	await refreshUI();
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
		models: [],
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
				node.models?.forEach(m => keysToRemove.add(`${node.id}:${m.id}`));
				if (node.modelId) keysToRemove.add(`${node.id}:__node__`);
				node.children?.forEach(collectKeys);
			};
			collectKeys(nodes[index]);
			// 从 selectedModels 中移除
			selectedModels = selectedModels.filter(id => !keysToRemove.has(id));
			saveDefaultSelectedModels(selectedModels);
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

// 重新排序：将节点插入到同级目标位置
async function reorderNode(draggedId, targetId, insertBefore = true) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const moveInSiblings = (siblings) => {
		const draggedIndex = siblings.findIndex(n => n.id === draggedId);
		const targetIndex = siblings.findIndex(n => n.id === targetId);
		if (draggedIndex < 0 || targetIndex < 0) return false;
		const [dragged] = siblings.splice(draggedIndex, 1);
		let insertIndex = targetIndex;
		if (draggedIndex < targetIndex) {
			insertIndex = insertBefore ? targetIndex - 1 : targetIndex;
		} else if (draggedIndex > targetIndex) {
			insertIndex = insertBefore ? targetIndex : targetIndex + 1;
		}
		siblings.splice(insertIndex, 0, dragged);
		return true;
	};
	// 尝试在每一层兄弟中查找
	const searchSiblings = (siblings) => {
		if (moveInSiblings(siblings)) return true;
		for (const n of siblings) {
			if (n.children && searchSiblings(n.children)) return true;
		}
		return false;
	};
	const ok = searchSiblings(endpointsData.nodes);
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

// ========== 模型 CRUD（基于节点树） ==========

function getNode(nodeId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	return findNodeInTree(endpointsData.nodes, nodeId);
}

async function addModel(nodeId, modelName, remark) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const node = findNodeInTree(endpointsData.nodes, nodeId);
	if (node) {
		const model = { id: generateUUID(), name: modelName };
		model.type = detectModelType(modelName);
		if (remark) model.remark = remark;
		node.models.push(model);
		await saveEndpoints();
		return model;
	}
	return null;
}

async function updateModel(nodeId, modelId, data) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const node = findNodeInTree(endpointsData.nodes, nodeId);
	const model = node?.models?.find(m => m.id === modelId);
	if (model) {
		if (data.name !== undefined) { model.name = data.name; model.type = detectModelType(data.name); }
		if (data.remark !== undefined) model.remark = data.remark || '';
		await saveEndpoints();
		return model;
	}
	return null;
}

async function deleteModel(nodeId, modelId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const node = findNodeInTree(endpointsData.nodes, nodeId);
	if (node) {
		const index = node.models?.findIndex(m => m.id === modelId) ?? -1;
		if (index >= 0) {
			node.models.splice(index, 1);
			await saveEndpoints();
			return true;
		}
	}
	return false;
}

async function reorderModels(nodeId, draggedModelId, targetModelId, insertBefore) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const node = findNodeInTree(endpointsData.nodes, nodeId);
	if (!node || !node.models) return false;
	const draggedIndex = node.models.findIndex(m => m.id === draggedModelId);
	const targetIndex = node.models.findIndex(m => m.id === targetModelId);
	if (draggedIndex >= 0 && targetIndex >= 0) {
		const [draggedModel] = node.models.splice(draggedIndex, 1);
		let insertIndex = targetIndex;
		if (draggedIndex < targetIndex) {
			insertIndex = insertBefore ? targetIndex - 1 : targetIndex;
		} else if (draggedIndex > targetIndex) {
			insertIndex = insertBefore ? targetIndex : targetIndex + 1;
		}
		node.models.splice(insertIndex, 0, draggedModel);
		await saveEndpoints();
		return true;
	}
	return false;
}

function getModel(nodeId, modelId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const node = findNodeInTree(endpointsData.nodes, nodeId);
	return node?.models?.find(m => m.id === modelId);
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
		if (targetModels) msg.targetModels = targetModels;
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
		if (options.targetModels) message.targetModels = options.targetModels;
	} else if (role === 'assistant') {
		if (options.responses) message.responses = options.responses;
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

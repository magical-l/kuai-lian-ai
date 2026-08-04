// ========== Store Functions ==========
let endpointsData = null;
let sessionsCache = new Map();
let endpointsMutationQueue = Promise.resolve();
const sessionMutationQueues = new Map();
const sessionMigrationPromises = new WeakMap();

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

function resolveTreeMove(nodes, draggedId, targetId) {
	const dragged = findNodeInTree(nodes, draggedId);
	const target = findNodeInTree(nodes, targetId);
	if (!dragged || !target || findNodeInTree([dragged], targetId)) return null;
	return { dragged, target };
}

function resolveNodeConfig(nodeId) {
    if (!endpointsData) endpointsData = {
        nodes: []
    };

    const result = findNodeWithAncestors(endpointsData.nodes, nodeId);

    if (!result)
        return null;

    const {
        node,
        ancestors
    } = result;

    const fields = ["baseUrl", "style", "key", "modelId", "type", "directUrl"];
    const config = {};

    for (const f of fields)
        config[f] = node[f] || "";

    for (let i = ancestors.length - 1; i >= 0; i--) {
        for (const f of fields) {
            if (!config[f] && ancestors[i][f])
                config[f] = ancestors[i][f];
        }
    }

    config.params = {};
    if (node.params) {
        for (var k in node.params) {
            if (node.params.hasOwnProperty(k)) config.params[k] = node.params[k];
        }
    }
    // backward compat: old nodes store voice/instruction as top-level fields
    if (node.voice && !config.params.hasOwnProperty('voice')) config.params.voice = node.voice;
    if (node.instruction && !config.params.hasOwnProperty('instruction')) config.params.instruction = node.instruction;
    for (var i = ancestors.length - 1; i >= 0; i--) {
        var ap = ancestors[i].params;
        if (ap) {
            for (var k in ap) {
                if (ap.hasOwnProperty(k) && !config.params.hasOwnProperty(k)) {
                    config.params[k] = ap[k];
                }
            }
        }
    }

    if (!config.type) {
        config.type = detectModelType(config.modelId);
    }

    var typeAliases = {
        "img-generate": "image-generation",
        "image": "image-generation",
        "embed": "embedding",
        "rerank": "reranking",
        "video": "video-generation"
    };

    if (typeAliases[config.type])
        config.type = typeAliases[config.type];

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

function detectModelType(name) {
    if (!name)
        return "chat";

    var lower = name.toLowerCase();

    if (lower.indexOf("embedding") >= 0 || lower.indexOf("text-embedding") >= 0 || lower === "embed" || lower === "embedding")
        return "embedding";

    if (lower.indexOf("reranking") >= 0 || lower.indexOf("rerank") >= 0 || lower.indexOf("re-rank") >= 0)
        return "reranking";

    if (lower.indexOf("whisper") >= 0 || lower.indexOf("transcrib") >= 0 || lower.indexOf("asr") >= 0)
        return "asr";

    if (lower.indexOf("tts") >= 0 || lower.indexOf("audio") >= 0 ||
        lower.indexOf("speech") >= 0 || lower.indexOf("voice") >= 0)
        return "tts";

    if (lower.indexOf("image") >= 0 || lower.indexOf("dall-e") >= 0 || lower.indexOf("diffusion") >= 0 || lower.indexOf("flux") >= 0 || lower.indexOf("imagen") >= 0)
        return "image-generation";

    if (lower.indexOf("video") >= 0 || lower.indexOf("seedance") >= 0 || lower.indexOf("kling") >= 0)
        return "video-generation";

    return "chat";
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
	await storage.clearAll();
	endpointsData = { nodes: [] };
	sessionsCache.clear();
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
	for (const session of sessions) await migrateSession(session);
	sessionsCache.clear();
	for (const session of sessions) sessionsCache.set(session.id, session);
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

function snapshotData(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function enqueueMutation(queue, operation) {
	const result = queue.then(operation, operation);
	return { result, queue: result.catch(() => {}) };
}

function restoreObject(target, snapshot) {
	for (const key of Object.keys(target)) delete target[key];
	Object.assign(target, snapshotData(snapshot));
}

function checkpointEndpoints(data) {
	const references = new Map();
	function collect(nodes) {
		for (const node of nodes) {
			references.set(node.id, { node, children: node.children });
			if (node.children) collect(node.children);
		}
	}
	collect(data.nodes || []);
	return { data, references, snapshot: snapshotData(data) };
}

function restoreEndpoints(checkpoint) {
	const { data, references, snapshot } = checkpoint;
	function restoreNode(nodeSnapshot) {
		const reference = references.get(nodeSnapshot.id);
		const node = reference.node;
		for (const key of Object.keys(node)) delete node[key];
		for (const key of Object.keys(nodeSnapshot)) {
			node[key] = key === 'children' ? reference.children : snapshotData(nodeSnapshot[key]);
		}
		if (nodeSnapshot.children) {
			const restoredChildren = nodeSnapshot.children.map(restoreNode);
			reference.children.splice(0, reference.children.length, ...restoredChildren);
		}
		return node;
	}
	for (const key of Object.keys(data)) delete data[key];
	for (const key of Object.keys(snapshot)) {
		data[key] = key === 'nodes' ? checkpoint.nodes : snapshotData(snapshot[key]);
	}
	checkpoint.nodes.splice(0, checkpoint.nodes.length, ...(snapshot.nodes || []).map(restoreNode));
}

function persistEndpointsMutation(mutate) {
	const queued = enqueueMutation(endpointsMutationQueue, async () => {
		const checkpoint = checkpointEndpoints(endpointsData || { nodes: [] });
		checkpoint.nodes = checkpoint.data.nodes || [];
		const hasSelectedEndpoints = typeof selectedEndpoints !== 'undefined';
		const previousSelection = hasSelectedEndpoints ? selectedEndpoints.slice() : [];
		try {
			const result = mutate();
			if (result === false || result === null) return result;
			await saveEndpoints();
			return result;
		} catch (error) {
			restoreEndpoints(checkpoint);
			if (hasSelectedEndpoints) {
				selectedEndpoints = previousSelection;
				try {
					saveDefaultSelectedEndpoints(selectedEndpoints);
				} catch (_) {}
			}
			throw error;
		}
	});
	endpointsMutationQueue = queued.queue;
	return queued.result;
}

function persistSessionMutation(session, mutate) {
	const previousQueue = sessionMutationQueues.get(session.id) || Promise.resolve();
	const queued = enqueueMutation(previousQueue, async () => {
		const previous = snapshotData(session);
		try {
			const result = mutate();
			await saveSession(session);
			return result;
		} catch (error) {
			restoreObject(session, previous);
			throw error;
		}
	});
	sessionMutationQueues.set(session.id, queued.queue);
	queued.queue.finally(() => {
		if (sessionMutationQueues.get(session.id) === queued.queue) sessionMutationQueues.delete(session.id);
	});
	return queued.result;
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
		params: data.params || {},
		customParams: data.customParams || [],
		children: []
	};
	return persistEndpointsMutation(() => {
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
		return node;
	});
}

// 批量创建子树：一次 save 插入所有节点
async function batchAddNodes(parentId, subtrees) {
	if (!endpointsData) endpointsData = { nodes: [] };
	if (storage.mode !== 'browser' && !storage.getDirectoryName()) {
		alert('请先选择存储位置');
		return null;
	}
	return persistEndpointsMutation(() => {
		const createdIds = [];
		const parent = parentId ? findNodeInTree(endpointsData.nodes, parentId) : null;
		function createSubtree(source) {
			const node = {
				id: generateUUID(),
				name: source.name || '',
				baseUrl: source.baseUrl || '',
				style: source.style || '',
				key: source.key || '',
				modelId: source.modelId || '',
				remark: source.remark || '',
				type: source.type || '',
				children: []
			};
			createdIds.push(node.id);
			if (source.children && source.children.length > 0) {
				node.children = source.children.map(createSubtree);
			}
			return node;
		}
		const destination = parent ? parent.children : endpointsData.nodes;
		for (const subtree of subtrees) destination.push(createSubtree(subtree));
		return createdIds;
	});
}

async function updateNode(nodeId, updates) {
	if (!endpointsData) endpointsData = { nodes: [] };
	return persistEndpointsMutation(() => {
		const node = findNodeInTree(endpointsData.nodes, nodeId);
		if (!node) return false;
		Object.assign(node, updates);
		return node;
	});
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
	return persistEndpointsMutation(() => removeRecursive(endpointsData.nodes, nodeId));
}

async function cloneNode(nodeId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	return persistEndpointsMutation(() => {
		const result = findNodeWithAncestors(endpointsData.nodes, nodeId);
		if (!result) return null;
		const { node, ancestors } = result;
		function deepClone(source) {
			const cloned = {
				id: generateUUID(),
				name: source.name,
				baseUrl: source.baseUrl || '',
				style: source.style || '',
				key: source.key || '',
				modelId: source.modelId || '',
				remark: source.remark || '',
				type: source.type || '',
				params: snapshotData(source.params || {}),
				customParams: snapshotData(source.customParams || []),
				children: []
			};
			if (source.children && source.children.length > 0) {
				cloned.children = source.children.map(deepClone);
			}
			return cloned;
		}
		const cloned = deepClone(node);
		cloned.name = node.name + '（副本）';
		const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
		const siblings = parent ? parent.children : endpointsData.nodes;
		const index = siblings.findIndex(sibling => sibling.id === nodeId);
		if (index >= 0) siblings.splice(index + 1, 0, cloned);
		else siblings.push(cloned);
		return cloned;
	});
}

// 重新排序：将节点插入到目标位置（同级或跨级均可）
async function reorderNode(draggedId, targetId, insertBefore = true) {
	if (!endpointsData) return false;

	const removeNode = (siblings) => {
		const idx = siblings.findIndex(n => n.id === draggedId);
		if (idx >= 0) {
			siblings.splice(idx, 1);
			return true;
		}
		for (const n of siblings) {
			if (n.children && removeNode(n.children)) return true;
		}
		return false;
	};

	let ok = false;
	let draggedNode = null;
	const insertAtTarget = (siblings) => {
		const idx = siblings.findIndex(n => n.id === targetId);
		if (idx >= 0) {
			siblings.splice(insertBefore ? idx : idx + 1, 0, draggedNode);
			ok = true;
			return true;
		}
		for (const n of siblings) {
			if (n.children && insertAtTarget(n.children)) return true;
		}
		return false;
	};

	return persistEndpointsMutation(() => {
		const move = resolveTreeMove(endpointsData.nodes, draggedId, targetId);
		if (!move) return false;
		draggedNode = move.dragged;
		removeNode(endpointsData.nodes);
		insertAtTarget(endpointsData.nodes);
		return ok;
	});
}

// 将节点移动为另一个节点的子节点
async function moveNodeAsChild(draggedId, targetParentId) {
	if (!endpointsData) return false;
	const removeRecursive = (siblings) => {
		const index = siblings.findIndex(node => node.id === draggedId);
		if (index >= 0) return siblings.splice(index, 1)[0];
		for (const node of siblings) {
			if (node.children) {
				const removed = removeRecursive(node.children);
				if (removed) return removed;
			}
		}
		return null;
	};
	return persistEndpointsMutation(() => {
		const move = resolveTreeMove(endpointsData.nodes, draggedId, targetParentId);
		if (!move) return false;
		const dragged = removeRecursive(endpointsData.nodes);
		if (!dragged) return false;
		if (!move.target.children) move.target.children = [];
		move.target.children.push(dragged);
		return true;
	});
}

// ========== 节点查询 ==========

function getNode(nodeId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	return findNodeInTree(endpointsData.nodes, nodeId);
}

// ========== 会话管理（不变） ==========

async function loadSessionsIndex() {
	const sessions = await storage.loadSessions();
	for (const session of sessions) await migrateSession(session);
	sessionsCache.clear();
	for (const session of sessions) sessionsCache.set(session.id, session);
	return sessions;
}

function getAllSessions() {
	return Array.from(sessionsCache.values());
}

function updateSession(sessionId, mutate) {
	const session = sessionsCache.get(sessionId);
	if (!session) return Promise.resolve(null);
	return persistSessionMutation(session, () => mutate(session));
}

async function createSession(firstMessage = null, targetModels = null, modelParams = null) {
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
	if (modelParams) session.modelParams = snapshotData(modelParams);
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
	await saveSession(session);
	sessionsCache.set(session.id, session);
	return session;
}

async function loadSession(sessionId) {
	if (sessionsCache.has(sessionId)) {
		const cached = sessionsCache.get(sessionId);
		await migrateSession(cached);
		return cached;
	}
	const session = await storage.loadSession(sessionId);
	if (!session) return session;
	await migrateSession(session);
	sessionsCache.set(session.id, session);
	return session;
}

async function saveSession(session) {
	return await storage.saveSession(session);
}

function migrateSession(session) {
	const inProgress = sessionMigrationPromises.get(session);
	if (inProgress) return inProgress;

	let changed = false;
	const newMessages = [];

	for (const msg of session.messages) {
		if (msg.role === 'assistant' && msg.responses) {
			for (const r of msg.responses) {
				const m = { role: 'assistant', timestamp: r.timestamp || msg.timestamp || Date.now() };
				for (const k of Object.keys(r)) {
					m[k] = r[k];
				}
				if (!m.endpointId && m.modelId) {
					m.endpointId = m.modelId;
					delete m.modelId;
				}
				newMessages.push(m);
			}
			changed = true;
		} else {
			const copy = { ...msg };
			if (copy.role === 'assistant') {
				if (!copy.endpointId && copy.modelId) {
					copy.endpointId = copy.modelId;
					delete copy.modelId;
					changed = true;
				}
				if (copy.content && Array.isArray(copy.content)) {
					delete copy.content;
					changed = true;
				}
				if (copy.responses) {
					delete copy.responses;
					changed = true;
				}
				if (copy.endpointGroupId) { delete copy.endpointGroupId; changed = true; }
				if (copy.usage) { delete copy.usage; changed = true; }
			}
			newMessages.push(copy);
		}
	}

	if (!changed) return Promise.resolve(session);

	const migration = persistSessionMutation(session, () => {
		session.messages = newMessages;
		return session;
	});
	sessionMigrationPromises.set(session, migration);
	const clearMigration = () => {
		if (sessionMigrationPromises.get(session) === migration) sessionMigrationPromises.delete(session);
	};
	migration.then(clearMigration, clearMigration);
	return migration;
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

	// 新格式：每条 response 是独立 assistant 消息
	if (options.responses) {
		return persistSessionMutation(session, () => {
			for (const r of options.responses) {
				const msg = { role: 'assistant', timestamp: r.timestamp || Date.now() };
				// 复制 response 所有字段到消息级别
				for (const k of Object.keys(r)) {
					msg[k] = r[k];
				}
				// 兼容 modelId → endpointId
				if (!msg.endpointId && msg.modelId) {
					msg.endpointId = msg.modelId;
					delete msg.modelId;
				}
				session.messages.push(msg);
			}
			return session.messages[session.messages.length - 1];
		});
	}

	const message = { role, timestamp: Date.now() };
	if (typeof content === 'string') {
		message.content = [{ type: 'text', text: content }];
	} else if (Array.isArray(content)) {
		message.content = content;
	} else {
		message.content = [{ type: 'text', text: '' }];
	}
	if (role === 'user') {
		if (options.targetEndpoints) message.targetEndpoints = options.targetEndpoints;
	} else if (role === 'assistant') {
		if (options.endpointId) {
			message.endpointId = options.endpointId;
			message.endpointGroupId = options.endpointGroupId;
			if (options.usage) message.usage = options.usage;
		}
	}
	return persistSessionMutation(session, () => {
		if (role === 'user' && session.messages.filter(m => m.role === 'user').length === 0) {
			const firstText = message.content.find(c => c.type === 'text');
			session.title = firstText ? firstText.text.slice(0, 20) : '新会话';
		}
		session.messages.push(message);
		return message;
	});
}

function getSession(sessionId) {
	return sessionsCache.get(sessionId);
}

async function deleteSession(sessionId) {
	const previousQueue = sessionMutationQueues.get(sessionId) || Promise.resolve();
	const queued = enqueueMutation(previousQueue, async () => {
		await storage.deleteSession(sessionId);
		sessionsCache.delete(sessionId);
	});
	sessionMutationQueues.set(sessionId, queued.queue);
	queued.queue.finally(() => {
		if (sessionMutationQueues.get(sessionId) === queued.queue) sessionMutationQueues.delete(sessionId);
	});
	return queued.result;
}

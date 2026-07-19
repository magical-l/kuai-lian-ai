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

    const fields = ["baseUrl", "style", "key", "modelId", "type"];
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
        "rerank": "reranking"
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

    if (lower.indexOf("tts") >= 0 || lower.indexOf("audio") >= 0 ||
        lower.indexOf("speech") >= 0 || lower.indexOf("voice") >= 0)
        return "tts";

    if (lower.indexOf("image") >= 0 || lower.indexOf("dall-e") >= 0 || lower.indexOf("diffusion") >= 0 || lower.indexOf("flux") >= 0)
        return "image-generation";

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
	sessions.forEach(s => { migrateSession(s); sessionsCache.set(s.id, s); });
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

// 批量创建子树：一次 save 插入所有节点
async function batchAddNodes(parentId, subtrees) {
	if (!endpointsData) endpointsData = { nodes: [] };
	if (storage.mode !== 'browser' && !storage.getDirectoryName()) {
		alert('请先选择存储位置');
		return null;
	}
	var createdIds = [];
	var batchParent = parentId ? findNodeInTree(endpointsData.nodes, parentId) : null;
	function assignIds(nodes, parent) {
		nodes.forEach(function(n) {
			var node = {
				id: generateUUID(),
				name: n.name || '',
				baseUrl: n.baseUrl || '',
				style: n.style || '',
				key: n.key || '',
				modelId: n.modelId || '',
				remark: n.remark || '',
				type: n.type || '',
				children: []
			};
			createdIds.push(node.id);
			if (n.children && n.children.length > 0) {
				assignIds(n.children, node);
			}
			if (parent) {
				parent.children.push(node);
			} else {
				// 根级节点
				if (batchParent) { batchParent.children.push(node); }
				else if (parentId) {
					var p = findNodeInTree(endpointsData.nodes, parentId);
					if (p) p.children.push(node);
					else endpointsData.nodes.push(node);
				} else {
					endpointsData.nodes.push(node);
				}
			}
		});
	}
	assignIds(subtrees, null);
	await saveEndpoints();
	return createdIds;
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

async function cloneNode(nodeId) {
	if (!endpointsData) endpointsData = { nodes: [] };
	const result = findNodeWithAncestors(endpointsData.nodes, nodeId);
	if (!result) return null;
	const { node, ancestors } = result;

	function deepClone(n) {
		const c = {
			id: generateUUID(),
			name: n.name,
			baseUrl: n.baseUrl || '',
			style: n.style || '',
			key: n.key || '',
			modelId: n.modelId || '',
			remark: n.remark || '',
			type: n.type || '',
			children: []
		};
		if (n.children && n.children.length > 0) {
			c.children = n.children.map(child => deepClone(child));
		}
		return c;
	}

	const cloned = deepClone(node);
	cloned.name = node.name + '（副本）';

	const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
	const siblings = parent ? parent.children : endpointsData.nodes;
	const idx = siblings.findIndex(n => n.id === nodeId);
	if (idx >= 0) {
		siblings.splice(idx + 1, 0, cloned);
	} else {
		siblings.push(cloned);
	}

	await saveEndpoints();
	return cloned;
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
		migrateSession(s);
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
	if (sessionsCache.has(sessionId)) {
		const cached = sessionsCache.get(sessionId);
		// 缓存中的会话可能未迁移（loadSessionsIndex 在历史版本中未调 migrateSession）
		migrateSession(cached);
		return cached;
	}
	const session = await storage.loadSession(sessionId);
	if (session) {
		migrateSession(session);
		sessionsCache.set(session.id, session);
	}
	return session;
}

async function saveSession(session) {
	return await storage.saveSession(session);
}

// 会话格式迁移：存量数据归一化——每条 response 是独立 assistant 消息
function migrateSession(session) {
	let changed = false;
	const newMessages = [];

	for (const msg of session.messages) {
		if (msg.role === 'assistant' && msg.responses) {
			// 格式 2（当前）：responses 数组 → flat 为 N 条独立消息
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
			// 用户消息 / 已 flat 的 assistant 消息
			const copy = { ...msg };
			if (copy.role === 'assistant') {
				if (!copy.endpointId && copy.modelId) {
					copy.endpointId = copy.modelId;
					delete copy.modelId;
					changed = true;
				}
				// 旧 assistant 消息残留的空 content[] 删掉
				if (copy.content && Array.isArray(copy.content)) {
					delete copy.content;
					changed = true;
				}
				// 确保没有残留的 responses 字段
				if (copy.responses) {
					delete copy.responses;
					changed = true;
				}
				// 清理旧单端点格式的残留同级字段
				if (copy.endpointGroupId) { delete copy.endpointGroupId; changed = true; }
				if (copy.usage) { delete copy.usage; changed = true; }
			}
			newMessages.push(copy);
		}
	}

	if (changed) {
		session.messages = newMessages;
		saveSession(session).catch(err => console.error('migrate: save failed', err));
	}
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
		await saveSession(session);
		return session.messages[session.messages.length - 1];
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

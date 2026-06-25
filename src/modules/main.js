// ========== Main Logic ==========
function loadDefaultSelectedEndpoints() {
	try {
		const saved = localStorage.getItem('defaultSelectedEndpoints');
		const refs = saved ? JSON.parse(saved) : [];
		return refs.map(function(r) { return r.includes(':') ? r.split(':')[0] : r; });
	} catch {
		return [];
	}
}

function saveDefaultSelectedEndpoints(endpoints) {
	localStorage.setItem('defaultSelectedEndpoints', JSON.stringify(endpoints));
}
let defaultSelectedEndpoints = loadDefaultSelectedEndpoints();
let currentSession = null;
let selectedEndpoints = []; // 当前选中端点ID数组
let sessionGenerations = new Map(); // 按会话隔离的生成状态：Map<sessionId, Map<endpointId, state>>
let lastUserMessage = null;
let pendingAttachments = []; // 待发送的附件列表
async function init() {
	initDividers();
	initScrollNav();
	initScrollPaddingObserver();
	let sendOnEnter = localStorage.getItem('sendMode') !== 'ctrl-enter';
	let inputMode = "chat"; // "chat" | "embedding"
	const chatInput = $('#chat-input');
	chatInput.on('keydown', e => {
		if (e.key === 'Enter') {
			if (sendOnEnter && !e.shiftKey && !e.ctrlKey) {
				e.preventDefault();
				if (inputMode === "embedding") handleEmbeddingSend();
				else handleSend();
			} else if (!sendOnEnter && e.ctrlKey) {
				e.preventDefault();
				if (inputMode === "embedding") handleEmbeddingSend();
				else handleSend();
			}
		}
	});
	// 分裂式按钮：发送模式切换
	const btnGroup = $('.send-btn-group');
	const toggle = $('.send-mode-toggle');
	const options = $$('.option', btnGroup);
	// 初始化选中状态
	if (!sendOnEnter) {
		options[0].classList.remove('selected');
		options[1].classList.add('selected');
	}
	// 点击下拉按钮
	toggle.on('click', e => {
		e.stopPropagation();
		btnGroup.classList.toggle('open');
	});
	// 选择选项
	options.forEach(opt => {
		opt.on('click', e => {
			e.stopPropagation();
			const value = opt.dataset.value;
			sendOnEnter = value === 'enter';
			localStorage.setItem('sendMode', value);
			// 更新选中状态
			options.forEach(o => o.classList.remove('selected'));
			opt.classList.add('selected');
			btnGroup.classList.remove('open');
		});
	});
	// 点击外部关闭
	document.on('click', () => {
		btnGroup.classList.remove('open');
	});
	// 粘贴图片处理
	chatInput.on('paste', async (e) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file) {
					await addAttachment(file);
					// 不阻止默认行为，允许同时粘贴文字
				}
			}
		}
	});
	// 先尝试恢复已保存的存储
	const result = await tryRestoreDirectory();
	if (!result.success) {
		showDirectoryPrompt(result.needUserAction);
	} else {
		if (defaultSelectedEndpoints.length > 0) {
			selectedEndpoints = [...defaultSelectedEndpoints];
		}
		// 迁移旧格式引用
		selectedEndpoints = selectedEndpoints.map(function(r) { return r.includes(':') ? r.split(':')[0] : r; });
		saveDefaultSelectedEndpoints(selectedEndpoints);
		updateDirectoryDisplay();
		await refreshUI();
	}
	$('.add-group').onclick = handleAddGroup;
	$('.collapse-all').onclick = collapseAllEndpointNodes;
	$('.collapse-all').innerHTML = SVG.collapseAll;
	$('.test-all').onclick = function() {
		var allIds = [];
		function collectIds(nodes) {
			nodes.forEach(function(n) {
				var rcfg = resolveNodeConfig(n.id);
				if (rcfg && rcfg.baseUrl) allIds.push(n.id);
				if (n.children) collectIds(n.children);
			});
		}
		collectIds(getGroups());
		allIds.forEach(function(id) { testConnection(id); });
	};
	$('.test-all').innerHTML = SVG.testAll;
	$('.send').onclick = () => {
		if (inputMode === 'embedding') {
			handleEmbeddingSend();
		} else {
			handleSend();
		}
	};
	document.querySelectorAll('.mode-selector .option').forEach(el => {
		el.onclick = () => {
			document.querySelector('.mode-selector .selected')?.classList.remove('selected');
			el.classList.add('selected');
			inputMode = el.dataset.mode;
			console.log("Mode:", inputMode);
			const input = $('#chat-input');
			input.placeholder = inputMode === 'chat' ? '输入消息...' : '输入要嵌入的文本...';
			$('.add.attachment.btn').style.display = inputMode === 'chat' ? '' : 'none';
			$('.file-input').style.display = inputMode === 'chat' ? '' : 'none';
		};
	});
	$('.stop.btn').onclick = () => {
		stopAllGenerations();
		setButtonState(false, false);
		renderSelectedEndpoints(getGroups(), selectedEndpoints, false);
	};
	$('.help').onclick = async () => {
		const saved = await storage.hasSavedHandle();
		showHelpDialog(false, !!saved);
	};
	$('.new-session').onclick = handleNewSession;
	$('.delete-dir').onclick = handleDeleteDirectory;
	$('.wipe-dir').onclick = handleWipeDirectory;
	// 附件按钮
	$('.add.attachment.btn').onclick = () => {
		$('.file-input').click();
	};
	$('.file-input').onchange = async (e) => {
		const files = e.target.files;
		if (files && files.length > 0) {
			for (const file of files) {
				await addAttachment(file);
			}
		}
		e.target.value = ''; // 清空以便再次选择相同文件
		renderPendingAttachments();
	};
	// 更换目录按钮
	$('.change-dir').onclick = async () => {
		const success = await selectDirectory();
		if (success) {
			updateDirectoryDisplay();
			await refreshUI();
		}
	};
}
async function handleDeleteDirectory() {
	const msg = storage.mode === 'browser' ? '确定清除浏览器存储中的所有数据？此操作不可恢复。' : '确定删除当前目录配置？删除后需要重新选择目录。（磁盘上的数据文件不会被删除）';
	confirmAction(msg, async () => {
		await clearDirectory();
		showDirectoryPrompt(false);
	});
}
async function handleWipeDirectory() {
	if (storage.mode === 'browser') {
		confirmAction('确定清空浏览器存储中的所有数据？\n这将删除所有端点配置和会话记录。\n此操作不可恢复！', () => {
			confirmAction('再次确认：这将永久删除所有端点配置和会话记录！', async () => {
				await clearDirectory();
				alert('数据已清空');
				showDirectoryPrompt(false);
			});
		});
		return;
	}
	if (!storage.getDirectoryName()) {
		alert('请先选择目录');
		return;
	}
	confirmAction('确定清空磁盘上的所有数据？\n这将删除 endpoints.json 和 sessions 目录中的所有会话记录。\n此操作不可恢复！', () => {
		confirmAction('再次确认：这将永久删除所有端点配置和会话记录！', async () => {
			try {
				if (window.__IS_EXTENSION__) {
					await storage.clearAll();
				} else {
					await DirectoryStorage.clearAll();
				}
				await clearDirectory();
				alert('数据已清空');
				showDirectoryPrompt(false);
			} catch (err) {
				alert('清空失败: ' + err.message);
			}
		});
	});
}
async function updateDirectoryDisplay() {
	const info = storage.getDisplayInfo();
	const dirPath = $('.tip');
	dirPath.textContent = info.text;
	dirPath.title = info.title;
}
async function refreshUI() {
    const groups = getGroups();
    const before = selectedEndpoints.length;
    selectedEndpoints = selectedEndpoints.filter(id => !!findModelById(groups, id));

    if (selectedEndpoints.length !== before) {
        saveDefaultSelectedEndpoints(selectedEndpoints);
    }

    if (currentSession && !sessionsCache.has(currentSession.id)) {
        currentSession = null;
    }

    const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
    const isGenerating = gens && gens.size > 0 && Array.from(gens.values()).some(s => s.status === "generating");
    renderSelectedEndpoints(groups, selectedEndpoints, isGenerating);

    renderEndpointList(
        groups,
        handleNodeEdit,
        handleNodeDelete,
        handleReorderNode,
        testConnection,
        handleMoveNodeAsChild
    );

    const sessions = getAllSessions();

    renderSessionList(
        sessions,
        currentSession?.id,
        handleSessionSelect,
        handleSessionEdit,
        handleSessionDelete
    );

    if (currentSession) {
        renderMessages(currentSession.messages, groups, handleCopy);
    } else {
        $("#chat-messages").innerHTML = "";
    }
}

function updateChatTitleDisplay() {
	if (currentSession) {
		updateChatTitle(currentSession.title);
	} else {
		updateChatTitle(null);
	}
}
async function handleSessionSelect(sessionId) {
	currentSession = await loadSession(sessionId);
	// 从会话的最后用户消息恢复端点集
	const lastUserMsg = currentSession.messages.filter(m => m.role === 'user').pop();
	var targets = lastUserMsg?.targetEndpoints || lastUserMsg?.targetModels;
	if (targets) {
		selectedEndpoints = [...targets];
	} else {
		selectedEndpoints = [...defaultSelectedEndpoints];
	}
	// 迁移旧格式引用
	selectedEndpoints = selectedEndpoints.map(function(r) { return r.includes(':') ? r.split(':')[0] : r; });
	saveDefaultSelectedEndpoints(selectedEndpoints);
	lastUserMessage = lastUserMsg?.content || null;
	// 获取当前会话的生成状态
	const gens = sessionGenerations.get(sessionId);
	const sessionModels = gens ? Array.from(gens.entries()) : [];
	await refreshUI();
	// 只有正在生成的端点才需要恢复流式卡片（已完成的已保存到消息中）
	const generatingModels = sessionModels.filter(([id, state]) => state.status === 'generating');
	// 如果有正在生成的端点，恢复显示流式卡片
	if (generatingModels.length > 0) {
		const groups = getGroups();
		const allEndpointIds = sessionModels.map(([id]) => id);
		showThinkingCards(allEndpointIds, groups, sessionId);
		// 恢复各状态端点的内容（但只恢复 generating 状态的）
		generatingModels.forEach(([id, state]) => {
			if (state.content || state.thinking) {
				updateStreamingCard(id, state, state.firstTokenTime, groups, sessionId);
			}
		});
		// 恢复按钮状态
		setButtonState(true, true);
		renderSelectedEndpoints(groups, selectedEndpoints, true);
	}
	// 如果所有端点都已完成/失败/停止，清理状态（不再需要恢复）
	const allDone = sessionModels.length > 0 && sessionModels.every(([id, state]) => state.status === 'completed' || state.status === 'failed' || state.status === 'stopped');
	if (allDone) {
		sessionGenerations.delete(sessionId);
	}
}

function handleSessionEdit(sessionId, newTitle) {
	// 原地编辑模式：直接更新会话标题
	const session = getSession(sessionId);
	if (session && newTitle) {
		session.title = newTitle;
		saveSession(session);
		refreshUI();
	}
}
async function handleSessionDelete(sessionId) {
	// 停止并删除该会话的生成状态
	deleteSessionGenerations(sessionId);
	await deleteSession(sessionId);
	if (currentSession?.id === sessionId) {
		currentSession = null;
	}
	await refreshUI();
}

function handleAddGroup() {
	showEditGroupDialog(null, null, async (data) => {
		await addNode(null, data);
		await refreshUI();
	});
}

function handleNodeEdit(nodeId) {
	const node = getNode(nodeId);
	if (!node) return;
	showEditGroupDialog(node, null, async (data) => {
		clearTestResults(nodeId);
		await updateNode(nodeId, data);
		await refreshUI();
	});
}
async function handleNodeDelete(nodeId) {
	// 清理 selectedEndpoints 中属于该端点的引用
	selectedEndpoints = selectedEndpoints.filter(id => {
		const parts = id.split(':');
		return parts[0] !== nodeId;
	});
	saveDefaultSelectedEndpoints(selectedEndpoints);
	await deleteNode(nodeId);
	await refreshUI();
}

function handleCopy(content) {
	navigator.clipboard.writeText(content).then(() => {
		// 可选：显示复制成功提示
	});
}

async function handleReorderNode(draggedId, targetId, insertBefore) {
	clearTestResults(draggedId);
	await reorderNode(draggedId, targetId, insertBefore);
	await refreshUI();
}
async function handleMoveNodeAsChild(draggedId, targetParentId) {
	clearTestResults(draggedId);
	await moveNodeAsChild(draggedId, targetParentId);
	await refreshUI();
}
async function handleSend() {
	const content = await getInputMessage();
	if (!content || content.length === 0) return; // 处理失败或无文本无附件
	if (selectedEndpoints.length === 0) {
		renderSelectedEndpoints(getGroups(), selectedEndpoints, false);
		return;
	}
	let isNewSession = false;
	if (!currentSession) {
		currentSession = await createSession(content, [...selectedEndpoints]);
		isNewSession = true;
	}
	// Only addMessage if NOT a new session (createSession already added first message)
	if (!isNewSession) {
		await addMessage(currentSession.id, 'user', content, {
			targetEndpoints: [...selectedEndpoints]
		});
	}
	// 提取纯文本用于 lastUserMessage
	const textContent = content.filter(c => c.type === 'text' || c.type === 'file_text').map(c => c.text || '').join('\n');
	lastUserMessage = textContent;
	clearInput();
	clearAttachments();
	setButtonState(true, true);
	renderSelectedEndpoints(getGroups(), selectedEndpoints, true);
	const groups = getGroups();
	const messages = currentSession.messages.map(m => {
		if (m.role === 'assistant' && m.responses) {
			// Multi-model format: concatenate all successful response contents
			const content = m.responses.filter(r => r.status === 'completed' && r.content).map(r => r.content).join('\n\n---\n\n');
			return {
				role: m.role,
				content
			};
		}
		// 用户消息：使用 OpenAI 格式转换函数
		const normalized = normalizeMessageContent(m);
		return {
			role: m.role,
			content: toOpenAIContent(normalized)
		};
	});
	// 渲染用户消息
	renderMessages(currentSession.messages, groups, handleCopy);
	// 记录当前会话ID用于后台接收（在创建卡片前定义）
	const targetSessionId = currentSession.id;
	// 显示"思考中"状态卡片（使用 targetSessionId 标记）
	showThinkingCards(selectedEndpoints, groups, targetSessionId);
	const sortedModels = new Set();
	const responses = await callAllModels(groups, selectedEndpoints, messages, (endpointId, partialContent, firstTokenTime) => {
		updateStreamingCard(endpointId, partialContent, firstTokenTime, groups, targetSessionId);
		// 只在firstTokenTime首次有值时排序一次
		if (firstTokenTime != null && !sortedModels.has(endpointId)) {
			sortedModels.add(endpointId);
			reorderCardsBySpeed();
			reorderSelectorTagsBySpeed();
		}
	}, targetSessionId);
	await addMessage(targetSessionId, 'assistant', null, {
		responses
	});
	sessionGenerations.delete(targetSessionId);
	if (currentSession?.id === targetSessionId) {
		currentSession = await loadSession(targetSessionId);
		setButtonState(false, false);
		renderSelectedEndpoints(groups, selectedEndpoints, false);
		await refreshUI();
	}
}





async function handleEmbeddingSend() {
	const input = $('#chat-input');
	const text = input.value.trim();
	if (!text) return;
	if (selectedEndpoints.length === 0) {
		renderSelectedEndpoints(getGroups(), selectedEndpoints, false);
		return;
	}
	const endpointId = selectedEndpoints[0];
	const info = findModelById(getGroups(), endpointId);
	if (!info) {
		console.error('模型不存在:', endpointId);
		return;
	}
	clearInput();
	if (!currentSession) {
		currentSession = await createSession(null, []);
	}
	await addMessage(currentSession.id, 'user', [{ type: 'text', text: '🔢 嵌入: ' + text }], {
		targetEndpoints: [endpointId]
	});
	renderMessages(currentSession.messages, getGroups(), handleCopy);
	const container = $('#chat-messages');
	const msgEl = mk('article', 'msg response , flex items-go-y');
	msgEl.classList.add('streaming-embedding');
	const hint = mk('div', 'embedding-thinking');
	hint.textContent = '🔢 计算嵌入向量...';
	msgEl.addChild(hint);
	container.appendChild(msgEl);
	container.scrollTop = container.scrollHeight;
	try {
		const cfg = resolveNodeConfig(info.node.id);
		const result = await callEmbedding(cfg.style || 'openai', cfg.baseUrl, cfg.key, (info.node.modelId || info.node.name), text);
		const card = $('.streaming-embedding');
		if (card) card.remove();
		const emb = result.embedding;
		const dim = emb.length;
		const preview = '[' + emb.slice(0, 5).map(v => v.toFixed(6)).join(', ') + ', ...]';
		const fullJson = JSON.stringify(emb);
		await addMessage(currentSession.id, 'assistant', null, {
			responses: [{
				endpointId: endpointId,
				status: 'completed',
				content: '',
				embeddingResult: {
					dim,
					preview,
					fullJson,
					model: result.model || (info.node.modelId || info.node.name),
					usage: result.usage
				}
			}]
		});
		if (currentSession) {
			currentSession = await loadSession(currentSession.id);
			await refreshUI();
		}
	} catch (err) {
		const card = $('.streaming-embedding');
		if (card) card.remove();
		console.error('嵌入失败:', err);
		await addMessage(currentSession.id, 'assistant', null, {
			responses: [{
				endpointId: endpointId,
				status: 'failed',
				error: err.message
			}]
		});
		if (currentSession) {
			currentSession = await loadSession(currentSession.id);
			await refreshUI();
		}
	}
}



function showThinkingCards(endpoints, groups, sessionId) {
    const container = $("#chat-messages");
    // 移除该 session 已有的 streaming 元素（防重复触发）
    $$(`[data-session-id="${sessionId}"]`).forEach(el => el.remove());

    // 独立的提示栏（"N个模型正在思考..." + 全部停止按钮），不作为包装框
    const hint = mk('div', 'hint streaming-hint');
    hint.dataset.sessionId = sessionId;
    const hintText = mk('span', 'hint-text');
    hintText.textContent = `${endpoints.length}个端点正在思考...`;
    hint.appendChild(hintText);
    const stopBtn = mk('button', 'stop btn-stop-inline');
    stopBtn.textContent = '全部停止';
    hint.appendChild(stopBtn);
    stopBtn.onclick = () => {
        stopAllGenerations();
        stopBtn.disabled = true;
        stopBtn.textContent = "已停止";
        hintText.textContent = `${endpoints.length}个端点（部分已停止）`;
    };
    container.addChild(hint);

    endpoints.forEach(id => {
        const card = fromTemplate("response-card-streaming", ".one.response.msg");
        card.dataset.sessionId = sessionId;
        card.dataset.endpointId = id;
        const info = findModelById(groups, id);
        const name = info ? [...(info.ancestors || []).map(a => a.name), info.node.name].join(" / ") : "未知";
        $(".response .name", card).textContent = name;
        container.addChild(card);
    });
    scrollToBottom();
}

function updateStreamingCard(endpointId, state, firstTokenTime, groups, sessionId) {
	const card = $(`.one.response.msg[data-session-id="${sessionId}"][data-endpoint-id="${endpointId}"]`);
	if (!card) return;
	const thinkingBlock = $('.think', card);
	if (thinkingBlock) {
		if (state.thinking && state.thinking.trim()) {
			thinkingBlock.style.display = 'block';
			thinkingBlock.classList.add('streaming');
			const thinkingContent = $('.content', thinkingBlock);
			if (thinkingContent) {
				thinkingContent.textContent = state.thinking;
			}
			let thinkingHeader = $('.btn', thinkingBlock);
			if (thinkingHeader) {
				thinkingHeader.onclick = function() {
					toggleThinking(this);
				};
				if (state.thinkingDuration) {
					const durationEl = $('.duration', thinkingHeader);
					if (durationEl) {
						durationEl.textContent = `耗时 ${(state.thinkingDuration/1000).toFixed(1)}s`;
					}
				}
			}
		} else {
			thinkingBlock.style.display = 'none';
		}
	}
	const contentEl = $('.response .content', card);
	if (contentEl) {
		contentEl.textContent = state.content || '';
	}
	if (firstTokenTime !== null) {
		const meta = $('header', card);
		if (meta) {
			if (!$('.wait', meta)) {
				const durationEl = mk('span', `response wait ${getSpeedClass(firstTokenTime)}`);
				durationEl.textContent = `反应${(firstTokenTime/1000).toFixed(1)}s`;
				const modelNameEl = $('.name', meta);
				if (modelNameEl) {
					modelNameEl.insertAdjacentElement('afterend', durationEl);
				}
			}
		}
	}
}

function updateCardStatus(endpointId, status, error, state = null, sessionId = null) {
	requestAnimationFrame(() => {
		const selector = sessionId ? `.one.response.msg[data-session-id="${sessionId}"][data-endpoint-id="${endpointId}"]` : `.one.response.msg[data-endpoint-id="${endpointId}"]`;
		const card = $(selector);
		if (!card) return;
		const contentEl = $('.response .content', card);
		const meta = $('header', card);
		const icon = meta ? $('.status-icon', meta) : null;
		if (icon) {
			icon.classList.remove('spin');
			icon.classList.add('status');
			icon.classList.add(status);
			icon.textContent = getStatusText(status);
		}
		if (status === 'failed') {
			if (contentEl) {
				contentEl.textContent = ''; // Empty content for failed
			}
			if (meta && error && !$('.error', meta)) {
				const errorEl = mk('span', 'response error');
				errorEl.textContent = error;
				const statusEl = $('.status', meta) || icon;
				if (statusEl) {
					statusEl.insertAdjacentElement('afterend', errorEl);
				}
			}
		} else if (status === 'stopped') {} else if (status === 'completed') {
			if (state && state.thinkingDuration) {
				const thinkingBlock = $('.think', card);
				if (thinkingBlock) {
					thinkingBlock.classList.remove('streaming');
					thinkingBlock.classList.add('collapsed');
					const durationEl = $('.duration', thinkingBlock);
					if (durationEl) {
						durationEl.textContent = `耗时 ${(state.thinkingDuration/1000).toFixed(1)}s`;
					}
				}
			}
			if (state && state.totalDuration) {
				let totalEl = $('.total', meta);
				if (!totalEl) {
					totalEl = mk('span', 'response total');
					const insertAfter = $('.status', meta) || $('.status-icon', meta);
					if (insertAfter) {
						insertAfter.insertAdjacentElement('afterend', totalEl);
					} else {
						meta.addChild(totalEl);
					}
				}
				totalEl.textContent = `耗时${(state.totalDuration/1000).toFixed(1)}s`;
			}
		}
	});
}

function reorderCardsBySpeed() {
    requestAnimationFrame(() => {
        const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
        if (!gens) return;
        const container = $('#chat-messages');
        const cards = Array.from($$('.one.response.msg[data-session-id]', container));
        cards.sort((a, b) => {
            const stateA = gens.get(a.dataset.endpointId);
            const stateB = gens.get(b.dataset.endpointId);
            return (stateA?.firstTokenTime ?? Infinity) - (stateB?.firstTokenTime ?? Infinity);
        });
        cards.forEach(c => container.appendChild(c));
    });
}

function reorderSelectorTagsBySpeed() {
	const summaryEl = $('.selected.endpoint.list');
	if (!summaryEl) return;
	const tags = Array.from(summaryEl.querySelectorAll('.one.endpoint'));
	if (tags.length === 0) return;
	const originalTags = [...tags];
	const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
	const sortedTags = tags.sort((a, b) => {
		const aTime = gens ? gens.get(a.dataset.endpoint)?.firstTokenTime : undefined;
		const bTime = gens ? gens.get(b.dataset.endpoint)?.firstTokenTime : undefined;
		return (aTime ?? Infinity) - (bTime ?? Infinity);
	});
	const needsReorder = sortedTags.some((tag, i) => tag !== originalTags[i]);
	if (!needsReorder) return;
	selectedEndpoints = sortedTags.map(tag => tag.dataset.endpoint);
	sortedTags.forEach(tag => summaryEl.appendChild(tag));
}
async function handleNewSession() {
	currentSession = null;
	selectedEndpoints = [...defaultSelectedEndpoints];
	lastUserMessage = null;
	await refreshUI();
	const inputEl = $('#chat-input');
	if (inputEl) inputEl.focus();
}
init();

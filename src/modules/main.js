// ========== Main Logic ==========
function loadDefaultSelectedModels() {
	try {
		const saved = localStorage.getItem('defaultSelectedModels');
		return saved ? JSON.parse(saved) : [];
	} catch {
		return [];
	}
}

function saveDefaultSelectedModels(models) {
	localStorage.setItem('defaultSelectedModels', JSON.stringify(models));
}
let defaultSelectedModels = loadDefaultSelectedModels();
let currentSession = null;
let selectedModels = []; // 当前选中模型ID数组
let sessionGenerations = new Map(); // 按会话隔离的生成状态：Map<sessionId, Map<modelId, state>>
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
	const btnGroup = $('#send-btn-group');
	const toggle = $('#send-mode-toggle');
	const options = $$('.split-btn-option', btnGroup);
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
		if (defaultSelectedModels.length > 0) {
			selectedModels = [...defaultSelectedModels];
		}
		updateDirectoryDisplay();
		await refreshUI();
	}
	$('#btn-add-group').onclick = handleAddGroup;
	$('#btn-send').onclick = () => {
		if (inputMode === 'embedding') {
			handleEmbeddingSend();
		} else {
			handleSend();
		}
	};
	document.querySelectorAll('#mode-selector .mode-option').forEach(el => {
		el.onclick = () => {
			document.querySelector('#mode-selector .selected')?.classList.remove('selected');
			el.classList.add('selected');
			inputMode = el.dataset.mode;
			console.log("Mode:", inputMode);
			const input = $('#chat-input');
			input.placeholder = inputMode === 'chat' ? '输入消息...' : '输入要嵌入的文本...';
			$('#btn-attach').style.display = inputMode === 'chat' ? '' : 'none';
			$('#file-input').style.display = inputMode === 'chat' ? '' : 'none';
		};
	});
	$('#btn-stop').onclick = () => {
		stopAllGenerations();
		setButtonState(false, false);
		renderModelSelector(getGroups(), selectedModels, false);
	};
	$('#btn-help').onclick = async () => {
		const saved = await storage.hasSavedHandle();
		showHelpDialog(false, !!saved);
	};
	$('#btn-new-session-header').onclick = handleNewSession;
	$('#btn-delete-dir').onclick = handleDeleteDirectory;
	$('#btn-wipe-dir').onclick = handleWipeDirectory;
	// 附件按钮
	$('#btn-attach').onclick = () => {
		$('#file-input').click();
	};
	$('#file-input').onchange = async (e) => {
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
	$('#btn-change-dir').onclick = async () => {
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
	const dirPath = $('#directory-path');
	dirPath.textContent = info.text;
	dirPath.title = info.title;
}
async function refreshUI() {
	const groups = getGroups();
	// 清理在新存储中已不存在的已选模型
	const availableIds = new Set();
	groups.forEach(g => g.models.forEach(m => availableIds.add(`${g.id}:${m.id}`)));
	const before = selectedModels.length;
	selectedModels = availableIds.size > 0 ? selectedModels.filter(id => availableIds.has(id)) : [];
	if (selectedModels.length !== before) {
		saveDefaultSelectedModels(selectedModels);
	}
	// 清理在新存储中已不存在的当前会话
	if (currentSession && !sessionsCache.has(currentSession.id)) {
		currentSession = null;
	}
	const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
	const isGenerating = gens && gens.size > 0 && Array.from(gens.values()).some(s => s.status === 'generating');
	renderModelSelector(groups, selectedModels, isGenerating);
	renderEndpointList(groups, null, null, handleModelEdit, handleGroupEdit, handleGroupDelete, handleAddModelForGroup, handleModelDelete, handleReorderGroups, handleReorderModels, testConnection);
	const sessions = getAllSessions();
	renderSessionList(sessions, currentSession?.id, handleSessionSelect, handleSessionEdit, handleSessionDelete);
	if (currentSession) {
		renderMessages(currentSession.messages, groups, handleCopy);
	} else {
		$('#chat-messages').innerHTML = '';
	}
	updateChatTitleDisplay();
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
	// 从会话的最后用户消息恢复模型集
	const lastUserMsg = currentSession.messages.filter(m => m.role === 'user').pop();
	if (lastUserMsg?.targetModels) {
		selectedModels = [...lastUserMsg.targetModels];
	} else {
		selectedModels = [...defaultSelectedModels];
	}
	lastUserMessage = lastUserMsg?.content || null;
	// 获取当前会话的生成状态
	const gens = sessionGenerations.get(sessionId);
	const sessionModels = gens ? Array.from(gens.entries()) : [];
	await refreshUI();
	// 只有正在生成的模型才需要恢复流式卡片（已完成的已保存到消息中）
	const generatingModels = sessionModels.filter(([id, state]) => state.status === 'generating');
	// 如果有正在生成的模型，恢复显示流式卡片
	if (generatingModels.length > 0) {
		const groups = getGroups();
		const allModelIds = sessionModels.map(([id]) => id);
		showThinkingCards(allModelIds, groups, sessionId);
		// 恢复各状态模型的内容（但只恢复 generating 状态的）
		generatingModels.forEach(([id, state]) => {
			if (state.content || state.thinking) {
				updateStreamingCard(id, state, state.firstTokenTime, groups, sessionId);
			}
		});
		// 恢复按钮状态
		setButtonState(true, true);
		renderModelSelector(groups, selectedModels, true);
	}
	// 如果所有模型都已完成/失败/停止，清理状态（不再需要恢复）
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
	showEditGroupDialog(null, async (data) => {
		await addGroup(data.name, data.baseUrl, data.style, data.key);
		await refreshUI();
	});
}

function handleGroupEdit(groupId) {
	const group = getGroup(groupId);
	showEditGroupDialog(group, async (data) => {
		await updateGroup(groupId, data);
		await refreshUI();
	});
}
async function handleGroupDelete(groupId) {
	// 清理 selectedModels 中属于该组的模型
	selectedModels = selectedModels.filter(id => {
		const parts = id.split(':');
		return parts[0] !== groupId;
	});
	saveDefaultSelectedModels(selectedModels);
	await deleteGroup(groupId);
	await refreshUI();
}
async function handleAddModelForGroup(groupId, modelName) {
	if (modelName) {
		await addModel(groupId, modelName);
		await refreshUI();
	}
}

function handleCopy(content) {
	navigator.clipboard.writeText(content).then(() => {
		// 可选：显示复制成功提示
	});
}

function handleModelEdit(groupId, modelId, newName) {
	// 原地编辑模式：直接更新模型名
	updateModel(groupId, modelId, newName).then(() => refreshUI());
}
async function handleModelDelete(groupId, modelId) {
	// 清理 selectedModels 中的该模型
	selectedModels = selectedModels.filter(id => id !== `${groupId}:${modelId}`);
	saveDefaultSelectedModels(selectedModels);
	await deleteModel(groupId, modelId);
	await refreshUI();
}
async function handleReorderGroups(draggedId, targetId, insertBefore) {
	await reorderGroups(draggedId, targetId, insertBefore);
	await refreshUI();
}
async function handleReorderModels(groupId, draggedModelId, targetModelId, insertBefore) {
	await reorderModels(groupId, draggedModelId, targetModelId, insertBefore);
	await refreshUI();
}
async function handleSend() {
	const content = await getInputMessage();
	if (!content || content.length === 0) return; // 处理失败或无文本无附件
	if (selectedModels.length === 0) {
		selectorExpanded = true;
		renderModelSelector(getGroups(), selectedModels, false);
		return;
	}
	let isNewSession = false;
	if (!currentSession) {
		currentSession = await createSession(content, [...selectedModels]);
		isNewSession = true;
	}
	// Only addMessage if NOT a new session (createSession already added first message)
	if (!isNewSession) {
		await addMessage(currentSession.id, 'user', content, {
			targetModels: [...selectedModels]
		});
	}
	// 提取纯文本用于 lastUserMessage
	const textContent = content.filter(c => c.type === 'text' || c.type === 'file_text').map(c => c.text || '').join('\n');
	lastUserMessage = textContent;
	clearInput();
	clearAttachments();
	setButtonState(true, true);
	// 发送后自动收起模型选择区
	selectorExpanded = false;
	renderModelSelector(getGroups(), selectedModels, true);
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
	showThinkingCards(selectedModels, groups, targetSessionId);
	const sortedModels = new Set();
	const responses = await callAllModels(groups, selectedModels, messages, (modelId, partialContent, firstTokenTime) => {
		updateStreamingCard(modelId, partialContent, firstTokenTime, groups, targetSessionId);
		// 只在firstTokenTime首次有值时排序一次
		if (firstTokenTime != null && !sortedModels.has(modelId)) {
			sortedModels.add(modelId);
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
		renderModelSelector(groups, selectedModels, false);
		await refreshUI();
}
}




async function handleEmbeddingSend() {
	const input = $('#chat-input');
	const text = input.value.trim();
	if (!text) return;
	if (selectedModels.length === 0) {
		selectorExpanded = true;
		renderModelSelector(getGroups(), selectedModels, false);
		return;
	}
	const modelId = selectedModels[0];
	const info = findModelById(getGroups(), modelId);
	if (!info) {
		console.error('模型不存在:', modelId);
		return;
	}
	clearInput();
	if (!currentSession) {
		currentSession = await createSession(null, []);
	}
	await addMessage(currentSession.id, 'user', [{ type: 'text', text: '🔢 嵌入: ' + text }], {
		targetModels: [modelId]
	});
	renderMessages(currentSession.messages, getGroups(), handleCopy);
	const container = $('#chat-messages');
	const msgEl = mk('article', 'message layout-y-queue res msg');
	msgEl.id = 'streaming-embedding';
	const hint = mk('div', 'embedding-thinking');
	hint.textContent = '🔢 计算嵌入向量...';
	msgEl.addChild(hint);
	container.appendChild(msgEl);
	container.scrollTop = container.scrollHeight;
	try {
		const result = await callEmbedding(info.group.style, info.group.baseUrl, info.group.key, info.model.name, text);
		const card = $('#streaming-embedding');
		if (card) card.remove();
		const emb = result.embedding;
		const dim = emb.length;
		const preview = '[' + emb.slice(0, 5).map(v => v.toFixed(6)).join(', ') + ', ...]';
		const fullJson = JSON.stringify(emb);
		await addMessage(currentSession.id, 'assistant', null, {
			responses: [{
				modelId: modelId,
				status: 'completed',
				content: '',
				embeddingResult: {
					dim,
					preview,
					fullJson,
					model: result.model || info.model.name,
					usage: result.usage
				}
			}]
		});
		if (currentSession) {
			currentSession = await loadSession(currentSession.id);
			await refreshUI();
		}
	} catch (err) {
		const card = $('#streaming-embedding');
		if (card) card.remove();
		console.error('嵌入失败:', err);
		await addMessage(currentSession.id, 'assistant', null, {
			responses: [{
				modelId: modelId,
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



function showThinkingCards(modelIds, groups, sessionId) {
	const container = $('#chat-messages');
	const existingCards = $(`#streaming-multi-response[data-session-id="${sessionId}"]`);
	if (existingCards) {
		existingCards.remove();
	}
	const msgEl = mk('article', 'message layout-y-queue res msg');
	msgEl.id = 'streaming-multi-response';
	msgEl.dataset.sessionId = sessionId;
	const hint = fromTemplate('tpl-multi-response-hint', '.multi-response-hint');
	$('.hint-text', hint).textContent = `${modelIds.length}个模型正在思考...`;
	msgEl.addChild(hint);
	const stopBtn = $('#btn-stop-inline', hint);
	if (stopBtn) {
		stopBtn.onclick = () => {
			stopAllGenerations();
			stopBtn.disabled = true;
			stopBtn.textContent = '已停止';
			$('.hint-text', hint).textContent = `${modelIds.length}个模型（部分已停止）`;
		};
	}
	const cards = mk('div', 'multi-response-cards layout-y-queue');
	modelIds.forEach(id => {
		const card = fromTemplate('tpl-response-card-streaming', '.response.card');
		card.dataset.sessionId = sessionId;
		card.dataset.modelId = id;
		const info = findModelById(groups, id);
		const name = info ? `${info.group.name} / ${info.model.name}` : '未知';
		$('.response.model-name', card).textContent = name;
		cards.addChild(card);
	});
	msgEl.addChild(cards);
	container.addChild(msgEl);
	scrollToBottom();
}

function updateStreamingCard(modelId, state, firstTokenTime, groups, sessionId) {
	const card = $(`.response.card[data-session-id="${sessionId}"][data-model-id="${modelId}"]`);
	if (!card) return;
	const thinkingBlock = $('.thinking-block', card);
	if (thinkingBlock) {
		if (state.thinking && state.thinking.trim()) {
			thinkingBlock.style.display = 'block';
			thinkingBlock.classList.add('streaming');
			const thinkingContent = $('.thinking-content', thinkingBlock);
			if (thinkingContent) {
				thinkingContent.textContent = state.thinking;
			}
			let thinkingHeader = $('.thinking-header', thinkingBlock);
			if (!thinkingHeader) {
				thinkingHeader = fromTemplate('tpl-thinking-header', '.thinking-header');
				thinkingHeader.onclick = function() {
					toggleThinking(this);
				};
				const durationText = state.thinkingDuration ? `耗时 ${(state.thinkingDuration/1000).toFixed(1)}s` : '';
				$('.thinking-duration', thinkingHeader).textContent = durationText;
				thinkingBlock.insertBefore(thinkingHeader, thinkingBlock.firstChild);
			}
			if (state.thinkingDuration) {
				const thinkingDurationEl = $('.thinking-duration', thinkingHeader);
				if (thinkingDurationEl) {
					thinkingDurationEl.textContent = `耗时 ${(state.thinkingDuration/1000).toFixed(1)}s`;
				}
			}
		} else {
			thinkingBlock.style.display = 'none';
		}
	}
	const contentEl = $('.response.card-content', card);
	if (contentEl) {
		contentEl.textContent = state.content || '';
	}
	if (firstTokenTime !== null) {
		const meta = $('.response.meta', card);
		if (meta) {
			if (!$('.response.duration', meta)) {
				const durationEl = mk('span', `response duration ${getSpeedClass(firstTokenTime)}`);
				durationEl.textContent = `反应${(firstTokenTime/1000).toFixed(1)}s`;
				const modelNameEl = $('.response.model-name', meta);
				if (modelNameEl) {
					modelNameEl.insertAdjacentElement('afterend', durationEl);
				}
			}
		}
	}
}

function updateCardStatus(modelId, status, error, state = null, sessionId = null) {
	requestAnimationFrame(() => {
		const selector = sessionId ? `.response.card[data-session-id="${sessionId}"][data-model-id="${modelId}"]` : `.response.card[data-model-id="${modelId}"]`;
		const card = $(selector);
		if (!card) return;
		card.classList.remove('thinking');
		const contentEl = $('.response.card-content', card);
		const meta = $('.response.meta', card);
		const icon = meta ? $('.model.status-icon', meta) : null;
		if (icon) {
			icon.classList.remove('spinning');
			icon.classList.add('status');
			icon.classList.add(status);
			icon.textContent = getStatusText(status);
		}
		if (status === 'failed') {
			if (contentEl) {
				contentEl.textContent = ''; // Empty content for failed
			}
			if (meta && error && !$('.response.error', meta)) {
				const errorEl = mk('span', 'response error');
				errorEl.textContent = error;
				const statusEl = $('.response.status', meta) || icon;
				if (statusEl) {
					statusEl.insertAdjacentElement('afterend', errorEl);
				}
			}
		} else if (status === 'stopped') {} else if (status === 'completed') {
			if (state && state.thinkingDuration) {
				const thinkingBlock = $('.thinking-block', card);
				if (thinkingBlock) {
					thinkingBlock.classList.remove('streaming');
					thinkingBlock.classList.add('collapsed');
					const durationEl = $('.thinking-duration', thinkingBlock);
					if (durationEl) {
						durationEl.textContent = `耗时 ${(state.thinkingDuration/1000).toFixed(1)}s`;
					}
				}
			}
			if (state && state.totalDuration) {
				let totalEl = $('.response.total', meta);
				if (!totalEl) {
					totalEl = mk('span', 'response total');
					const insertAfter = $('.response.status', meta) || $('.model.status-icon', meta);
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
		const container = $('#streaming-multi-response .multi-response-cards');
		if (!container) return;
		const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
		const cards = Array.from($$('.response.card', container));
		cards.sort((a, b) => {
			const stateA = gens ? gens.get(a.dataset.modelId) : null;
			const stateB = gens ? gens.get(b.dataset.modelId) : null;
			return (stateA?.firstTokenTime ?? Infinity) - (stateB?.firstTokenTime ?? Infinity);
		});
		cards.forEach(c => container.appendChild(c));
	});
}

function reorderSelectorTagsBySpeed() {
	const summaryEl = $('#selector-summary');
	if (!summaryEl) return;
	const tags = Array.from(summaryEl.querySelectorAll('.model.tag.selected'));
	if (tags.length === 0) return;
	const originalTags = [...tags];
	const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
	const sortedTags = tags.sort((a, b) => {
		const aTime = gens ? gens.get(a.dataset.model)?.firstTokenTime : undefined;
		const bTime = gens ? gens.get(b.dataset.model)?.firstTokenTime : undefined;
		return (aTime ?? Infinity) - (bTime ?? Infinity);
	});
	const needsReorder = sortedTags.some((tag, i) => tag !== originalTags[i]);
	if (!needsReorder) return;
	selectedModels = sortedTags.map(tag => tag.dataset.model);
	sortedTags.forEach(tag => summaryEl.appendChild(tag));
}
async function handleNewSession() {
	currentSession = null;
	selectedModels = [...defaultSelectedModels];
	lastUserMessage = null;
	await refreshUI();
	const inputEl = $('#chat-input');
	if (inputEl) inputEl.focus();
}
init();


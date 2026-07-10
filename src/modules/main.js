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
// 声明在 selected-endpoints.js
selectedEndpoints = []; // 当前选中端点ID数组
let sessionGenerations = new Map(); // 按会话隔离的生成状态：Map<sessionId, Map<endpointId, state>>
let lastUserMessage = null;
let pendingAttachments = []; // 待发送的附件列表
async function init() {
	initDividers();
	initScrollNav();
	initScrollPaddingObserver();
	let sendOnEnter = localStorage.getItem('sendMode') !== 'ctrl-enter';
	const chatInput = $('#chat-input');
	chatInput.placeholder = '输入消息...';
	$('.add.attachment.btn').style.display = '';
	$('.file-input').style.display = '';

	chatInput.on('keydown', e => {
		if (e.key === 'Enter') {
			if (sendOnEnter && !e.shiftKey && !e.ctrlKey) {
				e.preventDefault();
				handleSend();
			} else if (!sendOnEnter && e.ctrlKey) {
				e.preventDefault();
				handleSend();
			}
		}
	});
	// 分裂式按钮：发送模式切换（Popover API）
	const btnGroup = $('.split-style.btn-group');
	const toggle = $('.send-shortcut-selector');
	// 从 localStorage 同步 radio 选中状态
	if (localStorage.getItem('sendMode') === 'ctrl-enter') {
		btnGroup.querySelector('.option.btn input[value="ctrl-enter"]').checked = true;
	}
	// 选择选项（radio change 事件）：自动关闭 popover
	const sendModePop = document.getElementById('sendModePop');
	btnGroup.querySelectorAll('.option.btn input[type=radio]').forEach(radio => {
		radio.on('change', () => {
			sendOnEnter = radio.value === 'enter';
			localStorage.setItem('sendMode', radio.value);
			sendModePop?.hidePopover();
		});
	});
	// Popover 打开前定位 + 同步按钮高亮
	sendModePop?.addEventListener('beforetoggle', (e) => {
		if (e.newState === 'open') {
			const btnRect = toggle.getBoundingClientRect();
			sendModePop.style.position = 'fixed';
			const popHeight = sendModePop.getBoundingClientRect().height || 88;
			const popWidth = sendModePop.getBoundingClientRect().width || 140;
			sendModePop.style.top = (btnRect.top - popHeight - 8) + 'px';
			sendModePop.style.left = (btnRect.right - popWidth) + 'px';
		}
	});
	sendModePop?.addEventListener('toggle', (e) => {
		toggle.classList.toggle('active', e.newState === 'open');
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
	$('.send').onclick = () => { handleSend(); };
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
	// 主题初始化
	initTheme();
	// 主题选择 radio 切换
	document.querySelectorAll('#themePop input[type=radio]').forEach(radio => {
		radio.addEventListener('change', async () => {
			if (radio.checked) {
				const mode = radio.value === 'system' ? null : radio.value;
				await setThemePref(mode);
				updateThemeIcon(mode);
				document.getElementById('themePop')?.hidePopover();
			}
		});
	});
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
	const dirPath = $('.cur');
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

    const container = $('.msg.list');
    const doUpdate = () => {
        if (currentSession) {
            const hasStreamingCards = container.querySelector(`.one.response.msg[data-session-id="${currentSession.id}"]`);
            if (hasStreamingCards) {
                container.querySelectorAll('.streaming-hint').forEach(el => el.remove());
                const lastMsg = currentSession.messages[currentSession.messages.length - 1];
                if (lastMsg && lastMsg.responses) {
                    renderResponse(container, lastMsg, groups);
                }
            } else {
                renderMessages(currentSession.messages, groups, handleCopy);
            }
        } else {
            container.innerHTML = "";
        }
    };
    if (document.startViewTransition) {
        document.startViewTransition(doUpdate);
    } else {
        doUpdate();
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
	if (!content || content.length === 0) return;
	if (selectedEndpoints.length === 0) {
		renderSelectedEndpoints(getGroups(), selectedEndpoints, false);
		return;
	}
	let isNewSession = false;
	if (!currentSession) {
		currentSession = await createSession(content, [...selectedEndpoints]);
		isNewSession = true;
	}
	if (!isNewSession) {
		await addMessage(currentSession.id, 'user', content, {
			targetEndpoints: [...selectedEndpoints]
		});
	}
	const textContent = content.filter(c => c.type === 'text' || c.type === 'file_text').map(c => c.text || '').join('\n');
	lastUserMessage = textContent;
	clearInput();
	clearAttachments();
	setButtonState(true, true);
	renderSelectedEndpoints(getGroups(), selectedEndpoints, true);
	const groups = getGroups();
	const messages = currentSession.messages.map(m => {
		if (m.role === 'assistant' && m.responses) {
			const content = m.responses.filter(r => r.status === 'completed' && r.content).map(r => r.content).join('\n\n---\n\n');
			return { role: m.role, content };
		}
		const normalized = normalizeMessageContent(m);
		return { role: m.role, content: toOpenAIContent(normalized) };
	});
	renderMessages(currentSession.messages, groups, handleCopy);
	const targetSessionId = currentSession.id;
	
	// 按端点类型分流
	const chatIds = [];
	const embedIds = [];
	const imgGenerateIds = [];
	selectedEndpoints.forEach(id => {
		const cfg = resolveNodeConfig(id);
		if (cfg.type === 'embedding' || cfg.type === 'embed') embedIds.push(id);
		else if (cfg.type === 'image-generation' || cfg.type === 'image') imgGenerateIds.push(id);
		else chatIds.push(id);
	});

	showThinkingCards(selectedEndpoints, groups, targetSessionId);
	const sortedModels = new Set();
	const allResults = [];

	try {
		// 并行处理嵌入类端点（非流式，速度快）
		const embedPromises = embedIds.map(async (id) => {
			const info = findModelById(groups, id);
			if (!info) {
				return { endpointId: id, status: 'failed', error: '端点不存在', content: '' };
			}
			try {
				const cfg = resolveNodeConfig(id);
				const result = await callEmbedding(cfg.style || 'openai', cfg.baseUrl, cfg.key, (info.node.modelId || info.node.name), textContent);
				updateCardAsEmbedding(id, result, targetSessionId);
				return {
					endpointId: id,
					status: 'completed',
					content: '',
					embeddingResult: {
						dim: result.embedding.length,
						preview: '[' + result.embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ') + ', ...]',
						fullJson: JSON.stringify(result.embedding),
						model: result.model || (info.node.modelId || info.node.name),
						usage: result.usage
					}
				};
			} catch (err) {
				updateCardStatus(id, 'failed', err.message, null, targetSessionId);
				return { endpointId: id, status: 'failed', error: err.message, content: '' };
			}
		});

		// 并行处理生图类端点（非流式）
		const imgGeneratePromises = imgGenerateIds.map(async (id) => {
			const info = findModelById(groups, id);
			if (!info) {
				return { endpointId: id, status: 'failed', error: '端点不存在', content: '' };
			}
			try {
				const cfg = resolveNodeConfig(id);
				const result = await callImageGeneration(cfg.style || 'openai', cfg.baseUrl, cfg.key, (info.node.modelId || info.node.name), messages);
				updateCardAsImage(id, result, targetSessionId);
				return {
					endpointId: id,
					status: 'completed',
					content: result.url ? '```plaintext\n' + result.url + '\n```' : '',
					imageResult: {
						blobUrl: result.blobUrl,
						imageData: result.imageData,
						url: result.url,
						b64_json: result.b64_json,
						revised_prompt: result.revised_prompt
					}
				};
			} catch (err) {
				updateCardStatus(id, 'failed', err.message, null, targetSessionId);
				return { endpointId: id, status: 'failed', error: err.message, content: '' };
			}
		});

		const chatPromise = (async () => {
			if (chatIds.length === 0) return [];
			return await callAllModels(groups, chatIds, messages, (endpointId, partialContent, firstTokenTime) => {
				updateStreamingCard(endpointId, partialContent, firstTokenTime, groups, targetSessionId);
				if (firstTokenTime != null && !sortedModels.has(endpointId)) {
					sortedModels.add(endpointId);
					reorderCardsBySpeed();
					reorderSelectorTagsBySpeed();
				}
			}, targetSessionId);
		})();

		const [embedResults, imgGenerateResults, chatResults] = await Promise.all([
			Promise.all(embedPromises),
			Promise.all(imgGeneratePromises),
			chatPromise
		]);

		allResults.push(...embedResults, ...imgGenerateResults, ...chatResults);

		await addMessage(targetSessionId, 'assistant', null, { responses: allResults });
	} catch (err) {
		console.error('Session generation error:', err);
	} finally {
		sessionGenerations.delete(targetSessionId);
		setButtonState(false, false);
		renderSelectedEndpoints(groups, selectedEndpoints, false);
		if (currentSession?.id === targetSessionId) {
			currentSession = await loadSession(targetSessionId);
			await refreshUI();
		}
	}
}




function showThinkingCards(endpoints, groups, sessionId) {
    const container = $(".msg.list");
    // 移除该 session 已有的 streaming 元素（防重复触发）
    $$(`[data-session-id="${sessionId}"]`).forEach(el => el.remove());

    // 独立的提示栏（"N个模型正在思考..." + 全部停止按钮），不作为包装框
    const hint = mk('div', 'hint streaming-hint');
    hint.dataset.sessionId = sessionId;
    const hintText = mk('span', 'hint-text');
    hintText.textContent = `${endpoints.length}个端点思考中`;
    hint.appendChild(hintText);
    const stopBtn = mk('button', 'stop all btn');
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
        // 单端点停止按钮
        const stopBtn = $('.stop-one', card);
        if (stopBtn) {
            stopBtn.classList.add('visible');
            stopBtn.onclick = (e) => {
                e.stopPropagation();
                stopSingleGeneration(sessionId, id);
                stopBtn.disabled = true;
                stopBtn.classList.remove('visible');
            };
        }
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
			thinkingBlock.classList.remove('hidden');
			thinkingBlock.classList.add('streaming');
			thinkingBlock.open = true;
			const thinkingContent = $('.text', thinkingBlock);
			if (thinkingContent) {
				thinkingContent.textContent = state.thinking;
			}
			if (state.thinkingDuration) {
				const durationEl = $('.duration', thinkingBlock);
				if (durationEl) {
					durationEl.textContent = `耗时 ${(state.thinkingDuration/1000).toFixed(1)}s`;
				}
			}
		} else {
			thinkingBlock.classList.add('hidden');
		}
	}
	const contentEl = $('.say', card);
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
		// 端点已完成/停止/失败，隐藏停止按钮
		const stopBtn = $('.stop-one', card);
		if (stopBtn) stopBtn.classList.remove('visible');
		const contentEl = $('.say', card);
		const meta = $('header', card);
		const icon = meta ? $('.status.loading', meta) : null;
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
			// 插入错误到 .content 中（跟在 .say 后面）
			if (error) {
				const contentWrapper = $('.content', card);
				if (contentWrapper && !$('.error', contentWrapper)) {
					const errorEl = mk('span', 'response error');
					errorEl.textContent = error;
					// 如果有 .say 则在后面插入，否则追加到末尾
					const sayEl = $('.say', contentWrapper);
					if (sayEl) {
						sayEl.insertAdjacentElement('afterend', errorEl);
					} else {
						contentWrapper.appendChild(errorEl);
					}
				}
			}
			// 隐藏复制按钮
			const copyBtn = $('.copy.content', card);
			if (copyBtn) copyBtn.style.display = 'none';
		} else if (status === 'stopped') {} else if (status === 'completed') {
			if (state && state.thinkingDuration) {
				const thinkingBlock = $('.think', card);
				if (thinkingBlock) {
					thinkingBlock.classList.remove('streaming');
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
					const insertAfter = $('.status', meta) || $('.status.loading', meta);
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
        const container = $('.msg.list');
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

// ========== 主题管理 ==========
let themeMode = null; // 'light' | 'dark' | null(null=系统)

function applyThemeClass(mode) {
	const html = document.documentElement;
	html.classList.remove('dark', 'light');
	if (mode === 'dark' || mode === 'light') {
		html.classList.add(mode);
	}
}

function updateThemeIcon(mode) {
	const icon = $('.theme.btn svg use');
	if (!icon) return;
	const iconName = mode === 'dark' ? 'moon' : mode === 'light' ? 'sun' : 'auto';
	icon.setAttribute('href', `icons.svg#icon-${iconName}`);
}

async function initTheme() {
	themeMode = localStorage.getItem('themePref') || null;
	applyThemeClass(themeMode);
	updateThemeIcon(themeMode);
	// 同步 radio 选中状态
	const themeRadio = document.querySelector(`#themePop input[value="${themeMode || 'system'}"]`);
	if (themeRadio) themeRadio.checked = true;

	// 监听系统主题变化（仅在跟随系统时自动切换）
	const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
	mediaQuery.addEventListener('change', () => {
		if (!themeMode) {
			applyThemeClass(null);
			updateThemeIcon(null);
		}
	});
}

async function setThemePref(mode) {
	themeMode = mode;
	applyThemeClass(mode);
	updateThemeIcon(mode);
	if (mode) {
		localStorage.setItem('themePref', mode);
	} else {
		localStorage.removeItem('themePref');
	}
}

init();

function updateCardAsEmbedding(endpointId, result, sessionId) {
	const card = $(`.one.response.msg[data-session-id="${sessionId}"][data-endpoint-id="${endpointId}"]`);
	if (!card) return;
	const sayEl = $('.say', card);
	if (sayEl) sayEl.textContent = '';
	const contentWrapper = $('.content', card);
	if (contentWrapper) {
				var embDiv = $('.embedding-result', contentWrapper);
		embDiv.classList.remove('hidden');
		embDiv.querySelector('.dim').textContent = dim;
		embDiv.querySelector('.preview').textContent = preview;
		embDiv.querySelector('.expand-json').remove();
		embDiv.querySelector('.embedding-full-json').remove();
		const copyBtn = embDiv.querySelector('.copy.code');
	        copyBtn.onclick = () => {
			const codeText = embDiv.querySelector('.preview').textContent;
			navigator.clipboard.writeText(codeText).then(() => {
				copyBtn.classList.add("copied");
				setTimeout(() => copyBtn.classList.remove("copied"), 1500);
			});
		};
	}
	updateCardStatus(endpointId, 'completed', null, null, sessionId);
}

function updateCardAsImage(endpointId, result, sessionId) {
	const card = $(`.one.response.msg[data-session-id="${sessionId}"][data-endpoint-id="${endpointId}"]`);
	if (!card) return;
	const sayEl = $('.say', card);
	if (sayEl) sayEl.textContent = '';
	const contentWrapper = $('.content', card);
	if (contentWrapper) {
		const existing = $('.image-result', contentWrapper);
		if (existing) existing.remove();

		const imgDiv = mk('div', 'image-result');
		const imgUrl = result.blobUrl || result.imageData || result.url || (result.b64_json ? 'data:image/png;base64,' + result.b64_json : null);
		if (imgUrl) {
			const img = mk('img', 'generated');
			img.src = imgUrl;
			img.style.maxWidth = '100%';
			img.style.borderRadius = '8px';
			img.onclick = () => {
				const overlay = mk('div', 'image-preview-overlay , flex items-go-x');
				const fullImg = mk('img');
				fullImg.src = imgUrl;
				overlay.onclick = () => overlay.remove();
				overlay.addChild(fullImg);
				doc.body.addChild(overlay);
			};
			imgDiv.addChild(img);
		}
		if (result.revised_prompt) {
			const revised = mk('div', 'revised-prompt');
			revised.textContent = '修订提示: ' + result.revised_prompt;
			revised.style.fontSize = 'smaller';
			revised.style.color = 'var(--text-dim)';
			revised.style.marginTop = '4px';
			imgDiv.addChild(revised);
		}
		contentWrapper.addChild(imgDiv);
	}
	updateCardStatus(endpointId, 'completed', null, null, sessionId);
}

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

// ========== Event Handlers (extracted from init() for HTML onclick) ==========
function handleTestAllConnections() {
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
}

function handleStopAllResponses() {
    stopAllGenerations();
    setButtonState(false, false);
    renderSelectedEndpoints(getGroups(), selectedEndpoints, false);
}

async function handleShowHelp() {
    const saved = await storage.hasSavedHandle();
    showHelpDialog(false, !!saved);
}

async function handleChangeDirectory() {
    const success = await selectDirectory();
    if (success) {
        updateDirectoryDisplay();
        await refreshUI();
    }
}

async function handleFileInputChange(input) {
    const files = input.files;
    if (files && files.length > 0) {
        for (const file of files) {
            await addAttachment(file);
        }
    }
    input.value = '';
    renderPendingAttachments();
}

async function handleRecordToggle() {
    var cb = document.querySelector('.record.btn input[type="checkbox"]');
    var btn = document.querySelector('.record.btn');
    if (cb.checked) {
        var ok = await startRecording();
        if (ok) {
            btn.title = '停止录制';
        } else {
            cb.checked = false;
        }
    } else {
        stopRecording();
        btn.title = '录制语音';
    }
}

function handleSendModePopBeforetoggle(e) {
    if (e.newState === 'open') {
        var toggle = document.querySelector(".send-shortcut-selector");
        var btnRect = toggle.getBoundingClientRect();
        var pop = e.target;
        pop.style.position = "fixed";
        var popHeight = pop.getBoundingClientRect().height || 88;
        var popWidth = pop.getBoundingClientRect().width || 140;
        pop.style.top = (btnRect.top - popHeight - 8) + "px";
        pop.style.left = (btnRect.right - popWidth) + "px";
    }
}

function handleSendModePopToggle(e) {
    var toggle = document.querySelector(".send-shortcut-selector");
    toggle.classList.toggle("active", e.newState === "open");
}

async function handleThemeRadioChange(radio) {
    if (radio.checked) {
        var mode = radio.value === "system" ? null : radio.value;
        await setThemePref(mode);
        updateThemeIcon(mode);
        document.getElementById("themePop")?.hidePopover();
    }
}

function handleStopOneResponseClick(btn) {
    var card = btn.closest(".one.response.msg");
    var sessionId = card.dataset.sessionId;
    var endpointId = card.dataset.endpointId;
    stopSingleGeneration(sessionId, endpointId);
    btn.disabled = true;
    btn.classList.remove("visible");
}

async function init() {
	initDividers();
	initScrollNav();
	initScrollPaddingObserver();
	// ===== 事件绑定（取代 HTML onxxx，兼容扩展 CSP） =====
	// 存储目录操作
	$('.change-dir').on('click', handleChangeDirectory);
	$('.drop-dir').on('click', handleDeleteDirectory);
	$('.wipe-dir').on('click', handleWipeDirectory);
	// 帮助
	$('.help').on('click', handleShowHelp);
	$('dialog.help .close').on('click', closeHelpDialog);
	// 帮助弹窗中的目录选择
	$('dialog.help .recover')?.on('click', onRecoverDirectory);
	$('dialog.help .select-dir')?.on('click', onSelectDirectory);
	$('dialog.help .use-browser-storage')?.on('click', onUseBrowserStorage);
	// 主题切换 radio
	$$('#themePop input[type="radio"]').forEach(r => r.on('change', e => handleThemeRadioChange(e.currentTarget)));
	// 端点类型筛选
	$('.endpoint-type.filter').on('change', handleFilterBarChange);
	// 端点树操作按钮（静态）
	$('.test-all').on('click', handleTestAllConnections);
	$('.collapse-all').on('click', collapseAllEndpointNodes);
	$('.add-node').on('click', handleAddGroup);
	$('.reset-filter').on('click', handleResetFilter);
	$('.add-endpoint').on('click', handleClickAddEndpoint);
	// 滚动导航
	$('.go-top').on('click', handleScrollTop);
	$('.go-bottom').on('click', handleScrollBottom);
	// 新建会话
	$('.new-session').on('click', handleNewSession);
	// 文件上传
	$('.add.attachment.btn input[type="file"]').on('change', e => handleFileInputChange(e.currentTarget));
	// 音频录制
	$('.record.btn input[type="checkbox"]').on('change', handleRecordToggle);
	// 发送 & 全部停止
	$('.main.btn.send').on('click', handleSend);
	$('.stop-all-response').on('click', handleStopAllResponses);
	// 发送模式 Popover
	$('#sendModePop').on('beforetoggle', handleSendModePopBeforetoggle);
	$('#sendModePop').on('toggle', handleSendModePopToggle);
	let sendOnEnter = localStorage.getItem('sendMode') !== 'ctrl-enter';
	const chatInput = $('#chat-input');
	chatInput.placeholder = '输入消息...';

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
	// 主题初始化
	initTheme();
	// 保证流式提示栏存在（默认显示免责声明）
	ensureStreamingHint();
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
async function refreshUI(opts) {
	opts = opts || {};
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

    if (!opts.skipEndpointTree) {
        renderEndpointList(
            groups,
            handleNodeEdit,
            handleNodeDelete,
            handleReorderNode,
            testConnection,
            handleMoveNodeAsChild
        );
    }

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
            renderMessages(currentSession.messages, groups, handleCopy);
            ensureStreamingHint();
        } else {
            container.innerHTML = "";
            ensureStreamingHint();
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
    showEditGroupDialog(null, null, async data => {
        var createdIds = await addNode(null, data);
        var newId = createdIds && createdIds[0];

        if (newId) {
            var newNode = getNode(newId);

            if (newNode) {
                var container = document.querySelector("aside.endpoint.list > ol");
                container.appendChild(buildEndpointNodeEl(newNode));
            }
        }

        await refreshUI({
            skipEndpointTree: true
        });

        updateEmptyState();
    });
}

function handleNodeEdit(nodeId) {
    const node = getNode(nodeId);

    if (!node)
        return;

    showEditGroupDialog(node, null, async data => {
        clearTestResults(nodeId);
        await updateNode(nodeId, data);
        var updatedNode = getNode(nodeId);

        if (updatedNode) {
            var oldEl = document.querySelector(".one.endpoint[data-node-id=\"" + nodeId + "\"]");

            if (oldEl) {
                var newEl = buildEndpointNodeEl(updatedNode);
                oldEl.replaceWith(newEl);
            }
        }

        await refreshUI({
            skipEndpointTree: true
        });

        updateEmptyState();
    });
}
async function handleNodeDelete(nodeId) {
	// 清理 selectedEndpoints 中属于该端点的引用
	selectedEndpoints = selectedEndpoints.filter(id => {
		const parts = id.split(':');
		return parts[0] !== nodeId;
	});
	saveDefaultSelectedEndpoints(selectedEndpoints);
	// 收集子孙 ID 用于清理状态
	var allIds = collectDescendantIds(nodeId);
	allIds.forEach(function(id) {
		connectionStatus.delete(id);
		collapsedEndpoints.delete(id);
	});
	// 直接移除 DOM 节点（不触发整树重绘）
	var nodeEl = document.querySelector('.one.endpoint[data-node-id="' + nodeId + '"]');
	var parentContainer = nodeEl ? nodeEl.closest('ol') : null;
	if (nodeEl) nodeEl.remove();
	// 更新父节点的批量测试按钮状态
	if (parentContainer) {
		var parentEndpoint = parentContainer.closest('.one.endpoint');
		if (parentEndpoint) updateEndpointTestUI(parentEndpoint.dataset.nodeId);
	}
	// 数据层删除
	await deleteNode(nodeId);
	// 轻量刷新（跳过端点树重绘）
	await refreshUI({ skipEndpointTree: true });
	updateEmptyState();
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
		// Sync workspace params to new session
		if (typeof defaultSelectedEndpointParams !== 'undefined' && Object.keys(defaultSelectedEndpointParams).length > 0) {
			currentSession.modelParams = JSON.parse(JSON.stringify(defaultSelectedEndpointParams));
			await saveSession(currentSession);
		}
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
	// Save audio files for ASR before clearing attachments
	var asrAudioFiles = pendingAttachments.filter(function(a) { return a.file && a.file.type && a.file.type.indexOf('audio/') === 0; }).map(function(a) { return a.file; });
	clearAttachments();
	setButtonState(true, true);
	renderSelectedEndpoints(getGroups(), selectedEndpoints, true);
	const groups = getGroups();
	const messages = currentSession.messages.map(m => {
		if (m.role === 'assistant') {
			return { role: m.role, content: m.content || '' };
		}
		const normalized = normalizeMessageContent(m);
		return { role: m.role, content: toOpenAIContent(normalized) };
	});
	appendUserMessage(currentSession.messages[currentSession.messages.length - 1]);
	// 清除旧回复卡片的 data-endpoint-id 和 data-session-id，
	// 防止 showThinkingCards 移除旧卡片，也防止 renderResponse 误更新
	$$('.one.response.msg').forEach(el => {
		el.removeAttribute('data-endpoint-id');
		el.removeAttribute('data-session-id');
	});
	const targetSessionId = currentSession.id;
	
	// 按端点类型分流
	const chatIds = [];
	const embedIds = [];
	const imgGenerateIds = [];
	const ttsIds = [];
	const asrIds = [];
	selectedEndpoints.forEach(id => {
		const cfg = resolveNodeConfig(id);
		if (cfg.type === 'embedding' || cfg.type === 'embed') embedIds.push(id);
		else if (cfg.type === 'image-generation' || cfg.type === 'image') imgGenerateIds.push(id);
		else if (cfg.type === 'tts') ttsIds.push(id);
		else if (cfg.type === 'asr') asrIds.push(id);
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
				const result = await callEmbedding(cfg.style || 'openai', cfg.baseUrl, cfg.key, (info.node.modelId || info.node.name), textContent, cfg.directUrl);
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
				// Merge param overrides for image generation
				var imgOvr = null;
				if (currentSession && currentSession.modelParams && currentSession.modelParams[id]) {
					imgOvr = currentSession.modelParams[id];
				} else if (typeof defaultSelectedEndpointParams !== 'undefined' && defaultSelectedEndpointParams[id]) {
					imgOvr = defaultSelectedEndpointParams[id];
				}
				if (imgOvr) {
					cfg.params = cfg.params || {};
					for (var sk in imgOvr) { if (imgOvr.hasOwnProperty(sk) && sk !== '_custom') cfg.params[sk] = imgOvr[sk]; }
				}
				const result = await callImageGeneration(cfg.style || 'openai', cfg.baseUrl, cfg.key, (info.node.modelId || info.node.name), messages, cfg.directUrl, cfg.params);
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

		// 并行处理 TTS 类端点（非流式）
		const ttsPromises = ttsIds.map(async function(id) {
			var info = findModelById(groups, id);
			if (!info) {
				return { endpointId: id, status: 'failed', error: '端点不存在', content: '' };
			}
			try {
				var cfg = resolveNodeConfig(id);
				// Merge param overrides for TTS
				var ttsOvr = null;
				if (currentSession && currentSession.modelParams && currentSession.modelParams[id]) {
					ttsOvr = currentSession.modelParams[id];
				} else if (typeof defaultSelectedEndpointParams !== "undefined" && defaultSelectedEndpointParams[id]) {
					ttsOvr = defaultSelectedEndpointParams[id];
				}
				if (ttsOvr) {
					cfg.params = cfg.params || {};
					for (var sk in ttsOvr) { if (ttsOvr.hasOwnProperty(sk) && sk !== "_custom") cfg.params[sk] = ttsOvr[sk]; }
				}
				var input = '';
				for (var i = messages.length - 1; i >= 0; i--) {
					if (messages[i].role === 'user') {
						var c = messages[i].content;
						if (Array.isArray(c) && c.length > 0 && c[0].type === 'text') {
							input = c[0].text || '';
						} else if (typeof c === 'string') {
							input = c;
						}
						break;
					}
				}
				var result = await callTTS(cfg.style || 'openai', cfg.baseUrl, cfg.key,
					(info.node.modelId || info.node.name), input, cfg.params.voice || '', cfg.params.instruction || '', cfg.directUrl);
				updateCardAsAudio(id, result, targetSessionId);
				return {
					endpointId: id,
					status: 'completed',
					content: '',
					audioResult: {
						blobUrl: result.blobUrl,
						audioData: result.audioData,
						contentType: result.contentType,
						size: result.size
					}
				};
			} catch (err) {
				updateCardStatus(id, 'failed', err.message, null, targetSessionId);
				return { endpointId: id, status: 'failed', error: err.message, content: '' };
			}
		});
		// ASR endpoints (non-streaming, file upload)
		const asrPromises = asrIds.map(async function(id) {
			var info = findModelById(groups, id);
			if (!info) {
				return { endpointId: id, status: 'failed', error: '端点不存在', content: '' };
			}
			if (!asrAudioFiles.length) {
				return { endpointId: id, status: 'failed', error: '没有音频文件', content: '' };
			}
			try {
				var cfg = resolveNodeConfig(id);
				// Merge param overrides for ASR
				var asrOvr = null;
				if (currentSession && currentSession.modelParams && currentSession.modelParams[id]) {
					asrOvr = currentSession.modelParams[id];
				} else if (typeof defaultSelectedEndpointParams !== "undefined" && defaultSelectedEndpointParams[id]) {
					asrOvr = defaultSelectedEndpointParams[id];
				}
				if (asrOvr) {
					cfg.params = cfg.params || {};
					for (var sk in asrOvr) { if (asrOvr.hasOwnProperty(sk) && sk !== "_custom") cfg.params[sk] = asrOvr[sk]; }
				}
				// Process each audio file through the ASR endpoint
				var transcriptions = [];
				for (var fi = 0; fi < asrAudioFiles.length; fi++) {
					var af = asrAudioFiles[fi];
					var result = await callASR(cfg.style || 'openai', cfg.baseUrl, cfg.key,
						(info.node.modelId || info.node.name), af, cfg.params, cfg.directUrl);
					transcriptions.push({ name: af.name, text: result.text });
				}
				var combinedText = transcriptions.map(function(t) { return t.text; }).join('\n');
				updateCardAsText(id, combinedText, targetSessionId);
				return {
					endpointId: id,
					status: 'completed',
					content: combinedText,
					asrResult: {
						transcriptions: transcriptions
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

		const [embedResults, imgGenerateResults, ttsResults, asrResults, chatResults] = await Promise.all([
			Promise.all(embedPromises),
			Promise.all(imgGeneratePromises),
			Promise.all(ttsPromises),
			Promise.all(asrPromises),
			chatPromise
		]);

		allResults.push(...embedResults, ...imgGenerateResults, ...ttsResults, ...asrResults, ...chatResults);

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




function ensureStreamingHint() {
    let hint = $('.msg.list > .streaming-hint');
    if (!hint) {
        hint = mk('div', 'hint streaming-hint sticky near-bottom');
        const text = mk('span', 'hint-text');
        text.textContent = '内容由AI生成，请仔细甄别使用';
        hint.appendChild(text);
        $('.msg.list').appendChild(hint);
    }
    return hint;
}

function showThinkingCards(endpoints, groups, sessionId) {
    const container = $(".msg.list");
    // 移除该 session 已有的 streaming 元素（防重复触发）
    $$(`[data-session-id="${sessionId}"]`).forEach(el => el.remove());

    // 在免责声明后追加思考状态
    const hint = ensureStreamingHint();
    hint.dataset.sessionId = sessionId;
    // 移除旧的流式信息（保留免责声明）
    hint.querySelectorAll('.thinking-status').forEach(el => el.remove());
    const sep = mk('span', 'sep thinking-status');
    sep.textContent = '|';
    hint.appendChild(sep);
    const hintText = mk('span', 'hint-text thinking-status');
    hintText.textContent = `${endpoints.length}个端点思考中`;
    hint.appendChild(hintText);
    const stopBtn = mk('button', 'stop-all-response btn thinking-status');
    stopBtn.textContent = '全部停止';
    hint.appendChild(stopBtn);
    stopBtn.onclick = () => {
        stopAllGenerations();
        stopBtn.disabled = true;
        stopBtn.textContent = "已停止";
        hintText.textContent = `${endpoints.length}个端点（部分已停止）`;
    };

    endpoints.forEach(id => {
        const card = fromTemplate("response-card-streaming", ".one.response.msg");
        card.querySelector(".copy.content").addEventListener("click", e => handleCopyContentClick(e.currentTarget));
        card.querySelector(".stop-one-response").addEventListener("click", e => { e.stopPropagation(); handleStopOneResponseClick(e.currentTarget); });
        card.dataset.sessionId = sessionId;
        card.dataset.endpointId = id;
        const info = findModelById(groups, id);
        const name = info ? [...(info.ancestors || []).map(a => a.name), info.node.name].join(" / ") : "未知";
        $(".response .name", card).textContent = name;
        // 单端点停止按钮
        const stopBtn = $('.stop-one-response', card);
        if (stopBtn) {
            stopBtn.classList.add('visible');
        }
        container.addChild(card);
    });
    scrollToBottom();
}

function resetStreamingHint() {
    const hint = $('.msg.list > .streaming-hint');
    if (hint) {
        hint.dataset.sessionId = '';
        // 移除流式状态信息，保留免责声明
        hint.querySelectorAll('.thinking-status').forEach(el => el.remove());
    }
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
		const meta = $('header', card);
		if (meta) meta.dataset.copyText = state.content || '';
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
		const stopBtn = $('.stop-one-response', card);
		if (stopBtn) stopBtn.classList.remove('visible');
		const contentEl = $('.say', card);
		const meta = $('header', card);
		const icon = meta ? $('.status.loading', meta) : null;
		if (icon) {
			icon.classList.remove('loading', 'spin');
			icon.classList.add('status');
			icon.classList.add(getStatusText(status));
			icon.textContent = '';
		}
		// 更新 .say 占位文本（处理空内容/被中断等）
		if (status === 'stopped' && contentEl && !contentEl.textContent.trim()) {
			contentEl.textContent = '(被中断)';
		} else if (status === 'completed' && contentEl && !contentEl.textContent.trim()) {
			contentEl.textContent = '(无内容)';
		}
		if (status === 'failed') {
			const cw = $('.content', card);
			if (cw) {
				cw.innerHTML = '';
				cw.classList.add('failed');
				const icon = mk('span', 'fail-icon');
				icon.textContent = '✗';
				cw.addChild(icon);
				if (error) {
					const err = mk('span', 'fail-msg');
					err.textContent = error;
					cw.addChild(err);
				}
			}
			const copyBtn = $('.copy.content', card);
			if (copyBtn) copyBtn.classList.add('hidden');
		} else if (status === 'stopped') {
			// 已在上方处理占位文本
		} else if (status === 'completed') {
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

	async function handleFork(msgIndex) {
		if (!currentSession) return;
		const messages = currentSession.messages;
		if (msgIndex < 0 || msgIndex >= messages.length) return;
		const msg = messages[msgIndex];
		if (msg.role !== 'user') return;
		const normalized = normalizeMessageContent(msg);
		const textItems = normalized.filter(c => c.type === 'text' || c.type === 'file_text');
		const forkText = textItems.map(c => c.text || '').join('\n');
		const contextMessages = messages.slice(0, msgIndex);
		const newSession = {
			id: generateUUID(),
			title: currentSession.title + '（分叉）',
			createdAt: Date.now(),
			messages: JSON.parse(JSON.stringify(contextMessages)),
			modelParams: currentSession.modelParams ? JSON.parse(JSON.stringify(currentSession.modelParams)) : {}
		};
		sessionsCache.set(newSession.id, newSession);
		await saveSession(newSession);
		selectedEndpoints = [...selectedEndpoints];
		currentSession = newSession;
		await refreshUI();
		const inputEl = $('#chat-input');
		if (inputEl) {
			inputEl.value = forkText;
			inputEl.focus();
			inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		}
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
	const icon = $('.theme.btn .icon');
	if (!icon) return;
	icon.classList.remove('sun', 'moon', 'half-light', 'at-left', 'outline-style');
	if (mode === 'dark') {
		icon.classList.add('moon');
	} else if (mode === 'light') {
		icon.classList.add('sun', 'outline-style');
	} else {
		icon.classList.add('half-light', 'at-left');
	}
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
		embDiv.querySelector('.dim').textContent = result.embedding.length;
		var preview = '[' + result.embedding.slice(0, 5).map(function(v) { return v.toFixed(6); }).join(', ') + ', ...]';
		embDiv.querySelector('.preview').textContent = preview;
						
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
				const overlay = mk('div', 'preview-overlay , flex items-go-x');
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

function updateCardAsAudio(endpointId, result, sessionId) {
	var card = $('.one.response.msg[data-session-id="' + sessionId + '"][data-endpoint-id="' + endpointId + '"]');
	if (!card) return;
	var sayEl = $('.say', card);
	if (sayEl) {
		sayEl.textContent = '';
		if (result.blobUrl) {
			var audio = mk('audio', '');
			audio.src = result.blobUrl;
			audio.controls = true;
			audio.style.maxWidth = '100%';
			audio.style.height = '40px';
			sayEl.addChild(audio);
		}
	}
	updateCardStatus(endpointId, 'completed', null, null, sessionId);
}
function updateCardAsText(endpointId, text, sessionId) {
	var card = $('.one.response.msg[data-session-id="' + sessionId + '"][data-endpoint-id="' + endpointId + '"]');
	if (!card) return;
	var sayEl = $('.say', card);
	if (sayEl) {
		sayEl.textContent = text;
	}
	updateCardStatus(endpointId, 'completed', null, null, sessionId);
}

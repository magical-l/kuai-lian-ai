// ========== Selected Endpoint Functions ==========
function hasOwnEndpointParams(map, endpointId) {
	return map !== null
		&& typeof map === 'object'
		&& Object.prototype.hasOwnProperty.call(map, endpointId);
}

function readOwnEndpointParams(map, endpointId) {
	return hasOwnEndpointParams(map, endpointId) ? map[endpointId] : undefined;
}

function writeOwnEndpointParams(map, endpointId, value) {
	Object.defineProperty(map, endpointId, {
		value: value,
		writable: true,
		configurable: true,
		enumerable: true
	});
}

function deleteOwnEndpointParams(map, endpointId) {
	if (!hasOwnEndpointParams(map, endpointId)) return false;
	return delete map[endpointId];
}

// Workspace-level model param overrides (localStorage, survives refresh)
function loadDefaultSelectedEndpointParams() {
	try { return JSON.parse(localStorage.getItem('defaultSelectedEndpointParams')) || {}; } catch(e) { return {}; }
}
function saveDefaultSelectedEndpointParams(obj) {
	localStorage.setItem('defaultSelectedEndpointParams', JSON.stringify(obj));
}
var defaultSelectedEndpointParams = loadDefaultSelectedEndpointParams();
var endpointParamsTransactionQueue = Promise.resolve();

async function persistEndpointParamsTransaction(endpointId, nextWorkspaceParams, sessionId, updateSessionParams) {
	const transaction = endpointParamsTransactionQueue.then(async function() {
		const hadPreviousWorkspaceParams = hasOwnEndpointParams(defaultSelectedEndpointParams, endpointId);
		const previousWorkspaceParams = readOwnEndpointParams(defaultSelectedEndpointParams, endpointId);
		const previousWorkspaceSnapshot = previousWorkspaceParams === undefined
			? undefined
			: JSON.parse(JSON.stringify(previousWorkspaceParams));
		const previousWorkspaceRaw = localStorage.getItem('defaultSelectedEndpointParams');
		try {
			if (nextWorkspaceParams === undefined) deleteOwnEndpointParams(defaultSelectedEndpointParams, endpointId);
			else writeOwnEndpointParams(defaultSelectedEndpointParams, endpointId, JSON.parse(JSON.stringify(nextWorkspaceParams)));
			saveDefaultSelectedEndpointParams(defaultSelectedEndpointParams);
			if (sessionId) {
				var updatedSession = await updateSession(sessionId, updateSessionParams);
				if (updatedSession === null) throw new Error('目标会话不存在或未保存');
			}
		} catch (error) {
			if (hadPreviousWorkspaceParams) writeOwnEndpointParams(defaultSelectedEndpointParams, endpointId, previousWorkspaceSnapshot);
			else deleteOwnEndpointParams(defaultSelectedEndpointParams, endpointId);
			try {
				if (previousWorkspaceRaw === null) localStorage.removeItem('defaultSelectedEndpointParams');
				else localStorage.setItem('defaultSelectedEndpointParams', previousWorkspaceRaw);
			} catch (rollbackError) {
				error.rollbackError = rollbackError;
			}
			throw error;
		}
	});
	endpointParamsTransactionQueue = transaction.catch(function() {});
	return transaction;
}

function handleSelectedEndpointClick(tag) {
	openSessionParamEditor(tag.dataset.endpoint);
	if (tag._tooltip) tag._tooltip.hide();
}

function openSessionParamEditor(endpointId) {
	var dialog = document.querySelector('dialog.session-param-editor');
	if (!dialog) return;
	var info = findModelById(getGroups(), endpointId);
	var rcfg = resolveNodeConfig(endpointId);
	if (!info || !rcfg) return;
	var openedSession = currentSession;
	var sessionId = openedSession ? openedSession.id : null;
	if (!dialog._paramLifecycleGuardBound && typeof dialog.addEventListener === 'function') {
		dialog._paramLifecycleGuardBound = true;
		function invalidateParamOperations() {
			dialog._paramOperationGeneration = (dialog._paramOperationGeneration || 0) + 1;
		}
		dialog.addEventListener('cancel', invalidateParamOperations);
		dialog.addEventListener('close', invalidateParamOperations);
	}
	var operationGeneration = (dialog._paramOperationGeneration || 0) + 1;
	dialog._paramOperationGeneration = operationGeneration;
	function beginOperation() {
		operationGeneration += 1;
		dialog._paramOperationGeneration = operationGeneration;
		return operationGeneration;
	}
	function isCurrentOperation(generation) {
		return dialog._paramOperationGeneration === generation;
	}
	var fullName = [...(info.ancestors || []).map(function(a) { return a.name; }), info.node.name].join('/');
	var nameEl = dialog.querySelector('.model-path');
	if (nameEl) nameEl.textContent = fullName;
	var overrideSrc = null;
	if (openedSession) {
		if (hasOwnEndpointParams(openedSession.modelParams, endpointId)) {
			overrideSrc = readOwnEndpointParams(openedSession.modelParams, endpointId);
		}
	} else if (hasOwnEndpointParams(defaultSelectedEndpointParams, endpointId)) {
		overrideSrc = readOwnEndpointParams(defaultSelectedEndpointParams, endpointId);
	}
	var ownOverride = overrideSrc ? JSON.parse(JSON.stringify(overrideSrc)) : {};
	var endpointParams = rcfg.params ? JSON.parse(JSON.stringify(rcfg.params)) : {};
	var paramList = dialog.querySelector('.param-control.list');
	function renderControls() {
		if (!paramList) return;
		renderModelParamControls(
			paramList,
			getParamDefs(rcfg.type || 'chat', rcfg.style || 'openai'),
			ownOverride,
			endpointParams,
			{
				allowInherit: true,
				inheritLabel: '沿用端点设置',
				inheritValueLabel: '当前为',
				modelLabel: '由模型决定'
			}
		);
	}
	renderControls();
	dialog.showModal();

	dialog.querySelector('.close').onclick = function() {
		beginOperation();
		dialog.close();
	};

	dialog.querySelector('.ok').onclick = async function() {
		var generation = beginOperation();
		if (!paramList) {
			if (isCurrentOperation(generation)) dialog.close();
			return;
		}
		var collected = collectModelParamControls(paramList, ownOverride);
		if (!collected.valid) {
			if (collected.firstInvalidControl) collected.firstInvalidControl.focus();
			return;
		}
		var params = collected.params;
		var nextWorkspaceParams = Object.keys(params).length > 0 ? params : undefined;
		try {
			await persistEndpointParamsTransaction(endpointId, nextWorkspaceParams, sessionId, function(session) {
				if (nextWorkspaceParams === undefined) {
					deleteOwnEndpointParams(session.modelParams, endpointId);
				} else {
					if (!session.modelParams) session.modelParams = {};
					writeOwnEndpointParams(session.modelParams, endpointId, JSON.parse(JSON.stringify(params)));
				}
				if (session.modelParams && Object.keys(session.modelParams).length === 0) delete session.modelParams;
			});
			if (!isCurrentOperation(generation)) return;
			ownOverride = JSON.parse(JSON.stringify(params));
			renderControls();
			dialog.close();
		} catch (error) {
			if (isCurrentOperation(generation)) alert('参数保存失败：' + error.message);
		}
	};

	dialog.querySelector('.reset').onclick = async function() {
		var generation = beginOperation();
		try {
			await persistEndpointParamsTransaction(endpointId, undefined, sessionId, function(session) {
				if (!session.modelParams) return;
				deleteOwnEndpointParams(session.modelParams, endpointId);
				if (Object.keys(session.modelParams).length === 0) delete session.modelParams;
			});
			if (!isCurrentOperation(generation)) return;
			ownOverride = {};
			renderControls();
		} catch (error) {
			if (isCurrentOperation(generation)) alert('参数重置失败：' + error.message);
		}
	};
}
function removeWorkspaceEndpointParams(endpointId) {
	if (!deleteOwnEndpointParams(defaultSelectedEndpointParams, endpointId)) return;
	saveDefaultSelectedEndpointParams(defaultSelectedEndpointParams);
}

function handleSelectedEndpointRemoveClick(btn) {
	toggleEndpointSelection(btn.dataset.endpoint, true);
}
function handleSelectedEndpointMouseover(e, tag) {
	if (e.target.closest('.remove.btn')) {
		if (tag._tooltip) tag._tooltip.hide();
		return;
	}
	if (tag._tooltip) tag._tooltip.show();
}
function handleSelectedEndpointMouseleave(tag) {
	if (tag._tooltip) tag._tooltip.hide();
}
function renderSelectedEndpoints(groups, selectedEndpoints, isGenerating) {
    const summaryEl = $(".selected.endpoint.list");
    if (!summaryEl) return;

    // 移除上次渲染的端点标签，保留模板和空态提示
    $$('.one.endpoint', summaryEl).forEach(el => el.remove());

    const hint = $('.empty.hint', summaryEl);

    if (selectedEndpoints.length === 0) {
        if (hint) hint.classList.remove('hidden');

        return;
    }

    if (hint) hint.classList.add('hidden');

    const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
    const typeIconMap = { chat: 'chat', embedding: 'digits', embed: 'digits', image: 'palette', 'img-generate': 'palette', rerank: 'chart', tts: 'speaker', asr: 'mic', 'video-generation': 'video', video: 'video' };

    selectedEndpoints.forEach(id => {
        const info = findModelById(groups, id);
        if (!info) return;

        const li = fromTemplate('template-selected-endpoint', 'li');
        const rcfg = resolveNodeConfig(id);
        const genState = gens ? gens.get(id) : null;

        li.dataset.endpoint = id;
        li.querySelector('.remove.btn').dataset.endpoint = id;

        const statusClass = getTagStatusClass(id);
        if (statusClass) li.classList.add(statusClass);
        const speedClass = genState?.firstTokenTime ? getSpeedClass(genState.firstTokenTime) : '';
        if (speedClass) li.classList.add('speed-' + speedClass);

        li.querySelector('.endpoint-type').classList.add(typeIconMap[rcfg?.type] || 'chat');
        li.querySelector('.full.name').textContent = [...(info.ancestors || []).map(a => a.name), info.node.name].join('/');

        const remarkEl = li.querySelector('.remark');
        if (info.node.remark) {
            remarkEl.textContent = ' ' + info.node.remark;
        } else {
            remarkEl.remove();
        }

        // 模板事件绑定（取代 HTML onxxx）
        li.addEventListener('click', e => handleSelectedEndpointClick(e.currentTarget));
        li.addEventListener('mouseover', e => handleSelectedEndpointMouseover(e, e.currentTarget));
        li.addEventListener('mouseleave', e => handleSelectedEndpointMouseleave(e.currentTarget));
        li.querySelector('.remove').addEventListener('click', e => { e.stopPropagation(); handleSelectedEndpointRemoveClick(e.currentTarget); });
        summaryEl.appendChild(li);
        // 创建 tooltip
        var selTooltipId = "tooltip-sel-" + id.replace(/[:\/\\]/g, '-');
        li._tooltip = createTooltip(selTooltipId, li, buildTooltipHTML(info.node, rcfg, [...(info.ancestors || []).map(a => a.name), info.node.name].join("/")));
    });
}


// findModelById is defined in store.js (recursive tree version)

function getTagStatusClass(endpointId) {
	const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
	const gen = gens ? gens.get(endpointId) : null;
	if (!gen) return '';
	// Only show color for failed/stopped status
	if (gen.status === 'failed') return 'failed';
	if (gen.status === 'stopped') return 'stopped';
	return '';
}
// getStatusIcon 已取消：选中端点的转圈功能不再需要
function toggleEndpointSelection(id, forceRemove) {
    if (!id) return;
    const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
    const isGenerating = gens && gens.size > 0 && Array.from(gens.values()).some(s => s.status === 'generating');
    if (isGenerating) return;
    if (forceRemove || selectedEndpoints.includes(id)) {
        selectedEndpoints = selectedEndpoints.filter(x => x !== id);
        removeWorkspaceEndpointParams(id);
    } else {
        if (!selectedEndpoints.includes(id)) {
            selectedEndpoints.push(id);
        }
    }
    saveDefaultSelectedEndpoints(selectedEndpoints);
    renderSelectedEndpoints(getGroups(), selectedEndpoints, false);
    syncJoinBtnState(id.split(':')[0]);
}
function syncJoinBtnState(nid) {
	if (!nid) return;
	var eg = document.querySelector('.one.endpoint[data-node-id="' + nid + '"]');
	if (!eg) return;
	var jb = eg.querySelector('.join-session');
	if (!jb) return;
	applyJoinBtnUI(jb, nid);
}
function applyJoinBtnUI(btn, nid) {
	if (!btn || !nid) return;
	var eid = nid;
	var cb = btn.querySelector('input[type=checkbox]');
	if (selectedEndpoints.indexOf(eid) >= 0) {
		btn.title = '已加入当前会话';
		if (cb) cb.checked = true;
	} else {
		btn.title = '加入当前会话';
		if (cb) cb.checked = false;
	}
	var useEl = btn.querySelector('svg use');
	if (useEl) useEl.style.fill = selectedEndpoints.indexOf(eid) >= 0 ? 'currentColor' : '';
}

// === 共享 tooltip HTML 构建函数（端点树和已选列表复用）===
function buildTooltipHTML(node, rcfg, nameOverride) {
	return function(el) {
		var styleLabels = {
			"openai": "OpenAI",
			"claude": "Claude",
			"gemini": "Gemini",
			"responses": "Responses"
		};
		function inherited(val, own) {
			return val && val !== own ? "↑ " : "";
		}
		function setRow(rowName, value, copyValue) {
			var row = el.querySelector('[data-row="' + rowName + '"]');
			row.querySelector(".value").textContent = value || "";
			row.querySelector(".copy.value.btn").dataset.copy = (copyValue || value || "");
			return row;
		}
		var tipName = nameOverride || node.name;
		var tipBaseUrl = inherited(rcfg.baseUrl, node.baseUrl) + (rcfg.baseUrl || "");
		var tipKey = inherited(rcfg.key, node.key) + (rcfg.key ? "(已设置)" : "");
		var tipStyle = inherited(rcfg.style, node.style) ? "↑ " + (styleLabels[rcfg.style] || rcfg.style) : (styleLabels[rcfg.style] || rcfg.style || "");
		var tipModel = inherited(rcfg.modelId, node.modelId) + (rcfg.modelId || "");
		setRow("name", tipName, tipName);
		setRow("baseUrl", tipBaseUrl, rcfg.baseUrl || "");
		setRow("style", tipStyle, rcfg.style || "");
		var keyRow = setRow("key", tipKey, rcfg.key || "");
		keyRow.classList.toggle('hidden', !rcfg.key);
		setRow("model", tipModel || "-", rcfg.modelId || "");
		var remarkRow = setRow("remark", node.remark || "", node.remark || "");
		remarkRow.classList.toggle('hidden', !node.remark);
	};
}

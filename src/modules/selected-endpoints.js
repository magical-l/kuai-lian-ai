// ========== Selected Endpoint Functions ==========
// Workspace-level model param overrides (localStorage, survives refresh)
function loadDefaultSelectedEndpointParams() {
	try { return JSON.parse(localStorage.getItem('defaultSelectedEndpointParams')) || {}; } catch(e) { return {}; }
}
function saveDefaultSelectedEndpointParams(obj) {
	localStorage.setItem('defaultSelectedEndpointParams', JSON.stringify(obj));
}
var defaultSelectedEndpointParams = loadDefaultSelectedEndpointParams();

function handleSelectedEndpointClick(tag) {
	openSessionParamEditor(tag.dataset.endpoint);
	if (tag._tooltip) tag._tooltip.hide();
}

function renderParamControlsInDialog(dialog, rcfg, existingParams) {
	var paramList = dialog.querySelector('.param-control.list');
	if (!paramList) return;
	var defs = typeof getParamDefs === 'function' ? getParamDefs(rcfg.type || 'chat', rcfg.style || 'openai') : [];
	paramList.innerHTML = '';
	if (defs.length === 0) { paramList.innerHTML = '<div style="padding:8px;color:var(--text-muted);font-size:13px">This model type has no configurable parameters</div>'; return; }
	defs.forEach(function(def) {
		var row = document.createElement('div');
		row.className = 'param-row , flex items-go-x items-y-near-center';
		row.style.gap = 'var(--space-2)';
		row.style.marginBottom = 'var(--space-1)';
		var label = document.createElement('span');
		label.className = 'field-label';
		label.style.cssText = 'font-size:13px;font-weight:500;color:var(--text-secondary);width:120px;text-align:right;flex-shrink:0';
		label.textContent = def.label + ':';
		row.appendChild(label);
		var ctrl = document.createElement('span');
		ctrl.className = 'field-control';
		ctrl.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:var(--space-2);flex:1;min-width:0';
		var val = existingParams && existingParams.hasOwnProperty(def.key) ? existingParams[def.key] : (def.hasOwnProperty('default') ? def.default : '');
		if (def.type === 'range') {
			var input = document.createElement('input');
			input.type = 'range'; input.name = 'param-' + def.key;
			if (def.min !== undefined) input.min = def.min;
			if (def.max !== undefined) input.max = def.max;
			if (def.step !== undefined) input.step = def.step;
			input.value = val !== '' ? val : def.default;
			input.style.cssText = 'flex:1;min-width:60px';
			var valSpan = document.createElement('span');
			valSpan.className = 'param val';
			valSpan.style.cssText = 'font-size:13px;color:var(--text-secondary);min-width:3em;text-align:right;font-variant-numeric:tabular-nums';
			valSpan.textContent = input.value;
			input.addEventListener('input', function() { valSpan.textContent = this.value; });
			ctrl.appendChild(input); ctrl.appendChild(valSpan);
		} else if (def.type === 'integer') {
			var input = document.createElement('input');
			input.type = 'number'; input.name = 'param-' + def.key;
			if (def.min !== undefined) input.min = def.min;
			if (def.max !== undefined) input.max = def.max;
			if (val !== '') input.value = val;
			else if (def.hasOwnProperty('default')) input.value = def.default;
			ctrl.appendChild(input);
		} else if (def.type === 'text') {
			var input = document.createElement('input');
			input.type = 'text'; input.name = 'param-' + def.key;
			if (def.placeholder) input.placeholder = def.placeholder;
			if (val !== '') input.value = val;
			input.style.cssText = 'flex:1;min-width:0';
			ctrl.appendChild(input);
		} else if (def.type === 'select') {
			var sel = document.createElement('select');
			sel.name = 'param-' + def.key;
			(def.options || []).forEach(function(opt) {
				var optEl = document.createElement('option');
				optEl.value = opt; optEl.textContent = opt;
				if (opt === val || (val === '' && opt === def.default)) optEl.selected = true;
				sel.appendChild(optEl);
			});
			ctrl.appendChild(sel);
		}
		row.appendChild(ctrl);
		paramList.appendChild(row);
	});
}

function openSessionParamEditor(endpointId) {
	var dialog = document.querySelector('dialog.session-param-editor');
	if (!dialog) return;
	var info = findModelById(getGroups(), endpointId);
	var rcfg = resolveNodeConfig(endpointId);
	if (!info || !rcfg) return;
	var fullName = [...(info.ancestors || []).map(function(a) { return a.name; }), info.node.name].join('/');
	var nameEl = dialog.querySelector('.model-path');
	if (nameEl) nameEl.textContent = fullName;
	// Merge defaults: session params > workspace params > endpoint defaults
	var defaults = {};
	if (rcfg.params) { for (var k in rcfg.params) { if (rcfg.params.hasOwnProperty(k)) defaults[k] = rcfg.params[k]; } }
	var overrideSrc = null;
	if (currentSession && currentSession.modelParams && currentSession.modelParams[endpointId]) {
		overrideSrc = currentSession.modelParams[endpointId];
	} else if (defaultSelectedEndpointParams[endpointId]) {
		overrideSrc = defaultSelectedEndpointParams[endpointId];
	}
	if (overrideSrc) { for (var k in overrideSrc) { if (overrideSrc.hasOwnProperty(k) && k !== '_custom') defaults[k] = overrideSrc[k]; } }
	renderParamControlsInDialog(dialog, rcfg, Object.keys(defaults).length > 0 ? defaults : null);
	dialog.showModal();

	// Bind buttons
	dialog.querySelector('.close').onclick = function() { dialog.close(); };

	dialog.querySelector('.ok').onclick = function() {
		var paramList = dialog.querySelector('.param-control.list');
		if (!paramList) { dialog.close(); return; }
		var params = {};
		var inputs = paramList.querySelectorAll('input, select');
		inputs.forEach(function(el) {
			var key = el.name.replace(/^param-/, '');
			if (!key) return;
			if (el.type === 'number') { var n = parseFloat(el.value); if (!isNaN(n)) params[key] = n; }
			else if (el.type === 'range') { params[key] = parseFloat(el.value); }
			else if (el.type === 'text' || el.type === 'password') { params[key] = el.value; }
			else { params[key] = el.value; }
		});
		// Save to workspace (always) and session (if available)
		defaultSelectedEndpointParams[endpointId] = params;
		saveDefaultSelectedEndpointParams(defaultSelectedEndpointParams);
		if (currentSession) {
			if (!currentSession.modelParams) currentSession.modelParams = {};
			currentSession.modelParams[endpointId] = JSON.parse(JSON.stringify(params));
			storage.saveSession(currentSession);
		}
		dialog.close();
	};

	dialog.querySelector('.reset').onclick = function() {
		delete defaultSelectedEndpointParams[endpointId];
		saveDefaultSelectedEndpointParams(defaultSelectedEndpointParams);
		if (currentSession && currentSession.modelParams) {
			delete currentSession.modelParams[endpointId];
			if (Object.keys(currentSession.modelParams).length === 0) delete currentSession.modelParams;
			storage.saveSession(currentSession);
		}
		defaults = {};
		if (rcfg && rcfg.params) { for (var k in rcfg.params) { if (rcfg.params.hasOwnProperty(k)) defaults[k] = rcfg.params[k]; } }
		renderParamControlsInDialog(dialog, rcfg, Object.keys(defaults).length > 0 ? defaults : null);
	};
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
    const typeIconMap = { chat: 'chat', embedding: 'digits', embed: 'digits', image: 'palette', 'img-generate': 'palette', rerank: 'chart', tts: 'speaker', asr: 'mic' };

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
			"gemini": "Gemini"
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

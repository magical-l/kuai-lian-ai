// ========== Selected Endpoint Functions ==========
function renderSelectedEndpoints(groups, selectedEndpoints, isGenerating) {
    const summaryEl = $(".selected.endpoint.list");

    if (!summaryEl)
        return;

    if (selectedEndpoints.length === 0) {
        summaryEl.innerHTML = `<span class="empty hint">请选择端点</span>`;
    } else {
        summaryEl.innerHTML = selectedEndpoints.map(id => {
            const info = findModelById(groups, id);

            if (!info)
                return "";

            const statusClass = getTagStatusClass(id);
            const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
            const genState = gens ? gens.get(id) : null;
            const speedClass = genState?.firstTokenTime ? getSpeedClass(genState.firstTokenTime) : "";

            const classes = [
                "one",
                "endpoint",
                statusClass,
                speedClass ? `speed-${speedClass}` : ""
            ].filter(Boolean).join(" ");

            const remarkHtml = (info.node.remark) ? `<span class="remark"> ${info.node.remark}</span>` : "";
            const fullPath = [...(info.ancestors || []).map(a => a.name), info.node.name].join("/");
            return `<li class="${classes}" data-endpoint="${id}">
						<span class="full name">${fullPath}</span>
						${remarkHtml}
						<span class="btn remove bare icon-only" data-endpoint="${id}">✕</span>
					</li>`;
        }).join("");
    }

    bindSelectorEvents();
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
function bindSelectorEvents() {
    // Make entire model tag clickable for toggle selection
    $$('.selected.endpoint.list .one.endpoint').forEach(tag => {
        tag.onclick = e => {
            e.stopPropagation();
            toggleEndpointSelection(tag.dataset.endpoint);
        };
    });
    // 标签上的小叉：移除该端点
    $$('.selected.endpoint.list .one.endpoint > .remove.btn').forEach(function(btn) {
        btn.onclick = function(e) {
            e.stopPropagation();
            toggleEndpointSelection(btn.dataset.endpoint, true);
        };
    });

    // 为每个选中的端点标签添加 tooltip
    $$('.selected.endpoint.list .one.endpoint').forEach(tag => {
        var selEndpointId = tag.dataset.endpoint;
        var selInfo = findModelById(getGroups(), selEndpointId);
        if (!selInfo) return;
        var selNode = selInfo.node;
        var selAncestors = selInfo.ancestors || [];
        var selRcfg = resolveNodeConfig(selEndpointId);
        var selDisplayName = [...selAncestors.map(a => a.name), selNode.name].join("/");
        var selTooltipId = "tooltip-sel-" + selEndpointId.replace(/[:\/\\]/g, '-');
        var selTooltip = createTooltip(selTooltipId, buildTooltipHTML(selNode, selRcfg, selDisplayName));
        tag.addEventListener("mouseover", function(e) {
            if (e.target.closest('.remove.btn')) {
                selTooltip.hide();
                return;
            }
            selTooltip.show(tag);
        });
        tag.addEventListener("mouseleave", function() {
            selTooltip.hide();
        });
        tag.addEventListener("click", function() {
            selTooltip.hide();
        });
    });
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
	var styleLabels = {
		"openai": "OpenAI",
		"claude": "Claude",
		"gemini": "Gemini"
	};
	function inherited(val, own) {
		return val && val !== own ? "↑ " : "";
	}
	function row(label, value, copyValue) {
		var safe = (copyValue || value || "");
		return `<div class="row flex items-go-x">
					<span class="label">${label}：</span>
					<span class="value">${value || ""}</span>
					<button class="copy value btn , bare icon-only , square" data-copy="${safe}" title="复制">
						<span class="copy icon ⧉">⧉</span>
						<span class="done icon">✓</span>
					</button>
				</div>`;
	}
	var tipName = nameOverride || node.name;
	var tipBaseUrl = inherited(rcfg.baseUrl, node.baseUrl) + (rcfg.baseUrl || "");
	var tipKey = inherited(rcfg.key, node.key) + (rcfg.key ? "(已设置)" : "");
	var tipStyle = inherited(rcfg.style, node.style) ? "↑ " + (styleLabels[rcfg.style] || rcfg.style) : (styleLabels[rcfg.style] || rcfg.style || "");
	var tipModel = inherited(rcfg.modelId, node.modelId) + (rcfg.modelId || "");
	return row("名称", tipName, tipName) +
		row("地址", tipBaseUrl, rcfg.baseUrl || "") +
		row("格式", tipStyle, rcfg.style || "") +
		(rcfg.key ? row("Key", tipKey, rcfg.key || "") : "") +
		row("模型", tipModel || "-", rcfg.modelId || "") +
		(node.remark ? row("备注", node.remark, node.remark) : "");
}

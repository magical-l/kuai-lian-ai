// ========== Model Selector Functions ==========
let selectorExpanded = false;

function renderModelSelector(groups, selectedModels, isGenerating) {
	const container = $('#model-selector');
	const summaryEl = $('#selector-summary');
	const listEl = $('#selector-list');
	const expandBtnText = $('#expand-btn-text');
	if (!container) return;
	// 更新容器状态
	container.classList.toggle('collapsed', !selectorExpanded);
	container.classList.toggle('generating', isGenerating);
	// 收起状态摘要
	if (selectedModels.length === 0) {
		summaryEl.innerHTML = '<span class="selector empty-hint">请选择模型</span>';
		expandBtnText.textContent = selectorExpanded ? '▲ 收起' : '▼ 展开选择';
	} else {
		summaryEl.innerHTML = selectedModels.map(id => {
			const info = findModelById(groups, id);
			if (!info) return '';
			const statusClass = getTagStatusClass(id);
			const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
			const genState = gens ? gens.get(id) : null;
			const speedClass = genState?.firstTokenTime ? getSpeedClass(genState.firstTokenTime) : '';
			const classes = ['model', 'tag', 'selected', statusClass, speedClass ? `speed-${speedClass}` : ''].filter(Boolean).join(' ');
			const remarkHtml = info.model.remark ? `<span class="model-remark"> ${info.model.remark}</span>` : '';
			return `<span class="${classes}" data-model="${id}"><span class="endpoint name-color">${info.node.name}</span> ${info.model.name}${remarkHtml}<span class="tag-remove" data-model="${id}">✕</span></span>`;
		}).join('');
		expandBtnText.textContent = selectorExpanded ? '▲ 收起' : '▼ 展开';
	}
	// 展开状态列表（递归树形）
	if (selectorExpanded) {
		var parts = [];
		(function renderSubtree(nodes, depth) {
			nodes.forEach(function(n) {
				parts.push('<div class="selector group-label" style="padding-left:' + (depth * 14) + 'px">' + n.name + '</div>');
				if (n.models && n.models.length > 0) {
					var tags = n.models.map(function(m) {
						var isSelected = selectedModels.indexOf(n.id + ':' + m.id) >= 0;
						var statusClass = getTagStatusClass(n.id + ':' + m.id);
						var cls = isSelected ? (statusClass ? 'selected ' + statusClass : 'selected') : 'unselected';
						var mRemark = m.remark ? '<span class="model-remark"> ' + m.remark + '</span>' : '';
						return '<span class="model tag ' + cls + '" data-model="' + n.id + ':' + m.id + '">' + m.name + mRemark + '</span>';
					}).join('');
					parts.push('<div class="selector models-row layout-x-queue">' + tags + '</div>');
				}
				if (n.children) renderSubtree(n.children, depth + 1);
			});
		})(groups, 0);
		listEl.innerHTML = parts.join('');
	}
	bindSelectorEvents();
}

// findModelById is defined in store.js (recursive tree version)

function getTagStatusClass(modelId) {
	const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
	const gen = gens ? gens.get(modelId) : null;
	if (!gen) return '';
	// Only show color for failed/stopped status
	if (gen.status === 'failed') return 'failed';
	if (gen.status === 'stopped') return 'stopped';
	return '';
}
// getStatusIcon 已取消：选中模型的转圈功能不再需要
function bindSelectorEvents() {
	const expandBtn = $('#selector-expand-btn');
	if (expandBtn) {
		expandBtn.onclick = () => {
			// 实时检查生成状态
			const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
			const isGenerating = gens && gens.size > 0 && Array.from(gens.values()).some(s => s.status === 'generating');
			if (isGenerating) return;
			selectorExpanded = !selectorExpanded;
			renderModelSelector(getGroups(), selectedModels, false);
		};
	}
	// Make entire model tag clickable for toggle selection
	$$('.model.tag').forEach(tag => {
		tag.onclick = e => {
			e.stopPropagation();
			// 实时检查生成状态（放在点击时检查，而非绑定时）
			const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
			const isGenerating = gens && gens.size > 0 && Array.from(gens.values()).some(s => s.status === 'generating');
			if (isGenerating) return;
			const id = tag.dataset.model;
			if (!id) return;
			if (selectedModels.includes(id)) {
				selectedModels = selectedModels.filter(x => x !== id);
			} else {
				if (!selectedModels.includes(id)) {
					selectedModels.push(id);
				}
			}
			saveDefaultSelectedModels(selectedModels);
			renderModelSelector(getGroups(), selectedModels, false);
		};
	});
	// 标签上的小叉：移除该模型
	$$('.tag-remove').forEach(function(btn) {
		btn.onclick = function(e) {
			e.stopPropagation();
			var gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
			var isGenerating = gens && gens.size > 0 && Array.from(gens.values()).some(function(s) { return s.status === 'generating'; });
			if (isGenerating) return;
			var id = btn.dataset.model;
			if (!id) return;
			selectedModels = selectedModels.filter(function(x) { return x !== id; });
			saveDefaultSelectedModels(selectedModels);
			renderModelSelector(getGroups(), selectedModels, false);
			// 同步左侧栏对应节点的加入按钮状态
			var nid = id && id.split(':')[0];
			if (nid) {
				var eg = document.querySelector('.endpoint-group[data-node-id="' + nid + '"]');
				if (eg) {
					var jb = eg.querySelector('.join-session');
					if (jb) { jb.title = '加入当前会话'; jb.className = 'action join-session'; }
				}
			}
		};
	});
}
// 收起展开的模型选择器（用户点击外部区域时）
doc.on('click', e => {
	if (!selectorExpanded) return;
	const selector = $('#model-selector');
	if (selector && !selector.contains(e.target)) {
		selectorExpanded = false;
		renderModelSelector(getGroups(), selectedModels, false);
	}
});
const collapsedEndpoints = new Set();

function collapseAllEndpointNodes() {
	// 收集所有节点ID
	var ids = [];
	function collectIds(nodes) {
		nodes.forEach(function(n) {
			ids.push(n.id);
			if (n.children) collectIds(n.children);
		});
	}
	collectIds(getGroups());
	ids.forEach(function(id) { collapsedEndpoints.add(id); });
	// 直接操作DOM收起
	$$('.endpoint-group').forEach(function(el) {
		var toggle = $('.group-toggle', el);
		var content = $('.node-content', el);
		if (content) content.style.display = 'none';
		if (toggle) toggle.textContent = '▶';
	});
}

let attachmentTooltip = null;

function showAttachmentTooltip(name, targetEl) {
	if (!attachmentTooltip) {
		attachmentTooltip = mk('div');
		attachmentTooltip.style.cssText = 'position:fixed;background:var(--bg-elevated);border:1px solid var(--border-subtle);padding:2px 6px;font-size:11px;border-radius:4px;z-index:9999;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:var(--shadow-sm);pointer-events:none;';
		doc.body.appendChild(attachmentTooltip);
	}
	attachmentTooltip.textContent = name;
	attachmentTooltip.style.display = 'block';
	const rect = targetEl.getBoundingClientRect();
	// 显示在缩略图上方
	attachmentTooltip.style.left = rect.left + 'px';
	attachmentTooltip.style.top = (rect.top - 24) + 'px';
}

function hideAttachmentTooltip() {
	if (attachmentTooltip) {
		attachmentTooltip.style.display = 'none';
	}
}

function renderPendingAttachments() {
	const row = $('#attachments-row');
	if (!row) return;
	row.innerHTML = '';
	pendingAttachments.forEach(att => {
		const thumb = mk('div', `attachment-thumb layout-x-queue ${att.type === 'image' ? 'image' : 'file'}`);
		thumb.dataset.id = att.id;
		if (att.type === 'image' && att.previewUrl) {
			thumb.style.backgroundImage = `url(${att.previewUrl})`;
		} else {
			thumb.textContent = '📄';
		}
		// hover显示名字
		thumb.onmouseenter = () => showAttachmentTooltip(att.name, thumb);
		thumb.onmouseleave = () => hideAttachmentTooltip();
		const remove = mk('span', 'attachment-remove');
		remove.textContent = '×';
		remove.onclick = (e) => {
			e.stopPropagation();
			removeAttachment(att.id);
			renderPendingAttachments();
		};
		thumb.appendChild(remove);
		// 点击预览
		thumb.onclick = () => showAttachmentPreview(att);
		row.appendChild(thumb);
	});
}

function showAttachmentPreview(att) {
	if (att.type === 'image' && att.previewUrl) {
		// 图片预览弹窗
		const overlay = mk('div', 'image-preview-overlay layout-x-queue');
		overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';
		const img = mk('img');
		img.src = att.previewUrl;
		img.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px;';
		overlay.onclick = () => overlay.remove();
		overlay.appendChild(img);
		document.body.appendChild(overlay);
	} else {
		// 文件下载
		const link = mk('a');
		link.href = att.previewUrl || URL.createObjectURL(att.file);
		link.download = att.name;
		link.click();
		if (!att.previewUrl) URL.revokeObjectURL(link.href);
	}
}

function renderEndpointList(nodes, selectedModelId, onModelSelect, onModelEdit, onNodeEdit, onNodeDelete, onAddModel, onModelDelete, onReorderNodes, onReorderModels, onTestConnection, onMoveNode) {
	var container = $('#endpoint-list');
	$$('.endpoint-group', container).forEach(function(el) {
		var nodeId = el.dataset.nodeId;
		var content = $('.node-content', el);
		if (content && content.style.display === 'none') {
			collapsedEndpoints.add(nodeId);
		} else {
			collapsedEndpoints['delete'](nodeId);
		}
	});
	container.innerHTML = '';

	function renderTreeNode(nodes, parentEl, depth) {
		nodes.forEach(function(node, index) {
			var hasChildren = node.children && node.children.length > 0;
			var hasModels = node.models && node.models.length > 0;
			var isCollapsed = collapsedEndpoints.has(node.id);
			var hasContent = hasChildren || hasModels;

			var nodeEl = mk('section', 'endpoint-group');
			nodeEl.dataset.nodeId = node.id;
			nodeEl.dataset.nodeIndex = index;

			var headerEl = mk('div', 'group-header layout-x-queue');
			headerEl.style.paddingLeft = (depth * 12 + 4) + 'px';

			var dragHandle = mk('span', 'drag-handle layout-x-queue');
			dragHandle.innerHTML = SVG.drag(14);
			dragHandle.title = '拖动排序';
			dragHandle.draggable = true;
			dragHandle.on('dragstart', function(e) {
				e.dataTransfer.setData('text/plain', node.id);
				e.dataTransfer.effectAllowed = 'move';
				nodeEl.classList.add('dragging');
			});
			dragHandle.on('dragend', function() {
				nodeEl.classList.remove('dragging');
				$$('.endpoint-group', container).forEach(function(el) { el.classList.remove('drag-over', 'drag-over-child', 'drag-over-before', 'drag-over-after'); });
			});

			var toggleSpan = mk('span', 'group-toggle');
			toggleSpan.textContent = isCollapsed || !hasContent ? '▶' : '▼';
			if (!hasContent) toggleSpan.style.visibility = 'hidden';
			toggleSpan.on('click', function(e) {
				e.stopPropagation();
				var ct = $('.node-content', nodeEl);
				if (!ct) return;
				if (ct.style.display === 'none') {
					ct.style.display = '';
					toggleSpan.textContent = '▼';
				} else {
					ct.style.display = 'none';
					toggleSpan.textContent = '▶';
				}
			});

			var nameSpan = mk('span', 'group-name');
			var rcfg = resolveNodeConfig(node.id);
			nameSpan.textContent = node.name;
			if (node.remark) {
				var remSpan = document.createElement('span');
				remSpan.className = 'model-remark';
				remSpan.textContent = ' ' + node.remark;
				nameSpan.appendChild(remSpan);
			}


			var tooltipId = 'tooltip-' + node.id;
			var styleLabels = { 'openai': 'OpenAI', 'claude': 'Claude', 'gemini': 'Gemini' };
			// 判断每个字段是自设还是继承
			function inherited(val, own) { return val && val !== own ? '↑ ' : ''; }
			var tipName = node.name + (node.remark ? ' ' + node.remark : '');
			var tipBaseUrl = inherited(rcfg.baseUrl, node.baseUrl) + (rcfg.baseUrl || '');
			var tipKey = inherited(rcfg.key, node.key) + (rcfg.key ? '(已设置)' : '');
			var tipStyle = inherited(rcfg.style, node.style) ? '↑ ' + (styleLabels[rcfg.style] || rcfg.style) : (styleLabels[rcfg.style] || rcfg.style || '');
			var tipModel = inherited(rcfg.modelId, node.modelId) + (rcfg.modelId || '');
			var tooltipHTML =
				'<div class="tooltip-row layout-x-queue">' +
				'<span class="tooltip-label">名称：</span>' +
				'<span class="tooltip-value">' + tipName + '</span>' +
				'<button class="tooltip-copy" data-copy="' + tipName + '" title="复制">⧉</button></div>' +
				'<div class="tooltip-row layout-x-queue">' +
				'<span class="tooltip-label">地址：</span>' +
				'<span class="tooltip-value">' + tipBaseUrl + '</span>' +
				'<button class="tooltip-copy" data-copy="' + (rcfg.baseUrl || '') + '" title="复制">⧉</button></div>' +
				'<div class="tooltip-row layout-x-queue">' +
				'<span class="tooltip-label">格式：</span>' +
				'<span class="tooltip-value">' + tipStyle + '</span>' +
				'<button class="tooltip-copy" data-copy="' + (rcfg.style || '') + '" title="复制">⧉</button></div>' +
				(rcfg.key ? '<div class="tooltip-row layout-x-queue"><span class="tooltip-label">Key：</span><span class="tooltip-value">' + tipKey + '</span><button class="tooltip-copy" data-copy="' + (rcfg.key || '') + '" title="复制">⧉</button></div>' : '') +
				'<div class="tooltip-row layout-x-queue"><span class="tooltip-label">模型：</span><span class="tooltip-value">' + (tipModel || '-') + '</span><button class="tooltip-copy" data-copy="' + (rcfg.modelId || '') + '" title="复制">⧉</button></div>';
			var tooltip = createTooltip(tooltipId, tooltipHTML);
			nameSpan.on('mouseenter', function() { tooltip.show(nameSpan); });
			nameSpan.on('mouseleave', function() { tooltip.hide(); });
			nameSpan.on('click', function() {
				tooltip.hide();
				var ct = $('.node-content', nodeEl);
				if (ct) {
					if (ct.style.display === 'none') {
						ct.style.display = '';
						toggleSpan.textContent = '▼';
					} else {
						ct.style.display = 'none';
						toggleSpan.textContent = '▶';
					}
				}
			});

			var actionsEl = mk('div', 'group-actions layout-x-queue');

			// 添加子节点
			var addChildBtn = mk('button', 'action');
			addChildBtn.textContent = '+';
			addChildBtn.title = '添加子节点';
			addChildBtn.on('click', function(e) {
				e.stopPropagation();
				showEditGroupDialog(null, node.id, function(data) {
					addNode(node.id, data).then(function() { refreshUI(); });
				});
			});

			// 收集子树中所有可测试的节点
			function isNodeTestable(n) {
				var cfg = resolveNodeConfig(n.id);
				return cfg && cfg.baseUrl && cfg.key !== undefined && cfg.key !== null && cfg.modelId;
			}
			function collectTestable(nds, out) {
				nds.forEach(function(n) {
					if (isNodeTestable(n)) out.push(n.id);
					if (n.children) collectTestable(n.children, out);
				});
			}
			var testableIds = [];
			collectTestable([node], testableIds);
			var isSelfTestable = testableIds.indexOf(node.id) >= 0;
			var childTestable = testableIds.length - (isSelfTestable ? 1 : 0);

			// 子树测试状态汇总
			var hasTesting = false, allOk = true, anyFailed = false;
			testableIds.forEach(function(id) {
				var sd = connectionStatus.get(id + ':' + '__node__');
				if (sd) {
					if (sd.status === 'testing') hasTesting = true;
					if (sd.status === 'connected') {} // ok
					else if (sd.status === 'testing') {}
					else { allOk = false; if (sd.status !== 'disconnected') anyFailed = true; }
				} else { allOk = false; }
			});
			// 只有全部已有测试记录且全部成功才显示绿色
			var batchStatus = '';
			if (testableIds.length > 0) {
				var allTested = testableIds.every(function(id) {
					var sd = connectionStatus.get(id + ':' + '__node__');
					return sd && sd.status !== 'disconnected' && sd.status !== undefined;
				});
				if (allTested && allOk) batchStatus = 'connected';
				else if (anyFailed || (allTested && !allOk)) batchStatus = 'failed';
			}
			var batchTestBtn = null;
			if (testableIds.length > 0) {
				batchTestBtn = mk('button');
				batchTestBtn.className = "action batch-test" + (batchStatus ? ' ' + batchStatus : '');
				batchTestBtn.innerHTML = '<span>🔗</span>';
				if (hasTesting) {
					batchTestBtn.classList.add("testing");
					$("span", batchTestBtn).classList.add("spin");
				}
				if (!hasTesting) {
					// 收集测试状态信息用于title
					var successCount = 0, failCount = 0, firstError = null;
					testableIds.forEach(function(id) {
						var sd = connectionStatus.get(id + ':__node__');
						if (sd) {
							if (sd.status === 'connected') successCount++;
							else if (sd.status === 'failed' || sd.status === 'cors_blocked') {
								failCount++;
								if (!firstError && sd.error) firstError = sd.error;
							}
						}
					});
					var testSummary = '';
					if (failCount > 0) {
						testSummary = '✗ ' + failCount + '个失败';
						if (firstError) testSummary += '：' + firstError;
					} else if (successCount > 0 && successCount === testableIds.length) {
						testSummary = '✓ 全部成功';
					}

					if (childTestable > 0) {
						batchTestBtn.title = '测试连接（含' + (testableIds.length) + '个端点）' + (testSummary ? ' — ' + testSummary : '');
					} else {
						// 只有自己一个端点，直接用 getConnectionStatusText 显示详情
						batchTestBtn.title = getConnectionStatusText(node.id + ':__node__');
					}
				} else {
					batchTestBtn.title = '测试中...';
				}
				batchTestBtn.on('click', function(e) {
					e.stopPropagation();
					if (onTestConnection) {
						testableIds.forEach(function(id) {
							onTestConnection(id, '__node__');
						});
					}
				});
			}

			// 加入/移除会话按钮（四要素齐全的节点可切换）
			var joinBtn = null;
			if (isSelfTestable) {
				function refreshJoinBtn() {
					var mid = node.id + ':__node__';
					if (selectedModels.includes(mid)) {
						joinBtn.title = '已加入当前会话';
						joinBtn.className = 'action join-session joined';
					} else {
						joinBtn.title = '加入当前会话';
						joinBtn.className = 'action join-session';
					}
				}
				joinBtn = mk('button', 'action');
				joinBtn.innerHTML = SVG.bubble(12);
				refreshJoinBtn();
				joinBtn.on('click', function(e) {
					e.stopPropagation();
					var mid = node.id + ':__node__';
					if (selectedModels.includes(mid)) {
						selectedModels = selectedModels.filter(function(x) { return x !== mid; });
					} else {
						selectedModels.push(mid);
					}
					saveDefaultSelectedModels(selectedModels);
					renderModelSelector(getGroups(), selectedModels, false);
					refreshJoinBtn();
				});
			}

			var editBtn = mk('button', 'action');
			editBtn.innerHTML = SVG.edit(12);
			editBtn.title = '编辑节点';
			editBtn.on('click', function(e) {
				e.stopPropagation();
				onNodeEdit(node.id);
			});
			var deleteBtn = mk('button', 'action danger');
			deleteBtn.innerHTML = SVG.del(12);
			deleteBtn.title = '删除节点及其子节点';
			deleteBtn.on('click', function(e) {
				e.stopPropagation();
				confirmAction('确定删除节点「' + node.name + '」及其所有子节点和模型？', function() { onNodeDelete(node.id); });
			});

			actionsEl.addChild(addChildBtn);
			if (batchTestBtn) actionsEl.addChild(batchTestBtn);
			if (joinBtn) actionsEl.addChild(joinBtn);
			actionsEl.addChild(editBtn);
			actionsEl.addChild(deleteBtn);

			headerEl.addChild(dragHandle);
			headerEl.addChild(toggleSpan);
			headerEl.addChild(nameSpan);
			headerEl.addChild(actionsEl);
			nodeEl.addChild(headerEl);

			// 拖放事件 — 用 e.stopPropagation() 防止子节点事件冒泡到父节点
			nodeEl.on('dragover', function(e) {
				e.preventDefault();
				e.stopPropagation();
				e.dataTransfer.dropEffect = 'move';
				var draggingEl = $('.dragging', container);
				if (!draggingEl || draggingEl === nodeEl || draggingEl.dataset.modelId) return;
				var header = $('.group-header', nodeEl);
				var headerRect = header.getBoundingClientRect();
				nodeEl.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
				// 鼠标在 header 区域内：上半→插入前面，下半→作为子级
				if (e.clientY >= headerRect.top && e.clientY <= headerRect.bottom) {
					if (e.clientY < headerRect.top + headerRect.height / 2) {
						nodeEl.classList.add('drag-over-before');
					} else {
						nodeEl.classList.add('drag-over-child');
					}
				} else {
					// 鼠标在内容区域（子节点已通过 stopPropagation 拦截），统一视为「作为子级」
					nodeEl.classList.add('drag-over-child');
				}
			});
			nodeEl.on('dragleave', function() {
				nodeEl.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
			});
			nodeEl.on('drop', function(e) {
				e.preventDefault();
				e.stopPropagation();
				var willMoveAsChild = nodeEl.classList.contains('drag-over-child');
				nodeEl.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-child');
				var draggedId = e.dataTransfer.getData('text/plain');
				if (!draggedId || draggedId === node.id) return;
				if (willMoveAsChild) {
					if (onMoveNode) onMoveNode(draggedId, node.id);
				} else {
					if (onReorderNodes) onReorderNodes(draggedId, node.id, true);
				}
			});

			var contentEl = mk('div', 'node-content layout-y-queue');
			if (isCollapsed) {
				contentEl.style.display = 'none';
			}

			// 模型列表
			var models = mk('div', 'group-models layout-y-queue');
			models.style.paddingLeft = (depth * 12 + 8) + 'px';
			node.models.forEach(function(model) {
				var modelEl = mk('div', 'model item layout-x-queue');
				modelEl.dataset.modelId = model.id;
				modelEl.dataset.nodeId = node.id;
				if (model.id === selectedModelId) {
					modelEl.classList.add('selected');
				}
				var modelDragHandle = mk('span', 'drag-handle');
				modelDragHandle.innerHTML = SVG.drag(14);
				modelDragHandle.title = '拖动排序';
				modelDragHandle.draggable = true;
				modelDragHandle.on('dragstart', function(e) {
					e.dataTransfer.setData('text/plain', node.id + ':' + model.id);
					e.dataTransfer.effectAllowed = 'move';
					modelEl.classList.add('dragging');
				});
				modelDragHandle.on('dragend', function() {
					modelEl.classList.remove('dragging');
					$$('.model.item', models).forEach(function(el) { el.classList.remove('drag-over'); });
				});
				var modelName = mk('span', 'model name');
				modelName.innerHTML = model.remark ? model.name + '<span class="model-remark"> ' + model.remark + '</span>' : model.name;
				var modelTooltipId = 'tooltip-model-' + node.id + '-' + model.id;
				var tooltipRows =
					'<div class="tooltip-row layout-x-queue">' +
					'<span class="tooltip-label">模型：</span>' +
					'<span class="tooltip-value">' + model.name + '</span>' +
					'<button class="tooltip-copy" data-copy="' + model.name + '" title="复制">⧉</button></div>' +
					(model.remark ?
					'<div class="tooltip-row layout-x-queue">' +
					'<span class="tooltip-label">备注：</span>' +
					'<span class="tooltip-value">' + model.remark + '</span>' +
					'<button class="tooltip-copy" data-copy="' + model.remark + '" title="复制">⧉</button></div>' : '');
				var modelTooltip = createTooltip(modelTooltipId, tooltipRows);
				modelName.on('mouseenter', function() { modelTooltip.show(modelName); });
				modelName.on('mouseleave', function() { modelTooltip.hide(); });
				modelName.on('click', function() {
					modelTooltip.hide();
					if (onModelSelect) onModelSelect(node.id, model.id);
				});

				var modelActions = mk('div', 'model actions layout-x-queue');
				var statusKey = node.id + ':' + model.id;
				var statusData = connectionStatus.get(statusKey) || { status: 'disconnected' };
				var testBtn = mk('button');
				testBtn.className = 'action-sm connection ' + statusData.status;
				testBtn.title = getConnectionStatusText(statusKey);
				testBtn.innerHTML = '<span>🔗</span>';
				if (statusData.status === "testing") {
					$("span", testBtn).classList.add("spin");
				}
				testBtn.on('click', function(e) {
					e.stopPropagation();
					if (onTestConnection) onTestConnection(node.id, model.id);
				});
				var modelEditBtn = mk('button', 'action-sm');
				modelEditBtn.innerHTML = SVG.edit(10);
				modelEditBtn.title = '编辑模型';
				modelEditBtn.on('click', function(e) {
					e.stopPropagation();
					modelTooltip.hide();
					var existEdit = $('.add-model-inline', modelEl);
					if (existEdit) existEdit.remove();
					var inlineEdit = fromTemplate('tpl-add-model-inline', '.add-model-inline');
					var inputEl = $('.add-model-input', inlineEdit);
					inputEl.value = model.name;
					inputEl.placeholder = '模型名';
					var remarkEl = $('.add-model-remark-input', inlineEdit);
					if (remarkEl) {
						remarkEl.value = model.remark || '';
						remarkEl.placeholder = '备注（仅用于显示）';
					}
					modelDragHandle.style.display = 'none';
					modelName.style.display = 'none';
					modelActions.style.display = 'none';
					modelEl.insertBefore(inlineEdit, modelActions);
					inputEl.focus();
					inputEl.select();
					$('.add-model-confirm', inlineEdit).on('click', function(e2) {
						e2.stopPropagation();
						var newName = inputEl.value.trim();
						var newRemark = remarkEl ? remarkEl.value.trim() : '';
						if (newName) {
							inlineEdit.remove();
							modelDragHandle.style.display = '';
							modelName.style.display = '';
							modelActions.style.display = '';
							onModelEdit(node.id, model.id, newName, newRemark);
						}
					});
					$('.add-model-cancel', inlineEdit).on('click', function(e2) {
						e2.stopPropagation();
						inlineEdit.remove();
						modelDragHandle.style.display = '';
						modelName.style.display = '';
						modelActions.style.display = '';
					});
					var onInlineKeydown = function(e2) {
						if (e2.key === 'Enter') { e2.preventDefault(); $('.add-model-confirm', inlineEdit).click(); }
						else if (e2.key === 'Escape') { inlineEdit.remove(); modelDragHandle.style.display = ''; modelName.style.display = ''; modelActions.style.display = ''; }
					};
					inputEl.on('keydown', onInlineKeydown);
					if (remarkEl) remarkEl.on('keydown', onInlineKeydown);
				});
				var modelDeleteBtn = mk('button', 'action-sm danger');
				modelDeleteBtn.innerHTML = SVG.del(10);
				modelDeleteBtn.title = '删除模型';
				modelDeleteBtn.on('click', function(e) {
					e.stopPropagation();
					confirmAction('确定删除该模型？', function() { onModelDelete(node.id, model.id); });
				});
				modelActions.addChild(testBtn);
				modelActions.addChild(modelEditBtn);
				modelActions.addChild(modelDeleteBtn);
				modelEl.addChild(modelDragHandle);
				modelEl.addChild(modelName);
				modelEl.addChild(modelActions);
				modelEl.on('dragover', function(e) {
					e.preventDefault();
					e.dataTransfer.dropEffect = 'move';
					var draggingEl = $('.dragging', models);
					if (draggingEl && draggingEl !== modelEl) {
						modelEl.classList.add('drag-over');
					}
				});
				modelEl.on('dragleave', function() { modelEl.classList.remove('drag-over'); });
				modelEl.on('drop', function(e) {
					e.preventDefault();
					e.stopPropagation();
					modelEl.classList.remove('drag-over');
					var data = e.dataTransfer.getData('text/plain');
					var parts = data.split(':');
					var draggedNodeId = parts[0], draggedModelId = parts[1];
					if (draggedNodeId === node.id && draggedModelId !== model.id && onReorderModels) {
						var rect = modelEl.getBoundingClientRect();
						onReorderModels(node.id, draggedModelId, model.id, e.clientY < (rect.top + rect.height / 2));
					}
				});
				models.addChild(modelEl);
			});

			var addModelBtn = mk('div', 'add-model-link');
			addModelBtn.textContent = '+ 添加模型';
			addModelBtn.on('click', function(e) {
				e.stopPropagation();
				var existInput = $('.add-model-inline', models);
				if (existInput) existInput.remove();
				var inlineInput = fromTemplate('tpl-add-model-inline', '.add-model-inline');
				models.insertBefore(inlineInput, addModelBtn);
				var inputEl = $('.add-model-input', inlineInput);
				var remarkEl = $('.add-model-remark-input', inlineInput);
				inputEl.focus();
				$('.add-model-confirm', inlineInput).on('click', function(e2) {
					e2.stopPropagation();
					var name = inputEl.value.trim();
					var remark = remarkEl ? remarkEl.value.trim() : '';
					if (name) {
						inlineInput.remove();
						onAddModel(node.id, name, remark);
					}
				});
				$('.add-model-cancel', inlineInput).on('click', function(e2) {
					e2.stopPropagation();
					inlineInput.remove();
				});
				inputEl.on('keydown', function(e2) {
					if (e2.key === 'Enter') { e2.preventDefault(); $('.add-model-confirm', inlineInput).click(); }
					else if (e2.key === 'Escape') { inlineInput.remove(); }
				});
				if (remarkEl) remarkEl.on('keydown', function(e2) {
					if (e2.key === 'Enter') { e2.preventDefault(); $('.add-model-confirm', inlineInput).click(); }
					else if (e2.key === 'Escape') { inlineInput.remove(); }
				});
			});
			models.addChild(addModelBtn);
			if (hasModels) contentEl.addChild(models);

			if (hasChildren) {
				var childrenWrapper = mk('div', 'node-children');
				renderTreeNode(node.children, childrenWrapper, depth + 1);
				contentEl.addChild(childrenWrapper);
			}

			nodeEl.addChild(contentEl);
			parentEl.addChild(nodeEl);
		});
	}

	renderTreeNode(nodes, container, 0);
	// 更新「测试全部」按钮状态
	var testAllBtn = $('#btn-test-all');
	if (testAllBtn && typeof getGroups === 'function') {
		var testableIds = [];
		function collectTestable(ns) {
			ns.forEach(function(n) {
				var rcfg = resolveNodeConfig(n.id);
				if (rcfg && rcfg.baseUrl) testableIds.push(n.id);
				if (n.children) collectTestable(n.children);
			});
		}
		collectTestable(getGroups());
		var hasTesting = false, hasFail = false, hasSuccess = false;
		testableIds.forEach(function(id) {
			var sd = connectionStatus.get(id + ':__node__');
			if (sd) {
				if (sd.status === 'testing') hasTesting = true;
				else if (sd.status === 'connected') hasSuccess = true;
				else if (sd.status === 'failed' || sd.status === 'cors_blocked') hasFail = true;
			}
		});
		testAllBtn.className = 'action batch-test btn-icon';
		var spanEl = $('span', testAllBtn);
		if (hasTesting) {
			testAllBtn.classList.add('testing');
			if (spanEl) spanEl.classList.add('spin');
		} else {
			if (spanEl) spanEl.classList.remove('spin');
			if (hasFail && !hasSuccess) testAllBtn.classList.add('failed');
			else if (hasSuccess && !hasFail) testAllBtn.classList.add('connected');
		}
	}
}


function renderSessionList(sessions, selectedSessionId, onSessionSelect, onSessionEdit, onSessionDelete) {
	const container = $('#session-list');
	container.innerHTML = '';
	sessions.sort((a, b) => b.createdAt - a.createdAt);
	sessions.forEach(session => {
		const sessionEl = mk('article', 'session item');
		if (session.id === selectedSessionId) {
			sessionEl.classList.add('selected');
		}
		const titleEl = mk('div', 'session title');
		titleEl.textContent = session.title || '新会话';
		const meta = mk('div', 'session meta layout-x-queue');
		const timeEl = mk('span', 'session time');
		timeEl.textContent = new Date(session.createdAt).toLocaleDateString('zh-CN', {
			month: 'short',
			day: 'numeric'
		});
		const actionsEl = mk('div', 'session actions layout-x-queue');
		const editBtn = mk('button', 'action-sm');
		editBtn.innerHTML = SVG.edit(10);
		editBtn.title = '编辑标题';
		editBtn.on('click', e => {
			e.stopPropagation();
			const currentTitle = session.title || '新会话';
			const inputEl = mk('input', 'session title-edit');
			inputEl.type = 'text';
			inputEl.value = currentTitle;
			titleEl.style.display = 'none';
			sessionEl.insertBefore(inputEl, meta);
			inputEl.focus();
			inputEl.select();
			const finishEdit = () => {
				const newTitle = inputEl.value.trim();
				inputEl.remove();
				titleEl.style.display = '';
				if (newTitle && newTitle !== currentTitle) {
					onSessionEdit(session.id, newTitle);
				}
			};
			inputEl.on('blur', finishEdit);
			inputEl.on('keydown', e2 => {
				if (e2.key === 'Enter') {
					e2.preventDefault();
					inputEl.blur();
				} else if (e2.key === 'Escape') {
					inputEl.value = currentTitle;
					inputEl.blur();
				}
			});
		});
		const deleteBtn = mk('button', 'action-sm danger');
		deleteBtn.innerHTML = SVG.del(10);
		deleteBtn.title = '删除会话';
		deleteBtn.on('click', e => {
			e.stopPropagation();
			confirmAction('确定删除该会话？', () => onSessionDelete(session.id));
		});
		actionsEl.addChild(editBtn);
		actionsEl.addChild(deleteBtn);
		meta.addChild(timeEl);
		meta.addChild(actionsEl);
		sessionEl.addChild(titleEl);
		sessionEl.addChild(meta);
		sessionEl.on('click', () => onSessionSelect(session.id));
		container.addChild(sessionEl);
	});
}

function renderMarkdown(text) {
	if (!text) return '';
	marked.setOptions({
		breaks: true,
		gfm: true
	});
	return marked.parse(text);
}

function addCodeCopyButtons(container) {
	container.querySelectorAll('pre code').forEach(codeEl => {
		const preEl = codeEl.parentElement;
		const copyBtn = document.createElement('button');
		copyBtn.className = 'code-copy-btn';
		copyBtn.innerHTML = "<span class=\"copy-icon\">⧉</span><span class=\"copy-check\">✓</span>";
		copyBtn.title = '复制代码';
		copyBtn.onclick = () => {
			navigator.clipboard.writeText(codeEl.textContent).then(() => {
				copyBtn.classList.add("copied");
				clearTimeout(copyBtn._copiedTimer);
				copyBtn._copiedTimer = setTimeout(() => copyBtn.classList.remove("copied"), 1500);
			});
		};
		preEl.appendChild(copyBtn);
		hljs.highlightElement(codeEl);
	});
}

function renderMessages(messages, groups, onCopy) {
	const container = $('#chat-messages');
	container.innerHTML = '';
	messages.forEach((msg, index) => {
		const roleClass = msg.role === 'user' ? 'req' : 'res';
		const msgEl = mk('article', `message layout-y-queue ${roleClass} msg`);
		if (msg.role === 'user') {
			// 使用模板创建meta，包含复制按钮
			const meta = fromTemplate('tpl-user-meta', '.request.meta');
			const timeStr = msg.timestamp ? formatDateTime(msg.timestamp) : '';
			$('.request.time', meta).textContent = timeStr;
			msgEl.addChild(meta);
			const normalized = normalizeMessageContent(msg);
			const textItems = normalized.filter(c => c.type === 'text' || c.type === 'file_text');
			const textContent = textItems.map(c => c.text || '').join('\n');
			const copyBtn = $('.copy-btn', meta);
			copyBtn.onclick = () => {
				navigator.clipboard.writeText(textContent).then(() => {
					copyBtn.classList.add("copied");
					clearTimeout(copyBtn._copiedTimer);
					copyBtn._copiedTimer = setTimeout(() => copyBtn.classList.remove("copied"), 1500);
				});
			};
			if (textContent) {
				const userEl = mk('div', 'message-user');
				userEl.textContent = textContent;
				msgEl.addChild(userEl);
			}
			const attachmentItems = normalized.filter(c => c.type === 'image' || c.type === 'file');
			if (attachmentItems.length > 0) {
				const attContainer = mk('div', 'message-attachments layout-x-queue');
				attachmentItems.forEach(att => {
					const attEl = mk('div', `message-attachment layout-x-queue ${att.type}`);
					if (att.type === 'image' && att.source) {
						let imgSrc;
						if (att.source.type === 'url') {
							imgSrc = att.source.url;
						} else {
							imgSrc = `data:${att.source.media_type};base64,${att.source.data}`;
						}
						const thumb = mk('img', 'message-attachment-thumb');
						thumb.src = imgSrc;
						thumb.onclick = () => {
							const overlay = mk('div', 'image-preview-overlay layout-x-queue');
							const fullImg = mk('img');
							fullImg.src = imgSrc;
							overlay.onclick = () => overlay.remove();
							overlay.addChild(fullImg);
							doc.body.addChild(overlay);
						};
						attEl.addChild(thumb);
						const nameEl = mk('span', 'message-attachment-name');
						nameEl.textContent = att.name || '图片';
						attEl.addChild(nameEl);
					} else if (att.type === 'file' && att.source) {
						const fileIcon = mk('span');
						fileIcon.textContent = '📄';
						attEl.addChild(fileIcon);
						const nameEl = mk('span', 'message-attachment-name');
						nameEl.textContent = att.name || '文件';
						attEl.addChild(nameEl);
						attEl.onclick = () => {
							const data = att.source.data;
							const mime = att.source.media_type;
							const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], {
								type: mime
							});
							const link = mk('a');
							link.href = URL.createObjectURL(blob);
							link.download = att.name || 'file';
							link.click();
							URL.revokeObjectURL(link.href);
						};
					}
					attContainer.addChild(attEl);
				});
				msgEl.addChild(attContainer);
			}
		} else {
			if (msg.responses && Array.isArray(msg.responses)) {
				renderMultiModelResponse(msgEl, msg, groups, onCopy);
			} else {
				renderSingleModelResponse(msgEl, msg, groups, onCopy);
			}
		}
		container.addChild(msgEl);
	});
	container.scrollTop = container.scrollHeight;
}

function renderSingleModelResponse(msgEl, msg, groups, onCopy) {
	const timeStr = msg.timestamp ? formatDateTime(msg.timestamp) : '';
	const info = msg.endpointGroupId && msg.modelId ? findModelById(groups, `${msg.endpointGroupId}:${msg.modelId}`) : null;
	const modelName = info ? `${info.node.name} / ${info.model.name}` : '未知模型';
	const modelRemark = info?.model?.remark || '';
	const meta = fromTemplate('tpl-response-meta', '.response.meta');
	$('.response.model-name', meta).innerHTML = modelRemark ? `${modelName}<span class="model-remark"> ${modelRemark}</span>` : modelName;
	$('.response.time', meta).textContent = timeStr;
	const copyBtn = $('.copy-btn', meta);
	copyBtn.onclick = () => {
		navigator.clipboard.writeText(msg.content || "").then(() => {
			copyBtn.classList.add("copied");
			clearTimeout(copyBtn._copiedTimer);
			copyBtn._copiedTimer = setTimeout(() => copyBtn.classList.remove("copied"), 1500);
		});
	};
	msgEl.addChild(meta);
	const assistantEl = mk('div', 'message-assistant');
	assistantEl.innerHTML = renderMarkdown(msg.content || '');
	msgEl.addChild(assistantEl);
	addCodeCopyButtons(assistantEl);
	if (msg.usage) {
		const statusBar = mk('div', 'message-status-bar layout-x-queue');
		const usageEl = mk('span', 'message-usage');
		usageEl.textContent = `${msg.usage.input || 0} → ${msg.usage.output || 0} tokens`;
		statusBar.addChild(usageEl);
		msgEl.addChild(statusBar);
	}
}

function renderMultiModelResponse(msgEl, msg, groups, onCopy) {
	const sorted = [...msg.responses].sort((a, b) => (a.firstTokenTime ?? Infinity) - (b.firstTokenTime ?? Infinity));
	const hint = mk('div', 'multi-response-hint');
	hint.textContent = `${sorted.length}个模型回复`;
	msgEl.addChild(hint);
	const cards = mk('div', 'multi-response-cards layout-y-queue');
	sorted.forEach(r => {
		const card = mk('div', 'response card');
		const info = findModelById(groups, r.modelId);
		const name = info ? `${info.node.name} / ${info.model.name}` : '未知';
		const remark = info?.model?.remark || '';
		const meta = fromTemplate('tpl-multi-response-meta', '.response.meta');
		const durationStr = r.firstTokenTime ? `反应${(r.firstTokenTime/1000).toFixed(1)}s` : '';
		const totalStr = r.totalDuration ? `耗时${(r.totalDuration/1000).toFixed(1)}s` : '';
		const statusText = getStatusText(r.status);
		const responseTimeStr = r.timestamp ? formatDateTime(r.timestamp) : '';
		const errorText = r.status === 'failed' ? (r.error || '未知错误') : '';
		const speedClass = getSpeedClass(r.firstTokenTime);
		$('.response.model-name', meta).innerHTML = remark ? `${name}<span class="model-remark"> ${remark}</span>` : name;
		$('.response.time', meta).textContent = responseTimeStr;
		const durationEl = $('.response.duration', meta);
		durationEl.textContent = durationStr;
		if (speedClass) durationEl.classList.add(speedClass);
		$('.response.total', meta).textContent = totalStr;
		const statusEl = $('.response.status', meta);
		statusEl.textContent = statusText;
		statusEl.classList.add('status');
		statusEl.classList.add(r.status);
		const errorEl = $('.response.error', meta);
		if (errorText) {
			errorEl.textContent = errorText;
		} else {
			errorEl.remove();
		}
		const copyBtn = $('.copy-btn', meta);
		if (r.status === 'completed' && r.content) {
			copyBtn.onclick = () => {
				navigator.clipboard.writeText(r.content || "").then(() => {
					copyBtn.classList.add("copied");
					clearTimeout(copyBtn._copiedTimer);
					copyBtn._copiedTimer = setTimeout(() => copyBtn.classList.remove("copied"), 1500);
				});
			};
		} else {
			copyBtn.remove();
		}
		card.addChild(meta);
		if (r.embeddingResult) {
			const embedDiv = mk('div', 'embedding-result');
			embedDiv.innerHTML = '<div class="embedding-header">🔢 嵌入向量</div><div class="embedding-meta"><span>模型: ' + r.embeddingResult.model + '</span><span>维度: ' + r.embeddingResult.dim + '</span>' + (r.embeddingResult.usage ? '<span>Token: ' + r.embeddingResult.usage.total_tokens + '</span>' : '') + '</div><div class="embedding-preview">' + r.embeddingResult.preview + '</div><button class="embedding-copy-btn" data-full="' + r.embeddingResult.fullJson.replace(/'/g, '\\\'') + '">📋 复制完整向量</button>';
			const copyBtn = embedDiv.querySelector('.embedding-copy-btn');
			copyBtn.onclick = () => {
				navigator.clipboard.writeText(copyBtn.dataset.full);
				copyBtn.textContent = '✓ 已复制';
				setTimeout(() => { copyBtn.textContent = '📋 复制完整向量'; }, 2000);
			};
			card.addChild(embedDiv);
			cards.addChild(card);
			return;
		}
		if (r.thinking && r.thinking.trim()) {
			const thinkingBlock = mk('div', 'thinking-block collapsed');
			const thinkingHeader = fromTemplate('tpl-thinking-header', '.thinking-header');
			thinkingHeader.onclick = function() {
				toggleThinking(this);
			};
			const thinkingDurationStr = r.thinkingDuration ? `耗时 ${(r.thinkingDuration/1000).toFixed(1)}s` : '';
			$('.thinking-duration', thinkingHeader).textContent = thinkingDurationStr;
			const thinkingContent = mk('div', 'thinking-content');
			thinkingContent.textContent = r.thinking;
			thinkingBlock.addChild(thinkingHeader);
			thinkingBlock.addChild(thinkingContent);
			card.addChild(thinkingBlock);
		}
		const content = mk('div', 'response card-content');
		if (r.status === 'failed') {
			content.innerHTML = ''; // Error shown in meta row, content area empty
		} else {
			content.innerHTML = renderMarkdown(r.content || '');
			addCodeCopyButtons(content);
		}
		card.addChild(content);
		cards.addChild(card);
	});
	msgEl.addChild(cards);
}

function getStatusText(status) {
	return {
		completed: '✓',
		failed: '✗',
		stopped: '■'
	} [status] || status;
}

function getSpeedClass(firstTokenTime) {
	if (firstTokenTime == null) return '';
	if (firstTokenTime < 1000) return 'fast';
	if (firstTokenTime < 2000) return 'medium';
	return 'slow';
}

function formatDateTime(timestamp) {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hour = String(date.getHours()).padStart(2, '0');
	const minute = String(date.getMinutes()).padStart(2, '0');
	const second = String(date.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function updateChatTitle(title) {
	const el = $('#chat-title');
	el.textContent = title || '新会话';
}

function getInputContent() {
	const input = $('#chat-input');
	return input.value.trim();
}
async function getInputMessage() {
	const input = $('#chat-input');
	const text = input.value.trim();
	const content = [];
	if (text) {
		content.push({
			type: 'text',
			text
		});
	}
	for (const att of pendingAttachments) {
		try {
			if (att.type === 'image') {
				const data = await fileToBase64(att.file);
				content.push({
					type: 'image',
					name: att.name,
					source: {
						type: 'base64',
						media_type: att.mediaType,
						data
					}
				});
			} else if (att.type === 'file_text') {
				const textContent = await fileToText(att.file);
				content.push({
					type: 'file_text',
					name: att.name,
					text: textContent
				});
			} else {
				const data = await fileToBase64(att.file);
				content.push({
					type: 'file',
					name: att.name,
					source: {
						type: 'base64',
						media_type: att.mediaType,
						data
					}
				});
			}
		} catch (e) {
			console.error(`处理附件失败: ${att.name}`, e);
			alert(`附件 "${att.name}" 处理失败，请重试`);
			return null;
		}
	}
	return content;
}

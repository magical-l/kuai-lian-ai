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
			return `<span class="${classes}" data-model="${id}"><span class="endpoint name-color">${info.group.name}</span> ${info.model.name}${remarkHtml}</span>`;
		}).join('');
		expandBtnText.textContent = selectorExpanded ? '▲ 收起' : '▼ 展开';
	}
	// 展开状态列表
	if (selectorExpanded) {
		listEl.innerHTML = groups.map(g => {
			const tags = g.models.map(m => {
				const isSelected = selectedModels.includes(`${g.id}:${m.id}`);
				const statusClass = getTagStatusClass(`${g.id}:${m.id}`);
				const cls = isSelected ? (statusClass ? `selected ${statusClass}` : 'selected') : 'unselected';
				const mRemark = m.remark ? `<span class="model-remark"> ${m.remark}</span>` : '';
				return `<span class="model tag ${cls}" data-model="${g.id}:${m.id}">${m.name}${mRemark}</span>`;
			}).join('');
			return `<div class="selector group-label">${g.name}</div><div class="selector models-row layout-x-queue">${tags}</div>`;
		}).join('');
	}
	bindSelectorEvents();
}

function findModelById(groups, modelId) {
	for (const g of groups) {
		const m = g.models.find(x => `${g.id}:${x.id}` === modelId);
		if (m) return {
			group: g,
			model: m
		};
	}
	return null;
}

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

function renderEndpointList(groups, selectedModelId, onModelSelect, onModelEdit, onGroupEdit, onGroupDelete, onAddModel, onModelDelete, onReorderGroups, onReorderModels, onTestConnection) {
	const container = $('#endpoint-list');
	// 保存当前收起状态
	$$('.endpoint-group', container).forEach(el => {
		const groupId = el.dataset.groupId;
		const models = $('.group-models', el);
		if (models && models.style.display === 'none') {
			collapsedEndpoints.add(groupId);
		} else {
			collapsedEndpoints.delete(groupId);
		}
	});
	container.innerHTML = '';
	groups.forEach((group, groupIndex) => {
		const groupEl = mk('section', 'endpoint-group');
		groupEl.dataset.groupId = group.id;
		groupEl.dataset.groupIndex = groupIndex;
		groupEl.draggable = false;
		const headerEl = mk('div', 'group-header layout-x-queue');
		// 拖动手柄
		const dragHandle = mk('span', 'drag-handle layout-x-queue');
		dragHandle.innerHTML = SVG.drag(14);
		dragHandle.title = '拖动排序';
		dragHandle.draggable = true;
		dragHandle.on('dragstart', e => {
			e.dataTransfer.setData('text/plain', group.id);
			e.dataTransfer.effectAllowed = 'move';
			groupEl.classList.add('dragging');
		});
		dragHandle.on('dragend', () => {
			groupEl.classList.remove('dragging');
			$$('.endpoint-group', container).forEach(el => el.classList.remove('drag-over'));
		});
		// 收展三角放前面
		const toggleSpan = mk('span', 'group-toggle');
		const isCollapsed = collapsedEndpoints.has(group.id);
		toggleSpan.textContent = isCollapsed ? '▶' : '▼';
		toggleSpan.on('click', e => {
			e.stopPropagation();
			const models = $('.group-models', groupEl);
			if (models.style.display === 'none') {
				models.style.display = 'block';
				toggleSpan.textContent = '▼';
			} else {
				models.style.display = 'none';
				toggleSpan.textContent = '▶';
			}
		});
		// 组名
		const nameSpan = mk('span', 'group-name');
		nameSpan.textContent = group.name;
		const tooltipId = `tooltip-${group.id}`;
		const styleLabels = {
			'openai': 'OpenAI',
			'claude': 'Claude',
			'gemini': 'Gemini'
		};
		const tooltipHTML = `
<div class="tooltip-row layout-x-queue">
<span class="tooltip-label">名称：</span>
<span class="tooltip-value">${group.name}</span>
<button class="tooltip-copy" data-copy="${group.name}" title="复制">⧉</button>
</div>
<div class="tooltip-row layout-x-queue">
<span class="tooltip-label">地址：</span>
<span class="tooltip-value">${group.baseUrl}</span>
<button class="tooltip-copy" data-copy="${group.baseUrl}" title="复制">⧉</button>
</div>
<div class="tooltip-row layout-x-queue">
<span class="tooltip-label">格式：</span>
<span class="tooltip-value">${styleLabels[group.style] || group.style}</span>
<button class="tooltip-copy" data-copy="${group.style}" title="复制">⧉</button>
</div>
`;
		const tooltip = createTooltip(tooltipId, tooltipHTML);
		nameSpan.on('mouseenter', () => tooltip.show(nameSpan));
		nameSpan.on('mouseleave', () => tooltip.hide());
		nameSpan.on('click', () => {
			tooltip.hide();
			const models = $('.group-models', groupEl);
			if (models) {
				if (models.style.display === 'none') {
					models.style.display = 'block';
					toggleSpan.textContent = '▼';
				} else {
					models.style.display = 'none';
					toggleSpan.textContent = '▶';
				}
			}
		});
		const actionsEl = mk('div', 'group-actions layout-x-queue');
		// 批量测试连接按钮
		const hasTesting = group.models.some(model => {
			const statusKey = `${group.id}:${model.id}`;
			const statusData = connectionStatus.get(statusKey);
			return statusData && statusData.status === 'testing';
		});
		const batchTestBtn = mk('button');
		batchTestBtn.className = "action batch-test";
		batchTestBtn.innerHTML = '<span>🔗</span>';
		if (hasTesting) {
			batchTestBtn.classList.add("testing");
			$("span", batchTestBtn).classList.add("spin");
		}
		batchTestBtn.title = hasTesting ? "测试中..." : "批量测试连接";
		batchTestBtn.on('click', e => {
			e.stopPropagation();
			if (onTestConnection) {
				// 测试该端点下所有模型
				group.models.forEach(model => {
					onTestConnection(group.id, model.id);
				});
			}
		});
		const editBtn = mk('button', 'action');
		editBtn.innerHTML = SVG.edit(12);
		editBtn.title = '编辑端点';
		editBtn.on('click', e => {
			e.stopPropagation();
			onGroupEdit(group.id);
		});
		const deleteBtn = mk('button', 'action danger');
		deleteBtn.innerHTML = SVG.del(12);
		deleteBtn.title = '删除端点';
		deleteBtn.on('click', e => {
			e.stopPropagation();
			confirmAction('确定删除该端点及其所有模型？', () => onGroupDelete(group.id));
		});
		actionsEl.addChild(batchTestBtn);
		actionsEl.addChild(editBtn);
		actionsEl.addChild(deleteBtn);
		headerEl.addChild(dragHandle);
		headerEl.addChild(toggleSpan);
		headerEl.addChild(nameSpan);
		headerEl.addChild(actionsEl);
		groupEl.on('dragover', e => {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			const draggingEl = $('.dragging', container);
			if (draggingEl && draggingEl !== groupEl) {
				groupEl.classList.add('drag-over');
			}
		});
		groupEl.on('dragleave', () => groupEl.classList.remove('drag-over'));
		groupEl.on('drop', e => {
			e.preventDefault();
			groupEl.classList.remove('drag-over');
			const draggedGroupId = e.dataTransfer.getData('text/plain');
			if (draggedGroupId !== group.id) {
				const rect = groupEl.getBoundingClientRect();
				const midY = rect.top + rect.height / 2;
				const insertBefore = e.clientY < midY;
				onReorderGroups(draggedGroupId, group.id, insertBefore);
			}
		});
		const models = mk('div', 'group-models layout-y-queue');
		if (isCollapsed) {
			models.style.display = 'none';
		}
		group.models.forEach((model, modelIndex) => {
			const modelEl = mk('div', 'model item layout-x-queue');
			modelEl.dataset.modelId = model.id;
			modelEl.dataset.groupId = group.id;
			if (model.id === selectedModelId) {
				modelEl.classList.add('selected');
			}
			const modelDragHandle = mk('span', 'drag-handle');
			modelDragHandle.innerHTML = SVG.drag(14);
			modelDragHandle.title = '拖动排序';
			modelDragHandle.draggable = true;
			modelDragHandle.on('dragstart', e => {
				e.dataTransfer.setData('text/plain', `${group.id}:${model.id}`);
				e.dataTransfer.effectAllowed = 'move';
				modelEl.classList.add('dragging');
			});
			modelDragHandle.on('dragend', () => {
				modelEl.classList.remove('dragging');
				$$('.model.item', models).forEach(el => el.classList.remove('drag-over'));
			});
			const modelName = mk('span', 'model name');
			modelName.innerHTML = model.remark ? `${model.name}<span class="model-remark"> ${model.remark}</span>` : model.name;
			const modelTooltipId = `tooltip-model-${group.id}-${model.id}`;
			const tooltipRows = `
	<div class="tooltip-row layout-x-queue">
		<span class="tooltip-label">模型：</span>
		<span class="tooltip-value">${model.name}</span>
		<button class="tooltip-copy" data-copy="${model.name}" title="复制">⧉</button>
	</div>` + (model.remark ? `
	<div class="tooltip-row layout-x-queue">
		<span class="tooltip-label">备注：</span>
		<span class="tooltip-value">${model.remark}</span>
		<button class="tooltip-copy" data-copy="${model.remark}" title="复制">⧉</button>
	</div>` : "");
			const modelTooltipHTML = tooltipRows;
			const modelTooltip = createTooltip(modelTooltipId, modelTooltipHTML);
			modelName.on('mouseenter', () => modelTooltip.show(modelName));
			modelName.on('mouseleave', () => modelTooltip.hide());
			modelName.on('click', () => {
				modelTooltip.hide();
				if (onModelSelect) onModelSelect(group.id, model.id);
			});
			const modelActions = mk('div', 'model actions layout-x-queue');
			const statusKey = `${group.id}:${model.id}`;
			const statusData = connectionStatus.get(statusKey) || {
				status: 'disconnected'
			};
			const status = statusData.status;
			const testBtn = mk('button');
			testBtn.className = 'action-sm connection ' + status;
			testBtn.title = getConnectionStatusText(statusKey);
			testBtn.innerHTML = '<span>🔗</span>';
			if (status === "testing") {
				$("span", testBtn).classList.add("spin");
			}
			testBtn.on('click', e => {
				e.stopPropagation();
				if (onTestConnection) onTestConnection(group.id, model.id);
			});
			const modelEditBtn = mk('button', 'action-sm');
			modelEditBtn.innerHTML = SVG.edit(10);
			modelEditBtn.title = '编辑模型';
			modelEditBtn.on('click', e => {
				e.stopPropagation();
				modelTooltip.hide();
				// 原地编辑：将模型名替换为输入框
				const existEdit = $('.add-model-inline', modelEl);
				if (existEdit) existEdit.remove();
				const inlineEdit = fromTemplate('tpl-add-model-inline', '.add-model-inline');
				const inputEl = $('.add-model-input', inlineEdit);
				inputEl.value = model.name;
				inputEl.placeholder = '模型名';
				const remarkEl = $('.add-model-remark-input', inlineEdit);
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
				$('.add-model-confirm', inlineEdit).on('click', async e2 => {
					e2.stopPropagation();
					const newName = inputEl.value.trim();
					const newRemark = remarkEl ? remarkEl.value.trim() : '';
					if (newName) {
						inlineEdit.remove();
						modelDragHandle.style.display = '';
						modelName.style.display = '';
						modelActions.style.display = '';
						onModelEdit(group.id, model.id, newName, newRemark);
					} else {
						inlineEdit.remove();
						modelDragHandle.style.display = '';
						modelName.style.display = '';
						modelActions.style.display = '';
					}
				});
				$('.add-model-cancel', inlineEdit).on('click', e2 => {
					e2.stopPropagation();
					inlineEdit.remove();
					modelDragHandle.style.display = '';
					modelName.style.display = '';
					modelActions.style.display = '';
				});
				const onInlineKeydown = e2 => {
					if (e2.key === 'Enter') {
						e2.preventDefault();
						$('.add-model-confirm', inlineEdit).click();
					} else if (e2.key === 'Escape') {
						inlineEdit.remove();
						modelDragHandle.style.display = '';
						modelName.style.display = '';
						modelActions.style.display = '';
					}
				};
				inputEl.on('keydown', onInlineKeydown);
				if (remarkEl) remarkEl.on('keydown', onInlineKeydown);
			});
			const modelDeleteBtn = mk('button', 'action-sm danger');
			modelDeleteBtn.innerHTML = SVG.del(10);
			modelDeleteBtn.title = '删除模型';
			modelDeleteBtn.on('click', e => {
				e.stopPropagation();
				confirmAction('确定删除该模型？', () => onModelDelete(group.id, model.id));
			});
			modelActions.addChild(testBtn);
			modelActions.addChild(modelEditBtn);
			modelActions.addChild(modelDeleteBtn);
			modelEl.addChild(modelDragHandle);
			modelEl.addChild(modelName);
			modelEl.addChild(modelActions);
			modelEl.on('dragover', e => {
				e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
				const draggingEl = $('.dragging', models);
				if (draggingEl && draggingEl !== modelEl) {
					modelEl.classList.add('drag-over');
				}
			});
			modelEl.on('dragleave', () => modelEl.classList.remove('drag-over'));
			modelEl.on('drop', e => {
				e.preventDefault();
				e.stopPropagation();
				modelEl.classList.remove('drag-over');
				const data = e.dataTransfer.getData('text/plain');
				const [draggedGroupId, draggedModelId] = data.split(':');
				if (draggedGroupId === group.id && draggedModelId !== model.id && onReorderModels) {
					const rect = modelEl.getBoundingClientRect();
					const midY = rect.top + rect.height / 2;
					const insertBefore = e.clientY < midY;
					onReorderModels(group.id, draggedModelId, model.id, insertBefore);
				}
			});
			models.addChild(modelEl);
		});
		// 安全移除内联编辑框，若其父元素是模型项则恢复隐藏的元素
		function removeInlineEdit(el) {
			const parent = el.parentElement;
			if (parent && parent.classList.contains('model')) {
				const dh = parent.querySelector('.drag-handle');
				const mn = parent.querySelector('.model.name');
				const ma = parent.querySelector('.model.actions');
				if (dh) dh.style.display = '';
				if (mn) mn.style.display = '';
				if (ma) ma.style.display = '';
			}
			el.remove();
		}
		const addModelBtn = mk('div', 'add-model-link');
		addModelBtn.textContent = '+ 添加模型';
		addModelBtn.on('click', e => {
			e.stopPropagation();
			const existInput = $('.add-model-inline', models);
			if (existInput) removeInlineEdit(existInput);
			const inlineInput = fromTemplate('tpl-add-model-inline', '.add-model-inline');
			models.insertBefore(inlineInput, addModelBtn);
			const inputEl = $('.add-model-input', inlineInput);
			const remarkEl = $('.add-model-remark-input', inlineInput);
			inputEl.focus();
			$('.add-model-confirm', inlineInput).on('click', async e2 => {
				e2.stopPropagation();
				const name = inputEl.value.trim();
				const remark = remarkEl ? remarkEl.value.trim() : '';
				if (name) {
					inlineInput.remove();
					onAddModel(group.id, name, remark);
				}
			});
			$('.add-model-cancel', inlineInput).on('click', e2 => {
				e2.stopPropagation();
				inlineInput.remove();
			});
			const onInlineKeydown = e2 => {
				if (e2.key === 'Enter') {
					e2.preventDefault();
					$('.add-model-confirm', inlineInput).click();
				} else if (e2.key === 'Escape') {
					inlineInput.remove();
				}
			};
			inputEl.on('keydown', onInlineKeydown);
			if (remarkEl) remarkEl.on('keydown', onInlineKeydown);
		});
		models.addChild(addModelBtn);
		groupEl.addChild(headerEl);
		groupEl.addChild(models);
		container.addChild(groupEl);
	});
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
	const modelName = info ? `${info.group.name} / ${info.model.name}` : '未知模型';
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
		const name = info ? `${info.group.name} / ${info.model.name}` : '未知';
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

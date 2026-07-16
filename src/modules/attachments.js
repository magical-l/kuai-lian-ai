// ========== 附件处理辅助函数 ==========
function isTextFile(filename) {
	const textExtensions = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.scss', '.sass', '.less', '.html', '.htm', '.xml', '.yaml', '.yml', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.lua', '.r', '.vue', '.svelte'];
	const dotIndex = filename.lastIndexOf('.');
	const ext = dotIndex > 0 ? filename.toLowerCase().slice(dotIndex) : '';
	return textExtensions.includes(ext);
}

function getMediaType(filename) {
	const dotIndex = filename.lastIndexOf('.');
	const ext = dotIndex > 0 ? filename.toLowerCase().slice(dotIndex) : '';
	const imageTypes = {
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.png': 'image/png',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.bmp': 'image/bmp',
		'.svg': 'image/svg+xml'
	};
	if (imageTypes[ext]) return imageTypes[ext];
	const fileTypes = {
		'.pdf': 'application/pdf',
		'.doc': 'application/msword',
		'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'.xls': 'application/vnd.ms-excel',
		'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	};
	if (fileTypes[ext]) return fileTypes[ext];
	return 'application/octet-stream';
}
async function fileToBase64(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const data = reader.result.split(',')[1]; // 去掉 data:xxx;base64, 前缀
			resolve(data);
		};
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}
async function fetchWithTimeout(url, options, timeout = 60000) {
	const controller = new AbortController();
	const id = setTimeout(() => controller.abort(), timeout);
	const externalSignal = options?.signal;
	if (externalSignal) {
		externalSignal.addEventListener('abort', () => controller.abort());
	}
	try {
		const res = await fetch(url, {
			...options,
			signal: controller.signal
		});
		clearTimeout(id);
		return res;
	} catch (e) {
		clearTimeout(id);
		if (e.name === 'AbortError') throw new Error('请求超时或已取消');
		throw e;
	}
}
async function fileToText(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = reject;
		reader.readAsText(file);
	});
}
async function addAttachment(file) {
	const isImage = getMediaType(file.name).startsWith('image/');
	const isText = isTextFile(file.name);
	const attachment = {
		id: generateUUID(),
		name: file.name,
		type: isImage ? 'image' : (isText ? 'file_text' : 'file'),
		file: file, // 临时存储 File 对象，用于缩略图和预览
		mediaType: getMediaType(file.name),
		previewUrl: null // 缩略图 URL（图片用）
	};
	if (isImage) {
		attachment.previewUrl = await new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}
	pendingAttachments.push(attachment);
	renderPendingAttachments();
}

function removeAttachment(id) {
	pendingAttachments = pendingAttachments.filter(a => a.id !== id);
	renderPendingAttachments();
}

function clearAttachments() {
	pendingAttachments = [];
	renderPendingAttachments();
}

function clearInput() {
	const input = $('#chat-input');
	input.value = '';
}

function setButtonState(sendDisabled, stopEnabled) {
	const area = $('footer.chat-input-area');
	$('.send', area).disabled = sendDisabled;
	$('.split-style.btn-group', area).classList.toggle('hidden', stopEnabled);
	$('.stop-all-response.btn', area).disabled = !stopEnabled;
	$('.stop-all-response.btn', area).classList.toggle('hidden', !stopEnabled);
}

function addInheritIcon(inputEl) {
	if (inputEl._inheritIconAdded) return;
	inputEl._inheritIconAdded = true;
	inputEl.style.flex = '1';
	var icon = document.createElement('span');
	icon.className = 'icon inherit char-style';
	icon.textContent = '';
	icon.title = '继承自父级';
	var parent = inputEl.parentNode;
	if (parent.classList.contains('input-row') || parent.parentElement?.querySelector('input[name="apikey"]')) {
		parent.insertBefore(icon, inputEl);
		return;
	}
	var row = document.createElement('div');
	row.className = 'input-row';
	parent.insertBefore(row, inputEl);
	row.appendChild(icon);
	row.appendChild(inputEl);
}

function showEditGroupDialog(node, parentId, onSave) {
	var dialog = $('dialog.editing.endpoint');
	var isEdit = !!node;
	var tabContainer = $('.tab.container', dialog);
	$('h3', dialog).textContent = isEdit ? '编辑节点' : '新增节点';
	// tab 容器：编辑时隐藏按钮条，新增时显示
	if (tabContainer) {
		if (isEdit) {
			tabContainer.classList.add('no-tabs');
		} else {
			tabContainer.classList.remove('no-tabs');
			var singleRadio = tabContainer.querySelector('input[value="single"]');
			if (singleRadio) singleRadio.checked = true;
		}
	}
	// 重置空值 radio 标签，消除前一次调用留下的继承标注
	['style', 'type'].forEach(function(name) {
		var emptyRadio = dialog.querySelector('input[name="' + name + '"][value=""]');
		if (emptyRadio) {
			emptyRadio.parentElement.classList.remove("hidden");  // 恢复可见（前一次可能隐藏了）
		}
	});
	dialog.querySelectorAll('.inheriting-val').forEach(function(el) { el.textContent = ''; });  // 清空继承值
	// 重置 API Key 可见性 toggle
	var toggleCheckbox = dialog.querySelector('.toggle.apikey input');
	if (toggleCheckbox) toggleCheckbox.checked = false;
	var nameInput = $("input[name=\"name\"]", dialog);
	var urlInput = $('input[name="url"]', dialog);
	var styleSel = dialog.querySelector('input[name="style"]:checked') || dialog.querySelector('input[name="style"]');
	var keyInput = $("input[name=\"apikey\"]", dialog);
	keyInput.type = 'password';  // 重置输入类型（前一次可能被 toggle 改成 text）
	var modelidInput = $('input[name="model-id"]', dialog);
	var remarkInput = $("input[name=\"remark\"]", dialog);
	var typeSel = dialog.querySelector('input[name="type"]:checked') || dialog.querySelector('input[name="type"]');
	var typeHint = dialog.querySelector('input[name="type"]').closest('.field-control').querySelector('.hint');
		function setRadio(name, val, ctx) { ctx.querySelectorAll('input[name="' + name + '"]').forEach(function(r) { r.checked = r.value === val; }); }
		function getRadio(name, ctx) { var r = ctx.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }

	function updateTypeHint(detectedType) {
		if (!typeHint) return;
		var opt = typeSel.closest('.btn-group').querySelector('input[value="' + detectedType + '"]');
		var label = opt ? opt.parentElement.textContent.trim() : detectedType;
		if (detectedType && getRadio('type', dialog) === detectedType) {
			typeHint.textContent = '检测为: ' + label;
		} else {
			typeHint.textContent = '';
		}
	}

	setValues(dialog, {
		'input[name="name"]': node ? node.name : '',
		'input[name="model-id"]': node ? node.modelId || '' : '',
		'input[name="url"]': node ? node.baseUrl || '' : '',
			// style set via setRadio below
		'input[name="apikey"]': node ? node.key || '' : '',
		'input[name="remark"]': node ? node.remark || '' : ''
	});
		setRadio('style', node ? node.style || '' : '', dialog);

	// type：显式值优先，否则从 modelId 检测作为默认
	var detectedType = detectModelType(node ? node.modelId || '' : '');
	if (node && node.type) {
		setRadio('type', node.type, dialog);
	} else {
		setRadio('type', detectedType, dialog);
	}
	typeSel = dialog.querySelector('input[name="type"]:checked') || dialog.querySelector('input[name="type"]');
	updateTypeHint(detectedType);

	// 继承值填入
	// 对编辑：从 node.id 走 resolveNodeConfig（沿祖先链往上找）
	// 对新增：从 parentId 走 resolveNodeConfig（直接拿到父节点的有效配置）
	var inheritId = isEdit ? node.id : parentId;
	if (inheritId) {
		var hasParent = false;
		try {
			var _r = findNodeWithAncestors(endpointsData.nodes, inheritId);
			hasParent = isEdit ? (_r && _r.ancestors.length > 0) : !!parentId;
		} catch(e) { hasParent = !!parentId; }
		var rcfg = resolveNodeConfig(inheritId);
		if (rcfg) {
			(function applyInherit(inputEl, ownVal, rcfgVal) {
				if (!ownVal && rcfgVal) {
				inputEl.value = rcfgVal;
				if (hasParent) addInheritIcon(inputEl);
				}
			})(urlInput, node ? node.baseUrl : '', rcfg.baseUrl);
			(function applyInherit(inputEl, ownVal, rcfgVal) {
				if (!ownVal && rcfgVal) {
				inputEl.value = rcfgVal;
				if (hasParent) addInheritIcon(inputEl);
				}
			})(keyInput, node ? node.key : '', rcfg.key);
			(function applyInherit(inputEl, ownVal, rcfgVal) {
				if (!ownVal && rcfgVal) {
				inputEl.value = rcfgVal;
				if (hasParent) addInheritIcon(inputEl);
				}
			})(modelidInput, node ? node.modelId : '', rcfg.modelId);
			// style
			if (!(node ? node.style : '') && rcfg.style) {
				setRadio('style', '', dialog);
				if (hasParent) {
				var inheritLabel = dialog.querySelector('input[name="style"][value=""]').parentElement;
				if (inheritLabel) {
					var styleOpt = dialog.querySelector('input[name="style"][value="' + rcfg.style + '"]');
					var styleName = rcfg.style;
					if (styleOpt) {
						var label_ = styleOpt.parentElement;
						for (var _c = 0; _c < label_.childNodes.length; _c++) {
							if (label_.childNodes[_c].nodeType === 3 && label_.childNodes[_c].textContent.trim()) {
								styleName = label_.childNodes[_c].textContent.trim(); break;
							}
						}
					}
					inheritLabel.querySelector('.inheriting-val').textContent = '（' + styleName + '）';
				}
				}
			}
			// type
			if (!(node ? node.type : '') && rcfg.type) {
				setRadio('type', '', dialog);
				if (hasParent) {
				var typeInheritInput = dialog.querySelector('input[name="type"][value=""]');
				var typeInheritLabel = typeInheritInput ? typeInheritInput.parentElement : null;
				var typeOpt = dialog.querySelector('input[name="type"][value="' + rcfg.type + '"]');
				var typeName = typeOpt ? typeOpt.parentElement.textContent.trim() : rcfg.type;
				if (typeInheritLabel) {
					var _inp2 = dialog.querySelector('input[name="type"][value=""]');
					if (_inp2) {
						var _parent2 = _inp2.parentElement;
						_parent2.querySelector('.inheriting-val').textContent = '（' + typeName + '）';
					}
				}
				}
			}
		}
	}

		// 显示继承来源节点名称
		var inheritSourceEl = dialog.querySelector('.inherit-source');
		if (inheritSourceEl) {
			var parentName = '';
			if (isEdit && _r && _r.ancestors.length > 0) {
				parentName = _r.ancestors[0].name;
			} else if (!isEdit && parentId) {
				var parentNode = getNode(parentId);
				parentName = parentNode ? parentNode.name : '';
			}
			if (parentName) {
				inheritSourceEl.textContent = '继承自: ' + parentName;
				inheritSourceEl.classList.remove('hidden');
			} else {
				inheritSourceEl.classList.add('hidden');
			}
		}

		// 最顶级节点：去继承、默认ChatGPT式
		if (!hasParent) {
			['style', 'type'].forEach(function(name) {
				var emptyRadio = dialog.querySelector('input[name="' + name + '"][value=""]');
				if (emptyRadio) emptyRadio.parentElement.classList.add("hidden");
			});
			setRadio('style', node ? node.style || 'openai' : 'openai', dialog);
		}

	// 名称 ↔ 模型名连续同步（用 _syncing 防止循环触发）
	var _nameUserEdited = false;
	var _typeUserEdited = false;
	var _syncing = false;
	nameInput.oninput = function() {
		if (!_syncing) _nameUserEdited = true;
	};
	function removeIcon(el) {
		var ic = el.parentNode.querySelector('.inherit.icon');
		if (ic) ic.remove();
	}
	modelidInput.oninput = function() {
		removeIcon(this);
		if (!_nameUserEdited) {
			_syncing = true;
			nameInput.value = this.value;
			_syncing = false;
		}
		// type 自动检测（仅在用户未手动修改过 type 时）
		if (!_typeUserEdited) {
			var detected = detectModelType(this.value);
			setRadio('type', detected, dialog);
			updateTypeHint(detected);
			typeSel = dialog.querySelector('input[name="type"]:checked') || dialog.querySelector('input[name="type"]');
		}
	};
	typeSel.onchange = function() { _typeUserEdited = true; };
		dialog.querySelectorAll('input[name="type"]').forEach(function(r) { r.addEventListener('change', function() { _typeUserEdited = true; typeSel = this; }); });
	urlInput.oninput = function() { removeIcon(this); };
	keyInput.oninput = function() { removeIcon(this); };

	dialog.show();
	// show() 不自动处理 Escape，用闭包注册一次性 document 监听
	var escHandler = function(e) {
		if (e.key === 'Escape' && dialog.hasAttribute('open')) {
			dialog.close();
			doc.removeEventListener('keydown', escHandler);
		}
	};
	doc.addEventListener('keydown', escHandler);
	// 关闭时清理监听器
	var origClose = dialog.close.bind(dialog);
	dialog.close = function() {
		doc.removeEventListener('keydown', escHandler);
		origClose();
	};
	toggleCheckbox = dialog.querySelector('.toggle.apikey input');
	if (toggleCheckbox) {
		toggleCheckbox.addEventListener('change', function() {
			keyInput.type = this.checked ? 'text' : 'password';
		});
	}
	// Enter → 切到下一个输入框
	var formFields = [nameInput, urlInput, keyInput, modelidInput, remarkInput];
	var form = dialog.querySelector('form');
	if (form) {
		form.addEventListener('keydown', function(e) {
			if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey) return;
			var idx = formFields.indexOf(document.activeElement);
			if (idx >= 0 && idx < formFields.length - 1) {
				e.preventDefault();
				formFields[idx + 1].focus();
				formFields[idx + 1].select?.();
			} else if (idx === formFields.length - 1) {
				// 最后一个输入框 → 保存
				e.preventDefault();
				var saveBtn = $('.ok', dialog);
				if (saveBtn) saveBtn.click();
			}
		});
	}
	onClick({
		'.close': function() { dialog.close(); },
		'.ok': function() {
			// 批量模式走批量提交
			if (!isEdit && dialog.querySelector('.tab.container input[value="batch"]:checked')) {
				if (handleBatchSubmit(dialog, parentId) !== false) dialog.close();
				return;
			}
			var theName = nameInput.value.trim();
			var theModelId = modelidInput.value.trim();
			if (!theName && theModelId) {
				theName = theModelId;
			} else if (!theName) {
				alert('请填写名称');
				return;
			}
			var theType = getRadio('type', dialog);
			if (!theType) {
				theType = rcfg && rcfg.type;
				if (!theType) {
					alert('请选择类型');
					return;
				}
			}
			var saveData = { name: theName, style: getRadio('style', dialog), type: theType };
			// 可继承字段：节点原本有值则直接保存（含清空为""）；
			// 节点原本无值则仅当用户手动输入了不同于继承值的值时才保存，否则不传以保持继承
			var theUrl = urlInput.value.trim();
			if (node && node.baseUrl || theUrl !== (rcfg && rcfg.baseUrl || '')) saveData.baseUrl = theUrl;
			var theKey = keyInput.value.trim();
			if (node && node.key || theKey !== (rcfg && rcfg.key || '')) saveData.key = theKey;
			if (node && node.modelId || theModelId !== (rcfg && rcfg.modelId || '')) saveData.modelId = theModelId;
			var theRemark = remarkInput.value.trim();
			if (theRemark) saveData.remark = theRemark;
			else saveData.remark = '';
			onSave(saveData);
			dialog.close();
		}
	}, dialog);
	// 批量 tab — 惰性构建字段块
	if (!isEdit && tabContainer) {
		tabContainer.querySelectorAll('input[name="dialog-tab"]').forEach(function(radio) {
			radio.addEventListener('change', function() {
				if (this.value === 'batch' && this.checked) {
					var list = $('.field-list', dialog);
					if (list && !list.hasChildNodes()) {
						buildBatchFields(dialog, parentId);
					}
				}
			});
		});
	}
}

// ========== 批量创建 ==========
function buildBatchFields(dialog, parentId) {
	var list = $('.field-list', dialog);
	if (!list) return;
	var fields = [
		{ key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com' },
		{ key: 'style', label: '接口风格', options: [
			{ value: 'openai', text: 'ChatGPT式', hint: 'OpenAI、国内主流<br>/v1/chat/completions' },
			{ value: 'claude', text: 'Claude式', hint: 'Anthropic<br>/v1/messages' },
			{ value: 'gemini', text: 'Gemini式', hint: 'Google<br>/v1beta/models/……' }
		]},
		{ key: 'type', label: '类型', options: [
			{ value: 'chat', text: '💬 聊天' },
			{ value: 'embedding', text: '🔢 嵌入' },
			{ value: 'image-generation', text: '🎨 生图' },
			{ value: 'reranking', text: '📊 重排序' }
		]},
		{ key: 'key', label: 'API Key' },
		{ key: 'modelId', label: '模型名', placeholder: '如 gpt-4o' }
	];
	fields.forEach(function(cfg) {
		var block = fromTemplate('batch-field-block', '.batch-field');
		block.dataset.field = cfg.key;
		block.querySelector('.field-label').textContent = cfg.label;
		var inputRow = block.querySelector('.input-row');
		var input = inputRow ? inputRow.querySelector('input') : null;
		if (input && cfg.placeholder) input.placeholder = cfg.placeholder;
		var addBtn = block.querySelector('.add-tag');
		var tagContainer = block.querySelector('.tag-container');
		var multiSelect = block.querySelector('.btn-group.multi-select');
		// 有预定义选项的字段显示多选按钮组（与单节点 radio 样式一致）
		if (cfg.options) {
			tagContainer.style.display = 'none';
			if (inputRow) inputRow.style.display = 'none';
			if (multiSelect) {
				multiSelect.classList.remove('hidden');
				cfg.options.forEach(function(opt) {
					var label = mk('label', 'option btn');
					var cb = mk('input');
					cb.type = 'checkbox';
					cb.value = opt.value;
					label.appendChild(cb);
					label.appendChild(doc.createTextNode(opt.text));
					if (opt.hint) {
						var hint = mk('span', 'hint');
						hint.innerHTML = opt.hint;
						label.appendChild(hint);
					}
					multiSelect.appendChild(label);
				});
			}
		}
		// 文本输入 + 添加按钮
		addBtn.onclick = function() { addTagFromInput(input, tagContainer); };
		input.onkeydown = function(e) {
			if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(input, tagContainer); }
		};
		list.appendChild(block);
	});
	setupBatchDragDrop(list);
}
function addTagFromInput(input, tagContainer) {
	var val = input.value.trim();
	if (!val) return;
	addTagToField(tagContainer, val, val);
	input.value = '';
	input.focus();
}
function addTagToField(tagContainer, value, displayText) {
	// 去重
	var existing = tagContainer.querySelector('.tag[data-value="' + value.replace(/"/g, '&quot;') + '"]');
	if (existing) return;
	var tag = mk('span', 'tag');
	tag.dataset.value = value;
	tag.textContent = displayText || value;
	var removeBtn = mk('button', 'tag-remove');
	removeBtn.textContent = '×';
	removeBtn.onclick = function() { tag.remove(); };
	tag.appendChild(removeBtn);
	tagContainer.appendChild(tag);
}
function setupBatchDragDrop(list) {
	var dragSrc = null;
	list.addEventListener('dragstart', function(e) {
		var block = e.target.closest('.batch-field');
		if (!block || !e.target.closest('.handle')) { e.preventDefault(); return; }
		dragSrc = block;
		block.classList.add('dragging');
		e.dataTransfer.effectAllowed = 'move';
	});
	list.addEventListener('dragend', function() {
		list.querySelectorAll('.dragging').forEach(function(el) { el.classList.remove('dragging'); });
		list.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
	});
	list.addEventListener('dragover', function(e) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		var block = e.target.closest('.batch-field');
		if (!block || block === dragSrc) return;
		list.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
		block.classList.add('drag-over');
	});
	list.addEventListener('drop', function(e) {
		e.preventDefault();
		list.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
		if (!dragSrc) return;
		var target = e.target.closest('.batch-field');
		if (!target || target === dragSrc) return;
		var rect = target.getBoundingClientRect();
		var midY = rect.top + rect.height / 2;
		if (e.clientY < midY) {
			list.insertBefore(dragSrc, target);
		} else {
			list.insertBefore(dragSrc, target.nextSibling);
		}
		dragSrc = null;
	});
}
function collectBatchFieldValues(dialog) {
	var result = {};
	var rootNameInput = $('input[name="batch-root-name"]', dialog);
	result.rootName = rootNameInput ? rootNameInput.value.trim() : '';
	result.fields = [];
	var list = $('.field-list', dialog);
	if (!list) return result;
	list.querySelectorAll('.batch-field').forEach(function(block) {
		var key = block.dataset.field;
		var values = [];
		var multiSelect = block.querySelector('.btn-group.multi-select:not(.hidden)');
		if (multiSelect) {
			// 多选按钮组模式（style/type）
			multiSelect.querySelectorAll('input:checked').forEach(function(cb) {
				values.push(cb.value);
			});
		} else {
			// tag 输入模式（baseUrl/key/modelId）
			block.querySelectorAll('.tag').forEach(function(tag) {
				values.push(tag.dataset.value);
			});
		}
		if (values.length > 0) {
			result.fields.push({ key: key, values: values });
		}
	});
	return result;
}
function handleBatchSubmit(dialog, parentId) {
	var data = collectBatchFieldValues(dialog);
	if (!data.rootName) {
		// 用第一个有值的字段的第一个值做根名称
		for (var i = 0; i < data.fields.length; i++) {
			if (data.fields[i].values.length > 0) {
				data.rootName = data.fields[i].values[0];
				break;
			}
		}
		if (!data.rootName) { alert('请填写根节点名称或至少一个字段值'); return false; }
	}
	if (data.fields.length === 0) { alert('请至少填写一个字段的值'); return false; }
	var subtree = generateBatchSubtree(data.rootName, data.fields);
	batchAddNodes(parentId, subtree).then(function() {
		refreshUI();
	}).catch(function(e) { console.error('batchAddNodes error', e); });
	return true;
}
function generateBatchSubtree(rootName, fields) {
	var root = { name: rootName, children: [] };
	var level = [root];
	fields.forEach(function(field) {
		var prop = field.key;
		var vals = field.values;
		if (vals.length === 1) {
			// 单值：设到当前层所有节点，不创建子层
			level.forEach(function(n) { n[prop] = vals[0]; });
		} else {
			// 多值：创建子层
			var next = [];
			level.forEach(function(parent) {
				vals.forEach(function(v) {
					var child = { name: v, children: [] };
					child[prop] = v;
					parent.children.push(child);
					next.push(child);
				});
			});
			level = next;
		}
	});
	return [root];
}
function showDirectoryPrompt(hasPendingHandle = false) {
	showHelpDialog(true, hasPendingHandle);
}

function hideDirectoryPrompt() {
	const prompt = $('dialog.help');
	if (prompt) prompt.remove();
}

async function onRecoverDirectory() {
	const ok = await storage.restoreDirectory();
	if (!ok) { alert('权限请求失败，请选择新目录'); return; }
	currentMode = 'directory';
	await storage._saveModePref();
	await loadEndpoints();
	await loadSessionsIndex();
	const info = storage.getDisplayInfo();
	const dlg = $('dialog.help');
	$('.cur', dlg).textContent = '当前存储：' + info.text;
	$('.cur', dlg).title = info.title;
	updateDirectoryDisplay();
	await refreshUI();
	closeHelpDialog(true);
}
async function onSelectDirectory() {
	const success = await selectDirectory();
	if (!success) return;
	const info = storage.getDisplayInfo();
	const dlg = $('dialog.help');
	$('.cur', dlg).textContent = '当前存储：' + info.text;
	$('.cur', dlg).title = info.title;
	updateDirectoryDisplay();
	await refreshUI();
	if (dlg.dataset.forceSelect === 'true') closeHelpDialog(true);
}
async function onUseBrowserStorage() {
	await storage.selectMode("browser");
	await loadEndpoints();
	await loadSessionsIndex();
	updateDirectoryDisplay();
	await refreshUI();
	closeHelpDialog(true);
}

function showHelpDialog(forceSelectDirectory = false, hasPendingHandle = false) {
	const dialog = $('dialog.help');
	// 重置关闭动画产生的内联样式
	dialog.style.transition = '';
	dialog.style.transform = '';
	dialog.style.transformOrigin = '';
	// 传递状态给 HTML onclick 中的具名函数
	dialog.dataset.forceSelect = forceSelectDirectory;
	dialog.dataset.hasPending = hasPendingHandle;
	// 动态内容
	const displayInfo = storage.getDisplayInfo();
	const hasDir = storage.mode === 'directory';
	$('.cur', dialog).textContent = '当前存储：' + displayInfo.text + (hasDir ? '' : '（浏览器存储）');
	$('.cur', dialog).title = displayInfo.title;
	$('.select-dir', dialog).textContent = hasDir ? '更换目录' : '选择目录存储';
	// 条件显隐
	$('.workspace-setting .warning', dialog).hidden = !forceSelectDirectory;
	$('.recover', dialog).hidden = !hasPendingHandle;
	$('.close', dialog).hidden = forceSelectDirectory;
	// 点击遮罩关闭
	dialog.onclick = function(e) {
		if (e.target === this) closeHelpDialog();
	};
	dialog.showModal();
}

function closeHelpDialog(immediate = false) {
	const dialog = $('dialog.help');
	const helpBtn = $('.help');
	if (!helpBtn) {
		dialog.close();
		return;
	}
	const btnRect = helpBtn.getBoundingClientRect();
	const dialogRect = dialog.getBoundingClientRect();
	if (!immediate) {
		const btnCenterX = btnRect.left + btnRect.width / 2;
		const btnCenterY = btnRect.top + btnRect.height / 2;
		const dialogCenterX = dialogRect.left + dialogRect.width / 2;
		const dialogCenterY = dialogRect.top + dialogRect.height / 2;
		const translateX = btnCenterX - dialogCenterX;
		const translateY = btnCenterY - dialogCenterY;
		dialog.style.setProperty('transition', 'transform 0.4s ease-in', 'important');
		dialog.style.setProperty('transform-origin', 'center center', 'important');
		dialog.offsetHeight;
		dialog.style.setProperty('transform', `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px)) scale(0.05)`, 'important');
		setTimeout(() => {
			dialog.close();
			dialog.style.transition = '';
			dialog.style.transform = '';
			dialog.style.transformOrigin = '';
		}, 400);
	} else {
		dialog.close();
		dialog.style.transition = '';
		dialog.style.transform = '';
		dialog.style.transformOrigin = '';
	}
}
const connectionStatus = new Map(); // nodeId -> { status, timestamp }
function getConnectionStatusText(key) {
	const data = connectionStatus.get(key);
	if (!data) return '测试连接：未测试';
	const statusText = {
		'testing': '测试中...',
		'connected': '✓ 连接成功',
		'failed': '✗',
		'cors_blocked': '⚠ 该端点禁止浏览器直连'
	};
	const text = statusText[data.status] || '未测试';
	const timeStr = data.timestamp ? formatDateTime(data.timestamp) : '';
	const errorInfo = data.error ? ` (${data.error})` : '';
	return data.status === 'testing' ? '测试连接：测试中...' : `测试连接：${text}${errorInfo}（${timeStr}）`;
}
async function testConnection(nodeId) {
	var node = getNode(nodeId);
	if (!node) return;
	var rcfg = resolveNodeConfig(nodeId);
	if (!rcfg || !rcfg.modelId) return;
	var modelName = rcfg.modelId;
	if (!rcfg || !rcfg.baseUrl || (rcfg.key === undefined || rcfg.key === null)) return;
	var provider = providers[rcfg.style || 'openai'];
	if (!provider) return;
	var key = nodeId;
	connectionStatus.set(key, { status: 'testing', timestamp: null });
	updateEndpointTestUI(key);
	try {
		var modelType = detectModelType(modelName);
		var testFn = (modelType === 'embedding' && provider.testEmbeddingConfig) ? provider.testEmbeddingConfig : provider.testConfig;
		var tcfg = testFn(rcfg.baseUrl, rcfg.key, modelName);
		var res = await fetchWithTimeout(tcfg.url, {
			method: 'POST',
			headers: tcfg.headers,
			body: JSON.stringify(tcfg.body)
		}, 30000);
		if (res && res.ok) {
			// 检测 HTTP 200 但返回了 HTML 错误页面的情况
			var ct = (res.headers.get('content-type') || '');
			if (ct.includes('text/html')) {
				var errorBody = await res.text().catch(function() { return ''; });
				var errorMsg = '返回了HTML页面（可能为错误页面）';
				var m = errorBody.match(/<title>([^<]+)<\/title>/i);
				if (m) errorMsg = m[1];
				else if (errorBody && errorBody.length < 100) errorMsg = errorBody;
				connectionStatus.set(key, { status: 'failed', timestamp: Date.now(), error: errorMsg });
			} else if (ct.includes('application/json') || ct.includes('text/event-stream')) {
				// 解析 JSON 响应体，检查 API 层错误（有些代理返回 200 + {"error":{...}}）
				try {
					var successBody = await res.text();
					var successJson = JSON.parse(successBody);
					if (successJson.error) {
						var errMsg = successJson.error.message || successJson.error.code || JSON.stringify(successJson.error);
						connectionStatus.set(key, { status: 'failed', timestamp: Date.now(), error: errMsg });
					} else {
						connectionStatus.set(key, { status: 'connected', timestamp: Date.now() });
					}
				} catch(e) {
					connectionStatus.set(key, { status: 'connected', timestamp: Date.now() });
				}
			} else {
				connectionStatus.set(key, { status: 'connected', timestamp: Date.now() });
			}
		} else {
			var errorMsg = 'HTTP ' + res.status;
			try {
				var errorBody = await res.text();
				try {
				var errorJson = JSON.parse(errorBody);
				if (errorJson.error && errorJson.error.message) errorMsg = errorJson.error.message;
				else if (errorJson.message) errorMsg = errorJson.message;
				} catch(e) { if (errorBody && errorBody.length < 100) errorMsg = errorBody; }
			} catch(e) {}
			connectionStatus.set(key, { status: 'failed', timestamp: Date.now(), error: errorMsg });
		}
	} catch (err) {
		var isCorsError = err instanceof TypeError && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.name === 'TypeError');
		connectionStatus.set(key, {
			status: isCorsError ? 'cors_blocked' : 'failed',
			timestamp: Date.now(),
			error: isCorsError ? null : err.message
		});
	}
	updateEndpointTestUI(key);
}

// 递归收集所有子节点 ID
function collectDescendantIds(nodeId) {
	var ids = [nodeId];
	var node = getNode(nodeId);
	if (node && node.children) {
		node.children.forEach(function(child) {
			ids.push.apply(ids, collectDescendantIds(child.id));
		});
	}
	return ids;
}

// 清空指定节点及其所有子节点的测试连接结果
function clearTestResults(nodeId) {
	var ids = collectDescendantIds(nodeId);
	var idSet = {};
	ids.forEach(function(id) { idSet[id] = true; });
	for (var key of connectionStatus.keys()) {
		if (idSet[key]) {
			connectionStatus.delete(key);
		}
	}
}

let attachmentTooltip = null;

function showAttachmentTooltip(name, targetEl) {
	if (!attachmentTooltip) {
		attachmentTooltip = mk('div');
		attachmentTooltip.style.cssText = 'position:fixed;background:var(--bg-elevated);border:1px solid var(--border-subtle);padding:2px 6px;font-size:11px;border-radius:4px;z-index:9999;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:var(--shadow-sm);pointer-events:none;';
		doc.body.appendChild(attachmentTooltip);
	}
	attachmentTooltip.textContent = name;
	attachmentTooltip.classList.remove('hidden');
	const rect = targetEl.getBoundingClientRect();
	// 显示在缩略图上方
	attachmentTooltip.style.right = (window.innerWidth - rect.right) + 'px';
	attachmentTooltip.style.left = 'auto';
	attachmentTooltip.style.top = (rect.top - 24) + 'px';
}

function hideAttachmentTooltip() {
	if (attachmentTooltip) {
		attachmentTooltip.classList.add('hidden');
	}
}

function renderPendingAttachments() {
	const row = $('.attachment.list');
	if (!row) return;
	row.innerHTML = '';
	pendingAttachments.forEach(att => {
		const thumb = mk('div', `thumb icon ${att.type === 'image' ? 'image' : 'file'} , flex items-go-x`);
		thumb.dataset.id = att.id;
		if (att.type === 'image' && att.previewUrl) {
			thumb.style.backgroundImage = `url(${att.previewUrl})`;
		} else {
			thumb.textContent = '';
		}
		// hover显示名字
		thumb.onmouseenter = () => showAttachmentTooltip(att.name, thumb);
		thumb.onmouseleave = () => hideAttachmentTooltip();
		const remove = mk('span', 'icon remove btn');
		remove.textContent = '';
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
		const overlay = mk('div', 'image-preview-overlay , flex items-go-x');
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
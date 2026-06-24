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
	$('.send').disabled = sendDisabled;
	$('.send-btn-group').style.display = stopEnabled ? 'none' : '';
	$('.stop.btn').disabled = !stopEnabled;
	$('.stop.btn').classList.toggle('hidden', !stopEnabled);
}

function addInheritIcon(inputEl) {
	if (inputEl._inheritIconAdded) return;
	inputEl._inheritIconAdded = true;
	inputEl.style.flex = '1';
	var icon = document.createElement('span');
	icon.className = 'icon inherit-icon';
	icon.textContent = '↑';
	icon.title = '继承自父级';
	icon.style.cssText = 'cursor:help;font-size:12px;color:var(--text-muted);flex-shrink:0;margin-right:3px;';
	var parent = inputEl.parentNode;
	if (parent.classList.contains('input-row') || parent.classList.contains('apikey-input-wrapper')) {
		parent.insertBefore(icon, inputEl);
		return;
	}
	var row = document.createElement('div');
	row.className = 'input-row';
	row.style.cssText = 'display:flex;align-items:center;gap:2px;';
	parent.insertBefore(row, inputEl);
	row.appendChild(icon);
	row.appendChild(inputEl);
}

function showEditGroupDialog(node, parentId, onSave) {
	var exist = $('dialog.editing.endpoint');
	if (exist) exist.remove();
	var dialog = fromTemplate('edit-group-dialog', '.editing.endpoint');
	var isEdit = !!node;
	$('h3', dialog).textContent = isEdit ? '编辑节点' : '新增节点';
	var keyInput = $(".group-key", dialog);
	var nameInput = $(".group-name", dialog);
	var urlInput = $('.group-url', dialog);
	var modelidInput = $('.group-modelid', dialog);
	var styleSel = $(".group-style", dialog);
	var remarkInput = $(".group-remark", dialog);

	setValues(dialog, {
		'.group-name': node ? node.name : '',
		'.group-modelid': node ? node.modelId || '' : '',
		'.group-url': node ? node.baseUrl || '' : '',
		'.group-style': node ? node.style || '' : '',
		'.group-key': node ? node.key || '' : '',
		'.group-remark': node ? node.remark || '' : ''
	});

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
				styleSel.value = '';
				if (hasParent) {
				var inheritOpt = styleSel.querySelector('option[value=""]');
				if (inheritOpt) inheritOpt.textContent = '继承自父级（' + rcfg.style + '）';
				}
			}
		}
	}

	// 名称 ↔ 模型名连续同步（用 _syncing 防止循环触发）
	var _nameUserEdited = false;
	var _syncing = false;
	nameInput.oninput = function() {
		if (!_syncing) _nameUserEdited = true;
	};
	function removeIcon(el) {
		var ic = el.parentNode.querySelector('.inherit-icon');
		if (ic) ic.remove();
	}
	modelidInput.oninput = function() {
		removeIcon(this);
		if (!_nameUserEdited) {
			_syncing = true;
			nameInput.value = this.value;
			_syncing = false;
		}
	};
	urlInput.oninput = function() { removeIcon(this); };
	keyInput.oninput = function() { removeIcon(this); };

	doc.body.addChild(dialog);
	dialog.showModal();
	var toggleBtn = $('button.toggle.apikey.visibility', dialog);
	if (toggleBtn) {
		toggleBtn.onclick = function(e) {
			e.preventDefault();
			var isPw = keyInput.type === 'password';
			keyInput.type = isPw ? 'text' : 'password';
			toggleBtn.innerHTML = isPw ? SVG.eyeOff : SVG.eye;
		};
	}
	// Enter → 切到下一个输入框
	var formFields = [nameInput, urlInput, styleSel, keyInput, modelidInput, remarkInput];
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
				var saveBtn = $('.save', dialog);
				if (saveBtn) saveBtn.click();
			}
		});
	}
	onClick({
		'.cancel': function() { dialog.remove(); },
		'.save': function() {
			var theName = nameInput.value.trim();
			var theModelId = modelidInput.value.trim();
			if (!theName && theModelId) {
				theName = theModelId;
			} else if (!theName) {
				alert('请填写名称');
				return;
			}
			var saveData = { name: theName, style: styleSel.value };
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
			dialog.remove();
		}
	}, dialog);
}
function showDirectoryPrompt(hasPendingHandle = false) {
	showHelpDialog(true, hasPendingHandle);
}

function hideDirectoryPrompt() {
	const prompt = $('dialog.help');
	if (prompt) prompt.remove();
}

function showHelpDialog(forceSelectDirectory = false, hasPendingHandle = false) {
	const exist = $('dialog.help');
	if (exist) exist.remove();
	const dialog = fromTemplate('help-dialog', '.help');
	const dirName = storage.getDirectoryName();
	const displayInfo = storage.getDisplayInfo();
	const hasDir = storage.mode === 'directory';
	$('.name', dialog).textContent = '当前存储：' + displayInfo.text + (hasDir ? '' : '（浏览器存储）');
	$('.name', dialog).title = displayInfo.title;
	const changeDirBtn = $('.select-dir', dialog);
	changeDirBtn.textContent = hasDir ? '更换目录' : '选择目录存储';
	const restoreBtn = $('.recover', dialog);
	if (restoreBtn) {
		restoreBtn.onclick = async () => {
	const ok = await storage.restoreDirectory();
			if (ok) {
				currentMode = 'directory';
				await storage._saveModePref();
				await loadEndpoints();
				await loadSessionsIndex();
				const dispInfo = storage.getDisplayInfo();
				$('.name', dialog).textContent = '当前存储：' + dispInfo.text;
				$('.name', dialog).title = dispInfo.title;
				updateDirectoryDisplay();
				await refreshUI();
				closeHelpDialog(dialog, true);
			} else {
				alert('权限请求失败，请选择新目录');
			}
		};
		if (!hasPendingHandle) restoreBtn.remove();
	}
	const warningEl = $('.workspace.directory .warning', dialog);
	if (!forceSelectDirectory) warningEl.remove();
	const closeBtn = $('.close', dialog);
	if (closeBtn) {
		closeBtn.onclick = () => closeHelpDialog(dialog, false);
		dialog.addEventListener('click', function(e) {
			if (e.target === dialog) closeHelpDialog(dialog, false);
		});
		if (forceSelectDirectory) closeBtn.remove();
	}
	doc.body.addChild(dialog);
	dialog.showModal();
	// 选择/更换目录按钮
	changeDirBtn.onclick = async () => {
		const success = await selectDirectory();
		if (success) {
			const dispInfo2 = storage.getDisplayInfo();
			$('.name', dialog).textContent = '当前存储：' + dispInfo2.text;
			$('.name', dialog).title = dispInfo2.title;
			updateDirectoryDisplay();
			await refreshUI();
			if (forceSelectDirectory) {
				closeHelpDialog(dialog, true);
			}
		}
	};
	// 使用浏览器存储按钮
	const browserBtn = $(".use-browser-storage", dialog);
	if (browserBtn) {
		browserBtn.onclick = async () => {
			await storage.selectMode("browser");
			await loadEndpoints();
			await loadSessionsIndex();
			updateDirectoryDisplay();
			await refreshUI();
			closeHelpDialog(dialog, true);
		};
	}
}

function closeHelpDialog(dialog, immediate = false) {
	const helpBtn = $('.help');
	if (!helpBtn) {
		dialog.remove();
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
			dialog.remove();
		}, 400);
	} else {
		dialog.remove();
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
	const row = $('.attachment.list');
	if (!row) return;
	row.innerHTML = '';
	pendingAttachments.forEach(att => {
		const thumb = mk('div', `thumb ${att.type === 'image' ? 'image' : 'file'} , flex items-go-x`);
		thumb.dataset.id = att.id;
		if (att.type === 'image' && att.previewUrl) {
			thumb.style.backgroundImage = `url(${att.previewUrl})`;
		} else {
			thumb.textContent = '📄';
		}
		// hover显示名字
		thumb.onmouseenter = () => showAttachmentTooltip(att.name, thumb);
		thumb.onmouseleave = () => hideAttachmentTooltip();
		const remove = mk('span', 'remove btn');
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

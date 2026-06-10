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
	$('#btn-send').disabled = sendDisabled;
	const stopBtn = $('#btn-stop');
	stopBtn.disabled = !stopEnabled;
	stopBtn.textContent = stopEnabled ? '全部停止' : '停止';
}

function showEditGroupDialog(group = null, onSave) {
	const exist = $('#edit-dialog');
	if (exist) exist.remove();
	const dialog = fromTemplate('tpl-edit-group-dialog', '#edit-dialog');
	$('h3', dialog).textContent = group ? '编辑端点' : '新增端点';
	setValues(dialog, {
		'#dialog-group-name': group?.name,
		'#dialog-group-url': group?.baseUrl,
		'#dialog-group-style': group?.style ?? 'openai',
		'#dialog-group-key': group?.key
	});
	const keyInput = $('#dialog-group-key', dialog);
	doc.body.addChild(dialog);
	const toggleBtn = $('button.toggle-key', dialog);
	toggleBtn.onclick = e => {
		e.preventDefault();
		const isPassword = keyInput.type === 'password';
		keyInput.type = isPassword ? 'text' : 'password';
		toggleBtn.innerHTML = isPassword ? SVG.eyeOff : SVG.eye;
	};
	onClick({
		'#dialog-cancel': () => dialog.remove(),
		'#dialog-save': () => {
			const name = $('#dialog-group-name', dialog).value.trim();
			const baseUrl = $('#dialog-group-url', dialog).value.trim();
			const style = $('#dialog-group-style', dialog).value;
			const key = keyInput.value.trim();
			if (!name || !baseUrl) {
				alert('请填写名称和Base URL');
				return;
			}
			onSave({
				name,
				baseUrl,
				style,
				key
			});
			dialog.remove();
		}
	}, dialog);
}

function showDirectoryPrompt(hasPendingHandle = false) {
	showHelpDialog(true, hasPendingHandle);
}

function hideDirectoryPrompt() {
	const prompt = $('#help-dialog');
	if (prompt) prompt.remove();
}

function showHelpDialog(forceSelectDirectory = false, hasPendingHandle = false) {
	const exist = $('#help-dialog');
	if (exist) exist.remove();
	const overlay = mk('div', 'dialog-overlay');
	if (forceSelectDirectory) {
		overlay.style.background = 'rgba(0, 0, 0, 0.5)';
	}
	doc.body.addChild(overlay);
	const dialog = fromTemplate('tpl-help-dialog', '#help-dialog');
	const dirName = storage.getDirectoryName();
	const displayInfo = storage.getDisplayInfo();
	const hasDir = storage.mode === 'directory';
	$('#help-dir-name', dialog).textContent = '当前存储：' + displayInfo.text + (hasDir ? '' : '（浏览器存储）');
	$('#help-dir-name', dialog).title = displayInfo.title;
	const changeDirBtn = $('#btn-change-dir-help', dialog);
	changeDirBtn.textContent = hasDir ? '更换目录' : '选择目录存储';
	const restoreBtn = $('#btn-restore-dir', dialog);
	if (restoreBtn) {
		restoreBtn.onclick = async () => {
	const ok = await storage.restoreDirectory();
			if (ok) {
				currentMode = 'directory';
				await storage._saveModePref();
				await loadEndpoints();
				await loadSessionsIndex();
				const dispInfo = storage.getDisplayInfo();
				$('#help-dir-name', dialog).textContent = '当前存储：' + dispInfo.text;
				$('#help-dir-name', dialog).title = dispInfo.title;
				updateDirectoryDisplay();
				await refreshUI();
				closeHelpDialog(dialog, overlay, true);
			} else {
				alert('权限请求失败，请选择新目录');
			}
		};
		if (!hasPendingHandle) restoreBtn.remove();
	}
	const warningEl = $('#help-directory-warning', dialog);
	if (!forceSelectDirectory) warningEl.remove();
	const closeBtn = $('#help-close', dialog);
	if (closeBtn) {
		closeBtn.onclick = () => closeHelpDialog(dialog, overlay, false);
		overlay.onclick = () => closeHelpDialog(dialog, overlay, false);
		if (forceSelectDirectory) closeBtn.remove();
	}
	doc.body.addChild(dialog);
	// 选择/更换目录按钮
	changeDirBtn.onclick = async () => {
		const success = await selectDirectory();
		if (success) {
			const dispInfo2 = storage.getDisplayInfo();
			$('#help-dir-name', dialog).textContent = '当前存储：' + dispInfo2.text;
			$('#help-dir-name', dialog).title = dispInfo2.title;
			updateDirectoryDisplay();
			await refreshUI();
			if (forceSelectDirectory) {
				closeHelpDialog(dialog, overlay, true);
			}
		}
	};
	// 使用浏览器存储按钮
	const browserBtn = $("#btn-use-browser-storage", dialog);
	if (browserBtn) {
		browserBtn.onclick = async () => {
			await storage.selectMode("browser");
			await loadEndpoints();
			await loadSessionsIndex();
			updateDirectoryDisplay();
			await refreshUI();
			closeHelpDialog(dialog, overlay, true);
		};
	}
}

function closeHelpDialog(dialog, overlay, immediate = false) {
	const helpBtn = $('#btn-help');
	if (!helpBtn) {
		dialog.remove();
		overlay.remove();
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
			overlay.remove();
		}, 400);
	} else {
		dialog.remove();
		overlay.remove();
	}
}
const connectionStatus = new Map(); // groupId:modelId -> { status, timestamp }
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
async function testConnection(groupId, modelId) {
	const group = getGroup(groupId);
	const model = getModel(groupId, modelId);
	if (!group || !model) return;
	const provider = providers[group.style];
	if (!provider) return;
	const key = groupId + ':' + modelId;
	connectionStatus.set(key, {
		status: 'testing',
		timestamp: null
	});
	renderEndpointList(getGroups(), null, null, handleModelEdit, handleGroupEdit, handleGroupDelete, handleAddModelForGroup, handleModelDelete, handleReorderGroups, handleReorderModels, testConnection);
	try {
		const config = provider.testConfig(group.baseUrl, group.key, model.name);
		const res = await fetchWithTimeout(config.url, {
			method: 'POST',
			headers: config.headers,
			body: JSON.stringify(config.body)
		}, 30000);
		if (res && res.ok) {
			connectionStatus.set(key, {
				status: 'connected',
				timestamp: Date.now()
			});
		} else {
			let errorMsg = 'HTTP ' + res.status;
			try {
				const errorBody = await res.text();
				try {
					const errorJson = JSON.parse(errorBody);
					if (errorJson.error && errorJson.error.message) {
						errorMsg = errorJson.error.message;
					} else if (errorJson.message) {
						errorMsg = errorJson.message;
					}
				} catch (e) {
					if (errorBody && errorBody.length < 100) {
						errorMsg = errorBody;
					}
				}
			} catch (e) {}
			connectionStatus.set(key, {
				status: 'failed',
				timestamp: Date.now(),
				error: errorMsg
			});
		}
	} catch (err) {
		const isCorsError = err instanceof TypeError && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.name === 'TypeError');
		connectionStatus.set(key, {
			status: isCorsError ? 'cors_blocked' : 'failed',
			timestamp: Date.now(),
			error: isCorsError ? null : err.message
		});
	}
	renderEndpointList(getGroups(), null, null, handleModelEdit, handleGroupEdit, handleGroupDelete, handleAddModelForGroup, handleModelDelete, handleReorderGroups, handleReorderModels, testConnection);
}

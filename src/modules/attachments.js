// ========== 附件处理辅助函数 ==========
function isTextFile(filename) {
	const textExtensions = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.scss', '.sass', '.less', '.html', '.htm', '.xml', '.yaml', '.yml', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.lua', '.r', '.vue', '.svelte'];
	const dotIndex = filename.lastIndexOf('.');
	const ext = dotIndex > 0 ? filename.toLowerCase().slice(dotIndex) : '';
	return textExtensions.includes(ext);
}

// ========== Audio recording ==========
var _mediaRecorder = null;
var _recordingChunks = [];
var _recordingMimeType = '';
var _recordingTimer = null;

// 波形可视化
var _audioCtx = null;
var _audioAnalyser = null;
var _audioDataArray = null;
var _waveAnimId = null;
var _waveBars = null;
var _barCount = 10;

function isRecording() { return _mediaRecorder && _mediaRecorder.state === 'recording'; }

function _cleanupWave() {
	if (_waveAnimId) { cancelAnimationFrame(_waveAnimId); _waveAnimId = null; }
	if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
	_audioAnalyser = null;
	_audioDataArray = null;
	if (_waveBars) {
		var parent = _waveBars[0] && _waveBars[0].parentNode;
		if (parent) parent.remove();
		_waveBars = null;
	}
}

function _startWaveLoop(btn) {
	var waveContainer = document.createElement('div');
	waveContainer.className = 'wave';
	for (var i = 0; i < _barCount; i++) {
		var bar = document.createElement('span');
		bar.className = 'bar';
		waveContainer.appendChild(bar);
	}
	btn.appendChild(waveContainer);
	_waveBars = waveContainer.querySelectorAll('.bar');

	var smoothed = new Float32Array(_barCount);

	function tick() {
		if (!_audioAnalyser) { _waveAnimId = requestAnimationFrame(tick); return; }
		_audioAnalyser.getByteFrequencyData(_audioDataArray);
		var len = Math.min(_audioDataArray.length, _barCount);
		for (var i = 0; i < len; i++) {
			var raw = _audioDataArray[i] / 255;
			// 噪声门限 + 指数平滑
			_audioDataArray[i] < 40 ? (raw = 0) : 0;
			smoothed[i] = smoothed[i] * 0.6 + raw * 0.4;
			var pct = Math.max(0, Math.min(1, smoothed[i] * 1.2));
			_waveBars[i].style.setProperty('--h', Math.round(pct * 100));
		}
		_waveAnimId = requestAnimationFrame(tick);
	}
	tick();
}

async function startRecording() {
	if (isRecording()) return;
	try {
		var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		_mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' });
			_recordingMimeType = _mediaRecorder.mimeType;
		_recordingChunks = [];
		_mediaRecorder.ondataavailable = function(e) {
			if (e.data.size > 0) _recordingChunks.push(e.data);
		};
		_mediaRecorder.onstop = function() {
			stream.getTracks().forEach(function(t) { t.stop(); });
			var mt = _recordingMimeType || 'audio/webm';
			var blob = new Blob(_recordingChunks, { type: mt });
			var ext = mt.includes('webm') ? '.webm' : '.mp4';
			var file = new File([blob], 'recording' + ext, { type: mt, lastModified: Date.now() });
			addAttachment(file, 'recording');
			renderPendingAttachments();
			_recordingChunks = [];
		};
		_mediaRecorder.start(100);

		// 初始化音频分析
		try {
			_audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			var source = _audioCtx.createMediaStreamSource(stream);
			_audioAnalyser = _audioCtx.createAnalyser();
			_audioAnalyser.fftSize = 32;
			source.connect(_audioAnalyser);
			_audioDataArray = new Uint8Array(_audioAnalyser.frequencyBinCount);
			var btn = document.querySelector('.record.btn');
			if (btn) _startWaveLoop(btn);
		} catch (e) {
			// 音频分析非致命，可视化不可用不影响录音
		}
		return true;
	} catch (err) {
		if (err.name === 'NotAllowedError') {
			alert('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问。');
		} else {
			alert('启动录音失败: ' + err.message);
		}
		return false;
	}
}

function stopRecording() {
	if (!isRecording()) return;
	_mediaRecorder.stop();
	_mediaRecorder = null;
	_cleanupWave();
}

function getMediaType(filename) {
	const dotIndex = filename.lastIndexOf('.');
	const ext = dotIndex > 0 ? filename.toLowerCase().slice(dotIndex) : '';
	const audioTypes = {
		'.mp3': 'audio/mpeg',
		'.wav': 'audio/wav',
		'.ogg': 'audio/ogg',
		'.webm': 'audio/webm',
		'.m4a': 'audio/mp4',
		'.flac': 'audio/flac',
		'.aac': 'audio/aac',
		'.wma': 'audio/x-ms-wma'
	};
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
	if (audioTypes[ext]) return audioTypes[ext];
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
		if (externalSignal.aborted) controller.abort();
		else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
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
async function addAttachment(file, source) {
	const isImage = getMediaType(file.name).startsWith('image/');
	const isText = isTextFile(file.name);
	const attachment = {
		id: generateUUID(),
		name: file.name,
		type: isImage ? 'image' : (isText ? 'file_text' : 'file'),
		file: file, // 临时存储 File 对象，用于缩略图和预览
		mediaType: getMediaType(file.name),
		previewUrl: null, // 缩略图 URL（图片用）
		source: source || null // 来源标记：'recording' | null
	};
	if (isImage || file.type.startsWith('audio/')) {
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
	row.className = 'input-row , flex items-go-x items-y-near-center';
	parent.insertBefore(row, inputEl);
	row.appendChild(icon);
	row.appendChild(inputEl);
}

function shouldSaveIsFullUrl(node, initialEffectiveValue, currentValue, changed) {
	if (!node) return !!changed || !!currentValue !== !!initialEffectiveValue;
	if (Object.prototype.hasOwnProperty.call(node, 'isFullUrl')) return true;
	if (Object.prototype.hasOwnProperty.call(node, 'directUrl')) return true;
	return !!changed || !!currentValue !== !!initialEffectiveValue;
}

function showEditGroupDialog(node, parentId, onSave) {
	var dialog = $('dialog.editing.endpoint');
	var isEdit = !!node;
	var tabContainer = $('.tab.container', dialog);
	if (!isEdit) {
		var batchRootNameInput = dialog.querySelector('input[name="batch-root-name"]');
		if (batchRootNameInput) batchRootNameInput.value = '';
		var batchFieldList = $('.field-list', dialog);
		if (batchFieldList) {
			clearBatchDragDrop(batchFieldList, true);
			while (batchFieldList.firstChild) batchFieldList.removeChild(batchFieldList.firstChild);
		}
		if (tabContainer) {
			tabContainer.querySelectorAll('input[name="dialog-tab"]').forEach(function(radio) {
				radio.checked = radio.value === 'single';
			});
		}
	}
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
	// 重置 isFullUrl 状态（dialog 复用清除）
	var _du = dialog.querySelector('.direct-url.toggle');
	var _ducb = _du ? _du.querySelector('input[type="checkbox"]') : null;
	if (_ducb) _ducb.checked = false;
	dialog.querySelector('.url-row').classList.remove('direct');
	// 清除前一次留下的继承图标和内联样式
	['url', 'apikey', 'model-id'].forEach(function(name) {
		var inp = dialog.querySelector('input[name="' + name + '"]');
		if (inp) {
			var ic = inp.parentNode.querySelector('.inherit.icon');
			if (ic) ic.remove();
			inp._inheritIconAdded = false;
			inp.style.flex = '';
		}
	});
	dialog.querySelectorAll('.input-row').forEach(function(r) {
		var inp = r.querySelector('input');
		if (inp) {
			var parent = r.parentNode;
			while (r.firstChild) parent.insertBefore(r.firstChild, r);
			r.remove();
		}
	});
	var nameInput = $("input[name=\"name\"]", dialog);
	var urlInput = $('input[name="url"]', dialog);
	var styleSel = dialog.querySelector('input[name="style"]:checked') || dialog.querySelector('input[name="style"]');
	var keyInput = $("input[name=\"apikey\"]", dialog);
	keyInput.type = 'password';  // 重置输入类型（前一次可能被 toggle 改成 text）
	var modelidInput = $('input[name="model-id"]', dialog);
	var remarkInput = $("input[name=\"remark\"]", dialog);
	var pathSuffix = $('.path-suffix', dialog);
	var isFullUrlBtn = $('.direct-url.toggle', dialog);
		var isFullUrlCheckbox = isFullUrlBtn ? isFullUrlBtn.querySelector('input[type="checkbox"]') : null;
	var urlRow = $('.url-row', dialog);
			function apiPath(style, type, modelId) {
			var paths = {
				openai: { chat: '/v1/chat/completions', embedding: '/v1/embeddings', 'image-generation': '/v1/images/generations', 'video-generation': '/v1/videos', tts: '/v1/audio/speech', reranking: '/v1/rerank', asr: '/v1/audio/transcriptions' },
				jimeng: { 'video-generation': '/v1/videos/generations' },
				claude: { chat: '/v1/messages' },
				gemini: { chat: '/v1beta/models/' + (modelId || '{modelId}') + ':streamGenerateContent?alt=sse', embedding: '/v1beta/models/' + (modelId || '{modelId}') + ':embedContent', 'image-generation': '/v1beta/models/' + (modelId || '{modelId}') + ':generateContent', 'video-generation': '/v1beta/models/' + (modelId || '{modelId}') + ':generateContent', tts: '/v1beta/models/' + (modelId || '{modelId}') + ':generateContent' },
				responses: { chat: '/v1/responses' }
			};
			var map = paths[style];
			if (map && map[type]) return map[type];
			if (map && map.chat) return map.chat;
			if (map) { var ks = Object.keys(map); if (ks.length) return map[ks[0]]; }
			return '';
		}
	var paramSection = $('.param.section', dialog);
	var paramList = $('.param-control.list', dialog);
	var typeSel = dialog.querySelector('input[name="type"]:checked') || dialog.querySelector('input[name="type"]');
	var typeHint = dialog.querySelector('input[name="type"]').closest('.field-control').querySelector('.hint');
		function setRadio(name, val, ctx) { ctx.querySelectorAll('input[name="' + name + '"]').forEach(function(r) { r.checked = r.value === val; }); }
		function getRadio(name, ctx) { var r = ctx.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
		function getEffectiveType() {
			return getRadio('type', dialog)
				|| (typeof rcfg !== 'undefined' && rcfg && rcfg.type)
				|| detectModelType(modelidInput.value.trim());
		}
		function getEffectiveStyle() {
			return getRadio('style', dialog)
				|| (typeof rcfg !== 'undefined' && rcfg && rcfg.style)
				|| 'openai';
		}
		function updatePathDisplay(styleVal) {
			// isFullUrl 态：path 被用户显式清空，不显示路径后缀
			if (isFullUrlCheckbox && isFullUrlCheckbox.checked) {
				pathSuffix.textContent = '';
				pathSuffix.style.display = 'none';
				return;
			}
			var modelId = modelidInput.value.trim();
			var typeVal = getRadio('type', dialog) || (typeof rcfg !== 'undefined' && rcfg && rcfg.type) || '';
			var path = apiPath(styleVal, typeVal, modelId);
			if (!path) {
				var inheritHint = dialog.querySelector('input[name="style"][value=""]');
				if (inheritHint && inheritHint.checked) {
					// 继承态：用 rcfg.style（实际 key，如 "openai"）而非从显示文本抠
					var inheritedStyle = (typeof rcfg !== 'undefined' && rcfg && rcfg.style) || '';
					if (inheritedStyle) {
						var inheritedType = getRadio('type', dialog) || '';
						if (!inheritedType) {
							inheritedType = (typeof rcfg !== 'undefined' && rcfg && rcfg.type) || '';
						}
						path = apiPath(inheritedStyle.toLowerCase(), inheritedType, modelId);
					}
				}
			}
			pathSuffix.textContent = path;
			pathSuffix.style.display = path ? '' : 'none';
		}
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

	var _customParamId = 0;

	function addCustomParamRow(key, value) {
		var div = doc.createElement('div');
		div.className = 'param-row , custom , flex items-go-x items-y-near-center';
		div.dataset.id = _customParamId++;
		var keyIn = doc.createElement('input');
		keyIn.name = 'custom-key-' + div.dataset.id;
		keyIn.placeholder = '参数名';
		keyIn.value = key || '';
		var valIn = doc.createElement('input');
		valIn.name = 'custom-val-' + div.dataset.id;
		valIn.placeholder = '值';
		valIn.value = value !== undefined && value !== null ? value : '';
		var rm = doc.createElement('button');
		rm.className = 'char-style icon-only btn : remove custom-param , danger , square shape';
		rm.title = '移除此参数';
		rm.tabIndex = -1;
		rm.onclick = function() { div.remove(); };
		
		div.appendChild(keyIn);
		div.appendChild(valIn);
		div.appendChild(rm);
		var addBtn = paramList.querySelector('.add-custom-param.btn');
		if (addBtn) paramList.insertBefore(div, addBtn);
		else paramList.appendChild(div);
	}

	var originalParams = node && node.params ? node.params : {};
	var existingParams = buildExistingParams(node) || {};
	var parameterDrafts = {};
	var activeParameterDraftKey = null;
	var customParamDraft = node && node.customParams
		? node.customParams.map(function(cp) { return { key: cp.key, value: cp.value }; })
		: [];
	var hasParent = false;
	var fallbackParams = {};

	function getParameterDraftKey(type, style) {
		return type + '\u0000' + style;
	}

	function snapshotParamDraft() {
		if (!paramList) return;
		var rows = paramList.querySelectorAll('.registered.param-row');
		var addButton = paramList.querySelector('.add-custom-param.btn');
		if (rows.length === 0 && !addButton) return;
		customParamDraft = [];
		paramList.querySelectorAll('.param-row.custom').forEach(function(row) {
			var inputs = row.querySelectorAll('input');
			var key = inputs[0] ? inputs[0].value : '';
			var value = inputs[1] ? inputs[1].value : '';
			customParamDraft.push({ key: key, value: value });
		});
		if (!activeParameterDraftKey) return;
		if (rows.length === 0) return;
		var draft = {};
		rows.forEach(function(row) {
			var control = row.querySelector('.own.param.control').querySelector('input, select');
			draft[row.dataset.paramKey] = {
				state: row.dataset.state,
				changed: row.dataset.changed === 'true',
				value: control ? control.value : ''
			};
		});
		parameterDrafts[activeParameterDraftKey] = draft;
	}

	function restoreParamDraft(draft) {
		if (!draft) return;
		paramList.querySelectorAll('.registered.param-row').forEach(function(row) {
			var item = draft[row.dataset.paramKey];
			if (!item) return;
			row.dataset.state = item.state;
			row.dataset.changed = item.changed ? 'true' : 'false';
			row.querySelectorAll('input[type="radio"]').forEach(function(radio) {
				radio.checked = radio.value === item.state;
			});
			var ownControl = row.querySelector('.own.param.control');
			var inherited = row.querySelector('.inherited.param.hint');
			ownControl.classList.toggle('hidden', item.state !== 'own');
			inherited.classList.toggle('hidden', item.state !== 'inherit');
			var control = ownControl.querySelector('input, select');
			if (control) control.value = item.value;
			var valueLabel = ownControl.querySelector('.param.val');
			if (valueLabel && control) valueLabel.textContent = control.value;
		});
	}

	function renderParamControls(type, style) {
		var defs = typeof getParamDefs === 'function' ? getParamDefs(type, style) : [];
		if (!paramSection || !paramList) return;
		activeParameterDraftKey = getParameterDraftKey(type, style);
		paramList.innerHTML = '';
		if (defs.length === 0) {
			paramSection.style.display = 'none';
			return;
		}
		paramSection.style.display = '';
		renderModelParamControls(paramList, defs, existingParams, fallbackParams, {
			allowInherit: hasParent,
			inheritLabel: '继承上级',
			inheritValueLabel: '当前为',
			modelLabel: '由模型决定'
		});
		restoreParamDraft(parameterDrafts[activeParameterDraftKey]);
		_customParamId = 0;
		var addBtn = doc.createElement('button');
		addBtn.type = 'button';
		addBtn.className = 'add-custom-param btn';
		addBtn.textContent = '+ 自定义参数';
		addBtn.onclick = function() { addCustomParamRow('', ''); };
		paramList.appendChild(addBtn);
		customParamDraft.forEach(function(cp) { addCustomParamRow(cp.key, cp.value); });
	}
	setValues(dialog, {
		'input[name="name"]': node ? node.name : '',
		'input[name="model-id"]': node ? node.modelId || '' : '',
		'input[name="url"]': node ? node.baseUrl || '' : '',
			// style set via setRadio below
		'input[name="apikey"]': node ? node.key || '' : '',
		'input[name="remark"]': node ? node.remark || '' : '',
	});
		setRadio('style', node ? node.style || '' : '', dialog);

	function getEditIsFullUrl(node, parentId) {
		var config = resolveNodeConfig(node ? node.id : parentId);
		return !!(config && config.isFullUrl);
	}

	var initialEffectiveIsFullUrl = getEditIsFullUrl(node, parentId);
	var isFullUrlChanged = false;

	// 加载 isFullUrl 状态
		var editIsFullUrl = initialEffectiveIsFullUrl;
		if (isFullUrlCheckbox) isFullUrlCheckbox.checked = editIsFullUrl;
		urlRow.classList.toggle('direct', editIsFullUrl);

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
		if (isEdit && _r && _r.ancestors.length > 0) {
			var nearestParent = _r.ancestors[_r.ancestors.length - 1];
			var parentConfig = resolveNodeConfig(nearestParent.id);
			fallbackParams = parentConfig && parentConfig.params ? parentConfig.params : {};
		} else if (!isEdit && parentId && rcfg && rcfg.params) {
			fallbackParams = rcfg.params;
		}
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
	renderParamControls(getEffectiveType(), getEffectiveStyle());
	// 初始路径显示（等 style 最终确定后）
	updatePathDisplay(getRadio('style', dialog) || '');

	// 名称 ↔ 模型名连续同步（用 _syncing 防止循环触发）
	var _nameUserEdited = false;
	var _typeUserEdited = false;
	var _syncing = false;
	nameInput.oninput = function() {
		if (!_syncing) _nameUserEdited = true;
	};
	function removeIcon(el) {
		var ic = el.parentNode.querySelector('.inherit.icon');
		if (ic) {
			ic.remove();
		}
		el._inheritIconAdded = false;
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
			snapshotParamDraft();
			var detected = detectModelType(this.value);
			setRadio('type', detected, dialog);
			updateTypeHint(detected);
			typeSel = dialog.querySelector('input[name="type"]:checked') || dialog.querySelector('input[name="type"]');
			renderParamControls(getEffectiveType(), getEffectiveStyle());
		}
		updatePathDisplay(getRadio('style', dialog));
	};
		function buildExistingParams(n) {
			if (!n) return null;
			var p = {};
			if (n.params) {
				for (var k in n.params) {
					if (Object.prototype.hasOwnProperty.call(n.params, k)) setOwnEnumerableDataProperty(p, k, n.params[k]);
				}
			}
			['voice', 'instruction'].forEach(function(key) {
				if (Object.prototype.hasOwnProperty.call(p, key)
					|| !Object.prototype.hasOwnProperty.call(n, key)) return;
				var value = n[key];
				if (value === '') setOwnEnumerableDataProperty(p, key, null);
				else if (value !== undefined && value !== null) setOwnEnumerableDataProperty(p, key, value);
			});
			return Object.keys(p).length > 0 ? p : null;
		}
	dialog.querySelectorAll('input[name="type"]').forEach(function(r) { r.onchange = function() { _typeUserEdited = true; typeSel = this; snapshotParamDraft(); renderParamControls(getEffectiveType(), getEffectiveStyle()); updatePathDisplay(getRadio('style', dialog)); }; });
		dialog.querySelectorAll('input[name="style"]').forEach(function(r) { r.onchange = function() { snapshotParamDraft(); renderParamControls(getEffectiveType(), getEffectiveStyle()); updatePathDisplay(getRadio('style', dialog)); }; });
	urlInput.oninput = function() { removeIcon(this); };
	keyInput.oninput = function() { removeIcon(this); };

	dialog.show();
	if (!dialog._endpointDialogNativeClose) dialog._endpointDialogNativeClose = dialog.close.bind(dialog);
	if (dialog._endpointDialogEscHandler) doc.removeEventListener('keydown', dialog._endpointDialogEscHandler);
	var escHandler = function(e) {
		if (e.key === 'Escape' && dialog.hasAttribute('open')) dialog.close();
	};
	dialog._endpointDialogEscHandler = escHandler;
	doc.addEventListener('keydown', escHandler);
	dialog.close = function() {
			var activeEscHandler = dialog._endpointDialogEscHandler;
			if (activeEscHandler) {
				doc.removeEventListener('keydown', activeEscHandler);
				dialog._endpointDialogEscHandler = null;
			}
			clearBatchDragDrop($('.field-list', dialog), true);
			dialog._endpointDialogNativeClose();
		};
	toggleCheckbox = dialog.querySelector('.toggle.apikey input');
	if (toggleCheckbox) {
		toggleCheckbox.onchange = function() {
			keyInput.type = this.checked ? 'text' : 'password';
		};
	}
	if (isFullUrlCheckbox) {
		isFullUrlCheckbox.onchange = function() {
			isFullUrlChanged = true;
			urlRow.classList.toggle('direct', this.checked);
			// 同步清空/恢复路径后缀，而非仅靠 CSS 遮挡
			if (this.checked) {
				pathSuffix.textContent = '';
				pathSuffix.style.display = 'none';
			} else {
				updatePathDisplay(getRadio('style', dialog));
			}
		};
	}
	// Enter → 切到下一个输入框
	var formFields = [nameInput, modelidInput, urlInput, keyInput, remarkInput];
	var form = dialog.querySelector('form');
	if (form) {
		form.onkeydown = function(e) {
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
		};
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
			var currentIsFullUrl = isFullUrlCheckbox ? isFullUrlCheckbox.checked : false;
			var saveData = { name: theName, style: getRadio('style', dialog), type: theType };
			if (shouldSaveIsFullUrl(node, initialEffectiveIsFullUrl, currentIsFullUrl, isFullUrlChanged)) {
				saveData.isFullUrl = currentIsFullUrl;
			}
			// 可继承字段：节点原本有值则直接保存（含清空为""）；
			// 节点原本无值则仅当用户手动输入了不同于继承值的值时才保存，否则不传以保持继承
			var theUrl = urlInput.value.trim();
			if (node && node.baseUrl || isFullUrlChanged || theUrl !== (rcfg && rcfg.baseUrl || '')) saveData.baseUrl = theUrl;
			var theKey = keyInput.value.trim();
			if (node && node.key || theKey !== (rcfg && rcfg.key || '')) saveData.key = theKey;
			if (node && node.modelId || theModelId !== (rcfg && rcfg.modelId || '')) saveData.modelId = theModelId;
			var theRemark = remarkInput.value.trim();
			if (theRemark) saveData.remark = theRemark;
			else saveData.remark = '';
			// 收集 params
			var collected = collectModelParamControls(paramList, originalParams);
			if (!collected.valid) {
				if (collected.firstInvalidControl) collected.firstInvalidControl.focus();
				return;
			}
			var params = collected.params;
			if (Object.keys(params).length > 0) saveData.params = params;
			else if (node && node.params) saveData.params = {};
			// 向后兼容：具体值同步；已有 legacy 字段切 inherit/model/空值时请求删除顶层字段
			var removeFields = [];
			['voice', 'instruction'].forEach(function(key) {
				var hasLegacyField = !!node && Object.prototype.hasOwnProperty.call(node, key);
				var row = paramList
					? Array.prototype.find.call(paramList.querySelectorAll('.registered.param-row'), function(candidate) {
						return candidate.dataset.paramKey === key;
					})
					: null;
				if (!row || row.dataset.changed !== 'true') return;
				var value = params[key];
				if (value !== undefined && value !== null && value !== '') setOwnEnumerableDataProperty(saveData, key, value);
				else if (hasLegacyField) removeFields.push(key);
			});
			if (removeFields.length > 0) saveData._removeLegacyParamFields = removeFields;
				// 收集自定义参数
				var customRows = paramList ? paramList.querySelectorAll('.param-row.custom') : [];
				if (customRows.length > 0) {
					var customArr = [];
					customRows.forEach(function(row) {
						var ki = row.querySelector('input');
						var vi = row.querySelectorAll('input')[1];
						if (ki && vi && ki.value.trim()) customArr.push({ key: ki.value.trim(), value: vi.value });
					});
					if (customArr.length > 0) saveData.customParams = customArr;
				}
			onSave(saveData);
			dialog.close();
		}
	}, dialog);
	// 批量 tab — 惰性构建字段块；编辑时同步清除新增窗口遗留处理器
	if (tabContainer) {
		tabContainer.querySelectorAll('input[name="dialog-tab"]').forEach(function(radio) {
			radio.onchange = !isEdit
				? function() {
					if (this.value === 'batch' && this.checked) {
						var list = $('.field-list', dialog);
						if (list && !list.hasChildNodes()) buildBatchFields(dialog, parentId);
					}
				}
				: null;
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
			{ value: '', text: '继承', inherit: true },
			{ value: 'openai', text: 'ChatGPT式', hint: 'OpenAI、国内主流<br>/v1/chat/completions' },
			{ value: 'jimeng', text: '即梦式', hint: '即梦/Seedance<br>/v1/videos/generations' },
			{ value: 'claude', text: 'Claude式', hint: 'Anthropic<br>/v1/messages' },
			{ value: 'gemini', text: 'Gemini式', hint: 'Google<br>/v1beta/models/……' },
			{ value: 'responses', text: 'Responses式', hint: 'OpenAI 新一代<br>/v1/responses' }
		]},
		{ key: 'type', label: '类型', options: [
			{ value: '', text: '继承', inherit: true },
			{ value: 'chat', icon: 'chat', text: '聊天' },
			{ value: 'embedding', icon: 'digits', text: '嵌入' },
			{ value: 'image-generation', icon: 'palette', text: '生图' },
			{ value: 'video-generation', icon: 'video', text: '视频' },
			{ value: 'reranking', icon: 'chart', text: '重排序' },
			{ value: 'tts', icon: 'speaker', text: '语音' },
			{ value: 'asr', icon: 'mic', text: '语音识别' }
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
					if (opt.icon && !opt.inherit) {
						label.appendChild(mk("span", "char-style icon , " + opt.icon));
						label.appendChild(doc.createTextNode(" "));
					}
					label.appendChild(doc.createTextNode(opt.text));
					if (opt.hint && !opt.inherit) {
						var hint = mk('span', 'hint');
						hint.innerHTML = opt.hint;
						label.appendChild(hint);
					}
					multiSelect.appendChild(label);
				});
				// 互斥：继承 ↔ 具体值
				multiSelect.querySelectorAll('input[value=""]').forEach(function(inheritCb) {
					inheritCb.addEventListener('change', function() {
						if (this.checked) {
							multiSelect.querySelectorAll('input:not([value=""])').forEach(function(cb) { cb.checked = false; });
						}
				});
				});
				multiSelect.querySelectorAll('input:not([value=""])').forEach(function(cb) {
					cb.addEventListener('change', function() {
						if (this.checked) {
							multiSelect.querySelectorAll('input[value=""]').forEach(function(inheritCb) { inheritCb.checked = false; });
						}
				});
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
	// 默认选中"继承"，有父节点时显示继承值
	if (parentId) {
		var rcfg = resolveNodeConfig(parentId);
		if (rcfg) {
			['style', 'type'].forEach(function(key) {
				var block = list.querySelector('.batch-field[data-field="' + key + '"]');
				if (!block) return;
				var inheritCb = block.querySelector('input[value=""]');
				if (inheritCb) inheritCb.checked = true;
				if (rcfg[key]) {
					var optEl = block.querySelector('input[value="' + rcfg[key] + '"]');
					var inheritLabel = inheritCb ? inheritCb.parentElement : null;
					if (inheritLabel) {
						var optName = rcfg[key];
						if (optEl) {
							var optLabel = optEl.parentElement;
							for (var _c = 0; _c < optLabel.childNodes.length; _c++) {
								if (optLabel.childNodes[_c].nodeType === 3 && optLabel.childNodes[_c].textContent.trim()) {
									optName = optLabel.childNodes[_c].textContent.trim();
									break;
								}
							}
						}
						var inheritingVal = inheritLabel.querySelector('.inheriting-val');
						if (!inheritingVal) {
							inheritingVal = doc.createElement('span');
							inheritingVal.className = 'inheriting-val';
							inheritLabel.appendChild(inheritingVal);
						}
						inheritingVal.textContent = '（' + optName + '）';
					}
				}
			});
		}
	} else {
		// 最顶级节点：默认选中"继承"
		['style', 'type'].forEach(function(key) {
			var block = list.querySelector('.batch-field[data-field="' + key + '"]');
			if (block) {
				var inheritCb = block.querySelector('input[value=""]');
				if (inheritCb) inheritCb.checked = true;
			}
		});
	}
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
function clearBatchDragDrop(list, clearHandlers) {
	if (!list) return;
	list._batchDragSrc = null;
	list.querySelectorAll('.dragging').forEach(function(el) { el.classList.remove('dragging'); });
	list.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
	if (!clearHandlers) return;
	list.ondragstart = null;
	list.ondragover = null;
	list.ondrop = null;
	list.ondragend = null;
}
function setupBatchDragDrop(list) {
	clearBatchDragDrop(list, false);
	list.ondragstart = function(e) {
		var block = e.target.closest('.batch-field');
		if (!block || !e.target.closest('.handle')) {
			e.preventDefault();
			clearBatchDragDrop(list, false);
			return;
		}
		list._batchDragSrc = block;
		block.classList.add('dragging');
		e.dataTransfer.effectAllowed = 'move';
	};
	list.ondragover = function(e) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		var block = e.target.closest('.batch-field');
		if (!block || block === list._batchDragSrc) return;
		list.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
		block.classList.add('drag-over');
	};
	list.ondrop = function(e) {
		e.preventDefault();
		var dragSrc = list._batchDragSrc;
		var target = e.target.closest('.batch-field');
		if (dragSrc && target && target !== dragSrc) {
			var rect = target.getBoundingClientRect();
			var midY = rect.top + rect.height / 2;
			if (e.clientY < midY) list.insertBefore(dragSrc, target);
			else list.insertBefore(dragSrc, target.nextSibling);
		}
		clearBatchDragDrop(list, false);
	};
	list.ondragend = function() {
		clearBatchDragDrop(list, false);
	};
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
			// 多选按钮组模式（style/type），跳过空值（"继承"标记）
			multiSelect.querySelectorAll('input:checked').forEach(function(cb) {
				if (cb.value) values.push(cb.value);
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
const connectionTestInFlight = new Map(); // nodeId -> Promise
const connectionTestGenerations = new Map(); // nodeId -> generation

function invalidateConnectionTest(nodeId) {
	connectionTestGenerations.set(nodeId, (connectionTestGenerations.get(nodeId) || 0) + 1);
}

function setConnectionTestResult(key, generation, result) {
	if ((connectionTestGenerations.get(key) || 0) !== generation) return;
	connectionStatus.set(key, result);
	updateEndpointTestUI(key);
}

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

function testConnection(nodeId) {
	var key = nodeId;
	var inFlight = connectionTestInFlight.get(key);
	if (inFlight) return inFlight;

	var generation = connectionTestGenerations.get(key) || 0;
	var task = (async function() {
		try {
			var node = getNode(nodeId);
			if (!node) return;
			var rcfg = resolveNodeConfig(nodeId);
			if (!isEndpointTestable(nodeId)) return;
			var modelName = rcfg.modelId;
			var provider = providers[rcfg.style || 'openai'];
			setConnectionTestResult(key, generation, { status: 'testing', timestamp: null });
			if (!provider) throw new Error('未找到接口格式: ' + (rcfg.style || 'openai'));
			var testFn = null;
			if (rcfg.type === 'embedding' || rcfg.type === 'embed')
				testFn = provider.testEmbeddingConfig;
			else if (rcfg.type === 'tts')
				testFn = provider.testTTSConfig;
			else if (rcfg.type === 'asr')
				testFn = provider.testASRConfig;
			else if (rcfg.type === 'chat')
				testFn = provider.testConfig;
			if (!testFn) throw new Error('该接口格式不支持连接测试');
			var tcfg = testFn.call(provider, rcfg.baseUrl, rcfg.key, modelName);
			if (rcfg.isFullUrl) tcfg.url = rcfg.baseUrl.replace(/\/+$/, '');
			// Workspace param override (test connection)
			var ovr2 = typeof defaultSelectedEndpointParams !== 'undefined'
				? readOwnEndpointParams(defaultSelectedEndpointParams, nodeId)
				: null;
			if (ovr2) {
				rcfg.params = rcfg.params || {};
				for (var sk in ovr2) { if (Object.prototype.hasOwnProperty.call(ovr2, sk) && sk !== '_custom') setOwnEnumerableDataProperty(rcfg.params, sk, ovr2[sk]); }
				if (ovr2._custom && ovr2._custom.length) {
					ovr2._custom.forEach(function(cp) { if (cp && cp.key && cp.key.trim()) setOwnEnumerableDataProperty(rcfg.params, cp.key.trim(), cp.value); });
				}
			}
			mergeParams(tcfg.body, rcfg.params, rcfg.style);
			var fetchOpts = {
				method: 'POST',
				headers: tcfg.headers,
			};
			if (tcfg.body instanceof FormData) {
				fetchOpts.body = tcfg.body;
			} else {
				fetchOpts.body = JSON.stringify(tcfg.body);
			}
			var res = await fetchWithTimeout(tcfg.url, fetchOpts, 30000);
			if (res && res.ok) {
				// 检测 HTTP 200 但返回了 HTML 错误页面的情况
				var ct = (res.headers.get('content-type') || '');
				if (ct.includes('text/html')) {
					var errorBody = await res.text().catch(function() { return ''; });
					var errorMsg = '返回了HTML页面（可能为错误页面）';
					var m = errorBody.match(/<title>([^<]+)<\/title>/i);
					if (m) errorMsg = m[1];
					else if (errorBody && errorBody.length < 100) errorMsg = errorBody;
					setConnectionTestResult(key, generation, { status: 'failed', timestamp: Date.now(), error: errorMsg });
				} else if (ct.includes('application/json') || ct.includes('text/event-stream')) {
					// 解析 JSON 响应体，检查 API 层错误（有些代理返回 200 + {"error":{...}}）
					try {
						var successBody = await res.text();
						var successJson = JSON.parse(successBody);
						if (successJson.error) {
							var errMsg = successJson.error.message || successJson.error.code || JSON.stringify(successJson.error);
							setConnectionTestResult(key, generation, { status: 'failed', timestamp: Date.now(), error: errMsg });
						} else {
							setConnectionTestResult(key, generation, { status: 'connected', timestamp: Date.now() });
						}
					} catch(e) {
						setConnectionTestResult(key, generation, { status: 'connected', timestamp: Date.now() });
					}
				} else {
					setConnectionTestResult(key, generation, { status: 'connected', timestamp: Date.now() });
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
				setConnectionTestResult(key, generation, { status: 'failed', timestamp: Date.now(), error: errorMsg });
			}
		} catch (err) {
			var isCorsError = err instanceof TypeError && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.name === 'TypeError');
			setConnectionTestResult(key, generation, {
				status: isCorsError ? 'cors_blocked' : 'failed',
				timestamp: Date.now(),
				error: isCorsError ? null : err.message
			});
		}
	})();
	var promise = task.finally(function() {
		if (connectionTestInFlight.get(key) === promise) {
			connectionTestInFlight.delete(key);
		}
	});
	connectionTestInFlight.set(key, promise);
	return promise;
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
	ids.forEach(function(id) {
		invalidateConnectionTest(id);
		connectionStatus.delete(id);
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
		var typeClass = att.type;
		if (att.file && att.file.type && att.file.type.indexOf('audio/') === 0) typeClass = 'audio';
		else if (typeClass !== 'image') typeClass = 'file';
		const el = mk('div', `one attachment ${typeClass} , flex items-go-x`);
		el.dataset.id = att.id;
		const thumb = mk('div', 'thumb');
		if (att.type === 'image' && att.previewUrl) {
			thumb.style.backgroundImage = `url(${att.previewUrl})`;
			thumb.style.backgroundSize = 'cover';
			thumb.style.backgroundPosition = 'center';
		} else if (typeClass === 'audio') {
			thumb.classList.add('icon', 'char-style', att.source === 'recording' ? 'mic' : 'audio');
		} else {
			thumb.classList.add('icon', 'char-style', 'file');
		}
		// hover显示名字
		thumb.onmouseenter = () => showAttachmentTooltip(att.name, thumb);
		thumb.onmouseleave = () => hideAttachmentTooltip();
		// 删除按钮
		const remove = mk('button', 'icon remove btn , char-style');
		remove.onclick = (e) => {
			e.stopPropagation();
			removeAttachment(att.id);
			renderPendingAttachments();
		};
		el.appendChild(thumb);
		el.appendChild(remove);
		// 点击预览
		el.onclick = () => showAttachmentPreview(att);
		row.appendChild(el);
	});
}

function showAttachmentPreview(att) {
	if (att.type === 'image' && att.previewUrl) {
		// 图片预览弹窗
		var overlay = fromTemplate('image-preview', '.preview-overlay');
		var img = mk('img');
		img.src = att.previewUrl;
		overlay.onclick = function() { overlay.remove(); };
		overlay.appendChild(img);
		document.body.appendChild(overlay);
	} else if (att.file && att.file.type && att.file.type.indexOf('audio/') === 0) {
		// 音频预览弹窗
		var overlay = fromTemplate('audio-preview', '.preview-overlay');
		var audio = overlay.querySelector('audio');
		audio.src = att.previewUrl || URL.createObjectURL(att.file);
		var dlBtn = overlay.querySelector('.btn');
		dlBtn.href = att.previewUrl || URL.createObjectURL(att.file);
		dlBtn.download = att.name || 'recording.webm';
		dlBtn.onclick = function(e) { e.stopPropagation(); };
		overlay.onclick = function() {
			overlay.remove();
			if (!att.previewUrl) URL.revokeObjectURL(audio.src);
		};
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
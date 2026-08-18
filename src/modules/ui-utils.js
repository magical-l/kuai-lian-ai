// ========== UI Functions ==========
// .chat-input-area 的最小高度，作为布局约束的单一数据源
// 输入区是 flex:0 0 auto（高度=内容，不撑满不收缩）。拖拽分隔条 clamp 时，
// 输入区至少需要内容所需高度，否则发送按钮行会被挤出视口。
// 实际下限 = max(CSS minHeight, 内容所需高度 = scrollHeight)。
// 不需要减 textarea 撑满部分——输入区不再 flex:1 撑满，textarea 高度固定（3 行自然高）。
function stickyMinHeight() {
	const sb = $('.chat-input-area');
	if (!sb) return 126;
	return Math.max(parseInt(getComputedStyle(sb).minHeight) || 160, sb.scrollHeight);
}

function initDividers() {
	// 水平分隔线
	const dividerHorizontal = $('.divider.go-x');
	const chatMsg = $('.msg.list');
	const mainContent = $('.main-content');
	const chatHeader = $('.toolbar');
	const savedLeftWidth = localStorage.getItem('sidebar-left-width');
	const savedRightWidth = localStorage.getItem('sidebar-right-width');
	if (savedLeftWidth) { const el = $("aside.endpoint.list:not(.divider)"); el.style.width = savedLeftWidth; el.style.flex = "none"; }
	if (savedRightWidth) { const el = $("aside.session.list:not(.divider)"); el.style.width = savedRightWidth; el.style.flex = "none"; }
	localStorage.removeItem('chat-messages-flex');
	const savedMessagesHeight = localStorage.getItem('chat-messages-height');
	if (savedMessagesHeight) {
		const maxH = mainContent.offsetHeight - chatHeader.offsetHeight - stickyMinHeight();
		const clamped = Math.max(50, Math.min(parseInt(savedMessagesHeight), maxH));
		chatMsg.style.height = clamped + 'px';
		chatMsg.style.flex = '0 0 auto';
	}
	let isDragging = false;
	let curDiv = null;
	let startX = 0;
	let startWidth = 0;
	let startY = 0;
	let startMessagesHeight = 0;
	let startMainHeight = 0;

	function startDragHorizontal(e) {
		const divider = e.target;
		const isLeft = divider.classList.contains('left');
		const sidebar = isLeft ? $('aside.endpoint.list:not(.divider)') : $('aside.session.list:not(.divider)');
		isDragging = true;
		curDiv = {
			sidebar,
			isLeft,
			storageKey: isLeft ? 'sidebar-left-width' : 'sidebar-right-width',
			type: 'horizontal'
		};
		startX = e.clientX;
		startWidth = sidebar.offsetWidth;
		doc.body.style.cursor = 'col-resize';
		doc.body.style.userSelect = 'none';
	}

	function startDragVertical(e) {
		isDragging = true;
		curDiv = {
			divider: dividerHorizontal,
			type: 'vertical'
		};
		startY = e.clientY;
		startMessagesHeight = chatMsg.offsetHeight;
		startMainHeight = mainContent.offsetHeight - chatHeader.offsetHeight;
		doc.body.style.cursor = 'row-resize';
		doc.body.style.userSelect = 'none';
	}

	function doDrag(e) {
		if (!isDragging || !curDiv) return;
		if (curDiv.type === 'vertical') {
			const dy = e.clientY - startY;
			const newHeight = startMessagesHeight + dy;
			const minMessages = 100;
			const maxMessages = startMainHeight - stickyMinHeight();
			const clamped = Math.max(minMessages, Math.min(maxMessages, newHeight));
			chatMsg.style.height = clamped + 'px';
			chatMsg.style.flex = '0 0 auto';
		} else {
			const dx = e.clientX - startX;
			const newWidth = curDiv.isLeft ? startWidth + dx : startWidth - dx;
			const mainRow = $('.main-row');
			if (!mainRow) return;
			const containerWidth = mainRow.offsetWidth;
			const minWidth = 180;
			const maxWidth = containerWidth * 0.45;
			const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
			curDiv.sidebar.style.width = clampedWidth + 'px';
				curDiv.sidebar.style.flex = 'none';
		}
	}

	function stopDrag() {
		if (isDragging && curDiv) {
			if (curDiv.type === 'vertical') {
				localStorage.setItem('chat-messages-height', chatMsg.style.height);
			} else {
				localStorage.setItem(curDiv.storageKey, curDiv.sidebar.style.width);
			}
			isDragging = false;
			curDiv = null;
			doc.body.style.cursor = '';
			doc.body.style.userSelect = '';
		}
	}
	const toggleCheckbox = document.querySelector('.toggle.sidebar.near-right input');
	if (toggleCheckbox) {
		toggleCheckbox.checked = localStorage.getItem('sidebar-right-hidden') === 'true';
		toggleCheckbox.addEventListener('change', function() {
			localStorage.setItem('sidebar-right-hidden', this.checked);
		});
	}
	$$('.divider.go-y').forEach(div => {
		div.on('mousedown', startDragHorizontal);
	});
	if (dividerHorizontal) {
		dividerHorizontal.on('mousedown', startDragVertical);
	}
	doc.on('mousemove', doDrag);
	doc.on('mouseup', stopDrag);
}
// 视口变化时重新 clamp 拖拽高度，防止 F12 等场景下输入区被挤出
function clampSavedHeight() {
	const savedH = localStorage.getItem('chat-messages-height');
	if (!savedH) return;
	const cm = $('.msg.list');
	const mc = $('.main-content');
	const ch = $('.toolbar');
	if (!cm || !mc || !ch) return;
	const maxH = mc.offsetHeight - ch.offsetHeight - stickyMinHeight();
	cm.style.height = Math.max(50, Math.min(parseInt(savedH), maxH)) + 'px';
	cm.style.flex = '0 0 auto';
}
window.addEventListener('resize', () => {
	clampSavedHeight();
	syncSelectedAreaLimit();
});
// 输入区内容增高（选中/移除端点、加附件）时，重新收紧被拖拽固定的消息区高度，
// 防止输入区向上撑时超出视口、盖住消息区底部的 streaming-hint。
// 仅对拖拽后固定的 msg.list（flex:0 0 auto）生效；未拖拽时 flex:1 由布局自动伸缩。
function clampMessagesHeight() {
	const cm = $('.msg.list');
	if (!cm || getComputedStyle(cm).flex !== '0 0 auto') return;
	const mc = $('.main-content');
	const ch = $('.toolbar');
	if (!mc || !ch) return;
	const maxH = mc.offsetHeight - ch.offsetHeight - stickyMinHeight();
	const cur = parseInt(cm.style.height) || 0;
	if (cur > maxH) {
		cm.style.height = Math.max(50, maxH) + 'px';
	}
}
// 已选区（.selected.endpoint.list）向上撑到极限：消息区压缩到仅容纳 streaming-hint（50px）后，
// 剩余高度全给已选区。动态设置已选区 max-height = 可用高度 - 输入区其他部分（textarea+menu+divider）。
// 视口 resize / 输入区内容变化时同步，使已选区持续向上撑，只有真正放不下才滚动。
function syncSelectedAreaLimit() {
	const ul = $('.chat-input-area .selected.endpoint.list');
	const area = $('.chat-input-area');
	const mc = $('.main-content');
	const toolbar = $('.toolbar');
	if (!ul || !area || !mc || !toolbar) return;
	const msgMin = 50; // 消息区最小高度（仅容纳 streaming-hint）
	const otherHeight = Math.max(0, area.offsetHeight - ul.offsetHeight); // 输入区非已选区部分
	const maxUl = mc.offsetHeight - toolbar.offsetHeight - msgMin - otherHeight;
	ul.style.maxHeight = Math.max(100, maxUl) + 'px';
}
// ========== Scroll Navigation ==========
function scrollToBottom() {
	const el = $('.msg.list');
	if (el) el.scrollTop = el.scrollHeight;
}

function handleScrollTop() {
	const container = $('.msg.list');
	if (container) container.scrollTo({ top: 0, behavior: 'smooth' });
}
function handleScrollBottom() {
	const container = $('.msg.list');
	if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}
function initScrollNav() {
}
// sticky 区高度变化时，同步更新消息区 scroll-padding-bottom，防止最后一条消息被遮挡
function syncScrollPadding() {
	const sticky = $('.chat-input-area');
	const msg = $('.msg.list');
	if (sticky && msg) msg.style.scrollPaddingBottom = sticky.offsetHeight + 'px';
}
window.addEventListener('resize', syncScrollPadding);
// 在 init 中初始化 Observer（DOM ready 后）
function initScrollPaddingObserver() {
	const sticky = $('.chat-input-area');
	if (!sticky) return;
	syncScrollPadding();
	syncSelectedAreaLimit();
	new ResizeObserver(() => {
		syncScrollPadding();
		clampMessagesHeight();
		syncSelectedAreaLimit();
	}).observe(sticky);
}
// ========== Model Parameter Decision Controls ==========
function createModelParamValueControl(def, value, onValueChange) {
	const control = doc.createElement('span');
	function markChanged() {
		if (typeof onValueChange === 'function') onValueChange();
	}
	if (def.type === 'range') {
		const input = doc.createElement('input');
		input.type = 'range';
		input.name = 'param-' + def.key;
		if (def.min !== undefined) input.min = def.min;
		if (def.max !== undefined) input.max = def.max;
		if (def.step !== undefined) input.step = def.step;
		input.value = value;
		const valueLabel = doc.createElement('span');
		valueLabel.className = 'param val';
		valueLabel.textContent = input.value;
		input.addEventListener('input', function () {
			valueLabel.textContent = this.value;
			markChanged();
		});
		input.addEventListener('change', markChanged);
		control.appendChild(input);
		control.appendChild(valueLabel);
	} else if (def.type === 'integer') {
		const input = doc.createElement('input');
		input.type = 'number';
		input.name = 'param-' + def.key;
		if (def.min !== undefined) input.min = def.min;
		if (def.max !== undefined) input.max = def.max;
		if (def.step !== undefined) input.step = def.step;
		input.value = value;
		input.addEventListener('input', markChanged);
		input.addEventListener('change', markChanged);
		control.appendChild(input);
	} else if (def.type === 'select') {
		const select = doc.createElement('select');
		select.name = 'param-' + def.key;
		(def.options || []).forEach(function (option) {
			const optionEl = doc.createElement('option');
			optionEl.value = option;
			optionEl.textContent = option;
			if (option === value) optionEl.selected = true;
			select.appendChild(optionEl);
		});
		select.value = value;
		select.addEventListener('change', markChanged);
		control.appendChild(select);
	} else {
		const input = doc.createElement('input');
		input.type = 'text';
		input.name = 'param-' + def.key;
		if (def.placeholder) input.placeholder = def.placeholder;
		input.value = value;
		input.addEventListener('input', markChanged);
		input.addEventListener('change', markChanged);
		control.appendChild(input);
	}
	return control;
}
function renderModelParamControls(container, definitions, ownParams, fallbackParams, options) {
	if (!container) return;
	const config = options || {};
	const allowInherit = config.allowInherit !== false;
	const inheritLabel = config.inheritLabel || '继承上级';
	const inheritValueLabel = config.inheritValueLabel || '当前为';
	const modelLabel = config.modelLabel || '由模型决定';
	const params = ownParams || {};
	const fallback = fallbackParams || {};
	container.innerHTML = '';
	(definitions || []).forEach(function (def) {
		const row = fromTemplate('model-param-row', '.registered.param-row');
		row.dataset.paramKey = def.key;
		row.dataset.originalState = Object.prototype.hasOwnProperty.call(params, def.key) ? params[def.key] === null ? 'model' : 'own' : 'absent';
		row.dataset.changed = 'false';
		row._modelParamDefinition = def;
		const hasOwnValue = Object.prototype.hasOwnProperty.call(params, def.key);
		const sourceValue = hasOwnValue ? params[def.key] : undefined;
		const state = hasOwnValue ? sourceValue === null ? 'model' : 'own' : allowInherit ? 'inherit' : 'model';
		row.querySelector('.field-label').textContent = def.label + '：';
		const ownControl = row.querySelector('.own.param.control');
		const initialValue = sourceValue !== undefined && sourceValue !== null ? sourceValue : Object.prototype.hasOwnProperty.call(def, 'default') ? def.default : '';
		ownControl.appendChild(createModelParamValueControl(def, initialValue, function () {
			row.dataset.changed = 'true';
		}));
		const inherited = row.querySelector('.inherited.param.hint');
		const hasFallbackValue = Object.prototype.hasOwnProperty.call(fallback, def.key) && fallback[def.key] !== undefined && fallback[def.key] !== null && fallback[def.key] !== '';
		inherited.textContent = hasFallbackValue ? inheritValueLabel + ' ' + fallback[def.key] : '上级未设置，将由模型决定';
		const radios = Array.from(row.querySelectorAll('input[type="radio"]'));
		const inheritRadio = radios.find(function (radio) {
			return radio.value === 'inherit';
		});
		if (inheritRadio) {
			inheritRadio.parentElement.querySelector('.text').textContent = inheritLabel;
			if (!allowInherit) inheritRadio.parentElement.parentElement.removeChild(inheritRadio.parentElement);
		}
		const modelRadio = radios.find(function (radio) {
			return radio.value === 'model';
		});
		if (modelRadio) modelRadio.parentElement.querySelector('.text').textContent = modelLabel;
		const availableRadios = Array.from(row.querySelectorAll('input[type="radio"]'));
		availableRadios.forEach(function (radio) {
			radio.name = 'param-decision-' + def.key;
		});
		function applyState(nextState, changed) {
			if (!allowInherit && nextState === 'inherit') nextState = 'model';
			row.dataset.state = nextState;
			if (changed) row.dataset.changed = 'true';
			availableRadios.forEach(function (radio) {
				radio.checked = radio.value === nextState;
			});
			ownControl.classList.toggle('hidden', nextState !== 'own');
			inherited.classList.toggle('hidden', nextState !== 'inherit');
			row.querySelector('.validation.error').textContent = '';
		}
		availableRadios.forEach(function (radio) {
			function decide() {
				applyState(radio.value, true);
			}
			radio.addEventListener('click', decide);
			radio.addEventListener('change', decide);
		});
		applyState(state, false);
		container.appendChild(row);
	});
}
function modelParamNumberError(def) {
	if (def.type === 'integer') {
		if (def.min !== undefined && def.max !== undefined) return '请输入 ' + def.min + '～' + def.max + ' 之间的整数';
		if (def.min !== undefined) return '请输入不小于 ' + def.min + ' 的整数';
		if (def.max !== undefined) return '请输入不大于 ' + def.max + ' 的整数';
		return '请输入整数';
	}
	if (def.min !== undefined && def.max !== undefined) return '请输入 ' + def.min + '～' + def.max + ' 之间的数值';
	if (def.min !== undefined) return '请输入不小于 ' + def.min + ' 的数值';
	if (def.max !== undefined) return '请输入不大于 ' + def.max + ' 的数值';
	return '请输入数值';
}
function isValidModelParamNumber(value, def) {
	if (!Number.isFinite(value)) return false;
	if (def.min !== undefined && value < def.min) return false;
	if (def.max !== undefined && value > def.max) return false;
	if (def.type === 'integer' && !Number.isInteger(value)) return false;
	if (def.step !== undefined) {
		const base = def.min !== undefined ? def.min : 0;
		const steps = (value - base) / def.step;
		if (Math.abs(steps - Math.round(steps)) > 1e-9) return false;
	}
	return true;
}
function collectModelParamControls(container, originalParams) {
	const params = JSON.parse(JSON.stringify(originalParams || {}));
	let valid = true;
	let firstInvalidControl = null;
	if (!container) return {
		valid,
		params,
		firstInvalidControl
	};
	container.querySelectorAll('.registered.param-row').forEach(function (row) {
		if (row.dataset.changed !== 'true') return;
		const key = row.dataset.paramKey;
		const def = row._modelParamDefinition;
		const error = row.querySelector('.validation.error');
		error.textContent = '';
		if (row.dataset.state === 'inherit') {
			delete params[key];
			return;
		}
		if (row.dataset.state === 'model') {
			Object.defineProperty(params, key, {
				value: null,
				writable: true,
				enumerable: true,
				configurable: true
			});
			return;
		}
		const control = row.querySelector('.own.param.control').querySelector('input, select');
		const rawValue = control ? control.value : '';
		if (rawValue === '') {
			if (def.nullable === true) {
				Object.defineProperty(params, key, {
					value: '',
					writable: true,
					enumerable: true,
					configurable: true
				});
				return;
			}
			valid = false;
			error.textContent = '请填写' + def.label;
			if (!firstInvalidControl) firstInvalidControl = control;
			return;
		}
		let value = rawValue;
		if (def.type === 'range' || def.type === 'integer') {
			value = Number(rawValue);
			if (def.type === 'range' && rawValue !== String(value)) {
				valid = false;
				error.textContent = modelParamNumberError(def);
				if (!firstInvalidControl) firstInvalidControl = control;
				return;
			}
			if (!isValidModelParamNumber(value, def)) {
				valid = false;
				error.textContent = modelParamNumberError(def);
				if (!firstInvalidControl) firstInvalidControl = control;
				return;
			}
		} else if (def.type === 'select' && (!Array.isArray(def.options) || !def.options.includes(value))) {
			valid = false;
			error.textContent = '请选择' + def.label;
			if (!firstInvalidControl) firstInvalidControl = control;
			return;
		}
		Object.defineProperty(params, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true
		});
	});
	return {
		valid,
		params: valid ? params : null,
		firstInvalidControl
	};
}

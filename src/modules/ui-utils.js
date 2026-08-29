// ========== UI Functions ==========
function initDividers() {
	const dividerHorizontal = $('.divider.go-x');
	const chatInput = $('#chat-input');
	const savedLeftWidth = localStorage.getItem('sidebar-left-width');
	const savedRightWidth = localStorage.getItem('sidebar-right-width');
	if (savedLeftWidth) {
		const el = $('aside.endpoint.list:not(.divider)');
		el.style.width = savedLeftWidth;
		el.style.flex = 'none';
	}
	if (savedRightWidth) {
		const el = $('aside.session.list:not(.divider)');
		el.style.width = savedRightWidth;
		el.style.flex = 'none';
	}
	localStorage.removeItem('chat-messages-flex');
	localStorage.removeItem('chat-messages-height');
	clampInputHeight();
	let isDragging = false;
	let curDiv = null;
	let startX = 0;
	let startWidth = 0;
	let startY = 0;
	let startInputHeight = 0;

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
		if (!chatInput) return;
		isDragging = true;
		curDiv = {
			divider: dividerHorizontal,
			type: 'vertical'
		};
		startY = e.clientY;
		startInputHeight = chatInput.offsetHeight;
		doc.body.style.cursor = 'row-resize';
		doc.body.style.userSelect = 'none';
	}

	function doDrag(e) {
		if (!isDragging || !curDiv) return;
		if (curDiv.type === 'vertical') {
			const dy = e.clientY - startY;
			const bounds = inputHeightBounds();
			const newHeight = startInputHeight - dy;
			const clamped = Math.max(bounds.min, Math.min(bounds.max, newHeight));
			chatInput.style.height = clamped + 'px';
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
				localStorage.setItem('chat-input-height', chatInput.style.height);
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
// 视口变化时重新 clamp 输入框高度，防止 F12 等场景下发送行被挤出
function inputHeightBounds() {
	const input = $('#chat-input');
	if (!input) return { min: 56, max: 56 };
	const area = $('.chat-input-area');
	const mainContent = $('.main-content');
	const chatHeader = $('.toolbar');
	const min = parseInt(getComputedStyle(input).minHeight) || 56;
	if (!area || !mainContent || !chatHeader) return { min, max: min };
	const otherInputAreaHeight = Math.max(0, area.offsetHeight - input.offsetHeight);
	const max = Math.max(min, mainContent.offsetHeight - chatHeader.offsetHeight - 50 - otherInputAreaHeight);
	return { min, max };
}

function clampInputHeight() {
	const savedHeight = localStorage.getItem('chat-input-height');
	const input = $('#chat-input');
	if (!savedHeight || !input) return;
	const bounds = inputHeightBounds();
	const requested = parseInt(savedHeight);
	const clamped = Math.max(bounds.min, Math.min(bounds.max, Number.isFinite(requested) ? requested : bounds.min));
	input.style.height = clamped + 'px';
}
window.addEventListener('resize', () => {
	clampInputHeight();
	syncSelectedAreaLimit();
});
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
		clampInputHeight();
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

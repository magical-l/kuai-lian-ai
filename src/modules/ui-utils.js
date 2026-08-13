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

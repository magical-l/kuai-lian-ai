// ========== UI Functions ==========
// .sticky-bottom 的最小高度，作为布局约束的单一数据源
// 用 CSS minHeight，scrollHeight 在 flex:1 子元素被撑满时不正确
function stickyMinHeight() {
	const sb = $('.sticky-bottom');
	return sb ? parseInt(getComputedStyle(sb).minHeight) || 126 : 126;
}

function initDividers() {
	// 水平分隔线
	const dividerHorizontal = $('.divider.row');
	const chatMsg = $('#chat-messages');
	const mainContent = $('#main-content');
	const chatHeader = $('#chat-header');
	const savedLeftWidth = localStorage.getItem('sidebar-left-width');
	const savedRightWidth = localStorage.getItem('sidebar-right-width');
	if (savedLeftWidth) $('aside.left:not(.divider)').style.width = savedLeftWidth;
	if (savedRightWidth) $('aside.right:not(.divider)').style.width = savedRightWidth;
	localStorage.removeItem('chat-messages-flex');
	const savedMessagesHeight = localStorage.getItem('chat-messages-height');
	if (savedMessagesHeight) {
		const maxH = mainContent.offsetHeight - chatHeader.offsetHeight - stickyMinHeight();
		const clamped = Math.max(100, Math.min(parseInt(savedMessagesHeight), maxH));
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
		const sidebar = isLeft ? $('aside.left:not(.divider)') : $('aside.right:not(.divider)');
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
			const mainRow = $('#main-row');
			if (!mainRow) return;
			const containerWidth = mainRow.offsetWidth;
			const minWidth = 180;
			const maxWidth = containerWidth * 0.45;
			const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
			curDiv.sidebar.style.width = clampedWidth + 'px';
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
	const sidebarRight = $('aside.right:not(.divider)');
	const dividerRight = $('.divider.column.control.sidebar.right');
	const btnToggleSidebar = $('#btn-toggle-sidebar');
	const toggleIconRightPanel = $('#sidebar-toggle-right-panel');

	function updateSidebarToggleIcon(isHidden) {
		if (toggleIconRightPanel) {
			toggleIconRightPanel.setAttribute('fill', isHidden ? 'none' : 'currentColor');
		}
	}
	if (btnToggleSidebar && sidebarRight && dividerRight) {
		const savedHidden = localStorage.getItem('sidebar-right-hidden') === 'true';
		if (savedHidden) {
			sidebarRight.classList.add('hidden');
			dividerRight.classList.add('hidden');
		}
		updateSidebarToggleIcon(savedHidden);
		btnToggleSidebar.on('click', () => {
			const isHidden = sidebarRight.classList.toggle('hidden');
			dividerRight.classList.toggle('hidden', isHidden);
			localStorage.setItem('sidebar-right-hidden', isHidden);
			updateSidebarToggleIcon(isHidden);
		});
	}
	$$('.divider.column.control').forEach(div => {
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
	const cm = $('#chat-messages');
	const mc = $('#main-content');
	const ch = $('#chat-header');
	if (!cm || !mc || !ch) return;
	const maxH = mc.offsetHeight - ch.offsetHeight - stickyMinHeight();
	cm.style.height = Math.max(100, Math.min(parseInt(savedH), maxH)) + 'px';
	cm.style.flex = '0 0 auto';
}
window.addEventListener('resize', clampSavedHeight);
// ========== Scroll Navigation ==========
function scrollToBottom() {
	const el = $('#chat-messages');
	if (el) el.scrollTop = el.scrollHeight;
}

function initScrollNav() {
	const btnScrollTop = $('#btn-scroll-top');
	const btnScrollBottom = $('#btn-scroll-bottom');
	const navButtons = $('#scroll-nav-buttons');
	const scrollContainer = $('#chat-messages');
	if (!btnScrollTop || !btnScrollBottom || !navButtons || !scrollContainer) return;

	function checkScrollable() {
		const hasScroll = scrollContainer.scrollHeight > scrollContainer.clientHeight + 20;
		navButtons.classList.toggle('visible', hasScroll);
	}
	btnScrollTop.onclick = () => {
		scrollContainer.scrollTo({
			top: 0,
			behavior: 'smooth'
		});
	};
	btnScrollBottom.onclick = () => {
		scrollContainer.scrollTo({
			top: scrollContainer.scrollHeight,
			behavior: 'smooth'
		});
	};
	scrollContainer.on('scroll', checkScrollable);
	const observer = new MutationObserver(checkScrollable);
	observer.observe(scrollContainer, {
		childList: true,
		subtree: true
	});
	checkScrollable();
}
// sticky 区高度变化时，同步更新消息区 scroll-padding-bottom，防止最后一条消息被遮挡
function syncScrollPadding() {
	const sticky = $('.sticky-bottom');
	const msg = $('#chat-messages');
	if (sticky && msg) msg.style.scrollPaddingBottom = sticky.offsetHeight + 'px';
}
window.addEventListener('resize', syncScrollPadding);
// 在 init 中初始化 Observer（DOM ready 后）
function initScrollPaddingObserver() {
	const sticky = $('.sticky-bottom');
	if (!sticky) return;
	syncScrollPadding();
	new ResizeObserver(syncScrollPadding).observe(sticky);
}

// ========== Thinking Block Toggle ==========
function toggleThinking(headerEl) {
	const block = headerEl.closest('.thinking-block');
	if (!block) return;
	block.classList.toggle('collapsed');
}

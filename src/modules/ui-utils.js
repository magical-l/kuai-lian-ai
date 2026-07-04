// ========== UI Functions ==========
// .chat-input-area 的最小高度，作为布局约束的单一数据源
// 用 CSS minHeight，scrollHeight 在 flex:1 子元素被撑满时不正确
function stickyMinHeight() {
	const sb = $('.chat-input-area');
	return sb ? parseInt(getComputedStyle(sb).minHeight) || 126 : 126;
}

function initDividers() {
	// 水平分隔线
	const dividerHorizontal = $('.divider.row');
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
	const sidebarRight = $('aside.session.list:not(.divider)');
	const dividerRight = $('.divider.col.right');
	const btnToggleSidebar = $('.toggle-sidebar');

	function updateSidebarToggleIcon(isHidden) {
		const useEl = document.querySelector('.toggle-sidebar use');
		if (useEl) {
			useEl.setAttribute('href', isHidden ? 'icons.svg#icon-sidebar-closed' : 'icons.svg#icon-sidebar-open');
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
				let isHidden;
				const doToggle = () => {
					isHidden = sidebarRight.classList.toggle('hidden');
					dividerRight.classList.toggle('hidden', isHidden);
					updateSidebarToggleIcon(isHidden);
				};
				if (document.startViewTransition) {
					document.startViewTransition(doToggle);
				} else {
					doToggle();
				}
				localStorage.setItem('sidebar-right-hidden', isHidden);
			});
	}
	$$('.divider.col').forEach(div => {
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
	cm.style.height = Math.max(100, Math.min(parseInt(savedH), maxH)) + 'px';
	cm.style.flex = '0 0 auto';
}
window.addEventListener('resize', clampSavedHeight);
// ========== Scroll Navigation ==========
function scrollToBottom() {
	const el = $('.msg.list');
	if (el) el.scrollTop = el.scrollHeight;
}

function initScrollNav() {
	const btnScrollTop = $('.go-top.btn');
	const btnScrollBottom = $('.go-bottom.btn');
	const scrollContainer = $('.msg.list');
	if (!btnScrollTop || !btnScrollBottom || !scrollContainer) return;

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
	new ResizeObserver(syncScrollPadding).observe(sticky);
}

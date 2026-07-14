// ========== Session List Functions ==========
function handleEditSessionTitleClick(btn) {
	const sessionEl = btn.closest('li');
	const sessionId = sessionEl.dataset.sessionId;
	const titleEl = sessionEl.querySelector('.title');
	const meta = sessionEl.querySelector('.meta');
	const currentTitle = titleEl.textContent || '新会话';
	const inputEl = mk('input', 'editing title');
	inputEl.type = 'text';
	inputEl.value = currentTitle;
	titleEl.classList.add('hidden');
	sessionEl.insertBefore(inputEl, meta);
	inputEl.focus();
	inputEl.select();
	const finishEdit = () => {
		const newTitle = inputEl.value.trim();
		inputEl.remove();
		titleEl.classList.remove('hidden');
		if (newTitle && newTitle !== currentTitle) {
			handleSessionEdit(sessionId, newTitle);
		}
	};
	inputEl.onblur = finishEdit;
	inputEl.onkeydown = (e2) => {
		if (e2.key === 'Enter') {
			e2.preventDefault();
			inputEl.blur();
		} else if (e2.key === 'Escape') {
			inputEl.value = currentTitle;
			inputEl.blur();
		}
	};
}
function handleRemoveSessionClick(btn) {
	const sessionEl = btn.closest('li');
	const sessionId = sessionEl.dataset.sessionId;
	confirmAction('确定删除该会话？', () => handleSessionDelete(sessionId));
}
function handleSessionListItemClick(sessionEl) {
	handleSessionSelect(sessionEl.dataset.sessionId);
}
function renderSessionList(sessions, selectedSessionId, onSessionSelect, onSessionEdit, onSessionDelete) {
	const container = document.querySelector('aside.session.list > ol');
	container.querySelectorAll('li').forEach(el => el.remove());
	sessions.sort((a, b) => b.createdAt - a.createdAt);
	sessions.forEach(session => {
		const sessionEl = fromTemplate('one-session', 'li');
		sessionEl.dataset.sessionId = session.id;
		if (session.id === selectedSessionId) {
			sessionEl.classList.add('selected');
		}
		const titleEl = sessionEl.querySelector('.title');
		const meta = sessionEl.querySelector('.meta');
		const timeEl = sessionEl.querySelector('.time');
		const editBtn = sessionEl.querySelector('.edit.title');
		sessionEl.querySelector(".edit.title").addEventListener("click", e => { e.stopPropagation(); handleEditSessionTitleClick(e.currentTarget); });
		sessionEl.querySelector(".remove").addEventListener("click", e => { e.stopPropagation(); handleRemoveSessionClick(e.currentTarget); });
		const deleteBtn = sessionEl.querySelector('.remove');
		titleEl.textContent = session.title || '新会话';
		timeEl.textContent = new Date(session.createdAt).toLocaleString('zh-CN', {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
		editBtn.title = '编辑标题';
		editBtn.dataset.sessionId = session.id;
		deleteBtn.title = '删除该会话';
		sessionEl.onclick = () => handleSessionListItemClick(sessionEl);
		container.addChild(sessionEl);
	});
}

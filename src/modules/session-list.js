// ========== Session List Functions ==========
function renderSessionList(sessions, selectedSessionId, onSessionSelect, onSessionEdit, onSessionDelete) {
	const container = document.querySelector('aside.session.list > ol');
	container.querySelectorAll('li').forEach(el => el.remove());
	sessions.sort((a, b) => b.createdAt - a.createdAt);
	sessions.forEach(session => {
		const sessionEl = mk('li', 'one session');
		if (session.id === selectedSessionId) {
			sessionEl.classList.add('selected');
		}
		const titleEl = mk('div', 'session title');
		titleEl.textContent = session.title || '新会话';
		const meta = mk('div', 'session meta , flex items-go-x');
		const timeEl = mk('span', 'session time');
		timeEl.textContent = new Date(session.createdAt).toLocaleString('zh-CN', {
			month: 'numeric',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
		const actionsEl = mk('div', 'btn-group session actions , flex items-go-x');
		const editBtn = mk('button', 'edit title btn , square , icon-only');
		editBtn.innerHTML = SVG.edit(10);
		editBtn.title = '编辑标题';
		editBtn.on('click', e => {
			e.stopPropagation();
			const currentTitle = session.title || '新会话';
			const inputEl = mk('input', 'editing title');
			inputEl.type = 'text';
			inputEl.value = currentTitle;
			titleEl.style.display = 'none';
			sessionEl.insertBefore(inputEl, meta);
			inputEl.focus();
			inputEl.select();
			const finishEdit = () => {
				const newTitle = inputEl.value.trim();
				inputEl.remove();
				titleEl.style.display = '';
				if (newTitle && newTitle !== currentTitle) {
					onSessionEdit(session.id, newTitle);
				}
			};
			inputEl.on('blur', finishEdit);
			inputEl.on('keydown', e2 => {
				if (e2.key === 'Enter') {
					e2.preventDefault();
					inputEl.blur();
				} else if (e2.key === 'Escape') {
					inputEl.value = currentTitle;
					inputEl.blur();
				}
			});
		});
		const deleteBtn = mk('button', 'remove btn danger , square , icon-only');
		deleteBtn.innerHTML = SVG.del(10);
		deleteBtn.title = '删除会话';
		deleteBtn.on('click', e => {
			e.stopPropagation();
			confirmAction('确定删除该会话？', () => onSessionDelete(session.id));
		});
		actionsEl.addChild(editBtn);
		actionsEl.addChild(deleteBtn);
		meta.addChild(timeEl);
		meta.addChild(actionsEl);
		sessionEl.addChild(titleEl);
		sessionEl.addChild(meta);
		sessionEl.on('click', () => onSessionSelect(session.id));
		container.addChild(sessionEl);
	});
}

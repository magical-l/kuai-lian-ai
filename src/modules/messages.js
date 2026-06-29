// ========== Message Functions ==========
function renderMarkdown(text) {
	if (!text) return '';
	marked.setOptions({
		breaks: true,
		gfm: true
	});
	return marked.parse(text);
}

function addCodeCopyButtons(container) {
	container.querySelectorAll('pre code').forEach(codeEl => {
		const preEl = codeEl.parentElement;
		const copyBtn = document.createElement('button');
		copyBtn.className = 'copy code btn , bare icon-only , square';
		copyBtn.innerHTML = `<span class="copy icon ⧉">⧉</span><span class="done icon">✓</span>`;
		copyBtn.title = '复制代码';
		copyBtn.onclick = () => {
			navigator.clipboard.writeText(codeEl.textContent).then(() => {
				copyBtn.classList.add("copied");
				clearTimeout(copyBtn._copiedTimer);
				copyBtn._copiedTimer = setTimeout(() => copyBtn.classList.remove("copied"), 1500);
			});
		};
		preEl.appendChild(copyBtn);
		hljs.highlightElement(codeEl);
	});
}

function renderMessages(messages, groups, onCopy) {
	const container = $('#chat-messages');
	container.innerHTML = '';
	messages.forEach((msg, index) => {
		if (msg.role === 'user') {
			const msgEl = mk('article', 'msg request one , flex items-go-y');
			// 使用模板创建meta，包含复制按钮
			const meta = fromTemplate('user-header', 'header');
			const timeStr = msg.timestamp ? formatDateTime(msg.timestamp) : '';
			$('.time', meta).textContent = timeStr;
			msgEl.addChild(meta);
			const normalized = normalizeMessageContent(msg);
			const textItems = normalized.filter(c => c.type === 'text' || c.type === 'file_text');
			const textContent = textItems.map(c => c.text || '').join('\n');
			const copyBtn = $('.copy.content', meta);
			copyBtn.onclick = () => {
				navigator.clipboard.writeText(textContent).then(() => {
					copyBtn.classList.add("copied");
					clearTimeout(copyBtn._copiedTimer);
					copyBtn._copiedTimer = setTimeout(() => copyBtn.classList.remove("copied"), 1500);
				});
			};
			if (textContent) {
				const userEl = mk('div', 'content');
				userEl.textContent = textContent;
				msgEl.addChild(userEl);
			}
			const attachmentItems = normalized.filter(c => c.type === 'image' || c.type === 'file');
			if (attachmentItems.length > 0) {
				const attContainer = mk('div', 'attachments , flex items-go-x');
				attachmentItems.forEach(att => {
					const attEl = mk('div', `one attachment ${att.type} , flex items-go-x`);
					if (att.type === 'image' && att.source) {
						let imgSrc;
						if (att.source.type === 'url') {
							imgSrc = att.source.url;
						} else {
							imgSrc = `data:${att.source.media_type};base64,${att.source.data}`;
						}
						const thumb = mk('img', 'thumb');
						thumb.src = imgSrc;
						thumb.onclick = () => {
							const overlay = mk('div', 'image-preview-overlay , flex items-go-x');
							const fullImg = mk('img');
							fullImg.src = imgSrc;
							overlay.onclick = () => overlay.remove();
							overlay.addChild(fullImg);
							doc.body.addChild(overlay);
						};
						attEl.addChild(thumb);
						const nameEl = mk('span', 'name');
						nameEl.textContent = att.name || '图片';
						attEl.addChild(nameEl);
					} else if (att.type === 'file' && att.source) {
						const fileIcon = mk('span');
						fileIcon.textContent = '📄';
						attEl.addChild(fileIcon);
						const nameEl = mk('span', 'name');
						nameEl.textContent = att.name || '文件';
						attEl.addChild(nameEl);
						attEl.onclick = () => {
							const data = att.source.data;
							const mime = att.source.media_type;
							const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], {
								type: mime
							});
							const link = mk('a');
							link.href = URL.createObjectURL(blob);
							link.download = att.name || 'file';
							link.click();
							URL.revokeObjectURL(link.href);
						};
					}
					attContainer.addChild(attEl);
				});
				msgEl.addChild(attContainer);
			}
			container.addChild(msgEl);
		} else {
			renderResponse(container, msg, groups);
		}
	});
	container.scrollTop = container.scrollHeight;
}

function renderResponse(container, msg, groups) {
    const sorted = [...msg.responses].sort((a, b) => (a.firstTokenTime ?? Infinity) - (b.firstTokenTime ?? Infinity));
    sorted.forEach((r, i) => {
        const card = mk("article", "one response msg , flex items-go-y");
        const info = findModelById(groups, r.endpointId);
        const name = info ? [...(info.ancestors || []).map(a => a.name), info.node.name].join(" / ") : "未知";
        const remark = info?.node?.remark || "";
        const templateId = 'response-header';
        const meta = fromTemplate(templateId, "header");
        const timeStr = r.timestamp ? formatDateTime(r.timestamp) : "";
        const durationStr = r.firstTokenTime ? `反应${(r.firstTokenTime / 1000).toFixed(1)}s` : "";
        const speedClass = getSpeedClass(r.firstTokenTime);
        const totalStr = r.totalDuration ? `耗时${(r.totalDuration / 1000).toFixed(1)}s` : "";
        const statusText = getStatusText(r.status);
        $(".name", meta).innerHTML = remark ? `${name}<span class="remark"> ${remark}</span>` : name;
        $(".time", meta).textContent = timeStr;

        if (durationStr) {
            const durationEl = $(".wait", meta);
            durationEl.textContent = durationStr;

            if (speedClass)
                durationEl.classList.add(speedClass);
        }

        $(".total", meta).textContent = totalStr;
        const statusEl = $(".status", meta);
        statusEl.textContent = statusText;
        statusEl.classList.add("status");

        if (r.status === "completed")
            statusEl.classList.add("completed");
        else if (r.status === "failed")
            statusEl.classList.add("failed");
        else if (r.status === "stopped")
            statusEl.classList.add("stopped");

        const errorEl = $(".error", meta);

        if (r.error && errorEl) {
            errorEl.textContent = r.error;
            errorEl.style.display = "";
        }

        card.addChild(meta);

        const copyBtn = $('.copy.content', meta);
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(r.content || "").then(() => {
                copyBtn.classList.add("copied");
                clearTimeout(copyBtn._copiedTimer);
                copyBtn._copiedTimer = setTimeout(() => copyBtn.classList.remove("copied"), 1500);
            });
        };

        if (r.content) {
            const contentEl = mk("div", "content");
            contentEl.innerHTML = renderMarkdown(r.content);
            addCodeCopyButtons(contentEl);
            card.addChild(contentEl);
        }

        if (r.embeddingResult) {
            const emb = r.embeddingResult;
            const embMeta = mk("div", "embedding-result");
            embMeta.innerHTML = `<div class="mb-1">
									<strong>嵌入维度:</strong>
									${emb.dim}
								</div>
								<div class="mb-1">
									<strong>预览:</strong>
									<code>${emb.preview}</code>
								</div>`;
            const copyBtn = mk("button", "copy code btn , bare icon-only , square");
            copyBtn.innerHTML = `<span class="copy icon ⧉">⧉</span><span class="done icon">✓</span>`;
            copyBtn.title = "复制完整向量";

            copyBtn.onclick = () => {
                const codeText = previewRow.querySelector('code').textContent;
                navigator.clipboard.writeText(codeText).then(() => {
                    copyBtn.classList.add("copied");
                    setTimeout(() => copyBtn.classList.remove("copied"), 1500);
                });
            };

            const previewRow = embMeta.querySelector('.mb-1:last-child');
            previewRow.addChild(copyBtn);
            card.addChild(embMeta);
        }

        container.addChild(card);
    });
}

function getStatusText(status) {
	return {
		completed: '✓',
		failed: '✗',
		stopped: '■'
	} [status] || status;
}

function getSpeedClass(firstTokenTime) {
	if (firstTokenTime == null) return '';
	if (firstTokenTime < 1000) return 'fast';
	if (firstTokenTime < 2000) return 'medium';
	return 'slow';
}

function formatDateTime(timestamp) {
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hour = String(date.getHours()).padStart(2, '0');
	const minute = String(date.getMinutes()).padStart(2, '0');
	const second = String(date.getSeconds()).padStart(2, '0');
	return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function updateChatTitle(title) {
	const el = $('.title');
	el.textContent = title || '新会话';
}

function getInputContent() {
	const input = $('#chat-input');
	return input.value.trim();
}
async function getInputMessage() {
	const input = $('#chat-input');
	const text = input.value.trim();
	const content = [];
	if (text) {
		content.push({
			type: 'text',
			text
		});
	}
	for (const att of pendingAttachments) {
		try {
			if (att.type === 'image') {
				const data = await fileToBase64(att.file);
				content.push({
					type: 'image',
					name: att.name,
					source: {
						type: 'base64',
						media_type: att.mediaType,
						data
					}
				});
			} else if (att.type === 'file_text') {
				const textContent = await fileToText(att.file);
				content.push({
					type: 'file_text',
					name: att.name,
					text: textContent
				});
			} else {
				const data = await fileToBase64(att.file);
				content.push({
					type: 'file',
					name: att.name,
					source: {
						type: 'base64',
						media_type: att.mediaType,
						data
					}
				});
			}
		} catch (e) {
			console.error(`处理附件失败: ${att.name}`, e);
			alert(`附件 "${att.name}" 处理失败，请重试`);
			return null;
		}
	}
	return content;
}

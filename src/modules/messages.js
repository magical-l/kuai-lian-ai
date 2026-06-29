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
        const info = findModelById(groups, r.endpointId);
        // 找已有的 streaming card
        let existing = container.querySelector(`.one.response.msg[data-endpoint-id="${r.endpointId}"]`);
        if (!existing) {
            // 没有 streaming card（切换会话等场景），从 template 建一张
            existing = fromTemplate("response-card-streaming", ".one.response.msg");
            if (!existing) return;
            existing.dataset.endpointId = r.endpointId;
            const name = info ? [...(info.ancestors || []).map(a => a.name), info.node.name].join(" / ") : "未知";
            const nameEl = $('.name', existing);
            if (nameEl) {
                const remark = info?.node?.remark || "";
                nameEl.innerHTML = remark ? `${name}<span class="remark"> ${remark}</span>` : name;
            }
            container.appendChild(existing);
        }

        // 移除流式加载时的 spinner 图标
        const spinIcon = $('.status-icon', existing);
        if (spinIcon) spinIcon.remove();

        // 升级 .say：textContent → innerHTML (markdown)
        const sayEl = $('.say', existing);
        if (sayEl && r.content) {
            sayEl.innerHTML = renderMarkdown(r.content);
            addCodeCopyButtons(sayEl);
        }

        // 更新 header
        const meta = $('header', existing);
        if (!meta) return;

        const nameEl = $('.name', meta);
        if (nameEl && info) {
            const remark = info?.node?.remark || "";
            const name = info ? [...(info.ancestors || []).map(a => a.name), info.node.name].join(" / ") : "未知";
            nameEl.innerHTML = remark ? `${name}<span class="remark"> ${remark}</span>` : name;
        }

        const timeStr = r.timestamp ? formatDateTime(r.timestamp) : "";
        let timeEl = $('.time', meta);
        if (!timeEl) {
            timeEl = mk('span', 'time');
            if (nameEl) nameEl.insertAdjacentElement('afterend', timeEl);
        }
        timeEl.textContent = timeStr;

        const durationStr = r.firstTokenTime ? `反应${(r.firstTokenTime / 1000).toFixed(1)}s` : "";
        if (durationStr) {
            let waitEl = $('.wait', meta);
            if (!waitEl) {
                waitEl = mk('span', 'wait time');
                if (nameEl) nameEl.insertAdjacentElement('afterend', waitEl);
            }
            waitEl.textContent = durationStr;
            const speedClass = getSpeedClass(r.firstTokenTime);
            if (speedClass) waitEl.classList.add(speedClass);
        }

        const totalStr = r.totalDuration ? `耗时${(r.totalDuration / 1000).toFixed(1)}s` : "";
        if (totalStr) {
            let totalEl = $('.total', meta);
            if (!totalEl) {
                totalEl = mk('span', 'total time');
                const insertAfter = $('.status', meta) || $('.wait', meta) || $('.time', meta) || nameEl;
                if (insertAfter) insertAfter.insertAdjacentElement('afterend', totalEl);
            }
            totalEl.textContent = totalStr;
        }

        let statusEl = $('.status', meta);
        if (!statusEl) {
            statusEl = mk('span', 'status');
            const insertAfter = $('.total', meta) || $('.wait', meta) || $('.time', meta) || nameEl;
            if (insertAfter) insertAfter.insertAdjacentElement('afterend', statusEl);
        }
        statusEl.textContent = getStatusText(r.status);
        if (r.status === "completed") statusEl.classList.add("completed");
        else if (r.status === "failed") statusEl.classList.add("failed");
        else if (r.status === "stopped") statusEl.classList.add("stopped");

        let errorEl = $('.error', meta);
        if (r.error) {
            if (!errorEl) {
                errorEl = mk('span', 'error');
                (statusEl || $('.total', meta) || nameEl).insertAdjacentElement('afterend', errorEl);
            }
            errorEl.textContent = r.error;
            errorEl.style.display = "";
        } else if (errorEl) {
            errorEl.style.display = "none";
        }

        // 复制按钮
        let copyBtn = $('.copy.content', meta);
        if (!copyBtn) {
            copyBtn = mk('button', 'copy content btn , bare icon-only , square');
            copyBtn.innerHTML = '<span class="copy icon ⧉">⧉</span><span class="done icon">✓</span>';
            copyBtn.title = '复制';
            (errorEl || statusEl || $('.total', meta) || nameEl).insertAdjacentElement('afterend', copyBtn);
        }
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(r.content || "").then(() => {
                copyBtn.classList.add("copied");
                clearTimeout(copyBtn._copiedTimer);
                copyBtn._copiedTimer = setTimeout(() => copyBtn.classList.remove("copied"), 1500);
            });
        };

        // 更新思考块
        if (r.thinking) {
            let thinkBlock = $('.think', existing);
            if (!thinkBlock) {
                thinkBlock = mk('details', 'think');
                thinkBlock.open = true;
                const thinkSummary = mk('summary');
                const summaryFlex = mk('div', 'flex items-go-x');
                const label = mk('span', 'label');
                label.textContent = '思考';
                summaryFlex.addChild(label);
                const duration = mk('span', 'duration');
                summaryFlex.addChild(duration);
                thinkSummary.addChild(summaryFlex);
                thinkBlock.addChild(thinkSummary);
                const thinkContent = mk('div', 'text');
                thinkBlock.addChild(thinkContent);
                const contentWrapper = $('.content', existing);
                if (contentWrapper) contentWrapper.insertBefore(thinkBlock, $('.say', existing));
            }
            thinkBlock.classList.remove('hidden');
            const thinkText = $('.text', thinkBlock);
            if (thinkText) thinkText.textContent = r.thinking;
            const durationEl = $('.duration', thinkBlock);
            if (durationEl && r.thinkingDuration) {
                durationEl.textContent = `耗时 ${(r.thinkingDuration/1000).toFixed(1)}s`;
            }
        }

        // embedding 结果（非流式场景，append 到 card 末尾）
        if (r.embeddingResult) {
            const emb = r.embeddingResult;
            let embMeta = $('.embedding-result', existing);
            if (!embMeta) {
                embMeta = mk('div', 'embedding-result');
                existing.addChild(embMeta);
            }
            embMeta.innerHTML = `<div class="mb-1">
                    <strong>嵌入维度:</strong>
                    ${emb.dim}
                </div>
                <div class="mb-1">
                    <strong>预览:</strong>
                    <code>${emb.preview}</code>
                </div>`;
            const copyBtn = mk("button", "copy code btn , bare icon-only , square");
            copyBtn.innerHTML = '<span class="copy icon ⧉">⧉</span><span class="done icon">✓</span>';
            copyBtn.title = "复制完整向量";
            const previewRow = embMeta.querySelector('.mb-1:last-child');
            previewRow.addChild(copyBtn);
            copyBtn.onclick = () => {
                const codeText = previewRow.querySelector('code').textContent;
                navigator.clipboard.writeText(codeText).then(() => {
                    copyBtn.classList.add("copied");
                    setTimeout(() => copyBtn.classList.remove("copied"), 1500);
                });
            };
        }
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

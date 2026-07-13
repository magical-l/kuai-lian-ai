// ========== Message Functions ==========
function handleCopyContentClick(btn) {
	const meta = btn.closest('header');
	const text = meta ? meta.dataset.copyText || '' : '';
	navigator.clipboard.writeText(text).then(() => {
		btn.classList.add("done");
		clearTimeout(btn._doneTimer);
		btn._doneTimer = setTimeout(() => btn.classList.remove("done"), 1500);
	});
}
function handleExpandJsonClick(btn) {
	const embMeta = btn.closest('.embedding-result');
	const fullJsonPre = embMeta ? embMeta.querySelector('.embedding-full-json') : null;
	if (fullJsonPre) fullJsonPre.classList.toggle('hidden');
	const iconSpan = btn.querySelector('.icon');
	if (iconSpan) {
		iconSpan.classList.toggle('collapsed');
		iconSpan.classList.toggle('expanded');
		iconSpan.textContent = '';
	}
}
function handleCopyCodeClick(btn) {
	const embMeta = btn.closest('.embedding-result');
	const fullJsonPre = embMeta ? embMeta.querySelector('.embedding-full-json') : null;
	const text = fullJsonPre ? fullJsonPre.textContent : '';
	navigator.clipboard.writeText(text).then(() => {
		btn.classList.add('done');
		setTimeout(() => btn.classList.remove('done'), 1500);
	});
}
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
		// 已包裹过 → 跳过
		if (preEl.parentElement.tagName === 'DETAILS') return;

		// 清空旧按钮
		preEl.querySelectorAll('.code-block-toggle, .copy.code').forEach(b => b.remove());

		// 构建 <details><summary>语言 + 复制</summary><pre><code>...</code></pre></details>
		const details = document.createElement('details');
		details.className = 'code-block';

		const summary = document.createElement('summary');
		// 语言标识
		const langSpan = document.createElement('span');
		langSpan.className = 'code-lang';
		const codeText = codeEl.textContent.trim();
		const isUrl = /^https?:\/\//.test(codeText);
		if (isUrl) {
			langSpan.textContent = 'URL';
		} else {
			const cls = codeEl.className;
			const langMatch = cls.match(/language-(\w+)/);
			langSpan.textContent = langMatch ? langMatch[1] : '文本';
		}
		summary.appendChild(langSpan);

		// 复制按钮
		const copyBtn = document.createElement('button');
		copyBtn.className = 'copy code btn , bare , shape square';
		copyBtn.appendChild(mk('span', 'copy icon'));
		copyBtn.title = '复制';
		copyBtn.onclick = (e) => {
			e.stopPropagation();
			navigator.clipboard.writeText(codeEl.textContent).then(() => {
				copyBtn.classList.add("done");
				clearTimeout(copyBtn._doneTimer);
				copyBtn._doneTimer = setTimeout(() => copyBtn.classList.remove("done"), 1500);
			});
		};
		summary.appendChild(copyBtn);
		summary.appendChild(mk('span', 'done status icon char-style'));

		details.appendChild(summary);
		preEl.parentElement.insertBefore(details, preEl);
		details.appendChild(preEl);

		if (!isUrl) hljs.highlightElement(codeEl);
	});
}

function renderMessages(messages, groups, onCopy) {
	const container = $('.msg.list');
	container.innerHTML = '';
	messages.forEach((msg, index) => {
		if (msg.role === 'user') {
			const msgEl = mk('article', 'msg request one , flex items-go-y');
			// 使用模板创建meta，包含复制按钮
			const meta = fromTemplate('user-header', 'header');
			meta.querySelector(".copy.content").addEventListener("click", e => handleCopyContentClick(e.currentTarget));
			const timeStr = msg.timestamp ? formatDateTime(msg.timestamp) : '';
			$('.time', meta).textContent = timeStr;
			msgEl.addChild(meta);
			const normalized = normalizeMessageContent(msg);
			const textItems = normalized.filter(c => c.type === 'text' || c.type === 'file_text');
			const textContent = textItems.map(c => c.text || '').join('\n');
			meta.dataset.copyText = textContent;
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
						const fileIcon = mk('span', 'icon file');
						fileIcon.textContent = '';
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
			// 清除之前assistant消息创建的卡片的data-endpoint-id，
			// 使得renderResponse为每条assistant消息创建新卡片而非覆盖已有卡片
			container.querySelectorAll('.one.response.msg').forEach(el => {
				el.removeAttribute('data-endpoint-id');
			});
			renderResponse(container, msg, groups);
		}
	});
	container.scrollTop = container.scrollHeight;
}

function appendUserMessage(msg) {
		const container = $('.msg.list');
		const msgEl = mk('article', 'msg request one , flex items-go-y');
		const meta = fromTemplate('user-header', 'header');
		meta.querySelector(".copy.content").addEventListener("click", e => handleCopyContentClick(e.currentTarget));
		const timeStr = msg.timestamp ? formatDateTime(msg.timestamp) : '';
		$('.time', meta).textContent = timeStr;
		msgEl.addChild(meta);
		const normalized = normalizeMessageContent(msg);
		const textItems = normalized.filter(c => c.type === 'text' || c.type === 'file_text');
		const textContent = textItems.map(c => c.text || '').join('\n');
		meta.dataset.copyText = textContent;
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
					const fileIcon = mk('span', 'icon file');
					fileIcon.textContent = '';
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
			existing.querySelector(".copy.content").addEventListener("click", e => handleCopyContentClick(e.currentTarget));
			existing.querySelector(".stop-one-response").addEventListener("click", e => { e.stopPropagation(); handleStopOneResponseClick(e.currentTarget); });
			existing.querySelector(".expand-json").addEventListener("click", e => handleExpandJsonClick(e.currentTarget));
			existing.querySelector(".copy.code").addEventListener("click", e => handleCopyCodeClick(e.currentTarget));
            existing.dataset.endpointId = r.endpointId;
            const name = info ? [...(info.ancestors || []).map(a => a.name), info.node.name].join(" / ") : "未知";
            const nameEl = $('.name', existing);
            if (nameEl) {
                nameEl.textContent = name;
            }
            container.appendChild(existing);
        }

        // 移除流式加载时的 spinner 图标
        const spinIcon = $('.status.loading', existing);
        if (spinIcon) spinIcon.remove();

        // 升级 .say：textContent → innerHTML (markdown)
        const sayEl = $('.say', existing);
        if (sayEl && r.content) {
            sayEl.innerHTML = renderMarkdown(r.content);
            addCodeCopyButtons(sayEl);
            // 代码块默认展开（图片 URL 代码块默认收起）
            sayEl.querySelectorAll('details.code-block').forEach(d => {
                d.open = !r.imageResult;
            });
        }

        // 更新 header
        const meta = $('header', existing);
        if (!meta) return;

        const nameEl = $('.name', meta);
        if (nameEl && info) {
            const name = info ? [...(info.ancestors || []).map(a => a.name), info.node.name].join(" / ") : "未知";
            nameEl.textContent = name;
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
                if (timeEl) timeEl.insertAdjacentElement('afterend', waitEl);
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
                const insertAfter = $('.wait', meta) || $('.time', meta) || nameEl;
                if (insertAfter) insertAfter.insertAdjacentElement('afterend', totalEl);
            }
            totalEl.textContent = totalStr;
        }

        let statusEl = $('.status', meta);
        if (!statusEl) {
            statusEl = mk('span', 'status icon char-style');
            const insertAfter = $('.total', meta) || $('.wait', meta) || $('.time', meta) || nameEl;
            if (insertAfter) insertAfter.insertAdjacentElement('afterend', statusEl);
        }
        statusEl.textContent = "";
        statusEl.classList.add(getStatusText(r.status));

        // 错误信息：放到 .content 中（在 .say 后面），有错误时隐藏复制按钮
        let errorEl = $('.error', existing);  // 在整张 card 里找
        if (r.error) {
            if (!errorEl) {
                errorEl = mk('span', 'error');
                const contentWrapper = $('.content', existing);
                if (contentWrapper) {
                    const sayEl = $('.say', contentWrapper);
                    if (sayEl) {
                        sayEl.insertAdjacentElement('afterend', errorEl);
                    } else {
                        contentWrapper.appendChild(errorEl);
                    }
                }
            }
            errorEl.textContent = r.error;
            errorEl.style.display = "";
        } else if (errorEl) {
            errorEl.style.display = "none";
        }

        // 复制按钮
        meta.dataset.copyText = r.content || "";

        // 有错误时隐藏复制按钮
        var copyContentBtn = $('.copy.content', meta);
        if (copyContentBtn) {
            copyContentBtn.classList.toggle('hidden', !!r.error);
        }

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
            var embMeta = $('.embedding-result', existing);
            embMeta.classList.remove('hidden');
            embMeta.querySelector('.dim').textContent = emb.dim;
            embMeta.querySelector('.preview').textContent = emb.preview;
            const fullJsonPre = embMeta.querySelector('.embedding-full-json');
            fullJsonPre.textContent = emb.fullJson;


        }

        // image 结果（非流式生图场景）
        if (r.imageResult) {
            const imgRes = r.imageResult;
            let imgMeta = $('.image-result', existing);
            if (!imgMeta) {
                imgMeta = mk('div', 'image-result');
                existing.addChild(imgMeta);
            }
            // 避免重复渲染（updateCardAsImage 已添加时）
            const hasImg = imgMeta.querySelector('img');
            if (!hasImg) {
                // imageData 是持久化的 base64；旧会话可能只有 url，需要重新下载
                const needsDownload = !imgRes.imageData && !imgRes.b64_json && imgRes.url;
                let imgUrl = imgRes.imageData || (imgRes.b64_json ? 'data:image/png;base64,' + imgRes.b64_json : null);

                if (imgUrl) {
                    // 有 base64 数据 → 显示图片
                    const img = mk('img', 'generated');
                    img.src = imgUrl;
                    img.style.maxWidth = '100%';
                    img.style.borderRadius = '8px';
                    img.onclick = () => {
                        const src = img.src;
                        const overlay = mk('div', 'image-preview-overlay , flex items-go-x');
                        const fullImg = mk('img');
                        fullImg.src = src;
                        overlay.onclick = () => overlay.remove();
                        overlay.addChild(fullImg);
                        doc.body.addChild(overlay);
                    };
                    imgMeta.addChild(img);
                }

                // 尝试下载（旧会话只有 url）
                if (needsDownload) {
                    fetch(imgRes.url).then(r => {
                        if (!r.ok) throw new Error('status ' + r.status);
                        return r.blob();
                    }).then(blob => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const dataUrl = reader.result;
                            imgRes.imageData = dataUrl;
                            // 如果还没显示图片，现在显示
                            if (!imgMeta.querySelector('img.generated')) {
                                const img = mk('img', 'generated');
                                img.src = dataUrl;
                                img.style.maxWidth = '100%';
                                img.style.borderRadius = '8px';
                                img.onclick = () => {
                                    const overlay = mk('div', 'image-preview-overlay , flex items-go-x');
                                    const fullImg = mk('img');
                                    fullImg.src = dataUrl;
                                    overlay.onclick = () => overlay.remove();
                                    overlay.addChild(fullImg);
                                    doc.body.addChild(overlay);
                                };
                                imgMeta.appendChild(img);
                            } else {
                                // 已有 img 元素，只更新 src
                                const existingImg = imgMeta.querySelector('img.generated');
                                if (existingImg) existingImg.src = dataUrl;
                            }
                        };
                        reader.readAsDataURL(blob);
                    }).catch(() => {
                        // 下载失败 → 过期提示
                        const expired = mk('div', 'image-expired');
                        expired.textContent = '⚠ 图片链接已过期，无法加载';
                        expired.style.fontSize = 'smaller';
                        expired.style.color = 'var(--warning)';
                        expired.style.marginTop = '4px';
                        imgMeta.addChild(expired);
                    });
                }

                if (imgRes.revised_prompt) {
                    const revised = mk('div', 'revised-prompt');
                    revised.textContent = '修订提示: ' + imgRes.revised_prompt;
                    revised.style.fontSize = 'smaller';
                    revised.style.color = 'var(--text-dim)';
                    revised.style.marginTop = '4px';
                    imgMeta.addChild(revised);
                }
            }
        }
    });
}

function getStatusText(status) {
	return {
		completed: 'done',
		failed: 'failed',
		stopped: 'stop'
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

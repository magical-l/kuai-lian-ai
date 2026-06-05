		// 检测浏览器插件环境
		const isExtension = window.__IS_EXTENSION__;
		const storage = window.__STORAGE__;
		const THINKING_TAGS = [{
			start: '<thinking>',
			end: '</thinking>'
		}, {
			start: '<think>',
			end: '</think>'
		}];
		// ========== Provider 定义（API 格式抽象层）==========
		const providers = {
			openai: {
				buildRequest(baseUrl, apiKey, model, messages) {
					return {
						url: baseUrl + '/v1/chat/completions',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': 'Bearer ' + apiKey
						},
						body: {
							model,
							messages,
							stream: true
						}
					};
				},
				parseChunk(json) {
					const delta = json.choices && json.choices[0] && json.choices[0].delta;
					if (!delta) return null;
					return {
						content: delta.content || null,
						reasoning: delta.reasoning_content || null
					};
				},
				testConfig(baseUrl, apiKey, model) {
					return {
						url: baseUrl + '/v1/chat/completions',
						headers: {
							'Content-Type': 'application/json',
							'Authorization': 'Bearer ' + apiKey
						},
						body: {
							model,
							messages: [{
								role: 'user',
								content: 'hi'
							}],
							max_tokens: 1
						}
					};
				}
			},
			claude: {
				buildRequest(baseUrl, apiKey, model, messages) {
					return {
						url: baseUrl + '/v1/messages',
						headers: {
							'Content-Type': 'application/json',
							'x-api-key': apiKey,
							'Authorization': 'Bearer ' + apiKey,
							'anthropic-version': '2023-06-01',
							'anthropic-dangerous-direct-browser-access': 'true'
						},
						body: {
							model,
							max_tokens: 4096,
							messages: this.transformMessages(messages),
							stream: true
						}
					};
				},
				transformMessages(messages) {
					return messages.map(m => {
						if (typeof m.content === 'string') return {
							role: m.role,
							content: m.content
						};
						if (Array.isArray(m.content)) return {
							role: m.role,
							content: toClaudeContent(m.content)
						};
						return {
							role: m.role,
							content: m.content
						};
					});
				},
				parseChunk(json) {
					if (json.type === 'content_block_start' && json.content_block && json.content_block.type === 'thinking') {
						return {
							event: 'thinking_start'
						};
					}
					if (json.type === 'content_block_delta' && json.delta && json.delta.type === 'thinking_delta') {
						return {
							reasoning: json.delta.thinking || null
						};
					}
					if (json.type === 'content_block_delta' && json.delta && json.delta.type === 'text_delta') {
						return {
							content: json.delta.text || null
						};
					}
					if (json.type === 'content_block_start' && json.content_block && json.content_block.type === 'text') {
						return {
							event: 'content_start'
						};
					}
					return null;
				},
				testConfig(baseUrl, apiKey, model) {
					return {
						url: baseUrl + '/v1/messages',
						headers: {
							'Content-Type': 'application/json',
							'x-api-key': apiKey,
							'Authorization': 'Bearer ' + apiKey,
							'anthropic-version': '2023-06-01',
							'anthropic-dangerous-direct-browser-access': 'true'
						},
						body: {
							model,
							max_tokens: 1,
							messages: [{
								role: 'user',
								content: 'hi'
							}]
						}
					};
				},
				needsTagParsing: false
			},
			gemini: {
				buildRequest(baseUrl, apiKey, model, messages) {
					return {
						url: baseUrl + '/v1beta/models/' + model + ':streamGenerateContent?key=' + apiKey + '&alt=sse',
						headers: {
							'Content-Type': 'application/json'
						},
						body: {
							contents: this.transformMessages(messages)
						}
					};
				},
				transformMessages(messages) {
					const contents = [];
					messages.forEach(m => {
						const role = m.role === 'user' ? 'user' : 'model';
						let parts;
						if (typeof m.content === 'string') parts = [{
							text: m.content
						}];
						else if (Array.isArray(m.content)) parts = toGeminiContent(m.content);
						else parts = [{
							text: String(m.content)
						}];
						const last = contents[contents.length - 1];
						if (last && last.role === role) last.parts.push(...parts);
						else contents.push({
							role,
							parts
						});
					});
					return contents;
				},
				parseChunk(json) {
					const text = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text;
					return text ? {
						content: text
					} : null;
				},
				testConfig(baseUrl, apiKey, model) {
					return {
						url: baseUrl + '/v1beta/models/' + model + ':generateContent?key=' + apiKey,
						headers: {
							'Content-Type': 'application/json'
						},
						body: {
							contents: [{
								role: 'user',
								parts: [{
									text: 'hi'
								}]
							}]
						}
					};
				}
			}
		};
		const SVG = {
			edit: s => `<span style="font-size:${s}px">✎</span>`,
			del: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M12 6v16"/></svg>`,
			drag: s => `<span style="font-size:${s}px;letter-spacing:-1px;line-height:1">⋮⋮</span>`,
			copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
			folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
			close: '<span style="font-size:16px;font-weight:700">×</span>',
			plus: '<span style="font-size:16px;font-weight:700">+</span>',
			chevron: '<span style="font-size:16px;font-weight:700">›</span>',
			eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
			eyeOff: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
		};
		// 从模板克隆元素
		function fromTemplate(templateId, selector) {
			const tpl = $('#' + templateId);
			return tpl.content.cloneNode(true).querySelector(selector);
		}
		// DOM查询辅助函数（类似jQuery）
		const doc = document;

		function $(selector, ctx = doc) {
			return ctx.querySelector(selector);
		}

		function $$(selector, ctx = doc) {
			return ctx.querySelectorAll(selector);
		}
		// 批量设置表单值
		function setValues(ctx, vals) {
			for (const [sel, val] of Object.entries(vals)) {
				$(sel, ctx).value = val ?? '';
			}
		}
		// 批量绑定click事件
		function onClick(handlers, ctx = doc) {
			for (const [sel, fn] of Object.entries(handlers)) {
				$(sel, ctx).onclick = fn;
			}
		}
		// 显示/隐藏元素
		function show(el) {
			el.style.display = '';
		}

		function hide(el) {
			el.style.display = 'none';
		}

		function toggle(el, visible) {
			el.style.display = visible ? '' : 'none';
		}
		// 确认后执行
		function confirmAction(msg, action) {
			if (confirm(msg)) action();
		}
		// DOM操作辅助
		const H = HTMLElement.prototype,
			D = Document.prototype;
		H.addChild = function(child) {
			return this.appendChild(child);
		};
		H.on = D.on = function(event, handler) {
			this.addEventListener(event, handler);
			return this;
		};

		function mk(tag, className) {
			const el = doc.createElement(tag);
			if (className) el.className = className;
			return el;
		}

		function text(el, txt) {
			el.textContent = txt;
			return el;
		}
		// Tooltip通用组件
		function createTooltip(id, html) {
			let el = null;
			let hideTimer = null;

			function show(triggerEl) {
				if (hideTimer) {
					clearTimeout(hideTimer);
					hideTimer = null;
				}
				el = $('#' + id);
				if (!el) {
					el = doc.createElement('div');
					el.id = id;
					el.className = 'group-tooltip';
					el.innerHTML = html;
					doc.body.appendChild(el);
					$$('button.tooltip-copy', el).forEach(btn => {
						btn.onclick = e => {
							e.stopPropagation();
							navigator.clipboard.writeText(btn.dataset.copy);
							btn.textContent = '✓';
							btn.classList.add('copied');
							setTimeout(() => {
								btn.textContent = '⧉';
								btn.classList.remove('copied');
							}, 1500);
						};
					});
					el.onmouseenter = () => {
						if (hideTimer) {
							clearTimeout(hideTimer);
							hideTimer = null;
						}
					};
					el.onmouseleave = () => hide();
				}
				// 计算位置
				const rect = triggerEl.getBoundingClientRect();
				const width = 200,
					height = el.offsetHeight || 80;
				let top = rect.bottom + 4,
					left = rect.left;
				if (top + height > window.innerHeight) top = rect.top - height - 4;
				if (left + width > window.innerWidth) left = window.innerWidth - width - 10;
				if (left < 10) left = 10;
				el.style.top = top + 'px';
				el.style.left = left + 'px';
				el.style.display = 'block';
			}

			function hide() {
				hideTimer = setTimeout(() => {
					if (el) el.style.display = 'none';
					hideTimer = null;
				}, 100);
			}

			function remove() {
				if (el) {
					el.remove();
					el = null;
				}
			}
			return {
				show,
				hide,
				remove,
				el
			};
		}
		// ========== UI Functions ==========
		function initDividers() {
			// 水平分隔线
			const dividerHorizontal = $('.divider.row');
			const chatMsg = $('#chat-messages');
			const mainContent = $('#main-content');
			const chatHeader = $('#chat-header');
			// 恢复保存的侧栏宽度
			const savedLeftWidth = localStorage.getItem('sidebar-left-width');
			const savedRightWidth = localStorage.getItem('sidebar-right-width');
			if (savedLeftWidth) $('aside.left:not(.divider)').style.width = savedLeftWidth;
			if (savedRightWidth) $('aside.right:not(.divider)').style.width = savedRightWidth;
			// 清理旧格式存储，重新初始化布局
			localStorage.removeItem('chat-messages-flex');
			// 恢复保存的消息区高度（像素值）
			const savedMessagesHeight = localStorage.getItem('chat-messages-height');
			if (savedMessagesHeight) {
				chatMsg.style.height = savedMessagesHeight;
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
				startMainHeight = mainContent.offsetHeight - dividerHorizontal.offsetHeight - chatHeader.offsetHeight;
				doc.body.style.cursor = 'row-resize';
				doc.body.style.userSelect = 'none';
			}

			function doDrag(e) {
				if (!isDragging || !curDiv) return;
				if (curDiv.type === 'vertical') {
					const dy = e.clientY - startY;
					const newHeight = startMessagesHeight + dy;
					const minMessages = 100;
					const minInput = 120;
					const maxMessages = startMainHeight - minInput;
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
					const maxWidth = containerWidth * 0.333;
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
			// 右侧栏显示/隐藏
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
			// 统一绑定所有水平 divider
			$$('.divider.column.control').forEach(div => {
				div.on('mousedown', startDragHorizontal);
			});
			if (dividerHorizontal) {
				dividerHorizontal.on('mousedown', startDragVertical);
			}
			doc.on('mousemove', doDrag);
			doc.on('mouseup', stopDrag);
		}
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
			// 检测是否有滚动条
			function checkScrollable() {
				const hasScroll = scrollContainer.scrollHeight > scrollContainer.clientHeight + 20;
				navButtons.classList.toggle('visible', hasScroll);
			}
			// 到顶部
			btnScrollTop.onclick = () => {
				scrollContainer.scrollTo({
					top: 0,
					behavior: 'smooth'
				});
			};
			// 到底部
			btnScrollBottom.onclick = () => {
				scrollContainer.scrollTo({
					top: scrollContainer.scrollHeight,
					behavior: 'smooth'
				});
			};
			// 监听滚动和内容变化
			scrollContainer.on('scroll', checkScrollable);
			const observer = new MutationObserver(checkScrollable);
			observer.observe(scrollContainer, {
				childList: true,
				subtree: true
			});
			checkScrollable();
		}
		// ========== Thinking Block Toggle ==========
		function toggleThinking(headerEl) {
			const block = headerEl.closest('.thinking-block');
			if (!block) return;
			block.classList.toggle('collapsed');
		}
		// ========== Model Selector Functions ==========
		let selectorExpanded = false;

		function renderModelSelector(groups, selectedModels, isGenerating) {
			const container = $('#model-selector');
			const summaryEl = $('#selector-summary');
			const listEl = $('#selector-list');
			const expandBtnText = $('#expand-btn-text');
			if (!container) return;
			// 更新容器状态
			container.classList.toggle('collapsed', !selectorExpanded);
			container.classList.toggle('generating', isGenerating);
			// 收起状态摘要
			if (selectedModels.length === 0) {
				summaryEl.innerHTML = '<span class="selector empty-hint">请选择模型</span>';
				expandBtnText.textContent = selectorExpanded ? '▲ 收起' : '▼ 展开选择';
			} else {
				summaryEl.innerHTML = selectedModels.map(id => {
					const info = findModelById(groups, id);
					if (!info) return '';
					const statusClass = getTagStatusClass(id);
					const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
					const genState = gens ? gens.get(id) : null;
					const speedClass = genState?.firstTokenTime ? getSpeedClass(genState.firstTokenTime) : '';
					const classes = ['model', 'tag', 'selected', statusClass, speedClass ? `speed-${speedClass}` : ''].filter(Boolean).join(' ');
					return `<span class="${classes}" data-model="${id}"><span class="endpoint name-color">${info.group.name}</span> ${info.model.name}</span>`;
				}).join('');
				expandBtnText.textContent = selectorExpanded ? '▲ 收起' : '▼ 展开';
			}
			// 展开状态列表
			if (selectorExpanded) {
				listEl.innerHTML = groups.map(g => {
					const tags = g.models.map(m => {
						const isSelected = selectedModels.includes(`${g.id}:${m.id}`);
						const statusClass = getTagStatusClass(`${g.id}:${m.id}`);
						const cls = isSelected ? (statusClass ? `selected ${statusClass}` : 'selected') : 'unselected';
						return `<span class="model tag ${cls}" data-model="${g.id}:${m.id}">${m.name}</span>`;
					}).join('');
					return `<div class="selector group-label">${g.name}</div><div class="selector models-row layout-x-queue">${tags}</div>`;
				}).join('');
			}
			bindSelectorEvents();
		}

		function findModelById(groups, modelId) {
			for (const g of groups) {
				const m = g.models.find(x => `${g.id}:${x.id}` === modelId);
				if (m) return {
					group: g,
					model: m
				};
		}
			return null;
		}

		function getTagStatusClass(modelId) {
			const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
			const gen = gens ? gens.get(modelId) : null;
			if (!gen) return '';
			// Only show color for failed/stopped status
			if (gen.status === 'failed') return 'failed';
			if (gen.status === 'stopped') return 'stopped';
			return '';
		}
		// getStatusIcon 已取消：选中模型的转圈功能不再需要
		function bindSelectorEvents() {
			const expandBtn = $('#selector-expand-btn');
			if (expandBtn) {
				expandBtn.onclick = () => {
					// 实时检查生成状态
					const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
					const isGenerating = gens && gens.size > 0 && Array.from(gens.values()).some(s => s.status === 'generating');
					if (isGenerating) return;
					selectorExpanded = !selectorExpanded;
					renderModelSelector(getGroups(), selectedModels, false);
				};
			}
			// Make entire model tag clickable for toggle selection
			$$('.model.tag').forEach(tag => {
				tag.onclick = e => {
					e.stopPropagation();
					// 实时检查生成状态（放在点击时检查，而非绑定时）
					const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
					const isGenerating = gens && gens.size > 0 && Array.from(gens.values()).some(s => s.status === 'generating');
					if (isGenerating) return;
					const id = tag.dataset.model;
					if (!id) return;
					if (selectedModels.includes(id)) {
						selectedModels = selectedModels.filter(x => x !== id);
					} else {
						if (!selectedModels.includes(id)) {
							selectedModels.push(id);
						}
					}
					saveDefaultSelectedModels(selectedModels);
					renderModelSelector(getGroups(), selectedModels, false);
				};
			});
		}
		// 收起展开的模型选择器（用户点击外部区域时）
		doc.on('click', e => {
			if (!selectorExpanded) return;
			const selector = $('#model-selector');
			if (selector && !selector.contains(e.target)) {
				selectorExpanded = false;
				renderModelSelector(getGroups(), selectedModels, false);
			}
		});
		// 收起状态存储（端点ID -> 是否收起）
		const collapsedEndpoints = new Set();
		// 全局tooltip元素（用于附件hover显示名字）
		let attachmentTooltip = null;

		function showAttachmentTooltip(name, targetEl) {
			if (!attachmentTooltip) {
				attachmentTooltip = mk('div');
				attachmentTooltip.style.cssText = 'position:fixed;background:var(--bg-elevated);border:1px solid var(--border-subtle);padding:2px 6px;font-size:11px;border-radius:4px;z-index:9999;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:var(--shadow-sm);pointer-events:none;';
				doc.body.appendChild(attachmentTooltip);
			}
			attachmentTooltip.textContent = name;
			attachmentTooltip.style.display = 'block';
			const rect = targetEl.getBoundingClientRect();
			// 显示在缩略图上方
			attachmentTooltip.style.left = rect.left + 'px';
			attachmentTooltip.style.top = (rect.top - 24) + 'px';
		}

		function hideAttachmentTooltip() {
			if (attachmentTooltip) {
				attachmentTooltip.style.display = 'none';
			}
		}
		// 渲染待发送的附件缩略图
		function renderPendingAttachments() {
			const row = $('#attachments-row');
			if (!row) return;
			row.innerHTML = '';
			pendingAttachments.forEach(att => {
				const thumb = mk('div', `attachment-thumb layout-x-queue ${att.type === 'image' ? 'image' : 'file'}`);
				thumb.dataset.id = att.id;
				if (att.type === 'image' && att.previewUrl) {
					thumb.style.backgroundImage = `url(${att.previewUrl})`;
				} else {
					thumb.textContent = '📄';
				}
				// hover显示名字
				thumb.onmouseenter = () => showAttachmentTooltip(att.name, thumb);
				thumb.onmouseleave = () => hideAttachmentTooltip();
				// 删除按钮
				const remove = mk('span', 'attachment-remove');
				remove.textContent = '×';
				remove.onclick = (e) => {
					e.stopPropagation();
					removeAttachment(att.id);
					renderPendingAttachments();
				};
				thumb.appendChild(remove);
				// 点击预览
				thumb.onclick = () => showAttachmentPreview(att);
				row.appendChild(thumb);
			});
		}
		// 预览附件（简单实现：图片弹窗，文件下载）
		function showAttachmentPreview(att) {
			if (att.type === 'image' && att.previewUrl) {
				// 图片预览弹窗
				const overlay = mk('div', 'image-preview-overlay layout-x-queue');
				overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;';
				const img = mk('img');
				img.src = att.previewUrl;
				img.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px;';
				overlay.onclick = () => overlay.remove();
				overlay.appendChild(img);
				document.body.appendChild(overlay);
			} else {
				// 文件下载
				const link = mk('a');
				link.href = att.previewUrl || URL.createObjectURL(att.file);
				link.download = att.name;
				link.click();
				if (!att.previewUrl) URL.revokeObjectURL(link.href);
			}
		}

		function renderEndpointList(groups, selectedModelId, onModelSelect, onModelEdit, onGroupEdit, onGroupDelete, onAddModel, onModelDelete, onReorderGroups, onReorderModels, onTestConnection) {
			const container = $('#endpoint-list');
			// 保存当前收起状态
			$$('.endpoint-group', container).forEach(el => {
				const groupId = el.dataset.groupId;
				const models = $('.group-models', el);
				if (models && models.style.display === 'none') {
					collapsedEndpoints.add(groupId);
				} else {
					collapsedEndpoints.delete(groupId);
				}
			});
			container.innerHTML = '';
			groups.forEach((group, groupIndex) => {
				const groupEl = mk('section', 'endpoint-group');
				groupEl.dataset.groupId = group.id;
				groupEl.dataset.groupIndex = groupIndex;
				groupEl.draggable = false;
				const headerEl = mk('div', 'group-header layout-x-queue');
				// 拖动手柄
				const dragHandle = mk('span', 'drag-handle layout-x-queue');
				dragHandle.innerHTML = SVG.drag(14);
				dragHandle.title = '拖动排序';
				dragHandle.draggable = true;
				dragHandle.on('dragstart', e => {
					e.dataTransfer.setData('text/plain', group.id);
					e.dataTransfer.effectAllowed = 'move';
					groupEl.classList.add('dragging');
				});
				dragHandle.on('dragend', () => {
					groupEl.classList.remove('dragging');
					$$('.endpoint-group', container).forEach(el => el.classList.remove('drag-over'));
				});
				// 收展三角放前面
				const toggleSpan = mk('span', 'group-toggle');
				// 恢复收起状态
				const isCollapsed = collapsedEndpoints.has(group.id);
				toggleSpan.textContent = isCollapsed ? '▶' : '▼';
				toggleSpan.on('click', e => {
					e.stopPropagation();
					const models = $('.group-models', groupEl);
					if (models.style.display === 'none') {
						models.style.display = 'block';
						toggleSpan.textContent = '▼';
					} else {
						models.style.display = 'none';
						toggleSpan.textContent = '▶';
					}
				});
				// 组名
				const nameSpan = mk('span', 'group-name');
				nameSpan.textContent = group.name;
				// tooltip内容（创建但不添加到DOM，hover时动态定位）
				const tooltipId = `tooltip-${group.id}`;
				const styleLabels = {
					'openai': 'OpenAI',
					'claude': 'Claude',
					'gemini': 'Gemini'
				};
				const tooltipHTML = `
      <div class="tooltip-row layout-x-queue">
        <span class="tooltip-label">名称：</span>
        <span class="tooltip-value">${group.name}</span>
        <button class="tooltip-copy" data-copy="${group.name}" title="复制">⧉</button>
      </div>
      <div class="tooltip-row layout-x-queue">
        <span class="tooltip-label">地址：</span>
        <span class="tooltip-value">${group.baseUrl}</span>
        <button class="tooltip-copy" data-copy="${group.baseUrl}" title="复制">⧉</button>
      </div>
      <div class="tooltip-row layout-x-queue">
        <span class="tooltip-label">格式：</span>
        <span class="tooltip-value">${styleLabels[group.style] || group.style}</span>
        <button class="tooltip-copy" data-copy="${group.style}" title="复制">⧉</button>
      </div>
    `;
				// 使用createTooltip
				const tooltip = createTooltip(tooltipId, tooltipHTML);
				// hover事件
				nameSpan.on('mouseenter', () => tooltip.show(nameSpan));
				nameSpan.on('mouseleave', () => tooltip.hide());
				// 点击展开/收起模型列表，同时隐藏tooltip
				nameSpan.on('click', () => {
					tooltip.hide();
					const models = $('.group-models', groupEl);
					if (models) {
						if (models.style.display === 'none') {
							models.style.display = 'block';
							toggleSpan.textContent = '▼';
						} else {
							models.style.display = 'none';
							toggleSpan.textContent = '▶';
						}
					}
				});
				// 操作按钮容器（不再包含添加模型按钮）
				const actionsEl = mk('div', 'group-actions layout-x-queue');
				// 批量测试连接按钮
				// 检查该端点下是否有模型正在测试中
				const hasTesting = group.models.some(model => {
					const statusKey = `${group.id}:${model.id}`;
					const statusData = connectionStatus.get(statusKey);
					return statusData && statusData.status === 'testing';
				});
				const batchTestBtn = mk('button');
				batchTestBtn.className = 'action batch-test' + (hasTesting ? ' testing' : '');
				batchTestBtn.innerHTML = hasTesting ? '<span class="spin">◐</span>' : '○';
				batchTestBtn.title = hasTesting ? '测试中...' : '批量测试连接';
				batchTestBtn.on('click', e => {
					e.stopPropagation();
					if (onTestConnection) {
						// 测试该端点下所有模型
						group.models.forEach(model => {
							onTestConnection(group.id, model.id);
						});
					}
				});
				// 编辑按钮
				const editBtn = mk('button', 'action');
				editBtn.innerHTML = SVG.edit(12);
				editBtn.title = '编辑端点';
				editBtn.on('click', e => {
					e.stopPropagation();
					onGroupEdit(group.id);
				});
				// 删除按钮
				const deleteBtn = mk('button', 'action danger');
				deleteBtn.innerHTML = SVG.del(12);
				deleteBtn.title = '删除端点';
				deleteBtn.on('click', e => {
					e.stopPropagation();
					confirmAction('确定删除该端点及其所有模型？', () => onGroupDelete(group.id));
				});
				actionsEl.addChild(batchTestBtn);
				actionsEl.addChild(editBtn);
				actionsEl.addChild(deleteBtn);
				headerEl.addChild(dragHandle);
				headerEl.addChild(toggleSpan);
				headerEl.addChild(nameSpan);
				headerEl.addChild(actionsEl);
				// 拖放目标事件绑定到整个groupEl
				groupEl.on('dragover', e => {
					e.preventDefault();
					e.dataTransfer.dropEffect = 'move';
					const draggingEl = $('.dragging', container);
					if (draggingEl && draggingEl !== groupEl) {
						groupEl.classList.add('drag-over');
					}
				});
				groupEl.on('dragleave', () => groupEl.classList.remove('drag-over'));
				groupEl.on('drop', e => {
					e.preventDefault();
					groupEl.classList.remove('drag-over');
					const draggedGroupId = e.dataTransfer.getData('text/plain');
					if (draggedGroupId !== group.id) {
						// 根据鼠标位置判断插入到目标之前还是之后
						const rect = groupEl.getBoundingClientRect();
						const midY = rect.top + rect.height / 2;
						const insertBefore = e.clientY < midY;
						onReorderGroups(draggedGroupId, group.id, insertBefore);
					}
				});
				const models = mk('div', 'group-models layout-y-queue');
				// 恢复收起状态
				if (isCollapsed) {
					models.style.display = 'none';
				}
				group.models.forEach((model, modelIndex) => {
					const modelEl = mk('div', 'model item layout-x-queue');
					modelEl.dataset.modelId = model.id;
					modelEl.dataset.groupId = group.id;
					if (model.id === selectedModelId) {
						modelEl.classList.add('selected');
					}
					// 模型拖动手柄
					const modelDragHandle = mk('span', 'drag-handle');
					modelDragHandle.innerHTML = SVG.drag(14);
					modelDragHandle.title = '拖动排序';
					modelDragHandle.draggable = true;
					modelDragHandle.on('dragstart', e => {
						e.dataTransfer.setData('text/plain', `${group.id}:${model.id}`);
						e.dataTransfer.effectAllowed = 'move';
						modelEl.classList.add('dragging');
					});
					modelDragHandle.on('dragend', () => {
						modelEl.classList.remove('dragging');
						$$('.model.item', models).forEach(el => el.classList.remove('drag-over'));
					});
					const modelName = mk('span', 'model name');
					modelName.textContent = model.name;
					// 模型名tooltip
					const modelTooltipId = `tooltip-model-${group.id}-${model.id}`;
					const modelTooltipHTML = `
        <div class="tooltip-row layout-x-queue">
          <span class="tooltip-label">模型：</span>
          <span class="tooltip-value">${model.name}</span>
          <button class="tooltip-copy" data-copy="${model.name}" title="复制">⧉</button>
        </div>
      `;
					const modelTooltip = createTooltip(modelTooltipId, modelTooltipHTML);
					modelName.on('mouseenter', () => modelTooltip.show(modelName));
					modelName.on('mouseleave', () => modelTooltip.hide());
					modelName.on('click', () => {
						modelTooltip.hide();
						if (onModelSelect) onModelSelect(group.id, model.id);
					});
					// 模型操作按钮
					const modelActions = mk('div', 'model actions layout-x-queue');
					// 测试连接按钮
					const statusKey = `${group.id}:${model.id}`;
					const statusData = connectionStatus.get(statusKey) || {
						status: 'disconnected'
					};
					const status = statusData.status;
					const testBtn = mk('button');
					testBtn.className = 'action-sm connection ' + status;
					testBtn.title = getConnectionStatusText(statusKey);
					testBtn.innerHTML = status === 'testing' ? '<span class="spin">◐</span>' : '○';
					testBtn.on('click', e => {
						e.stopPropagation();
						if (onTestConnection) onTestConnection(group.id, model.id);
					});
					const modelEditBtn = mk('button', 'action-sm');
					modelEditBtn.innerHTML = SVG.edit(10);
					modelEditBtn.title = '编辑模型';
					modelEditBtn.on('click', e => {
						e.stopPropagation();
						modelTooltip.hide();
						// 原地编辑：将模型名替换为输入框
						const existEdit = $('.add-model-inline', modelEl);
						if (existEdit) existEdit.remove();
						const inlineEdit = fromTemplate('tpl-add-model-inline', '.add-model-inline');
						const inputEl = $('.add-model-input', inlineEdit);
						inputEl.value = model.name;
						inputEl.placeholder = '模型名';
						// 替换模型名显示为编辑器
						modelDragHandle.style.display = 'none';
						modelName.style.display = 'none';
						modelActions.style.display = 'none';
						modelEl.insertBefore(inlineEdit, modelActions);
						inputEl.focus();
						inputEl.select();
						$('.add-model-confirm', inlineEdit).on('click', async e2 => {
							e2.stopPropagation();
							const newName = inputEl.value.trim();
							if (newName && newName !== model.name) {
								inlineEdit.remove();
								modelDragHandle.style.display = '';
								modelName.style.display = '';
								modelActions.style.display = '';
								onModelEdit(group.id, model.id, newName);
							} else {
								inlineEdit.remove();
								modelDragHandle.style.display = '';
								modelName.style.display = '';
								modelActions.style.display = '';
							}
						});
						$('.add-model-cancel', inlineEdit).on('click', e2 => {
							e2.stopPropagation();
							inlineEdit.remove();
							modelDragHandle.style.display = '';
							modelName.style.display = '';
							modelActions.style.display = '';
						});
						inputEl.on('keydown', e2 => {
							if (e2.key === 'Enter') {
								e2.preventDefault();
								$('.add-model-confirm', inlineEdit).click();
							} else if (e2.key === 'Escape') {
								inlineEdit.remove();
								modelDragHandle.style.display = '';
								modelName.style.display = '';
								modelActions.style.display = '';
							}
						});
					});
					const modelDeleteBtn = mk('button', 'action-sm danger');
					modelDeleteBtn.innerHTML = SVG.del(10);
					modelDeleteBtn.title = '删除模型';
					modelDeleteBtn.on('click', e => {
						e.stopPropagation();
						confirmAction('确定删除该模型？', () => onModelDelete(group.id, model.id));
					});
					modelActions.addChild(testBtn);
					modelActions.addChild(modelEditBtn);
					modelActions.addChild(modelDeleteBtn);
					modelEl.addChild(modelDragHandle);
					modelEl.addChild(modelName);
					modelEl.addChild(modelActions);
					// 模型拖放目标事件
					modelEl.on('dragover', e => {
						e.preventDefault();
						e.dataTransfer.dropEffect = 'move';
						const draggingEl = $('.dragging', models);
						if (draggingEl && draggingEl !== modelEl) {
							modelEl.classList.add('drag-over');
						}
					});
					modelEl.on('dragleave', () => modelEl.classList.remove('drag-over'));
					modelEl.on('drop', e => {
						e.preventDefault();
						e.stopPropagation();
						modelEl.classList.remove('drag-over');
						const data = e.dataTransfer.getData('text/plain');
						const [draggedGroupId, draggedModelId] = data.split(':');
						if (draggedGroupId === group.id && draggedModelId !== model.id && onReorderModels) {
							const rect = modelEl.getBoundingClientRect();
							const midY = rect.top + rect.height / 2;
							const insertBefore = e.clientY < midY;
							onReorderModels(group.id, draggedModelId, model.id, insertBefore);
						}
					});
					models.addChild(modelEl);
				});
				// 添加模型按钮放在模型列表底部
				const addModelBtn = mk('div', 'add-model-link');
				addModelBtn.textContent = '+ 添加模型';
				addModelBtn.on('click', e => {
					e.stopPropagation();
					// 显示内联输入框而非弹窗
					const existInput = $('.add-model-inline', models);
					if (existInput) existInput.remove();
					const inlineInput = fromTemplate('tpl-add-model-inline', '.add-model-inline');
					models.insertBefore(inlineInput, addModelBtn);
					const inputEl = $('.add-model-input', inlineInput);
					inputEl.focus();
					$('.add-model-confirm', inlineInput).on('click', async e2 => {
						e2.stopPropagation();
						const name = inputEl.value.trim();
						if (name) {
							inlineInput.remove();
							onAddModel(group.id, name);
						}
					});
					$('.add-model-cancel', inlineInput).on('click', e2 => {
						e2.stopPropagation();
						inlineInput.remove();
					});
					inputEl.on('keydown', e2 => {
						if (e2.key === 'Enter') {
							e2.preventDefault();
							$('.add-model-confirm', inlineInput).click();
						} else if (e2.key === 'Escape') {
							inlineInput.remove();
						}
					});
				});
				models.addChild(addModelBtn);
				groupEl.addChild(headerEl);
				groupEl.addChild(models);
				container.addChild(groupEl);
			});
		}

		function renderSessionList(sessions, selectedSessionId, onSessionSelect, onSessionEdit, onSessionDelete) {
			const container = $('#session-list');
			container.innerHTML = '';
			sessions.sort((a, b) => b.createdAt - a.createdAt);
			sessions.forEach(session => {
				const sessionEl = mk('article', 'session item');
				if (session.id === selectedSessionId) {
					sessionEl.classList.add('selected');
				}
				const titleEl = mk('div', 'session title');
				titleEl.textContent = session.title || '新会话';
				const meta = mk('div', 'session meta layout-x-queue');
				const timeEl = mk('span', 'session time');
				timeEl.textContent = new Date(session.createdAt).toLocaleDateString('zh-CN', {
					month: 'short',
					day: 'numeric'
				});
				// 操作按钮
				const actionsEl = mk('div', 'session actions layout-x-queue');
				const editBtn = mk('button', 'action-sm');
				editBtn.innerHTML = SVG.edit(10);
				editBtn.title = '编辑标题';
				editBtn.on('click', e => {
					e.stopPropagation();
					// 原地编辑：将标题替换为输入框
					const currentTitle = session.title || '新会话';
					const inputEl = mk('input', 'session title-edit');
					inputEl.type = 'text';
					inputEl.value = currentTitle;
					// 替换标题显示为编辑器
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
				const deleteBtn = mk('button', 'action-sm danger');
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
				copyBtn.className = 'code-copy-btn';
				copyBtn.innerHTML = SVG.copy;
				copyBtn.title = '复制代码';
				copyBtn.onclick = () => {
					navigator.clipboard.writeText(codeEl.textContent).then(() => {
						copyBtn.innerHTML = '✓';
						copyBtn.classList.add('copy-success');
						setTimeout(() => {
							copyBtn.innerHTML = SVG.copy;
							copyBtn.classList.remove('copy-success');
						}, 1500);
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
				const roleClass = msg.role === 'user' ? 'req' : 'res';
				const msgEl = mk('article', `message layout-y-queue ${roleClass} msg`);
				if (msg.role === 'user') {
					// 使用模板创建meta，包含复制按钮
					const meta = fromTemplate('tpl-user-meta', '.request.meta');
					const timeStr = msg.timestamp ? formatDateTime(msg.timestamp) : '';
					$('.request.time', meta).textContent = timeStr;
					msgEl.addChild(meta);
					// 提取文本内容
					const normalized = normalizeMessageContent(msg);
					const textItems = normalized.filter(c => c.type === 'text' || c.type === 'file_text');
					const textContent = textItems.map(c => c.text || '').join('\n');
					// 复制按钮事件
					const copyBtn = $('.copy-btn', meta);
					copyBtn.onclick = () => {
						navigator.clipboard.writeText(textContent).then(() => {
							copyBtn.innerHTML = '✓';
							copyBtn.classList.add('copy-success');
							setTimeout(() => {
								copyBtn.innerHTML = SVG.copy;
								copyBtn.classList.remove('copy-success');
							}, 1500);
						});
					};
					if (textContent) {
						const userEl = mk('div', 'message-user');
						userEl.textContent = textContent;
						msgEl.addChild(userEl);
					}
					// 渲染附件（非 text/file_text 类型）
					const attachmentItems = normalized.filter(c => c.type === 'image' || c.type === 'file');
					if (attachmentItems.length > 0) {
						const attContainer = mk('div', 'message-attachments layout-x-queue');
						attachmentItems.forEach(att => {
							const attEl = mk('div', `message-attachment layout-x-queue ${att.type}`);
							if (att.type === 'image' && att.source) {
								let imgSrc;
								if (att.source.type === 'url') {
									imgSrc = att.source.url;
								} else {
									imgSrc = `data:${att.source.media_type};base64,${att.source.data}`;
								}
								const thumb = mk('img', 'message-attachment-thumb');
								thumb.src = imgSrc;
								thumb.onclick = () => {
									// 点击查看大图
									const overlay = mk('div', 'image-preview-overlay layout-x-queue');
									const fullImg = mk('img');
									fullImg.src = imgSrc;
									overlay.onclick = () => overlay.remove();
									overlay.addChild(fullImg);
									doc.body.addChild(overlay);
								};
								attEl.addChild(thumb);
								const nameEl = mk('span', 'message-attachment-name');
								nameEl.textContent = att.name || '图片';
								attEl.addChild(nameEl);
							} else if (att.type === 'file' && att.source) {
								const fileIcon = mk('span');
								fileIcon.textContent = '📄';
								attEl.addChild(fileIcon);
								const nameEl = mk('span', 'message-attachment-name');
								nameEl.textContent = att.name || '文件';
								attEl.addChild(nameEl);
								attEl.onclick = () => {
									// 下载文件
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
				} else {
					// 检测消息格式
					if (msg.responses && Array.isArray(msg.responses)) {
						renderMultiModelResponse(msgEl, msg, groups, onCopy);
					} else {
						renderSingleModelResponse(msgEl, msg, groups, onCopy); // 向后兼容
					}
				}
				container.addChild(msgEl);
			});
			container.scrollTop = container.scrollHeight;
		}

		function renderSingleModelResponse(msgEl, msg, groups, onCopy) {
			const timeStr = msg.timestamp ? formatDateTime(msg.timestamp) : '';
			const info = msg.endpointGroupId && msg.modelId ? findModelById(groups, `${msg.endpointGroupId}:${msg.modelId}`) : null;
			const modelName = info ? `${info.group.name} / ${info.model.name}` : '未知模型';
			// Response meta row with name, time, copy button
			const meta = fromTemplate('tpl-response-meta', '.response.meta');
			$('.response.model-name', meta).textContent = modelName;
			$('.response.time', meta).textContent = timeStr;
			const copyBtn = $('.copy-btn', meta);
			copyBtn.onclick = () => {
				navigator.clipboard.writeText(msg.content || '').then(() => {
					copyBtn.innerHTML = '✓';
					copyBtn.classList.add('copy-success');
					setTimeout(() => {
						copyBtn.innerHTML = SVG.copy;
						copyBtn.classList.remove('copy-success');
					}, 1500);
				});
			};
			msgEl.addChild(meta);
			const assistantEl = mk('div', 'message-assistant');
			assistantEl.innerHTML = renderMarkdown(msg.content || '');
			msgEl.addChild(assistantEl);
			addCodeCopyButtons(assistantEl);
			// Status bar: usage info if available
			if (msg.usage) {
				const statusBar = mk('div', 'message-status-bar layout-x-queue');
				const usageEl = mk('span', 'message-usage');
				usageEl.textContent = `${msg.usage.input || 0} → ${msg.usage.output || 0} tokens`;
				statusBar.addChild(usageEl);
				msgEl.addChild(statusBar);
			}
		}

		function renderMultiModelResponse(msgEl, msg, groups, onCopy) {
			const sorted = [...msg.responses].sort((a, b) => (a.firstTokenTime ?? Infinity) - (b.firstTokenTime ?? Infinity));
			const hint = mk('div', 'multi-response-hint');
			hint.textContent = `${sorted.length}个模型回复`;
			msgEl.addChild(hint);
			const cards = mk('div', 'multi-response-cards layout-y-queue');
			sorted.forEach(r => {
				const card = mk('div', 'response card');
				const info = findModelById(groups, r.modelId);
				const name = info ? `${info.group.name} / ${info.model.name}` : '未知';
				// Response meta row with model name, time, duration, copy button
				const meta = fromTemplate('tpl-multi-response-meta', '.response.meta');
				const durationStr = r.firstTokenTime ? `反应${(r.firstTokenTime/1000).toFixed(1)}s` : '';
				const totalStr = r.totalDuration ? `耗时${(r.totalDuration/1000).toFixed(1)}s` : '';
				const statusText = getStatusText(r.status);
				const responseTimeStr = r.timestamp ? formatDateTime(r.timestamp) : '';
				const errorText = r.status === 'failed' ? (r.error || '未知错误') : '';
				const speedClass = getSpeedClass(r.firstTokenTime);
				$('.response.model-name', meta).textContent = name;
				$('.response.time', meta).textContent = responseTimeStr;
				const durationEl = $('.response.duration', meta);
				durationEl.textContent = durationStr;
				if (speedClass) durationEl.classList.add(speedClass);
				$('.response.total', meta).textContent = totalStr;
				const statusEl = $('.response.status', meta);
				statusEl.textContent = statusText;
				statusEl.classList.add('status');
				statusEl.classList.add(r.status);
				const errorEl = $('.response.error', meta);
				if (errorText) {
					errorEl.textContent = errorText;
				} else {
					errorEl.remove();
				}
				// Only add copy button for completed responses with content
				const copyBtn = $('.copy-btn', meta);
				if (r.status === 'completed' && r.content) {
					copyBtn.onclick = () => {
						navigator.clipboard.writeText(r.content || '').then(() => {
							copyBtn.innerHTML = '✓';
							copyBtn.classList.add('copy-success');
							setTimeout(() => {
								copyBtn.innerHTML = SVG.copy;
								copyBtn.classList.remove('copy-success');
							}, 1500);
						});
					};
				} else {
					copyBtn.remove();
				}
				card.addChild(meta);
				// Thinking block（如果有thinking内容）
				if (r.thinking && r.thinking.trim()) {
					const thinkingBlock = mk('div', 'thinking-block collapsed');
					const thinkingHeader = fromTemplate('tpl-thinking-header', '.thinking-header');
					thinkingHeader.onclick = function() {
						toggleThinking(this);
					};
					const thinkingDurationStr = r.thinkingDuration ? `耗时 ${(r.thinkingDuration/1000).toFixed(1)}s` : '';
					$('.thinking-duration', thinkingHeader).textContent = thinkingDurationStr;
					const thinkingContent = mk('div', 'thinking-content');
					thinkingContent.textContent = r.thinking;
					thinkingBlock.addChild(thinkingHeader);
					thinkingBlock.addChild(thinkingContent);
					card.addChild(thinkingBlock);
				}
				const content = mk('div', 'response card-content');
				if (r.status === 'failed') {
					content.innerHTML = ''; // Error shown in meta row, content area empty
				} else {
					content.innerHTML = renderMarkdown(r.content || '');
					addCodeCopyButtons(content);
				}
				card.addChild(content);
				cards.addChild(card);
			});
			msgEl.addChild(cards);
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
			const el = $('#chat-title');
			el.textContent = title || '新会话';
		}

		function getInputContent() {
			const input = $('#chat-input');
			return input.value.trim();
		}
		// 获取完整消息内容（包含文本和附件）
		async function getInputMessage() {
			const input = $('#chat-input');
			const text = input.value.trim();
			// 构建消息内容数组
			const content = [];
			// 添加文本（如果有）
			if (text) {
				content.push({
					type: 'text',
					text
				});
			}
			// 处理附件
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
		// ========== 附件处理辅助函数 ==========
		// 附件类型判断
		function isTextFile(filename) {
			const textExtensions = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.scss', '.sass', '.less', '.html', '.htm', '.xml', '.yaml', '.yml', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.lua', '.r', '.vue', '.svelte'];
			const dotIndex = filename.lastIndexOf('.');
			const ext = dotIndex > 0 ? filename.toLowerCase().slice(dotIndex) : '';
			return textExtensions.includes(ext);
		}

		function getMediaType(filename) {
			const dotIndex = filename.lastIndexOf('.');
			const ext = dotIndex > 0 ? filename.toLowerCase().slice(dotIndex) : '';
			const imageTypes = {
				'.jpg': 'image/jpeg',
				'.jpeg': 'image/jpeg',
				'.png': 'image/png',
				'.gif': 'image/gif',
				'.webp': 'image/webp',
				'.bmp': 'image/bmp',
				'.svg': 'image/svg+xml'
			};
			if (imageTypes[ext]) return imageTypes[ext];
			const fileTypes = {
				'.pdf': 'application/pdf',
				'.doc': 'application/msword',
				'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				'.xls': 'application/vnd.ms-excel',
				'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			};
			if (fileTypes[ext]) return fileTypes[ext];
			return 'application/octet-stream';
		}
		// 读取文件为 base64
		async function fileToBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const data = reader.result.split(',')[1]; // 去掉 data:xxx;base64, 前缀
					resolve(data);
				};
				reader.onerror = reject;
				reader.readAsDataURL(file);
			});
		}
		// 带超时的 fetch
		async function fetchWithTimeout(url, options, timeout = 60000) {
			if (isExtension && window.__EXTENSION_FETCH__) {
				try {
					const res = await window.__EXTENSION_FETCH__(url, options);
					return res;
				} catch (e) {
					throw e;
				}
			}
			const controller = new AbortController();
			const id = setTimeout(() => controller.abort(), timeout);
			// 合并外部 signal（如用户取消）
			const externalSignal = options?.signal;
			if (externalSignal) {
				externalSignal.addEventListener('abort', () => controller.abort());
			}
			try {
				const res = await fetch(url, {
					...options,
					signal: controller.signal
				});
				clearTimeout(id);
				return res;
			} catch (e) {
				clearTimeout(id);
				if (e.name === 'AbortError') throw new Error('请求超时或已取消');
				throw e;
			}
		}
		// 读取文本文件内容
		async function fileToText(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result);
				reader.onerror = reject;
				reader.readAsText(file);
			});
		}
		// 添加附件
		async function addAttachment(file) {
			const isImage = getMediaType(file.name).startsWith('image/');
			const isText = isTextFile(file.name);
			const attachment = {
				id: generateUUID(),
				name: file.name,
				type: isImage ? 'image' : (isText ? 'file_text' : 'file'),
				file: file, // 临时存储 File 对象，用于缩略图和预览
				mediaType: getMediaType(file.name),
				previewUrl: null // 缩略图 URL（图片用）
			};
			// 图片生成缩略图 URL
			if (isImage) {
				attachment.previewUrl = await new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result);
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});
			}
			pendingAttachments.push(attachment);
			renderPendingAttachments();
		}
		// 删除附件
		function removeAttachment(id) {
			pendingAttachments = pendingAttachments.filter(a => a.id !== id);
			renderPendingAttachments();
		}
		// 清空附件
		function clearAttachments() {
			pendingAttachments = [];
			renderPendingAttachments();
		}

		function clearInput() {
			const input = $('#chat-input');
			input.value = '';
		}

		function setButtonState(sendDisabled, stopEnabled) {
			$('#btn-send').disabled = sendDisabled;
			const stopBtn = $('#btn-stop');
			stopBtn.disabled = !stopEnabled;
			stopBtn.textContent = stopEnabled ? '全部停止' : '停止';
		}

		function showEditGroupDialog(group = null, onSave) {
			const exist = $('#edit-dialog');
			if (exist) exist.remove();
			const dialog = fromTemplate('tpl-edit-group-dialog', '#edit-dialog');
			$('h3', dialog).textContent = group ? '编辑端点' : '新增端点';
			setValues(dialog, {
				'#dialog-group-name': group?.name,
				'#dialog-group-url': group?.baseUrl,
				'#dialog-group-style': group?.style ?? 'openai',
				'#dialog-group-key': group?.key
			});
			const keyInput = $('#dialog-group-key', dialog);
			doc.body.addChild(dialog);
			const toggleBtn = $('button.toggle-key', dialog);
			toggleBtn.onclick = e => {
				e.preventDefault();
				const isPassword = keyInput.type === 'password';
				keyInput.type = isPassword ? 'text' : 'password';
				toggleBtn.innerHTML = isPassword ? SVG.eyeOff : SVG.eye;
			};
			onClick({
				'#dialog-cancel': () => dialog.remove(),
				'#dialog-save': () => {
					const name = $('#dialog-group-name', dialog).value.trim();
					const baseUrl = $('#dialog-group-url', dialog).value.trim();
					const style = $('#dialog-group-style', dialog).value;
					const key = keyInput.value.trim();
					if (!name || !baseUrl) {
						alert('请填写名称和Base URL');
						return;
					}
					onSave({
						name,
						baseUrl,
						style,
						key
					});
					dialog.remove();
				}
			}, dialog);
		}

		function showDirectoryPrompt(hasPendingHandle = false) {
			// 无目录时调用帮助弹窗，强制选择目录
			showHelpDialog(true, hasPendingHandle);
		}

		function hideDirectoryPrompt() {
			const prompt = $('#help-dialog');
			if (prompt) prompt.remove();
		}

		function showHelpDialog(forceSelectDirectory = false, hasPendingHandle = false) {
			const exist = $('#help-dialog');
			if (exist) exist.remove();
			// 创建遮罩
			const overlay = mk('div', 'dialog-overlay');
			if (forceSelectDirectory) {
				overlay.style.background = 'rgba(0, 0, 0, 0.5)';
			}
			doc.body.addChild(overlay);
			const dialog = fromTemplate('tpl-help-dialog', '#help-dialog');
			const dirName = storage.getDirectoryName();
			const displayInfo = storage.getDisplayInfo();
			const hasDir = storage.mode === 'directory';
			$('#help-dir-name', dialog).textContent = '当前存储：' + displayInfo.text + (hasDir ? '' : '（浏览器存储）');
			$('#help-dir-name', dialog).title = displayInfo.title;
			const changeDirBtn = $('#btn-change-dir-help', dialog);
			changeDirBtn.textContent = hasDir ? '更换目录' : '选择目录存储';
			const restoreBtn = $('#btn-restore-dir', dialog);
			if (restoreBtn) {
				restoreBtn.onclick = async () => {
					const result = await tryRestoreDirectory();
					if (result.success) {
						const dispInfo = storage.getDisplayInfo();
						$('#help-dir-name', dialog).textContent = '当前存储：' + dispInfo.text;
						$('#help-dir-name', dialog).title = dispInfo.title;
						updateDirectoryDisplay();
						await refreshUI();
						closeHelpDialog(dialog, overlay, true);
					} else {
						alert('权限请求失败，请选择新目录');
					}
				};
				if (!hasPendingHandle) restoreBtn.remove();
			}
			const warningEl = $('#help-directory-warning', dialog);
			if (!forceSelectDirectory) warningEl.remove();
			const closeBtn = $('#help-close', dialog);
			if (closeBtn) {
				closeBtn.onclick = () => closeHelpDialog(dialog, overlay, false);
				overlay.onclick = () => closeHelpDialog(dialog, overlay, false);
				if (forceSelectDirectory) closeBtn.remove();
			}
			doc.body.addChild(dialog);
			// 选择/更换目录按钮
			changeDirBtn.onclick = async () => {
				const success = await selectDirectory();
				if (success) {
					const dispInfo2 = storage.getDisplayInfo();
					$('#help-dir-name', dialog).textContent = '当前存储：' + dispInfo2.text;
					$('#help-dir-name', dialog).title = dispInfo2.title;
					updateDirectoryDisplay();
					await refreshUI();
					if (forceSelectDirectory) {
						closeHelpDialog(dialog, overlay, true);
					}
				}
			};

			// 使用浏览器存储按钮
			const browserBtn = $("#btn-use-browser-storage", dialog);
			if (browserBtn) {
				browserBtn.onclick = async () => {
					await storage.selectMode("browser");
					endpointsData = await storage.loadEndpoints();
					const sessions = await storage.loadSessions();
					sessions.forEach(s => sessionsCache.set(s.id, s));
					updateDirectoryDisplay();
					await refreshUI();
					closeHelpDialog(dialog, overlay, true);
				};
				}
			}

		function closeHelpDialog(dialog, overlay, immediate = false) {
			const helpBtn = $('#btn-help');
			if (!helpBtn) {
				dialog.remove();
				overlay.remove();
				return;
			}
			const btnRect = helpBtn.getBoundingClientRect();
			const dialogRect = dialog.getBoundingClientRect();
			if (!immediate) {
				// 计算按钮中心位置
				const btnCenterX = btnRect.left + btnRect.width / 2;
				const btnCenterY = btnRect.top + btnRect.height / 2;
				// 计算对话框中心位置
				const dialogCenterX = dialogRect.left + dialogRect.width / 2;
				const dialogCenterY = dialogRect.top + dialogRect.height / 2;
				// 计算需要移动的距离
				const translateX = btnCenterX - dialogCenterX;
				const translateY = btnCenterY - dialogCenterY;
				// 设置动画 - 不改变透明度
				dialog.style.setProperty('transition', 'transform 0.4s ease-in', 'important');
				dialog.style.setProperty('transform-origin', 'center center', 'important');
				// 强制浏览器重新计算样式
				dialog.offsetHeight;
				// 设置最终状态 - 缩小到按钮位置
				dialog.style.setProperty('transform', `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px)) scale(0.05)`, 'important');
				setTimeout(() => {
					dialog.remove();
					overlay.remove();
				}, 400);
			} else {
				dialog.remove();
				overlay.remove();
			}
		}
		// 测试连接状态
		const connectionStatus = new Map(); // groupId:modelId -> { status, timestamp }
		function getConnectionStatusText(key) {
			const data = connectionStatus.get(key);
			if (!data) return '测试连接：未测试';
			const statusText = {
				'testing': '测试中...',
				'connected': '✓ 连接成功',
				'failed': '✗',
				'cors_blocked': '⚠ 该端点禁止浏览器直连'
			};
			const text = statusText[data.status] || '未测试';
			const timeStr = data.timestamp ? formatDateTime(data.timestamp) : '';
			const errorInfo = data.error ? ` (${data.error})` : '';
			return data.status === 'testing' ? '测试连接：测试中...' : `测试连接：${text}${errorInfo}（${timeStr}）`;
		}
		async function testConnection(groupId, modelId) {
			const group = getGroup(groupId);
			const model = getModel(groupId, modelId);
			if (!group || !model) return;
			const provider = providers[group.style];
			if (!provider) return;
			const key = groupId + ':' + modelId;
			connectionStatus.set(key, {
				status: 'testing',
				timestamp: null
			});
			renderEndpointList(getGroups(), null, null, handleModelEdit, handleGroupEdit, handleGroupDelete, handleAddModelForGroup, handleModelDelete, handleReorderGroups, handleReorderModels, testConnection);
			try {
				const config = provider.testConfig(group.baseUrl, group.key, model.name);
				const res = await fetchWithTimeout(config.url, {
					method: 'POST',
					headers: config.headers,
					body: JSON.stringify(config.body)
				}, 30000);
				if (res && res.ok) {
					connectionStatus.set(key, {
						status: 'connected',
						timestamp: Date.now()
					});
				} else {
					let errorMsg = 'HTTP ' + res.status;
					try {
						const errorBody = await res.text();
						try {
							const errorJson = JSON.parse(errorBody);
							if (errorJson.error && errorJson.error.message) {
								errorMsg = errorJson.error.message;
							} else if (errorJson.message) {
								errorMsg = errorJson.message;
							}
						} catch (e) {
							if (errorBody && errorBody.length < 100) {
								errorMsg = errorBody;
							}
						}
					} catch (e) {}
					connectionStatus.set(key, {
						status: 'failed',
						timestamp: Date.now(),
						error: errorMsg
					});
				}
			} catch (err) {
				const isCorsError = err instanceof TypeError && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.name === 'TypeError');
				connectionStatus.set(key, {
					status: isCorsError ? 'cors_blocked' : 'failed',
					timestamp: Date.now(),
					error: isCorsError ? null : err.message
				});
			}
			renderEndpointList(getGroups(), null, null, handleModelEdit, handleGroupEdit, handleGroupDelete, handleAddModelForGroup, handleModelDelete, handleReorderGroups, handleReorderModels, testConnection);
		}
		// ========== Store Functions ==========
		let endpointsData = null;
		let sessionsCache = new Map();
		async function clearDirectory() {
			endpointsData = {
				groups: []
			};
			sessionsCache.clear();
			await storage.clearAll();
			updateDirectoryDisplay();
			await refreshUI();
		}
		async function tryRestoreDirectory() {
			const result = await storage.init();
			if (result.mode === null) {
				return { success: false, needUserAction: true };
			}
			endpointsData = await storage.loadEndpoints();
			const sessions = await storage.loadSessions();
			sessions.forEach(s => sessionsCache.set(s.id, s));
			updateDirectoryDisplay();
			await refreshUI();
			return { success: true };
		}

		function generateUUID() {
			return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
				const r = Math.random() * 16 | 0;
				const v = c === 'x' ? r : (r & 0x3 | 0x8);
				return v.toString(16);
			});
		}
		async function selectDirectory() {
			try {
				const handle = await window.showDirectoryPicker({
					mode: 'readwrite'
				});
				await storage.selectMode('directory', handle);
				await loadEndpoints();
				await loadSessionsIndex();
				return true;
			} catch (err) {
				console.error('选择目录失败:', err);
				return false;
			}
		}
		async function loadEndpoints() {
			endpointsData = await storage.loadEndpoints();
			return endpointsData;
		}
		async function saveEndpoints() {
			return await storage.saveEndpoints(endpointsData);
		}

		function getGroups() {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			return endpointsData.groups || [];
		}
		async function addGroup(name, baseUrl, style, key) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			if (storage.mode !== 'browser' && !storage.getDirectoryName()) {
				alert('请先选择存储目录');
				return null;
			}
			const group = {
				id: generateUUID(),
				name,
				baseUrl,
				style,
				key,
				models: []
			};
			endpointsData.groups.push(group);
			await saveEndpoints();
			return group;
		}
		async function updateGroup(groupId, updates) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			const group = endpointsData.groups.find(g => g.id === groupId);
			if (group) {
				Object.assign(group, updates);
				await saveEndpoints();
				return group;
			}
			return null;
		}
		async function deleteGroup(groupId) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			const index = endpointsData.groups.findIndex(g => g.id === groupId);
			if (index >= 0) {
				endpointsData.groups.splice(index, 1);
				await saveEndpoints();
				return true;
			}
			return false;
		}
		async function reorderGroups(draggedId, targetId, insertBefore = true) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			const draggedIndex = endpointsData.groups.findIndex(g => g.id === draggedId);
			const targetIndex = endpointsData.groups.findIndex(g => g.id === targetId);
			if (draggedIndex >= 0 && targetIndex >= 0) {
				const [draggedGroup] = endpointsData.groups.splice(draggedIndex, 1);
				// 如果从前往后拖且insertBefore为true，需要调整位置
				// 如果从后往前拖且insertBefore为false，也需要调整
				let insertIndex = targetIndex;
				if (draggedIndex < targetIndex) {
					insertIndex = insertBefore ? targetIndex - 1 : targetIndex;
				} else if (draggedIndex > targetIndex) {
					insertIndex = insertBefore ? targetIndex : targetIndex + 1;
				}
				endpointsData.groups.splice(insertIndex, 0, draggedGroup);
				await saveEndpoints();
				return true;
			}
			return false;
		}
		async function addModel(groupId, modelName) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			const group = endpointsData.groups.find(g => g.id === groupId);
			if (group) {
				const model = {
					id: generateUUID(),
					name: modelName
				};
				group.models.push(model);
				await saveEndpoints();
				return model;
			}
			return null;
		}
		async function updateModel(groupId, modelId, newName) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			const group = endpointsData.groups.find(g => g.id === groupId);
			const model = group?.models?.find(m => m.id === modelId);
			if (model) {
				model.name = newName;
				await saveEndpoints();
				return model;
			}
			return null;
		}
		async function deleteModel(groupId, modelId) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			const group = endpointsData.groups.find(g => g.id === groupId);
			if (group) {
				const index = group.models?.findIndex(m => m.id === modelId) ?? -1;
				if (index >= 0) {
					group.models.splice(index, 1);
					await saveEndpoints();
					return true;
				}
			}
			return false;
		}
		async function reorderModels(groupId, draggedModelId, targetModelId, insertBefore) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			const group = endpointsData.groups.find(g => g.id === groupId);
			if (!group || !group.models) return false;
			const draggedIndex = group.models.findIndex(m => m.id === draggedModelId);
			const targetIndex = group.models.findIndex(m => m.id === targetModelId);
			if (draggedIndex >= 0 && targetIndex >= 0) {
				const [draggedModel] = group.models.splice(draggedIndex, 1);
				let insertIndex = targetIndex;
				if (draggedIndex < targetIndex) {
					insertIndex = insertBefore ? targetIndex - 1 : targetIndex;
				} else if (draggedIndex > targetIndex) {
					insertIndex = insertBefore ? targetIndex : targetIndex + 1;
				}
				group.models.splice(insertIndex, 0, draggedModel);
				await saveEndpoints();
				return true;
			}
			return false;
		}

		function getModel(groupId, modelId) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			const group = endpointsData.groups.find(g => g.id === groupId);
			return group?.models?.find(m => m.id === modelId);
		}

		function getGroup(groupId) {
			if (!endpointsData) endpointsData = {
				groups: []
			};
			return endpointsData.groups.find(g => g.id === groupId);
		}
		async function loadSessionsIndex() {
			const sessions = await storage.loadSessions();
			sessionsCache.clear();
			sessions.forEach(s => sessionsCache.set(s.id, s));
			return sessions;
		}

		function getAllSessions() {
			return Array.from(sessionsCache.values());
		}
		async function createSession(firstMessage = null, targetModels = null) {
			// 从第一条消息提取标题
			let title = '新会话';
			if (firstMessage) {
				if (Array.isArray(firstMessage)) {
					const firstText = firstMessage.find(c => c.type === 'text' || c.type === 'file_text');
					title = firstText ? firstText.text.slice(0, 20) : '新会话';
				} else if (typeof firstMessage === 'string') {
					title = firstMessage.slice(0, 20);
				}
			}
			const session = {
				id: generateUUID(),
				title,
				createdAt: Date.now(),
				messages: []
			};
			if (firstMessage) {
				// 使用标准数组格式
				let content;
				if (Array.isArray(firstMessage)) {
					content = firstMessage;
				} else if (typeof firstMessage === 'string') {
					content = [{
						type: 'text',
						text: firstMessage
					}];
				} else {
					content = [{
						type: 'text',
						text: String(firstMessage)
					}];
				}
				const msg = {
					role: 'user',
					content,
					timestamp: Date.now()
				};
				if (targetModels) {
					msg.targetModels = targetModels;
				}
				session.messages.push(msg);
			}
			sessionsCache.set(session.id, session);
			await saveSession(session);
			return session;
		}
		async function loadSession(sessionId) {
			if (sessionsCache.has(sessionId)) {
				return sessionsCache.get(sessionId);
			}
			const session = await storage.loadSession(sessionId);
			if (session) sessionsCache.set(sessionId, session);
			return session;
		}
		async function saveSession(session) {
			sessionsCache.set(session.id, session);
			return await storage.saveSession(session);
		}
		// 辅助函数：确保消息 content 为数组格式
		function normalizeMessageContent(msg) {
			if (!msg.content) return [{
				type: 'text',
				text: ''
			}];
			if (typeof msg.content === 'string') {
				return [{
					type: 'text',
					text: msg.content
				}];
			}
			if (Array.isArray(msg.content)) {
				return msg.content;
			}
			return [{
				type: 'text',
				text: String(msg.content)
			}];
		}
		async function addMessage(sessionId, role, content, options = {}) {
			const session = sessionsCache.get(sessionId);
			if (!session) return null;
			const message = {
				role,
				timestamp: Date.now()
			};
			// content 改造：支持字符串或数组
			if (typeof content === 'string') {
				// 纯文本，转换为标准数组格式
				message.content = [{
					type: 'text',
					text: content
				}];
			} else if (Array.isArray(content)) {
				// 已经是数组格式，直接使用
				message.content = content;
			} else {
				// 兼容旧格式或其他情况
				message.content = [{
					type: 'text',
					text: content || ''
				}];
			}
			if (role === 'user') {
				// 用户消息：记录targetModels
				if (options.targetModels) {
					message.targetModels = options.targetModels;
				}
			} else if (role === 'assistant') {
				// 助手消息：多模型responses数组
				if (options.responses) {
					message.responses = options.responses;
				}
				// 兼容旧格式：单模型消息
				if (options.modelId && !options.responses) {
					message.modelId = options.modelId;
					message.endpointGroupId = options.endpointGroupId;
					if (options.usage) message.usage = options.usage;
				}
			}
			// 更新标题：从第一个 text 块提取
			if (role === 'user' && session.messages.filter(m => m.role === 'user').length === 1) {
				const firstText = message.content.find(c => c.type === 'text');
				session.title = firstText ? firstText.text.slice(0, 20) : '新会话';
			}
			session.messages.push(message);
			await saveSession(session);
			return message;
		}

		function getSession(sessionId) {
			return sessionsCache.get(sessionId);
		}
		async function deleteSession(sessionId) {
			sessionsCache.delete(sessionId);
			return await storage.deleteSession(sessionId);
		}
		// ========== API Functions ==========
		// 获取指定会话的生成状态Map
		function getSessionGenerations(sessionId) {
			if (!sessionGenerations.has(sessionId)) {
				sessionGenerations.set(sessionId, new Map());
			}
			return sessionGenerations.get(sessionId);
		}
		// 清除指定会话的所有生成状态（中止请求并清空Map）
		function clearSessionGenerations(sessionId) {
			const gens = sessionGenerations.get(sessionId);
			if (gens) {
				gens.forEach(state => {
					if (state.abortController && state.status === 'generating') {
						state.abortController.abort();
					}
				});
				gens.clear();
			}
		}
		// 删除指定会话的生成状态Map（中止请求并删除整个子Map）
		function deleteSessionGenerations(sessionId) {
			clearSessionGenerations(sessionId);
			sessionGenerations.delete(sessionId);
		}
		let currentAbortController = null;

		function stopSingleGeneration(sessionId, modelId) {
			const gens = sessionGenerations.get(sessionId);
			if (!gens) return;
			const state = gens.get(modelId);
			if (state && state.abortController && state.status === 'generating') {
				state.abortController.abort();
			}
		}

		function stopSessionGenerations(sessionId) {
			clearSessionGenerations(sessionId);
		}
		// 兼容：停止当前会话的所有生成
		function stopAllGenerations() {
			if (currentSession) {
				stopSessionGenerations(currentSession.id);
			}
		}
		// OpenAI 消息格式转换
		function toOpenAIContent(contentArray) {
			return contentArray.map(item => {
				if (item.type === 'text' || item.type === 'file_text') {
					return {
						type: 'text',
						text: item.text || ''
					};
				}
				if (item.type === 'image') {
					if (!item.source) {
						return {
							type: 'text',
							text: `[图片 ${item.name || '未知'}，数据缺失]`
						};
					}
					let imageUrl;
					if (item.source.type === 'url') {
						imageUrl = item.source.url;
					} else {
						imageUrl = `data:${item.source.media_type};base64,${item.source.data}`;
					}
					return {
						type: 'image_url',
						image_url: {
							url: imageUrl
						}
					};
				}
				if (item.type === 'file') {
					if (!item.source) {
						return {
							type: 'text',
							text: `[文件 ${item.name || '未知'}，数据缺失]`
						};
					}
					const url = `data:${item.source.media_type};base64,${item.source.data}`;
					return {
						type: 'image_url',
						image_url: {
							url
						}
					};
				}
				// 不支持的类型，降级为文本提示
				return {
					type: 'text',
					text: `[附件 ${item.name || '未知'}，不支持此类型]`
				};
			});
		}
		// ========== 共享框架函数 ==========
		function createInitialState() {
			return {
				thinking: '',
				content: '',
				phase: 'content',
				thinkingStartTime: null,
				firstContentTokenTime: null,
				thinkingDuration: null
			};
		}

		function createTagParser() {
			return {
				buffer: '',
				inThinking: false,
				currentTag: null
			};
		}

		function processWithTagParser(chunk, state, parser, onChunk) {
			parser.buffer += chunk;
			if (!parser.inThinking) {
				for (const tag of THINKING_TAGS) {
					const idx = parser.buffer.indexOf(tag.start);
					if (idx !== -1) {
						parser.inThinking = true;
						parser.currentTag = tag;
						state.thinkingStartTime = Date.now();
						state.phase = 'thinking';
						if (idx > 0) state.content += parser.buffer.slice(0, idx);
						parser.buffer = parser.buffer.slice(idx + tag.start.length);
						break;
					}
				}
			}
			if (parser.inThinking && parser.currentTag) {
				const endIdx = parser.buffer.indexOf(parser.currentTag.end);
				if (endIdx !== -1) {
					state.thinking += parser.buffer.slice(0, endIdx);
					parser.buffer = parser.buffer.slice(endIdx + parser.currentTag.end.length);
					parser.inThinking = false;
					parser.currentTag = null;
					state.phase = 'content';
					state.thinkingDuration = Date.now() - state.thinkingStartTime;
					if (state.firstContentTokenTime === null) state.firstContentTokenTime = Date.now();
				} else {
					state.thinking += parser.buffer;
					parser.buffer = '';
				}
			} else if (!parser.inThinking) {
				state.content += parser.buffer;
				parser.buffer = '';
			}
			if (state.firstContentTokenTime === null) state.firstContentTokenTime = Date.now();
			onChunk(state);
		}

		function handleParsedChunk(parsed, state, tagParser, onChunk) {
			// 事件类型处理（Claude 原生 thinking）
			if (parsed.event === 'thinking_start') {
				state.phase = 'thinking';
				state.thinkingStartTime = Date.now();
				return;
			}
			if (parsed.event === 'content_start') {
				state.phase = 'content';
				if (state.firstContentTokenTime === null) state.firstContentTokenTime = Date.now();
				return;
			}
			// 原生 reasoning（DeepSeek/Claude thinking_delta）
			if (parsed.reasoning) {
				if (!state.thinkingStartTime) {
					state.thinkingStartTime = Date.now();
					state.phase = 'thinking';
				}
				state.thinking += parsed.reasoning;
				onChunk(state);
				return;
			}
			// 内容处理
			if (parsed.content) {
				if (state.thinkingStartTime && state.thinkingDuration === null && state.phase === 'thinking') {
					state.thinkingDuration = Date.now() - state.thinkingStartTime;
					state.phase = 'content';
				}
				if (tagParser) {
					processWithTagParser(parsed.content, state, tagParser, onChunk);
				} else {
					state.content += parsed.content;
					if (state.firstContentTokenTime === null) state.firstContentTokenTime = Date.now();
					onChunk(state);
				}
			}
		}
		async function processSSEStream(res, provider, state, tagParser, onChunk) {
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const {
					done,
					value
				} = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, {
					stream: true
				});
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';
				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					const data = line.slice(6);
					if (data === '[DONE]') continue;
					try {
						const json = JSON.parse(data);
						const parsed = provider.parseChunk(json);
						if (!parsed) continue;
						handleParsedChunk(parsed, state, tagParser, onChunk);
					} catch (e) {}
				}
			}
			// 处理未结束的 thinking
			if (tagParser && tagParser.inThinking && tagParser.buffer) {
				state.thinking += tagParser.buffer;
			}
		}

		function finalizeState(state) {
			if (state.thinkingStartTime && state.thinkingDuration === null) {
				state.thinkingDuration = Date.now() - state.thinkingStartTime;
			}
		}
		async function callProvider(provider, baseUrl, apiKey, model, messages, onChunk, signal = null) {
			const config = provider.buildRequest(baseUrl, apiKey, model, messages);
			const useSignal = signal || (currentAbortController = new AbortController()).signal;
			const state = createInitialState();
			const tagParser = provider.needsTagParsing === false ? null : createTagParser();
			try {
				const res = await fetchWithTimeout(config.url, {
					method: 'POST',
					headers: config.headers,
					body: JSON.stringify(config.body),
					signal: useSignal
				}, 60000);
				if (!res.ok) {
					const error = await res.text();
					throw new Error('API错误: ' + res.status + ' - ' + error);
				}
				if (!res.body) {
					throw new Error('Response body is empty');
				}
				await processSSEStream(res, provider, state, tagParser, onChunk);
				finalizeState(state);
				return state;
			} catch (e) {
				if (e.name === 'AbortError') return state;
				throw e;
			} finally {
				if (!signal) currentAbortController = null;
			}
		}
		async function callAPI(style, baseUrl, apiKey, model, messages, onChunk, signal = null) {
			const provider = providers[style];
			if (!provider) throw new Error('不支持的接口风格: ' + style);
			return await callProvider(provider, baseUrl, apiKey, model, messages, onChunk, signal);
		}
		// 并行调用所有模型
		async function callAllModels(groups, modelIds, messages, onChunk, sessionId) {
			const startTime = Date.now();
			// 清除当前会话的旧生成状态（不影响其他会话）
			clearSessionGenerations(sessionId);
			const gens = getSessionGenerations(sessionId);
			// 初始化每个模型的状态和AbortController
			modelIds.forEach(id => {
				gens.set(id, {
					abortController: new AbortController(),
					status: 'generating',
					firstTokenTime: null,
					startTime,
					content: '',
					thinking: '',
					thinkingDuration: null
				});
			});
			// 并行调用所有模型
			const promises = modelIds.map(async id => {
				const info = findModelById(groups, id);
				const state = gens.get(id);
				if (!info) {
					state.status = 'failed';
					state.error = '模型不存在';
					return {
						modelId: id,
						status: 'failed',
						error: '模型不存在',
						content: '',
						timestamp: Date.now()
					};
				}
				try {
					const resultState = await callAPI(info.group.style, info.group.baseUrl, info.group.key, info.model.name, messages, chunkState => {
						const genState = gens.get(id);
						if (genState) {
							genState.content = chunkState.content;
							genState.thinking = chunkState.thinking;
							if (chunkState.phase === 'thinking' && genState.firstTokenTime === null) {
								genState.firstTokenTime = Date.now() - startTime;
							} else if (chunkState.phase === 'content' && genState.firstTokenTime === null) {
								genState.firstTokenTime = chunkState.firstContentTokenTime ? chunkState.firstContentTokenTime - startTime : Date.now() - startTime;
							}
							if (chunkState.thinkingDuration) {
								genState.thinkingDuration = chunkState.thinkingDuration;
							}
						}
						const firstTokenTime = genState?.firstTokenTime;
						onChunk(id, chunkState, firstTokenTime);
					}, state.abortController.signal);
					state.status = 'completed';
					state.content = resultState.content;
					state.thinking = resultState.thinking;
					state.thinkingDuration = resultState.thinkingDuration;
					const completionTime = Date.now();
					state.totalDuration = completionTime - startTime;
					// Immediately update UI for this specific model
					renderModelSelector(groups, selectedModels, true);
					updateCardStatus(id, 'completed', null, state, sessionId);
					return {
						modelId: id,
						status: 'completed',
						thinking: resultState.thinking,
						content: resultState.content,
						thinkingDuration: resultState.thinkingDuration,
						firstTokenTime: state.firstTokenTime,
						totalDuration: state.totalDuration,
						timestamp: completionTime
					};
				} catch (err) {
					const completionTime = Date.now();
					const genState = gens.get(id);
					if (err.name === 'AbortError') {
						state.status = 'stopped';
						// Immediately update UI for this specific model
						renderModelSelector(groups, selectedModels, true);
						updateCardStatus(id, 'stopped', null, genState, sessionId);
						return {
							modelId: id,
							status: 'stopped',
							thinking: genState?.thinking || '',
							content: genState?.content || '',
							thinkingDuration: genState?.thinkingDuration,
							firstTokenTime: genState?.firstTokenTime,
							totalDuration: completionTime - startTime,
							timestamp: completionTime
						};
					}
					state.status = 'failed';
					state.error = err.message;
					// Immediately update UI for this specific model
					renderModelSelector(groups, selectedModels, true);
					updateCardStatus(id, 'failed', err.message, genState, sessionId);
					return {
						modelId: id,
						status: 'failed',
						error: err.message,
						content: '',
						totalDuration: completionTime - startTime,
						timestamp: completionTime
					};
				}
			});
			return Promise.all(promises);
		}
		// ========== Main Logic ==========
		// 全局默认模型集管理
		function loadDefaultSelectedModels() {
			try {
				const saved = localStorage.getItem('defaultSelectedModels');
				return saved ? JSON.parse(saved) : [];
			} catch {
				return [];
			}
		}

		function saveDefaultSelectedModels(models) {
			localStorage.setItem('defaultSelectedModels', JSON.stringify(models));
		}
		// 初始化时加载
		let defaultSelectedModels = loadDefaultSelectedModels();
		let currentSession = null;
		let selectedModels = []; // 当前选中模型ID数组
		let sessionGenerations = new Map(); // 按会话隔离的生成状态：Map<sessionId, Map<modelId, state>>
		let lastUserMessage = null;
		// 附件管理
		let pendingAttachments = []; // 待发送的附件列表
		async function init() {
			initDividers();
			initScrollNav();
			// 发送快捷键设置（从 localStorage 加载）
			let sendOnEnter = localStorage.getItem('sendMode') !== 'ctrl-enter';
			const chatInput = $('#chat-input');
			chatInput.on('keydown', e => {
				if (e.key === 'Enter') {
					if (sendOnEnter && !e.shiftKey && !e.ctrlKey) {
						e.preventDefault();
						handleSend();
					} else if (!sendOnEnter && e.ctrlKey) {
						e.preventDefault();
						handleSend();
					}
				}
			});
			// 分裂式按钮：发送模式切换
			const btnGroup = $('#send-btn-group');
			const toggle = $('#send-mode-toggle');
			const options = $$('.split-btn-option', btnGroup);
			// 初始化选中状态
			if (!sendOnEnter) {
				options[0].classList.remove('selected');
				options[1].classList.add('selected');
			}
			// 点击下拉按钮
			toggle.on('click', e => {
				e.stopPropagation();
				btnGroup.classList.toggle('open');
			});
			// 选择选项
			options.forEach(opt => {
				opt.on('click', e => {
					e.stopPropagation();
					const value = opt.dataset.value;
					sendOnEnter = value === 'enter';
					localStorage.setItem('sendMode', value);
					// 更新选中状态
					options.forEach(o => o.classList.remove('selected'));
					opt.classList.add('selected');
					btnGroup.classList.remove('open');
				});
			});
			// 点击外部关闭
			document.on('click', () => {
				btnGroup.classList.remove('open');
			});
			// 粘贴图片处理
			chatInput.on('paste', async (e) => {
				const items = e.clipboardData?.items;
				if (!items) return;
				for (const item of items) {
					if (item.type.startsWith('image/')) {
						const file = item.getAsFile();
						if (file) {
							await addAttachment(file);
							// 不阻止默认行为，允许同时粘贴文字
						}
					}
				}
			});
			// 先尝试恢复已保存的目录
			const result = await tryRestoreDirectory();
			if (!result.success) {
				// 显示选择目录弹窗，如果有待恢复的 handle 则显示"恢复目录"按钮
				showDirectoryPrompt(result.needUserAction);
			} else {
				// 如果有全局默认，设为当前选中
				if (defaultSelectedModels.length > 0) {
					selectedModels = [...defaultSelectedModels];
				}
				updateDirectoryDisplay();
				await refreshUI();
			}
			$('#btn-add-group').onclick = handleAddGroup;
			$('#btn-send').onclick = handleSend;
			$('#btn-stop').onclick = () => {
				stopAllGenerations();
				setButtonState(false, false);
				renderModelSelector(getGroups(), selectedModels, false);
			};
			$('#btn-help').onclick = () => showHelpDialog(false, false);
			$('#btn-new-session-header').onclick = handleNewSession;
			$('#btn-delete-dir').onclick = handleDeleteDirectory;
			$('#btn-wipe-dir').onclick = handleWipeDirectory;
			// 附件按钮
			$('#btn-attach').onclick = () => {
				$('#file-input').click();
			};
			$('#file-input').onchange = async (e) => {
				const files = e.target.files;
				if (files && files.length > 0) {
					for (const file of files) {
						await addAttachment(file);
					}
				}
				e.target.value = ''; // 清空以便再次选择相同文件
				renderPendingAttachments();
			};
			// 更换目录按钮
			$('#btn-change-dir').onclick = async () => {
				const success = await selectDirectory();
				if (success) {
					updateDirectoryDisplay();
					await refreshUI();
				}
			};
		}
		async function handleDeleteDirectory() {
			if (storage.mode === 'browser') {
				confirmAction('确定清除浏览器存储中的所有数据？端点配置和会话记录将被删除。', async () => {
					await storage.clearAll();
					endpointsData = { groups: [] };
					sessionsCache.clear();
					updateDirectoryDisplay();
					await refreshUI();
				});
			return;
			}
			confirmAction('确定删除当前目录配置？删除后需要重新选择目录。（磁盘上的数据文件不会被删除）', async () => {
				await clearDirectory();
				showDirectoryPrompt(false);
			});
		}
		async function handleWipeDirectory() {
			if (storage.mode === 'browser') {
				confirmAction('确定清空浏览器存储中的所有数据？此操作不可恢复！', () => {
					confirmAction('再次确认：这将永久删除所有端点配置和会话记录！', async () => {
						await storage.clearAll();
						endpointsData = { groups: [] };
						sessionsCache.clear();
						updateDirectoryDisplay();
						await refreshUI();
					});
				});
			return;
			}
			if (!storage.getDirectoryName()) {
				alert('请先选择目录');
				return;
			}
			confirmAction('确定清空磁盘上的所有数据？\n这将删除 endpoints.json 和 sessions 目录中的所有会话记录。\n此操作不可恢复！', () => {
				confirmAction('再次确认：这将永久删除所有端点配置和会话记录！', async () => {
					try {
						await storage.clearAll();
						await clearDirectory();
						alert('数据已清空');
						showDirectoryPrompt(false);
					} catch (err) {
						alert('清空失败: ' + err.message);
					}
				});
			});
		}
		async function updateDirectoryDisplay() {
			const info = storage.getDisplayInfo();
			const dirPath = $('#directory-path');
			dirPath.textContent = info.text;
			dirPath.title = info.title;
		}
		async function refreshUI() {
			const groups = getGroups();
			const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
			const isGenerating = gens && gens.size > 0 && Array.from(gens.values()).some(s => s.status === 'generating');
			renderModelSelector(groups, selectedModels, isGenerating);
			renderEndpointList(groups, null, null, handleModelEdit, handleGroupEdit, handleGroupDelete, handleAddModelForGroup, handleModelDelete, handleReorderGroups, handleReorderModels, testConnection);
			const sessions = getAllSessions();
			renderSessionList(sessions, currentSession?.id, handleSessionSelect, handleSessionEdit, handleSessionDelete);
			if (currentSession) {
				renderMessages(currentSession.messages, groups, handleCopy);
			} else {
				$('#chat-messages').innerHTML = '';
			}
			updateChatTitleDisplay();
		}

		function updateChatTitleDisplay() {
			if (currentSession) {
				updateChatTitle(currentSession.title);
			} else {
				updateChatTitle(null);
			}
		}
		async function handleSessionSelect(sessionId) {
			currentSession = await loadSession(sessionId);
			// 从会话的最后用户消息恢复模型集
			const lastUserMsg = currentSession.messages.filter(m => m.role === 'user').pop();
			if (lastUserMsg?.targetModels) {
				selectedModels = [...lastUserMsg.targetModels];
			} else {
				selectedModels = [...defaultSelectedModels];
			}
			lastUserMessage = lastUserMsg?.content || null;
			// 获取当前会话的生成状态
			const gens = sessionGenerations.get(sessionId);
			const sessionModels = gens ? Array.from(gens.entries()) : [];
			await refreshUI();
			// 只有正在生成的模型才需要恢复流式卡片（已完成的已保存到消息中）
			const generatingModels = sessionModels.filter(([id, state]) => state.status === 'generating');
			// 如果有正在生成的模型，恢复显示流式卡片
			if (generatingModels.length > 0) {
				const groups = getGroups();
				const allModelIds = sessionModels.map(([id]) => id);
				showThinkingCards(allModelIds, groups, sessionId);
				// 恢复各状态模型的内容（但只恢复 generating 状态的）
				generatingModels.forEach(([id, state]) => {
					if (state.content || state.thinking) {
						updateStreamingCard(id, state, state.firstTokenTime, groups, sessionId);
					}
				});
				// 恢复按钮状态
				setButtonState(true, true);
				renderModelSelector(groups, selectedModels, true);
			}
			// 如果所有模型都已完成/失败/停止，清理状态（不再需要恢复）
			const allDone = sessionModels.length > 0 && sessionModels.every(([id, state]) => state.status === 'completed' || state.status === 'failed' || state.status === 'stopped');
			if (allDone) {
				sessionGenerations.delete(sessionId);
			}
		}

		function handleSessionEdit(sessionId, newTitle) {
			// 原地编辑模式：直接更新会话标题
			const session = getSession(sessionId);
			if (session && newTitle) {
				session.title = newTitle;
				saveSession(session);
				refreshUI();
			}
		}
		async function handleSessionDelete(sessionId) {
			// 停止并删除该会话的生成状态
			deleteSessionGenerations(sessionId);
			await deleteSession(sessionId);
			if (currentSession?.id === sessionId) {
				currentSession = null;
			}
			await refreshUI();
		}

		function handleAddGroup() {
			showEditGroupDialog(null, async (data) => {
				await addGroup(data.name, data.baseUrl, data.style, data.key);
				await refreshUI();
			});
		}

		function handleGroupEdit(groupId) {
			const group = getGroup(groupId);
			showEditGroupDialog(group, async (data) => {
				await updateGroup(groupId, data);
				await refreshUI();
			});
		}
		async function handleGroupDelete(groupId) {
			// 清理 selectedModels 中属于该组的模型
			selectedModels = selectedModels.filter(id => {
				const parts = id.split(':');
				return parts[0] !== groupId;
			});
			saveDefaultSelectedModels(selectedModels);
			await deleteGroup(groupId);
			await refreshUI();
		}
		async function handleAddModelForGroup(groupId, modelName) {
			if (modelName) {
				await addModel(groupId, modelName);
				await refreshUI();
			}
		}

		function handleCopy(content) {
			navigator.clipboard.writeText(content).then(() => {
				// 可选：显示复制成功提示
			});
		}

		function handleModelEdit(groupId, modelId, newName) {
			// 原地编辑模式：直接更新模型名
			updateModel(groupId, modelId, newName).then(() => refreshUI());
		}
		async function handleModelDelete(groupId, modelId) {
			// 清理 selectedModels 中的该模型
			selectedModels = selectedModels.filter(id => id !== `${groupId}:${modelId}`);
			saveDefaultSelectedModels(selectedModels);
			await deleteModel(groupId, modelId);
			await refreshUI();
		}
		async function handleReorderGroups(draggedId, targetId, insertBefore) {
			await reorderGroups(draggedId, targetId, insertBefore);
			await refreshUI();
		}
		async function handleReorderModels(groupId, draggedModelId, targetModelId, insertBefore) {
			await reorderModels(groupId, draggedModelId, targetModelId, insertBefore);
			await refreshUI();
		}
		async function handleSend() {
			const content = await getInputMessage();
			if (!content || content.length === 0) return; // 处理失败或无文本无附件
			if (selectedModels.length === 0) {
				selectorExpanded = true;
				renderModelSelector(getGroups(), selectedModels, false);
				return;
			}
			let isNewSession = false;
			if (!currentSession) {
				currentSession = await createSession(content, [...selectedModels]);
				isNewSession = true;
			}
			// Only addMessage if NOT a new session (createSession already added first message)
			if (!isNewSession) {
				await addMessage(currentSession.id, 'user', content, {
					targetModels: [...selectedModels]
				});
			}
			// 提取纯文本用于 lastUserMessage
			const textContent = content.filter(c => c.type === 'text' || c.type === 'file_text').map(c => c.text || '').join('\n');
			lastUserMessage = textContent;
			clearInput();
			clearAttachments();
			setButtonState(true, true);
			// 发送后自动收起模型选择区
			selectorExpanded = false;
			renderModelSelector(getGroups(), selectedModels, true);
			const groups = getGroups();
			const messages = currentSession.messages.map(m => {
				if (m.role === 'assistant' && m.responses) {
					// Multi-model format: concatenate all successful response contents
					const content = m.responses.filter(r => r.status === 'completed' && r.content).map(r => r.content).join('\n\n---\n\n');
					return {
						role: m.role,
						content
					};
				}
				// 用户消息：使用 OpenAI 格式转换函数
				const normalized = normalizeMessageContent(m);
				return {
					role: m.role,
					content: toOpenAIContent(normalized)
				};
			});
			// 渲染用户消息
			renderMessages(currentSession.messages, groups, handleCopy);
			// 记录当前会话ID用于后台接收（在创建卡片前定义）
			const targetSessionId = currentSession.id;
			// 显示"思考中"状态卡片（使用 targetSessionId 标记）
			showThinkingCards(selectedModels, groups, targetSessionId);
			// 记录已排序的模型（只排序一次）
			const sortedModels = new Set();
			// 并行调用所有模型
			const responses = await callAllModels(groups, selectedModels, messages, (modelId, partialContent, firstTokenTime) => {
				updateStreamingCard(modelId, partialContent, firstTokenTime, groups, targetSessionId);
				// 只在firstTokenTime首次有值时排序一次
				if (firstTokenTime != null && !sortedModels.has(modelId)) {
					sortedModels.add(modelId);
					reorderCardsBySpeed();
					reorderSelectorTagsBySpeed();
				}
			}, targetSessionId);
			// 全部完成后保存助手消息到发起请求时的会话
			await addMessage(targetSessionId, 'assistant', null, {
				responses
			});
			// 清理该会话的生成状态（回复已完成）
			sessionGenerations.delete(targetSessionId);
			// 如果用户还在这个会话，刷新显示
			if (currentSession?.id === targetSessionId) {
				currentSession = await loadSession(targetSessionId);
				setButtonState(false, false);
				renderModelSelector(groups, selectedModels, false);
				await refreshUI();
			}
		}

		function showThinkingCards(modelIds, groups, sessionId) {
			const container = $('#chat-messages');
			// 先清理当前会话已有的流式卡片容器（防止重复）
			const existingCards = $(`#streaming-multi-response[data-session-id="${sessionId}"]`);
			if (existingCards) {
				existingCards.remove();
			}
			const msgEl = mk('article', 'message layout-y-queue res msg');
			msgEl.id = 'streaming-multi-response';
			msgEl.dataset.sessionId = sessionId;
			const hint = fromTemplate('tpl-multi-response-hint', '.multi-response-hint');
			$('.hint-text', hint).textContent = `${modelIds.length}个模型正在思考...`;
			msgEl.addChild(hint);
			// 绑定停止按钮事件
			const stopBtn = $('#btn-stop-inline', hint);
			if (stopBtn) {
				stopBtn.onclick = () => {
					stopAllGenerations();
					stopBtn.disabled = true;
					stopBtn.textContent = '已停止';
					$('.hint-text', hint).textContent = `${modelIds.length}个模型（部分已停止）`;
				};
			}
			const cards = mk('div', 'multi-response-cards layout-y-queue');
			modelIds.forEach(id => {
				const card = fromTemplate('tpl-response-card-streaming', '.response.card');
				card.dataset.sessionId = sessionId;
				card.dataset.modelId = id;
				const info = findModelById(groups, id);
				const name = info ? `${info.group.name} / ${info.model.name}` : '未知';
				$('.response.model-name', card).textContent = name;
				cards.addChild(card);
			});
			msgEl.addChild(cards);
			container.addChild(msgEl);
			scrollToBottom();
		}

		function updateStreamingCard(modelId, state, firstTokenTime, groups, sessionId) {
			// 直接更新DOM，不用requestAnimationFrame（避免并行时排队显示）
			// 使用 sessionId + modelId 组合选择器，确保只更新当前会话的卡片
			const card = $(`.response.card[data-session-id="${sessionId}"][data-model-id="${modelId}"]`);
			if (!card) return;
			// thinking区块处理
			const thinkingBlock = $('.thinking-block', card);
			if (thinkingBlock) {
				if (state.thinking && state.thinking.trim()) {
					thinkingBlock.style.display = 'block';
					thinkingBlock.classList.add('streaming');
					const thinkingContent = $('.thinking-content', thinkingBlock);
					if (thinkingContent) {
						thinkingContent.textContent = state.thinking;
					}
					// 创建thinking header（如果不存在）
					let thinkingHeader = $('.thinking-header', thinkingBlock);
					if (!thinkingHeader) {
						thinkingHeader = fromTemplate('tpl-thinking-header', '.thinking-header');
						thinkingHeader.onclick = function() {
							toggleThinking(this);
						};
						const durationText = state.thinkingDuration ? `耗时 ${(state.thinkingDuration/1000).toFixed(1)}s` : '';
						$('.thinking-duration', thinkingHeader).textContent = durationText;
						thinkingBlock.insertBefore(thinkingHeader, thinkingBlock.firstChild);
					}
					// 更新thinkingDuration
					if (state.thinkingDuration) {
						const thinkingDurationEl = $('.thinking-duration', thinkingHeader);
						if (thinkingDurationEl) {
							thinkingDurationEl.textContent = `耗时 ${(state.thinkingDuration/1000).toFixed(1)}s`;
						}
					}
				} else {
					// thinking为空，隐藏思考块
					thinkingBlock.style.display = 'none';
				}
			}
			// content区块处理
			const contentEl = $('.response.card-content', card);
			if (contentEl) {
				contentEl.textContent = state.content || '';
			}
			// meta信息处理（duration等）
			if (firstTokenTime !== null) {
				const meta = $('.response.meta', card);
				if (meta) {
					// 收到第一个token时不停止动画，保持转动直到完成
					// 添加duration显示（如果不存在）
					if (!$('.response.duration', meta)) {
						const durationEl = mk('span', `response duration ${getSpeedClass(firstTokenTime)}`);
						durationEl.textContent = `反应${(firstTokenTime/1000).toFixed(1)}s`;
						const modelNameEl = $('.response.model-name', meta);
						if (modelNameEl) {
							modelNameEl.insertAdjacentElement('afterend', durationEl);
						}
					}
				}
			}
		}
		// Update streaming card status (for failed/stopped/completed models)
		function updateCardStatus(modelId, status, error, state = null, sessionId = null) {
			requestAnimationFrame(() => {
				// 使用 sessionId + modelId 组合选择器
				const selector = sessionId ? `.response.card[data-session-id="${sessionId}"][data-model-id="${modelId}"]` : `.response.card[data-model-id="${modelId}"]`;
				const card = $(selector);
				if (!card) return;
				card.classList.remove('thinking');
				const contentEl = $('.response.card-content', card);
				const meta = $('.response.meta', card);
				// Update status icon with color class
				const icon = meta ? $('.model.status-icon', meta) : null;
				if (icon) {
					icon.classList.remove('spinning');
					icon.classList.add('status');
					icon.classList.add(status);
					icon.textContent = getStatusText(status);
				}
				// Update content and add error message for failed models
				if (status === 'failed') {
					if (contentEl) {
						contentEl.textContent = ''; // Empty content for failed
					}
					if (meta && error && !$('.response.error', meta)) {
						const errorEl = mk('span', 'response error');
						errorEl.textContent = error;
						const statusEl = $('.response.status', meta) || icon;
						if (statusEl) {
							statusEl.insertAdjacentElement('afterend', errorEl);
						}
					}
				} else if (status === 'stopped') {
					// Keep partial content if exists
				} else if (status === 'completed') {
					// Content already updated via updateStreamingCard
					// 更新thinking区块的duration显示
					if (state && state.thinkingDuration) {
						const thinkingBlock = $('.thinking-block', card);
						if (thinkingBlock) {
							thinkingBlock.classList.remove('streaming');
							thinkingBlock.classList.add('collapsed');
							const durationEl = $('.thinking-duration', thinkingBlock);
							if (durationEl) {
								durationEl.textContent = `耗时 ${(state.thinkingDuration/1000).toFixed(1)}s`;
							}
						}
					}
					// 更新totalDuration显示
					if (state && state.totalDuration) {
						let totalEl = $('.response.total', meta);
						if (!totalEl) {
							totalEl = mk('span', 'response total');
							// 插入到meta末尾或icon后面
							const insertAfter = $('.response.status', meta) || $('.model.status-icon', meta);
							if (insertAfter) {
								insertAfter.insertAdjacentElement('afterend', totalEl);
							} else {
								meta.addChild(totalEl);
							}
						}
						totalEl.textContent = `耗时${(state.totalDuration/1000).toFixed(1)}s`;
					}
				}
			});
		}

		function reorderCardsBySpeed() {
			requestAnimationFrame(() => {
				const container = $('#streaming-multi-response .multi-response-cards');
				if (!container) return;
				const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
				const cards = Array.from($$('.response.card', container));
				cards.sort((a, b) => {
					const stateA = gens ? gens.get(a.dataset.modelId) : null;
					const stateB = gens ? gens.get(b.dataset.modelId) : null;
					return (stateA?.firstTokenTime ?? Infinity) - (stateB?.firstTokenTime ?? Infinity);
				});
				cards.forEach(c => container.appendChild(c));
			});
		}

		function reorderSelectorTagsBySpeed() {
			const summaryEl = $('#selector-summary');
			if (!summaryEl) return;
			const tags = Array.from(summaryEl.querySelectorAll('.model.tag.selected'));
			if (tags.length === 0) return;
			// 保存原始顺序（sort会原地修改）
			const originalTags = [...tags];
			// 按速度排序
			const gens = currentSession ? sessionGenerations.get(currentSession.id) : null;
			const sortedTags = tags.sort((a, b) => {
				const aTime = gens ? gens.get(a.dataset.model)?.firstTokenTime : undefined;
				const bTime = gens ? gens.get(b.dataset.model)?.firstTokenTime : undefined;
				return (aTime ?? Infinity) - (bTime ?? Infinity);
			});
			// 检查是否需要排序（用原始顺序比较）
			const needsReorder = sortedTags.some((tag, i) => tag !== originalTags[i]);
			if (!needsReorder) return;
			// 同步更新 selectedModels 数组顺序（不持久化）
			selectedModels = sortedTags.map(tag => tag.dataset.model);
			// 重新排列 DOM
			sortedTags.forEach(tag => summaryEl.appendChild(tag));
		}
		async function handleNewSession() {
			currentSession = null;
			selectedModels = [...defaultSelectedModels]; // 新会话继承全局默认
			lastUserMessage = null;
			await refreshUI();
			// 新建会话后输入框自动获得焦点
			const inputEl = $('#chat-input');
			if (inputEl) inputEl.focus();
		}
		// 启动
		init();

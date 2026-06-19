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
                url: baseUrl + "/v1/chat/completions",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + apiKey
                },

                body: {
                    model,

                    messages: [{
                        role: "user",
                        content: "hi"
                    }],

                    max_tokens: 3
                }
            };
        },
		testEmbeddingConfig(baseUrl, apiKey, model) {
			return {
				url: baseUrl + '/v1/embeddings',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Bearer ' + apiKey
				},
				body: {
					model,
					input: 'hi',
					encoding_format: 'float'
				}
			};
		},
		buildEmbeddingRequest(baseUrl, apiKey, model, input) {
			return {
				url: baseUrl + '/v1/embeddings',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Bearer ' + apiKey
				},
				body: {
					model,
					input,
					encoding_format: 'float'
				}
			};
		},
		parseEmbeddingResponse(json) {
			if (json.data && json.data[0] && json.data[0].embedding) {
				return { embedding: json.data[0].embedding, model: json.model, usage: json.usage };
			}
			throw new Error('embedding response format error');
		},
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
					max_tokens: 3,
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
	eyeOff: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
	collapseAll: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/><polyline points="18 21 12 15 6 21"/></svg>',
	testAll: '<span style="font-size:13px">🔗</span>',
	// 对话气泡（加入会话）
	bubble: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
		// 气泡+叉（从会话移除）
		bubbleCancel: s => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M17 3 22 7M22 3 17 7"/></svg>`
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
			el.className = 'tip';
			el.innerHTML = html;
			doc.body.appendChild(el);
			$$('button.copy', el).forEach(btn => {
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

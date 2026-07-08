// ========== Provider 定义（API 格式抽象层）==========
const providers = {
	openai: {
		buildImageRequest(baseUrl, apiKey, model, messages) {
            let prompt = "";

            for (let i = messages.length - 1; i >= 0; i--) {
                const m = messages[i];

                if (m.role !== "user")
                    continue;

                if (typeof m.content === "string") {
                    prompt = m.content;
                    break;
                }

                if (Array.isArray(m.content)) {
                    const text = m.content.filter(c => c.type === "text").map(c => c.text).join("\n");

                    if (text) {
                        prompt = text;
                        break;
                    }
                }
            }

            return {
                url: baseUrl + "/v1/images/generations",

                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + apiKey
                },

                body: {
                    model,
                    prompt,
                    n: 1
                }
            };
        },
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
    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }

    el = $("#" + id);

    if (!el) {
        el = doc.createElement("div");
        el.id = id;
        el.className = "tooltip";
        el.innerHTML = html;
        var tipParent = triggerEl.closest(".one.endpoint");

        if (!tipParent)
            tipParent = doc.body;

        tipParent.appendChild(el);

        $$("button.copy", el).forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                navigator.clipboard.writeText(btn.dataset.copy);
                btn.classList.add("copied");

                setTimeout(() => {
                    btn.classList.remove("copied");
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

        el.onclick = function(e) {
            e.stopPropagation();
        };
    }

    el.style.visibility = "hidden";
    el.style.display = "block";
    const measW = el.offsetWidth, measH = el.offsetHeight || 80;
    el.style.display = "none";
    el.style.visibility = "";
    const rect = triggerEl.getBoundingClientRect();
    let top = rect.bottom + 4, left = rect.left;

    if (top + measH > window.innerHeight)
        top = rect.top - measH - 4;

    if (left + measW > window.innerWidth)
        left = window.innerWidth - measW - 10;

    if (left < 10)
        left = 10;

    el.style.top = top + "px";
    el.style.left = left + "px";
    el.style.display = "block";
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

        el = $("#" + id);

        if (!el) {
            el = doc.createElement("div");
            el.id = id;
            el.className = "tooltip";
            el.innerHTML = html;
            var tipParent = triggerEl.closest(".one.endpoint");

            if (!tipParent)
                tipParent = doc.body;

            tipParent.appendChild(el);

            $$("button.copy", el).forEach(btn => {
                btn.onclick = e => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(btn.dataset.copy);
                    btn.classList.add("copied");

                    setTimeout(() => {
                        btn.classList.remove("copied");
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

            el.onclick = function(e) {
                e.stopPropagation();
            };
        }

        el.style.visibility = "hidden";
        el.style.display = "block";
        const measW = el.offsetWidth, measH = el.offsetHeight || 80;
        el.style.display = "none";
        el.style.visibility = "";
        const rect = triggerEl.getBoundingClientRect();
        let top = rect.bottom + 4, left = rect.left;

        if (top + measH > window.innerHeight)
            top = rect.top - measH - 4;

        if (left + measW > window.innerWidth)
            left = window.innerWidth - measW - 10;

        if (left < 10)
            left = 10;

        el.style.top = top + "px";
        el.style.left = left + "px";
        el.style.display = "block";
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

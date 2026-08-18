// ========== Provider 定义（API 格式抽象层）==========
const providers = {
	openai: {
		buildImageRequest(baseUrl, apiKey, model, messages) {
            baseUrl = baseUrl.replace(/\/+$/, '');
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
		buildVideoRequest(baseUrl, apiKey, model, messages, params) {
			baseUrl = baseUrl.replace(/\/+$/, '');
			let prompt = "";
			for (let i = messages.length - 1; i >= 0; i--) {
				const m = messages[i];
				if (m.role !== "user") continue;
				if (typeof m.content === "string") { prompt = m.content; break; }
				if (Array.isArray(m.content)) {
					const text = m.content.filter(c => c.type === "text").map(c => c.text).join("\n");;
					if (text) { prompt = text; break; }
				}
			}
			var body = { model, prompt, n: 1 };
			if (params) {
				if (params.duration) body.duration = params.duration;
				if (params.ratio) body.ratio = params.ratio;
				if (params.resolution) body.resolution = params.resolution;
			}
			return {
				url: baseUrl + "/v1/videos",
				headers: {
					"Content-Type": "application/json",
					"Authorization": "Bearer " + apiKey
				},
				body: body
			};
		},
		buildRequest(baseUrl, apiKey, model, messages) {
			baseUrl = baseUrl.replace(/\/+$/, '');
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
            baseUrl = baseUrl.replace(/\/+$/, '');
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
			baseUrl = baseUrl.replace(/\/+$/, '');
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
			baseUrl = baseUrl.replace(/\/+$/, '');
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
		buildTTSRequest(baseUrl, apiKey, model, input, voice, instruction) {
			baseUrl = baseUrl.replace(/\/+$/, '');
			var body = { model, input, response_format: 'mp3' };
			if (voice) body.voice = voice;
			if (instruction) body.instruction = instruction;
			return {
				url: baseUrl + '/v1/audio/speech',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Bearer ' + apiKey
				},
				body: body
			};
		},
		testTTSConfig(baseUrl, apiKey, model) {
			return this.buildTTSRequest(baseUrl, apiKey, model, '.');
		},
		testASRConfig(baseUrl, apiKey, model) {
			baseUrl = baseUrl.replace(/\/+$/, '');
			// Generate a minimal valid WAV file (44-byte header + 1 sample)
			function writeString(view, offset, str) {
				for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
			}
			var buf = new ArrayBuffer(46);
			var dv = new DataView(buf);
			writeString(dv, 0, 'RIFF');
			dv.setUint32(4, 42, true);
			writeString(dv, 8, 'WAVE');
			writeString(dv, 12, 'fmt ');
			dv.setUint32(16, 16, true);
			dv.setUint16(20, 1, true);
			dv.setUint16(22, 1, true);
			dv.setUint32(24, 8000, true);
			dv.setUint32(28, 8000, true);
			dv.setUint16(32, 1, true);
			dv.setUint16(34, 8, true);
			writeString(dv, 36, 'data');
			dv.setUint32(40, 2, true);
			dv.setUint8(44, 128);
			dv.setUint8(45, 128);
			var blob = new Blob([buf], { type: 'audio/wav' });
			var fd = new FormData();
			fd.append('file', blob, 'test.wav');
			fd.append('model', model);
			return {
				url: baseUrl + '/v1/audio/transcriptions',
				headers: { 'Authorization': 'Bearer ' + apiKey },
				body: fd,
				_multipart: true
			};
		},
	},
	jimeng: {
		buildVideoRequest(baseUrl, apiKey, model, messages, params) {
			baseUrl = baseUrl.replace(/\/+$/, '');
			let prompt = "";
			for (let i = messages.length - 1; i >= 0; i--) {
				const m = messages[i];
				if (m.role !== "user") continue;
				if (typeof m.content === "string") { prompt = m.content; break; }
				if (Array.isArray(m.content)) {
					const text = m.content.filter(c => c.type === "text").map(c => c.text).join("\n");;
					if (text) { prompt = text; break; }
				}
			}
			var body = { model, prompt, n: 1 };
			if (params) {
				if (params.duration) body.duration = params.duration;
				if (params.ratio) body.ratio = params.ratio;
				if (params.resolution) body.resolution = params.resolution;
			}
			return {
				url: baseUrl + "/v1/videos/generations",
				headers: {
					"Content-Type": "application/json",
					"Authorization": "Bearer " + apiKey
				},
				body: body
			};
		}
	},
	claude: {
		buildRequest(baseUrl, apiKey, model, messages) {
			baseUrl = baseUrl.replace(/\/+$/, '');
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
			baseUrl = baseUrl.replace(/\/+$/, '');
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
			baseUrl = baseUrl.replace(/\/+$/, '');
			return {
				url: baseUrl + '/v1beta/models/' + model + ':streamGenerateContent?alt=sse',
				headers: {
					'Content-Type': 'application/json',
					'X-Goog-Api-Key': apiKey
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
			baseUrl = baseUrl.replace(/\/+$/, '');
			return {
				url: baseUrl + '/v1beta/models/' + model + ':generateContent',
				headers: {
					'Content-Type': 'application/json',
					'X-Goog-Api-Key': apiKey
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
		},
		buildImageRequest(baseUrl, apiKey, model, messages) {
			baseUrl = baseUrl.replace(/\/+$/, '');
			// Gemini 生图用同一个 generateContent 端点，加 response_modalities: ["IMAGE"]
			var prompt = '';
			if (messages && messages.length) {
				var last = messages[messages.length - 1];
				if (typeof last.content === 'string') prompt = last.content;
				else if (Array.isArray(last.content)) {
					var textParts = last.content.filter(function(p) { return p.type === 'text' || p.type === 'file_text'; });
					prompt = textParts.map(function(p) { return p.text || ''; }).join('\n');
				}
			}
			return {
				url: baseUrl + '/v1beta/models/' + model + ':generateContent',
				headers: {
					'Content-Type': 'application/json',
					'X-Goog-Api-Key': apiKey
				},
				body: {
					contents: [{
						parts: [{ text: prompt }]
					}],
					generationConfig: {
						response_modalities: ['IMAGE']
					}
				}
			};
		},
		buildVideoRequest(baseUrl, apiKey, model, messages, params) {
			baseUrl = baseUrl.replace(/\/+$/, '');
			var prompt = '';
			if (messages && messages.length) {
				var last = messages[messages.length - 1];
				if (typeof last.content === 'string') prompt = last.content;
				else if (Array.isArray(last.content)) {
					var textParts = last.content.filter(function(p) { return p.type === 'text' || p.type === 'file_text'; });
					prompt = textParts.map(function(p) { return p.text || ''; }).join('\n');
				}
			}
			return {
				url: baseUrl + '/v1beta/models/' + model + ':generateContent',
				headers: {
					'Content-Type': 'application/json',
					'X-Goog-Api-Key': apiKey
				},
				body: {
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						response_modalities: ['VIDEO']
					}
				}
			};
		},
		parseImageResponse(data) {
			// Gemini 响应格式：candidates[0].content.parts[].inlineData
			if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) return null;
			var parts = data.candidates[0].content.parts || [];
			for (var i = 0; i < parts.length; i++) {
				var p = parts[i];
				if (p.inlineData && p.inlineData.mimeType && p.inlineData.mimeType.indexOf('image/') === 0) {
					return {
						imageData: 'data:' + p.inlineData.mimeType + ';base64,' + p.inlineData.data,
						revised_prompt: null
					};
				}
			}
			return null;
		}
	},
	responses: {
		buildRequest(baseUrl, apiKey, model, messages) {
			baseUrl = baseUrl.replace(/\/+$/, '');
			const transformed = this.transformMessages(messages);
			const body = { model, input: transformed.input, stream: true };
			if (transformed.instructions) body.instructions = transformed.instructions;
			return {
				url: baseUrl + '/v1/responses',
				headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
				body
			};
		},
		// 内部消息是 OpenAI 聊天格式（content 为 string 或 [{type:'text'|'image_url'}]），
		// Responses API 输入用 input_text / input_image / output_text 类型，system 走顶层 instructions
		transformMessages(messages) {
			const input = [];
			const instructions = [];
			messages.forEach(m => {
				if (m.role === 'system') {
					if (typeof m.content === 'string') instructions.push(m.content);
					else if (Array.isArray(m.content)) {
						const text = m.content.filter(p => p.type === 'text' || p.type === 'file_text').map(p => p.text || '').join('\n');
						if (text) instructions.push(text);
					}
					return;
				}
				const isAssistant = m.role === 'assistant';
				let parts;
				if (typeof m.content === 'string') {
					parts = [{ type: isAssistant ? 'output_text' : 'input_text', text: m.content }];
				} else if (Array.isArray(m.content)) {
					parts = m.content.map(p => {
						if (p.type === 'text' || p.type === 'file_text') {
							return { type: isAssistant ? 'output_text' : 'input_text', text: p.text || '' };
						}
						if (p.type === 'image_url' && p.image_url) {
							return { type: 'input_image', image_url: typeof p.image_url === 'string' ? p.image_url : p.image_url.url };
						}
						if (p.type === 'image' || p.type === 'file') {
							const src = p.source;
							if (!src) return { type: 'input_text', text: '[附件 数据缺失]' };
							const url = src.type === 'url' ? src.url : `data:${src.media_type};base64,${src.data}`;
							return { type: 'input_image', image_url: url };
						}
						return { type: isAssistant ? 'output_text' : 'input_text', text: '[附件 不支持的类型]' };
					});
				} else {
					parts = [{ type: isAssistant ? 'output_text' : 'input_text', text: String(m.content == null ? '' : m.content) }];
				}
				input.push({ type: 'message', role: m.role, content: parts });
			});
			return { input, instructions: instructions.join('\n') };
		},
		parseChunk(json) {
			if (json.type === 'response.output_text.delta' && json.delta) {
				return { content: json.delta };
			}
			if ((json.type === 'response.reasoning_summary_text.delta' || json.type === 'response.reasoning_text.delta') && json.delta) {
				return { reasoning: json.delta };
			}
			return null;
		},
		testConfig(baseUrl, apiKey, model) {
			baseUrl = baseUrl.replace(/\/+$/, '');
			return {
				url: baseUrl + '/v1/responses',
				headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
				body: { model, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }], max_output_tokens: 3 }
			};
		},
		needsTagParsing: false
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
// 确认后执行
function confirmAction(msg, action) {
	if (confirm(msg)) action();
}
function handleCopyValueClick(btn) {
	const text = btn.dataset.copy || '';
	navigator.clipboard.writeText(text).then(() => {
		btn.classList.add("done");
		setTimeout(() => btn.classList.remove("done"), 1500);
	});
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
function createTooltip(id, triggerEl, populate) {
	var el = $("#tooltip-content").content.cloneNode(true).querySelector(".tooltip");
	populate(el);  // 构造时一次性填入数据
	// 绑定 tooltip 内复制按钮（取代 HTML onxxx）
	el.querySelectorAll('.copy.value').forEach(b => b.addEventListener('click', e => handleCopyValueClick(e.currentTarget)));

	var anchorName = '--tooltip-trigger-' + id;
	el.style.setProperty('position-anchor', anchorName);
	triggerEl.style.setProperty('anchor-name', anchorName);

	var parent = triggerEl.closest('.one.endpoint') || doc.body;
	parent.appendChild(el);

	var hideTimer = null;
	el.onmouseenter = () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } };
	el.onmouseleave = () => { hideTimer = setTimeout(() => { el.hidePopover(); hideTimer = null; }, 100); };
	el.onclick = (e) => e.stopPropagation();

	return {
		show: function() {
			if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
			el.showPopover();
			if (el.getBoundingClientRect().bottom > window.innerHeight) {
				el.hidePopover();
				el.style.setProperty('top', 'auto');
				el.style.setProperty('bottom', 'anchor(top)');
				el.style.setProperty('margin-top', '');
				el.style.setProperty('margin-bottom', '4px');
				el.showPopover();
			}
		},
		hide: function() {
			if (hideTimer) clearTimeout(hideTimer);
			hideTimer = setTimeout(function() {
				el.hidePopover();
				hideTimer = null;
			}, 100);
		},
		remove: function() {
			el.remove();
		}
	};
}

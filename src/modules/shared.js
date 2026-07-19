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
	if (parsed.reasoning) {
		if (!state.thinkingStartTime) {
			state.thinkingStartTime = Date.now();
			state.phase = 'thinking';
		}
		state.thinking += parsed.reasoning;
		onChunk(state);
		return;
	}
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
		// 检测 HTTP 200 但返回了 HTML 错误页面的情况
		const ct = res.headers.get('content-type') || '';
		if (ct.includes('text/html')) {
			const body = await res.text().catch(() => '');
			const m = body.match(/<title>([^<]+)<\/title>/i);
			throw new Error('服务器返回了HTML页面: ' + (m ? m[1] : body.slice(0, 100)));
		}
		if (ct.includes('application/json')) {
			// 非流式响应 — 有些代理返回 200 + JSON 格式的错误
			const body = await res.text();
			try {
				const json = JSON.parse(body);
				if (json.error) {
					throw new Error('API错误: ' + (json.error.message || JSON.stringify(json.error)));
				}
			} catch (e) {
				if (e.message.startsWith('API错误')) throw e;
			}
			// 无 API 层错误，重新包装为 Response 供 SSE 解析
			res = new Response(body, {
				status: res.status,
				statusText: res.statusText,
				headers: res.headers
			});
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

	async function callEmbedding(style, baseUrl, apiKey, model, input) {
        const provider = providers[style];

        if (!provider)
            throw new Error("不支持的接口风格: " + style);

        if (!provider.buildEmbeddingRequest)
            throw new Error("该接口不支持嵌入");

        const req = provider.buildEmbeddingRequest(baseUrl, apiKey, model, input);
        console.log("Embed req:", req.url, JSON.stringify(req.headers));

        const res = await fetchWithTimeout(req.url, {
            method: "POST",
            headers: req.headers,
            body: JSON.stringify(req.body)
        }, 60000);

        if (!res.ok) {
            const err = await res.text().catch(() => "");
            throw new Error("嵌入请求失败: " + res.status + (err ? " - " + err : ""));
        }

        const ct = res.headers.get("content-type") || "";

        if (ct.includes("text/html")) {
            const body = await res.text().catch(() => "");
            const m = body.match(/<title>([^<]+)<\/title>/i);
            throw new Error("嵌入请求失败: 服务器返回了HTML页面 — " + (m ? m[1] : body.slice(0, 100)));
        }

        if (!ct.includes("application/json")) {
            const preview = await res.text().catch(() => "");
            throw new Error("嵌入请求失败: 响应类型不是 JSON (" + ct + ") — " + preview.slice(0, 100));
        }

        const text = await res.text();
        let data;

        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error("嵌入请求失败: 响应体不是有效 JSON — " + text.slice(0, 100));
        }

        if (data.error) {
            const msg = data.error.message || data.error.code || JSON.stringify(data.error);
            throw new Error("嵌入请求失败: " + msg);
        }

        return provider.parseEmbeddingResponse(data);
    }

function blobToBase64(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error('Blob 转 base64 失败'));
		reader.readAsDataURL(blob);
	});
}

function base64ToBlob(b64, mimeType) {
	var byteChars = atob(b64);
	var byteArrays = [];
	for (var offset = 0; offset < byteChars.length; offset += 512) {
		var slice = byteChars.slice(offset, offset + 512);
		var byteNumbers = new Array(slice.length);
		for (var i = 0; i < slice.length; i++) {
			byteNumbers[i] = slice.charCodeAt(i);
		}
		byteArrays.push(new Uint8Array(byteNumbers));
	}
	return new Blob(byteArrays, { type: mimeType || 'audio/mpeg' });
}

async function callImageGeneration(style, baseUrl, apiKey, model, messages) {
    const provider = providers[style];
    if (!provider) throw new Error('不支持的接口风格: ' + style);
    if (!provider.buildImageRequest) throw new Error('该接口不支持生图');

    const req = provider.buildImageRequest(baseUrl, apiKey, model, messages);
    const res = await fetchWithTimeout(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body)
    }, 120000);

    if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error('生图请求失败: ' + res.status + (err ? ' - ' + err : ''));
    }

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
        const body = await res.text().catch(() => '');
        const m = body.match(/<title>([^<]+)<\/title>/i);
        throw new Error('生图请求失败: 服务器返回了HTML页面 — ' + (m ? m[1] : body.slice(0, 100)));
    }

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error('生图请求失败: 响应体不是有效 JSON — ' + text.slice(0, 100));
    }

    if (data.error) {
        const msg = data.error.message || data.error.code || JSON.stringify(data.error);
        throw new Error('生图请求失败: ' + msg);
    }
    if (!data.data || !data.data[0]) {
        throw new Error('生图响应格式错误: 缺少 data[0]');
    }
    const result = {
        url: data.data[0].url || null,
        b64_json: data.data[0].b64_json || null,
        revised_prompt: data.data[0].revised_prompt || null
    };
    // 下载图片转 blob URL（当前页面快速显示）+ base64（持久化，支持会话记录加载）
    if (result.url && !result.b64_json) {
        try {
            const imgRes = await fetch(result.url);
            if (imgRes.ok) {
                const blob = await imgRes.blob();
                result.blobUrl = URL.createObjectURL(blob);
                // 转 base64 用于持久化存储
                result.imageData = await blobToBase64(blob);
            }
        } catch (e) {
            console.warn('生图图片下载失败，将使用原始 URL:', e.message);
        }
    } else if (result.b64_json) {
        // API 直接返回了 base64，也存为 imageData
        result.imageData = 'data:image/png;base64,' + result.b64_json;
    }
    return result;
}

async function callTTS(style, baseUrl, apiKey, model, input) {
    var provider = providers[style];
    if (!provider) throw new Error('不支持的接口风格: ' + style);
    if (!provider.buildTTSRequest) throw new Error('该接口不支持语音生成');

    var req = provider.buildTTSRequest(baseUrl, apiKey, model, input);
    var res = await fetchWithTimeout(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body)
    }, 120000);

    if (!res.ok) {
        var errText = await res.text().catch(function() { return ''; });
        throw new Error('TTS请求失败: ' + res.status + (errText ? ' - ' + errText : ''));
    }

    var ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
        var body = await res.text().catch(function() { return ''; });
        var m = body.match(/<title>([^<]+)<\/title>/i);
        throw new Error('TTS请求失败: 返回了HTML — ' + (m ? m[1] : body.slice(0, 100)));
    }

    var blob = await res.blob();
    var audioData = await blobToBase64(blob);
    var blobUrl = URL.createObjectURL(blob);

    return { blobUrl: blobUrl, audioData: audioData, contentType: ct, size: blob.size };
}

async function callAllModels(groups, endpointIds, messages, onChunk, sessionId) {
	const startTime = Date.now();
	clearSessionGenerations(sessionId);
	const gens = getSessionGenerations(sessionId);
	endpointIds.forEach(endpointId => {
		gens.set(endpointId, {
			abortController: new AbortController(),
			status: 'generating',
			firstTokenTime: null,
			startTime,
			content: '',
			thinking: '',
			thinkingDuration: null
		});
	});
	const promises = endpointIds.map(async endpointId => {
		const info = findModelById(groups, endpointId);
		const state = gens.get(endpointId);
		if (!info) {
			state.status = 'failed';
			state.error = '端点不存在';
			return {
				endpointId: endpointId,
				status: 'failed',
				error: '端点不存在',
				content: '',
				timestamp: Date.now()
			};
		}
		try {
			const config = resolveNodeConfig(info.node.id);
			const resultState = await callAPI(config.style || 'openai', config.baseUrl, config.key, (info.node.modelId || info.node.name), messages, chunkState => {
				const genState = gens.get(endpointId);
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
				onChunk(endpointId, chunkState, firstTokenTime);
			}, state.abortController.signal);
			state.status = 'completed';
			state.content = resultState.content;
			state.thinking = resultState.thinking;
			state.thinkingDuration = resultState.thinkingDuration;
			const completionTime = Date.now();
			state.totalDuration = completionTime - startTime;
			// Immediately update UI for this specific model
			renderSelectedEndpoints(groups, selectedEndpoints, true);
			updateCardStatus(endpointId, 'completed', null, state, sessionId);
			return {
				endpointId: endpointId,
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
			const genState = gens.get(endpointId);
			if (err.name === 'AbortError') {
				state.status = 'stopped';
				// Immediately update UI for this specific model
				renderSelectedEndpoints(groups, selectedEndpoints, true);
				updateCardStatus(endpointId, 'stopped', null, genState, sessionId);
				return {
					endpointId: endpointId,
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
			renderSelectedEndpoints(groups, selectedEndpoints, true);
			updateCardStatus(endpointId, 'failed', err.message, genState, sessionId);
			return {
				endpointId: endpointId,
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

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

function setOwnEnumerableDataProperty(target, key, value) {
	Object.defineProperty(target, key, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
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
	const terminalPriority = {
		completed: 0,
		incomplete: 1,
		refused: 1,
		failed: 2
	};
	const setTerminal = terminal => {
		const next = { ...terminal };
		if (next.outcome === 'refused' && state.refusal) {
			next.message = state.refusal;
		}
		const current = state.terminal;
		const nextPriority = terminalPriority[next.outcome] ?? -1;
		const currentPriority = current ? (terminalPriority[current.outcome] ?? -1) : -1;
		const hasMoreCompleteMessage = next.message
			&& (!current?.message || next.message.length > current.message.length);
		if (!current
			|| nextPriority > currentPriority
			|| (nextPriority === currentPriority
				&& next.outcome === current.outcome
				&& hasMoreCompleteMessage)) {
			state.terminal = next;
		}
	};
	const processLine = line => {
		if (!line.startsWith('data:')) return;
		const data = line.slice(5).startsWith(' ')
			? line.slice(6)
			: line.slice(5);
		if (data === '[DONE]') return;
		let json;
		try {
			json = JSON.parse(data);
		} catch (e) {
			return;
		}
		const parsed = provider.parseChunk(json);
		if (!parsed) return;
		if (parsed.refusalDelta) {
			state.refusal = (state.refusal || '') + parsed.refusalDelta;
		}
		if (parsed.terminal) {
			setTerminal(parsed.terminal);
		}
		handleParsedChunk(parsed, state, tagParser, onChunk);
	};
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';
		lines.forEach(processLine);
	}
	buffer += decoder.decode();
	if (buffer) processLine(buffer);
	if (tagParser && tagParser.inThinking && tagParser.buffer) {
		state.thinking += tagParser.buffer;
	}
	return state.terminal || null;
}

function finalizeState(state) {
	if (state.thinkingStartTime && state.thinkingDuration === null) {
		state.thinkingDuration = Date.now() - state.thinkingStartTime;
	}
}
async function callProvider(provider, baseUrl, apiKey, model, messages, onChunk, signal = null, style, params, isFullUrl) {
	const config = provider.buildRequest(baseUrl, apiKey, model, messages);
	if (isFullUrl) config.url = baseUrl.replace(/\/+$/, '');
	mergeParams(config.body, params, style);
	const useSignal = signal || (currentAbortController = new AbortController()).signal;
	const state = createInitialState();
	const tagParser = provider.needsTagParsing === false ? null : createTagParser();
	try {
		let res = await fetchWithTimeout(config.url, {
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
		if (typeof finalizeState === 'function') finalizeState(state);
		else if (state.thinkingStartTime && state.thinkingDuration === null) {
			state.thinkingDuration = Date.now() - state.thinkingStartTime;
		}
		if (state.terminal && state.terminal.outcome !== 'completed') {
			const terminal = state.terminal;
			const outcomeText = {
				failed: '生成失败',
				incomplete: '响应未完成',
				refused: '请求被拒绝'
			}[terminal.outcome] || '响应异常';
			const details = [];
			if (terminal.reason) details.push('reason=' + terminal.reason);
			if (terminal.message) details.push('message=' + terminal.message);
			const error = new Error(outcomeText + (details.length ? '（' + details.join('；') + '）' : ''));
			error.terminal = terminal;
			error.state = state;
			throw error;
		}
		return state;
	} finally {
		if (!signal) currentAbortController = null;
	}
}
async function callAPI(style, baseUrl, apiKey, model, messages, onChunk, signal = null, params, isFullUrl) {
	const provider = providers[style];
	if (!provider) throw new Error('不支持的接口风格: ' + style);
	return await callProvider(provider, baseUrl, apiKey, model, messages, onChunk, signal, style, params, isFullUrl);
}
async function callEmbedding(style, baseUrl, apiKey, model, input, isFullUrl, params, signal) {
	const provider = providers[style];
	if (!provider) throw new Error("不支持的接口风格: " + style);
	if (!provider.buildEmbeddingRequest) throw new Error("该接口不支持嵌入");
	const req = provider.buildEmbeddingRequest(baseUrl, apiKey, model, input);
	if (isFullUrl) req.url = baseUrl.replace(/\/+$/, '');
	console.log("Embed req:", req.url, JSON.stringify(req.headers));
	if (params) {
		mergeParams(req.body, params, style);
	}
	const res = await fetchWithTimeout(req.url, {
		method: 'POST',
		headers: req.headers,
		body: JSON.stringify(req.body),
		signal
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
	var raw = b64.indexOf(',') >= 0 ? b64.split(',')[1] : b64;
	var byteChars = atob(raw);
	var byteArrays = [];
	for (var offset = 0; offset < byteChars.length; offset += 512) {
		var slice = byteChars.slice(offset, offset + 512);
		var byteNumbers = new Array(slice.length);
		for (var i = 0; i < slice.length; i++) {
			byteNumbers[i] = slice.charCodeAt(i);
		}
		byteArrays.push(new Uint8Array(byteNumbers));
	}
	return new Blob(byteArrays, {
		type: mimeType || 'audio/mpeg'
	});
}
async function callImageGeneration(style, baseUrl, apiKey, model, messages, isFullUrl, params, signal, onInitialResult) {
	const provider = providers[style];
	if (!provider) throw new Error('不支持的接口风格: ' + style);
	if (!provider.buildImageRequest) throw new Error('该接口不支持生图');
	const req = provider.buildImageRequest(baseUrl, apiKey, model, messages);
	if (isFullUrl) req.url = baseUrl.replace(/\/+$/, '');
	if (params) {
		mergeParams(req.body, params, style);
	}
	const res = await fetchWithTimeout(req.url, {
		method: 'POST',
		headers: req.headers,
		body: JSON.stringify(req.body),
		signal
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
		throw new Error('生图响应失败: 响应体不是有效 JSON — ' + text.slice(0, 100));
	}
	if (data.error) {
		const msg = data.error.message || data.error.code || JSON.stringify(data.error);
		throw new Error('生图请求失败: ' + msg);
	}
	// 优先用 provider 自定义解析（Gemini inlineData 等格式）
	if (typeof provider.parseImageResponse === 'function') {
		var parsed = provider.parseImageResponse(data);
		if (parsed) {
			const result = {
				url: null,
				b64_json: null,
				revised_prompt: parsed.revised_prompt || null
			};
			if (parsed.imageData) {
				result.imageData = parsed.imageData;
			}
			if (onInitialResult) onInitialResult(result);
			return result;
		}
	}
	if (!data.data || !data.data[0]) {
		throw new Error('生图响应格式错误: 缺少 data[0]');
	}
	const result = {
		url: data.data[0].url || null,
		b64_json: data.data[0].b64_json || null,
		revised_prompt: data.data[0].revised_prompt || null
	};
	if (onInitialResult) onInitialResult(result);
	// 下载图片转 blob URL（当前页面快速显示）+ base64（持久化，支持会话记录加载）
	if (result.url && !result.b64_json) {
		try {
			const imgRes = await fetch(result.url, {
				signal
			});
			if (imgRes.ok) {
				const blob = await imgRes.blob();
				result.blobUrl = URL.createObjectURL(blob);
				// 转 base64 用于持久化存储
				result.imageData = await blobToBase64(blob);
			}
		} catch (e) {
			if (e.name === 'AbortError') throw e;
			console.warn('生图图片下载失败，将使用原始 URL:', e.message);
		}
	} else if (result.b64_json) {
		// API 直接返回了 base64，也存为 imageData
		result.imageData = 'data:image/png;base64,' + result.b64_json;
	}
	return result;
}
async function callVideoGeneration(style, baseUrl, apiKey, model, messages, isFullUrl, params, signal) {
	const provider = providers[style];
	if (!provider) throw new Error('不支持的接口风格: ' + style);
	if (!provider.buildVideoRequest) throw new Error('该接口不支持视频生成');
	const req = provider.buildVideoRequest(baseUrl, apiKey, model, messages, params);
	if (isFullUrl) req.url = baseUrl.replace(/\/+$/, '');
	if (params) {
		mergeParams(req.body, params, style);
	}
	const res = await fetchWithTimeout(req.url, {
		method: 'POST',
		headers: req.headers,
		body: JSON.stringify(req.body),
		signal
	}, 180000);
	if (!res.ok) {
		const err = await res.text().catch(() => '');
		throw new Error('视频生成请求失败: ' + res.status + (err ? ' - ' + err : ''));
	}
	const ct = res.headers.get('content-type') || '';
	if (ct.includes('text/html')) {
		const body = await res.text().catch(() => '');
		const m = body.match(/<title>([^<]+)<\/title>/i);
		throw new Error('视频生成请求失败: 服务器返回了HTML页面 — ' + (m ? m[1] : body.slice(0, 100)));
	}
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch (e) {
		throw new Error('视频生成请求失败: 响应体不是有效 JSON — ' + text.slice(0, 100));
	}
	if (data.error) {
		const msg = data.error.message || data.error.code || JSON.stringify(data.error);
		throw new Error('视频生成请求失败: ' + msg);
	}
	if (!data.data || !data.data[0]) {
		throw new Error('视频生成响应格式错误: 缺少 data[0]');
	}
	const result = {
		videoUrl: data.data[0].url || data.data[0].video_url || null
	};
	if (result.videoUrl) {
		try {
			const vidRes = await fetch(result.videoUrl, {
				signal
			});
			if (vidRes.ok) {
				const blob = await vidRes.blob();
				result.blobUrl = URL.createObjectURL(blob);
			}
		} catch (e) {
			if (e.name === 'AbortError') throw e;
			console.warn('视频下载失败，将使用原始 URL:', e.message);
		}
	}
	return result;
}
async function callTTS(style, baseUrl, apiKey, model, input, voice, instruction, isFullUrl, signal) {
	var provider = providers[style];
	if (!provider) throw new Error('不支持的接口风格: ' + style);
	if (!provider.buildTTSRequest) throw new Error('该接口不支持语音生成');
	var req = provider.buildTTSRequest(baseUrl, apiKey, model, input, voice, instruction);
	if (isFullUrl) req.url = baseUrl.replace(/\/+$/, '');
	var res = await fetchWithTimeout(req.url, {
		method: 'POST',
		headers: req.headers,
		body: JSON.stringify(req.body),
		signal
	}, 120000);
	if (!res.ok) {
		var errText = await res.text().catch(function() {
			return '';
		});
		throw new Error('TTS请求失败: ' + res.status + (errText ? ' - ' + errText : ''));
	}
	var ct = res.headers.get('content-type') || '';
	if (ct.includes('text/html')) {
		var body = await res.text().catch(function() {
			return '';
		});
		var m = body.match(/<title>([^<]+)<\/title>/i);
		throw new Error('TTS请求失败: 返回了HTML — ' + (m ? m[1] : body.slice(0, 100)));
	}
	var blob = await res.blob();
	var audioData = (await blobToBase64(blob)).split(',')[1] || '';
	var blobUrl = URL.createObjectURL(blob);
	return {
		blobUrl: blobUrl,
		audioData: audioData,
		contentType: ct,
		size: blob.size
	};
}
async function callASR(style, baseUrl, apiKey, model, audioFile, params, isFullUrl, signal) {
	var provider = providers[style];
	if (!provider) throw new Error('不支持的接口风格: ' + style);
	// Currently only OpenAI-style ASR (Whisper API) is supported
	var fd = new FormData();
	fd.append('file', audioFile, audioFile.name || 'audio.wav');
	fd.append('model', model);
	if (params && params.language) fd.append('language', params.language);
	if (params && params.prompt) fd.append('prompt', params.prompt);
	if (params && params.temperature) fd.append('temperature', String(params.temperature));
	fd.append('response_format', 'json');
	var url = baseUrl.replace(/\/+$/, '') + '/v1/audio/transcriptions';
	if (isFullUrl) url = baseUrl.replace(/\/+$/, '');
	var res = await fetchWithTimeout(url, {
		method: 'POST',
		headers: {
			'Authorization': 'Bearer ' + apiKey
		},
		body: fd,
		signal
	}, 120000);
	if (!res.ok) {
		var errText = await res.text().catch(function() {
			return '';
		});
		throw new Error('ASR请求失败: ' + res.status + (errText ? ' - ' + errText : ''));
	}
	var ct = res.headers.get('content-type') || '';
	if (ct.includes('text/html')) {
		var body = await res.text().catch(function() {
			return '';
		});
		var m = body.match(/<title>([^<]+)<\/title>/i);
		throw new Error('ASR请求失败: 返回了HTML — ' + (m ? m[1] : body.slice(0, 100)));
	}
	var json = await res.json();
	if (json.error) {
		var msg = json.error.message || json.error.code || JSON.stringify(json.error);
		throw new Error('ASR请求失败: ' + msg);
	}
	return {
		text: json.text || '',
		duration: json.duration,
		language: json.language
	};
}
async function callAllModels(groups, endpointIds, messages, onChunk, sessionId) {
	if (isSessionInvalidated(sessionId)) return [];
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
			// 自定义参数合并到 params
			var customParams = info.node.customParams;
			if (customParams && customParams.length) {
				config.params = config.params || {};
				for (var ci = 0; ci < customParams.length; ci++) {
					var cp = customParams[ci];
					if (cp && cp.key && cp.key.trim()) setOwnEnumerableDataProperty(config.params, cp.key.trim(), cp.value);
				}
			}
			// Param override: session params > workspace params > endpoint defaults
			var ovr = null;
			if (currentSession && hasOwnEndpointParams(currentSession.modelParams, endpointId)) {
				ovr = readOwnEndpointParams(currentSession.modelParams, endpointId);
			} else if (typeof defaultSelectedEndpointParams !== 'undefined'
				&& hasOwnEndpointParams(defaultSelectedEndpointParams, endpointId)) {
				ovr = readOwnEndpointParams(defaultSelectedEndpointParams, endpointId);
			}
			if (ovr) {
				config.params = config.params || {};
				for (var sk in ovr) {
					if (Object.prototype.hasOwnProperty.call(ovr, sk) && sk !== '_custom') setOwnEnumerableDataProperty(config.params, sk, ovr[sk]);
				}
				if (ovr._custom && ovr._custom.length) {
					ovr._custom.forEach(function(cp) {
						if (cp && cp.key && cp.key.trim()) setOwnEnumerableDataProperty(config.params, cp.key.trim(), cp.value);
					});
				}
			}
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
				if (!isSessionInvalidated(sessionId)) {
					onChunk(endpointId, chunkState, firstTokenTime);
				}
			}, state.abortController.signal, config.params, config.isFullUrl);
			state.status = 'completed';
			state.content = resultState.content;
			state.thinking = resultState.thinking;
			state.thinkingDuration = resultState.thinkingDuration;
			const completionTime = Date.now();
			state.totalDuration = completionTime - startTime;
			if (!isSessionInvalidated(sessionId)) {
				// Immediately update UI for this specific model
				renderSelectedEndpoints(groups, selectedEndpoints, true);
				updateCardStatus(endpointId, 'completed', null, state, sessionId);
			}
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
				if (!isSessionInvalidated(sessionId)) {
					// Immediately update UI for this specific model
					renderSelectedEndpoints(groups, selectedEndpoints, true);
					updateCardStatus(endpointId, 'stopped', null, genState, sessionId);
				}
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
			const failureState = err.state || {};
			const failureContent = failureState.content || genState?.content || '';
			const failureThinking = failureState.thinking || genState?.thinking || '';
			const failureThinkingDuration = failureState.thinkingDuration ?? genState?.thinkingDuration;
			const failureFirstTokenTime = failureState.firstTokenTime ?? genState?.firstTokenTime;
			if (genState) {
				genState.content = failureContent;
				genState.thinking = failureThinking;
				genState.thinkingDuration = failureThinkingDuration;
				genState.firstTokenTime = failureFirstTokenTime;
			}
			state.status = 'failed';
			state.error = err.message;
			state.content = failureContent;
			state.thinking = failureThinking;
			state.thinkingDuration = failureThinkingDuration;
			if (!isSessionInvalidated(sessionId)) {
				// Immediately update UI for this specific model
				renderSelectedEndpoints(groups, selectedEndpoints, true);
				updateCardStatus(endpointId, 'failed', err.message, genState, sessionId);
			}
			return {
				endpointId: endpointId,
				status: 'failed',
				error: err.message,
				thinking: failureThinking,
				content: failureContent,
				thinkingDuration: failureThinkingDuration,
				firstTokenTime: failureFirstTokenTime,
				totalDuration: completionTime - startTime,
				timestamp: completionTime
			};
		}
	});
	return Promise.all(promises);
}

function mergeParams(body, params, style) {
	if (!params || Object.keys(params).length === 0) return;
	var target = body;
	if (style === 'gemini') {
		body.generationConfig = body.generationConfig || {};
		target = body.generationConfig;
	}
	var keyMap = style === 'gemini' ? {
		max_tokens: 'maxOutputTokens',
		max_output_tokens: 'maxOutputTokens',
		top_p: 'topP',
		top_k: 'topK',
		stop_sequences: 'stopSequences',
		presence_penalty: 'presencePenalty',
		frequency_penalty: 'frequencyPenalty'
	} : (style === 'responses' ? {
		max_tokens: 'max_output_tokens'
	} : null);
	var reasoningEffort;
	var hasReasoningEffort = false;
	for (var pk in params) {
		if (Object.prototype.hasOwnProperty.call(params, pk)) {
			if (style === 'responses' && pk === 'reasoning_effort') {
				if (params[pk] !== null && params[pk] !== '') {
					reasoningEffort = params[pk];
					hasReasoningEffort = true;
				}
				continue;
			}
			var mappedKey = keyMap && Object.prototype.hasOwnProperty.call(keyMap, pk) ? keyMap[pk] : pk;
			if (params[pk] === null || params[pk] === '') continue;
			if ((pk === 'stop_sequences' || mappedKey === 'stopSequences') && typeof params[pk] === 'string') {
				var stopSequences = params[pk].split(',').map(function(s) {
					return s.trim();
				}).filter(Boolean);
				if (stopSequences.length > 0) {
					setOwnEnumerableDataProperty(target, mappedKey, stopSequences);
				}
			} else {
				setOwnEnumerableDataProperty(target, mappedKey, params[pk]);
			}
		}
	}
	if (hasReasoningEffort) {
		var reasoning = {};
		if (body.reasoning && typeof body.reasoning === 'object' && !Array.isArray(body.reasoning)) {
			for (var reasoningKey of Reflect.ownKeys(body.reasoning)) {
				var reasoningDescriptor = Object.getOwnPropertyDescriptor(body.reasoning, reasoningKey);
				if (reasoningDescriptor
					&& reasoningDescriptor.enumerable
					&& Object.prototype.hasOwnProperty.call(reasoningDescriptor, 'value')) {
					setOwnEnumerableDataProperty(reasoning, reasoningKey, reasoningDescriptor.value);
				}
			}
		}
		setOwnEnumerableDataProperty(body, 'reasoning', reasoning);
		setOwnEnumerableDataProperty(reasoning, 'effort', reasoningEffort);
	}
}

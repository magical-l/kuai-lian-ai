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
	if (!provider) throw new Error('不支持的接口风格: ' + style);
	if (!provider.buildEmbeddingRequest) throw new Error('该接口不支持嵌入');
	const req = provider.buildEmbeddingRequest(baseUrl, apiKey, model, input);
	console.log('Embed req:', req.url, JSON.stringify(req.headers));
	const res = await fetchWithTimeout(req.url, {
		method: 'POST',
		headers: req.headers,
		body: JSON.stringify(req.body)
	}, 60000);
	if (!res.ok) {
		const err = await res.text().catch(() => '');
		throw new Error('嵌入请求失败: ' + res.status + (err ? ' - ' + err : ''));
	}
	const data = await res.json();
	return provider.parseEmbeddingResponse(data);
}

async function callAllModels(groups, modelIds, messages, onChunk, sessionId) {
	const startTime = Date.now();
	clearSessionGenerations(sessionId);
	const gens = getSessionGenerations(sessionId);
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
			const config = resolveNodeConfig(info.node.id);
			const resultState = await callAPI(config.style || 'openai', config.baseUrl, config.key, info.model.name, messages, chunkState => {
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

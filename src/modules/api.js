// ========== API Functions ==========
const invalidatedSessionIds = new Set();

function invalidateSession(sessionId) {
	invalidatedSessionIds.add(sessionId);
}

function isSessionInvalidated(sessionId) {
	return invalidatedSessionIds.has(sessionId);
}

function clearSessionInvalidation(sessionId) {
	invalidatedSessionIds.delete(sessionId);
}

const sessionAbortControllers = new Map();

function getSessionAbortController(sessionId) {
	let state = sessionAbortControllers.get(sessionId);
	if (!state || state.controller.signal.aborted) {
		state = {
			controller: new AbortController(),
			count: 0
		};
		sessionAbortControllers.set(sessionId, state);
	}
	state.count += 1;
	return state.controller;
}

function abortSessionRequests(sessionId) {
	const state = sessionAbortControllers.get(sessionId);
	if (state) state.controller.abort();
	sessionAbortControllers.delete(sessionId);
}

function finishSessionAbortController(sessionId, controller) {
	const state = sessionAbortControllers.get(sessionId);
	if (!state || state.controller !== controller) return;
	state.count -= 1;
	if (state.count <= 0) {
		sessionAbortControllers.delete(sessionId);
	}
}

function getSessionGenerations(sessionId) {
	if (!sessionGenerations.has(sessionId)) {
		sessionGenerations.set(sessionId, new Map());
	}
	return sessionGenerations.get(sessionId);
}

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

function deleteSessionGenerations(sessionId) {
	clearSessionGenerations(sessionId);
	sessionGenerations.delete(sessionId);
}
let currentAbortController = null;

function stopSingleGeneration(sessionId, endpointId) {
	const gens = sessionGenerations.get(sessionId);
	if (!gens) return;
	const state = gens.get(endpointId);
	if (state && state.abortController && state.status === 'generating') {
		state.abortController.abort();
	}
}

function stopSessionGenerations(sessionId) {
	abortSessionRequests(sessionId);
	clearSessionGenerations(sessionId);
}

function stopAllGenerations() {
	if (currentSession) {
		stopSessionGenerations(currentSession.id);
	}
}

function toOpenAIContent(contentArray) {
	const isDocumentMime = mime => [
		'application/pdf',
		'application/msword',
		'application/vnd.ms-word',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'application/vnd.ms-excel',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		'application/vnd.ms-powerpoint',
		'application/vnd.openxmlformats-officedocument.presentationml.presentation'
	].includes(mime);
	const dataUrl = source => source.type === 'url'
		? source.url
		: `data:${source.media_type};base64,${source.data}`;
	const audioFormat = item => {
		const mime = item.source?.media_type || '';
		const extension = (item.name || '').toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
		if (mime === 'audio/mpeg' && (!extension || extension === 'mp3')) return 'mp3';
		if ((mime === 'audio/wav' || mime === 'audio/x-wav') && (!extension || extension === 'wav')) return 'wav';
		return null;
	};
	return contentArray.map(item => {
		if (item.type === 'text' || item.type === 'file_text') {
			return { type: 'text', text: item.text || '' };
		}
		if (item.type === 'image_url' || item.type === 'input_audio' || (item.type === 'file' && item.file)) {
			return item;
		}
		if (item.type === 'image') {
			if (!item.source) {
				return { type: 'text', text: `[图片 ${item.name || '未知'}，数据缺失]` };
			}
			if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(item.source.media_type)) {
				throw new Error(`OpenAI Chat 不支持图片附件 ${item.name || '未知'}`);
			}
			return {
				type: 'image_url',
				image_url: { url: dataUrl(item.source) }
			};
		}
		if (item.type === 'file') {
			if (!item.source) {
				return { type: 'text', text: `[文件 ${item.name || '未知'}，数据缺失]` };
			}
			const mime = item.source.media_type || '';
			if (mime.startsWith('audio/')) {
				const format = audioFormat(item);
				if (!format) throw new Error(`OpenAI Chat 不支持音频附件 ${item.name || '未知'}`);
				return {
					type: 'input_audio',
					input_audio: { format, data: item.source.data }
				};
			}
			if (!isDocumentMime(mime)) throw new Error(`OpenAI Chat 不支持文件附件 ${item.name || '未知'}`);
			return {
				type: 'file',
				file: { filename: item.name || '未知', file_data: dataUrl(item.source) }
			};
		}
		return { type: 'text', text: `[附件 ${item.name || '未知'}，不支持此类型]` };
	});
}
function toClaudeContent(contentArray) {
	return contentArray.map(item => {
		if (item.type === 'text' || item.type === 'file_text') {
			return { type: 'text', text: item.text || '' };
		}
		if (item.type === 'image_url') {
			return { type: 'image', source: { type: 'url', url: item.image_url?.url || item.image_url } };
		}
		if (item.type === 'image') {
			if (!item.source) return { type: 'text', text: `[图片 ${item.name || '未知'}，数据缺失]` };
			if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(item.source.media_type)) {
				throw new Error(`Claude 不支持图片附件 ${item.name || '未知'}`);
			}
			if (item.source.type === 'url') {
				return { type: 'image', source: { type: 'url', url: item.source.url } };
			}
			return { type: 'image', source: { type: 'base64', media_type: item.source.media_type, data: item.source.data } };
		}
		if (item.type === 'file') {
			if (!item.source) return { type: 'text', text: `[文件 ${item.name || '未知'}，数据缺失]` };
			const mime = item.source.media_type || '';
			if (mime.startsWith('audio/')) throw new Error(`Claude 不支持音频附件 ${item.name || '未知'}`);
			if (mime !== 'application/pdf') throw new Error(`Claude 不支持文件附件 ${item.name || '未知'}`);
			return { type: 'document', source: { type: 'base64', media_type: mime, data: item.source.data } };
		}
		return { type: 'text', text: `[附件 ${item.name || '未知'}，不支持此类型]` };
	});
}
function toGeminiContent(contentArray) {
	return contentArray.map(item => {
		if (item.type === 'text' || item.type === 'file_text') {
			return { text: item.text || '' };
		}
		if (item.type === 'image_url') {
			return { text: `[图片 URL: ${item.image_url?.url || item.image_url}]` };
		}
		if (item.type === 'image') {
			if (!item.source) return { text: `[图片 ${item.name || '未知'}，数据缺失]` };
			if (item.source.type === 'url') return { text: `[图片 URL: ${item.source.url}]` };
			return { inline_data: { mime_type: item.source.media_type, data: item.source.data } };
		}
		if (item.type === 'file') {
			if (item.source) return { inline_data: { mime_type: item.source.media_type, data: item.source.data } };
			return { text: `[文件 ${item.name || '未知'}，数据缺失]` };
		}
		return { text: `[附件 ${item.name || '未知'}，不支持此类型]` };
	});
}

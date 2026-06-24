// ========== API Functions ==========
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
	clearSessionGenerations(sessionId);
}

function stopAllGenerations() {
	if (currentSession) {
		stopSessionGenerations(currentSession.id);
	}
}

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
		return {
			type: 'text',
			text: `[附件 ${item.name || '未知'}，不支持此类型]`
		};
	});
}
function toClaudeContent(contentArray) {
	return contentArray.map(item => {
		if (item.type === 'text' || item.type === 'file_text') {
			return { type: 'text', text: item.text || '' };
		}
		if (item.type === 'image') {
			if (!item.source) return { type: 'text', text: `[图片 ${item.name || '未知'}，数据缺失]` };
			if (item.source.type === 'url') {
				return { type: 'image', source: { type: 'url', url: item.source.url } };
			}
			return { type: 'image', source: { type: 'base64', media_type: item.source.media_type, data: item.source.data } };
		}
		if (item.type === 'file') {
			if (!item.source) return { type: 'text', text: `[文件 ${item.name || '未知'}，数据缺失]` };
			return { type: 'image', source: { type: 'base64', media_type: item.source.media_type, data: item.source.data } };
		}
		return { type: 'text', text: `[附件 ${item.name || '未知'}，不支持此类型]` };
	});
}

function toGeminiContent(contentArray) {
	return contentArray.map(item => {
		if (item.type === 'text' || item.type === 'file_text') {
			return { text: item.text || '' };
		}
		if (item.type === 'image') {
			if (!item.source) return { text: `[图片 ${item.name || '未知'}，数据缺失]` };
			if (item.source.type === 'url') return { text: `[图片 URL: ${item.source.url}]` };
			return { inline_data: { mime_type: item.source.media_type, data: item.source.data } };
		}
		if (item.type === 'file') {
			if (!item.source) return { text: `[文件 ${item.name || '未知'}，数据缺失]` };
			return { inline_data: { mime_type: item.source.media_type, data: item.source.data } };
		}
		return { text: `[附件 ${item.name || '未知'}，不支持此类型]` };
	});
}

